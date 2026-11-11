/* PROTOTYPE — jetable (branche proto/page-projet). Ne pas fusionner dans main.
 *
 * **Les commandes lancées ici**, dans l'onglet Actions du panneau : ce qui tourne, avec la
 * durée qui avance et « Arrêter », puis le résultat de ce qui vient de finir — et, au
 * clic, le détail en pile avec la sortie et, pour des tests ou du lint, **ce qui a
 * échoué et comment** (Tim, 2026-11-11).
 *
 * Ce qui est réel :
 * - une commande de projet (`kind: task`) se joue dans un **terminal du panneau** :
 *   `GET /api/projects/:id/terminals` dit lequel (`actionId`), s'il vit (`alive`) et son
 *   code de sortie (`exitCode`) ;
 * - le serveur garde **les 128 derniers Ko** de sortie de chaque terminal (tampon de
 *   restitution, écrit aussi sur disque) et les renvoie à qui s'attache à la socket
 *   `/api/projects/:id/terminal?terminalId=…` (`ready.replay`, puis `output`, puis
 *   `exit`). Le détail s'y attache **en lecture seule** : il n'envoie rien, pas même la
 *   taille de l'écran.
 * Ce qui est simulé :
 * - **Arrêter** : il n'existe que deux façons, toutes deux des écritures — fermer le
 *   terminal (`DELETE …/terminals/:id`, qui tue le process *et* efface l'écran) ou
 *   envoyer Ctrl-C par la socket (`{ t: 'input', data: '\x03' }`). Ni l'une ni l'autre
 *   n'est faite ici ;
 * - **Relancer** et **Relancer seulement les échecs** ;
 * - la **durée** d'une commande finie : le terminal ne retient que sa création ;
 * - en démo (`?demo=1`) : un lint qui tourne, des tests qui viennent d'échouer, un
 *   typecheck réussi.
 */
import { ChevronLeft, ChevronRight, CircleCheck, CircleX, FileCode2, Loader, RotateCcw, Square, SquareTerminal, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { TerminalServerMessage } from '@solera/protocol'
import { cx } from '@solera/ui'
import { useActions } from '../../../lib/actions'
import { elapsed } from '../../../lib/dates'
import { openTab } from '../../../lib/editor-tabs'
import { revealLine } from '../../../lib/editor-reveal'
import { setPanelTab, showTerminal } from '../../../lib/panel'
import { useTerminals } from '../../../lib/terminals'
import { projectScope } from '../../../lib/workspace-scope'
import { DEMO_LINT_LINES, DEMO_TEST_OUTPUT, DEMO_TYPECHECK_OUTPUT, relativePath, stripAnsi, summarize, type FailedTest, type LintFile, type OutputSummary } from './commandOutput'

const SEC = 1000
const MIN = 60 * SEC

export interface CommandRun {
  id: string
  label: string
  command: string
  status: 'running' | 'succeeded' | 'failed' | 'stopped'
  exitCode: number | null
  startedAt: number
  /** Connue en démo seulement : le terminal ne garde pas sa fin. */
  finishedAt: number | null
  terminalId: string | null
  cwd: string | null
  /** La sortie, quand on l'a sans socket (démo). */
  output: string | null
  demo: boolean
}

/* ------------------------------------------------------------------ données */

/**
 * Les commandes lancées depuis cette conversation (ou depuis la racine, hors
 * conversation) : les terminaux du panneau qu'une action a ouverts.
 */
export function useCommandRuns(projectId: string, conversationId?: string): CommandRun[] {
  const [params] = useSearchParams()
  const demo = params.get('demo') === '1'
  const { data: terminals } = useTerminals(projectId, !demo)
  const { data: actions } = useActions()
  const demoRuns = useDemoRuns(demo)

  return useMemo(() => {
    if (demo) return demoRuns
    const byId = new Map((actions ?? []).map((action) => [action.id, action]))
    return (terminals ?? [])
      .filter((terminal) => terminal.actionId && (conversationId ? terminal.conversationId === conversationId : !terminal.conversationId))
      .map((terminal): CommandRun => {
        const action = byId.get(terminal.actionId!)
        return {
          id: terminal.id,
          label: action?.label ?? terminal.title,
          command: action?.command ?? terminal.title,
          status: terminal.alive ? 'running' : terminal.interrupted ? 'stopped' : terminal.exitCode === 0 ? 'succeeded' : 'failed',
          exitCode: terminal.exitCode,
          startedAt: terminal.createdAt,
          finishedAt: null,
          terminalId: terminal.id,
          cwd: terminal.cwd,
          output: null,
          demo: false,
        }
      })
      .sort((a, b) => Number(b.status === 'running') - Number(a.status === 'running') || b.startedAt - a.startedAt)
  }, [demo, demoRuns, terminals, actions, conversationId])
}

/** La démo : le lint écrit ses lignes une à une, les deux autres sont finies. */
function useDemoRuns(enabled: boolean): CommandRun[] {
  const [start] = useState(() => Date.now())
  const [lines, setLines] = useState(3)
  useEffect(() => {
    if (!enabled) return
    const timer = window.setInterval(() => setLines((count) => Math.min(count + 1, DEMO_LINT_LINES.length)), 1200)
    return () => window.clearInterval(timer)
  }, [enabled])
  return useMemo(
    () =>
      enabled
        ? [
            {
              id: 'demo-run-lint',
              label: 'Lint',
              command: 'pnpm --filter @solera/web lint',
              status: 'running',
              exitCode: null,
              startedAt: start - 38 * SEC,
              finishedAt: null,
              terminalId: null,
              cwd: null,
              output: DEMO_LINT_LINES.slice(0, lines).join('\n'),
              demo: true,
            },
            {
              id: 'demo-run-tests',
              label: 'Tests unitaires',
              command: 'pnpm --filter @solera/web exec vitest run',
              status: 'failed',
              exitCode: 1,
              startedAt: start - 3 * MIN - 18 * SEC,
              finishedAt: start - 3 * MIN,
              terminalId: null,
              cwd: null,
              output: DEMO_TEST_OUTPUT,
              demo: true,
            },
            {
              id: 'demo-run-typecheck',
              label: 'Typecheck du web',
              command: 'pnpm --filter @solera/web typecheck',
              status: 'succeeded',
              exitCode: 0,
              startedAt: start - 12 * MIN - 9 * SEC,
              finishedAt: start - 12 * MIN,
              terminalId: null,
              cwd: null,
              output: DEMO_TYPECHECK_OUTPUT,
              demo: true,
            },
          ]
        : [],
    [enabled, lines, start],
  )
}

/**
 * La sortie d'un terminal, lue sans y écrire : on s'attache, on reçoit le tampon puis le
 * flux, et c'est tout. `null` tant qu'on n'a rien ; `error` si la socket est refusée.
 */
function useTerminalOutput(projectId: string, run: CommandRun | null): { text: string | null; exitCode: number | null; error: string | null } {
  const [text, setText] = useState<string | null>(null)
  const [exitCode, setExitCode] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const terminalId = run?.demo ? null : (run?.terminalId ?? null)
  useEffect(() => {
    setText(null)
    setExitCode(null)
    setError(null)
    if (!terminalId) return
    const socket = new WebSocket(
      `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/projects/${projectId}/terminal?terminalId=${encodeURIComponent(terminalId)}`,
    )
    socket.onmessage = (event) => {
      const payload = JSON.parse(String(event.data)) as TerminalServerMessage
      if (payload.t === 'ready') setText(payload.replay)
      else if (payload.t === 'output') setText((current) => ((current ?? '') + payload.data).slice(-128 * 1024))
      else if (payload.t === 'exit') setExitCode(payload.code)
      else setError(payload.message)
    }
    socket.onerror = () => setError('La sortie de ce terminal n’est pas lisible depuis ici.')
    return () => socket.close()
  }, [projectId, terminalId])
  return { text: run?.demo ? run.output : text, exitCode, error }
}

/** Un « maintenant » qui avance chaque seconde, pour les durées en cours. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [active])
  return now
}

function duration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s} s`
  const m = Math.floor(s / 60)
  return m < 60 ? `${m} min ${String(s % 60).padStart(2, '0')}` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`
}

/* ------------------------------------------------------------------ le groupe */

/**
 * « En cours », en tête de l'onglet : ce qui tourne (activité, durée qui avance,
 * Arrêter), puis ce qui vient de finir avec son résultat, jusqu'à ce qu'on l'écarte.
 */
export function CommandRunsGroup({ runs, onOpen, simulate }: { runs: CommandRun[]; onOpen: (run: CommandRun) => void; simulate: (text: string) => void }) {
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(() => new Set())
  const shown = runs.filter((run) => !dismissed.has(run.id))
  const running = shown.filter((run) => run.status === 'running')
  const now = useNow(running.length > 0)
  if (shown.length === 0) return null
  return (
    <section className="pt-1.5 pb-1">
      <h3 className="px-3 pt-1.5 pb-1 text-meta font-medium tracking-wide text-ink-faint uppercase">
        {running.length > 0 ? 'En cours' : 'Dernières commandes'} <span className="tabular-nums">{running.length > 0 ? running.length : shown.length}</span>
      </h3>
      <ul className="flex flex-col">
        {shown.map((run) => (
          <RunRow
            key={run.id}
            run={run}
            now={now}
            onOpen={() => onOpen(run)}
            onStop={() => simulate(`arrêter « ${run.label} » (Ctrl-C dans son terminal)`)}
            onDismiss={() => setDismissed((current) => new Set(current).add(run.id))}
          />
        ))}
      </ul>
    </section>
  )
}

function RunIcon({ run }: { run: CommandRun }) {
  return (
    <span className="grid size-6 shrink-0 place-items-center">
      {run.status === 'running' ? <Loader size={14} className="animate-spin text-accent" />
        : run.status === 'succeeded' ? <CircleCheck size={14} className="text-positive" />
          : run.status === 'stopped' ? <Square size={12} className="text-ink-faint" />
            : <CircleX size={14} className="text-critical" />}
    </span>
  )
}

function lastLine(output: string | null): string | null {
  if (!output) return null
  const lines = stripAnsi(output).split('\n').map((line) => line.trim()).filter(Boolean)
  return lines.at(-1) ?? null
}

/** Ce que dit la ligne, à droite du libellé. */
function runMeta(run: CommandRun, now: number, summary: OutputSummary | null): string {
  if (run.status === 'running') return duration(now - run.startedAt)
  const took = run.finishedAt ? ` · ${duration(run.finishedAt - run.startedAt)}` : ''
  if (run.status === 'succeeded') return `Réussie${took}`
  if (run.status === 'stopped') return 'Interrompue'
  const what = summary?.tests.length ? ` · ${summary.tests.length} test${summary.tests.length > 1 ? 's' : ''} en échec`
    : summary?.lint.length ? ` · ${summary.lint.reduce((sum, file) => sum + file.issues.length, 0)} erreurs`
      : ''
  return `Échec${run.exitCode != null ? ` (code ${run.exitCode})` : ''}${took}${what}`
}

function RunRow({ run, now, onOpen, onStop, onDismiss }: { run: CommandRun; now: number; onOpen: () => void; onStop: () => void; onDismiss: () => void }) {
  const summary = useMemo(() => (run.output && run.status !== 'running' ? summarize(run.command, run.output) : null), [run])
  const activity = run.status === 'running' ? lastLine(run.output) : null
  return (
    <li
      onClick={(event) => {
        if ((event.target as HTMLElement).closest('button')) return
        onOpen()
      }}
      className="group/run flex min-h-9 cursor-pointer items-center gap-2.5 px-3 transition-colors hover:bg-surface-high/50"
    >
      <RunIcon run={run} />
      <span className="flex min-w-0 flex-1 items-baseline gap-2">
        <span className="shrink-0 truncate text-sm text-ink">{run.label}</span>
        <span className={cx('min-w-0 truncate text-xs tabular-nums', run.status === 'failed' ? 'text-critical' : 'text-ink-faint')}>
          {runMeta(run, now, summary)}
          {activity ? <span className="font-mono text-ink-faint"> · {activity}</span> : null}
        </span>
      </span>
      {run.status === 'running' ? (
        <button type="button" onClick={onStop} title="Arrêter (simulé)" className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md px-2 text-xs text-ink-soft hover:bg-surface-high hover:text-critical">
          <Square size={11} /> Arrêter
        </button>
      ) : (
        <>
          <button type="button" onClick={onDismiss} title="Écarter" aria-label={`Écarter « ${run.label} »`} className="grid size-8 shrink-0 place-items-center rounded-md text-ink-faint opacity-0 hover:bg-surface-high hover:text-ink group-hover/run:opacity-100 pointer-coarse:opacity-100">
            <X size={13} />
          </button>
          <ChevronRight size={14} className="shrink-0 text-ink-faint" />
        </>
      )}
    </li>
  )
}

/* ------------------------------------------------------------------ le détail */

/**
 * Le détail d'une commande, **à la place de la liste** (« ‹ Actions ») : l'état, les
 * gestes, le résumé de l'échec, puis la sortie qui défile.
 */
export function CommandRunDetail({ projectId, conversationId, run, onBack, simulate }: {
  projectId: string
  conversationId?: string
  run: CommandRun
  onBack: () => void
  simulate: (text: string) => void
}) {
  const { text, exitCode, error } = useTerminalOutput(projectId, run)
  const status: CommandRun['status'] = run.status === 'running' && exitCode !== null ? (exitCode === 0 ? 'succeeded' : 'failed') : run.status
  const now = useNow(status === 'running')
  const summary = useMemo(() => (text != null ? summarize(run.command, text) : null), [run.command, text])
  const scope = conversationId ?? projectScope(projectId)
  const openAt = (file: string, line: number | null) => {
    const path = relativePath(file, run.cwd)
    openTab(scope, path)
    if (line) revealLine(scope, path, line)
    setPanelTab('files')
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !(event.target as HTMLElement | null)?.closest('input, textarea, [role="menu"]')) onBack()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onBack])

  const errors = summary?.lint.reduce((sum, file) => sum + file.issues.length, 0) ?? 0

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-2">
        <button type="button" onClick={onBack} className="inline-flex h-8 shrink-0 items-center gap-0.5 rounded-md px-1.5 text-xs text-ink-soft hover:bg-surface-high hover:text-ink">
          <ChevronLeft size={14} /> Actions
        </button>
        <RunIcon run={{ ...run, status }} />
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{run.label}</span>
        {run.demo ? <span className="shrink-0 text-[11px] text-fuchsia-700 dark:text-fuchsia-300">démo</span> : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* L'état en une phrase, et les gestes. */}
        <section className="flex flex-col gap-2 border-b border-line px-3 py-3">
          <p className={cx('text-sm', status === 'failed' ? 'text-critical' : status === 'succeeded' ? 'text-positive' : 'text-ink')}>
            {status === 'running' ? `En cours depuis ${duration(now - run.startedAt)}`
              : status === 'succeeded' ? `Réussie${run.finishedAt ? ` en ${duration(run.finishedAt - run.startedAt)}` : ''} · il y a ${elapsed(run.finishedAt ?? run.startedAt)}`
                : status === 'stopped' ? 'Interrompue : le terminal a été emporté par un redémarrage.'
                  : `Échec${(exitCode ?? run.exitCode) != null ? ` (code ${exitCode ?? run.exitCode})` : ''}${run.finishedAt ? ` en ${duration(run.finishedAt - run.startedAt)}` : ''}${summary?.totals ? ` · ${summary.totals}` : ''}`}
          </p>
          <code className="truncate font-mono text-xs text-ink-faint" title={run.command}>$ {run.command}</code>
          <div className="flex flex-wrap gap-1.5">
            {status === 'running' ? (
              <Gesture tone="critical" icon={<Square size={12} />} onClick={() => simulate(`arrêter « ${run.label} » (Ctrl-C dans son terminal)`)}>Arrêter</Gesture>
            ) : (
              <Gesture icon={<RotateCcw size={12} />} onClick={() => simulate(`relancer « ${run.label} » dans le worktree de cette conversation`)}>Relancer</Gesture>
            )}
            {status === 'failed' && summary?.rerunFailed ? (
              <Gesture icon={<RotateCcw size={12} />} title={summary.rerunFailed} onClick={() => simulate(`relancer seulement les échecs : ${summary.rerunFailed}`)}>
                Relancer seulement les échecs
              </Gesture>
            ) : null}
            <Gesture
              icon={<SquareTerminal size={12} />}
              onClick={() => {
                if (!run.terminalId) return simulate('ouvrir son terminal dans l’onglet Terminaux')
                showTerminal(run.terminalId)
                setPanelTab('terminals')
              }}
            >
              Ouvrir le terminal
            </Gesture>
          </div>
        </section>

        {/* Ce qui a échoué, et comment. */}
        {summary && summary.tests.length > 0 ? (
          <Block title={`Tests en échec · ${summary.tests.length}`}>
            <ul className="flex flex-col divide-y divide-line">
              {summary.tests.map((test, index) => <FailedTestRow key={index} test={test} onOpen={openAt} />)}
            </ul>
          </Block>
        ) : null}
        {summary && summary.lint.length > 0 ? (
          <Block title={`${summary.tool === 'tsc' ? 'Erreurs de typage' : 'Lint'} · ${errors} dans ${summary.lint.length} fichier${summary.lint.length > 1 ? 's' : ''}`}>
            <ul className="flex flex-col">
              {summary.lint.map((file) => <LintFileRows key={file.file} file={file} onOpen={openAt} />)}
            </ul>
          </Block>
        ) : null}
        {status === 'succeeded' && summary && summary.tests.length === 0 && summary.lint.length === 0 ? (
          <p className="px-3 py-3 text-sm text-ink-soft">Rien à signaler{summary.totals ? ` — ${summary.totals}` : ''}.</p>
        ) : null}

        {/* La sortie, qui suit en direct tant que la commande tourne. */}
        <Block title={status === 'running' ? 'Sortie · en direct' : 'Sortie'}>
          {error ? (
            <p className="px-3 pb-3 text-xs text-ink-faint">{error} Ouvre son terminal pour la voir.</p>
          ) : text == null ? (
            <p className="flex items-center gap-1.5 px-3 pb-3 text-xs text-ink-faint">
              {run.terminalId ? <><Loader size={11} className="animate-spin" /> Lecture du terminal…</> : 'Pas de sortie connue.'}
            </p>
          ) : (
            <OutputTail text={text} follow={status === 'running'} />
          )}
        </Block>
      </div>
    </div>
  )
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-b border-line pb-1 last:border-b-0">
      <h3 className="px-3 pt-3 pb-1.5 text-meta font-medium tracking-wide text-ink-faint uppercase">{title}</h3>
      {children}
    </section>
  )
}

function Gesture({ icon, tone, title, onClick, children }: { icon: ReactNode; tone?: 'critical'; title?: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={cx(
        'inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs transition-colors',
        tone === 'critical' ? 'border-critical/40 text-critical hover:bg-critical/10' : 'border-line text-ink-soft hover:border-line-strong hover:text-ink',
      )}
    >
      {icon}
      {children}
    </button>
  )
}

function FileLink({ file, line, onOpen }: { file: string; line: number | null; onOpen: (file: string, line: number | null) => void }) {
  return (
    <button type="button" onClick={() => onOpen(file, line)} title="Ouvrir dans Fichiers" className="inline-flex min-w-0 items-center gap-1 font-mono text-[11px] text-ink-faint underline-offset-2 hover:text-accent hover:underline">
      <FileCode2 size={11} className="shrink-0" />
      <span className="truncate">{file}{line ? `:${line}` : ''}</span>
    </button>
  )
}

function FailedTestRow({ test, onOpen }: { test: FailedTest; onOpen: (file: string, line: number | null) => void }) {
  const parts = test.name.split(' › ')
  return (
    <li className="flex flex-col gap-1 px-3 py-2">
      <span className="flex items-start gap-2">
        <CircleX size={13} className="mt-0.5 shrink-0 text-critical" />
        <span className="min-w-0 text-sm text-ink">
          {parts.length > 1 ? <span className="text-ink-faint">{parts.slice(0, -1).join(' › ')} › </span> : null}
          {parts.at(-1)}
        </span>
      </span>
      <span className="flex flex-col gap-1 pl-5">
        {test.file ? <FileLink file={test.file} line={test.line} onOpen={onOpen} /> : null}
        {test.message ? <span className="text-xs text-ink-soft">{test.message}</span> : null}
        {test.expected !== undefined || test.received !== undefined ? (
          <span className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 rounded-md bg-surface-high/50 px-2 py-1.5 font-mono text-[11px]">
            {test.expected !== undefined ? <><span className="text-positive">attendu</span><span className="truncate text-ink">{test.expected}</span></> : null}
            {test.received !== undefined ? <><span className="text-critical">reçu</span><span className="truncate text-ink">{test.received}</span></> : null}
          </span>
        ) : null}
      </span>
    </li>
  )
}

function LintFileRows({ file, onOpen }: { file: LintFile; onOpen: (file: string, line: number | null) => void }) {
  return (
    <li className="pb-1.5">
      <button type="button" onClick={() => onOpen(file.file, file.issues[0]?.line ?? null)} className="flex w-full items-center gap-1.5 px-3 py-1 text-left font-mono text-xs text-ink hover:text-accent">
        <FileCode2 size={12} className="shrink-0 text-ink-faint" />
        <span className="truncate">{file.file}</span>
        <span className="ml-auto shrink-0 text-ink-faint tabular-nums">{file.issues.length}</span>
      </button>
      <ul className="flex flex-col">
        {file.issues.map((issue, index) => (
          <li key={index}>
            <button
              type="button"
              onClick={() => onOpen(file.file, issue.line)}
              className="grid w-full grid-cols-[3.5rem_minmax(0,1fr)] items-baseline gap-x-2 px-3 py-1 pl-8 text-left hover:bg-surface-high/50"
            >
              <span className="font-mono text-[11px] text-ink-faint tabular-nums">{issue.line}:{issue.col}</span>
              <span className="flex min-w-0 flex-col">
                <span className={cx('text-xs', issue.severity === 'error' ? 'text-ink' : 'text-ink-soft')}>
                  <span className={cx('mr-1.5 inline-block size-1.5 rounded-full align-middle', issue.severity === 'error' ? 'bg-critical' : 'bg-caution')} />
                  {issue.message}
                </span>
                {issue.rule ? <span className="font-mono text-[10px] text-ink-faint">{issue.rule}</span> : null}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </li>
  )
}

/** Les dernières lignes, en chasse fixe ; collée en bas tant qu'on ne remonte pas. */
function OutputTail({ text, follow }: { text: string; follow: boolean }) {
  const box = useRef<HTMLPreElement>(null)
  const stuck = useRef(true)
  const lines = useMemo(() => stripAnsi(text).split('\n').slice(-200).join('\n').trim(), [text])
  useEffect(() => {
    const element = box.current
    if (element && (follow ? stuck.current : true)) element.scrollTop = element.scrollHeight
  }, [lines, follow])
  return (
    <pre
      ref={box}
      onScroll={(event) => {
        const element = event.currentTarget
        stuck.current = element.scrollHeight - element.scrollTop - element.clientHeight < 24
      }}
      className="mx-3 mb-3 max-h-80 overflow-auto rounded-md bg-[#0b0d12] px-3 py-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-[#d6dae3]"
    >
      {lines || ' '}
    </pre>
  )
}

