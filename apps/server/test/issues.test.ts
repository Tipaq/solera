import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { fileURLToPath } from 'node:url'
import { eq } from 'drizzle-orm'
import {
  cardIssues,
  cards,
  conversations,
  issueSources,
  openDatabase,
  projects,
  runMigrations,
  sessionMessages,
  users,
} from '@solera/db'
import { DEFAULT_CLAUDE_CONFIG, qualifyIssueReferences, type CardColumn } from '@solera/protocol'
import { recordCardMove } from '../src/cards/moves.js'
import { IssueAdapterError, type ExternalComment, type ExternalIssue, type IssueAdapter } from '../src/issues/adapter.js'
import { queueIssueRefusal } from '../src/issues/links.js'
import { IssueSources, REFUSAL_COMMENT } from '../src/issues/service.js'

/**
 * L'absorption des issues (#84) contre un outil simulé : ce qui entre, ce qui repart, et
 * ce qui est remis aux sessions. Aucun appel réseau.
 */
class FakeTracker implements IssueAdapter {
  readonly provider = 'github' as const
  issues: ExternalIssue[] = []
  newComments: ExternalComment[] = []
  subIssues = new Map<string, string[]>()
  writes: string[] = []
  fail = false

  async viewer() {
    return 'tim'
  }
  async changedSince(_repository: string, cursor: string | null) {
    return cursor ? this.issues.filter((issue) => issue.updatedAt >= cursor) : this.issues.filter((issue) => issue.state === 'open')
  }
  async commentsSince(_repository: string, cursor: string) {
    return this.newComments.filter((comment) => comment.createdAt > cursor)
  }
  async comments() {
    return []
  }
  async children(_repository: string, id: string) {
    return this.subIssues.get(id) ?? []
  }
  async close(repository: string, id: string, reason: string, _token?: string, comment?: string) {
    if (this.fail) throw new IssueAdapterError('403 Resource not accessible')
    this.writes.push(`${repository}#${id} close ${reason}${comment ? ` « ${comment} »` : ''}`)
  }
  async reopen(repository: string, id: string) {
    if (this.fail) throw new IssueAdapterError('403 Resource not accessible')
    this.writes.push(`${repository}#${id} reopen`)
  }
}

let clock = 0
const issue = (id: string, extra: Partial<ExternalIssue> = {}): ExternalIssue => ({
  id,
  url: `https://github.com/tipaq/solera/issues/${id}`,
  title: `Issue ${id}`,
  body: '',
  state: 'open',
  author: 'quelqu-un',
  updatedAt: `2026-10-25T10:00:${String(clock++ % 60).padStart(2, '0')}Z`,
  hasChildren: false,
  ...extra,
})

async function harness(t: TestContext) {
  const dir = await mkdtemp(join(tmpdir(), 'solera-issues-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const { db, sqlite } = openDatabase(join(dir, 'test.sqlite'))
  runMigrations(db, fileURLToPath(new URL('../../../packages/db/migrations', import.meta.url)))
  t.after(() => sqlite.close())

  db.insert(users).values({ id: 'owner', username: 'owner', displayName: 'owner', passwordHash: '', createdAt: 1 }).run()
  db.insert(projects)
    .values({ id: 'project', name: 'Test', workspacePath: dir, ownerId: 'owner', visibility: 'private', createdAt: 1 })
    .run()
  db.insert(issueSources)
    .values({ projectId: 'project', provider: 'github', repository: 'tipaq/solera', createdBy: 'owner', createdAt: 1 })
    .run()

  const tracker = new FakeTracker()
  const service = new IssueSources(db, { github: tracker })
  const poll = async () => {
    service.requestPoll('project')
    await service.sweep()
  }
  const cardOf = (externalId: string) => {
    const link = db.select().from(cardIssues).where(eq(cardIssues.externalId, externalId)).get()
    return link ? { link, card: db.select().from(cards).where(eq(cards.id, link.cardId)).get()! } : null
  }
  const move = (cardId: string, to: CardColumn) => {
    const card = db.select().from(cards).where(eq(cards.id, cardId)).get()!
    db.update(cards).set({ column: to }).where(eq(cards.id, cardId)).run()
    recordCardMove(db, { cardId, from: card.column, to, userId: 'owner' })
  }
  return { db, tracker, service, poll, cardOf, move }
}

test('les #12 d’une issue désignent des issues, pas des cartes', () => {
  assert.equal(
    qualifyIssueReferences('Voir #12 et (#3), pas a#4 ni x/y#5 ni ##6.', 'tipaq/solera'),
    'Voir tipaq/solera#12 et (tipaq/solera#3), pas a#4 ni x/y#5 ni ##6.',
  )
})

test('une issue ouverte entre en carte non acceptée dans « à faire », une fois', async (t) => {
  const { db, tracker, poll, cardOf } = await harness(t)
  tracker.issues = [issue('7', { title: 'Le bouton déborde', body: 'Comme dans #3.', author: 'ana' }), issue('8', { state: 'closed' })]

  await poll()
  const entered = cardOf('7')
  assert.ok(entered)
  assert.equal(entered.card.title, 'Le bouton déborde')
  assert.equal(entered.card.column, 'todo')
  assert.equal(entered.card.acceptedAt, null)
  assert.equal(entered.card.description, 'Comme dans tipaq/solera#3.\n\n*Issue [tipaq/solera#7](https://github.com/tipaq/solera/issues/7), ouverte par @ana.*')
  assert.equal(entered.link.state, 'open')
  // Une issue fermée inconnue n'a rien à faire au board.
  assert.equal(cardOf('8'), null)

  // Relue, ou retouchée dans l'outil, elle ne fait pas de seconde carte et ne réécrit pas la sienne.
  tracker.issues = [issue('7', { title: 'Autre titre' })]
  await poll()
  assert.equal(db.select().from(cards).all().length, 1)
  assert.equal(cardOf('7')!.card.title, 'Le bouton déborde')
  assert.equal(db.select().from(issueSources).get()!.error, null)
})

test('terminer, abandonner, refuser ou rouvrir une carte écrit l’état de son issue', async (t) => {
  const { db, tracker, service, poll, cardOf, move } = await harness(t)
  tracker.issues = [issue('1'), issue('2'), issue('3')]
  await poll()

  move(cardOf('1')!.card.id, 'done')
  move(cardOf('2')!.card.id, 'abandoned')
  // Le refus passe par la route : la carte part en abandonné, puis le mot est demandé.
  move(cardOf('3')!.card.id, 'abandoned')
  queueIssueRefusal(db, cardOf('3')!.card.id)
  assert.equal(cardOf('1')!.link.pending, 'completed')

  await service.sweep()
  assert.deepEqual(tracker.writes, [
    'tipaq/solera#1 close completed',
    'tipaq/solera#2 close not_planned',
    `tipaq/solera#3 close not_planned « ${REFUSAL_COMMENT} »`,
  ])
  assert.equal(cardOf('1')!.link.state, 'closed')
  assert.equal(cardOf('1')!.link.pending, null)

  // Rouverte dans le board, l'issue se rouvre.
  move(cardOf('1')!.card.id, 'todo')
  await service.sweep()
  assert.equal(tracker.writes.at(-1), 'tipaq/solera#1 reopen')
  assert.equal(cardOf('1')!.link.state, 'open')
})

test('un aller-retour avant le balayage n’écrit rien', async (t) => {
  const { tracker, service, poll, cardOf, move } = await harness(t)
  tracker.issues = [issue('1')]
  await poll()
  move(cardOf('1')!.card.id, 'done')
  move(cardOf('1')!.card.id, 'in_progress')
  assert.equal(cardOf('1')!.link.pending, null)
  await service.sweep()
  assert.deepEqual(tracker.writes, [])
})

test('une issue rouverte ramène sa carte dans « à faire » ; fermée de l’extérieur, elle ne la ferme pas', async (t) => {
  const { tracker, service, poll, cardOf, move } = await harness(t)
  tracker.issues = [issue('1'), issue('2')]
  await poll()
  move(cardOf('1')!.card.id, 'done')
  await service.sweep()

  tracker.issues = [issue('1', { state: 'open' }), issue('2', { state: 'closed' })]
  await poll()
  assert.equal(cardOf('1')!.card.column, 'todo')
  assert.equal(cardOf('1')!.link.state, 'open')
  // Le retour en « à faire » ne demande pas de rouvrir une issue déjà ouverte.
  assert.equal(cardOf('1')!.link.pending, null)

  assert.equal(cardOf('2')!.card.column, 'todo')
  assert.equal(cardOf('2')!.link.state, 'closed')
  // Terminée ensuite, la carte n'a rien à écrire : l'issue est déjà fermée.
  move(cardOf('2')!.card.id, 'done')
  assert.equal(cardOf('2')!.link.pending, null)
})

test('un refus de l’outil est gardé, et retenté plus tard', async (t) => {
  const { tracker, service, poll, cardOf, move } = await harness(t)
  tracker.issues = [issue('1')]
  await poll()
  move(cardOf('1')!.card.id, 'done')
  tracker.fail = true
  await service.sweep()
  assert.equal(cardOf('1')!.link.pending, 'completed')
  assert.match(cardOf('1')!.link.pushError ?? '', /403/)

  // Pas avant le délai : un outil qui refuse ne doit pas être relancé toutes les cinq secondes.
  tracker.fail = false
  await service.sweep()
  assert.deepEqual(tracker.writes, [])
  await service.sweep(Date.now() + 11 * 60_000)
  assert.deepEqual(tracker.writes, ['tipaq/solera#1 close completed'])
  assert.equal(cardOf('1')!.link.pushError, null)
})

test('un commentaire neuf est remis aux sessions en cours sur la carte, et à elles seules', async (t) => {
  const { db, tracker, poll, cardOf } = await harness(t)
  tracker.issues = [issue('1')]
  tracker.newComments = [
    { id: 'old', issueId: '1', author: 'ana', body: 'Ancien.', url: 'u', createdAt: '2020-01-01T00:00:00Z' },
  ]
  await poll()
  // Le premier passage ne remet pas l'arriéré.
  assert.equal(db.select().from(sessionMessages).all().length, 0)

  const cardId = cardOf('1')!.card.id
  for (const [id, status] of [['working', 'running'], ['asking', 'awaiting_input'], ['resting', 'idle']] as const) {
    db.insert(conversations)
      .values({
        id, projectId: 'project', userId: 'owner', title: id, agent: 'claude',
        config: JSON.stringify(DEFAULT_CLAUDE_CONFIG), status, cardId, createdAt: 1, updatedAt: 1,
      })
      .run()
  }
  tracker.newComments = [
    { id: 'c1', issueId: '1', author: 'ana', body: 'Ça déborde aussi sur mobile.', url: 'https://github.com/tipaq/solera/issues/1#c1', createdAt: '2999-01-01T00:00:00Z' },
    // Le sien, posté par une session avec le même jeton : il ne lui revient pas.
    { id: 'c2', issueId: '1', author: 'tim', body: 'Je regarde.', url: 'u', createdAt: '2999-01-01T00:00:01Z' },
    // Sur une issue que le board ne connaît pas.
    { id: 'c3', issueId: '99', author: 'ana', body: 'Ailleurs.', url: 'u', createdAt: '2999-01-01T00:00:02Z' },
  ]
  await poll()

  const delivered = db.select().from(sessionMessages).all()
  assert.deepEqual(delivered.map((message) => message.toConversationId).sort(), ['asking', 'working'])
  assert.ok(delivered.every((message) => message.kind === 'issue_comment'))
  assert.match(delivered[0]!.body, /^@ana a commenté l'issue tipaq\/solera#1 \(https:\/\/github\.com\/tipaq\/solera\/issues\/1#c1\) :\n\nÇa déborde aussi sur mobile\.$/)
  assert.equal(db.select().from(issueSources).get()!.commentsCursor, '2999-01-01T00:00:02Z')

  // Relu, le même commentaire n'est pas remis deux fois.
  await poll()
  assert.equal(db.select().from(sessionMessages).all().length, 2)
})

test('une sous-issue rattache sa carte à celle de la parente, tant que personne ne l’a triée', async (t) => {
  const { db, tracker, poll, cardOf } = await harness(t)
  tracker.issues = [issue('1', { hasChildren: true }), issue('2'), issue('3'), issue('4')]
  tracker.subIssues.set('1', ['2', '3'])
  await poll()
  const parent = cardOf('1')!.card

  assert.equal(cardOf('2')!.card.parentId, parent.id)
  assert.equal(cardOf('3')!.card.parentId, parent.id)

  // Acceptée et détachée par une personne, la carte reste où elle l'a mise ; une carte
  // encore à trier suit l'outil.
  tracker.subIssues.set('1', ['2', '3', '4'])
  db.update(cards).set({ parentId: null, acceptedAt: 1 }).where(eq(cards.id, cardOf('3')!.card.id)).run()
  tracker.issues = [issue('1', { hasChildren: true })]
  await poll()
  assert.equal(cardOf('3')!.card.parentId, null)
  assert.equal(cardOf('4')!.card.parentId, parent.id)
})

test('une lecture en échec est dite sur la source, et la suivante l’efface', async (t) => {
  const { db, tracker, poll } = await harness(t)
  tracker.changedSince = async () => {
    throw new IssueAdapterError('HTTP 404: Not Found')
  }
  await poll()
  assert.equal(db.select().from(issueSources).get()!.error, 'HTTP 404: Not Found')
  tracker.changedSince = async () => []
  await poll()
  assert.equal(db.select().from(issueSources).get()!.error, null)
})
