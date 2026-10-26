import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { fileURLToPath } from 'node:url'
import Fastify from 'fastify'
import { asc, eq } from 'drizzle-orm'
import {
  agentRequests,
  cardBlocks,
  cardMoves,
  cards,
  events,
  conversations,
  openDatabase,
  projects,
  runMigrations,
  users,
} from '@solera/db'
import { DEFAULT_CLAUDE_CONFIG } from '@solera/protocol'
import type { AgentRegistry } from '../src/agents/registry.js'
import type { AttachmentStore } from '../src/attachments/store.js'
import type { Config } from '../src/config.js'
import { EventLog } from '../src/events/event-log.js'
import { registerErrorHandler } from '../src/http/errors.js'
import { registerConversationRoutes } from '../src/http/routes/conversations.js'
import type { SessionManager } from '../src/sessions/session-manager.js'
import { AgentRequests } from '../src/sessions/agent-requests.js'
import type { WebhookService } from '../src/webhooks/service.js'

/**
 * Le rangement de carte par un agent, de la proposition au `card_moves` écrit.
 *
 * Testé de bout en bout parce que c'est un chemin qui traverse trois endroits — le
 * daemon qui valide et dépose, le journal qui porte la demande, la route qui applique —
 * et qu'aucun des trois n'est vrai sans les autres. Le quatrième chemin qui écrit
 * `card_moves` est ici : l'en-tête de cette table dit qu'un seul oublié la fait mentir.
 */
async function harness(t: TestContext, as: 'owner' | 'other' = 'owner') {
  const dir = await mkdtemp(join(tmpdir(), 'solera-card-filing-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const { db, sqlite } = openDatabase(join(dir, 'test.sqlite'))
  runMigrations(db, fileURLToPath(new URL('../../../packages/db/migrations', import.meta.url)))
  t.after(() => sqlite.close())

  for (const id of ['owner', 'other']) {
    db.insert(users).values({ id, username: id, displayName: id, passwordHash: '', createdAt: 1 }).run()
  }
  // Partagé : « other » voit le fil et peut donc appeler la route, mais ne possède pas le
  // board. C'est le cas que le contrôle de propriétaire de projet existe pour refuser.
  db.insert(projects)
    .values({ id: 'project', name: 'Test', workspacePath: dir, ownerId: 'owner', visibility: 'shared', createdAt: 1 })
    .run()
  db.insert(conversations)
    .values({
      id: 'session', projectId: 'project', userId: 'owner', title: 'Session', agent: 'claude',
      // Configuration complète : `parseAgentConfig` valide strictement, une forme
      // partielle lèverait une erreur Zod que le daemon rendrait comme un refus.
      config: JSON.stringify({ ...DEFAULT_CLAUDE_CONFIG, cardFiling: true }), status: 'running',
      createdAt: 1, updatedAt: 1,
    })
    .run()

  let next = 1
  const card = (title: string, column: 'todo' | 'in_progress' | 'review' | 'done' | 'abandoned') => {
    const id = randomUUID()
    const number = next++
    db.insert(cards)
      .values({
        id, projectId: 'project', number, title, description: '', column,
        position: number, createdBy: 'owner', createdAt: 1, updatedAt: 1,
      })
      .run()
    return { id, number }
  }

  const log = new EventLog(db)
  const ctx = { db, config: { mcp: { cardFiling: true } } as unknown as Config }
  const sessions = { statusBus: new EventEmitter() } as unknown as SessionManager
  const requests = new AgentRequests(ctx, sessions, {} as AgentRegistry, log)

  const app = Fastify()
  app.addHook('preHandler', async (request) => {
    request.user = db.select().from(users).where(eq(users.id, as)).get()
  })
  registerErrorHandler(app)
  registerConversationRoutes(
    app, ctx, log, sessions,
    {} as AgentRegistry, {} as AttachmentStore, {} as WebhookService,
  )
  t.after(() => app.close())

  /** Dépose une demande comme le serveur MCP le fait, et laisse le daemon la traiter. */
  const propose = async (moves: Record<string, unknown>[]) => {
    const id = randomUUID()
    db.insert(agentRequests)
      .values({
        id, projectId: 'project', conversationId: 'session', kind: 'request_card_change',
        payload: JSON.stringify({ changes: moves }), createdAt: Date.now(),
      })
      .run()
    await requests.sweep()
    return { id, row: db.select().from(agentRequests).where(eq(agentRequests.id, id)).get()! }
  }

  const decide = (requestId: string, decision: 'accepted' | 'refused') =>
    app.inject({
      method: 'POST',
      url: `/api/conversations/session/card-filings/${requestId}`,
      payload: { decision },
    })

  const moves = () => db.select().from(cardMoves).orderBy(asc(cardMoves.movedAt), asc(cardMoves.id)).all()
  const columnOf = (id: string) => db.select({ column: cards.column }).from(cards).where(eq(cards.id, id)).get()?.column

  return { db, log, card, propose, decide, moves, columnOf }
}

test('une demande portant plusieurs cartes s’applique en une transaction, une ligne card_moves par carte', async (t) => {
  const { card, propose, decide, moves, columnOf } = await harness(t)
  const done = card('PR fusionnée et publiée', 'in_progress')
  const dropped = card('La grille outil × portée', 'todo')
  const late = card('Restée à faire alors qu’une session y travaille', 'todo')

  const { id, row } = await propose([
    { card: done.number, column: 'done', reason: 'Fusionnée dans main et publiée.' },
    { card: dropped.number, column: 'abandoned', reason: 'Le grill a arrêté quatre familles fixes.' },
    { card: late.number, column: 'in_progress', reason: 'Deux sessions y travaillent depuis ce matin.' },
  ])
  assert.equal(row.isError, false, row.result ?? '')
  // Déposée, pas appliquée : rien n'a bougé avant le clic, et c'est tout le motif.
  assert.deepEqual(moves(), [])
  assert.equal(columnOf(done.id), 'in_progress')

  const response = await decide(id, 'accepted')
  assert.equal(response.statusCode, 200, response.body)

  // Une ligne par carte, et toutes au même instant : c'est la marque de la transaction
  // unique. Un lot à moitié écrit ferait raconter au Journal des mouvements qui n'ont
  // pas tous eu lieu.
  const written = moves()
  assert.equal(written.length, 3)
  assert.equal(new Set(written.map((move) => move.movedAt)).size, 1)
  assert.deepEqual(
    written.map((move) => [move.fromColumn, move.toColumn]).sort(),
    [['in_progress', 'done'], ['todo', 'abandoned'], ['todo', 'in_progress']].sort(),
  )
  // L'userId est celui qui a cliqué, jamais la session qui a proposé : le mouvement est
  // attribué à la personne, et c'est le fond de la décision.
  assert.deepEqual([...new Set(written.map((move) => move.userId))], ['owner'])

  assert.equal(columnOf(done.id), 'done')
  assert.equal(columnOf(dropped.id), 'abandoned')
  assert.equal(columnOf(late.id), 'in_progress')

  // `abandoned` est permise comme le reste : le tabou visait l'acte, pas la proposition.
  assert.ok(written.some((move) => move.toColumn === 'abandoned'))
})

test('une seconde demande de la même conversation est refusée tant que la première attend', async (t) => {
  const { card, propose, decide, moves } = await harness(t)
  const first = card('Première', 'todo')
  const second = card('Seconde', 'todo')

  const one = await propose([{ card: first.number, column: 'done', reason: 'Finie hier.' }])
  assert.equal(one.row.isError, false, one.row.result ?? '')

  const two = await propose([{ card: second.number, column: 'done', reason: 'Finie aussi.' }])
  assert.equal(two.row.isError, true)
  assert.match(two.row.result ?? '', /déjà une proposition de changement de carte en attente/)

  // Et la demande refusée d'entrée ne tient pas la place : `resolved_at` est posé, sinon
  // la conversation ne pourrait plus jamais rien proposer.
  assert.notEqual(two.row.resolvedAt, null)

  // La première répondue, la place se libère.
  assert.equal((await decide(one.id, 'refused')).statusCode, 200)
  assert.deepEqual(moves(), [])
  const three = await propose([{ card: second.number, column: 'done', reason: 'Finie aussi.' }])
  assert.equal(three.row.isError, false, three.row.result ?? '')
})

test('une raison manquante est refusée, et c’est le seul champ qu’on refuse sans regarder la carte', async (t) => {
  const { card, propose } = await harness(t)
  const one = card('Une carte', 'todo')

  const blank = await propose([{ card: one.number, column: 'done', reason: '   ' }])
  assert.equal(blank.row.isError, true)
  assert.match(blank.row.result ?? '', /reason` est requis/)

  // Et la même carte deux fois : deux mouvements contradictoires dans la transaction,
  // dont l'utilisateur ne saurait pas lequel il accorde.
  const twice = await propose([
    { card: one.number, column: 'done', reason: 'Finie.' },
    { card: one.number, column: 'abandoned', reason: 'Ou pas.' },
  ])
  assert.equal(twice.row.isError, true)
  assert.match(twice.row.result ?? '', /apparaît deux fois/)
})

test('seul le propriétaire du projet range le board, pas celui du fil', async (t) => {
  const { card, propose, decide, moves } = await harness(t, 'other')
  const one = card('Une carte', 'todo')
  const { id } = await propose([{ card: one.number, column: 'done', reason: 'Finie hier.' }])

  // « other » voit le fil — le projet est partagé — et peut donc appeler la route. C'est
  // le board qu'on range, et il ne lui appartient pas.
  const refused = await decide(id, 'accepted')
  assert.equal(refused.statusCode, 403, refused.body)
  assert.equal(refused.json().error.code, 'card_filing_forbidden')
  assert.deepEqual(moves(), [])

  // Et le droit passe avant l'existence : un `requestId` inventé rend le même 403, sinon
  // un membre non propriétaire distinguerait une demande qui existe d'une qui n'existe
  // pas.
  const unknown = await decide('00000000-0000-4000-8000-000000000000', 'accepted')
  assert.equal(unknown.statusCode, 403, unknown.body)
  assert.equal(unknown.json().error.code, 'card_filing_forbidden')
})

test('revérifié au clic : toute carte qui a bougé depuis le dépôt sort du lot', async (t) => {
  const { db, card, propose, decide, moves, columnOf } = await harness(t)
  const arrived = card('Rangée à la main là où on la voulait', 'todo')
  const elsewhere = card('Rangée à la main ailleurs', 'todo')
  const still = card('Toujours là', 'todo')
  const { id } = await propose([
    { card: arrived.number, column: 'done', reason: 'Finie hier.' },
    { card: elsewhere.number, column: 'done', reason: 'Finie aussi.' },
    { card: still.number, column: 'review', reason: 'À relire.' },
  ])

  // Entre le dépôt et le clic, une personne range les deux premières elle-même : l'une
  // là où l'agent la voulait, l'autre dans une *troisième* colonne.
  db.update(cards).set({ column: 'done' }).where(eq(cards.id, arrived.id)).run()
  db.update(cards).set({ column: 'abandoned' }).where(eq(cards.id, elsewhere.id)).run()

  assert.equal((await decide(id, 'accepted')).statusCode, 200)

  // Le test porte sur la colonne de départ, pas sur la colonne visée : sans ça, la
  // seconde carte serait poussée vers `done` et le clic défairait un choix humain plus
  // récent que la proposition. C'est ce que la famille existe pour empêcher.
  const written = moves()
  assert.equal(written.length, 1)
  assert.equal(written[0]!.cardId, still.id)
  assert.equal(written[0]!.fromColumn, 'todo')
  assert.equal(columnOf(elsewhere.id), 'abandoned')
  assert.equal(columnOf(arrived.id), 'done')
})

test('toutes les cartes déplacées depuis le dépôt : la demande se résout sans rien faire', async (t) => {
  const { db, card, propose, decide, moves } = await harness(t)
  const one = card('Une carte', 'todo')
  const { id } = await propose([{ card: one.number, column: 'done', reason: 'Finie hier.' }])
  db.update(cards).set({ column: 'review' }).where(eq(cards.id, one.id)).run()

  const stale = await decide(id, 'accepted')
  assert.equal(stale.statusCode, 400, stale.body)
  assert.equal(stale.json().error.code, 'card_filing_stale')
  assert.deepEqual(moves(), [])

  // L'écriture est conservée malgré le 400 : la demande ne doit pas continuer d'occuper
  // la place de l'unique demande en attente de la conversation.
  const next = await propose([{ card: one.number, column: 'done', reason: 'Toujours finie.' }])
  assert.equal(next.row.isError, false, next.row.result ?? '')
})

test('la famille refusée refuse la demande, la base restant l’autorité', async (t) => {
  const { db, card, propose } = await harness(t)
  const one = card('Une carte', 'todo')

  // Le serveur MCP ne liste pas l'outil dans ce cas, mais le daemon revérifie : le
  // `.mjs` n'est qu'un process lancé par le CLI.
  db.update(conversations)
    .set({ config: JSON.stringify({ ...DEFAULT_CLAUDE_CONFIG, cardFiling: false }) })
    .where(eq(conversations.id, 'session'))
    .run()

  const refused = await propose([{ card: one.number, column: 'done', reason: 'Finie hier.' }])
  assert.equal(refused.row.isError, true)
  assert.match(refused.row.result ?? '', /est interdit à cette conversation/)
})

/** Le dernier `card_filing.resolved` du fil, tel que l'interface le relira. */
function resolved(db: ReturnType<typeof openDatabase>['db']) {
  const rows = db.select().from(events).where(eq(events.type, 'card_filing.resolved')).all()
  return JSON.parse(rows.at(-1)!.payload) as { decision: string; moved: unknown[]; applied?: number[] }
}

test('au-delà de la colonne : parente, échéance et blocages se proposent, et s’appliquent au clic (#66)', async (t) => {
  const { db, card, propose, decide, moves } = await harness(t)
  const milestone = card('Le jalon', 'todo')
  const step = card('Une étape', 'todo')
  const next = card('La suite', 'todo')
  const freed = card('Bloquée pour rien', 'todo')
  db.insert(cardBlocks).values({ sourceId: next.id, targetId: freed.id, createdBy: 'owner', createdAt: 1 }).run()

  const { id, row } = await propose([
    { card: step.number, parent: milestone.number, due: '2026-11-15', blocks: [next.number], reason: 'Le jalon la liste dans son tableau.' },
    { card: next.number, unblocks: [freed.number], reason: 'La dépendance a été levée par #2.' },
  ])
  assert.equal(row.isError, false, row.result ?? '')
  assert.match(row.result ?? '', /sous #1, échéance .*, bloque #3/)

  // Rien ne change avant le clic.
  const before = db.select().from(cards).where(eq(cards.id, step.id)).get()!
  assert.equal(before.parentId, null)
  assert.equal(before.dueAt, null)

  assert.equal((await decide(id, 'accepted')).statusCode, 200)
  const after = db.select().from(cards).where(eq(cards.id, step.id)).get()!
  assert.equal(after.parentId, milestone.id)
  assert.equal(after.dueAt, new Date(2026, 10, 15).getTime())
  const links = db.select().from(cardBlocks).all()
  assert.deepEqual(
    links.map((link) => [link.sourceId, link.targetId, link.createdBy]),
    [[step.id, next.id, 'owner']],
  )
  // Aucune colonne demandée, aucun mouvement inventé ; mais les deux cartes sont dites
  // appliquées.
  assert.deepEqual(moves(), [])
  assert.deepEqual(resolved(db).applied, [step.number, next.number])
})

test('au clic, une carte dont l’échéance ou la parente a changé depuis le dépôt sort du lot', async (t) => {
  const { db, card, propose, decide } = await harness(t)
  const milestone = card('Le jalon', 'todo')
  const dated = card('Datée à la main entre-temps', 'todo')
  const kept = card('Inchangée', 'todo')
  const { id } = await propose([
    { card: dated.number, due: '2026-12-01', reason: 'Le jalon tombe le 1er.' },
    { card: kept.number, parent: milestone.number, reason: 'Une étape du jalon.' },
  ])

  const chosen = new Date(2026, 10, 20).getTime()
  db.update(cards).set({ dueAt: chosen }).where(eq(cards.id, dated.id)).run()

  assert.equal((await decide(id, 'accepted')).statusCode, 200)
  assert.equal(db.select().from(cards).where(eq(cards.id, dated.id)).get()?.dueAt, chosen)
  assert.equal(db.select().from(cards).where(eq(cards.id, kept.id)).get()?.parentId, milestone.id)
  assert.deepEqual(resolved(db).applied, [kept.number])
})

test('au dépôt : une ligne sans changement, une boucle de parentes ou un lien déjà posé sont refusés', async (t) => {
  const { db, card, propose } = await harness(t)
  const top = card('En haut', 'todo')
  const below = card('En dessous', 'todo')
  db.update(cards).set({ parentId: top.id }).where(eq(cards.id, below.id)).run()
  db.insert(cardBlocks).values({ sourceId: top.id, targetId: below.id, createdBy: 'owner', createdAt: 1 }).run()

  const empty = await propose([{ card: top.number, reason: 'Pour voir.' }])
  assert.match(empty.row.result ?? '', /Rien à changer pour #1/)

  const loop = await propose([{ card: top.number, parent: below.number, reason: 'À l’envers.' }])
  assert.match(loop.row.result ?? '', /ne peut pas devenir la parente/)

  const twice = await propose([{ card: top.number, blocks: [below.number], reason: 'Encore.' }])
  assert.match(twice.row.result ?? '', /bloque déjà/)

  const reverse = await propose([{ card: below.number, blocks: [top.number], reason: 'Dans l’autre sens.' }])
  assert.match(reverse.row.result ?? '', /se bloqueraient/)

  // 0 détache, et une échéance vide s'enlève : les sentinelles des schémas d'outils.
  const detach = await propose([{ card: below.number, parent: 0, reason: 'Elle vit seule.' }])
  assert.equal(detach.row.isError, false, detach.row.result ?? '')
  assert.match(detach.row.result ?? '', /détachée de sa parente/)
})
