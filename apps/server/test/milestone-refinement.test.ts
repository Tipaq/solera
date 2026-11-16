import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { fileURLToPath } from 'node:url'
import Fastify from 'fastify'
import multipart from '@fastify/multipart'
import { eq } from 'drizzle-orm'
import { agentRequests, cards, conversations, openDatabase, projects, runMigrations, users } from '@solera/db'
import {
  DEFAULT_CLAUDE_CONFIG,
  refinementState,
  type AgentConfig,
  type CardDraft,
  type CardDto,
  type CardRefinementDetailDto,
  type CardRefinementDto,
  type ConversationDto,
} from '@solera/protocol'
import { projectOverview } from '../src/agents/overview.js'
import type { AgentRegistry } from '../src/agents/registry.js'
import { AttachmentStore } from '../src/attachments/store.js'
import type { Config } from '../src/config.js'
import { Environments } from '../src/environments/environments.js'
import { EventLog } from '../src/events/event-log.js'
import { registerErrorHandler } from '../src/http/errors.js'
import { registerCardRoutes } from '../src/http/routes/cards.js'
import { registerConversationRoutes } from '../src/http/routes/conversations.js'
import { registerRefinementRoutes } from '../src/http/routes/refinement.js'
import type { SessionManager } from '../src/sessions/session-manager.js'
import type { WebhookService } from '../src/webhooks/service.js'

const { refinePrompt } = await import('../../web/src/lib/refinement.js')

/**
 * La session d'affinage d'un jalon (#184) : une conversation `split` posée sur la carte
 * du jalon, avec son mode, dont la carte montre l'état et dont le brouillon se lit hors
 * du fil.
 *
 * Aucun CLI ne tourne : l'envoi du premier message est une doublure qui le retient, et
 * les demandes de l'agent sont posées en base et dans le journal comme le daemon les
 * aurait posées.
 */
async function harness(t: TestContext, as: 'owner' | 'stranger' = 'owner') {
  const dir = await mkdtemp(join(tmpdir(), 'solera-milestone-refinement-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const { db, sqlite } = openDatabase(join(dir, 'test.sqlite'))
  runMigrations(db, fileURLToPath(new URL('../../../packages/db/migrations', import.meta.url)))
  t.after(() => sqlite.close())

  for (const id of ['owner', 'stranger']) {
    db.insert(users).values({ id, username: id, displayName: id, passwordHash: '', createdAt: 1 }).run()
  }
  db.insert(projects)
    .values({ id: 'project', name: 'Test', workspacePath: dir, ownerId: 'owner', visibility: 'private', createdAt: 1 })
    .run()

  const card = (id: string, number: number, options: { parentId?: string; milestone?: boolean } = {}) =>
    db.insert(cards)
      .values({
        id, projectId: 'project', number, title: `Carte ${number}`, column: 'todo', parentId: options.parentId ?? null,
        milestone: options.milestone ?? false, acceptedAt: 1, createdBy: 'owner', createdAt: 1, updatedAt: 1,
      })
      .run()
  const session = (
    id: string,
    splitCardId: string | null,
    options: { createdAt?: number; archivedAt?: number; status?: 'idle' | 'running' | 'awaiting_input'; splitMode?: 'questions' | 'direct' | null; purpose?: 'split' | null } = {},
  ) =>
    db.insert(conversations)
      .values({
        id, projectId: 'project', userId: 'owner', title: `Session ${id}`, agent: 'claude', cardId: null,
        purpose: options.purpose === undefined ? 'split' : options.purpose, splitCardId,
        splitMode: options.splitMode === undefined ? 'questions' : options.splitMode,
        config: JSON.stringify(DEFAULT_CLAUDE_CONFIG), status: options.status ?? 'idle',
        archivedAt: options.archivedAt ?? null, createdAt: options.createdAt ?? 1, updatedAt: options.createdAt ?? 1,
      })
      .run()

  const log = new EventLog(db)
  const sent: { conversationId: string; text: string }[] = []
  const sessions = {
    statusBus: new EventEmitter(),
    resolveDefaults: async (config: AgentConfig) => config,
    environments: new Environments(db),
    sendMessage: async (conversationId: string, _clientMessageId: string, text: string) => {
      sent.push({ conversationId, text })
    },
  } as unknown as SessionManager
  const registry = { adapter: () => ({ resolveDefaults: async (config: AgentConfig) => config }) } as unknown as AgentRegistry
  const ctx = { db, config: {} as Config }

  const app = Fastify()
  await app.register(multipart)
  app.addHook('preHandler', async (request) => {
    request.user = db.select().from(users).where(eq(users.id, as)).get()
  })
  registerErrorHandler(app)
  registerConversationRoutes(app, ctx, log, sessions, registry, { claim: () => {} } as unknown as AttachmentStore, {} as WebhookService)
  registerCardRoutes(app, ctx, new AttachmentStore(db, join(dir, 'attachments')))
  registerRefinementRoutes(app, ctx, log)
  t.after(() => app.close())

  /** Une demande de l'agent déjà traitée par le daemon, et qui attend le clic. */
  const request = (conversationId: string, kind: 'propose_cards' | 'request_card_change', payload: unknown, settled = true) => {
    const id = randomUUID()
    db.insert(agentRequests)
      .values({
        id, projectId: 'project', conversationId, kind, payload: JSON.stringify(payload),
        createdAt: Date.now(), settledAt: settled ? Date.now() : null,
      })
      .run()
    return id
  }
  const createSession = (payload: Record<string, unknown>) =>
    app.inject({
      method: 'POST',
      url: '/api/projects/project/conversations',
      payload: { agent: 'claude', config: DEFAULT_CLAUDE_CONFIG, ...payload },
    })
  const cardOf = async (id: string): Promise<CardDto> =>
    ((await app.inject('/api/projects/project/cards')).json() as CardDto[]).find((card) => card.id === id)!
  const detail = async (id: string): Promise<CardRefinementDetailDto> => {
    const response = await app.inject(`/api/cards/${id}/refinement`)
    assert.equal(response.statusCode, 200, response.body)
    return response.json()
  }
  const briefing = (conversationId: string, cardFiling = true) =>
    projectOverview(db, { projectId: 'project', conversationId, soleraMcp: true, cardFiling }) ?? ''

  return { app, db, log, sent, card, session, request, createSession, cardOf, detail, briefing }
}

const DRAFT: CardDraft = {
  parent: { kind: 'existing', card: { cardId: 'milestone', number: 7, title: 'Carte 7' } },
  cards: [
    { key: 'a', title: 'Le serveur', description: '', subtasks: [], after: [], blockedBy: [], related: [] },
    { key: 'b', title: 'Le web', description: '', subtasks: ['La page'], after: ['a'], blockedBy: [], related: [] },
  ],
}

// --- Création -------------------------------------------------------------------------

test('« Découper directement » ouvre une session split rattachée au jalon, mode stocké et premier message envoyé', async (t) => {
  const h = await harness(t)
  const milestone = randomUUID()
  h.card(milestone, 7, { milestone: true })

  const text = refinePrompt({ number: 7, mode: 'direct', brief: 'Le brief du jalon.' })
  const response = await h.createSession({
    purpose: 'split', splitCardId: milestone, splitMode: 'direct',
    firstMessage: { clientMessageId: randomUUID(), text, attachmentIds: [], mentions: [], skills: [] },
  })
  assert.equal(response.statusCode, 201, response.body)
  const dto = response.json() as ConversationDto

  const row = h.db.select().from(conversations).where(eq(conversations.id, dto.id)).get()!
  assert.deepEqual([row.purpose, row.splitCardId, row.cardId, row.splitMode], ['split', milestone, null, 'direct'])
  assert.deepEqual(h.sent, [{ conversationId: dto.id, text }])
  // La session appartient à son jalon : l'étiquette « Jalon #7 » se pose dès la création.
  assert.deepEqual(dto.milestone, { id: milestone, number: 7, title: 'Carte 7' })
})

test('une session split sans mode part « questions d’abord » ; une autre n’a pas de mode, et n’en accepte pas', async (t) => {
  const h = await harness(t)
  const milestone = randomUUID()
  h.card(milestone, 7, { milestone: true })

  const split = await h.createSession({ purpose: 'split', splitCardId: milestone })
  assert.equal(split.statusCode, 201, split.body)
  const plain = await h.createSession({})
  assert.equal(plain.statusCode, 201, plain.body)
  const modeOf = (id: string) => h.db.select().from(conversations).where(eq(conversations.id, id)).get()!.splitMode
  assert.equal(modeOf(split.json().id), 'questions')
  assert.equal(modeOf(plain.json().id), null)

  const refused = await h.createSession({ splitMode: 'direct' })
  assert.equal(refused.statusCode, 400, refused.body)
  assert.equal(refused.json().error.code, 'split_mode_without_purpose')
})

test('le premier message invoque le skill avec le numéro, le drapeau de découpage direct et le brief', () => {
  assert.equal(refinePrompt({ number: 7, mode: 'questions', brief: '' }), '/affiner-un-jalon #7')
  assert.equal(refinePrompt({ number: 7, mode: 'direct', brief: '  Le brief.  ' }), '/affiner-un-jalon #7 --decouper\n\nLe brief.')
  assert.equal(
    refinePrompt({
      number: 7, mode: 'questions', brief: 'Le brief.',
      cards: [{ number: 12, include: true }, { number: 13, include: false }], links: ['https://example.com/pr/1'],
    }),
    '/affiner-un-jalon #7\n\nLe brief.\n\nCartes jointes : #12 (à inclure dans le jalon), #13 (référence)\n\nLiens :\n- https://example.com/pr/1',
  )
})

// --- Consigne -------------------------------------------------------------------------

test('la consigne d’une session d’affinage de jalon cite le skill, le cap, le mode et l’outil de question', async (t) => {
  const h = await harness(t)
  h.db.update(projects).set({ cap: 'Livrer la page projet v2 avant décembre.' }).run()
  h.card('milestone', 7, { milestone: true })
  h.session('asks', 'milestone', { splitMode: 'questions' })
  h.session('splits', 'milestone', { splitMode: 'direct' })

  const asks = h.briefing('asks')
  assert.match(asks, /affiner-un-jalon/)
  assert.match(asks, /#7 « Carte 7 »/)
  assert.match(asks, /Livrer la page projet v2 avant décembre\./)
  assert.match(asks, /outil de question/)
  assert.match(asks, /toutes à la fois/)
  assert.match(asks, /`parent: 7`/)
  assert.match(asks, /questions d'abord/)
  // La consigne du découpage ordinaire fait finir le tour sur des questions en texte :
  // la page du jalon ne les verrait pas.
  assert.doesNotMatch(asks, /pose tes questions dans ta réponse/)
  assert.doesNotMatch(asks, /`link_card`/)

  const splits = h.briefing('splits')
  assert.match(splits, /découpage direct/)
  assert.doesNotMatch(splits, /questions d'abord/)
})

test('un ajout au jalon se range en sous-tâches d’une carte existante, ou en nouvelles cartes (#185)', async (t) => {
  const h = await harness(t)
  h.card('milestone', 7, { milestone: true })
  h.session('refine', 'milestone')

  const granted = h.briefing('refine')
  assert.match(granted, /Ajout au jalon/)
  assert.match(granted, /`request_card_change` avec `add_subtasks`/)
  assert.match(granted, /`propose_cards`, `blocked_by`/)

  // Sans le rangement de carte, l'outil n'est pas listé : la consigne ne le cite pas.
  const denied = h.briefing('refine', false)
  assert.match(denied, /Ajout au jalon/)
  assert.doesNotMatch(denied, /add_subtasks/)
})

test('sans cap, la consigne d’affinage ne parle pas de cap ; un découpage hors jalon garde la consigne ordinaire', async (t) => {
  const h = await harness(t)
  h.card('milestone', 7, { milestone: true })
  h.card('plain', 8)
  h.session('refine', 'milestone')
  h.session('split', 'plain')

  assert.doesNotMatch(h.briefing('refine'), /[Cc]ap du projet/)
  const split = h.briefing('split')
  assert.match(split, /découper un chantier en cartes/)
  assert.doesNotMatch(split, /affiner-un-jalon/)
})

// --- CardDto.refinement ---------------------------------------------------------------

test('sans session d’affinage, la carte n’a pas d’affinage, et une session de travail n’en est pas une', async (t) => {
  const h = await harness(t)
  h.card('milestone', 7, { milestone: true })
  h.session('worker', null, { purpose: null, splitMode: null })
  h.db.update(conversations).set({ cardId: 'milestone' }).where(eq(conversations.id, 'worker')).run()

  assert.equal((await h.cardOf('milestone')).refinement, null)
  const detail = await h.detail('milestone')
  assert.deepEqual(detail, { session: null, activity: null, prompt: null, draft: null, change: null })
})

test('l’affinage est la session split non archivée la plus récente de la carte', async (t) => {
  const h = await harness(t)
  h.card('milestone', 7, { milestone: true })
  h.card('other', 8, { milestone: true })
  h.session('old', 'milestone', { createdAt: 10 })
  h.session('recent', 'milestone', { createdAt: 20, status: 'running', splitMode: 'direct' })
  h.session('archived', 'milestone', { createdAt: 30, archivedAt: 31 })
  h.session('elsewhere', 'other', { createdAt: 40 })

  const refinement = (await h.cardOf('milestone')).refinement
  assert.deepEqual(refinement, {
    conversationId: 'recent', title: 'Session recent', status: 'running', mode: 'direct', createdAt: 20,
    draft: null, change: null,
  } satisfies CardRefinementDto)
  assert.equal((await h.cardOf('other')).refinement?.conversationId, 'elsewhere')
})

test('le brouillon et le changement en attente de la session sont comptés ; tranchés ou en échec, ils sortent', async (t) => {
  const h = await harness(t)
  h.card('milestone', 7, { milestone: true })
  h.card('sibling', 9)
  h.session('refine', 'milestone')
  h.session('stranger-split', 'sibling')

  const draft = h.request('refine', 'propose_cards', { cards: [{ title: 'A' }, { title: 'B' }, { title: 'C' }] })
  const change = h.request('refine', 'request_card_change', { changes: [{ card: 9, reason: 'r', add_subtasks: ['x'] }] })
  // Une demande que le daemon n'a pas encore traitée, ou d'une autre session, ne compte pas.
  h.request('refine', 'propose_cards', { cards: [{ title: 'Z' }] }, false)
  h.request('stranger-split', 'propose_cards', { cards: [{ title: 'Y' }] })

  let refinement = (await h.cardOf('milestone')).refinement!
  assert.deepEqual(refinement.draft, { requestId: draft, count: 3 })
  assert.deepEqual(refinement.change, { requestId: change, count: 1 })

  h.db.update(agentRequests).set({ resolvedAt: Date.now() }).where(eq(agentRequests.id, draft)).run()
  h.db.update(agentRequests).set({ isError: true }).where(eq(agentRequests.id, change)).run()
  refinement = (await h.cardOf('milestone')).refinement!
  assert.equal(refinement.draft, null)
  assert.equal(refinement.change, null)
})

test('une session d’affinage d’avant le mode se lit « questions d’abord »', async (t) => {
  const h = await harness(t)
  h.card('milestone', 7, { milestone: true })
  h.session('legacy', 'milestone', { splitMode: null })
  assert.equal((await h.cardOf('milestone')).refinement?.mode, 'questions')
})

// --- État -----------------------------------------------------------------------------

test('l’état de l’affinage : pas lancée, t’attend, travaille, terminée', () => {
  const base: CardRefinementDto = {
    conversationId: 'c', title: 't', status: 'idle', mode: 'questions', createdAt: 1, draft: null, change: null,
  }
  assert.equal(refinementState(null, false), 'none')
  assert.equal(refinementState(null, true), 'none')
  assert.equal(refinementState({ ...base, status: 'running' }, false), 'working')
  // Une question du CLI tient le tour : la session t'attend.
  assert.equal(refinementState({ ...base, status: 'awaiting_input' }, false), 'waiting')
  // Un brouillon ou un changement en attente aussi, même pendant qu'elle travaille.
  assert.equal(refinementState({ ...base, status: 'running', draft: { requestId: 'r', count: 2 } }, false), 'waiting')
  assert.equal(refinementState({ ...base, change: { requestId: 'r', count: 1 } }, true), 'waiting')
  // Au repos, rien en attente : terminée si le jalon a des cartes, sinon elle attend ta réponse dans le fil.
  assert.equal(refinementState(base, true), 'done')
  assert.equal(refinementState(base, false), 'waiting')
  // Le statut vivant du WebSocket a le dernier mot sur celui du chargement.
  assert.equal(refinementState(base, true, 'running'), 'working')
})

// --- GET /api/cards/:id/refinement ----------------------------------------------------

test('le brouillon en attente se lit hors du fil, tel que le bloc le montre', async (t) => {
  const h = await harness(t)
  h.card('milestone', 7, { milestone: true })
  h.session('refine', 'milestone')
  const requestId = h.request('refine', 'propose_cards', { cards: [{ title: 'Le serveur' }, { title: 'Le web' }] })
  h.log.append('refine', { type: 'card_draft.proposed', requestId, draft: DRAFT })

  const detail = await h.detail('milestone')
  assert.equal(detail.session?.conversationId, 'refine')
  assert.deepEqual(detail.draft, { requestId, conversationId: 'refine', draft: DRAFT })
  assert.equal(detail.change, null)
})

test('le changement de cartes en attente se lit hors du fil, avec ses lignes', async (t) => {
  const h = await harness(t)
  h.card('milestone', 7, { milestone: true })
  h.card('child', 8, { parentId: 'milestone' })
  h.session('refine', 'milestone')
  const requestId = h.request('refine', 'request_card_change', { changes: [{ card: 8, reason: 'Ranger', add_subtasks: ['Le tiroir'] }] })
  // L'ajout au jalon rangé en sous-tâche (#185) se lit comme le reste de la ligne.
  const line = {
    cardId: 'child', number: 8, title: 'Carte 8', fromColumn: 'todo' as const, toColumn: 'in_progress' as const,
    addSubtasks: ['Le tiroir'], reason: 'Ranger',
  }
  h.log.append('refine', { type: 'card_filing.requested', requestId, cards: [line] })

  const detail = await h.detail('milestone')
  assert.deepEqual(detail.change, { requestId, conversationId: 'refine', changes: [line] })
  assert.equal(detail.draft, null)
})

test('la question ouverte de la session d’affinage est sa demande du CLI ; répondue, elle disparaît', async (t) => {
  const h = await harness(t)
  h.card('milestone', 7, { milestone: true })
  h.session('refine', 'milestone', { status: 'awaiting_input' })
  const questions = [{ id: 'cible', header: 'Cible', question: 'À quoi verra-t-on que c’est fini ?', multiSelect: false, allowOther: true, secret: false, options: [] }]
  h.log.append('refine', { type: 'question.requested', requestId: 'q1', questions, blocking: true })

  let detail = await h.detail('milestone')
  assert.equal(detail.prompt?.kind, 'question')
  assert.equal(detail.prompt?.requestId, 'q1')
  assert.equal(detail.prompt?.event.type, 'question.requested')

  h.log.append('refine', { type: 'question.resolved', requestId: 'q1', status: 'answered', answers: { cible: ['La page'] }, decidedBy: 'owner' })
  h.db.update(conversations).set({ status: 'running' }).where(eq(conversations.id, 'refine')).run()
  detail = await h.detail('milestone')
  assert.equal(detail.prompt, null)
})

test('la dernière activité d’une session qui travaille est son outil en cours', async (t) => {
  const h = await harness(t)
  h.card('milestone', 7, { milestone: true })
  h.session('refine', 'milestone', { status: 'running' })
  h.log.append('refine', { type: 'tool.started', toolCallId: 't1', name: 'Read', input: { file_path: 'AGENTS.md' }, parentToolCallId: null })

  let detail = await h.detail('milestone')
  assert.equal(detail.activity?.toolName, 'Read')
  // Ses arguments, lus au journal : la page en tire sa ligne (`toolSummary`).
  assert.deepEqual(detail.activity?.input, { file_path: 'AGENTS.md' })

  // Le dernier `tool.input_updated` l'emporte, comme dans le fil.
  h.log.append('refine', { type: 'tool.input_updated', toolCallId: 't1', input: { file_path: 'docs/SPEC.md' } })
  detail = await h.detail('milestone')
  assert.deepEqual(detail.activity?.input, { file_path: 'docs/SPEC.md' })
})

test('la route refuse une carte d’un projet qu’on ne voit pas, et une carte qui n’existe pas', async (t) => {
  const stranger = await harness(t, 'stranger')
  stranger.card('milestone', 7, { milestone: true })
  assert.equal((await stranger.app.inject('/api/cards/milestone/refinement')).statusCode, 404)
  const owner = await harness(t)
  assert.equal((await owner.app.inject(`/api/cards/${randomUUID()}/refinement`)).statusCode, 404)
})

// --- ConversationDto.milestone --------------------------------------------------------

test('le jalon d’une session d’affinage est la carte qu’elle affine, dans les listes et la route d’un fil', async (t) => {
  const h = await harness(t)
  h.card('milestone', 7, { milestone: true })
  h.session('refine', 'milestone')

  const expected = { id: 'milestone', number: 7, title: 'Carte 7' }
  for (const url of ['/api/conversations', '/api/projects/project/conversations']) {
    const listed = (await h.app.inject(url)).json() as ConversationDto[]
    assert.deepEqual(listed.find((dto) => dto.id === 'refine')?.milestone, expected, url)
  }
  const one = (await h.app.inject('/api/conversations/refine')).json() as ConversationDto
  assert.deepEqual(one.milestone, expected)
  assert.equal(one.card, null)
})

test('un découpage parti d’une carte qui n’est pas un jalon n’a pas de jalon', async (t) => {
  const h = await harness(t)
  h.card('plain', 8)
  h.session('split', 'plain')

  for (const url of ['/api/conversations', '/api/projects/project/conversations']) {
    const listed = (await h.app.inject(url)).json() as ConversationDto[]
    assert.equal(listed.find((dto) => dto.id === 'split')?.milestone, null, url)
  }
  assert.equal(((await h.app.inject('/api/conversations/split')).json() as ConversationDto).milestone, null)
})
