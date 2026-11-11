import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { fileURLToPath } from 'node:url'
import Fastify from 'fastify'
import multipart from '@fastify/multipart'
import { eq } from 'drizzle-orm'
import { cards, conversations, openDatabase, projects, runMigrations, users } from '@solera/db'
import { DEFAULT_CLAUDE_CONFIG, type CardDto } from '@solera/protocol'
import { AttachmentStore } from '../src/attachments/store.js'
import { createDraftCards } from '../src/cards/drafts.js'
import { promoteSubtask } from '../src/cards/promote.js'
import { writeCardParent } from '../src/cards/tree.js'
import type { Config } from '../src/config.js'
import { registerErrorHandler } from '../src/http/errors.js'
import { registerCardRoutes } from '../src/http/routes/cards.js'

/**
 * Le drapeau « jalon » d'une carte (#183) : cochable à la main sur une
 * carte sans parente, posé d'office au premier enfant, refusé sur une enfant et levé
 * quand une carte drapeautée se range sous une parente.
 */
async function harness(t: TestContext) {
  const dir = await mkdtemp(join(tmpdir(), 'solera-card-milestone-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const dbPath = join(dir, 'test.sqlite')
  const { db, sqlite } = openDatabase(dbPath)
  runMigrations(db, fileURLToPath(new URL('../../../packages/db/migrations', import.meta.url)))
  t.after(() => sqlite.close())
  db.insert(users).values({ id: 'owner', username: 'owner', displayName: 'Owner', passwordHash: '', createdAt: 1 }).run()
  db.insert(projects).values({ id: 'project', name: 'Test', workspacePath: dir, ownerId: 'owner', visibility: 'private', createdAt: 1 }).run()

  const app = Fastify()
  await app.register(multipart)
  app.addHook('preHandler', async (request) => {
    request.user = db.select().from(users).where(eq(users.id, 'owner')).get()
  })
  registerErrorHandler(app)
  registerCardRoutes(app, { db, config: {} as Config }, new AttachmentStore(db, join(dir, 'attachments')))
  t.after(() => app.close())

  const create = async (payload: Record<string, unknown>): Promise<CardDto> => {
    const response = await app.inject({ method: 'POST', url: '/api/projects/project/cards', payload })
    assert.equal(response.statusCode, 201, response.body)
    return response.json()
  }
  const patch = (id: string, payload: Record<string, unknown>) =>
    app.inject({ method: 'PATCH', url: `/api/cards/${id}`, payload })
  const read = async (id: string): Promise<CardDto> =>
    ((await app.inject('/api/projects/project/cards')).json() as CardDto[]).find((card) => card.id === id)!
  const flagOf = (id: string) => db.select({ milestone: cards.milestone }).from(cards).where(eq(cards.id, id)).get()?.milestone
  const row = (id: string) => db.select().from(cards).where(eq(cards.id, id)).get()!

  /** Appelle un outil du serveur MCP sur la base du test, et rend son texte. */
  const mcp = (name: string, args: Record<string, unknown>): string => {
    const run = spawnSync(process.execPath, [fileURLToPath(new URL('../src/mcp/solera-mcp.mjs', import.meta.url))], {
      env: { ...process.env, SOLERA_MCP_DB: dbPath, SOLERA_MCP_PROJECT: 'project' },
      encoding: 'utf8',
      input: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) + '\n',
      timeout: 10000,
    })
    assert.equal(run.status, 0, run.stderr)
    return JSON.parse(run.stdout.trim().split('\n').at(-1)!).result.content[0].text as string
  }

  return { app, db, create, patch, read, flagOf, row, mcp }
}

test('une carte neuve n’est pas un jalon ; le drapeau se coche et se décoche à la main', async (t) => {
  const { create, patch, read } = await harness(t)
  const idea = await create({ title: 'Refondre la page projet' })
  assert.equal(idea.milestone, false)

  const flagged = await patch(idea.id, { milestone: true })
  assert.equal(flagged.statusCode, 200, flagged.body)
  assert.equal(flagged.json().milestone, true)
  assert.equal((await read(idea.id)).milestone, true)

  const lifted = await patch(idea.id, { milestone: false })
  assert.equal(lifted.json().milestone, false)
})

test('une enfant ne peut pas être un jalon : 409, sans rien écrire du reste', async (t) => {
  const { create, patch, row } = await harness(t)
  const parent = await create({ title: 'Jalon' })
  const child = await create({ title: 'Étape', parentId: parent.id })

  const refused = await patch(child.id, { milestone: true, title: 'Renommée' })
  assert.equal(refused.statusCode, 409, refused.body)
  assert.equal(refused.json().error.code, 'card_milestone_child')
  assert.equal(row(child.id).title, 'Étape')
  assert.equal(row(child.id).milestone, false)

  // Détacher et drapeauter d'un même geste : c'est la parente demandée qui compte.
  const both = await patch(child.id, { parentId: null, milestone: true })
  assert.equal(both.statusCode, 200, both.body)
  assert.equal(both.json().milestone, true)

  // L'inverse se refuse : se ranger sous une parente en restant un jalon.
  const again = await patch(child.id, { parentId: parent.id, milestone: true })
  assert.equal(again.statusCode, 409, again.body)
  assert.equal(row(child.id).parentId, null)
})

test('le drapeau se pose seul au premier enfant, et reste quand on les détache', async (t) => {
  const { create, patch, flagOf, read } = await harness(t)

  // Par la création d'une enfant.
  const created = await create({ title: 'Jalon par création' })
  await create({ title: 'Enfant', parentId: created.id })
  assert.equal(flagOf(created.id), true)

  // Par le rattachement d'une carte existante.
  const attached = await create({ title: 'Jalon par rattachement' })
  const loose = await create({ title: 'Carte libre' })
  assert.equal((await patch(loose.id, { parentId: attached.id })).statusCode, 200)
  assert.equal(flagOf(attached.id), true)

  // Tant qu'il a des enfants, un jalon ne se décoche pas.
  const kept = await patch(attached.id, { milestone: false })
  assert.equal(kept.statusCode, 409, kept.body)
  assert.equal(kept.json().error.code, 'card_milestone_has_children')
  assert.equal(flagOf(attached.id), true)

  // Détachée, l'enfant laisse une idée de jalon, pas une carte ordinaire.
  assert.equal((await patch(loose.id, { parentId: null })).statusCode, 200)
  const idea = await read(attached.id)
  assert.equal(idea.children.length, 0)
  assert.equal(idea.milestone, true)
})

test('accepter en rattachant : la parente devient un jalon, la carte drapeautée cesse de l’être', async (t) => {
  const { app, db, create, flagOf } = await harness(t)
  const target = await create({ title: 'Cible' })
  const incoming = await create({ title: 'Venue d’une issue', milestone: true })
  db.update(cards).set({ acceptedAt: null }).where(eq(cards.id, incoming.id)).run()

  const accepted = await app.inject({ method: 'POST', url: `/api/cards/${incoming.id}/accept`, payload: { parentId: target.id } })
  assert.equal(accepted.statusCode, 200, accepted.body)
  assert.equal(accepted.json().milestone, false)
  assert.equal(flagOf(target.id), true)
})

test('se ranger sous une parente lève le drapeau ; en sortir avec des enfants le repose', async (t) => {
  const { create, patch, flagOf } = await harness(t)
  const top = await create({ title: 'Grand jalon' })
  const idea = await create({ title: 'Idée de jalon', milestone: true })
  assert.equal(flagOf(idea.id), true)

  assert.equal((await patch(idea.id, { parentId: top.id })).statusCode, 200)
  assert.equal(flagOf(idea.id), false)
  assert.equal(flagOf(top.id), true)

  // Une enfant qui reçoit à son tour une enfant ne devient pas un jalon : elle a une parente.
  await create({ title: 'Petite-fille', parentId: idea.id })
  assert.equal(flagOf(idea.id), false)

  // Remontée au premier niveau avec ses enfants, elle en est un.
  assert.equal((await patch(idea.id, { parentId: null })).statusCode, 200)
  assert.equal(flagOf(idea.id), true)
})

test('par les demandes d’agent : rattachement accordé, brouillon et promotion', async (t) => {
  const { db, create, flagOf, row } = await harness(t)

  // `request_card_change` accordé passe par `writeCardParent`.
  const flagged = await create({ title: 'Idée', milestone: true })
  const target = await create({ title: 'Cible' })
  writeCardParent(db, row(flagged.id), target.id, { userId: 'owner' })
  assert.equal(flagOf(flagged.id), false)
  assert.equal(flagOf(target.id), true)

  db.insert(conversations)
    .values({
      id: 'split', projectId: 'project', userId: 'owner', title: 'Découpage', agent: 'claude',
      config: JSON.stringify(DEFAULT_CLAUDE_CONFIG), status: 'idle', createdAt: 1, updatedAt: 1,
    })
    .run()
  const draftCard = { key: 'a', title: 'Étape', description: '', subtasks: [], after: [], blockedBy: [], related: [] }

  // La parente `new` d'un brouillon naît drapeautée.
  const made = createDraftCards(db, {
    projectId: 'project', userId: 'owner', conversationId: 'split',
    draft: { parent: { kind: 'new', title: 'Jalon neuf', description: '', dueAt: null }, cards: [draftCard] },
  })
  assert.equal(flagOf(made.parent!.cardId), true)

  // Une parente `existing` reçoit son premier enfant : drapeautée aussi.
  const existing = await create({ title: 'À découper' })
  createDraftCards(db, {
    projectId: 'project', userId: 'owner', conversationId: 'split',
    draft: { parent: { kind: 'existing', card: { cardId: existing.id, number: existing.number, title: existing.title } }, cards: [draftCard] },
  })
  assert.equal(flagOf(existing.id), true)

  // La promotion crée une sœur : la parente commune reste un jalon, l'origine n'en devient pas un.
  const origin = await create({ title: 'Origine', description: '- [ ] Un pas de trop', parentId: target.id })
  const sister = promoteSubtask(db, row(origin.id), { index: 0, label: 'Un pas de trop', blocks: false }, { userId: 'owner' })
  assert.equal(sister.parentId, target.id)
  assert.equal(flagOf(target.id), true)
  assert.equal(flagOf(origin.id), false)
})

test('création d’un jalon d’un seul appel : drapeau et échéance', async (t) => {
  const { app, create, row } = await harness(t)
  const due = Date.parse('2026-12-01T00:00:00Z')
  const milestone = await create({ title: 'Jalon daté', milestone: true, dueAt: due })
  assert.equal(milestone.milestone, true)
  assert.equal(milestone.dueAt, due)
  assert.equal(row(milestone.id).dueAt, due)

  const plain = await create({ title: 'Sans rien', dueAt: null })
  assert.equal(plain.milestone, false)
  assert.equal(plain.dueAt, null)

  // Une enfant ne naît pas jalon.
  const refused = await app.inject({
    method: 'POST', url: '/api/projects/project/cards', payload: { title: 'Enfant jalon', parentId: milestone.id, milestone: true },
  })
  assert.equal(refused.statusCode, 409, refused.body)
  assert.equal(refused.json().error.code, 'card_milestone_child')
})

test('list_cards et read_card disent « jalon »', async (t) => {
  const { create, mcp } = await harness(t)
  const idea = await create({ title: 'Idée de jalon', milestone: true })
  const plain = await create({ title: 'Carte ordinaire' })

  const list = mcp('list_cards', {})
  const line = (number: number) => list.split('\n').find((text) => text.startsWith(`- #${number} `)) ?? ''
  assert.match(line(idea.number), /jalon/)
  assert.doesNotMatch(line(plain.number), /jalon/)

  assert.match(mcp('read_card', { number: idea.number }), /jalon/i)
  assert.doesNotMatch(mcp('read_card', { number: plain.number }), /jalon/i)
})
