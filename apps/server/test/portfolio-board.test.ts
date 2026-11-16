import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { CardConversationDto, CardDto, CardLinkDto, ProjectDto } from '@solera/protocol'

const {
  NO_PORTFOLIO_FILTERS,
  doneCut,
  lanesOf,
  listRows,
  portfolioActive,
  portfolioBoardModel,
  portfolioHref,
  portfolioMatches,
  portfolioPasses,
  projectCounts,
  readLanes,
} = await import('../../web/src/lib/portfolio-board.js')
const { TINT_COUNT } = await import('../../web/src/lib/board-model.js')
const { portfolioSheet, withPortfolioSheet } = await import('../../web/src/lib/card-sheet.js')

/*
 * Le Tableau du portefeuille (#239, `coque.md` PF-22 à PF-27) : les feuilles de tous les
 * projets, chacune avec son projet ; filtres, couloirs (`lanesOf`), cap des faites par
 * couloir, et où mène un clic.
 */

const NOW = new Date(2026, 10, 12, 10).getTime()
const DAY = 86_400_000

const project = (id: string, name = id): ProjectDto => ({ id, name, image: null, color: null, archivedAt: null }) as ProjectDto

const link = (card: Pick<CardDto, 'id' | 'number' | 'title' | 'column'>): CardLinkDto => ({
  id: card.id,
  number: card.number,
  title: card.title,
  column: card.column,
})

const session = (id: string, status: CardConversationDto['status']): CardConversationDto => ({
  id, title: id, agent: 'claude', status, costUsd: 0, worktreeId: null, worktreeName: null, archivedAt: null, createdAt: NOW - DAY,
})

type Card = CardDto & { project: ProjectDto }

const card = (owner: ProjectDto, number: number, extra: Partial<CardDto> = {}): Card =>
  ({
    id: `${owner.id}-${number}`,
    projectId: owner.id,
    number,
    title: `carte ${number}`,
    description: '',
    column: 'todo',
    position: number,
    dueAt: null,
    parent: null,
    milestone: false,
    children: [],
    branch: null,
    branchPr: null,
    refinement: null,
    acceptedAt: NOW - 10 * DAY,
    toClarifySince: null,
    createdAt: NOW - 10 * DAY,
    updatedAt: NOW - 10 * DAY,
    columnSince: NOW - 10 * DAY,
    conversations: [],
    blocks: [],
    blockedBy: [],
    ...extra,
    project: owner,
  }) as Card

function adopt(parent: Card, ...kids: Card[]) {
  for (const kid of kids) kid.parent = link(parent)
  parent.children.push(...kids.map(link))
  parent.milestone = true
}

const alpha = project('alpha', 'Alpha')
const beta = project('beta', 'Beta')
const projects = [alpha, beta]

const model = (cards: Card[]) => portfolioBoardModel(cards, projects, { now: NOW })
const numbers = (entries: { card: CardDto; project: ProjectDto }[]) => entries.map((entry) => `${entry.project.id}#${entry.card.number}`)

/* ------------------------------------------------------------------ données */

test('les feuilles de tous les projets, chacune avec son projet ; ni parente, ni idée, ni abandonnée', () => {
  const milestone = card(alpha, 1)
  const leaf = card(alpha, 2)
  adopt(milestone, leaf)
  const idea = card(beta, 1, { milestone: true })
  const dropped = card(beta, 2, { column: 'abandoned' })
  const other = card(beta, 3)
  const { entries } = model([milestone, leaf, idea, dropped, other])
  assert.deepEqual(numbers(entries), ['alpha#2', 'beta#3'])
  assert.equal(entries[0]!.milestone?.card.number, 1)
  assert.equal(entries[0]!.milestone?.project.id, 'alpha')
})

test('les jalons de tous les projets, dans l’ordre des projets, aux teintes tournantes sur tout le portefeuille', () => {
  const cards: Card[] = []
  const per = TINT_COUNT - 1
  for (const owner of [beta, alpha]) {
    for (let index = 0; index < per; index++) {
      const milestone = card(owner, 100 + index)
      const leaf = card(owner, 200 + index)
      adopt(milestone, leaf)
      cards.push(milestone, leaf)
    }
  }
  const { milestones, entries } = model(cards)
  assert.deepEqual(
    milestones.map((milestone) => milestone.project.id),
    [...Array(per).fill('alpha'), ...Array(per).fill('beta')],
    'les projets dans l’ordre de la liste, pas dans celui des cartes',
  )
  // Deux projets ne se partagent pas une teinte tant que la palette en a.
  assert.deepEqual(
    milestones.map((milestone) => milestone.tint),
    [...Array(2 * per).keys()].map((index) => index % TINT_COUNT),
  )
  // La tuile porte le même jalon, à la teinte du portefeuille.
  const leaf = entries.find((entry) => entry.project.id === 'beta' && entry.card.number === 200)!
  assert.equal(leaf.milestone, milestones.find((milestone) => milestone.card.id === 'beta-100'))
  assert.equal(leaf.milestone?.tint, per % TINT_COUNT)
})

test('le compte par projet : ses feuilles non livrées', () => {
  const { entries } = model([card(alpha, 1), card(alpha, 2, { column: 'done' }), card(alpha, 3, { column: 'review' }), card(beta, 1)])
  const counts = projectCounts(entries)
  assert.equal(counts.get('alpha'), 2)
  assert.equal(counts.get('beta'), 1)
})

/* ------------------------------------------------------------------ recherche et filtres */

test('la recherche : #12 vise un numéro, sinon le titre, celui du jalon et le nom du projet', () => {
  const milestone = card(alpha, 7, { title: 'Refonte' })
  const leaf = card(alpha, 12, { title: 'Brancher le cache' })
  adopt(milestone, leaf)
  const loose = card(beta, 120, { title: 'Autre chose' })
  const { entries } = model([milestone, leaf, loose])
  const find = (query: string) => numbers(entries.filter((entry) => portfolioMatches(entry, query)))
  assert.deepEqual(find('#12'), ['alpha#12', 'beta#120'])
  assert.deepEqual(find('cache'), ['alpha#12'])
  assert.deepEqual(find('refonte'), ['alpha#12'])
  assert.deepEqual(find('beta'), ['beta#120'])
  assert.deepEqual(find('  '), ['alpha#12', 'beta#120'])
})

test('les filtres : projets en « ou », puis t’attend et en retard', () => {
  const waiting = card(alpha, 1, { conversations: [session('s1', 'awaiting_input')] })
  const late = card(alpha, 2, { dueAt: NOW - 3 * DAY })
  const both = card(beta, 3, { dueAt: NOW - 3 * DAY, conversations: [session('s2', 'awaiting_input')] })
  const calm = card(beta, 4)
  const { entries } = model([waiting, late, both, calm])
  const keep = (filters: Partial<typeof NO_PORTFOLIO_FILTERS>) =>
    numbers(entries.filter((entry) => portfolioPasses(entry, { ...NO_PORTFOLIO_FILTERS, ...filters })))
  assert.deepEqual(keep({}), ['alpha#1', 'alpha#2', 'beta#3', 'beta#4'])
  assert.deepEqual(keep({ projects: ['beta'] }), ['beta#3', 'beta#4'])
  assert.deepEqual(keep({ projects: ['alpha', 'beta'] }), ['alpha#1', 'alpha#2', 'beta#3', 'beta#4'])
  assert.deepEqual(keep({ waiting: true }), ['alpha#1', 'beta#3'])
  assert.deepEqual(keep({ late: true }), ['alpha#2', 'beta#3'])
  assert.deepEqual(keep({ waiting: true, late: true }), ['beta#3'])
  assert.deepEqual(keep({ waiting: true, projects: ['alpha'] }), ['alpha#1'])
})

test('un filtre posé par puce', () => {
  assert.equal(portfolioActive(NO_PORTFOLIO_FILTERS), 0)
  assert.equal(portfolioActive({ projects: ['a', 'b'], waiting: true, late: true }), 4)
})

/* ------------------------------------------------------------------ couloirs */

test('sans couloir : un seul groupe, toutes les tuiles', () => {
  const { entries, milestones } = model([card(alpha, 1), card(beta, 1)])
  const lanes = lanesOf(entries, { mode: 'none', projects, milestones })
  assert.equal(lanes.length, 1)
  assert.equal(lanes[0]!.project, null)
  assert.equal(lanes[0]!.milestone, null)
  assert.deepEqual(numbers(lanes[0]!.entries), ['alpha#1', 'beta#1'])
})

test('par projet : un couloir par projet qui a du travail ouvert, dans l’ordre des projets', () => {
  const gamma = project('gamma', 'Gamma')
  const { entries, milestones } = portfolioBoardModel(
    [card(beta, 1), card(alpha, 1), card(alpha, 2, { column: 'done' }), card(gamma, 1, { column: 'done' })],
    [alpha, beta, gamma],
    { now: NOW },
  )
  const lanes = lanesOf(entries, { mode: 'project', projects: [alpha, beta, gamma], milestones })
  assert.deepEqual(lanes.map((lane) => lane.project?.id), ['alpha', 'beta'], 'un projet qui n’a que du fait se tait')
  assert.deepEqual(numbers(lanes[0]!.entries), ['alpha#1', 'alpha#2'], 'les faites restent dans le couloir de leur projet')
  assert.equal(lanes[0]!.key, 'alpha')
})

test('par jalon : les jalons qui ont du travail ouvert, puis « Sans jalon » à la fin', () => {
  const first = card(alpha, 1)
  const kid = card(alpha, 2)
  adopt(first, kid)
  const finished = card(alpha, 3)
  const doneKid = card(alpha, 4, { column: 'done' })
  adopt(finished, doneKid)
  const second = card(beta, 1)
  const betaKid = card(beta, 2)
  adopt(second, betaKid)
  const loose = card(beta, 3)
  const { entries, milestones } = model([first, kid, finished, doneKid, second, betaKid, loose])
  const lanes = lanesOf(entries, { mode: 'milestone', projects, milestones })
  assert.deepEqual(
    lanes.map((lane) => lane.milestone?.card.id ?? lane.key),
    ['alpha-1', 'beta-1', 'none'],
  )
  assert.deepEqual(numbers(lanes.at(-1)!.entries), ['beta#3'])
  assert.equal(lanes[1]!.project?.id, 'beta', 'le couloir d’un jalon dit son projet')
})

test('par jalon, sans carte libre : pas de couloir « Sans jalon »', () => {
  const milestone = card(alpha, 1)
  const kid = card(alpha, 2)
  adopt(milestone, kid)
  const { entries, milestones } = model([milestone, kid])
  assert.deepEqual(lanesOf(entries, { mode: 'milestone', projects, milestones }).map((lane) => lane.key), ['alpha-1'])
})

test('une recherche qui ne trouve que du fait garde son couloir : on voit ce qu’on cherchait', () => {
  const { entries, milestones } = model([card(alpha, 1, { column: 'done' }), card(beta, 1)])
  const done = entries.filter((entry) => entry.project.id === 'alpha')
  assert.deepEqual(lanesOf(done, { mode: 'project', projects, milestones }), [], 'au repos, un projet fini se tait')
  assert.deepEqual(
    lanesOf(done, { mode: 'project', projects, milestones, narrowed: true }).map((lane) => lane.key),
    ['alpha'],
  )
  assert.deepEqual(lanesOf([], { mode: 'project', projects, milestones, narrowed: true }), [], 'un couloir vide ne se montre jamais')
})

test('les couloirs retenus : une valeur qui n’a plus cours reprend « Par projet »', () => {
  assert.equal(readLanes(JSON.stringify('milestone')), 'milestone')
  assert.equal(readLanes(JSON.stringify('none')), 'none')
  for (const raw of [null, '', '{', JSON.stringify('lanes'), JSON.stringify(3)]) assert.equal(readLanes(raw), 'project', String(raw))
})

/* ------------------------------------------------------------------ Fait, Liste */

test('Fait : les cinq plus récentes par couloir, puis « Tout voir (N) »', () => {
  const cards = [...Array(7).keys()].map((index) => card(alpha, index + 1, { column: 'done', columnSince: NOW - index * DAY }))
  const { entries } = model(cards)
  const capped = doneCut(entries, false)
  assert.deepEqual(capped.shown.map((entry) => entry.card.number), [1, 2, 3, 4, 5])
  assert.equal(capped.total, 7)
  assert.equal(doneCut(entries, true).shown.length, 7)
})

test('la Liste : sans les faites, ce qui t’attend puis à vérifier, en cours, à faire', () => {
  const { entries } = model([
    card(alpha, 1, { column: 'todo' }),
    card(alpha, 2, { column: 'done' }),
    card(alpha, 3, { column: 'in_progress' }),
    card(beta, 4, { column: 'review' }),
    card(beta, 5, { column: 'todo', conversations: [session('s', 'awaiting_input')] }),
  ])
  assert.deepEqual(numbers(listRows(entries)), ['beta#5', 'beta#4', 'alpha#3', 'alpha#1'])
})

/* ------------------------------------------------------------------ clic */

test('le clic : la fiche du portefeuille pour une carte qui t’attend, sinon sa session, sinon un brouillon', () => {
  const waiting = card(alpha, 4, { conversations: [session('s1', 'awaiting_input')] })
  const running = card(alpha, 5, { conversations: [session('s2', 'running')] })
  const bare = card(beta, 6)
  const { entries } = model([waiting, running, bare])
  const at = (number: number) => entries.find((entry) => entry.card.number === number)!
  const search = new URLSearchParams('vue=liste')
  assert.equal(portfolioHref(at(4), { search }), '?vue=liste&fiche=alpha%3A4')
  assert.equal(portfolioHref(at(5), { search }), '/p/alpha/c/s2')
  assert.equal(portfolioHref(at(6), { search }), '/p/beta/c/new?card=beta-6')
  // Le statut vivant prime sur celui du chargement.
  assert.equal(portfolioHref(at(5), { search, statusOf: () => 'awaiting_input' }), '?vue=liste&fiche=alpha%3A5')
})

test('la fiche du portefeuille : projet et numéro dans `?fiche=`, une adresse abîmée ne rouvre rien', () => {
  const params = withPortfolioSheet(new URLSearchParams('vue=kanban'), { projectId: 'p-1', number: 12 })
  assert.equal(params.get('vue'), 'kanban')
  assert.deepEqual(portfolioSheet(params), { projectId: 'p-1', number: 12 })
  assert.equal(portfolioSheet(withPortfolioSheet(params, null)), null)
  for (const raw of ['12', 'p:', ':12', 'p:0', 'p:-3', 'p:1.5', 'p:abc']) {
    assert.equal(portfolioSheet(new URLSearchParams({ fiche: raw })), null, raw)
  }
})
