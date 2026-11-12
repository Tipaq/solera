import { useDeferredValue, useEffect, useMemo, useState, type ReactNode } from 'react'
import { ChevronRight, CircleCheck, CircleX, FileCode2, Loader, RotateCcw, Square, SquareTerminal, X } from 'lucide-react'
import {
  IconButton,
  PanelGroup,
  PanelNotice,
  StackHeader,
  TerminalOutput,
  cx,
  panelGestureClass,
  panelRowClass,
  panelToolClass,
} from '@solera/ui'
import { useActions, useRunAction } from '../../lib/actions'
import { commandLine, issueCount, lastLine, outputTail, summarize, workspacePath, type FailedTest, type LintFile, type OutputSummary } from '../../lib/command-output'
import { commandRunsOf, runMeta, runSentence, type CommandRun } from '../../lib/command-runs'
import { relativeDate } from '../../lib/dates'
import { openTab } from '../../lib/editor-tabs'
import { revealLine } from '../../lib/editor-reveal'
import { useTranslate } from '../../lib/i18n'
import { setPanelTab, showTerminal } from '../../lib/panel'
import { useTerminalOutput } from '../../lib/terminal-output'
import { useCloseTerminal, useInterruptTerminal, useTerminals, useTerminalsUpsert } from '../../lib/terminals'
import { projectScope } from '../../lib/workspace-scope'

/**
 * **Les commandes lancées ici**, en tête de l'onglet Actions du panneau (RUN-1 à RUN-6) :
 * ce qui tourne, avec la durée qui avance, sa dernière ligne et « Arrêter » ; puis le
 * verdict de ce qui a fini, jusqu'à ce qu'on l'écarte. Au clic, le détail en pile : la
 * phrase d'état, les gestes, **ce qui a échoué et comment**, et la sortie en direct.
 *
 * Une commande d'action (`kind: task`) se joue dans un terminal du panneau : la liste des
 * terminaux dit lequel (`actionId`), s'il vit, son code et sa fin. Sa sortie se lit par
 * la socket du terminal, **en lecture seule** : on n'y envoie rien, pas même la taille,
 * qui redimensionnerait l'écran de qui le regarde dans l'onglet Terminaux
 * (`useTerminalOutput`).
 */

/** La dernière ligne d'une commande qui tourne se cherche dans sa fin, pas dans 128 Ko. */
const LAST_LINE_CHARS = 4 * 1024
/** `panelToolClass` ne prévoit pas l'état désactivé : celui d'un geste pendant sa requête. */
const DISABLED = 'disabled:pointer-events-none disabled:opacity-45'
const OUTPUT_LINES = 200

/** Une commande lancée par l'agent apparaît au plus tard après ce délai. */
const POLL_MS = 10_000

/** Les commandes lancées depuis cette conversation, ou depuis la racine hors conversation. */
export function useCommandRuns(projectId: string, conversationId?: string): CommandRun[] {
  const { data: terminals } = useTerminals(projectId, true, POLL_MS)
  const { data: actions } = useActions()
  return useMemo(() => commandRunsOf(terminals ?? [], actions ?? [], conversationId), [terminals, actions, conversationId])
}

/** Un « maintenant » qui avance chaque seconde, tant que quelque chose tourne. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [active])
  return now
}

/** Le résumé d'une sortie, calculé hors du chemin de la frappe. */
function useSummary(command: string, text: string | null, enabled: boolean): OutputSummary | null {
  const deferred = useDeferredValue(text)
  return useMemo(() => (enabled && deferred != null ? summarize(command, deferred) : null), [command, deferred, enabled])
}

/* ------------------------------------------------------------------ le groupe */

/**
 * « En cours N » (ou « Dernières commandes N » quand rien ne tourne). « Écarter » ferme
 * le terminal fini (Q10) : un terminal d'action fini n'a plus d'autre usage, et le
 * plafond de six terminaux par projet est vite atteint.
 */
export function CommandRunsGroup({
  projectId,
  runs,
  onOpen,
  onError,
}: {
  projectId: string
  runs: CommandRun[]
  onOpen: (run: CommandRun) => void
  onError: (message: string) => void
}) {
  const t = useTranslate()
  const running = runs.filter((run) => run.status === 'running').length
  const now = useNow(running > 0)
  const interrupt = useInterruptTerminal(projectId)
  const close = useCloseTerminal(projectId)
  if (runs.length === 0) return null
  return (
    <section data-command-runs className="pt-1.5 pb-1">
      <PanelGroup title={t(running > 0 ? 'panel.runs.group.running' : 'panel.runs.group.recent')} count={running > 0 ? running : runs.length} />
      <ul className="flex flex-col">
        {runs.map((run) => (
          <RunRow
            key={run.terminalId}
            projectId={projectId}
            run={run}
            now={now}
            onOpen={() => onOpen(run)}
            onStop={() => interrupt.mutate(run.terminalId, { onError: (error) => onError(error.message) })}
            onDismiss={() => close.mutate(run.terminalId, { onError: (error) => onError(error.message) })}
          />
        ))}
      </ul>
    </section>
  )
}

function RunIcon({ status }: { status: CommandRun['status'] }) {
  return (
    <span aria-hidden className="grid size-5 shrink-0 place-items-center">
      {status === 'running' ? (
        <Loader size={14} className="animate-spin text-accent motion-reduce:animate-none" />
      ) : status === 'succeeded' ? (
        <CircleCheck size={14} className="text-positive" />
      ) : status === 'failed' ? (
        <CircleX size={14} className="text-critical" />
      ) : (
        <Square size={12} className="text-ink-faint" />
      )}
    </span>
  )
}

function RunRow({
  projectId,
  run,
  now,
  onOpen,
  onStop,
  onDismiss,
}: {
  projectId: string
  run: CommandRun
  now: number
  onOpen: () => void
  onStop: () => void
  onDismiss: () => void
}) {
  const t = useTranslate()
  // Une ligne finie ne lit sa sortie que pour dire ce qui a échoué.
  const reads = run.status === 'running' || run.status === 'failed'
  const { text } = useTerminalOutput(projectId, reads ? run.terminalId : null, run.status === 'running')
  const summary = useSummary(run.command, text, run.status === 'failed')
  const activity = run.status === 'running' && text ? lastLine(text.slice(-LAST_LINE_CHARS)) : null
  return (
    <li className={panelRowClass} data-run={run.status}>
      <button
        type="button"
        onClick={onOpen}
        className="-mx-1 flex min-w-0 flex-1 items-center gap-2.5 self-stretch rounded-sm px-1 text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
      >
        <RunIcon status={run.status} />
        <span className="flex min-w-0 flex-1 items-baseline gap-2">
          <span className="max-w-[60%] shrink-0 truncate text-sm text-ink">{run.label}</span>
          <span className={cx('min-w-0 truncate text-xs tabular-nums', run.status === 'failed' ? 'text-critical' : 'text-ink-faint')}>
            {runMeta(run, now, summary, t)}
            {activity ? <span className="font-mono text-ink-faint"> · {activity}</span> : null}
          </span>
        </span>
      </button>
      {run.status === 'running' ? (
        <button type="button" onClick={onStop} aria-label={t('panel.runs.stopLabel', { label: run.label })} className={cx(panelGestureClass, 'shrink-0 hover:text-critical')}>
          <Square size={11} aria-hidden />
          {t('panel.runs.stop')}
        </button>
      ) : (
        <>
          <IconButton
            size="sm"
            label={t('panel.runs.dismissLabel', { label: run.label })}
            onClick={onDismiss}
            className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100"
          >
            <X size={13} />
          </IconButton>
          <ChevronRight size={14} aria-hidden className="shrink-0 text-ink-faint" />
        </>
      )}
    </li>
  )
}

/* ------------------------------------------------------------------ le détail */

/**
 * Le détail d'une commande, **à la place de la liste** (« ‹ Actions ») : l'état en une
 * phrase, les gestes, le résumé de l'échec, puis la sortie qui suit le direct. Sans
 * `onBack`, il se pose dans un tiroir qui porte déjà son en-tête.
 *
 * Relancer recycle le terminal fini de la même action : la commande relancée a un autre
 * terminal, que `onRelaunched` fait suivre.
 */
export function CommandRunDetail({
  projectId,
  conversationId,
  run,
  onBack,
  backLabel,
  onRelaunched,
}: {
  projectId: string
  conversationId?: string
  run: CommandRun
  onBack?: () => void
  /** Où `‹` ramène : l'onglet Actions par défaut, le détail de l'action quand on en vient. */
  backLabel?: string
  onRelaunched: (terminalId: string) => void
}) {
  const t = useTranslate()
  const { text, unreadable } = useTerminalOutput(projectId, run.terminalId, run.status === 'running')
  const now = useNow(run.status === 'running')
  const summary = useSummary(run.command, text, true)
  const interrupt = useInterruptTerminal(projectId)
  const relaunch = useRunAction()
  const upsert = useTerminalsUpsert(projectId)
  const [notice, setNotice] = useState<{ tone: 'neutral' | 'critical'; text: string } | null>(null)
  const scope = conversationId ?? projectScope(projectId)
  const base = summary?.base ?? run.cwd

  const openAt = (path: string, line: number | null) => {
    // La ligne d'abord : l'éditeur peut déjà montrer ce fichier.
    if (line) revealLine(scope, path, line)
    openTab(scope, path)
    setPanelTab('files')
  }
  const fail = (error: Error) => setNotice({ tone: 'critical', text: error.message })
  const rerun = (args?: string[]) => {
    if (!run.action) return
    setNotice(null)
    relaunch.mutate(
      { action: run.action, conversationId, args, reveal: false },
      {
        onSuccess: (result) => {
          if (result.alreadyRunning) setNotice({ tone: 'neutral', text: t('panel.runs.alreadyRunning') })
          if (!result.terminal) return
          upsert(result.terminal)
          onRelaunched(result.terminal.id)
        },
        onError: fail,
      },
    )
  }

  const sentenceTone =
    run.status === 'failed' ? 'text-critical' : run.status === 'succeeded' ? 'text-positive' : run.status === 'interrupted' ? 'text-caution' : 'text-ink'
  const rerunArgs = run.status === 'failed' ? summary?.rerunArgs : null
  const errors = summary ? issueCount(summary) : 0
  const files = summary?.lint.length ?? 0
  const output = useMemo(() => (text == null ? null : outputTail(text, OUTPUT_LINES)), [text])
  // Après « Relancer seulement les échecs », ses arguments en plus : l'en-tête du terminal les dit.
  const ran = useMemo(() => commandLine(text) ?? run.command, [text, run.command])

  return (
    <div data-command-run className="flex min-h-0 min-w-0 flex-1 flex-col">
      {onBack ? (
        <StackHeader
          back={backLabel ?? t('panel.tab.actions')}
          onBack={onBack}
          title={
            <span className="flex min-w-0 items-center gap-2">
              <RunIcon status={run.status} />
              <span className="truncate">{run.label}</span>
            </span>
          }
        />
      ) : null}
      {notice ? (
        <PanelNotice tone={notice.tone} onClose={() => setNotice(null)}>
          {notice.text}
        </PanelNotice>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto pb-safe">
        <section className="flex flex-col gap-2 border-b border-line px-3 py-3">
          <p className={cx('text-sm', sentenceTone)}>{runSentence(run, now, summary, t, run.finishedAt ? relativeDate(run.finishedAt) : '')}</p>
          <code className="truncate font-mono text-xs text-ink-faint" title={ran}>
            $ {ran}
          </code>
          <div className="flex flex-wrap gap-1.5">
            {run.status === 'running' ? (
              <button type="button" className={panelToolClass()} onClick={() => interrupt.mutate(run.terminalId, { onError: fail })}>
                <span className="inline-flex items-center gap-1.5 text-critical">
                  <Square size={12} aria-hidden />
                  {t('panel.runs.stop')}
                </span>
              </button>
            ) : run.action ? (
              <button type="button" className={cx(panelToolClass(), DISABLED)} disabled={relaunch.isPending} onClick={() => rerun()}>
                <RotateCcw size={12} aria-hidden />
                {t('panel.runs.rerun')}
              </button>
            ) : null}
            {rerunArgs && run.action ? (
              <button
                type="button"
                className={cx(panelToolClass(), DISABLED)}
                title={`${run.command} ${rerunArgs.map(quote).join(' ')}`}
                disabled={relaunch.isPending}
                onClick={() => rerun(rerunArgs)}
              >
                <RotateCcw size={12} aria-hidden />
                {t('panel.runs.rerunFailed')}
              </button>
            ) : null}
            <button type="button" className={panelToolClass()} onClick={() => showTerminal(run.terminalId)}>
              <SquareTerminal size={12} aria-hidden />
              {t('panel.runs.openTerminal')}
            </button>
          </div>
        </section>

        {summary && summary.tests.length > 0 ? (
          <Block title={t('panel.runs.block.tests', { count: summary.tests.length })}>
            <ul className="flex flex-col divide-y divide-line">
              {summary.tests.map((test, index) => (
                <FailedTestRow key={index} test={test} path={test.file ? workspacePath(test.file, base, run.root) : null} onOpen={openAt} />
              ))}
            </ul>
          </Block>
        ) : null}
        {summary && files > 0 ? (
          <Block
            title={t(summary.tool === 'tsc' ? 'panel.runs.block.types' : 'panel.runs.block.lint', {
              summary: t(files === 1 ? 'panel.runs.block.inFiles.one' : 'panel.runs.block.inFiles.other', { count: errors, files }),
            })}
          >
            <ul className="flex flex-col">
              {summary.lint.map((file) => (
                <LintFileRows key={file.file} file={file} path={workspacePath(file.file, base, run.root)} onOpen={openAt} />
              ))}
            </ul>
          </Block>
        ) : null}
        {run.status === 'succeeded' && summary && summary.tests.length === 0 && files === 0 ? (
          <p className="border-b border-line px-3 py-3 text-sm text-ink-soft">
            {summary.totals ? t('panel.runs.nothingWith', { totals: summary.totals }) : t('panel.runs.nothing')}
          </p>
        ) : null}

        <Block title={t(run.status === 'running' ? 'panel.runs.block.live' : 'panel.runs.block.output')}>
          {unreadable ? (
            <p className="px-3 pb-3 text-xs text-ink-faint">{t('panel.runs.unreadable')}</p>
          ) : output == null ? (
            <p className="flex items-center gap-1.5 px-3 pb-3 text-xs text-ink-faint">
              <Loader size={11} className="animate-spin" aria-hidden />
              {t('panel.runs.reading')}
            </p>
          ) : output === '' ? (
            <p className="px-3 pb-3 text-xs text-ink-faint">{t('panel.runs.noOutput')}</p>
          ) : (
            <div className="px-3 pb-3">
              <TerminalOutput text={output} label={t('panel.runs.outputLabel', { label: run.label })} follow={run.status === 'running'} />
            </div>
          )}
        </Block>
      </div>
    </div>
  )
}

/** Un argument cité comme le serveur le cite pour le shell (`shellQuote`), pour l'infobulle. */
function quote(arg: string): string {
  return `'${arg.replaceAll("'", `'\\''`)}'`
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-b border-line pb-1 last:border-b-0">
      <PanelGroup title={title} />
      {children}
    </section>
  )
}

function FileLink({ label, path, line, onOpen }: { label: string; path: string | null; line: number | null; onOpen: (path: string, line: number | null) => void }) {
  const t = useTranslate()
  const text = `${path ?? label}${line ? `:${line}` : ''}`
  if (!path) return <span className="truncate font-mono text-code text-ink-faint">{text}</span>
  return (
    <button
      type="button"
      onClick={() => onOpen(path, line)}
      title={t('panel.runs.openFile')}
      className="inline-flex min-w-0 items-center gap-1 self-start font-mono text-code text-ink-faint underline-offset-2 hover:text-accent hover:underline"
    >
      <FileCode2 size={11} className="shrink-0" aria-hidden />
      <span className="truncate">{text}</span>
    </button>
  )
}

function FailedTestRow({ test, path, onOpen }: { test: FailedTest; path: string | null; onOpen: (path: string, line: number | null) => void }) {
  const t = useTranslate()
  const parts = test.name.split(' › ')
  return (
    <li className="flex flex-col gap-1 px-3 py-2">
      <span className="flex items-start gap-2">
        <CircleX size={13} className="mt-0.5 shrink-0 text-critical" aria-hidden />
        <span className="min-w-0 text-sm break-words text-ink">
          {parts.length > 1 ? <span className="text-ink-faint">{parts.slice(0, -1).join(' › ')} › </span> : null}
          {parts.at(-1)}
        </span>
      </span>
      <span className="flex min-w-0 flex-col gap-1 pl-5">
        {test.file ? <FileLink label={test.file} path={path} line={test.line} onOpen={onOpen} /> : null}
        {test.message ? <span className="text-xs break-words text-ink-soft">{test.message}</span> : null}
        {test.expected !== undefined || test.received !== undefined ? (
          <span className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 rounded-md bg-surface-high/50 px-2 py-1.5 font-mono text-code">
            {test.expected !== undefined ? (
              <>
                <span className="text-positive">{t('panel.runs.expected')}</span>
                <span className="truncate text-ink">{test.expected}</span>
              </>
            ) : null}
            {test.received !== undefined ? (
              <>
                <span className="text-critical">{t('panel.runs.received')}</span>
                <span className="truncate text-ink">{test.received}</span>
              </>
            ) : null}
          </span>
        ) : null}
      </span>
    </li>
  )
}

function LintFileRows({ file, path, onOpen }: { file: LintFile; path: string | null; onOpen: (path: string, line: number | null) => void }) {
  const open = (line: number) => (path ? onOpen(path, line) : undefined)
  return (
    <li className="pb-1.5">
      <button
        type="button"
        disabled={!path}
        onClick={() => open(file.issues[0]!.line)}
        className="flex w-full items-center gap-1.5 px-3 py-1 text-left font-mono text-xs text-ink enabled:hover:text-accent"
      >
        <FileCode2 size={12} className="shrink-0 text-ink-faint" aria-hidden />
        <span className="truncate">{path ?? file.file}</span>
        <span className="ml-auto shrink-0 text-ink-faint tabular-nums">{file.issues.length}</span>
      </button>
      <ul className="flex flex-col">
        {file.issues.map((issue, index) => (
          <li key={index}>
            <button
              type="button"
              disabled={!path}
              onClick={() => open(issue.line)}
              className="grid w-full grid-cols-[3.5rem_minmax(0,1fr)] items-baseline gap-x-2 px-3 py-1 pl-8 text-left enabled:hover:bg-surface-high/50"
            >
              <span className="font-mono text-code text-ink-faint tabular-nums">
                {issue.line}:{issue.col}
              </span>
              <span className="flex min-w-0 flex-col">
                <span className={cx('text-xs break-words', issue.severity === 'error' ? 'text-ink' : 'text-ink-soft')}>
                  <span aria-hidden className={cx('mr-1.5 inline-block size-1.5 rounded-full align-middle', issue.severity === 'error' ? 'bg-critical' : 'bg-caution')} />
                  {issue.message}
                </span>
                {issue.rule ? <span className="font-mono text-micro text-ink-faint">{issue.rule}</span> : null}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </li>
  )
}
