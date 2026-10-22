import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test, type TestContext } from 'node:test'
import { fileURLToPath } from 'node:url'
import Fastify from 'fastify'
import { conversations, openDatabase, projects, runMigrations, users } from '@solera/db'
import { registerErrorHandler } from '../src/http/errors.js'
import { registerGitActionRoutes } from '../src/http/routes/git-actions.js'
import { EventLog } from '../src/events/event-log.js'
import { WorktreeStatusService } from '../src/worktrees/status-service.js'
import {
  impactOf,
  perform,
  readStashDetails,
  readWriteState,
  UndoJournal,
} from '../src/git-write.js'

/**
 * Les écritures de la vue Git, c'est-à-dire la partie qui peut abîmer un dépôt.
 *
 * Deux choses sont vérifiées ici et ne peuvent l'être nulle part ailleurs :
 *
 * - **le garde-fou dit vrai** — ce qu'il annonce comme perte est exactement ce que le
 *   geste détruit, mesuré avant et après sur un vrai dépôt. Un garde-fou qui se trompe
 *   de chiffre est pire que pas de garde-fou, et c'est invisible sur une capture ;
 * - **le verrou tient côté serveur** — les écritures sont refusées pendant qu'un tour
 *   tourne (carte #10, question 2). L'interface éteint ses boutons, mais c'est la
 *   route qui décide, et une interface n'est pas un garde-fou.
 */

const roots: string[] = []
after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Tim',
      GIT_AUTHOR_EMAIL: 'tim@example.test',
      GIT_COMMITTER_NAME: 'Tim',
      GIT_COMMITTER_EMAIL: 'tim@example.test',
    },
  })
}

/** Un dépôt jetable : trois commits, dont un co-signé par un agent. */
function repo(): string {
  const root = mkdtempSync(join(tmpdir(), 'solera-git-write-'))
  roots.push(root)
  git(root, 'init', '-b', 'main')
  // L'identité est posée **dans le dépôt**, et non dans l'environnement du helper
  // ci-dessus. Ce helper ne sert qu'aux commits de la mise en place ; les gestes qu'on
  // éprouve, eux, sont exécutés par le serveur, qui lance son propre git et n'hérite
  // pas de ces variables. Sur une machine de développement, le `.gitconfig` de
  // l'utilisateur comble le trou sans qu'on s'en aperçoive — en intégration continue
  // il n'y en a pas, et les seuls tests où c'est le **serveur** qui commite tombaient
  // sur « Author identity unknown » : le rebase interactif, « Annuler », « Refaire ».
  git(root, 'config', 'user.name', 'Tim')
  git(root, 'config', 'user.email', 'tim@example.test')
  writeFileSync(join(root, 'a.txt'), 'un\n')
  git(root, 'add', '-A')
  git(root, 'commit', '-m', 'Le premier')
  writeFileSync(join(root, 'b.txt'), 'deux\n')
  git(root, 'add', '-A')
  git(root, 'commit', '-m', 'Le deuxième', '-m', 'Co-Authored-By: Claude <noreply@anthropic.com>')
  writeFileSync(join(root, 'c.txt'), 'trois\n')
  git(root, 'add', '-A')
  git(root, 'commit', '-m', 'Le troisième', '-m', 'Co-Authored-By: Claude <noreply@anthropic.com>')
  return root
}

const sha = (root: string, ref: string): string => git(root, 'rev-parse', ref).trim()

test('en cours sépare ce qui est indexé de ce qui ne l’est pas, non-suivis compris', async () => {
  const root = repo()
  writeFileSync(join(root, 'a.txt'), 'un\nmodifié\n')
  writeFileSync(join(root, 'neuf.txt'), 'rien dans git\n')
  writeFileSync(join(root, 'b.txt'), 'deux\nindexé\n')
  git(root, 'add', 'b.txt')

  const state = await readWriteState(root)
  assert.ok(state)
  assert.deepEqual(state.staged.map((file) => file.path), ['b.txt'])
  assert.deepEqual(state.unstaged.map((file) => file.path).sort(), ['a.txt', 'neuf.txt'])
  // La lecture ne doit rien avoir indexé au passage : l'index temporaire est là pour ça.
  assert.equal(git(root, 'diff', '--cached', '--name-only').trim(), 'b.txt')
})

test('le garde-fou d’un reset --dur annonce exactement ce qui sera perdu', async () => {
  const root = repo()
  writeFileSync(join(root, 'a.txt'), 'un\ndeux\ntrois\n')
  writeFileSync(join(root, 'neuf.txt'), 'non suivi\n')
  writeFileSync(join(root, 'b.txt'), 'deux\nindexé\n')
  git(root, 'add', 'b.txt')

  const target = sha(root, 'HEAD~2')
  const impact = await impactOf(root, { kind: 'commit-reset', hash: target, mode: 'hard' })

  assert.equal(impact.undoable, false, 'un reset --dur ne s’annule pas')
  assert.equal(impact.offerStash, true, 'il y a du travail à remiser d’abord')

  const working = impact.losses.find((loss) => loss.kind === 'working')
  const staged = impact.losses.find((loss) => loss.kind === 'staged')
  const commits = impact.losses.find((loss) => loss.kind === 'commits')
  // Deux fichiers suivis et sales : a.txt modifié, b.txt indexé. `neuf.txt`, non
  // suivi, n'y est pas — un reset --dur ne l'efface pas, donc il n'est pas perdu.
  assert.equal(working?.count, 2)
  assert.equal(staged?.count, 1)
  assert.equal(commits?.count, 2)
  assert.equal(commits?.byAgent, 2, 'les deux commits perdus sont co-signés d’un agent')

  // Et maintenant la vérité : on fait le geste, et on compte ce qui a disparu.
  await perform(root, { kind: 'commit-reset', hash: target, mode: 'hard' }, {})
  assert.equal(sha(root, 'HEAD'), target)
  // Ce que l'impact annonçait, et rien de plus : les modifications suivies sont
  // parties, l'index est vide, les deux commits ont disparu — et `neuf.txt` est encore
  // là, parce qu'il n'était pas dans la liste.
  assert.equal(git(root, 'status', '--porcelain', '--untracked-files=all').trim(), '?? neuf.txt')
  assert.equal(git(root, 'show', 'HEAD:a.txt'), 'un\n')
  assert.equal(git(root, 'log', '--format=%s').trim(), 'Le premier')
})

test('jeter des modifications nomme les fichiers qu’on perd, et seulement ceux-là', async () => {
  const root = repo()
  writeFileSync(join(root, 'a.txt'), 'un\nmodifié\n')
  writeFileSync(join(root, 'b.txt'), 'deux\nmodifié\n')

  const impact = await impactOf(root, { kind: 'discard', paths: ['a.txt'] })
  assert.equal(impact.undoable, false)
  assert.equal(impact.losses[0]?.kind, 'working')
  assert.equal(impact.losses[0]?.count, 1, 'le fichier qu’on jette, pas l’autre')

  await perform(root, { kind: 'discard', paths: ['a.txt'] }, {})
  assert.equal(git(root, 'status', '--porcelain').trim(), 'M b.txt', 'b.txt est intact')
})

test('un commit s’annule, et l’offre disparaît dès que le dépôt a bougé', async () => {
  const root = repo()
  const journal = new UndoJournal()
  writeFileSync(join(root, 'd.txt'), 'quatre\n')
  git(root, 'add', '-A')

  const before = sha(root, 'HEAD')
  const outcome = await perform(
    root,
    {
      kind: 'commit',
      summary: 'Le quatrième',
      description: '',
      amend: false,
      coAuthor: 'Co-Authored-By: Claude <noreply@anthropic.com>',
      push: false,
    },
    {},
  )
  journal.record(root, outcome.undo)

  const undo = await journal.undoable(root)
  assert.equal(undo?.kind, 'commit')
  assert.equal(undo?.subject, 'Le quatrième')
  assert.equal(undo?.target, before.slice(0, 7), 'le bandeau dit où l’annulation ramène')
  assert.equal(undo?.pushed, false, 'rien n’a été poussé')
  // Le co-auteur est la seule trace d'un agent : c'est lui qui alimente la colonne.
  assert.match(git(root, 'log', '-1', '--format=%B'), /Co-Authored-By: Claude/)

  await journal.undo(root)
  assert.equal(sha(root, 'HEAD'), before)
  assert.equal(git(root, 'diff', '--cached', '--name-only').trim(), 'd.txt', 'l’index est rendu')

  // Un geste venu d'ailleurs — un agent, un terminal — périme l'annulation.
  const second = new UndoJournal()
  const again = await perform(
    root,
    { kind: 'commit', summary: 'Encore', description: '', amend: false, coAuthor: null, push: false },
    {},
  )
  second.record(root, again.undo)
  assert.ok(await second.undoable(root))
  writeFileSync(join(root, 'e.txt'), 'cinq\n')
  git(root, 'add', '-A')
  git(root, 'commit', '-m', 'Par-dessus')
  assert.equal(await second.undoable(root), null, 'on ne promet pas ce qu’on ne peut plus tenir')
})

test('« Refaire » rejoue le geste, et réarme son annulation', async () => {
  const root = repo()
  const journal = new UndoJournal()
  writeFileSync(join(root, 'd.txt'), 'quatre\n')
  git(root, 'add', '-A')

  const outcome = await perform(
    root,
    { kind: 'commit', summary: 'Le quatrième', description: '', amend: false, coAuthor: null, push: false },
    {},
  )
  journal.record(root, outcome.undo)
  await journal.undo(root)
  assert.ok(await journal.redoable(root), 'ce qu’on vient de défaire se refait')

  await journal.redo(root, {})
  assert.equal(git(root, 'log', '-1', '--format=%s').trim(), 'Le quatrième')
  // Refaire rejoue le geste d'origine, donc il réarme son propre « Annuler ».
  assert.equal((await journal.undoable(root))?.kind, 'commit')
  assert.equal(await journal.redoable(root), null)
})

test('une remise retrouve sa place même si la pile a glissé sous elle', async () => {
  const root = repo()
  writeFileSync(join(root, 'a.txt'), 'un\nremisé\n')
  await perform(root, { kind: 'stash-push', message: 'Le premier chantier' }, {})
  writeFileSync(join(root, 'b.txt'), 'deux\nremisé\n')
  await perform(root, { kind: 'stash-push', message: 'Le second chantier' }, {})

  const stashes = await readStashDetails(root)
  assert.deepEqual(stashes.map((stash) => stash.message), ['Le second chantier', 'Le premier chantier'])
  assert.deepEqual(stashes[1]?.files.map((file) => file.path), ['a.txt'], 'l’aperçu dit ce qu’elle contient')

  // Une autre session dépile pendant qu'on regarde : `stash@{1}` ne désigne plus la
  // même remise, et c'est le sha qui le dit.
  const wanted = stashes[1]
  assert.ok(wanted)
  git(root, 'stash', 'drop', 'stash@{0}')
  await perform(root, { kind: 'stash-pop', index: 1, hash: wanted.hash }, {})
  assert.match(git(root, 'status', '--porcelain'), /a\.txt/)
  assert.equal((await readStashDetails(root)).length, 0)
})

test('une remise disparue ne fait pas dépiler la voisine', async () => {
  const root = repo()
  writeFileSync(join(root, 'a.txt'), 'un\nremisé\n')
  await perform(root, { kind: 'stash-push', message: 'Le seul' }, {})
  const absent = sha(root, 'HEAD')

  await assert.rejects(
    perform(root, { kind: 'stash-drop', index: 0, hash: absent }, {}),
    /n’est plus dans la pile/,
  )
  assert.equal((await readStashDetails(root)).length, 1, 'rien n’a été supprimé')
})

/**
 * Le verrou, à la route.
 *
 * Le fil « Refactor settings storage » du dépôt de démo est dans cet état en
 * permanence : un agent qui attend une réponse tient le répertoire autant qu'un agent
 * qui écrit, puisqu'il reprendra la main sans prévenir.
 */
async function harness(t: TestContext, status: 'idle' | 'running' | 'awaiting_input') {
  const root = repo()
  const dir = mkdtempSync(join(tmpdir(), 'solera-git-lock-'))
  roots.push(dir)
  const { db, sqlite } = openDatabase(join(dir, 'test.sqlite'))
  runMigrations(db, fileURLToPath(new URL('../../../packages/db/migrations', import.meta.url)))
  t.after(() => sqlite.close())

  db.insert(users).values({ id: 'owner', username: 'owner', displayName: 'owner', passwordHash: '', createdAt: 1 }).run()
  db.insert(projects).values({ id: 'project', name: 'Demo', workspacePath: root, ownerId: 'owner', visibility: 'private', createdAt: 1 }).run()
  db.insert(conversations).values({
    id: 'thread', projectId: 'project', userId: 'owner', title: 'Un agent au travail',
    agent: 'claude', config: '{}', status, createdAt: 1, updatedAt: 2,
  }).run()

  const app = Fastify()
  registerErrorHandler(app)
  app.addHook('onRequest', async (request) => {
    request.user = db.select().from(users).all()[0]
  })
  // Les routes périment l'avancement des chantiers après chaque geste : un service réel
  // sur cette base, jamais lu ici.
  registerGitActionRoutes(
    app,
    { db, config: { paths: { data: dir, database: join(dir, 'test.sqlite') } } } as never,
    new WorktreeStatusService(db, new EventLog(db)),
  )
  t.after(() => app.close())
  return { app, root }
}

test('les écritures sont fermées pendant qu’un tour tourne, et la lecture continue', async (t) => {
  const { app, root } = await harness(t, 'running')

  const state = await app.inject({ method: 'GET', url: '/api/projects/project/git/state' })
  assert.equal(state.statusCode, 200, 'la lecture reste ouverte')
  assert.equal(state.json().lock.title, 'Un agent au travail', 'et elle dit qui tient le répertoire')

  writeFileSync(join(root, 'a.txt'), 'un\nmodifié pendant le tour\n')
  const act = await app.inject({
    method: 'POST',
    url: '/api/projects/project/git/act',
    payload: { kind: 'stage', paths: ['a.txt'] },
  })
  assert.equal(act.statusCode, 409)
  assert.equal(act.json().error.code, 'turn_running')
  assert.equal(git(root, 'diff', '--cached', '--name-only').trim(), '', 'rien n’a été indexé')
})

test('un agent qui attend une réponse tient le répertoire autant qu’un agent qui écrit', async (t) => {
  const { app } = await harness(t, 'awaiting_input')
  const act = await app.inject({
    method: 'POST',
    url: '/api/projects/project/git/act',
    payload: { kind: 'stash-push', message: '' },
  })
  assert.equal(act.statusCode, 409)
})

test('au repos, le même geste passe', async (t) => {
  const { app, root } = await harness(t, 'idle')
  writeFileSync(join(root, 'a.txt'), 'un\nmodifié\n')
  const act = await app.inject({
    method: 'POST',
    url: '/api/projects/project/git/act',
    payload: { kind: 'stage', paths: ['a.txt'] },
  })
  assert.equal(act.statusCode, 200, act.body)
  assert.equal(git(root, 'diff', '--cached', '--name-only').trim(), 'a.txt')
})
