import {
  AlarmClock,
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  MoreHorizontal,
  Pause,
  Pencil,
  Play,
  RotateCw,
  ScrollText,
  ShieldQuestion,
  Square,
  SquareTerminal,
  Trash2,
  X,
} from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode, type Ref } from 'react'
import { Link } from 'react-router-dom'
import type { ProjectActionDto } from '@solera/protocol'
import { Banner, Button, IconButton, Menu, MenuItem, RunStrip, TerminalOutput, cx } from '@solera/ui'
import type { EditorSeed } from '../../lib/action-editor'
import { useActionRuns, useRunAction } from '../../lib/actions'
import {
  LISTED_RUNS,
  firstOpenRun,
  originOf,
  reviewOf,
  runExpandable,
  runVerdict,
  stripOf,
  withPaused,
  type ActionPanel,
  type ReviewContent,
} from '../../lib/action-panel'
import { useAutomationMutations } from '../../lib/automations-query'
import {
  RUN_VERDICTS,
  VERDICT_FILL,
  cadenceWords,
  duplicateDraft,
  formatDateTime,
  formatDuration,
  fromAction,
  natureOf,
  stateSentence,
  whenWords,
  type Automation,
  type UnifiedRun,
} from '../../lib/automations'
import { conversationPath } from '../../lib/conversation-route'
import { useConversation } from '../../lib/conversations'
import { useEscapeLayer } from '../../lib/escape-layers'
import { locale, useTranslate } from '../../lib/i18n'
import { upcoming } from '../../lib/schedule-rule'
import { useServerTimeZone } from '../../lib/schedules'
import { switchTargets, unlessElsewhere } from '../../lib/served'
import { useServedIndex } from '../../lib/served-query'
import { AGENT_LABELS, AgentIcon } from '../AgentIcon'
import { WebLink } from '../WebLink'
import { LaunchButton, type LaunchHere } from './ActionGestures'
import { STATE_DOT } from './ActionMarks'
import { ActionBlock, ActionBody, ActionFooter, ActionHeader, Chip } from './ActionSheet'
import { ServedBlock } from './served/ServedBlock'
import { useTargetName } from './served/ServeMenu'
import { switchToTree, useLaunchHere, useServiceSwitch } from './served/SwitchServiceDialog'

/*
 * Le détail d'une action (`actions.md` §1.D) : l'état en une phrase et le geste principal
 * en tête ; la relecture quand un agent l'a écrite ; ce qu'il sert ; Quoi, Quand,
 * Passages, Origine ; le pied collant porte Dupliquer et Supprimer à gauche, le geste
 * principal à droite. « Modifier », « Planifier », « Dupliquer » et « Terminal » basculent
 * le **même** tiroir (`ActionDrawer`), qui y revient.
 */

/** Les passages d'une commande avec leur extrait ; ceux d'une tâche sont déjà dans la liste. */
function useDetailed(item: Automation): Automation {
  const actionId = item.source.kind === 'action' ? item.source.action.id : null
  const { data: runs } = useActionRuns(actionId)
  return item.source.kind === 'action' && runs ? fromAction(item.source.action, runs) : item
}

export function ActionDetail({
  item: listed,
  projectId,
  conversationId,
  focusReview = false,
  onPanel,
  onClose,
}: {
  item: Automation
  projectId: string
  /** Depuis une conversation : on lance dans son worktree. */
  conversationId?: string
  /** Ouvert par « Relire » : le tiroir se place sur le bloc de relecture (DET-3). */
  focusReview?: boolean
  onPanel: (panel: ActionPanel) => void
  onClose: () => void
}) {
  const t = useTranslate()
  const lang = locale()
  const timeZone = useServerTimeZone()
  const detailed = useDetailed(listed)
  const mutations = useAutomationMutations(projectId)
  const run = useRunAction()
  const switching = useServiceSwitch()
  const served = useServedIndex(projectId)
  const nameOf = useTargetName()
  const launchHere = useLaunchHere(served.trees, conversationId)
  const { data: conversation } = useConversation(conversationId)

  // La pause se lit tout de suite, avant que la liste relue la confirme (DET-11).
  const [paused, setPaused] = useState<boolean | null>(null)
  const item = paused === null ? detailed : withPaused(detailed, paused)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const reviewRef = useRef<HTMLElement>(null)
  // Une confirmation sur place est une couche : Échap l'annule avant de remonter (TIR-7).
  useEscapeLayer(confirmDelete, () => setConfirmDelete(false))

  useEffect(() => {
    if (!focusReview || !listed.review) return
    const frame = requestAnimationFrame(() => reviewRef.current?.scrollIntoView({ block: 'start' }))
    return () => cancelAnimationFrame(frame)
  }, [focusReview, listed.review])

  const action: ProjectActionDto | null = item.source.kind === 'action' ? item.source.action : null
  const now = Date.now()
  const sentence = stateSentence(item, now, t)
  const servedRow = served.byAutomation.get(item.id) ?? null
  const review = reviewOf(item)
  const failure = error ?? unlessElsewhere(run.error)?.message ?? null
  const tree = conversation?.worktreeId ? served.trees.find((entry) => entry.id === conversation.worktreeId) : undefined
  const here: LaunchHere | null = conversation?.worktreeId && tree ? { worktreeId: tree.id!, name: nameOf(tree) } : null

  /** Un geste qui attend sa requête : l'erreur s'affiche en tête, rien ne se ferme. */
  const act = (gesture: () => Promise<unknown>, after?: () => void, undo?: () => void) => {
    setError(null)
    setBusy(true)
    gesture()
      .then(() => after?.())
      .catch((reason: unknown) => {
        undo?.()
        setError(reason instanceof Error ? reason.message : String(reason))
      })
      .finally(() => setBusy(false))
  }
  const edit = (seed: EditorSeed) => onPanel({ mode: 'edit', seed, back: item.id })

  /**
   * Où part un lancement : l'arbre de la conversation se vise par elle, pour que la
   * commande soit de celles « lancées ici » ; un autre worktree par son id ; sinon la
   * racine. Un service démarré depuis une conversation suit son placement depuis elle.
   */
  const placeOf = (worktreeId: string | null, kind: ProjectActionDto['kind']) => {
    if (!conversationId) return worktreeId ? { worktreeId } : {}
    const ours = kind === 'service' || worktreeId === (conversation?.worktreeId ?? null)
    return ours ? { conversationId } : worktreeId ? { worktreeId } : {}
  }

  /** Lance une commande (là où le chevron le dit), démarre un service, ou un passage d'agent. */
  const launch = (worktreeId: string | null) => {
    if (!action) {
      act(() => mutations.run(item))
      return
    }
    const where = placeOf(worktreeId, action.kind)
    setError(null)
    run.mutate(
      { action, ...where, reveal: false },
      {
        onSuccess: (result) => {
          if (result.terminal) onPanel({ mode: 'run', terminalId: result.terminal.id, back: item.id })
        },
        onError: (reason) => switching.askIfElsewhere(action, reason, launchHere),
      },
    )
  }
  const service = (op: 'stop' | 'restart' | 'logs') => action && run.mutate({ action, op })

  const primary = (
    <DetailGesture
      item={item}
      here={here}
      busy={busy || run.isPending}
      onReview={() => reviewRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
      onStart={() => launch(null)}
      onStop={() => service('stop')}
      onTerminal={(terminalId) => onPanel({ mode: 'run', terminalId, back: item.id })}
      onLaunch={launch}
    />
  )

  return (
    <>
      <ActionHeader
        nature={natureOf(item)}
        title={item.label}
        when={whenWords(item, t, lang)}
        extra={item.review ? <Chip tone="caution">{t('actionDrawer.toReview')}</Chip> : null}
        onClose={onClose}
      />

      <ActionBody>
        {failure ? <Banner>{failure}</Banner> : null}

        {/* L'état en une phrase, et ce qu'on peut faire tout de suite (DET-1, DET-2). */}
        <div
          data-state-sentence
          className={cx(
            'flex flex-wrap items-center gap-3 rounded-md px-3.5 py-3',
            sentence.emphasis === 'review' ? 'bg-caution/10' : sentence.emphasis === 'fail' ? 'bg-critical/10' : 'bg-surface/70',
          )}
        >
          <span aria-hidden className={cx('size-2 shrink-0 rounded-full', STATE_DOT[sentence.tone], sentence.tone === 'live' && 'motion-safe:animate-pulse')} />
          <span className="min-w-0 flex-1 text-sm text-ink">{sentence.text}</span>
          <span className="flex shrink-0 items-center gap-1.5">{primary}</span>
        </div>

        {review ? (
          <ReviewBlock
            ref={reviewRef}
            review={review}
            busy={busy}
            onApprove={() => act(() => mutations.approve(item), onClose)}
            onReject={() => act(() => mutations.reject(item), onClose)}
          />
        ) : null}

        {servedRow && action ? (
          <ActionBlock title={t('actionDetail.block.served')}>
            <ServedBlock
              projectId={projectId}
              served={servedRow}
              base={served.base}
              pinnedBranch={action.pinnedBranch}
              targets={servedRow.switchable ? switchTargets(served.trees, servedRow) : []}
              onSwitch={(target) => switching.ask({ action, from: servedRow, to: switchToTree(target, nameOf(target)) })}
            />
          </ActionBlock>
        ) : null}
        {switching.dialog}

        <ActionBlock
          title={t('actionDetail.block.what')}
          aside={
            <Button size="sm" variant="ghost" icon={<Pencil size={13} />} onClick={() => edit({ from: listed })}>
              {t('actionDetail.edit')}
            </Button>
          }
        >
          <What item={item} />
        </ActionBlock>

        <ActionBlock
          title={t('actionDetail.block.when')}
          aside={
            item.schedule ? (
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  icon={item.schedule.enabled ? <Pause size={13} /> : <Play size={13} />}
                  disabled={busy}
                  onClick={() => {
                    const next = item.schedule!.enabled
                    setPaused(next)
                    act(() => mutations.setPaused(listed, next), undefined, () => setPaused(null))
                  }}
                >
                  {t(item.schedule.enabled ? 'actionDetail.when.pause' : 'actionDetail.when.resume')}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<Pencil size={13} />}
                  aria-label={t('actionDetail.when.editSchedule')}
                  onClick={() => edit({ from: listed, schedule: true })}
                >
                  {t('actionDetail.edit')}
                </Button>
              </>
            ) : (
              <Button size="sm" variant="ghost" icon={<AlarmClock size={13} />} onClick={() => edit({ from: listed, schedule: true })}>
                {t('actionDetail.when.schedule')}
              </Button>
            )
          }
        >
          <When item={item} now={now} timeZone={timeZone} />
        </ActionBlock>

        <ActionBlock
          title={t('actionDetail.block.runs')}
          aside={item.runs.length ? <span className="text-xs text-ink-faint tabular-nums">{t(item.runs.length === 1 ? 'actionDetail.runs.known.one' : 'actionDetail.runs.known.other', { count: item.runs.length })}</span> : null}
        >
          <Runs item={item} projectId={projectId} timeZone={timeZone} />
        </ActionBlock>

        <ActionBlock title={t('actionDetail.block.origin')}>
          <OriginLine item={item} projectId={projectId} />
        </ActionBlock>
      </ActionBody>

      <ActionFooter
        left={
          confirmDelete ? (
            <span className="flex flex-wrap items-center gap-2 text-sm text-ink">
              {t('actionDetail.delete.confirm', { label: item.label })}
              <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>
                {t('actionDrawer.cancel')}
              </Button>
              <Button size="sm" variant="danger" disabled={busy} onClick={() => act(() => mutations.remove(listed), onClose)}>
                {t('actionDetail.delete')}
              </Button>
            </span>
          ) : (
            <>
              <Button size="sm" variant="ghost" icon={<Copy size={13} />} onClick={() => edit({ draft: duplicateDraft(listed, t) })}>
                {t('actionDetail.duplicate')}
              </Button>
              <Button size="sm" variant="ghost" icon={<Trash2 size={13} />} onClick={() => setConfirmDelete(true)}>
                {t('actionDetail.delete')}
              </Button>
              {/* Le journal et la relance d'un service, gardés dans son détail, sous ⋯ (Q1). */}
              {action?.kind === 'service' && (item.live?.kind === 'service' || action.service?.state === 'failed') ? (
                <Menu trigger={<IconButton label={t('actions.more')} size="sm"><MoreHorizontal size={15} /></IconButton>}>
                  {item.live?.kind === 'service' ? (
                    <MenuItem icon={<RotateCw size={15} />} onSelect={() => service('restart')}>
                      {t('actionDetail.gesture.restart')}
                    </MenuItem>
                  ) : null}
                  <MenuItem icon={<ScrollText size={15} />} onSelect={() => service('logs')}>
                    {t('actionDetail.gesture.logs')}
                  </MenuItem>
                </Menu>
              ) : null}
            </>
          )
        }
        right={confirmDelete ? null : primary}
      />
    </>
  )
}

/* ------------------------------------------------------------------ le geste principal */

const LINK_BOX = 'inline-flex h-11 shrink-0 items-center gap-1 rounded-md text-sm transition-colors focus-visible:outline-2 focus-visible:outline-accent md:h-9 pointer-coarse:h-11'
/** « Ouvrir ↗ » : un lien, en accent, de la hauteur des boutons. */
const OPEN_LINK = cx(LINK_BOX, 'px-2.5 text-accent hover:bg-surface-high')
/** « Session ↗ » : le geste principal d'un passage d'agent en cours, en bouton plein. */
const SESSION_LINK = cx(LINK_BOX, 'bg-accent px-3 font-medium text-accent-ink hover:bg-accent-hover')

/**
 * Le geste du moment, en tête et au pied (DET-2) : « Relire » ; « Ouvrir ↗ » et « Arrêter »
 * d'un service en marche, « Démarrer » d'un service arrêté ; « Session ↗ » d'un passage
 * d'agent ; « Terminal » d'une commande qui tourne ; sinon « Lancer ▾ ».
 */
function DetailGesture({
  item,
  here,
  busy,
  onReview,
  onStart,
  onStop,
  onTerminal,
  onLaunch,
}: {
  item: Automation
  here: LaunchHere | null
  busy: boolean
  onReview: () => void
  onStart: () => void
  onStop: () => void
  onTerminal: (terminalId: string) => void
  onLaunch: (worktreeId: string | null) => void
}) {
  const t = useTranslate()
  const { live } = item
  if (item.review) {
    return (
      <Button size="sm" icon={<ShieldQuestion size={13} />} onClick={onReview}>
        {t('launcher.review.button')}
      </Button>
    )
  }
  if (item.what === 'command' && item.commandKind === 'service') {
    if (live?.kind !== 'service') {
      return (
        <Button size="sm" icon={<Play size={13} />} disabled={busy} onClick={onStart}>
          {t('actionDetail.gesture.start')}
        </Button>
      )
    }
    return (
      <>
        {live.href ? (
          <WebLink href={live.href} className={OPEN_LINK}>
            {t('launcher.gesture.open')} <ArrowUpRight size={13} aria-hidden />
          </WebLink>
        ) : null}
        <Button size="sm" variant="secondary" icon={<Square size={12} />} disabled={busy} onClick={onStop}>
          {t('actionDetail.gesture.stop')}
        </Button>
      </>
    )
  }
  if (live?.kind === 'run' && live.conversationId) {
    return (
      <Link to={conversationPath({ id: live.conversationId, projectId: item.projectId })} className={SESSION_LINK}>
        {t('launcher.gesture.session')} <ArrowUpRight size={13} aria-hidden />
      </Link>
    )
  }
  if (live?.kind === 'terminal') {
    return (
      <Button size="sm" variant="secondary" icon={<SquareTerminal size={13} />} onClick={() => onTerminal(live.terminalId)}>
        {t('launcher.gesture.terminal')}
      </Button>
    )
  }
  return <LaunchButton item={item} onLaunch={onLaunch} here={here} disabled={busy} />
}

/* ------------------------------------------------------------------ relecture */

function ReviewBlock({
  ref,
  review,
  busy,
  onApprove,
  onReject,
}: {
  ref: Ref<HTMLElement>
  review: ReviewContent
  busy: boolean
  onApprove: () => void
  onReject: () => void
}) {
  const t = useTranslate()
  const field = (name: 'command' | 'subdir' | 'url', value: string | null) =>
    name === 'command' ? (value ?? t('actionDetail.review.none')) : `${t(`actionDetail.review.field.${name}`)} : ${value ?? t('actionDetail.review.none')}`
  return (
    <section
      ref={ref}
      aria-label={t('actionDetail.block.review')}
      className="flex scroll-mt-4 flex-col gap-2.5 rounded-md border border-caution/40 px-3.5 py-3"
    >
      <span className="flex items-center gap-2 text-sm font-medium text-caution">
        <ShieldQuestion size={15} aria-hidden /> {t('actionDetail.block.review')}
      </span>
      <p className="text-sm text-ink-soft">{t(review.kind === 'script' ? 'actionDetail.review.script' : 'actionDetail.review.command')}</p>
      {review.kind === 'command' && review.changes.length > 0 ? (
        <div role="group" aria-label={t('actionDetail.review.changes')} className="flex flex-col gap-1 font-mono text-xs">
          {review.changes.map((change) => (
            <span key={change.field} className="flex flex-col gap-1">
              <del className="rounded bg-critical/10 px-2 py-1 break-all text-critical decoration-critical/50">- {field(change.field, change.before)}</del>
              <ins className="rounded bg-positive/10 px-2 py-1 break-all text-positive no-underline">+ {field(change.field, change.after)}</ins>
            </span>
          ))}
        </div>
      ) : (
        <code className="rounded bg-surface-high/50 px-2 py-1.5 font-mono text-xs break-all whitespace-pre-wrap text-ink">
          {review.kind === 'script' ? review.script : `${review.subdir ? `${review.subdir}/ ` : ''}$ ${review.command}`}
        </code>
      )}
      <span className="flex gap-2">
        <Button size="sm" icon={<Check size={13} />} disabled={busy} onClick={onApprove}>
          {t('actionDetail.review.approve')}
        </Button>
        <Button size="sm" variant="ghost" icon={<X size={13} />} disabled={busy} onClick={onReject}>
          {t('actionDetail.review.reject')}
        </Button>
      </span>
    </section>
  )
}

/* ------------------------------------------------------------------ quoi, quand */

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
      <span className="w-20 shrink-0 text-xs text-ink-faint">{label}</span>
      {children}
    </span>
  )
}

function What({ item }: { item: Automation }) {
  const t = useTranslate()
  if (item.what === 'agent') {
    const check = item.source.kind === 'task' ? item.source.task.check : null
    const agent = item.agent ?? 'claude'
    return (
      <div className="flex flex-col gap-2">
        <span className="flex items-center gap-2 text-sm text-ink-soft">
          <AgentIcon agent={agent} size={14} /> {t('actionDetail.what.agent', { agent: AGENT_LABELS[agent] })}
        </span>
        <p className="rounded-md bg-surface-high/50 px-3 py-2.5 text-sm leading-relaxed whitespace-pre-wrap text-ink">{item.prompt}</p>
        {check ? (
          <Fact label={t('actionDetail.what.check')}>
            <code className="min-w-0 font-mono text-xs break-all text-ink-soft">{check.script}</code>
            {check.approved ? null : <Chip tone="caution">{t('actionDetail.what.toApprove')}</Chip>}
          </Fact>
        ) : null}
      </div>
    )
  }
  const url = item.source.kind === 'action' ? item.source.action.url : null
  return (
    <div className="flex flex-col gap-2">
      <code className="flex gap-2 rounded-md bg-surface-high/50 px-3 py-2.5 font-mono text-sm text-ink">
        <span aria-hidden className="select-none text-ink-faint">$</span>
        <span className="min-w-0 break-all whitespace-pre-wrap">{item.command}</span>
      </code>
      <Fact label={t('actionDetail.what.folder')}>
        <code className="font-mono text-xs text-ink-soft">&lt;worktree&gt;{item.subdir ? `/${item.subdir}` : ''}</code>
        <span className="text-xs text-ink-faint">{t('actionDetail.what.folderHint')}</span>
      </Fact>
      {item.commandKind === 'service' && url ? (
        <Fact label={t('actionDetail.what.link')}>
          <code className="min-w-0 font-mono text-xs break-all text-ink-soft">{url}</code>
        </Fact>
      ) : null}
      {item.description ? (
        <Fact label={t('actionDetail.what.note')}>
          <span className="min-w-0 text-sm text-ink-soft">{item.description}</span>
        </Fact>
      ) : null}
    </div>
  )
}

function When({ item, now, timeZone }: { item: Automation; now: number; timeZone: string }) {
  const t = useTranslate()
  const lang = locale()
  const { schedule } = item
  const next = schedule?.enabled ? upcoming(schedule.cadence, 3, { after: now, timeZone }) : []
  const cadence = schedule ? cadenceWords(schedule.cadence, t, lang) : null
  return (
    <ul className="flex flex-col gap-2 text-sm">
      <li className="flex items-start gap-2 text-ink-soft">
        <span aria-hidden className={cx('mt-1.5 size-1.5 shrink-0 rounded-full', item.onDemand ? 'bg-positive' : 'bg-line-strong')} />
        {t(item.onDemand ? (item.what === 'agent' ? 'actionDetail.when.demandAgent' : 'actionDetail.when.demand') : 'actionDetail.when.notDemand')}
      </li>
      <li className="flex items-start gap-2 text-ink-soft">
        <span aria-hidden className={cx('mt-1.5 size-1.5 shrink-0 rounded-full', schedule?.enabled ? 'bg-positive' : 'bg-line-strong')} />
        {schedule && cadence ? (
          <span className="flex min-w-0 flex-col gap-1">
            <span className="text-ink first-letter:uppercase">{schedule.enabled ? cadence : t('actionDetail.when.paused', { cadence })}</span>
            {next.length ? (
              <span className="flex flex-col text-xs text-ink-faint tabular-nums">
                {next.map((at, index) => (
                  <span key={at}>
                    {t(index === 0 ? 'actionDetail.when.next' : 'actionDetail.when.then', { date: formatDateTime(at, lang, timeZone) })}
                  </span>
                ))}
              </span>
            ) : null}
          </span>
        ) : (
          t('actionDetail.when.notScheduled')
        )}
      </li>
    </ul>
  )
}

/* ------------------------------------------------------------------ passages */

function Runs({ item, projectId, timeZone }: { item: Automation; projectId: string; timeZone: string }) {
  const t = useTranslate()
  const lang = locale()
  // Tant qu'on n'a rien déplié ni replié, le premier passage qui a une sortie l'est
  // d'office — l'extrait d'une commande arrive après la liste (`useActionRuns`).
  const [chosen, setChosen] = useState<string | null | undefined>(undefined)
  const openRun = chosen === undefined ? firstOpenRun(item.runs) : chosen
  if (item.runs.length === 0) return <p className="text-sm text-ink-faint">{t('actionDetail.runs.empty')}</p>
  const strip = stripOf(item.runs, t, lang, timeZone)
  return (
    <div className="flex flex-col gap-3">
      <RunStrip size="md" runs={strip} label={t('actionDetail.runs.strip', { count: strip.length })} caption={t('actionDetail.runs.latestRight')} />
      <ul className="flex flex-col divide-y divide-line rounded-md border border-line">
        {item.runs.slice(0, LISTED_RUNS).map((run) => (
          <RunLine
            key={run.id}
            run={run}
            agent={item.what === 'agent'}
            projectId={projectId}
            timeZone={timeZone}
            open={openRun === run.id}
            onToggle={() => setChosen(openRun === run.id ? null : run.id)}
          />
        ))}
      </ul>
    </div>
  )
}

function RunLine({
  run,
  agent,
  projectId,
  timeZone,
  open,
  onToggle,
}: {
  run: UnifiedRun
  agent: boolean
  projectId: string
  timeZone: string
  open: boolean
  onToggle: () => void
}) {
  const t = useTranslate()
  const expandable = runExpandable(run)
  const verdict = RUN_VERDICTS[run.status]
  const Chevron = open ? ChevronDown : ChevronRight
  return (
    <li data-run={run.id} className="flex flex-col">
      <div className="flex min-h-10 items-center gap-2.5 px-3 text-sm">
        <button
          type="button"
          disabled={!expandable}
          aria-expanded={expandable ? open : undefined}
          onClick={onToggle}
          className={cx('flex min-h-10 min-w-0 flex-1 items-center gap-2.5 text-left', expandable ? 'cursor-pointer' : 'cursor-default')}
        >
          {expandable ? <Chevron size={13} aria-hidden className="shrink-0 text-ink-faint" /> : <span className="w-[13px] shrink-0" />}
          <span aria-hidden className={cx('size-2 shrink-0 rounded-full', VERDICT_FILL[verdict.tone], verdict.live && 'motion-safe:animate-pulse')} />
          <span className="w-36 shrink-0 text-ink-soft tabular-nums">{formatDateTime(run.startedAt, locale(), timeZone)}</span>
          <span className="w-16 shrink-0 text-xs text-ink-faint tabular-nums">
            {run.finishedAt ? formatDuration(run.finishedAt - run.startedAt, t) : '—'}
          </span>
          <span className={cx('min-w-0 truncate text-xs', verdict.tone === 'critical' ? 'text-critical' : 'text-ink-faint')}>{runVerdict(run, t)}</span>
        </button>
        {agent && run.conversationId ? (
          <Link
            to={conversationPath({ id: run.conversationId, projectId })}
            className="inline-flex shrink-0 items-center gap-0.5 text-xs text-ink-soft hover:text-ink hover:underline"
          >
            {t('launcher.gesture.session')} <ArrowUpRight size={12} aria-hidden />
          </Link>
        ) : null}
      </div>
      {open && expandable ? (
        <div className="flex flex-col gap-1 px-3 pb-3 pl-[2.875rem]">
          {run.error ? <p className="text-xs text-critical">{run.error}</p> : null}
          {run.excerpt ? <TerminalOutput text={run.excerpt} label={t('actionDetail.runs.output')} className="max-h-60 text-meta" /> : null}
        </div>
      ) : null}
    </li>
  )
}

/* ------------------------------------------------------------------ origine */

function OriginLine({ item, projectId }: { item: Automation; projectId: string }) {
  const t = useTranslate()
  const origin = originOf(item)
  const date = <span className="text-ink-faint"> · {formatDateTime(origin.at, locale())}</span>
  if (origin.by === 'agent') {
    return (
      <p className="text-sm text-ink-soft">
        {t('actionDetail.origin.agent')}{' '}
        <Link to={conversationPath({ id: origin.conversationId, projectId })} className="text-ink hover:underline">
          {origin.title === null ? t('actionDetail.origin.gone') : t('actionDetail.origin.session', { title: origin.title })}
        </Link>
        {date}
      </p>
    )
  }
  return (
    <p className="text-sm text-ink-soft">
      {t('actionDetail.origin.you')}
      {date}
    </p>
  )
}
