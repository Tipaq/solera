import { actionRunStatusOf, type ProjectActionDto, type TerminalDto } from '@solera/protocol'
import { actionRoot, type OutputSummary } from './command-output'
import type { MessageKey, MessageParams } from './i18n'

/**
 * **Les commandes lancées ici** : les terminaux qu'une action a ouverts depuis cette
 * conversation (hors conversation, depuis la racine du projet). Pur, pour être testé
 * (`apps/server/test/command-runs.test.ts`) ; la lecture des terminaux et de leur sortie
 * vit dans `components/panel/CommandRuns.tsx`.
 */

type Translate = (key: MessageKey, params?: MessageParams) => string

/**
 * `stopped` : sortie en 128 + n d'un arrêt (Ctrl-C, fermeture, SIGTERM), qu'on lit
 * « arrêtée » et pas « échouée » ; `interrupted` : un redémarrage de Solera a emporté
 * son process, et sa fin n'a pas été vue.
 */
export type CommandRunStatus = 'running' | 'succeeded' | 'failed' | 'stopped' | 'interrupted'

export interface CommandRun {
  terminalId: string
  /** Null quand l'action a été supprimée depuis : le terminal, lui, est resté. */
  action: ProjectActionDto | null
  label: string
  command: string
  status: CommandRunStatus
  exitCode: number | null
  startedAt: number
  finishedAt: number | null
  /** Le dossier de la commande. */
  cwd: string
  /** La racine de l'arbre où elle tourne, pour ouvrir ses fichiers dans Fichiers. */
  root: string | null
}

function statusOf(terminal: TerminalDto): CommandRunStatus {
  if (terminal.alive) return 'running'
  if (terminal.interrupted || terminal.exitCode === null) return 'interrupted'
  return actionRunStatusOf(terminal.exitCode)
}

/** Ce qui tourne d'abord, puis le plus récent. */
export function commandRunsOf(
  terminals: readonly TerminalDto[],
  actions: readonly ProjectActionDto[],
  conversationId?: string,
): CommandRun[] {
  const byId = new Map(actions.map((action) => [action.id, action]))
  return terminals
    .filter((terminal) => terminal.actionId !== null && terminal.conversationId === (conversationId ?? null))
    .map((terminal): CommandRun => {
      const action = byId.get(terminal.actionId!) ?? null
      return {
        terminalId: terminal.id,
        action,
        label: action?.label ?? terminal.title,
        command: action?.command ?? terminal.title,
        status: statusOf(terminal),
        exitCode: terminal.exitCode,
        startedAt: terminal.createdAt,
        finishedAt: terminal.finishedAt,
        cwd: terminal.cwd,
        root: actionRoot(terminal.cwd, action?.subdir ?? null),
      }
    })
    .sort((a, b) => Number(b.status === 'running') - Number(a.status === 'running') || b.startedAt - a.startedAt)
}

/** « 38 s », « 1 min 05 », « 2 h 05 » : à la seconde, pour qu'une durée en cours avance. */
export function runDuration(ms: number, t: Translate): string {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  if (seconds < 60) return t('panel.runs.duration.seconds', { count: seconds })
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return t('panel.runs.duration.minutes', { minutes, seconds: String(seconds % 60).padStart(2, '0') })
  return t('panel.runs.duration.hours', { hours: Math.floor(minutes / 60), minutes: String(minutes % 60).padStart(2, '0') })
}

/** Combien de temps elle a tourné ; null quand sa fin n'est pas connue. */
function tookMs(run: CommandRun, now: number): number | null {
  if (run.status === 'running') return now - run.startedAt
  return run.finishedAt === null ? null : run.finishedAt - run.startedAt
}

/** « 3 tests en échec », « 12 erreurs » : ce que la sortie dit de l'échec. */
function failureCount(summary: OutputSummary | null, t: Translate): string | null {
  if (!summary) return null
  const plural = (count: number, base: 'panel.runs.testsFailed' | 'panel.runs.errors' | 'panel.runs.warnings') =>
    t(`${base}.${count === 1 ? 'one' : 'other'}`, { count })
  if (summary.tests.length > 0) return plural(summary.tests.length, 'panel.runs.testsFailed')
  const issues = summary.lint.flatMap((file) => file.issues)
  const errors = issues.filter((issue) => issue.severity === 'error').length
  if (errors > 0) return plural(errors, 'panel.runs.errors')
  return issues.length > 0 ? plural(issues.length, 'panel.runs.warnings') : null
}

/** La méta d'une ligne : la durée qui avance, ou le verdict, sa durée et ce qui a échoué. */
export function runMeta(run: CommandRun, now: number, summary: OutputSummary | null, t: Translate): string {
  const took = tookMs(run, now)
  const duration = took === null ? null : runDuration(took, t)
  if (run.status === 'running') return duration!
  const verdict =
    run.status === 'failed' && run.exitCode !== null
      ? t('panel.runs.status.failedCode', { code: run.exitCode })
      : t(`panel.runs.status.${run.status}`)
  const failure = run.status === 'failed' ? failureCount(summary, t) : null
  return [verdict, duration, failure].filter(Boolean).join(' · ')
}

/** La phrase d'état en tête du détail. `ago` : depuis quand elle est finie, déjà mis en mots. */
export function runSentence(run: CommandRun, now: number, summary: OutputSummary | null, t: Translate, ago: string): string {
  if (run.status === 'interrupted') return t('panel.runs.sentence.interrupted')
  const took = tookMs(run, now)
  if (took === null) return t(`panel.runs.status.${run.status}`)
  const duration = runDuration(took, t)
  switch (run.status) {
    case 'running':
      return t('panel.runs.sentence.running', { duration })
    case 'succeeded':
      return [t('panel.runs.sentence.succeeded', { duration }), ago].filter(Boolean).join(' · ')
    case 'stopped':
      return t('panel.runs.sentence.stopped', { duration })
    case 'failed': {
      const head =
        run.exitCode === null
          ? t('panel.runs.sentence.failed', { duration })
          : t('panel.runs.sentence.failedCode', { code: run.exitCode, duration })
      return [head, summary?.totals].filter(Boolean).join(' · ')
    }
  }
}
