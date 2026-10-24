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
  cardBlocks,
  cardMoves,
  cardNotes,
  cardRefs,
  cards,
  conversations,
  openDatabase,
  projects,
  runMigrations,
  users,
} from '@solera/db'
import { appendCardPrecision, appendSubtasks, DEFAULT_CLAUDE_CONFIG, type CardColumn } from '@solera/protocol'
import type { AgentRegistry } from '../src/agents/registry.js'
import type { Config } from '../src/config.js'
import { EventLog } from '../src/events/event-log.js'
import type { SessionManager } from '../src/sessions/session-manager.js'
import { AgentRequests } from '../src/sessions/agent-requests.js'

/**
 * Ce qu'un agent fait seul avec les cartes, au-delà de `move_card` (#66) : créer une carte
 * complète, compléter sa description en fin, cocher et ajouter des sous-tâches, rattacher
 * sa conversation, et mettre sa carte « à préciser ». Tout est du socle : la session n'a
 * pas `cardFiling`.
 */
async function harness(t: TestContext, options: { linked?: boolean; description?: string } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'solera-card-gestures-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const { db, sqlite } = openDatabase(join(dir, 'test.sqlite'))
  runMigrations(db, fileURLToPath(new URL('../../../packages/db/migrations', import.meta.url)))
  t.after(() => sqlite.close())

  db.insert(users).values({ id: 'owner', username: 'owner', displayName: 'owner', passwordHash: '', createdAt: 1 }).run()
  db.insert(projects)
    .values({ id: 'project', name: 'Test', workspacePath: dir, ownerId: 'owner', visibility: 'private', createdAt: 1 })
    .run()

  let next = 1
  const card = (column: CardColumn, extra: Partial<typeof cards.$inferInsert> = {}) => {
    const id = randomUUID()
    const number = next++
    db.insert(cards)
      .values({
        id, projectId: 'project', number, title: `Carte ${number}`, description: '', column,
        position: number, acceptedAt: 1, createdBy: 'owner', createdAt: 1, updatedAt: 1, ...extra,
      })
      .run()
    return { id, number }
  }
  const own = card('in_progress', { description: options.description ?? '' })

  db.insert(conversations)
    .values({
      id: 'session', projectId: 'project', userId: 'owner', title: 'Ma session', agent: 'claude',
      config: JSON.stringify({ ...DEFAULT_CLAUDE_CONFIG, cardFiling: false }), status: 'running',
      cardId: options.linked === false ? null : own.id, createdAt: 1, updatedAt: 1,
    })
    .run()

  const ctx = { db, config: { mcp: { cardFiling: false } } as unknown as Config }
  const sessions = { statusBus: new EventEmitter() } as unknown as SessionManager
  const requests = new AgentRequests(ctx, sessions, {} as AgentRegistry, new EventLog(db))

  const call = async (kind: 'create_card' | 'append_card_description' | 'edit_subtasks' | 'link_card' | 'move_card', payload: Record<string, unknown>) => {
    const id = randomUUID()
    db.insert(agentRequests)
      .values({ id, projectId: 'project', conversationId: 'session', kind, payload: JSON.stringify(payload), createdAt: Date.now() })
      .run()
    await requests.sweep()
    return db.select().from(agentRequests).where(eq(agentRequests.id, id)).get()!
  }
  const read = (id: string) => db.select().from(cards).where(eq(cards.id, id)).get()!
  const notes = (id: string) => db.select().from(cardNotes).where(eq(cardNotes.cardId, id)).all()

  return { db, own, card, call, read, notes }
}

test('les précisions vont en fin, dans leur section, sans toucher au texte d’une personne', () => {
  const first = appendCardPrecision('# Le sujet\n\nCe que Tim a écrit.', { day: '2026-10-24', author: 'session « A »', body: 'Il a tranché pour B.' })
  assert.equal(first, '# Le sujet\n\nCe que Tim a écrit.\n\n## Précisions\n\n**2026-10-24 · session « A »**\n\nIl a tranché pour B.')

  // Une personne a écrit sous la section : l'ajout reste dedans, avant son titre.
  const second = appendCardPrecision(`${first}\n\n## Notes de Tim\n\nÀ garder.`, { day: '2026-10-25', author: 'session « B »', body: 'Et C aussi.' })
  assert.equal(
    second,
    '# Le sujet\n\nCe que Tim a écrit.\n\n## Précisions\n\n**2026-10-24 · session « A »**\n\nIl a tranché pour B.\n\n**2026-10-25 · session « B »**\n\nEt C aussi.\n\n## Notes de Tim\n\nÀ garder.',
  )
})

test('les sous-tâches ajoutées suivent la dernière case, avec sa puce et son retrait', () => {
  assert.equal(appendSubtasks('Texte.\n\n  * [x] Fait\n\nFin.', ['Neuve']), 'Texte.\n\n  * [x] Fait\n  * [ ] Neuve\n\nFin.')
  assert.equal(appendSubtasks('Texte.', ['Une', ' deux\nlignes ']), 'Texte.\n\n## Sous-tâches\n\n- [ ] Une\n- [ ] deux lignes')
  // Un `- [ ]` dans un bloc de code n'est pas une case : on n'écrit pas à sa suite.
  assert.equal(appendSubtasks('```\n- [ ] exemple\n```', ['Vraie']), '```\n- [ ] exemple\n```\n\n## Sous-tâches\n\n- [ ] Vraie')
})

test('create_card pose d’un coup la parente, l’échéance, les sous-tâches et les liens « bloque »', async (t) => {
  const { db, own, card, call } = await harness(t)
  const later = card('todo')
  const before = card('todo')

  const row = await call('create_card', {
    title: 'Une étape', description: 'Voir #1.', parent: own.number, due: '2026-11-15',
    subtasks: ['Lire', 'Écrire'], blocks: [later.number], blocked_by: [before.number],
  })
  assert.equal(row.isError, false, row.result ?? '')
  assert.match(row.result ?? '', /#4 « Une étape » créée dans « à faire » \(enfant de #1, échéance le 2026-11-15, 2 sous-tâche\(s\), bloque #2, bloquée par #3\)/)

  const created = db.select().from(cards).where(eq(cards.number, 4)).get()!
  assert.equal(created.parentId, own.id)
  assert.equal(created.column, 'todo')
  assert.equal(created.dueAt, new Date(2026, 10, 15).getTime())
  assert.equal(created.description, 'Voir #1.\n\n## Sous-tâches\n\n- [ ] Lire\n- [ ] Écrire')
  const links = db.select().from(cardBlocks).all().map((link) => [link.sourceId, link.targetId])
  assert.deepEqual(links.sort(), [[created.id, later.id], [before.id, created.id]].sort())
  // La référence `#1` est un backlink, comme pour une carte créée à la main.
  assert.deepEqual(db.select().from(cardRefs).all().map((ref) => ref.targetId), [own.id])
})

test('create_card refuse avant d’écrire : une parente close, une date mal formée, un numéro inconnu', async (t) => {
  const { db, card, call } = await harness(t)
  const closed = card('done')
  for (const [payload, message] of [
    [{ title: 'X', parent: closed.number }, /est close/],
    [{ title: 'X', due: '15/11/2026' }, /AAAA-MM-JJ/],
    [{ title: 'X', due: '2026-02-30' }, /AAAA-MM-JJ/],
    [{ title: 'X', blocks: [99] }, /Aucune carte #99/],
  ] as const) {
    const row = await call('create_card', payload)
    assert.equal(row.isError, true)
    assert.match(row.result ?? '', message)
  }
  assert.equal(db.select().from(cards).all().length, 2)
})

test('append_card_description complète la carte de la session en fin, et le dit en note', async (t) => {
  const { own, call, read, notes } = await harness(t, { description: 'La consigne de Tim, voir #2.' })

  const row = await call('append_card_description', { text: 'Tim a tranché : la section va en fin.' })
  assert.equal(row.isError, false, row.result ?? '')
  const today = new Date()
  const day = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  assert.equal(
    read(own.id).description,
    `La consigne de Tim, voir #2.\n\n## Précisions\n\n**${day} · session « Ma session »**\n\nTim a tranché : la section va en fin.`,
  )
  const [note] = notes(own.id)
  assert.equal(note?.conversationId, 'session')
  assert.match(note?.body ?? '', /Description complétée.*\n\n> Tim a tranché/s)
})

test('append_card_description refuse sans carte, et dit comment s’en donner une', async (t) => {
  const unlinked = await harness(t, { linked: false })
  const none = await unlinked.call('append_card_description', { text: 'Rien.' })
  assert.equal(none.isError, true)
  assert.match(none.result ?? '', /link_card/)
})

test('edit_subtasks coche par libellé, ajoute sous la dernière case, et refuse un libellé inconnu', async (t) => {
  const { own, call, read, notes } = await harness(t, { description: 'Plan :\n- [ ] Lire\n- [ ] Écrire\n\nFin.' })

  const row = await call('edit_subtasks', { check: ['Lire'], add: ['Relire'] })
  assert.equal(row.isError, false, row.result ?? '')
  assert.equal(read(own.id).description, 'Plan :\n- [x] Lire\n- [ ] Écrire\n- [ ] Relire\n\nFin.')
  assert.match(notes(own.id)[0]?.body ?? '', /Sous-tâches ajoutées : « Relire »/)

  // Cocher seul ne laisse pas de note : la barre d'avancement le montre.
  assert.equal((await call('edit_subtasks', { check: ['Écrire'] })).isError, false)
  assert.equal(notes(own.id).length, 1)
  assert.match((await call('edit_subtasks', { check: ['Écrire'] })).result ?? '', /déjà dans cet état/)

  const unknown = await call('edit_subtasks', { uncheck: ['Publier'] })
  assert.equal(unknown.isError, true)
  assert.match(unknown.result ?? '', /Aucune sous-tâche « Publier ».*« Lire », « Écrire », « Relire »/)
})

test('link_card rattache une conversation lancée sans carte, et la carte démarre', async (t) => {
  const { db, card, call, read, notes } = await harness(t, { linked: false })
  const target = card('todo')

  const row = await call('link_card', { card: target.number })
  assert.equal(row.isError, false, row.result ?? '')
  assert.equal(db.select().from(conversations).where(eq(conversations.id, 'session')).get()?.cardId, target.id)
  assert.equal(read(target.id).column, 'in_progress')
  const [moved] = db.select().from(cardMoves).all()
  assert.equal(moved?.conversationId, 'session')
  assert.match(notes(target.id)[0]?.body ?? '', /Session rattachée/)

  // Déjà rattachée : en changer est un geste de l'interface.
  const other = card('todo')
  const again = await call('link_card', { card: other.number })
  assert.equal(again.isError, true)
  assert.match(again.result ?? '', /déjà rattachée à #2/)
})

test('link_card refuse une carte close ou pas encore acceptée', async (t) => {
  const { card, call } = await harness(t, { linked: false })
  const closed = card('done')
  const incoming = card('todo', { acceptedAt: null })
  assert.match((await call('link_card', { card: closed.number })).result ?? '', /est close/)
  assert.match((await call('link_card', { card: incoming.number })).result ?? '', /personne ne l'a encore acceptée/)
})

test('move_card met sa carte « à préciser », dans « à faire », et l’en sort en reprenant', async (t) => {
  const { db, own, call, read } = await harness(t)

  const row = await call('move_card', { column: 'to_clarify', reason: 'Trois questions posées.' })
  assert.equal(row.isError, false, row.result ?? '')
  assert.equal(read(own.id).column, 'todo')
  assert.notEqual(read(own.id).toClarifySince, null)
  assert.equal(db.select().from(cardMoves).all()[0]?.conversationId, 'session')

  assert.match((await call('move_card', { column: 'to_clarify' })).result ?? '', /déjà « à préciser »/)

  // Reprendre le travail lève l'état, par le mouvement ordinaire.
  assert.equal((await call('move_card', { column: 'in_progress' })).isError, false)
  assert.equal(read(own.id).column, 'in_progress')
  assert.equal(read(own.id).toClarifySince, null)
})
