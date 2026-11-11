/* PROTOTYPE — jetable (branche proto/page-projet). Ne pas fusionner dans main. */
import { useMemo } from 'react'
import { useLocation, useSearchParams } from 'react-router-dom'
import type { CardColumn, CardConversationDto, CardDto, CardLinkDto, ConversationStatus } from '@solera/protocol'
import { useCards } from '../../lib/cards'
import { useActiveMilestones } from '../../lib/milestones'
import { milestoneIdsOf, milestonesOf, type Milestone } from '../../lib/timeline'
import { flagDemoCard } from './flags'
import { useDemoStore, type DemoRefine, type DemoRun, type DemoSnapshot } from './demo-store'

export const DAY = 86_400_000

/* ------------------------------------------------------------------ état d'une carte */

/** L'état qu'une barre ou un nœud montre : la colonne, plus « bloqué » déduit des liens. */
export type CardState = 'todo' | 'blocked' | 'running' | 'review' | 'done' | 'abandoned'

export const STATE_LABEL: Record<CardState, string> = {
  todo: 'À faire',
  blocked: 'Bloquée',
  running: 'En cours',
  review: 'À relire',
  done: 'Faite',
  abandoned: 'Abandonnée',
}

/** Barre de Gantt : fond + texte. */
export const STATE_BAR: Record<CardState, string> = {
  todo: 'bg-surface-high text-ink-soft border border-line-strong',
  blocked: 'bg-caution/15 text-caution border border-caution/40',
  running: 'bg-accent/25 text-accent border border-accent/50',
  review: 'bg-positive/15 text-positive border border-positive/40',
  done: 'bg-positive/30 text-positive border border-positive/50',
  abandoned: 'bg-surface-high text-ink-faint border border-dashed border-line opacity-60',
}

/** Nœud de graphe : cadre + fond. */
export const STATE_NODE: Record<CardState, string> = {
  todo: 'border-line-strong bg-surface',
  blocked: 'border-caution/60 bg-caution/8',
  running: 'border-accent/70 bg-accent-wash/60',
  review: 'border-positive/60 bg-positive/8',
  done: 'border-positive/40 bg-positive/5 opacity-75',
  abandoned: 'border-dashed border-line opacity-50',
}

/** Pastille d'état. */
export const STATE_DOT: Record<CardState, string> = {
  todo: 'bg-ink-faint',
  blocked: 'bg-caution',
  running: 'bg-accent',
  review: 'bg-positive',
  done: 'bg-positive',
  abandoned: 'bg-line-strong',
}

/** Couleur de trait (SVG) d'une arête selon l'état de la carte qui bloque. */
export const STATE_STROKE: Record<CardState, string> = {
  todo: 'var(--color-line-strong, #888)',
  blocked: 'var(--color-caution, #d97706)',
  running: 'var(--color-accent, #6366f1)',
  review: 'var(--color-positive, #16a34a)',
  done: 'var(--color-positive, #16a34a)',
  abandoned: 'var(--color-line, #aaa)',
}

const CLOSED: CardColumn[] = ['done', 'abandoned']

export function stateOf(card: CardDto): CardState {
  if (card.column === 'done') return 'done'
  if (card.column === 'abandoned') return 'abandoned'
  if (card.column === 'review') return 'review'
  if (card.blockedBy.some((blocker) => !CLOSED.includes(blocker.column))) return 'blocked'
  if (card.column === 'in_progress') return 'running'
  return 'todo'
}

export function isOpen(card: CardDto): boolean {
  return !CLOSED.includes(card.column)
}

export function isLate(card: CardDto, at = Date.now()): boolean {
  return isOpen(card) && card.dueAt !== null && card.dueAt < at
}

/** Les sessions vivantes d'une carte : qui tourne, qui attend quelqu'un. */
export function liveSessions(card: CardDto): CardConversationDto[] {
  return card.conversations.filter(
    (session) => !session.archivedAt && (session.status === 'running' || session.status === 'awaiting_input'),
  )
}

/**
 * Une carte dont une session attend Tim (question, permission) : le repère ambre des
 * vues de jalon (décidé le 2026-11-11). La demande elle-même vit dans « Ce qui
 * t'attend » ; ici on ne fait que la montrer du doigt.
 */
export function awaitsMe(card: CardDto): boolean {
  return card.conversations.some((session) => !session.archivedAt && session.status === 'awaiting_input')
}

/* ------------------------------------------------------------------ données */

export interface ProtoData {
  cards: CardDto[]
  milestones: Milestone[]
  milestoneIds: Set<string>
  /** Cartes datées sans jalon, ni jalon elles-mêmes. */
  loose: CardDto[]
  /** Ids des jalons lancés (réels, ou le premier en démo). */
  launched: Set<string>
  /** Début du pilotage par jalon lancé : sert au « périmètre qui grossit ». */
  runStart: Map<string, number>
  /** Concurrence du pilotage par jalon lancé. */
  runConcurrency: Map<string, number>
  demo: boolean
  isPending: boolean
  /** Démo à états : le pilotage simulé de chaque jalon lancé, par id de jalon. */
  runs: Record<string, DemoRun>
  /** Démo à états : l'affinage simulé (questions, brouillon), par id de jalon. */
  refine: Record<string, DemoRefine>
  /** Le magasin de démo, pour `runStatusOf`. `null` hors démo. */
  store: DemoSnapshot | null
}

/** Les cartes du projet, ou le jeu de démo quand `?demo=1`. */
export function useProtoData(projectId: string | undefined): ProtoData {
  const [params] = useSearchParams()
  const demo = params.get('demo') === '1'
  const { data: real, isPending } = useCards(demo ? undefined : projectId)
  const { data: runs } = useActiveMilestones(demo ? undefined : projectId)
  const store = useDemoStore(demo)

  return useMemo(() => {
    const cards = demo ? (store?.cards ?? []).map((card) => ({ ...card, projectId: projectId ?? 'demo' })) : (real ?? [])
    const milestones = milestonesOf(cards)
    const milestoneIds = milestoneIdsOf(cards)
    const loose = cards.filter(
      (card) => card.parent === null && card.dueAt !== null && card.column !== 'abandoned' && !milestoneIds.has(card.id),
    )
    const demoRuns = Object.values(store?.runs ?? {})
    const launched = new Set(demo ? demoRuns.filter((run) => !run.merged).map((run) => run.milestoneId) : (runs ?? []).map((run) => run.cardId))
    const runStart = new Map<string, number>(
      demo ? demoRuns.map((run) => [run.milestoneId, run.startedAt]) : (runs ?? []).map((run) => [run.cardId, run.createdAt]),
    )
    const runConcurrency = new Map<string, number>(
      demo ? demoRuns.map((run) => [run.milestoneId, run.concurrency]) : (runs ?? []).map((run) => [run.cardId, run.concurrency]),
    )
    return {
      cards, milestones, milestoneIds, loose, launched, runStart, runConcurrency, demo,
      isPending: demo ? false : isPending,
      runs: store?.runs ?? {},
      refine: store?.refine ?? {},
      store,
    }
  }, [demo, real, runs, projectId, isPending, store])
}

/** Garde `?demo=1` dans les liens internes du prototype. */
export function useProtoHref() {
  const [params] = useSearchParams()
  const { pathname } = useLocation()
  const demo = params.get('demo') === '1'
  return (path: string) => {
    // `?fiche=N` (une carte de démo, voir `cardDestination`) : la page courante, fiche ouverte.
    if (path.startsWith('?fiche=')) {
      const next = new URLSearchParams(params)
      next.set('fiche', path.slice('?fiche='.length))
      return `${pathname}?${next.toString()}`
    }
    return demo ? `${path}${path.includes('?') ? '&' : '?'}demo=1` : path
  }
}

/* ------------------------------------------------------------------ jeu de démo */

function link(card: CardDto): CardLinkDto {
  return { id: card.id, number: card.number, title: card.title, column: card.column }
}

function session(id: string, title: string, status: ConversationStatus, agent: CardConversationDto['agent'] = 'claude'): CardConversationDto {
  return { id, title, agent, status, costUsd: 0, worktreeId: null, worktreeName: `feat/${id}`, archivedAt: null, createdAt: Date.now() - DAY }
}

/**
 * Trois jalons et une poignée de cartes isolées, avec des dépendances, du retard, des
 * sessions qui tournent. Numéros à partir de 901 pour ne pas se confondre avec le vrai board.
 */
export function demoCards(projectId: string): CardDto[] {
  const now = Date.now()
  const at = (days: number) => now + days * DAY
  let next = 900
  const all: CardDto[] = []

  const make = (
    title: string,
    column: CardColumn,
    created: number,
    due: number | null,
    extra: Partial<CardDto> = {},
  ): CardDto => {
    next += 1
    const card: CardDto = {
      id: `demo-${next}`,
      projectId,
      number: next,
      title,
      description: '',
      column,
      position: next,
      dueAt: due === null ? null : at(due),
      parent: null,
      children: [],
      acceptedAt: at(created),
      toClarifySince: null,
      createdBy: 'tim',
      createdByName: 'Tim',
      createdAt: at(created),
      updatedAt: at(created),
      columnSince: at(created),
      conversations: [],
      attachmentCount: 0,
      noteCount: 0,
      references: [],
      referencedBy: [],
      blocks: [],
      blockedBy: [],
      related: [],
      duplicateOf: null,
      duplicates: [],
      issue: null,
      ...extra,
    }
    all.push(card)
    return card
  }

  const depend = (card: CardDto, ...blockers: CardDto[]) => {
    for (const blocker of blockers) {
      card.blockedBy.push(link(blocker))
      blocker.blocks.push(link(card))
    }
  }

  const adopt = (parent: CardDto, ...kids: CardDto[]) => {
    for (const kid of kids) {
      kid.parent = link(parent)
      parent.children.push(link(kid))
    }
  }

  // Jalon 1 — en cours, lancé, avec du retard sur une carte.
  const m1 = make('Page projet v2', 'in_progress', -24, 12)
  const a = make('Modèle des worktrees et PR côté serveur', 'done', -24, -10)
  const b = make('Bloc « Le code en cours » sur l’Aperçu', 'review', -18, -2, {
    conversations: [session('code-en-cours', 'Bloc code en cours', 'awaiting_input')],
  })
  const c = make('Gantt des jalons', 'in_progress', -14, 6, {
    conversations: [session('gantt', 'Gantt des jalons', 'running')],
  })
  const d = make('Graphe de dépendances d’un jalon', 'in_progress', -12, 8, {
    conversations: [session('graphe', 'Graphe d’un jalon', 'running', 'codex')],
  })
  const e = make('Fusion Activité + Journal', 'todo', -10, 10)
  const f = make('Réglages par sections', 'todo', -9, 12)
  const g = make('Captures et revue finale', 'todo', -5, 12)
  adopt(m1, a, b, c, d, e, f, g)
  depend(b, a)
  depend(c, a)
  depend(d, c)
  depend(e, b)
  depend(g, c, d, e, f)

  // Jalon 2 — prêt : découpé, ordonné, rien à préciser, pas encore lancé.
  const m2 = make('Accès distant fiable', 'todo', -6, 34, { position: 1 })
  const h = make('Diagnostic des coupures Tailscale', 'in_progress', -6, 4, {
    conversations: [session('tailscale', 'Diagnostic Tailscale', 'running')],
  })
  const i = make('Adresse de secours dans l’app', 'todo', -4, 20)
  const j = make('Reprise du service worker hors ligne', 'todo', -3, 26)
  const k = make('Notifications push par IP', 'todo', -2, null)
  const l = make('Doc d’installation mobile', 'todo', -1, 34)
  adopt(m2, h, i, j, k, l)
  depend(i, h)
  depend(j, h)
  depend(k, i)
  depend(l, i, j, k)

  // Jalon 3 — livré.
  const m3 = make('Comptes Claude nommés', 'done', -45, -20)
  const n = make('Adresse depuis la jauge', 'done', -45, -30)
  const o = make('Alias facultatif', 'done', -40, -25)
  const p = make('Migration des comptes existants', 'done', -38, -22)
  adopt(m3, n, o, p)
  depend(o, n)
  depend(p, n)

  // Jalon 4 — à affiner : une carte à préciser, une autre pas encore acceptée, des questions.
  const m4 = make('Activité et Journal fusionnés', 'todo', -4, null, { position: 3 })
  const q1 = make('Fil unique : vivant en haut, historique en dessous', 'todo', -4, null, { toClarifySince: at(-2) })
  const q2 = make('Filtres par nature dans le fil', 'todo', -3, null)
  const q3 = make('Import des issues GitHub dans le fil', 'todo', -1, null, { acceptedAt: null })
  adopt(m4, q1, q2, q3)
  depend(q2, q1)

  // Jalon 5 — découpé mais pas prêt : un cycle de blocages entre deux cartes.
  const m5 = make('Réglages par sections', 'todo', -7, 28, { position: 2 })
  const r1 = make('Navigation par sections', 'todo', -7, null)
  const r2 = make('Section Agents : instructions, mémoire, skills', 'todo', -6, null)
  const r3 = make('Section Intégrations : forge, design system', 'todo', -6, null)
  const r4 = make('Zone de danger', 'todo', -5, null)
  adopt(m5, r1, r2, r3, r4)
  depend(r2, r1)
  depend(r3, r1)
  depend(r1, r3) // le cycle
  depend(r4, r2)

  // Idées de jalons : pas encore d'enfants, mais le drapeau « jalon » posé (SIMULÉ, `flags.ts`).
  flagDemoCard(make('Mode hors ligne complet', 'todo', -2, null, { description: 'Tout lire sans réseau.', position: 5 }).id)
  flagDemoCard(make('Projets partagés en équipe', 'todo', -12, null, { description: 'Inviter, rôles, présence.', position: 6 }).id)

  // Cartes datées hors jalon.
  make('Publier v0.20', 'todo', -3, 5)
  make('Budget du bundle à revoir', 'todo', -20, -4)

  return all
}

/* ------------------------------------------------------------------ simulé : cap et questions */

/** Le cap du jeu de démo. SIMULÉ : rien ne le porte côté serveur. */
export const DEMO_CAP = 'Piloter mes projets de bout en bout depuis Solera, au PC comme au téléphone, sans perdre le fil.'

/** Une question d'affinage posée par l'agent sur un jalon. SIMULÉ. */
export interface RefineQuestion {
  id: string
  text: string
  askedBy: string
  at: number
}

