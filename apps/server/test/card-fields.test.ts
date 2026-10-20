import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { fileURLToPath } from 'node:url'
import Fastify from 'fastify'
import multipart from '@fastify/multipart'
import { asc, eq } from 'drizzle-orm'
import { cardMoves, openDatabase, projects, runMigrations, users } from '@solera/db'
import { parseSubtasks, toggleSubtask, type CardDto } from '@solera/protocol'
import { AttachmentStore } from '../src/attachments/store.js'
import { advanceCardOnLaunch } from '../src/cards/create.js'
import type { Config } from '../src/config.js'
import { registerErrorHandler } from '../src/http/errors.js'
import { registerCardRoutes } from '../src/http/routes/cards.js'

async function harness(t: TestContext) {
  const dir = await mkdtemp(join(tmpdir(), 'solera-card-fields-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const { db, sqlite } = openDatabase(join(dir, 'test.sqlite'))
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
  const ctx = { db, config: {} as Config }
  registerCardRoutes(app, ctx, new AttachmentStore(db, join(dir, 'attachments')))
  t.after(() => app.close())

  const create = async (title: string, description = ''): Promise<CardDto> => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/projects/project/cards',
      payload: { title, description },
    })
    assert.equal(response.statusCode, 201, response.body)
    return response.json()
  }
  const moves = () =>
    db.select().from(cardMoves).orderBy(asc(cardMoves.movedAt), asc(cardMoves.id)).all()
  return { app, ctx, db, create, moves }
}

test('échéance et jalon : posés, relus, et détachés sans toucher à la carte-jalon', async (t) => {
  const { app, create } = await harness(t)
  const milestone = await create('v0.2 — la gestion de projet')
  const card = await create('Porter la chronologie')

  const due = Date.parse('2026-11-02T00:00:00Z')
  const dated = await app.inject({
    method: 'PATCH',
    url: `/api/cards/${card.id}`,
    payload: { dueAt: due, milestoneCardId: milestone.id },
  })
  assert.equal(dated.statusCode, 200, dated.body)
  assert.equal(dated.json().dueAt, due)
  assert.deepEqual(dated.json().milestone, {
    id: milestone.id,
    number: milestone.number,
    title: milestone.title,
    column: 'todo',
  })

  // Aucun drapeau ne marque la carte-jalon : elle reste une carte comme une autre, et
  // c'est le fait d'être désignée qui en fait un jalon.
  const board: CardDto[] = (await app.inject('/api/projects/project/cards')).json()
  assert.equal(board.find((row) => row.id === milestone.id)?.milestone, null)

  const detached = await app.inject({
    method: 'PATCH',
    url: `/api/cards/${card.id}`,
    payload: { milestoneCardId: null, dueAt: null },
  })
  assert.equal(detached.json().milestone, null)
  assert.equal(detached.json().dueAt, null)

  const itself = await app.inject({
    method: 'PATCH',
    url: `/api/cards/${card.id}`,
    payload: { milestoneCardId: card.id },
  })
  assert.equal(itself.statusCode, 400, 'une carte ne peut pas être son propre jalon')

  // Supprimer la carte-jalon détache les siennes au lieu de les emporter : un jalon
  // rangé ne doit pas effacer le travail qu'il recouvrait.
  await app.inject({ method: 'PATCH', url: `/api/cards/${card.id}`, payload: { milestoneCardId: milestone.id } })
  const removed = await app.inject({ method: 'DELETE', url: `/api/cards/${milestone.id}` })
  assert.equal(removed.statusCode, 204, removed.body)
  const survivors: CardDto[] = (await app.inject('/api/projects/project/cards')).json()
  assert.equal(survivors.length, 1)
  assert.equal(survivors[0]?.milestone, null)
})

test('liens « bloque » : affirmés, survivants à une réécriture de description, et sans réciprocité', async (t) => {
  const { app, create } = await harness(t)
  const socle = await create('Le socle')
  const suite = await create('La suite', 'Elle vient après #1.')

  const posed = await app.inject({
    method: 'POST',
    url: `/api/cards/${socle.id}/blocks`,
    payload: { blockedId: suite.id },
  })
  assert.equal(posed.statusCode, 201, posed.body)
  assert.deepEqual(
    posed.json().blocks.map((link: { number: number }) => link.number),
    [suite.number],
  )

  const blocked: CardDto = (await app.inject(`/api/projects/project/cards`))
    .json()
    .find((row: CardDto) => row.id === suite.id)
  assert.deepEqual(
    blocked.blockedBy.map((link) => link.number),
    [socle.number],
  )
  // La citation `#1` reste ce qu'elle était : les deux tables ne disent pas la même
  // chose, et `card_refs` n'a pas gagné de type.
  assert.deepEqual(
    blocked.references.map((link) => link.number),
    [socle.number],
  )
  assert.deepEqual(blocked.blocks, [])

  // Une correction de phrase efface la citation dérivée, jamais le lien posé à la main.
  const rewritten = await app.inject({
    method: 'PATCH',
    url: `/api/cards/${suite.id}`,
    payload: { description: 'Plus aucune citation ici.' },
  })
  assert.deepEqual(rewritten.json().references, [])
  assert.deepEqual(
    rewritten.json().blockedBy.map((link: { number: number }) => link.number),
    [socle.number],
  )

  const reverse = await app.inject({
    method: 'POST',
    url: `/api/cards/${suite.id}/blocks`,
    payload: { blockedId: socle.id },
  })
  assert.equal(reverse.statusCode, 409, 'un blocage réciproque est une impasse')

  const again = await app.inject({
    method: 'POST',
    url: `/api/cards/${socle.id}/blocks`,
    payload: { blockedId: suite.id },
  })
  assert.equal(again.statusCode, 201, 'reposer le même lien est un double clic, pas une erreur')

  const removed = await app.inject({
    method: 'DELETE',
    url: `/api/cards/${socle.id}/blocks/${suite.id}`,
  })
  assert.deepEqual(removed.json().blocks, [])
})

test('sous-tâches : cochées par leur rang, refusées quand la description a bougé', async (t) => {
  const { app, create } = await harness(t)
  const description = [
    '- [ ] Écrire la migration',
    '- [x] Lire le document de décision',
    '',
    '```sh',
    '- [ ] ceci est un exemple, pas une tâche',
    '```',
  ].join('\n')
  const card = await create('Les champs de carte', description)

  // Le bloc de code ne compte pas : le rendu ne lui met pas de case, et le n-ième clic
  // doit tomber sur la n-ième ligne cochable.
  assert.equal(parseSubtasks(description).length, 2)

  const checked = await app.inject({
    method: 'POST',
    url: `/api/cards/${card.id}/subtasks`,
    payload: { index: 0, checked: true, label: 'Écrire la migration' },
  })
  assert.equal(checked.statusCode, 200, checked.body)
  assert.match(checked.json().description, /- \[x\] Écrire la migration/)
  assert.match(checked.json().description, /- \[ \] ceci est un exemple/, 'le bloc de code est intact')

  const stale = await app.inject({
    method: 'POST',
    url: `/api/cards/${card.id}/subtasks`,
    payload: { index: 1, checked: false, label: 'Un libellé que personne n’a affiché' },
  })
  assert.equal(stale.statusCode, 409, 'une description changée fait refuser, pas deviner')

  const absent = await app.inject({
    method: 'POST',
    url: `/api/cards/${card.id}/subtasks`,
    payload: { index: 9, checked: true, label: 'Rien' },
  })
  assert.equal(absent.statusCode, 409)

  // Décocher repasse par le même chemin et ne retouche que le caractère entre crochets.
  assert.equal(
    toggleSubtask('  - [x] fait', 0, false),
    '  - [ ] fait',
  )
})

test('card_moves : les trois chemins qui changent une colonne écrivent une ligne', async (t) => {
  const { app, ctx, create, moves } = await harness(t)
  const card = await create('Une carte qui traverse le board')

  // 1. Le menu du panneau.
  const patched = await app.inject({
    method: 'PATCH',
    url: `/api/cards/${card.id}`,
    payload: { column: 'review' },
  })
  assert.equal(patched.statusCode, 200, patched.body)

  // Une correction de titre ne bouge pas la colonne, donc n'écrit pas de mouvement :
  // c'est précisément ce que `updated_at` ne sait pas distinguer.
  await app.inject({ method: 'PATCH', url: `/api/cards/${card.id}`, payload: { title: 'Titre corrigé' } })

  // 2. Le glisser-déposer.
  const reordered = await app.inject({
    method: 'POST',
    url: '/api/projects/project/cards/order',
    payload: { columns: [{ column: 'review', ids: [] }, { column: 'done', ids: [card.id] }] },
  })
  assert.equal(reordered.statusCode, 200, reordered.body)

  // 3. Le passage automatique au lancement d'une session, sur une carte « à faire ».
  const second = await create('Une carte qu’une session ouvre')
  advanceCardOnLaunch(ctx, second.id, 'owner')
  // Une carte déjà plus loin ne recule pas, et ne laisse donc pas de trace.
  advanceCardOnLaunch(ctx, card.id, 'owner')

  assert.deepEqual(
    moves().map((row) => [row.cardId === card.id ? 'first' : 'second', row.fromColumn, row.toColumn, row.userId]),
    [
      ['first', 'todo', 'review', 'owner'],
      ['first', 'review', 'done', 'owner'],
      ['second', 'todo', 'in_progress', 'owner'],
    ],
  )
})

test('columnSince : le dernier arrivage dans la colonne, que la retouche du titre ne déplace pas', async (t) => {
  const { app, create, moves } = await harness(t)
  const card = await create('Terminer la chronologie')
  // Jamais déplacée : la colonne date de la création.
  assert.equal(card.columnSince, card.createdAt)

  const done = await app.inject({ method: 'PATCH', url: `/api/cards/${card.id}`, payload: { column: 'done' } })
  assert.equal(done.statusCode, 200, done.body)
  const arrival = moves().at(-1)
  assert.equal(arrival?.toColumn, 'done')
  assert.equal(done.json().columnSince, arrival?.movedAt)

  // Une correction de titre réécrit `updatedAt`, pas l'arrivée en « terminé ».
  await new Promise((resolve) => setTimeout(resolve, 5))
  const renamed = await app.inject({ method: 'PATCH', url: `/api/cards/${card.id}`, payload: { title: 'Chronologie terminée' } })
  assert.equal(renamed.statusCode, 200, renamed.body)
  assert.ok(renamed.json().updatedAt > arrival!.movedAt)
  assert.equal(renamed.json().columnSince, arrival?.movedAt)
})
