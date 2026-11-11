import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { eq } from 'drizzle-orm'
import { skillSources, type Db } from '@solera/db'
import type { SkillSourceDto } from '@solera/protocol'
import { SOLERA_SKILLS_SOURCE_ID, installSoleraSkills } from '../src/skill-library/solera-skills.js'
import { SkillSources } from '../src/skill-library/sources.js'
import { readDirectory } from '../src/skill-library/store.js'
import { createSkill, harness, http } from './skill-library-support.js'

/**
 * Le dépôt de Solera en miniature : un skill publié avec la v0.20.0, un second arrivé
 * sur `main` après elle. Local, pour qu'aucun test ne clone le réseau.
 */
function soleraRepository(dir: string) {
  const root = join(dir, 'solera')
  const git = (...args: string[]) =>
    execFileSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.invalid', ...args], { cwd: root, stdio: 'pipe' })
      .toString()
      .trim()
  const skill = (path: string, name: string) => {
    mkdirSync(join(root, path), { recursive: true })
    writeFileSync(join(root, path, 'SKILL.md'), `---\nname: ${name}\ndescription: Use for ${name}.\n---\n\n${name}.\n`)
  }
  mkdirSync(root, { recursive: true })
  git('init', '-q', '-b', 'main')
  skill('skills/ranger-une-idee', 'ranger-une-idee')
  git('add', '-A')
  git('commit', '-q', '-m', 'v0.20.0')
  git('tag', 'v0.20.0')
  const tagged = git('rev-parse', 'HEAD')
  skill('skills/affiner-un-jalon', 'affiner-un-jalon')
  git('add', '-A')
  git('commit', '-q', '-m', 'main')
  return { root, git, skill, tagged, head: git('rev-parse', 'HEAD') }
}

/** La source de la migration, pointée sur le dépôt local. */
function pointAt(db: Db, url: string) {
  db.update(skillSources).set({ url }).where(eq(skillSources.id, SOLERA_SKILLS_SOURCE_ID)).run()
}

const refresh = async (call: Awaited<ReturnType<typeof http>>['call']) =>
  (await call('admin', 'POST', `/api/skill-sources/${SOLERA_SKILLS_SOURCE_ID}/refresh`)).json() as SkillSourceDto

test('source de Solera : suit le tag de la version installée', async (t) => {
  for (const version of ['0.20.0', 'v0.20.0', '0.20.0-3-g1a2b3c4']) {
    const { call, db, dir } = await http(t, version)
    const repo = soleraRepository(dir)
    pointAt(db, repo.root)
    const source = await refresh(call)
    assert.equal(source.ref, 'v0.20.0', version)
    assert.equal(source.lastCommit, repo.tagged, version)
    assert.equal(source.skillCount, 1, version)
  }
})

test('source de Solera : une mise à jour de Solera lit le tag suivant dans le même clone', async (t) => {
  const { call, db, dir } = await http(t, '0.20.0')
  const repo = soleraRepository(dir)
  pointAt(db, repo.root)
  await refresh(call)
  repo.git('tag', 'v0.21.0')

  const upgraded = new SkillSources(db, join(dir, 'sources'), '0.21.0')
  const row = await upgraded.refresh(upgraded.row(SOLERA_SKILLS_SOURCE_ID), {})
  assert.equal(row.lastCommit, repo.head)
  assert.deepEqual(upgraded.entries(row).map((entry) => entry.name), ['affiner-un-jalon', 'ranger-une-idee'])
})

test('source de Solera : sans version publiée, la branche par défaut ; une ref posée par un admin l’emporte', async (t) => {
  const dev = await http(t, 'dev')
  const repo = soleraRepository(dev.dir)
  pointAt(dev.db, repo.root)
  const source = await refresh(dev.call)
  assert.deepEqual([source.ref, source.lastCommit], [null, repo.head])

  const pinned = await http(t, '0.21.0')
  const other = soleraRepository(pinned.dir)
  pointAt(pinned.db, other.root)
  pinned.db.update(skillSources).set({ ref: 'v0.20.0' }).where(eq(skillSources.id, SOLERA_SKILLS_SOURCE_ID)).run()
  const kept = await refresh(pinned.call)
  assert.deepEqual([kept.ref, kept.lastCommit], ['v0.20.0', other.tagged])
})

test('installation d’office : une fois, dans la bibliothèque globale, puis désinstallable pour de bon', async (t) => {
  const { db, dir, library, sources } = harness(t, 'dev')
  const repo = soleraRepository(dir)
  pointAt(db, repo.root)

  assert.deepEqual(await installSoleraSkills(db, sources, library), ['affiner-un-jalon', 'ranger-une-idee'])
  const installed = library.list(null)
  assert.deepEqual(installed.map((skill) => [skill.name, skill.scope, skill.origin?.sourceId, skill.origin?.commit]), [
    ['affiner-un-jalon', 'global', SOLERA_SKILLS_SOURCE_ID, repo.head],
    ['ranger-une-idee', 'global', SOLERA_SKILLS_SOURCE_ID, repo.head],
  ])

  library.remove(library.row(installed[0]!.id))
  assert.deepEqual(await installSoleraSkills(db, sources, library), [], 'pas au démarrage suivant')
  assert.deepEqual(library.list(null).map((skill) => skill.name), ['ranger-une-idee'])
})

test('installation d’office : un skill homonyme de la bibliothèque est gardé, un skill secondaire seulement proposé', async (t) => {
  const { db, dir, library, sources } = harness(t, 'dev')
  const repo = soleraRepository(dir)
  repo.skill('skills/extras/rarement', 'rarement')
  repo.git('add', '-A')
  repo.git('commit', '-q', '-m', 'extras')
  pointAt(db, repo.root)
  createSkill(library, { name: 'ranger-une-idee', description: 'Use when mine.' })

  assert.deepEqual(await installSoleraSkills(db, sources, library), ['affiner-un-jalon'])
  const mine = library.list(null).find((skill) => skill.name === 'ranger-une-idee')!
  assert.equal(mine.origin, null, 'le skill de l’instance n’est pas écrasé')
  assert.ok(!library.list(null).some((skill) => skill.name === 'rarement'))
  const row = sources.row(SOLERA_SKILLS_SOURCE_ID)
  assert.ok(sources.entries(row).some((entry) => entry.path === 'skills/extras/rarement'), 'mais le catalogue le propose')
})

test('installation d’office : source supprimée ou désactivée, rien ; clone raté, réessayé au démarrage suivant', async (t) => {
  const removed = harness(t, 'dev')
  removed.sources.remove(removed.sources.row(SOLERA_SKILLS_SOURCE_ID))
  assert.deepEqual(await installSoleraSkills(removed.db, removed.sources, removed.library), [])

  const disabled = harness(t, 'dev')
  disabled.db.update(skillSources).set({ enabled: false }).where(eq(skillSources.id, SOLERA_SKILLS_SOURCE_ID)).run()
  assert.deepEqual(await installSoleraSkills(disabled.db, disabled.sources, disabled.library), [])

  const offline = harness(t, 'dev')
  pointAt(offline.db, join(offline.dir, 'nowhere'))
  await assert.rejects(installSoleraSkills(offline.db, offline.sources, offline.library))
  const repo = soleraRepository(offline.dir)
  pointAt(offline.db, repo.root)
  assert.deepEqual(await installSoleraSkills(offline.db, offline.sources, offline.library), ['affiner-un-jalon', 'ranger-une-idee'])
})

test('le dossier skills/ du dépôt : chaque skill s’installe tel quel, sous le nom de son dossier', (t) => {
  const { library } = harness(t)
  const root = fileURLToPath(new URL('../../../skills', import.meta.url))
  const names = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(root, entry.name, 'SKILL.md')))
    .map((entry) => entry.name)
  assert.ok(names.includes('ranger-une-idee') && names.includes('affiner-un-jalon'))
  for (const name of names) {
    const skill = library.install(readDirectory(join(root, name)), { scope: 'global', projectId: null }, null)
    assert.deepEqual([skill.name, skill.problem], [name, null], name)
  }
})
