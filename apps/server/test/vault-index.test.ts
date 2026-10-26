import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { fileURLToPath } from 'node:url'
import { eq } from 'drizzle-orm'
import Fastify from 'fastify'
import { conversations, openDatabase, runMigrations, users, type Db } from '@solera/db'
import { DEFAULT_CLAUDE_CONFIG } from '@solera/protocol'
import type {
  VaultNoteContentDto,
  VaultNoteDto,
  VaultNoteFactsDto,
  VaultNoteHistoryDto,
  VaultStateDto,
  VaultTreeDto,
  VaultWriteNoteDto,
} from '@solera/protocol'
import type { Config } from '../src/config.js'
import { EventLog } from '../src/events/event-log.js'
import { registerErrorHandler } from '../src/http/errors.js'
import { registerVaultRoutes } from '../src/http/routes/vault.js'
import { writeAppSettings } from '../src/settings/app-settings.js'
import { VaultIndex } from '../src/vault/index-service.js'
import { parseNote } from '../src/vault/notes.js'
import { buildResolver, targetKey } from '../src/vault/resolve.js'
import { listNotes, readCounts, readIndexState, readNoteFacts } from '../src/vault/store.js'

/**
 * L'index du vault, niveau 1.
 *
 * Tout ce qui est vérifié ici est **déterministe** : les faits du texte, leur inversion,
 * et le rattrapage par git. Rien n'appelle de modèle, rien ne dépend d'un seuil
 * discutable sauf celui des carrefours, qui est nommé. C'est exactement la part de
 * l'indexation qu'on peut tester, et c'est celle dont tout le reste dépend.
 */

async function harness(t: TestContext) {
  const dir = await mkdtemp(join(tmpdir(), 'solera-vault-'))
  t.after(() => rm(dir, { recursive: true, force: true }))

  const vaultDir = join(dir, 'vault')
  await mkdir(vaultDir)

  const { db, sqlite } = openDatabase(join(dir, 'test.sqlite'))
  runMigrations(db, fileURLToPath(new URL('../../../packages/db/migrations', import.meta.url)))
  t.after(() => sqlite.close())

  const config = {
    vault: { path: '' },
    retention: { autoArchiveDays: 14, autoArchiveSchedule: '45 4 * * *' },
    limits: { maxConcurrentSessions: 10 },
  } as Config

  writeAppSettings(db, { vaultPath: vaultDir })
  const vault = new VaultIndex(db, config)

  const write = async (path: string, text: string): Promise<void> => {
    const absolute = join(vaultDir, path)
    await mkdir(dirname(absolute), { recursive: true })
    await writeFile(absolute, text)
  }

  const remove = (path: string) => rm(join(vaultDir, path), { force: true })

  const git = (...args: string[]) => {
    const run = spawnSync('git', args, { cwd: vaultDir, encoding: 'utf8' })
    assert.equal(run.status, 0, run.stderr)
    return run.stdout.trim()
  }

  /** Un vault versionné, avec une identité à soi : la machine n'en a pas forcément. */
  const gitInit = () => {
    git('init', '--initial-branch=main')
    git('config', 'user.email', 'vault@solera.test')
    git('config', 'user.name', 'Vault')
  }

  const commit = (message: string) => {
    git('add', '--all')
    git('commit', '--allow-empty', '-m', message)
    return git('rev-parse', 'HEAD')
  }

  return { db, dir, vaultDir, vault, write, remove, git, gitInit, commit, config }
}

/** L'application réduite aux routes du vault, et un utilisateur déjà connecté. */
async function routes(t: TestContext, db: Db, vault: VaultIndex, config: Config, log = new EventLog(db)) {
  db.insert(users)
    .values({ id: 'tim', username: 'tim', displayName: 'Tim', passwordHash: '', createdAt: 1 })
    .run()

  const app = Fastify()
  app.addHook('preHandler', async (request) => {
    request.user = db.select().from(users).where(eq(users.id, 'tim')).get()
  })
  registerErrorHandler(app)
  registerVaultRoutes(app, { db, config }, vault, log)
  t.after(() => app.close())
  return app
}

test('les faits du texte se lisent sans modèle ni disque', () => {
  const parsed = parseNote(
    [
      '---',
      'title: Le rapprochement',
      'tags: [idée, produit]',
      '---',
      '',
      '# Autre titre',
      '',
      'Il répond à [[Atelier|ce que dit l’atelier]] et à [[Index#Niveau 1]].',
      '',
      '```md',
      'Un [[Exemple]] de syntaxe, qui n’est pas un lien.',
      '```',
      '',
      'Et `[[InlineCode]]` non plus.',
      '',
      'Mais ![[Capture]] en est un.',
    ].join('\n'),
  )

  // Le frontmatter l'emporte sur le premier titre : c'est une déclaration, pas une
  // déduction.
  assert.equal(parsed.title, 'Le rapprochement')
  assert.deepEqual(parsed.tags, ['idée', 'produit'])
  assert.deepEqual(
    parsed.links.map((link) => link.target),
    ['Atelier', 'Index', 'Capture'],
  )
  assert.equal(parsed.links[0]!.alias, 'ce que dit l’atelier')
  assert.equal(parsed.links[1]!.anchor, 'Niveau 1')
  // La ligne est celle du fichier, frontmatter compris : sans ça, le panneau renverrait
  // à côté dans un éditeur ouvert à la main.
  assert.equal(parsed.links[0]!.line, 8)
})

test('le titre se replie sur le premier titre de niveau 1, puis sur le nom du fichier', () => {
  assert.equal(parseNote('Une accroche.\n\n# Le vrai titre\n\n## Pas celui-là').title, 'Le vrai titre')
  assert.equal(parseNote('## Seulement un sous-titre').title, null)
  // Un titre dans un bloc de code n'est pas le titre de la note.
  assert.equal(parseNote('```sh\n# commentaire de script\n```\n').title, null)
})

test('une cible se résout par son nom, par son chemin, et casse quand rien ne répond', () => {
  const resolver = buildResolver(['Produit/Atelier.md', 'Journal/2026-10-12.md', 'Ébauche.md'])

  assert.equal(resolver.resolve(targetKey('Atelier')), 'Produit/Atelier.md')
  assert.equal(resolver.resolve(targetKey('Produit/Atelier.md')), 'Produit/Atelier.md')
  // La casse et l'accentuation se transportent mal entre deux machines : la
  // comparaison est normalisée.
  assert.equal(resolver.resolve(targetKey('ébauche')), 'Ébauche.md')
  assert.equal(resolver.resolve(targetKey('Disparue')), null)
})

test('un nom ambigu se résout sur le chemin le plus court, partout de la même façon', () => {
  const resolver = buildResolver(['Archive/Vieux/Atelier.md', 'Atelier.md'])

  assert.equal(resolver.resolve(targetKey('Atelier')), 'Atelier.md')
  // Le chemin écrit en entier lève l'ambiguïté, et le nom ne doit pas la ramener.
  assert.equal(resolver.resolve(targetKey('Archive/Vieux/Atelier')), 'Archive/Vieux/Atelier.md')
})

test('une passe complète donne les cinq faits que la page du vault montre', async (t) => {
  const { db, vault, write } = await harness(t)

  await write('Produit/Atelier.md', '# Atelier\n\nVoir [[Rapprochement]] et [[Disparue]].\n')
  await write('Produit/Rapprochement.md', '# Rapprochement\n\nIl se cite : [[Rapprochement]].\n')
  await write('Journal/2026-10-12.md', 'Le [[Rapprochement]] tient la page.\n')
  await write('Ébauche.md', '---\ntags: brouillon\n---\n\nRien encore.\n')

  const run = await vault.reindex()
  assert.equal(run.full, true)
  assert.equal(run.indexed, 4)

  const counts = readCounts(db)
  assert.equal(counts.notes, 4)
  // Une note sans dossier est une ébauche, et c'est tout ce qui la définit.
  assert.equal(counts.drafts, 1)
  assert.equal(counts.brokenLinks, 1)
  // Orphelines : Atelier (personne ne la cite), le Journal, et l'Ébauche. Rapprochement
  // est citée deux fois, et son lien vers elle-même ne compte pas.
  assert.equal(counts.orphans, 3)
  assert.equal(counts.crossroads, 0)

  const facts = readNoteFacts(db, 'Produit/Rapprochement.md')
  assert.ok(facts)
  // Rangés par titre, et le titre du journal est son nom de fichier faute d'en-tête :
  // le panneau liste des notes, pas un ordre d'écriture.
  assert.deepEqual(
    facts.incoming.map((link) => link.path),
    ['Journal/2026-10-12.md', 'Produit/Atelier.md'],
  )
  // Le lien d'une note vers elle-même n'est pas un lien entrant : « personne ne me
  // cite » ne doit pas devenir faux parce qu'une note porte son propre sommaire.
  assert.equal(facts.note.incoming, 2)
  assert.equal(facts.note.outgoing, 1)

  const broken = readNoteFacts(db, 'Produit/Atelier.md')
  assert.ok(broken)
  const cassé = broken.outgoing.find((link) => link.path === null)
  assert.ok(cassé)
  // Un lien cassé porte la cible telle qu'elle est écrite : c'est ce qu'il faut pour
  // la réparer, et il n'y a pas de titre à montrer.
  assert.equal(cassé.title, 'Disparue')

  const drafts = listNotes(db, { filter: 'drafts', folder: '', limit: 10 })
  assert.deepEqual(
    drafts.map((note) => note.path),
    ['Ébauche.md'],
  )
  assert.deepEqual(drafts[0]!.tags, ['brouillon'])
})

test('une note créée répare les liens cassés qui la visaient, supprimée elle les casse', async (t) => {
  const { db, vault, write, remove } = await harness(t)

  await write('Atelier.md', 'Voir [[Rapprochement]].\n')
  await vault.reindex()
  assert.equal(readCounts(db).brokenLinks, 1)

  await write('Rapprochement.md', '# Rapprochement\n')
  await vault.reindex()
  assert.equal(readCounts(db).brokenLinks, 0)
  assert.equal(readNoteFacts(db, 'Rapprochement.md')?.note.incoming, 1)

  await remove('Rapprochement.md')
  await vault.reindex()
  // Le lien survit à sa cible et redevient cassé : c'est le fait à montrer, pas une
  // ligne à effacer.
  assert.equal(readCounts(db).brokenLinks, 1)
  assert.equal(readNoteFacts(db, 'Rapprochement.md'), null)
})

test('un carrefour est un degré entrant au-dessus du seuil', async (t) => {
  const { db, vault, write } = await harness(t)

  await write('Carrefour.md', '# Carrefour\n')
  for (let i = 0; i < 5; i += 1) await write(`Notes/n${i}.md`, `Vers [[Carrefour]].\n`)

  await vault.reindex()
  assert.equal(readCounts(db).crossroads, 1)
  assert.deepEqual(
    listNotes(db, { filter: 'crossroads', folder: '', limit: 10 }).map((note) => note.path),
    ['Carrefour.md'],
  )
})

test("l'index stocke le commit qu'il reflète, et rattrape par git ce qui a bougé", async (t) => {
  const { db, vault, write, remove, gitInit, commit } = await harness(t)

  gitInit()
  await write('Atelier.md', '# Atelier\n\nVoir [[Rapprochement]].\n')
  await write('Rapprochement.md', '# Rapprochement\n')
  const first = commit('les deux notes')

  const full = await vault.sync()
  assert.equal(full.full, true)
  assert.equal(readIndexState(db)?.commitSha, first)

  // Du travail fait ailleurs, pendant que Solera était éteint : une note en plus, une
  // en moins, une modifiée.
  await write('Journal.md', 'Le [[Rapprochement]] tient la page.\n')
  await write('Atelier.md', '# Atelier\n\nPlus de lien.\n')
  await remove('Rapprochement.md')
  const second = commit('trois mouvements')

  const caught = await vault.sync()
  // Rattrapage et non passe complète : c'est tout l'intérêt du SHA stocké.
  assert.equal(caught.full, false)
  assert.equal(caught.indexed, 2)
  assert.equal(caught.removed, 1)
  assert.equal(readIndexState(db)?.commitSha, second)

  assert.equal(readNoteFacts(db, 'Rapprochement.md'), null)
  assert.equal(readCounts(db).notes, 2)
  // Le lien du journal vers la note supprimée est cassé, celui de l'atelier a disparu
  // du texte : les deux faits viennent du même rattrapage.
  assert.equal(readCounts(db).brokenLinks, 1)
  assert.equal(readNoteFacts(db, 'Atelier.md')?.note.outgoing, 0)
})

test('une écriture hors de Solera et pas encore committée est rattrapée aussi', async (t) => {
  const { db, vault, write, gitInit, commit } = await harness(t)

  gitInit()
  await write('Atelier.md', '# Atelier\n')
  commit('la note')
  await vault.sync()

  // Rien n'oblige à committer avant de rouvrir Solera : le statut de l'arbre de
  // travail complète le diff entre deux commits.
  await write('Atelier.md', '# Atelier\n\nVers [[Neuve]].\n')
  await write('Neuve.md', '# Neuve\n')

  const caught = await vault.sync()
  assert.equal(caught.full, false)
  assert.equal(readCounts(db).notes, 2)
  assert.equal(readCounts(db).brokenLinks, 0)
  assert.equal(readNoteFacts(db, 'Neuve.md')?.note.incoming, 1)
})

test("un commit que git ne reconnaît plus fait une passe complète, et l'index ne ment pas", async (t) => {
  const { db, vaultDir, vault, write, gitInit, commit } = await harness(t)

  gitInit()
  await write('Atelier.md', '# Atelier\n')
  commit('la note')
  await vault.sync()

  // Le dépôt refait — un vault reconstitué depuis une sauvegarde, par exemple : le
  // commit que l'index dit refléter n'existe plus nulle part. Un rattrapage serait
  // faux, donc il n'a pas lieu.
  await rm(join(vaultDir, '.git'), { recursive: true, force: true })
  gitInit()
  await write('Reprise.md', '# Reprise\n')
  const refait = commit('reprise')

  const run = await vault.sync()
  assert.equal(run.full, true)
  assert.equal(readIndexState(db)?.commitSha, refait)
  assert.equal(readCounts(db).notes, 2)
})

test("un vault hors dépôt git s'indexe quand même, sans SHA à refléter", async (t) => {
  const { db, vault, write } = await harness(t)

  await write('Atelier.md', '# Atelier\n')
  const run = await vault.sync()

  assert.equal(run.full, true)
  assert.equal(readIndexState(db)?.commitSha, null)
  assert.equal(readCounts(db).notes, 1)

  // Sans SHA, chaque passage refait tout : correct, et c'est le prix d'un vault
  // qu'on n'a pas versionné.
  assert.equal((await vault.sync()).full, true)
})

test('un vault non réglé ne fait rien, et ne casse rien', async (t) => {
  const { db, vault } = await harness(t)
  writeAppSettings(db, { vaultPath: '' })

  const run = await vault.sync()
  assert.equal(run.skipped, 'unconfigured')
  assert.equal(await vault.state().then((state) => state.configured), false)
})

test('un chemin réglé mais absent du disque se dit, au lieu de vider l’index', async (t) => {
  const { db, dir, vault, write } = await harness(t)

  await write('Atelier.md', '# Atelier\n')
  await vault.reindex()

  writeAppSettings(db, { vaultPath: join(dir, 'ailleurs') })
  const run = await vault.sync()
  assert.equal(run.skipped, 'missing')

  const state = await vault.state()
  assert.equal(state.configured, true)
  assert.equal(state.exists, false)
  // Le SHA et la date ne sont pas rendus : ils décrivent un autre dossier, et les
  // afficher ferait croire que l'index reflète celui-ci.
  assert.equal(state.indexedCommit, null)
  assert.equal(state.indexedAt, null)
})

test('les routes rendent les faits depuis l’index, jamais depuis le disque', async (t) => {
  const { db, vault, write, config } = await harness(t)
  const app = await routes(t, db, vault, config)

  await write('Produit/Atelier.md', '# Atelier\n\nVoir [[Rapprochement]] et [[Disparue]].\n')
  await write('Produit/Rapprochement.md', '# Rapprochement\n')
  await write('Ébauche.md', 'Rien encore.\n')

  const reindexed = await app.inject({ method: 'POST', url: '/api/vault/reindex' })
  assert.equal(reindexed.statusCode, 200)
  assert.equal(reindexed.json<{ indexed: number }>().indexed, 3)

  const state = await app.inject({ method: 'GET', url: '/api/vault' })
  assert.equal(state.json<VaultStateDto>().counts.notes, 3)

  const folder = await app.inject({ method: 'GET', url: '/api/vault/notes?folder=Produit' })
  assert.deepEqual(
    folder.json<VaultNoteDto[]>().map((note) => note.path).sort(),
    ['Produit/Atelier.md', 'Produit/Rapprochement.md'],
  )

  const facts = await app.inject({
    method: 'GET',
    url: `/api/vault/note?path=${encodeURIComponent('Produit/Rapprochement.md')}`,
  })
  assert.deepEqual(
    facts.json<VaultNoteFactsDto>().incoming.map((link) => link.path),
    ['Produit/Atelier.md'],
  )

  const unknown = await app.inject({ method: 'GET', url: '/api/vault/note?path=Jamais.md' })
  assert.equal(unknown.statusCode, 404)
  assert.equal(unknown.json<{ error: { code: string } }>().error.code, 'vault_note_not_indexed')
})

test('deux passes lancées ensemble ne se marchent pas sur la résolution', async (t) => {
  const { db, vault, write } = await harness(t)

  await write('Atelier.md', 'Voir [[Rapprochement]].\n')
  await write('Rapprochement.md', '# Rapprochement\n')

  const runs = await Promise.all([vault.reindex(), vault.reindex(), vault.sync()])
  for (const run of runs) assert.equal(run.indexed, 2)
  assert.equal(readCounts(db).notes, 2)
  assert.equal(readCounts(db).brokenLinks, 0)
})

test('une note se lit sur le disque, et son écriture passe par l’index', async (t) => {
  const { db, vault, write, config } = await harness(t)
  const app = await routes(t, db, vault, config)

  await write('Atelier.md', '# Atelier\n\nRien pour l’instant.\n')
  await vault.reindex()

  const read = await app.inject({ method: 'GET', url: '/api/vault/note/content?path=Atelier.md' })
  assert.equal(read.statusCode, 200)
  const opened = read.json<VaultNoteContentDto>()
  assert.match(opened.content, /Rien pour l’instant/)
  assert.equal(opened.title, 'Atelier')

  // Un `[[lien]]` écrit doit être un fait dès la réponse : l'index relit la note avant
  // que la route ne réponde.
  const saved = await app.inject({
    method: 'PUT',
    url: '/api/vault/note/content',
    payload: {
      path: 'Atelier.md',
      content: '# Atelier\n\nVoir [[Rapprochement]].\n',
      fingerprint: opened.fingerprint,
    },
  })
  assert.equal(saved.statusCode, 200)
  assert.equal(saved.json<VaultWriteNoteDto>().note.outgoing, 1)
  assert.equal(saved.json<VaultWriteNoteDto>().note.broken, 1)
  assert.equal(readCounts(db).brokenLinks, 1)

  // L'empreinte périmée arrête l'écriture : le vault s'édite ailleurs, et écraser en
  // silence est la seule perte que cette couche puisse causer.
  const stale = await app.inject({
    method: 'PUT',
    url: '/api/vault/note/content',
    payload: { path: 'Atelier.md', content: 'écrasé', fingerprint: opened.fingerprint },
  })
  assert.equal(stale.statusCode, 409)
  assert.equal(stale.json<{ error: { code: string } }>().error.code, 'vault_note_stale')

  // `null` force, et c'est le choix explicite d'écraser.
  const forced = await app.inject({
    method: 'PUT',
    url: '/api/vault/note/content',
    payload: { path: 'Atelier.md', content: '# Atelier\n', fingerprint: null },
  })
  assert.equal(forced.statusCode, 200)
  assert.equal(forced.json<VaultWriteNoteDto>().note.outgoing, 0)
})

test('un chemin qui sort du vault est refusé, en lecture comme en écriture', async (t) => {
  const { db, vault, config } = await harness(t)
  const app = await routes(t, db, vault, config)

  for (const path of ['../dehors.md', 'Dossier/../../dehors.md', '/etc/passwd.md', 'Capture.png']) {
    const read = await app.inject({
      method: 'GET',
      url: `/api/vault/note/content?path=${encodeURIComponent(path)}`,
    })
    assert.equal(read.statusCode, 400, path)

    const written = await app.inject({
      method: 'PUT',
      url: '/api/vault/note/content',
      payload: { path, content: 'x', fingerprint: null },
    })
    assert.equal(written.statusCode, 400, path)
  }
})

test('créer une note : dans un dossier, ou en ébauche sans dossier', async (t) => {
  const { db, vault, config } = await harness(t)
  const app = await routes(t, db, vault, config)

  const inFolder = await app.inject({
    method: 'POST',
    url: '/api/vault/notes',
    payload: { folder: 'Produit', title: 'Le rapprochement' },
  })
  assert.equal(inFolder.statusCode, 201)
  assert.equal(inFolder.json<VaultNoteDto>().path, 'Produit/Le rapprochement.md')
  assert.equal(inFolder.json<VaultNoteDto>().folder, 'Produit')
  // Le titre est le nom du fichier : une note dont le fichier s'appelle autrement ne
  // se retrouve pas hors de Solera, et `[[Titre]]` ne la viserait pas.
  assert.equal(inFolder.json<VaultNoteDto>().title, 'Le rapprochement')

  const draft = await app.inject({
    method: 'POST',
    url: '/api/vault/notes',
    payload: { title: 'Sans dossier' },
  })
  assert.equal(draft.json<VaultNoteDto>().folder, '', 'Une ébauche n’a pas de dossier')
  assert.equal(readCounts(db).drafts, 1)

  // Deux fois le même titre : le programme tranche plutôt que de renvoyer au formulaire.
  const again = await app.inject({
    method: 'POST',
    url: '/api/vault/notes',
    payload: { folder: 'Produit', title: 'Le rapprochement' },
  })
  assert.equal(again.json<VaultNoteDto>().path, 'Produit/Le rapprochement 2.md')

  // Un titre qui porte une barre oblique ne crée pas de dossier à l'insu de qui l'écrit.
  const slashed = await app.inject({
    method: 'POST',
    url: '/api/vault/notes',
    payload: { title: 'a/b' },
  })
  assert.equal(slashed.json<VaultNoteDto>().path, 'a-b.md')
})

test('garder un fil en note : ses messages en ébauche, et seulement pour son auteur', async (t) => {
  const { db, vault, config, vaultDir } = await harness(t)
  const log = new EventLog(db)
  const app = await routes(t, db, vault, config, log)
  db.insert(users)
    .values({ id: 'other', username: 'other', displayName: 'Other', passwordHash: '', createdAt: 1 })
    .run()

  db.insert(conversations).values({
    id: 'free', projectId: null, userId: 'tim', title: 'Une question sur le xérès',
    agent: 'claude', config: JSON.stringify(DEFAULT_CLAUDE_CONFIG), status: 'idle',
    position: 0, createdAt: 1, updatedAt: 1,
  }).run()
  log.append('free', { type: 'message.completed', messageId: 'u1', role: 'user', blocks: [{ type: 'text', text: 'Comment marche une solera ?' }], parentToolCallId: null })
  log.append('free', { type: 'tool.started', toolCallId: 't1', name: 'WebSearch', input: { q: 'solera' }, parentToolCallId: null } as never)
  log.append('free', { type: 'message.completed', messageId: 'a1', role: 'assistant', blocks: [{ type: 'text', text: 'On recomplète la vieille barrique avec la jeune.' }], parentToolCallId: null })

  const roles = { user: 'Moi', assistant: 'Claude' }
  const kept = await app.inject({
    method: 'POST',
    url: '/api/vault/notes/from-conversation',
    payload: { conversationId: 'free', roles },
  })
  assert.equal(kept.statusCode, 201, kept.body)
  const note = kept.json<VaultNoteDto>()
  assert.equal(note.path, 'Une question sur le xérès.md')
  assert.equal(note.folder, '', 'Une ébauche, à soi')
  const text = await readFile(join(vaultDir, note.path), 'utf8')
  assert.equal(
    text,
    '# Une question sur le xérès\n\n## Moi\n\nComment marche une solera ?\n\n## Claude\n\nOn recomplète la vieille barrique avec la jeune.\n',
  )

  // Le fil d'un autre ne se range pas d'ici, et ne se voit pas exister.
  db.update(conversations).set({ userId: 'other' }).where(eq(conversations.id, 'free')).run()
  const refused = await app.inject({
    method: 'POST',
    url: '/api/vault/notes/from-conversation',
    payload: { conversationId: 'free', roles },
  })
  assert.equal(refused.statusCode, 404)
})

test('l’historique d’une note est celui de git, et dit quand il n’y en a pas', async (t) => {
  const { db, vault, write, config, gitInit, commit } = await harness(t)
  const app = await routes(t, db, vault, config)

  await write('Atelier.md', '# Atelier\n')
  await vault.reindex()

  // Hors dépôt : pas d'historique du tout, ce qui ne se confond pas avec une note
  // qu'aucun commit ne connaît.
  const without = await app.inject({ method: 'GET', url: '/api/vault/note/history?path=Atelier.md' })
  assert.equal(without.json<VaultNoteHistoryDto>().versioned, false)

  gitInit()
  commit('la note')
  const versioned = await app.inject({ method: 'GET', url: '/api/vault/note/history?path=Atelier.md' })
  const history = versioned.json<VaultNoteHistoryDto>()
  assert.equal(history.versioned, true)
  assert.equal(history.uncommitted, false)
  assert.deepEqual(history.revisions.map((entry) => entry.subject), ['la note'])

  await write('Atelier.md', '# Atelier\n\nUne ligne de plus.\n')
  const dirty = await app.inject({ method: 'GET', url: '/api/vault/note/history?path=Atelier.md' })
  // Enregistrer ne committe pas : une note modifiée le dit, au lieu de laisser croire
  // que l'historique la contient.
  assert.equal(dirty.json<VaultNoteHistoryDto>().uncommitted, true)
})

test('l’arbre du vault ne montre que les dossiers où des notes vivent', async (t) => {
  const { db, vault, write, config } = await harness(t)
  const app = await routes(t, db, vault, config)

  await write('Produit/Atelier.md', '# Atelier\n\nVoir [[Chantiers]].\n')
  await write('Produit/Idées/Chantiers.md', '# Chantiers\n')
  await write('Ébauche.md', 'Rien encore.\n')
  await vault.reindex()

  const tree = (await app.inject({ method: 'GET', url: '/api/vault/tree' })).json<VaultTreeDto>()
  assert.deepEqual(tree.folders.map((folder) => folder.path), ['Produit', 'Produit/Idées'])
  assert.deepEqual(tree.folders.map((folder) => folder.notes), [1, 1])
  assert.deepEqual(tree.notes.map((note) => note.path), [
    'Produit/Atelier.md',
    'Produit/Idées/Chantiers.md',
    'Ébauche.md',
  ])
  // Le degré entrant accompagne chaque note : c'est par lui que le sélecteur de `[[`
  // classe ses propositions, les carrefours d'abord.
  assert.deepEqual(tree.notes.map((note) => note.incoming), [0, 1, 0])
})

test('sans vault réglé, les routes qui touchent au disque le disent', async (t) => {
  const { db, vault, config } = await harness(t)
  writeAppSettings(db, { vaultPath: '' })
  const app = await routes(t, db, vault, config)

  for (const url of ['/api/vault/note/content?path=a.md', '/api/vault/note/history?path=a.md']) {
    const response = await app.inject({ method: 'GET', url })
    assert.equal(response.statusCode, 400)
    assert.equal(response.json<{ error: { code: string } }>().error.code, 'vault_unconfigured')
  }
})
