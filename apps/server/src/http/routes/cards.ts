import { basename } from 'node:path'
import { toAttachmentDto, type AttachmentStore } from '../../attachments/store.js'
import { randomUUID } from 'node:crypto'
import { and, asc, count, desc, eq, inArray, max, or, sql } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import {
  attachments,
  cardBlocks,
  cardIssues,
  cardMoves,
  cardNotes,
  cardRefs,
  cardRelations,
  cards,
  conversations,
  projects,
  users,
  worktrees,
  writeTransaction,
  type CardRow,
  type ProjectRow,
} from '@solera/db'
import {
  MAX_ATTACHMENT_BYTES,
  acceptCardBodySchema,
  cardBlockBodySchema,
  cardRelationBodySchema,
  cardRelationKindSchema,
  createCardBodySchema,
  createCardNoteBodySchema,
  reorderCardsBodySchema,
  toggleSubtask,
  toggleSubtaskBodySchema,
  promoteSubtaskBodySchema,
  parseSubtasks,
  updateCardBodySchema,
  type CardConversationDto,
  type CardDto,
  type CardLinkDto,
  type CardNoteDto,
  type CardSearchDto,
} from '@solera/protocol'
import { createCard, syncCardReferences } from '../../cards/create.js'
import { addCardBlock, removeCardBlock } from '../../cards/blocks.js'
import { addCardRelation, removeCardRelation } from '../../cards/relations.js'
import { promoteSubtask } from '../../cards/promote.js'
import { recordCardMove } from '../../cards/moves.js'
import { queueIssueRefusal, toCardIssueDto } from '../../issues/links.js'
import { resolveParent, setCardParent, setToClarify, syncParentColumn } from '../../cards/tree.js'
import type { AppContext } from '../context.js'
import { badRequest, conflict, forbidden, notFound } from '../errors.js'
import { requireUser } from '../require-user.js'

const MENTION_LIMIT = 20

/** Cartes rendues à la palette : au-delà, aucune famille de résultats n'est lisible. */
const SEARCH_LIMIT = 20

/**
 * Le board : les cartes d'un projet, c'est-à-dire le travail à faire, distinct des
 * conversations qui l'exécutent.
 *
 * La colonne d'une feuille est une position choisie, écrite par un geste ; celle d'une
 * carte qui a des enfants se déduit d'eux (`cards/tree.ts`). L'activité se lit sur les
 * conversations rattachées et l'état de merge dans git, tous deux hors de cette table.
 */
export function registerCardRoutes(app: FastifyInstance, ctx: AppContext, store: AttachmentStore): void {
  const loadProject = (projectId: string, userId: string): ProjectRow => {
    const project = ctx.db.select().from(projects).where(eq(projects.id, projectId)).get()
    if (!project) throw notFound('project_not_found', 'Project not found.')
    if (project.ownerId !== userId && project.visibility !== 'shared') {
      throw notFound('project_not_found', 'Project not found.')
    }
    return project
  }

  const loadCard = (cardId: string, userId: string): { card: CardRow; project: ProjectRow } => {
    const card = ctx.db.select().from(cards).where(eq(cards.id, cardId)).get()
    if (!card) throw notFound('card_not_found', 'Card not found.')
    return { card, project: loadProject(card.projectId, userId) }
  }

  /**
   * Assemble les cartes d'un projet en un petit nombre de requêtes.
   *
   * Les conversations et les références se lisent en bloc plutôt que carte par carte :
   * un board de trente cartes ferait autrement quatre-vingt-dix requêtes pour un écran.
   */
  const buildDtos = (projectId: string, rows: CardRow[]): CardDto[] => {
    if (rows.length === 0) return []
    const ids = rows.map((row) => row.id)

    const attached = ctx.db
      .select({
        cardId: conversations.cardId,
        id: conversations.id,
        title: conversations.title,
        agent: conversations.agent,
        status: conversations.status,
        costUsd: conversations.costUsd,
        worktreeId: conversations.worktreeId,
        worktreeName: worktrees.name,
        archivedAt: conversations.archivedAt,
        createdAt: conversations.createdAt,
      })
      .from(conversations)
      .leftJoin(worktrees, eq(worktrees.id, conversations.worktreeId))
      .where(inArray(conversations.cardId, ids))
      .orderBy(conversations.createdAt)
      .all()

    const sessions = new Map<string, CardConversationDto[]>()
    for (const row of attached) {
      if (!row.cardId) continue
      const list = sessions.get(row.cardId) ?? []
      list.push({
        id: row.id,
        title: row.title,
        agent: row.agent,
        status: row.status,
        costUsd: row.costUsd,
        worktreeId: row.worktreeId,
        worktreeName: row.worktreeName,
        archivedAt: row.archivedAt,
        createdAt: row.createdAt,
      })
      sessions.set(row.cardId, list)
    }

    const links = ctx.db
      .select({
        sourceId: cardRefs.sourceId,
        targetId: cardRefs.targetId,
        id: cards.id,
        number: cards.number,
        title: cards.title,
        column: cards.column,
      })
      .from(cardRefs)
      .innerJoin(cards, eq(cards.id, cardRefs.targetId))
      .where(inArray(cardRefs.sourceId, ids))
      .orderBy(cards.number)
      .all()

    const backlinks = ctx.db
      .select({
        sourceId: cardRefs.sourceId,
        targetId: cardRefs.targetId,
        id: cards.id,
        number: cards.number,
        title: cards.title,
        column: cards.column,
      })
      .from(cardRefs)
      .innerJoin(cards, eq(cards.id, cardRefs.sourceId))
      .where(inArray(cardRefs.targetId, ids))
      .orderBy(cards.number)
      .all()

    const group = (
      list: typeof links,
      key: (row: (typeof links)[number]) => string,
    ): Map<string, CardLinkDto[]> => {
      const grouped = new Map<string, CardLinkDto[]>()
      for (const row of list) {
        const bucket = grouped.get(key(row)) ?? []
        bucket.push({ id: row.id, number: row.number, title: row.title, column: row.column })
        grouped.set(key(row), bucket)
      }
      return grouped
    }

    const outgoing = group(links, (row) => row.sourceId)
    const incoming = group(backlinks, (row) => row.targetId)

    /**
     * Les liens posés à la main, lus à part des références `#12` et nommés autrement :
     * les deux tables ne disent pas la même chose, et une description corrigée réécrit
     * la première sans toucher à la seconde.
     */
    const blocking = ctx.db
      .select({
        sourceId: cardBlocks.sourceId,
        targetId: cardBlocks.targetId,
        id: cards.id,
        number: cards.number,
        title: cards.title,
        column: cards.column,
      })
      .from(cardBlocks)
      .innerJoin(cards, eq(cards.id, cardBlocks.targetId))
      .where(inArray(cardBlocks.sourceId, ids))
      .orderBy(cards.number)
      .all()

    const blockedByRows = ctx.db
      .select({
        sourceId: cardBlocks.sourceId,
        targetId: cardBlocks.targetId,
        id: cards.id,
        number: cards.number,
        title: cards.title,
        column: cards.column,
      })
      .from(cardBlocks)
      .innerJoin(cards, eq(cards.id, cardBlocks.sourceId))
      .where(inArray(cardBlocks.targetId, ids))
      .orderBy(cards.number)
      .all()

    const blocks = group(blocking, (row) => row.sourceId)
    const blockedBy = group(blockedByRows, (row) => row.targetId)

    // Les liens informatifs (#109), lus des deux bouts en une requête : « liée à » est
    // écrit une seule fois, et chacune de ses deux cartes y voit l'autre.
    const relatedRows = ctx.db
      .select({ sourceId: cardRelations.sourceId, targetId: cardRelations.targetId, kind: cardRelations.kind })
      .from(cardRelations)
      .where(or(inArray(cardRelations.sourceId, ids), inArray(cardRelations.targetId, ids)))
      .all()
    const relatedIds = [...new Set(relatedRows.flatMap((row) => [row.sourceId, row.targetId]))]
    const relatedCards = new Map(
      (relatedIds.length === 0
        ? []
        : ctx.db
            .select({ id: cards.id, number: cards.number, title: cards.title, column: cards.column })
            .from(cards)
            .where(inArray(cards.id, relatedIds))
            .all()
      ).map((row) => [row.id, row satisfies CardLinkDto]),
    )
    const related = new Map<string, CardLinkDto[]>()
    const duplicateOf = new Map<string, CardLinkDto>()
    const duplicates = new Map<string, CardLinkDto[]>()
    const push = (bucket: Map<string, CardLinkDto[]>, key: string, otherId: string) => {
      const other = relatedCards.get(otherId)
      if (other) bucket.set(key, [...(bucket.get(key) ?? []), other])
    }
    for (const row of relatedRows) {
      if (row.kind === 'related') {
        push(related, row.sourceId, row.targetId)
        push(related, row.targetId, row.sourceId)
      } else {
        const original = relatedCards.get(row.targetId)
        if (original) duplicateOf.set(row.sourceId, original)
        push(duplicates, row.targetId, row.sourceId)
      }
    }
    const byNumber = (list: CardLinkDto[] | undefined) => (list ?? []).sort((a, b) => a.number - b.number)

    // Parentes et enfants lus en deux coups, hors de `rows` : le board ne charge pas
    // toujours tout, et une parente livrée tombe dans les colonnes repliées.
    const parentIds = [...new Set(rows.map((row) => row.parentId).filter((id): id is string => id !== null))]
    const parents = new Map(
      (parentIds.length === 0
        ? []
        : ctx.db
            .select({ id: cards.id, number: cards.number, title: cards.title, column: cards.column })
            .from(cards)
            .where(inArray(cards.id, parentIds))
            .all()
      ).map((row) => [row.id, row satisfies CardLinkDto]),
    )
    const offspring = new Map<string, CardLinkDto[]>()
    for (const row of ctx.db
      .select({ parentId: cards.parentId, id: cards.id, number: cards.number, title: cards.title, column: cards.column })
      .from(cards)
      .where(inArray(cards.parentId, ids))
      .orderBy(cards.number)
      .all()) {
      if (!row.parentId) continue
      const bucket = offspring.get(row.parentId) ?? []
      bucket.push({ id: row.id, number: row.number, title: row.title, column: row.column })
      offspring.set(row.parentId, bucket)
    }

    const notes = new Map(
      ctx.db
        .select({ cardId: cardNotes.cardId, total: count() })
        .from(cardNotes)
        .where(inArray(cardNotes.cardId, ids))
        .groupBy(cardNotes.cardId)
        .all()
        .map((row) => [row.cardId, row.total]),
    )

    // Depuis quand chaque carte est dans sa colonne : le dernier mouvement qui l'y a
    // menée. `updated_at` ne le dit pas, une correction de titre le réécrit — c'est la
    // raison d'être de `card_moves`, que le Journal lit déjà pour la même question.
    const arrivals = new Map<string, number>()
    for (const move of ctx.db
      .select({ cardId: cardMoves.cardId, toColumn: cardMoves.toColumn, at: max(cardMoves.movedAt) })
      .from(cardMoves)
      .where(inArray(cardMoves.cardId, ids))
      .groupBy(cardMoves.cardId, cardMoves.toColumn)
      .all()) {
      if (move.at !== null) arrivals.set(`${move.cardId}:${move.toColumn}`, Number(move.at))
    }

    const issues = new Map(
      ctx.db.select().from(cardIssues).where(inArray(cardIssues.cardId, ids)).all().map((link) => [link.cardId, toCardIssueDto(link)]),
    )

    const files = new Map(ctx.db.select({ cardId: attachments.cardId, total: count() })
      .from(attachments).where(inArray(attachments.cardId, ids)).groupBy(attachments.cardId)
      .all().map((row) => [row.cardId, row.total]))

    const authors = new Map(
      ctx.db
        .select({ id: users.id, displayName: users.displayName })
        .from(users)
        .where(
          inArray(
            users.id,
            rows.map((row) => row.createdBy),
          ),
        )
        .all()
        .map((row) => [row.id, row.displayName]),
    )

    return rows.map((row) => ({
      id: row.id,
      projectId,
      number: row.number,
      title: row.title,
      description: row.description,
      column: row.column,
      position: row.position,
      dueAt: row.dueAt,
      parent: row.parentId ? (parents.get(row.parentId) ?? null) : null,
      children: offspring.get(row.id) ?? [],
      acceptedAt: row.acceptedAt,
      toClarifySince: row.toClarifySince,
      createdBy: row.createdBy,
      createdByName: authors.get(row.createdBy) ?? '',
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      columnSince: arrivals.get(`${row.id}:${row.column}`) ?? row.createdAt,
      conversations: sessions.get(row.id) ?? [],
      noteCount: notes.get(row.id) ?? 0,
      attachmentCount: files.get(row.id) ?? 0,
      references: outgoing.get(row.id) ?? [],
      referencedBy: incoming.get(row.id) ?? [],
      blocks: blocks.get(row.id) ?? [],
      blockedBy: blockedBy.get(row.id) ?? [],
      related: byNumber(related.get(row.id)),
      duplicateOf: duplicateOf.get(row.id) ?? null,
      duplicates: byNumber(duplicates.get(row.id)),
      issue: issues.get(row.id) ?? null,
    }))
  }

  const readCard = (cardId: string, projectId: string): CardDto => {
    const row = ctx.db.select().from(cards).where(eq(cards.id, cardId)).get()
    if (!row) throw notFound('card_not_found', 'Card not found.')
    const [dto] = buildDtos(projectId, [row])
    if (!dto) throw notFound('card_not_found', 'Card not found.')
    return dto
  }

  app.get('/api/projects/:id/cards', async (request) => {
    const user = requireUser(request)
    const { id } = request.params as { id: string }
    loadProject(id, user.id)

    const rows = ctx.db
      .select()
      .from(cards)
      .where(eq(cards.projectId, id))
      .orderBy(cards.position, cards.number)
      .all()

    return buildDtos(id, rows)
  })

  /**
   * Cartes de tous les projets visibles, pour la palette.
   *
   * Le board lit projet par projet, ce qui va quand on l'a sous les yeux ; la palette
   * cherche sans projet courant et ferait autrement une requête par projet à chaque
   * frappe. Sans saisie, les dernières touchées : la palette au repos propose ce qu'on
   * rouvre.
   */
  app.get('/api/cards/search', async (request) => {
    const user = requireUser(request)
    const { q } = request.query as { q?: string }
    const query = (q ?? '').trim()

    const rows = ctx.db
      .select({
        id: cards.id,
        projectId: cards.projectId,
        number: cards.number,
        title: cards.title,
        column: cards.column,
        updatedAt: cards.updatedAt,
      })
      .from(cards)
      .innerJoin(projects, eq(projects.id, cards.projectId))
      .where(
        and(
          // La visibilité se vérifie ici et pas ailleurs : la requête traverse tous
          // les projets, et une carte d'un projet privé d'un autre compte n'a rien à
          // faire dans la palette.
          or(eq(projects.ownerId, user.id), eq(projects.visibility, 'shared')),
          query.length === 0
            ? undefined
            : // Le numéro se cherche par préfixe et le titre par sous-chaîne : taper
              // « 13 » veut dire la carte 13, pas toutes celles qui contiennent un 13.
              sql`(${cards.title} LIKE ${`%${query}%`} COLLATE NOCASE
                   OR CAST(${cards.number} AS TEXT) LIKE ${`${query}%`})`,
        ),
      )
      .orderBy(desc(cards.updatedAt))
      .limit(SEARCH_LIMIT)
      .all()

    return { cards: rows } satisfies CardSearchDto
  })

  /**
   * Cartes citables, pour l'autocomplétion `#` du composer.
   *
   * Distincte de la liste du board : celle-ci porte les sessions et les backlinks de
   * chaque carte, poids inutile pour une liste déroulante qui n'affiche qu'un numéro
   * et un titre.
   */
  app.get('/api/projects/:id/cards/mentions', async (request) => {
    const user = requireUser(request)
    const { id } = request.params as { id: string }
    const { q } = request.query as { q?: string }
    loadProject(id, user.id)

    const query = (q ?? '').trim()
    const rows = ctx.db
      .select({ id: cards.id, number: cards.number, title: cards.title, column: cards.column })
      .from(cards)
      .where(
        query.length === 0
          ? eq(cards.projectId, id)
          : and(
              eq(cards.projectId, id),
              // Le numéro se cherche par préfixe et le titre par sous-chaîne : taper
              // « 1 » veut dire la carte 1, pas toutes celles dont le numéro contient un 1.
              sql`(${cards.title} LIKE ${`%${query}%`} COLLATE NOCASE
                   OR CAST(${cards.number} AS TEXT) LIKE ${`${query}%`})`,
            ),
      )
      .orderBy(cards.number)
      .limit(MENTION_LIMIT)
      .all()

    return { cards: rows }
  })

  app.post('/api/projects/:id/cards', async (request, reply) => {
    const user = requireUser(request)
    const { id } = request.params as { id: string }
    const body = createCardBodySchema.parse(request.body)
    loadProject(id, user.id)

    const { parentId, ...fields } = body
    const row = createCard(ctx.db, id, user.id, fields, { parentId })
    return reply.status(201).send(readCard(row.id, id))
  })

  app.patch('/api/cards/:id', async (request) => {
    const user = requireUser(request)
    const { id } = request.params as { id: string }
    const body = updateCardBodySchema.parse(request.body)
    const { card } = loadCard(id, user.id)

    // Le rattachement se vérifie avant toute écriture : un cycle refusé ne doit pas
    // laisser derrière lui un titre à moitié enregistré.
    if (body.parentId) resolveParent(ctx.db, card, body.parentId)

    const patch: Partial<typeof cards.$inferInsert> = {}
    if (body.title !== undefined) patch.title = body.title
    if (body.description !== undefined) patch.description = body.description
    if (body.dueAt !== undefined) patch.dueAt = body.dueAt
    if (body.column !== undefined && body.column !== card.column) {
      patch.column = body.column
      // Changer de colonne depuis le détail place la carte en fin de la nouvelle,
      // faute de geste qui dise où l'y poser.
      const [last] = ctx.db
        .select({ position: max(cards.position) })
        .from(cards)
        .where(and(eq(cards.projectId, card.projectId), eq(cards.column, body.column)))
        .all()
      patch.position = (last?.position ?? 0) + 1
    }

    if (Object.keys(patch).length > 0) {
      patch.updatedAt = Date.now()
      ctx.db.update(cards).set(patch).where(eq(cards.id, id)).run()
    }
    if (patch.column) {
      recordCardMove(ctx.db, { cardId: id, from: card.column, to: patch.column, userId: user.id })
    }
    if (body.parentId !== undefined) setCardParent(ctx.db, card, body.parentId, { userId: user.id })
    // Une parente ouverte ne garde pas une colonne choisie à la main : la rouvrir, ou la
    // poser ailleurs qu'en fermé, revient à la colonne que ses enfants disent. La fermer
    // reste un geste, celui que `parentCloseProposed` propose.
    if (patch.column) syncOwnColumn(id, user.id)
    if (body.toClarify !== undefined) setToClarify(ctx.db, id, body.toClarify, { userId: user.id })
    if (body.description !== undefined) syncCardReferences(ctx.db, card, body.description)

    return readCard(id, card.projectId)
  })

  /** La colonne d'une carte qui a des enfants, recalculée depuis eux après un geste. */
  const syncOwnColumn = (cardId: string, userId: string): void => {
    const child = ctx.db.select({ id: cards.id }).from(cards).where(eq(cards.parentId, cardId)).get()
    if (child) syncParentColumn(ctx.db, cardId, { userId })
  }

  /**
   * Accepte une carte venue de l'extérieur, et la rattache d'un même geste quand
   * `parentId` est donné (« Rattacher à une carte »). Idempotent : accepter une carte
   * déjà acceptée ne réécrit pas sa date.
   */
  app.post('/api/cards/:id/accept', async (request) => {
    const user = requireUser(request)
    const { id } = request.params as { id: string }
    const body = acceptCardBodySchema.parse(request.body ?? {})
    const { card } = loadCard(id, user.id)

    if (body.parentId) resolveParent(ctx.db, card, body.parentId)
    if (card.acceptedAt === null) {
      ctx.db.update(cards).set({ acceptedAt: Date.now(), updatedAt: Date.now() }).where(eq(cards.id, id)).run()
    }
    if (body.parentId) setCardParent(ctx.db, card, body.parentId, { userId: user.id })
    return readCard(id, card.projectId)
  })

  /**
   * Refuse une carte venue de l'extérieur : elle part en « abandonné » et reste non
   * acceptée, ce qui la distingue d'une carte abandonnée après avoir été travaillée.
   * Une carte déjà acceptée ne se refuse plus : on l'abandonne.
   */
  app.post('/api/cards/:id/refuse', async (request) => {
    const user = requireUser(request)
    const { id } = request.params as { id: string }
    const { card } = loadCard(id, user.id)
    if (card.acceptedAt !== null) {
      throw conflict('card_already_accepted', 'This card was accepted; abandon it instead.')
    }
    if (card.column !== 'abandoned') {
      const [last] = ctx.db
        .select({ position: max(cards.position) })
        .from(cards)
        .where(and(eq(cards.projectId, card.projectId), eq(cards.column, 'abandoned')))
        .all()
      const now = Date.now()
      writeTransaction(ctx.db, (tx) => {
        tx.update(cards)
          .set({ column: 'abandoned', position: (last?.position ?? 0) + 1, updatedAt: now })
          .where(eq(cards.id, id))
          .run()
        recordCardMove(tx, { cardId: id, from: card.column, to: 'abandoned', userId: user.id, at: now })
      })
    }
    // Une issue refusée se ferme avec un mot, et non comme un simple abandon.
    queueIssueRefusal(ctx.db, id)
    return readCard(id, card.projectId)
  })

  app.delete('/api/cards/:id', async (request, reply) => {
    const user = requireUser(request)
    const { id } = request.params as { id: string }
    const { card, project } = loadCard(id, user.id)

    // Le propriétaire du projet range chez lui ; l'auteur peut défaire ce qu'il vient
    // de créer. Un tiers du cercle de confiance édite les cartes mais n'en supprime
    // pas, la suppression emportant les backlinks que d'autres ont posés.
    if (project.ownerId !== user.id && card.createdBy !== user.id) {
      throw forbidden(
        'card_delete_forbidden',
        'Only the project owner or the card author can delete it.',
      )
    }

    await store.removeForCards([id])
    writeTransaction(ctx.db, (tx) => {
      // Les conversations survivent à leur carte et redeviennent ordinaires : elles
      // portent du travail réel, que le rangement du board n'a pas à emporter.
      tx.update(conversations).set({ cardId: null }).where(eq(conversations.cardId, id)).run()
      tx.delete(cards).where(eq(cards.id, id)).run()
      // La parente perd un enfant : ce qu'il lui reste dit peut-être autre chose.
      syncParentColumn(tx, card.parentId, { userId: user.id })
    })

    return reply.status(204).send()
  })

  app.get('/api/cards/:id/attachments', async (request) => {
    const user = requireUser(request)
    const { id } = request.params as { id: string }
    loadCard(id, user.id)
    return ctx.db.select().from(attachments).where(eq(attachments.cardId, id))
      .orderBy(attachments.createdAt).all().map(toAttachmentDto)
  })

  app.post('/api/cards/:id/attachments', async (request, reply) => {
    const user = requireUser(request)
    const { id } = request.params as { id: string }
    loadCard(id, user.id)
    const file = await request.file({ limits: { fileSize: MAX_ATTACHMENT_BYTES } })
    if (!file) throw badRequest('no_file', 'No file received.')
    const content = await file.toBuffer().catch(() => null)
    if (!content || file.file.truncated) throw badRequest('file_too_large', 'File is too large.')
    if (!content.byteLength) throw badRequest('empty_file', 'File is empty.')
    // Recontrôler après la lecture : le ticket peut avoir disparu pendant l'envoi.
    loadCard(id, user.id)
    const dto = await store.save({ userId: user.id, cardId: id,
      filename: basename(file.filename).slice(0, 200) || 'fichier', content })
    return reply.status(201).send(dto)
  })

  app.delete('/api/cards/:id/attachments/:attachmentId', async (request, reply) => {
    const user = requireUser(request)
    const { id, attachmentId } = request.params as { id: string; attachmentId: string }
    loadCard(id, user.id)
    const file = store.get(attachmentId)
    if (!file || file.cardId !== id) throw notFound('attachment_not_found', 'Attachment not found.')
    await store.remove(attachmentId)
    return reply.status(204).send()
  })

  app.get('/api/cards/:id/notes', async (request) => {
    const user = requireUser(request)
    const { id } = request.params as { id: string }
    loadCard(id, user.id)
    return readNotes(ctx, id)
  })

  app.post('/api/cards/:id/notes', async (request, reply) => {
    const user = requireUser(request)
    const { id } = request.params as { id: string }
    const body = createCardNoteBodySchema.parse(request.body)
    loadCard(id, user.id)

    ctx.db
      .insert(cardNotes)
      .values({
        id: randomUUID(),
        cardId: id,
        conversationId: null,
        userId: user.id,
        body: body.body,
        createdAt: Date.now(),
      })
      .run()

    return reply.status(201).send(readNotes(ctx, id))
  })

  app.delete('/api/card-notes/:id', async (request, reply) => {
    const user = requireUser(request)
    const { id } = request.params as { id: string }

    const note = ctx.db.select().from(cardNotes).where(eq(cardNotes.id, id)).get()
    if (!note) throw notFound('card_note_not_found', 'Note not found.')
    // La lecture du projet suffit à supprimer : les notes d'agent n'ont pas d'auteur
    // humain à protéger, et une note fausse doit pouvoir partir sans passer par son
    // propriétaire, qui est parfois un process mort depuis des jours.
    loadCard(note.cardId, user.id)

    ctx.db.delete(cardNotes).where(eq(cardNotes.id, id)).run()
    return reply.status(204).send()
  })

  /**
   * Pose un lien « bloque » : la carte de l'URL empêche `blockedId` d'avancer.
   *
   * Idempotent, et volontairement : reposer un lien déjà là n'est pas une erreur à
   * expliquer, c'est un double clic.
   */
  app.post('/api/cards/:id/blocks', async (request, reply) => {
    const user = requireUser(request)
    const { id } = request.params as { id: string }
    const body = cardBlockBodySchema.parse(request.body)
    const { card } = loadCard(id, user.id)

    addCardBlock(ctx.db, { projectId: card.projectId, sourceId: id, targetId: body.blockedId, userId: user.id })

    return reply.status(201).send(readCard(id, card.projectId))
  })

  app.delete('/api/cards/:id/blocks/:blockedId', async (request) => {
    const user = requireUser(request)
    const { id, blockedId } = request.params as { id: string; blockedId: string }
    const { card } = loadCard(id, user.id)

    removeCardBlock(ctx.db, { sourceId: id, targetId: blockedId })

    return readCard(id, card.projectId)
  })

  /**
   * Pose un lien informatif depuis la carte de l'URL (#109). « Doublon de » remplace
   * l'originale déjà posée : c'est le sélecteur de la fiche qui la change.
   */
  app.post('/api/cards/:id/relations', async (request, reply) => {
    const user = requireUser(request)
    const { id } = request.params as { id: string }
    const body = cardRelationBodySchema.parse(request.body)
    const { card } = loadCard(id, user.id)

    addCardRelation(ctx.db, {
      projectId: card.projectId,
      sourceId: id,
      targetId: body.targetId,
      kind: body.kind,
      replace: true,
      userId: user.id,
    })

    return reply.status(201).send(readCard(id, card.projectId))
  })

  app.delete('/api/cards/:id/relations/:kind/:targetId', async (request) => {
    const user = requireUser(request)
    const { id, kind, targetId } = request.params as { id: string; kind: string; targetId: string }
    const { card } = loadCard(id, user.id)

    removeCardRelation(ctx.db, { sourceId: id, targetId, kind: cardRelationKindSchema.parse(kind) })

    return readCard(id, card.projectId)
  })

  /**
   * Coche ou décoche une sous-tâche, c'est-à-dire réécrit une ligne de la description.
   *
   * Une route à part plutôt qu'un `PATCH description` : le client n'envoie pas le texte
   * entier, donc il n'écrase pas ce qu'une autre session vient d'écrire. Le serveur
   * relit la description, vérifie que la n-ième case dit toujours ce que le clic
   * visait, et ne retouche que le caractère entre crochets. Si les deux ne concordent
   * plus, il refuse en 409 : la page affichée est périmée, et c'est elle qu'il faut
   * recharger, pas la description qu'il faut deviner.
   */
  app.post('/api/cards/:id/subtasks', async (request) => {
    const user = requireUser(request)
    const { id } = request.params as { id: string }
    const body = toggleSubtaskBodySchema.parse(request.body)
    const { card } = loadCard(id, user.id)

    const current = parseSubtasks(card.description)[body.index]
    if (!current || current.label !== body.label.trim()) {
      throw conflict('card_subtask_moved', 'The description changed since this list was shown.')
    }
    // Une sous-tâche promue suit sa carte (#71) : la cocher à la main la ferait mentir.
    if (current.card !== null) {
      throw conflict('card_subtask_promoted', 'This subtask follows card #{number}.', { number: current.card })
    }
    if (current.checked === body.checked) return readCard(id, card.projectId)

    const description = toggleSubtask(card.description, body.index, body.checked)
    if (description === null) {
      throw conflict('card_subtask_moved', 'The description changed since this list was shown.')
    }

    ctx.db.update(cards).set({ description, updatedAt: Date.now() }).where(eq(cards.id, id)).run()
    // Les références ne changent pas en cochant une case, mais la description est la
    // source des backlinks : la resynchroniser ici garde un seul chemin d'écriture.
    syncCardReferences(ctx.db, card, description)

    return readCard(id, card.projectId)
  })

  /**
   * Promeut une sous-tâche en carte (#71) : une sœur de celle-ci, et la ligne devient
   * `- [ ] #N libellé`. Rend la carte d'origine, dont la description a changé ; la
   * nouvelle se lit dans la ligne, et le board la montre au rechargement de sa liste.
   */
  app.post('/api/cards/:id/subtasks/promote', async (request, reply) => {
    const user = requireUser(request)
    const { id } = request.params as { id: string }
    const body = promoteSubtaskBodySchema.parse(request.body)
    const { card } = loadCard(id, user.id)

    const created = promoteSubtask(ctx.db, card, body, { userId: user.id })

    return reply.status(201).send({ card: readCard(id, card.projectId), created: readCard(created.id, card.projectId) })
  })

  app.post('/api/projects/:id/cards/order', async (request) => {
    const user = requireUser(request)
    const { id } = request.params as { id: string }
    const body = reorderCardsBodySchema.parse(request.body)
    loadProject(id, user.id)

    // Le kanban ne montre que les feuilles : une carte qui a des enfants n'y est pas,
    // n'entre donc pas dans le compte d'une colonne complète, et ne s'y range pas — sa
    // colonne se déduit de ses enfants.
    const all = ctx.db
      .select({ id: cards.id, column: cards.column, parentId: cards.parentId })
      .from(cards)
      .where(eq(cards.projectId, id))
      .all()
    const parentIds = new Set(all.map((row) => row.parentId).filter((parentId) => parentId !== null))
    const known = new Map(all.filter((row) => !parentIds.has(row.id)).map((row) => [row.id, row.column]))

    const placed = new Set<string>()
    for (const group of body.columns) {
      for (const cardId of group.ids) {
        if (parentIds.has(cardId)) {
          throw badRequest('card_is_parent', 'Card {id} has children; its column follows theirs.', { id: cardId })
        }
        if (!known.has(cardId)) {
          throw badRequest('card_not_in_project', 'Card {id} does not belong to this project.', {
            id: cardId,
          })
        }
        if (placed.has(cardId)) {
          throw badRequest('card_placed_twice', 'Card {id} appears in two columns.', { id: cardId })
        }
        placed.add(cardId)
      }
    }

    // Une colonne réécrite doit l'être en entier. Un envoi partiel laisserait les
    // cartes omises avec leurs anciennes positions, donc intercalées au hasard parmi
    // les nouvelles, et le board afficherait un ordre que personne n'a demandé.
    const touched = new Set(body.columns.map((group) => group.column))
    for (const [cardId, column] of known) {
      if (touched.has(column) && !placed.has(cardId)) {
        throw badRequest(
          'card_column_incomplete',
          'Reordering column {column} requires all of its cards.',
          { column },
        )
      }
    }

    const now = Date.now()
    writeTransaction(ctx.db, (tx) => {
      for (const group of body.columns) {
        group.ids.forEach((cardId, index) => {
          const patch: Partial<typeof cards.$inferInsert> = {
            column: group.column,
            position: index,
          }
          const from = known.get(cardId)
          // Un changement de colonne est un mouvement dans le workflow, pas un simple
          // rangement : il vaut modification. Une réorganisation verticale n'en est
          // pas une et ne doit pas faire remonter toute la colonne en « modifiée ».
          if (from !== group.column) patch.updatedAt = now
          tx.update(cards).set(patch).where(eq(cards.id, cardId)).run()
          // Dans la transaction qui déplace : un glissement qui échoue à mi-chemin ne
          // doit pas laisser au Journal des mouvements qui n'ont pas eu lieu.
          if (from && from !== group.column) {
            recordCardMove(tx, { cardId, from, to: group.column, userId: user.id, at: now })
          }
        })
      }
    })

    return { ok: true }
  })
}

/**
 * Le fil d'une carte, du plus ancien au plus récent.
 *
 * Le titre de la conversation auteure est joint plutôt que son seul identifiant : une
 * note dit ce qu'une session a fait, et « quelle session » se lit par son titre. La
 * jointure est gauche parce que la note lui survit.
 */
export function readNotes(ctx: AppContext, cardId: string): CardNoteDto[] {
  const rows = ctx.db
    .select({
      id: cardNotes.id,
      body: cardNotes.body,
      createdAt: cardNotes.createdAt,
      conversationId: cardNotes.conversationId,
      conversationTitle: conversations.title,
      agent: conversations.agent,
      userName: users.displayName,
    })
    .from(cardNotes)
    .leftJoin(conversations, eq(conversations.id, cardNotes.conversationId))
    .leftJoin(users, eq(users.id, cardNotes.userId))
    .where(eq(cardNotes.cardId, cardId))
    .orderBy(asc(cardNotes.createdAt))
    .all()

  return rows.map((row) => ({
    id: row.id,
    body: row.body,
    createdAt: row.createdAt,
    author:
      row.userName !== null
        ? { kind: 'user' as const, name: row.userName }
        : {
            kind: 'agent' as const,
            agent: row.agent ?? 'claude',
            // Null quand la conversation a été supprimée : la note reste, son lien non.
            conversationId: row.conversationTitle === null ? null : row.conversationId,
            conversationTitle: row.conversationTitle ?? '',
          },
  }))
}

/** Vérifie qu'une carte existe dans ce projet, avant de lui rattacher une conversation. */
export function assertCardInProject(ctx: AppContext, cardId: string, projectId: string): void {
  const row = ctx.db
    .select({ id: cards.id })
    .from(cards)
    .where(and(eq(cards.id, cardId), eq(cards.projectId, projectId)))
    .get()
  if (!row) throw notFound('card_not_found', 'Card not found.')
}

/**
 * Vérifie qu'une carte peut lancer une session : une carte venue de l'extérieur que
 * personne n'a acceptée attend un tri, pas un agent.
 */
export function assertCardAccepted(ctx: AppContext, cardId: string): void {
  const row = ctx.db.select({ acceptedAt: cards.acceptedAt }).from(cards).where(eq(cards.id, cardId)).get()
  if (row && row.acceptedAt === null) {
    throw conflict('card_not_accepted', 'This card has not been accepted yet; it cannot start a session.')
  }
}

/** La carte d'une conversation, pour la puce qui ramène au board depuis le fil. */
export function readCardLink(ctx: AppContext, cardId: string | null): CardLinkDto | null {
  if (!cardId) return null
  const row = ctx.db
    .select({ id: cards.id, number: cards.number, title: cards.title, column: cards.column })
    .from(cards)
    .where(eq(cards.id, cardId))
    .get()
  return row ?? null
}

