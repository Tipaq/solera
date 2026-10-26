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
  cards,
  conversations,
  openDatabase,
  projects,
  runMigrations,
  sessionMessages,
  users,
} from '@solera/db'
import { DEFAULT_CLAUDE_CONFIG, parseAgentConfig, type AgentRequestPolicy } from '@solera/protocol'
import type { AgentRegistry } from '../src/agents/registry.js'
import type { Config } from '../src/config.js'
import { Decisions } from '../src/decisions/decisions.js'
import { EventLog } from '../src/events/event-log.js'
import { AgentRequests } from '../src/sessions/agent-requests.js'
import { pendingRequests } from '../src/sessions/request-lifecycle.js'
import type { SessionManager } from '../src/sessions/session-manager.js'

/**
 * Les trois états d'une demande à Solera (#120, Q12) : « Interdit » refuse, « Demande mon
 * accord » dépose et attend un clic, « Automatique » applique dès le dépôt, au nom de la
 * personne qui l'a réglé, en laissant une ligne dans le fil et rien dans la section.
 */

type Policies = Partial<Record<'cardFiling' | 'proposeCards' | 'projectFiling' | 'decisions', AgentRequestPolicy>>

async function harness(t: TestContext, policies: Policies, owner = 'owner') {
  const dir = await mkdtemp(join(tmpdir(), 'solera-request-automatic-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const { db, sqlite } = openDatabase(join(dir, 'test.sqlite'))
  runMigrations(db, fileURLToPath(new URL('../../../packages/db/migrations', import.meta.url)))
  t.after(() => sqlite.close())

  for (const id of ['owner', 'other']) {
    db.insert(users).values({ id, username: id, displayName: id, passwordHash: '', createdAt: 1 }).run()
  }
  for (const id of ['project', 'destination']) {
    db.insert(projects)
      .values({ id, name: id, workspacePath: join(dir, id), ownerId: 'owner', visibility: 'shared', createdAt: 1 })
      .run()
  }
  db.insert(conversations)
    .values({
      id: 'session', projectId: 'project', userId: owner, title: 'Session', agent: 'claude',
      config: JSON.stringify({ ...DEFAULT_CLAUDE_CONFIG, ...policies }), status: 'running',
      createdAt: 1, updatedAt: 1,
    })
    .run()

  let next = 1
  const card = (title: string) => {
    const id = randomUUID()
    const number = next++
    db.insert(cards)
      .values({ id, projectId: 'project', number, title, description: '', column: 'todo', position: number, createdBy: 'owner', createdAt: 1, updatedAt: 1 })
      .run()
    return { id, number }
  }

  const log = new EventLog(db)
  const config = {
    mcp: { cardFiling: true, projectFiling: true, decisions: true },
    paths: { threads: join(dir, 'threads'), worktrees: join(dir, 'worktrees') },
  } as unknown as Config
  const ctx = { db, config }
  const statusBus = new EventEmitter()
  const sessions = { statusBus, isBusy: () => true } as unknown as SessionManager
  const decisions = new Decisions(ctx, log, statusBus)
  const requests = new AgentRequests(ctx, sessions, {} as AgentRegistry, log, decisions)

  const deposit = async (kind: string, payload: Record<string, unknown>) => {
    const id = randomUUID()
    db.insert(agentRequests)
      .values({ id, projectId: 'project', conversationId: 'session', kind: kind as never, payload: JSON.stringify(payload), createdAt: Date.now() })
      .run()
    await requests.sweep()
    return db.select().from(agentRequests).where(eq(agentRequests.id, id)).get()!
  }
  const journal = () => log.read('session', 0, 1000).map((entry) => entry.event)

  return { db, card, deposit, journal, awaiting: () => decisions.awaiting('owner') }
}

test('« Automatique » applique un changement de carte au dépôt, au nom du propriétaire', async (t) => {
  const { db, card, deposit, journal } = await harness(t, { cardFiling: 'auto' })
  const one = card('Finie')
  const row = await deposit('request_card_change', { changes: [{ card: one.number, column: 'review', reason: 'PR ouverte.' }] })

  assert.equal(row.isError, false, row.result ?? '')
  assert.match(row.result ?? '', /appliqué d'office/)
  assert.notEqual(row.resolvedAt, null)
  assert.equal(db.select().from(cards).where(eq(cards.id, one.id)).get()?.column, 'review')
  assert.deepEqual(db.select({ userId: cardMoves.userId }).from(cardMoves).all(), [{ userId: 'owner' }])

  // Une ligne dans le fil, marquée ; rien dans la section, et pas de message de relance.
  const resolved = journal().find((event) => event.type === 'card_filing.resolved')
  assert.ok(resolved && resolved.type === 'card_filing.resolved')
  assert.equal(resolved.automatic, true)
  assert.equal(pendingRequests(db, ['session']).size, 0)
  assert.equal(db.select().from(sessionMessages).all().length, 0)
})

test('« Demande mon accord » dépose sans rien changer, « Interdit » refuse', async (t) => {
  const asking = await harness(t, { cardFiling: 'ask' })
  const one = asking.card('À ranger')
  const row = await asking.deposit('request_card_change', { changes: [{ card: one.number, column: 'review', reason: 'PR ouverte.' }] })
  assert.equal(row.isError, false, row.result ?? '')
  assert.equal(row.resolvedAt, null)
  assert.equal(asking.db.select().from(cards).where(eq(cards.id, one.id)).get()?.column, 'todo')
  assert.equal(pendingRequests(asking.db, ['session']).get('session')?.cardChange, 1)

  const denied = await harness(t, { cardFiling: 'deny', proposeCards: 'deny' })
  const two = denied.card('Intouchable')
  const refused = await denied.deposit('request_card_change', { changes: [{ card: two.number, column: 'review', reason: 'PR ouverte.' }] })
  assert.equal(refused.isError, true)
  assert.match(refused.result ?? '', /interdit/)
  const draft = await denied.deposit('propose_cards', { cards: [{ title: 'Une carte' }] })
  assert.equal(draft.isError, true)
  assert.match(draft.result ?? '', /interdits/)
})

test('« Automatique » n’agit qu’au nom de qui l’a réglé : un fil d’un autre membre attend le clic', async (t) => {
  const { db, card, deposit } = await harness(t, { cardFiling: 'auto' }, 'other')
  const one = card('Board du propriétaire')
  const row = await deposit('request_card_change', { changes: [{ card: one.number, column: 'review', reason: 'PR ouverte.' }] })
  assert.equal(row.isError, false, row.result ?? '')
  assert.equal(row.resolvedAt, null)
  assert.equal(db.select().from(cards).where(eq(cards.id, one.id)).get()?.column, 'todo')
})

test('« Automatique » crée le brouillon de cartes tel que l’agent l’a déposé', async (t) => {
  const { db, deposit, journal } = await harness(t, { proposeCards: 'auto' })
  const row = await deposit('propose_cards', { cards: [{ title: 'Première' }, { title: 'Seconde' }] })
  assert.equal(row.isError, false, row.result ?? '')
  assert.match(row.result ?? '', /Cartes créées d'office/)
  assert.deepEqual(db.select({ title: cards.title }).from(cards).all().map((entry) => entry.title).sort(), ['Première', 'Seconde'])
  const resolved = journal().find((event) => event.type === 'card_draft.resolved')
  assert.ok(resolved && resolved.type === 'card_draft.resolved' && resolved.automatic === true)
  // Le retour de l'outil donne les numéros : pas de message qui relancerait la session.
  assert.equal(db.select().from(sessionMessages).all().length, 0)
})

test('« Automatique » accorde un rangement, que le balayage appliquera à la fin du tour', async (t) => {
  const { db, deposit, journal, awaiting } = await harness(t, { projectFiling: 'auto' })
  const row = await deposit('move_conversation', { project: 'destination' })
  assert.equal(row.isError, false, row.result ?? '')
  assert.match(row.result ?? '', /accordé d'office/)
  assert.notEqual(row.acceptedAt, null)
  const requested = journal().find((event) => event.type === 'filing.requested')
  assert.ok(requested && requested.type === 'filing.requested' && requested.automatic === true)
  // Accordé, il n'attend plus personne : la section ne le montre pas. L'avertissement
  // d'archivage le compte encore, le déplacement n'ayant pas eu lieu.
  assert.deepEqual(awaiting(), [])
  assert.equal(pendingRequests(db, ['session']).get('session')?.move, 1)
})

test('une décision en « Automatique » retient l’option par défaut sans solliciter personne', async (t) => {
  const { db, deposit, journal } = await harness(t, { decisions: 'auto' })
  const row = await deposit('request_decision', { question: 'On garde l’ancienne API ?', options: ['oui', 'non'], default: 'non' })
  assert.equal(row.isError, false, row.result ?? '')
  assert.match(row.result ?? '', /« non », est retenue/)
  assert.notEqual(row.resolvedAt, null)
  const resolved = journal().find((event) => event.type === 'decision.resolved')
  assert.ok(resolved && resolved.type === 'decision.resolved')
  assert.equal(resolved.by, 'default')
  assert.equal(resolved.option, 'non')
  assert.equal(resolved.automatic, true)
  assert.equal(db.select().from(sessionMessages).all().length, 0)

  // Sans défaut, rien n'est choisi à sa place.
  const second = await deposit('request_decision', { question: 'Quel nom ?', options: ['a', 'b'] })
  assert.match(second.result ?? '', /Décide selon tes instructions/)
})

test('les booléens d’avant se relisent : vrai demande l’accord, faux interdit', () => {
  const config = parseAgentConfig(JSON.stringify({ ...DEFAULT_CLAUDE_CONFIG, cardFiling: true, projectFiling: false, decisions: true }))
  assert.equal(config.cardFiling, 'ask')
  assert.equal(config.projectFiling, 'deny')
  assert.equal(config.decisions, 'ask')
  // Absent d'une configuration d'avant #120 : la valeur par défaut, « Demande mon accord ».
  const { proposeCards: _absent, ...rest } = DEFAULT_CLAUDE_CONFIG
  assert.equal(parseAgentConfig(JSON.stringify(rest)).proposeCards, 'ask')
})
