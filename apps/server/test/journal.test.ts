import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import Fastify from 'fastify'
import { eq } from 'drizzle-orm'
import {
  cardMoves,
  cardNotes,
  cards,
  conversations,
  openDatabase,
  projects,
  runMigrations,
  scheduledRuns,
  scheduledTasks,
  users,
  worktrees,
} from '@solera/db'
import { JOURNAL_FAMILY_OF, type JournalDto, type JournalEntryDto } from '@solera/protocol'
import type { Config } from '../src/config.js'
import { registerErrorHandler } from '../src/http/errors.js'
import { registerJournalRoutes } from '../src/http/routes/journal.js'

const run = promisify(execFile)

const DAY = 86_400_000

async function harness(t: TestContext) {
  const dir = await mkdtemp(join(tmpdir(), 'solera-journal-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const { db, sqlite } = openDatabase(join(dir, 'test.sqlite'))
  runMigrations(db, fileURLToPath(new URL('../../../packages/db/migrations', import.meta.url)))
  t.after(() => sqlite.close())

  const repo = join(dir, 'repo')
  await mkdir(repo, { recursive: true })

  db.insert(users)
    .values({ id: 'owner', username: 'owner', displayName: 'Owner', passwordHash: '', createdAt: 1 })
    .run()
  db.insert(projects)
    .values({
      id: 'project',
      name: 'Solera',
      workspacePath: repo,
      ownerId: 'owner',
      visibility: 'private',
      createdAt: 1,
    })
    .run()

  const app = Fastify()
  app.addHook('preHandler', async (request) => {
    request.user = db.select().from(users).where(eq(users.id, 'owner')).get()
  })
  registerErrorHandler(app)
  registerJournalRoutes(app, { db, config: {} as Config })
  t.after(() => app.close())

  const read = async (url = '/api/projects/project/journal'): Promise<JournalDto> => {
    const response = await app.inject({ method: 'GET', url })
    assert.equal(response.statusCode, 200, response.body)
    return response.json()
  }
  return { app, db, dir, repo, read }
}

const kinds = (journal: JournalDto): string[] => journal.entries.map((entry) => entry.kind)
const find = (journal: JournalDto, kind: string): JournalEntryDto => {
  const entry = journal.entries.find((candidate) => candidate.kind === kind)
  assert.ok(entry, `aucune ligne « ${kind} » dans ${JSON.stringify(kinds(journal))}`)
  return entry
}

test('les cinq sources en base donnent une ligne chacune, la plus récente en tête', async (t) => {
  const { db, read } = await harness(t)
  const now = Date.now()

  db.insert(cards)
    .values({
      id: 'card',
      projectId: 'project',
      number: 17,
      title: 'Fusionner les quatre branches de la colonne',
      column: 'done',
      createdBy: 'owner',
      createdAt: now - 3 * DAY,
      updatedAt: now,
    })
    .run()
  db.insert(conversations)
    .values({
      id: 'session',
      projectId: 'project',
      cardId: 'card',
      userId: 'owner',
      title: 'grill complet',
      agent: 'claude',
      config: '{}',
      status: 'idle',
      createdAt: now - 2 * DAY,
      updatedAt: now,
    })
    .run()
  db.insert(cardNotes)
    .values({
      id: 'note',
      cardId: 'card',
      conversationId: 'session',
      userId: 'owner',
      body: '## Un titre\n\nUn agent déclare un projet ; l’utilisateur accorde le rangement.',
      createdAt: now - DAY,
    })
    .run()
  db.insert(cardMoves)
    .values({
      id: 'move',
      cardId: 'card',
      fromColumn: 'review',
      toColumn: 'done',
      userId: 'owner',
      movedAt: now - 2 * 3600_000,
    })
    .run()
  db.insert(scheduledTasks)
    .values({
      id: 'task',
      projectId: 'project',
      userId: 'owner',
      name: 'Veille des CLI',
      agent: 'claude',
      config: '{}',
      prompt: '',
      cadence: '{}',
      maxDurationMinutes: 10,
      createdAt: now - 5 * DAY,
      updatedAt: now,
    })
    .run()
  db.insert(scheduledRuns)
    .values({
      id: 'shot',
      taskId: 'task',
      conversationId: null,
      trigger: 'schedule',
      status: 'succeeded',
      scheduledFor: now - 3600_000,
      startedAt: now - 3600_000,
      summary: 'Claude Code 2.1.4 disponible',
    })
    .run()

  const journal = await read()

  assert.deepEqual(kinds(journal), ['run', 'cardClosed', 'note', 'session', 'cardOpened'])

  // La note montre l'amorce de son corps, débarrassée du balisage de début de ligne,
  // et sa provenance nomme la session qui l'a écrite.
  const note = find(journal, 'note')
  assert.equal(note.title, 'Un titre')
  assert.equal(note.source, 'grill complet')
  assert.equal(note.cardNumber, 17)
  assert.equal(note.conversationId, 'session')

  // Une carte fermée est datée par son mouvement, pas par `updated_at` : la carte a été
  // touchée à l'instant, et sa ligne reste à l'heure où elle est passée en « fait ».
  const closed = find(journal, 'cardClosed')
  assert.equal(closed.at, now - 2 * 3600_000)
  assert.equal(closed.count, 1, 'une session rattachée')

  const shot = find(journal, 'run')
  assert.equal(shot.title, 'Veille des CLI — Claude Code 2.1.4 disponible')
  assert.equal(shot.status, 'succeeded')

  for (const entry of journal.entries) {
    assert.ok(JOURNAL_FAMILY_OF[entry.kind], `${entry.kind} appartient à une famille`)
  }
})

test('la fenêtre borne la lecture, et seul ce qui tombe dedans sort', async (t) => {
  const { db, read } = await harness(t)
  const now = Date.now()

  for (const [id, number, age] of [
    ['recent', 1, 2],
    ['vieille', 2, 40],
  ] as const) {
    db.insert(cards)
      .values({
        id,
        projectId: 'project',
        number,
        title: id,
        column: 'todo',
        createdBy: 'owner',
        createdAt: now - age * DAY,
        updatedAt: now,
      })
      .run()
  }

  assert.deepEqual(
    (await read()).entries.map((entry) => entry.title),
    ['recent'],
  )
  assert.deepEqual(
    (await read('/api/projects/project/journal?days=60')).entries.map((entry) => entry.title),
    ['recent', 'vieille'],
  )

  const refused = await (await harness(t)).app.inject({
    method: 'GET',
    url: '/api/projects/project/journal?days=400',
  })
  assert.equal(refused.statusCode, 400, 'au-delà de la borne, la route refuse')
})

test('une fusion de branche devient une ligne, avec ses commits et sa carte', async (t) => {
  const { db, repo, read } = await harness(t)
  const now = Date.now()

  const git = (...args: string[]) => run('git', args, { cwd: repo })
  await git('init', '-b', 'main')
  await git('config', 'user.email', 'test@solera')
  await git('config', 'user.name', 'Test')
  await writeFile(join(repo, 'a.txt'), 'a')
  await git('add', '.')
  await git('commit', '-m', 'socle')
  await git('checkout', '-b', 'feat/journal')
  await writeFile(join(repo, 'b.txt'), 'b')
  await git('add', '.')
  await git('commit', '-m', 'un apport')
  await git('checkout', 'main')
  await git('merge', '--no-ff', 'feat/journal', '-m', "Merge branch 'feat/journal'")

  // Le worktree porte le nom de la branche, et la session qui y a travaillé sa carte :
  // c'est par là, et par là seulement, qu'une fusion retrouve un numéro.
  db.insert(cards)
    .values({
      id: 'card',
      projectId: 'project',
      number: 33,
      title: 'Porter le Journal',
      column: 'in_progress',
      createdBy: 'owner',
      createdAt: now - 60 * DAY,
      updatedAt: now,
    })
    .run()
  db.insert(worktrees)
    .values({
      id: 'wt',
      projectId: 'project',
      name: 'feat/journal',
      path: join(repo, '..', 'wt'),
      baseRef: 'main',
      createdBy: 'owner',
      createdAt: now - 60 * DAY,
    })
    .run()
  db.insert(conversations)
    .values({
      id: 'session',
      projectId: 'project',
      worktreeId: 'wt',
      cardId: 'card',
      userId: 'owner',
      title: 'Porter le Journal',
      agent: 'claude',
      config: '{}',
      status: 'idle',
      createdAt: now - 60 * DAY,
      updatedAt: now,
    })
    .run()

  const journal = await read()
  const branch = find(journal, 'branch')
  assert.equal(branch.title, 'feat/journal')
  assert.equal(branch.count, 1, 'un commit apporté')
  assert.equal(branch.cardNumber, 33)
  assert.equal(journal.repoIncomplete, false)
})

test('un audit versé est daté par le jour de son nom, et titré par son README', async (t) => {
  const { repo, read } = await harness(t)
  const today = new Date()
  const name = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}-bundle-web`

  await mkdir(join(repo, 'docs', 'audits', name), { recursive: true })
  await writeFile(join(repo, 'docs', 'audits', name, 'README.md'), '# le bundle frôle la limite\n')
  // Un audit d'il y a six mois ne doit pas sortir, même si son dossier vient d'être
  // réécrit par une suite de captures : c'est le nom qui date, pas le `mtime`.
  await mkdir(join(repo, 'docs', 'audits', '2024-01-02-vieux'), { recursive: true })

  const journal = await read()
  assert.deepEqual(
    journal.entries.map((entry) => entry.title),
    [`docs/audits/${name} — le bundle frôle la limite`],
  )
})

test('un projet sans dépôt git se dit incomplet, et rend quand même ses lignes de base', async (t) => {
  const { db, read } = await harness(t)
  db.insert(cards)
    .values({
      id: 'card',
      projectId: 'project',
      number: 1,
      title: 'Une carte',
      column: 'todo',
      createdBy: 'owner',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    .run()

  const journal = await read()
  assert.equal(journal.repoIncomplete, true)
  assert.deepEqual(kinds(journal), ['cardOpened'])
})

test('le portefeuille mêle les projets, et laisse dehors ceux qu’on a archivés', async (t) => {
  const { db, read } = await harness(t)
  const now = Date.now()

  db.insert(projects)
    .values({
      id: 'range',
      name: 'Rangé',
      workspacePath: join(tmpdir(), 'solera-journal-absent'),
      ownerId: 'owner',
      visibility: 'private',
      archivedAt: now,
      createdAt: 1,
    })
    .run()

  for (const [id, projectId, title] of [
    ['vivant', 'project', 'Une carte vivante'],
    ['range', 'range', 'Une carte rangée'],
  ] as const) {
    db.insert(cards)
      .values({
        id,
        projectId,
        number: 1,
        title,
        column: 'todo',
        createdBy: 'owner',
        createdAt: now,
        updatedAt: now,
      })
      .run()
  }

  const journal = await read('/api/journal')
  assert.deepEqual(
    journal.entries.map((entry) => entry.title),
    ['Une carte vivante'],
  )
  assert.equal(journal.entries[0]?.projectId, 'project')
})
