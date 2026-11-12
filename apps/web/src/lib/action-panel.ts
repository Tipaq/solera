import type { RunTone, StripRun } from '@solera/ui'
import type { EditorSeed } from './action-editor'
import { RUN_VERDICTS, formatDateTime, type Automation, type Translate, type UnifiedRun, type VerdictTone } from './automations'

/**
 * Le tiroir unifié d'une action (`actions.md` §1.C, §1.D) : ce qu'il montre, où l'on
 * remonte, et ce que le détail lit d'une action. Pur : `ActionDrawer` et `ActionDetail`
 * le rendent, les tests le lisent seul.
 *
 * Un seul tiroir, quatre modes :
 * - `detail` : l'action ; `review` quand on l'ouvre par « Relire » (DET-3) ;
 * - `edit` : l'éditeur, avec `back`, l'action d'où l'on vient (« Modifier », « Dupliquer »,
 *   « Planifier ») pour y revenir à l'annulation (TIRA-2) ;
 * - `pick` : « Planifier une action existante » (TIRA-7) ;
 * - `run` : le passage d'une commande qui tourne, ouvert par « Terminal » du détail.
 */
export type ActionPanel =
  | { mode: 'detail'; id: string; review?: boolean }
  | { mode: 'edit'; seed: EditorSeed; back: string | null }
  | { mode: 'pick' }
  | { mode: 'run'; terminalId: string; back: string }

/** Les entrées de « + Action ▾ » : la nature d'abord, ou planifier une action qui existe. */
export type NewActionKind = 'command' | 'service' | 'agent' | 'schedule' | 'any'

export function newActionPanel(kind: NewActionKind): ActionPanel {
  if (kind === 'schedule') return { mode: 'pick' }
  const seed: EditorSeed =
    kind === 'command'
      ? { preset: { what: 'command', kind: 'task' } }
      : kind === 'service'
        ? { preset: { what: 'command', kind: 'service' } }
        : kind === 'agent'
          ? { preset: { what: 'agent' } }
          : {}
  return { mode: 'edit', seed, back: null }
}

/** Les valeurs de `?nouvelle=`, telles qu'un lien les écrit. */
const NEW_PARAMS: Record<string, NewActionKind> = {
  '1': 'any',
  commande: 'command',
  service: 'service',
  agent: 'agent',
  planifier: 'schedule',
}

/** `?nouvelle=` : l'éditeur pré-réglé, ou le choix d'une action à planifier ; null sinon. */
export function actionPanelOf(value: string | null): ActionPanel | null {
  const kind = value === null ? undefined : NEW_PARAMS[value]
  return kind ? newActionPanel(kind) : null
}

/**
 * Remonter d'un niveau (‹, Échap, Annuler) : de l'édition ou d'un passage au détail d'où
 * l'on vient ; null quand il n'y a plus qu'à fermer.
 */
export function panelBack(panel: ActionPanel): ActionPanel | null {
  if (panel.mode === 'edit' && panel.back) return { mode: 'detail', id: panel.back }
  if (panel.mode === 'run') return { mode: 'detail', id: panel.back }
  return null
}

/** L'action que le panneau montre : celle du détail ou du passage ; null si elle a disparu. */
export function panelItem(panel: ActionPanel, items: readonly Automation[]): Automation | null {
  const id = panel.mode === 'detail' ? panel.id : panel.mode === 'run' ? panel.back : null
  return id === null ? null : (items.find((item) => item.id === id) ?? null)
}

/** Le nom accessible du tiroir, selon ce qu'il montre (TIRA-1). */
export function panelLabel(panel: ActionPanel, item: Automation | null, t: Translate): string {
  switch (panel.mode) {
    case 'edit':
      return panel.seed.from ? t('actionDrawer.label.edit', { label: panel.seed.from.label }) : t('actionDrawer.label.new')
    case 'pick':
      return t('actionDrawer.label.pick')
    case 'run':
      return t('actionDrawer.label.run', { label: item?.label ?? '' })
    case 'detail':
      return item?.label ?? t('actionDrawer.label.detail')
  }
}

/**
 * La clé de l'éditeur : une graine d'une autre forme le remonte à neuf (EDI-1), la même
 * action relue après un enregistrement ne le fait pas.
 */
export function editorKey(seed: EditorSeed): string {
  const from = seed.from ? `from:${seed.from.id}` : seed.draft ? 'draft' : 'new'
  return [from, seed.schedule ? 'when' : 'what', seed.preset?.what ?? '', seed.preset?.kind ?? ''].join('|')
}

/** Ce que « Planifier une action existante » propose : ni le déjà planifié, ni ce qui attend une relecture. */
export function pickable(items: readonly Automation[]): Automation[] {
  return items.filter((item) => !item.schedule && !item.review)
}

/* ------------------------------------------------------------------ la relecture (DET-4) */

export type ReviewField = 'command' | 'subdir' | 'url'

export interface ReviewChange {
  field: ReviewField
  before: string | null
  after: string | null
}

/**
 * Ce qu'on relit : la commande telle qu'elle partirait, et ce qui a changé depuis la
 * dernière validation quand un agent a modifié une commande déjà validée ; ou le script
 * de vérification d'une tâche. Null hors relecture.
 */
export type ReviewContent =
  | { kind: 'command'; command: string; subdir: string | null; url: string | null; changes: ReviewChange[] }
  | { kind: 'script'; script: string }

export function reviewOf(item: Automation): ReviewContent | null {
  if (!item.review) return null
  if (item.source.kind === 'task') {
    return item.source.task.check ? { kind: 'script', script: item.source.task.check.script } : null
  }
  const { command, subdir, url, approved } = item.source.action
  const changes: ReviewChange[] = []
  if (approved) {
    const now: Record<ReviewField, string | null> = { command, subdir, url }
    for (const field of ['command', 'subdir', 'url'] as const) {
      if (approved[field] !== now[field]) changes.push({ field, before: approved[field], after: now[field] })
    }
  }
  return { kind: 'command', command, subdir, url, changes }
}

/* ------------------------------------------------------------------ les passages (DET-8) */

/** Combien la frise et la liste en montrent. */
export const STRIP_RUNS = 20
export const LISTED_RUNS = 12

const STRIP_TONE: Record<VerdictTone, RunTone> = {
  accent: 'running',
  positive: 'positive',
  critical: 'critical',
  caution: 'caution',
  neutral: 'neutral',
}

/** Le verdict d'un passage en un mot : « code 2 » quand on le connaît, sinon « réussi », « en cours »… */
export function runVerdict(run: UnifiedRun, t: Translate): string {
  return run.exitCode != null ? t('actionDetail.run.code', { code: run.exitCode }) : t(RUN_VERDICTS[run.status].label)
}

/** La frise : les vingt derniers passages, du plus ancien au plus récent, datés en infobulle. */
export function stripOf(runs: readonly UnifiedRun[], t: Translate, locale: string, timeZone?: string): StripRun[] {
  return runs
    .slice(0, STRIP_RUNS)
    .reverse()
    .map((run) => ({
      id: run.id,
      tone: STRIP_TONE[RUN_VERDICTS[run.status].tone],
      title: [formatDateTime(run.startedAt, locale, timeZone), t(RUN_VERDICTS[run.status].label), run.exitCode != null ? t('actionDetail.run.code', { code: run.exitCode }) : null]
        .filter((part): part is string => part !== null)
        .join(' · '),
    }))
}

/** Un passage se déplie quand il a une sortie ou une erreur à montrer. */
export const runExpandable = (run: UnifiedRun): boolean => Boolean(run.excerpt || run.error)

/** Le premier passage listé qui a quelque chose à montrer, déplié d'office. */
export function firstOpenRun(runs: readonly UnifiedRun[]): string | null {
  return runs.slice(0, LISTED_RUNS).find(runExpandable)?.id ?? null
}

/* ------------------------------------------------------------------ l'origine (DET-9) */

export type Origin =
  | { by: 'agent'; conversationId: string; title: string | null; at: number }
  | { by: 'you'; at: number }

/** Proposée par un agent dans une session (la dernière qui l'a écrite), ou créée par toi. */
export function originOf(item: Automation): Origin {
  if (item.source.kind === 'action') {
    const { agentConversationId, agentConversationTitle, createdAt } = item.source.action
    return agentConversationId
      ? { by: 'agent', conversationId: agentConversationId, title: agentConversationTitle, at: createdAt }
      : { by: 'you', at: createdAt }
  }
  return { by: 'you', at: item.source.task.createdAt }
}

/* ------------------------------------------------------------------ la pause (DET-11) */

/**
 * L'action telle qu'elle sera une fois la pause enregistrée : le détail la montre tout de
 * suite, puces, phrase et prochains passages compris. Sans planification, rien ne change.
 */
export function withPaused(item: Automation, paused: boolean): Automation {
  if (!item.schedule || item.schedule.enabled === !paused) return item
  return { ...item, schedule: { ...item.schedule, enabled: !paused } }
}
