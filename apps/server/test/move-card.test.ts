import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { fileURLToPath } from 'node:url'
import { eq } from 'drizzle-orm'
import {
  agentRequests,
  cardMoves,
  cardNotes,
  cards,
  conversations,
  openDatabase,
  projects,
  runMigrations,
  users,
} from '@solera/db'
import { DEFAULT_CLAUDE_CONFIG, type CardColumn } from '@solera/protocol'
import type { AgentRegistry } from '../src/agents/registry.js'
import type { Config } from '../src/config.js'
import { EventLog } from '../src/events/event-log.js'
import type { SessionManager } from '../src/sessions/session-manager.js'
import { AgentRequests } from '../src/sessions/agent-requests.js'

/**
 * `move_card` : un agent range sa propre carte, sans clic, entre les colonnes qui disent
 * où en est le travail — et nulle part ailleurs (#86).
 */
async function harness(t: TestContext, column: CardColumn | null) {
  const dir = await mkdtemp(join(tmpdir(), 'solera-move-card-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const { db, sqlite } = openDatabase(join(dir, 'test.sqlite'))
  runMigrations(db, fileURLToPath(new URL('../../../packages/db/migrations', import.meta.url)))
  t.after(() => sqlite.close())

  db.insert(users).values({ id: 'owner', username: 'owner', displayName: 'owner', passwordHash: '', createdAt: 1 }).run()
  db.insert(projects)
    .values({ id: 'project', name: 'Test', workspacePath: dir, ownerId: 'owner', visibility: 'private', createdAt: 1 })
    .run()

  const insertCard = (number: number, at: CardColumn) => {
    const id = randomUUID()
    db.insert(cards)
      .values({
        id, projectId: 'project', number, title: `Carte ${number}`, description: '', column: at,
        position: number, createdBy: 'owner', createdAt: 1, updatedAt: 1,
      })
      .run()
    return id
  }
  const own = column ? insertCard(1, column) : null
  const other = insertCard(2, 'in_progress')

  db.insert(conversations)
    .values({
      id: 'session', projectId: 'project', userId: 'owner', title: 'Session', agent: 'claude',
      // Sans `cardFiling` : `move_card` est du socle, il ne doit rien devoir à cette famille.
      config: JSON.stringify(DEFAULT_CLAUDE_CONFIG), status: 'running', cardId: own,
      createdAt: 1, updatedAt: 1,
    })
    .run()

  const ctx = { db, config: { mcp: { cardFiling: false } } as unknown as Config }
  const sessions = { statusBus: new EventEmitter() } as unknown as SessionManager
  const requests = new AgentRequests(ctx, sessions, {} as AgentRegistry, new EventLog(db))

  /** Dépose l'appel comme le serveur MCP le fait, et laisse le daemon le traiter. */
  const move = async (payload: Record<string, unknown>) => {
    const id = randomUUID()
    db.insert(agentRequests)
      .values({
        id, projectId: 'project', conversationId: 'session', kind: 'move_card',
        payload: JSON.stringify(payload), createdAt: Date.now(),
      })
      .run()
    await requests.sweep()
    return db.select().from(agentRequests).where(eq(agentRequests.id, id)).get()!
  }
  const columnOf = (id: string) => db.select({ column: cards.column }).from(cards).where(eq(cards.id, id)).get()?.column

  return { db, own, other, move, columnOf }
}

test('la carte de la conversation passe en revue sans clic, tracée au nom de la session', async (t) => {
  const { db, own, move, columnOf } = await harness(t, 'in_progress')

  const row = await move({ column: 'review', reason: 'PR #34 ouverte.' })
  assert.equal(row.isError, false, row.result ?? '')
  assert.equal(columnOf(own!), 'review')

  // Le propriétaire pour qui le geste est fait, et la session qui l'a fait : c'est ce que
  // la migration ajoute, et ce qui distingue ce mouvement d'un glisser-déposer.
  const [moved] = db.select().from(cardMoves).all()
  assert.equal(moved?.fromColumn, 'in_progress')
  assert.equal(moved?.toColumn, 'review')
  assert.equal(moved?.userId, 'owner')
  assert.equal(moved?.conversationId, 'session')

  const [note] = db.select().from(cardNotes).all()
  assert.equal(note?.conversationId, 'session')
  assert.equal(note?.userId, null)
  assert.match(note?.body ?? '', /en cours.*à vérifier.*PR #34 ouverte/)

  // Et elle revient en cours si la relecture la renvoie au travail.
  assert.equal((await move({ column: 'in_progress' })).isError, false)
  assert.equal(columnOf(own!), 'in_progress')
})

test('terminé et abandonné restent des verdicts : ni vers eux, ni hors d’eux', async (t) => {
  for (const target of ['done', 'abandoned']) {
    const { db, own, move, columnOf } = await harness(t, 'review')
    const row = await move({ column: target })
    assert.equal(row.isError, true)
    assert.match(row.result ?? '', /request_card_move/)
    assert.equal(columnOf(own!), 'review')
    assert.deepEqual(db.select().from(cardMoves).all(), [])
  }

  for (const verdict of ['done', 'abandoned'] as const) {
    const { db, own, move, columnOf } = await harness(t, verdict)
    const row = await move({ column: 'in_progress' })
    assert.equal(row.isError, true)
    assert.equal(columnOf(own!), verdict)
    assert.deepEqual(db.select().from(cardMoves).all(), [])
  }
})

test('sans carte rattachée, il n’y a rien à déplacer — et jamais celle d’une autre session', async (t) => {
  const { db, other, move, columnOf } = await harness(t, null)
  // Un `number` glissé dans la charge n'y change rien : l'outil n'en a pas.
  const row = await move({ column: 'review', number: 2 })
  assert.equal(row.isError, true)
  assert.equal(columnOf(other), 'in_progress')
  assert.deepEqual(db.select().from(cardMoves).all(), [])
})

test('une carte déjà dans la colonne ne laisse ni mouvement ni note', async (t) => {
  const { db, move } = await harness(t, 'review')
  const row = await move({ column: 'review' })
  assert.equal(row.isError, false)
  assert.match(row.result ?? '', /déjà/)
  assert.deepEqual(db.select().from(cardMoves).all(), [])
  assert.deepEqual(db.select().from(cardNotes).all(), [])
})
