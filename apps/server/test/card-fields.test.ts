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
import { advanceCardOnLaunch, createCard } from '../src/cards/create.js'
import type { Config } from '../src/config.js'
import { registerErrorHandler } from '../src/http/errors.js'
import { assertCardAccepted, registerCardRoutes } from '../src/http/routes/cards.js'

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

test('échéance et parente : posées, relues, et détachées sans toucher à la parente', async (t) => {
  const { app, create } = await harness(t)
  const parent = await create('v0.2 — la gestion de projet')
  const card = await create('Porter la chronologie')

  const due = Date.parse('2026-11-02T00:00:00Z')
  const dated = await app.inject({
    method: 'PATCH',
    url: `/api/cards/${card.id}`,
    payload: { dueAt: due, parentId: parent.id },
  })
  assert.equal(dated.statusCode, 200, dated.body)
  assert.equal(dated.json().dueAt, due)
  assert.deepEqual(dated.json().parent, {
    id: parent.id,
    number: parent.number,
    title: parent.title,
    column: 'todo',
  })

  // Aucun drapeau ne marque la parente : elle reste une carte, qui a des enfants.
  const board: CardDto[] = (await app.inject('/api/projects/project/cards')).json()
  const read = board.find((row) => row.id === parent.id)
  assert.equal(read?.parent, null)
  assert.deepEqual(read?.children.map((child) => child.id), [card.id])

  const detached = await app.inject({
    method: 'PATCH',
    url: `/api/cards/${card.id}`,
    payload: { parentId: null, dueAt: null },
  })
  assert.equal(detached.json().parent, null)
  assert.equal(detached.json().dueAt, null)

  const itself = await app.inject({
    method: 'PATCH',
    url: `/api/cards/${card.id}`,
    payload: { parentId: card.id },
  })
  assert.equal(itself.statusCode, 400, 'une carte ne peut pas être sa propre parente')

  // Supprimer la parente détache ses enfants au lieu de les emporter.
  await app.inject({ method: 'PATCH', url: `/api/cards/${card.id}`, payload: { parentId: parent.id } })
  const removed = await app.inject({ method: 'DELETE', url: `/api/cards/${parent.id}` })
  assert.equal(removed.statusCode, 204, removed.body)
  const survivors: CardDto[] = (await app.inject('/api/projects/project/cards')).json()
  assert.equal(survivors.length, 1)
  assert.equal(survivors[0]?.parent, null)
})

test('arbre : profondeur libre, sans cycle, et un titre refusé avec le cycle', async (t) => {
  const { app, create } = await harness(t)
  const top = await create('Jalon')
  const middle = await create('Chantier')
  const leaf = await create('Petit pas')
  const patch = (id: string, payload: object) => app.inject({ method: 'PATCH', url: `/api/cards/${id}`, payload })

  assert.equal((await patch(middle.id, { parentId: top.id })).statusCode, 200)
  assert.equal((await patch(leaf.id, { parentId: middle.id })).statusCode, 200)

  const cycle = await patch(top.id, { parentId: leaf.id, title: 'Renommé' })
  assert.equal(cycle.statusCode, 409, cycle.body)
  assert.equal(cycle.json().error.code, 'card_parent_cycle')
  const board: CardDto[] = (await app.inject('/api/projects/project/cards')).json()
  assert.equal(board.find((row) => row.id === top.id)?.title, 'Jalon', 'rien ne s\'écrit quand le rattachement est refusé')

  // Créer directement sous une parente : c'est le geste « Ajouter un enfant ».
  const born = await app.inject({ method: 'POST', url: '/api/projects/project/cards', payload: { title: 'Né dessous', parentId: leaf.id } })
  assert.equal(born.statusCode, 201, born.body)
  assert.equal(born.json().parent.id, leaf.id)
})

test('colonne déduite : en cours dès qu\'un enfant démarre, jamais terminée seule, et remontée jusqu\'en haut', async (t) => {
  const { app, create, moves } = await harness(t)
  const top = await create('Jalon')
  const middle = await create('Chantier')
  const a = await create('A')
  const b = await create('B')
  const patch = (id: string, payload: object) => app.inject({ method: 'PATCH', url: `/api/cards/${id}`, payload })
  const column = async (id: string) =>
    ((await app.inject('/api/projects/project/cards')).json() as CardDto[]).find((row) => row.id === id)?.column

  await patch(middle.id, { parentId: top.id })
  await patch(a.id, { parentId: middle.id })
  await patch(b.id, { parentId: middle.id })
  assert.equal(await column(middle.id), 'todo')

  await patch(a.id, { column: 'in_progress' })
  assert.equal(await column(middle.id), 'in_progress')
  assert.equal(await column(top.id), 'in_progress', 'la remontée traverse les niveaux')
  // Le mouvement déduit est écrit au Journal comme les autres, par la même personne.
  assert.ok(moves().some((move) => move.cardId === top.id && move.toColumn === 'in_progress' && move.userId === 'owner'))

  await patch(a.id, { column: 'done' })
  await patch(b.id, { column: 'done' })
  assert.equal(await column(middle.id), 'in_progress', 'tous les enfants livrés : la clôture est proposée, pas faite')

  // Une parente ouverte ne garde pas une colonne choisie à la main.
  await patch(middle.id, { column: 'review' })
  assert.equal(await column(middle.id), 'in_progress')

  // Fermée par une personne, elle ne se rouvre pas seule quand un enfant bouge.
  await patch(middle.id, { column: 'done' })
  await patch(a.id, { column: 'in_progress' })
  assert.equal(await column(middle.id), 'done')
  // Rouverte, elle reprend ce que ses enfants disent.
  await patch(middle.id, { column: 'todo' })
  assert.equal(await column(middle.id), 'in_progress')

  // Le glisser-déposer ne connaît que les feuilles : une colonne complète se compte
  // sans les parentes, et une parente ne s'y range pas.
  const board: CardDto[] = (await app.inject('/api/projects/project/cards')).json()
  const leaves = (wanted: string) => board.filter((row) => row.column === wanted && row.children.length === 0).map((row) => row.id)
  const ordered = await app.inject({
    method: 'POST',
    url: '/api/projects/project/cards/order',
    payload: { columns: [{ column: 'in_progress', ids: leaves('in_progress') }] },
  })
  assert.equal(ordered.statusCode, 200, ordered.body)
  const refused = await app.inject({
    method: 'POST',
    url: '/api/projects/project/cards/order',
    payload: { columns: [{ column: 'in_progress', ids: [...leaves('in_progress'), middle.id] }] },
  })
  assert.equal(refused.statusCode, 400)
  assert.equal(refused.json().error.code, 'card_is_parent')
})

test('à préciser : ramène en « à faire », et s\'efface dès que la carte en sort', async (t) => {
  const { app, create } = await harness(t)
  const card = await create('Floue')
  const patch = (payload: object) => app.inject({ method: 'PATCH', url: `/api/cards/${card.id}`, payload })

  await patch({ column: 'in_progress' })
  const marked = await patch({ toClarify: true })
  assert.equal(marked.json().column, 'todo')
  assert.equal(typeof marked.json().toClarifySince, 'number')

  const resumed = await patch({ column: 'in_progress' })
  assert.equal(resumed.json().toClarifySince, null, 'quitter « à faire » efface l\'état')

  await patch({ toClarify: true })
  const cleared = await patch({ toClarify: false })
  assert.equal(cleared.json().toClarifySince, null)
  assert.equal(cleared.json().column, 'todo', 'lever l\'état ne déplace pas')

  await patch({ column: 'done' })
  assert.equal((await patch({ toClarify: true })).statusCode, 409, 'une carte fermée n\'a plus rien à préciser')
})

test('non acceptée : acceptée, rattachée ou refusée, et sans session tant qu\'elle attend', async (t) => {
  const { app, ctx, create } = await harness(t)
  const parent = await create('Parente')
  const incoming = () => createCard(ctx.db, 'project', 'owner', { title: 'Issue #12', description: '', column: 'todo' }, { accepted: false })

  const first = incoming()
  const listed: CardDto[] = (await app.inject('/api/projects/project/cards')).json()
  assert.equal(listed.find((row) => row.id === first.id)?.acceptedAt, null)
  assert.throws(() => assertCardAccepted(ctx, first.id), /not been accepted/)

  const accepted = await app.inject({ method: 'POST', url: `/api/cards/${first.id}/accept`, payload: {} })
  assert.equal(accepted.statusCode, 200, accepted.body)
  assert.equal(typeof accepted.json().acceptedAt, 'number')
  assert.doesNotThrow(() => assertCardAccepted(ctx, first.id))

  const second = incoming()
  const attached = await app.inject({ method: 'POST', url: `/api/cards/${second.id}/accept`, payload: { parentId: parent.id } })
  assert.equal(attached.json().parent.id, parent.id)
  assert.notEqual(attached.json().acceptedAt, null)

  const third = incoming()
  const refused = await app.inject({ method: 'POST', url: `/api/cards/${third.id}/refuse` })
  assert.equal(refused.json().column, 'abandoned')
  assert.equal(refused.json().acceptedAt, null, 'refusée, elle reste non acceptée')
  assert.equal((await app.inject({ method: 'POST', url: `/api/cards/${first.id}/refuse` })).statusCode, 409)
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
