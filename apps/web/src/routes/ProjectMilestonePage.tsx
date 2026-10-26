import { ArrowLeft, Flag, GitBranch, ListFilter, Pause, Play, Workflow } from 'lucide-react'
import { useMemo } from 'react'
import { Link, useParams } from 'react-router-dom'
import type { MilestoneRunCardDto, MilestoneRunDto } from '@solera/protocol'
import { Badge, Button, EmptyState, cx } from '@solera/ui'
import { MILESTONE_SEGMENT_TONES, MilestoneSegments } from '../components/project/MilestoneBanner'
import type { SessionSummary } from '../components/project/SessionRow'
import { useActivityRows } from '../lib/activity-rows'
import { useCards } from '../lib/cards'
import { formatDay, relativeDate } from '../lib/dates'
import { useTranslate } from '../lib/i18n'
import { milestoneCounts, milestoneQueue, milestoneToneOf, milestoneWaves, type MilestoneTone } from '../lib/milestone-view'
import { useMilestoneRun, useUpdateMilestone } from '../lib/milestones'
import { useProjects } from '../lib/projects'

/** Le cadre d'une carte selon son exécution : l'accent qui tourne, le pointillé qui attend. */
const TILE_TONES: Record<MilestoneTone, string> = {
  merged: 'border-line bg-positive/5',
  review: 'border-positive/40 bg-positive/5',
  working: 'border-accent/40 bg-accent-wash/40',
  blocked: 'border-caution/40 bg-caution/5',
  queued: 'border-line',
  waiting: 'border-dashed border-line',
  failed: 'border-critical/40 bg-critical/5',
  dropped: 'border-dashed border-line opacity-60',
}

const SUMMARY_TONES: Record<SessionSummary['tone'], string> = {
  caution: 'text-caution',
  critical: 'text-critical',
  soft: 'text-ink-soft',
}

/**
 * **La vue d'un jalon lancé**, sous l'onglet Jalons (planche C2, #116) : la vue pour
 * piloter, quand le bandeau de l'Activité ne suffit plus.
 *
 * Les cartes en colonnes, une par **vague** : les étages du graphe des liens « bloque »,
 * que le serveur calcule (`layerCards`). Une carte part quand ce qui la bloque, à sa
 * gauche, est fusionné. Chacune dit son état, ce que sa session te demande s'il y a
 * lieu — la même ligne que dans l'Activité —, et « après #N » tant qu'un bloqueur n'est
 * pas fini. En pied, la file : ce qui partira à la prochaine place libre.
 *
 * Chargée à la demande : on n'y vient que par le bandeau ou la frise.
 */
export function ProjectMilestonePage() {
  const { projectId, number } = useParams()
  const t = useTranslate()
  const { data: cards, isPending } = useCards(projectId)
  const card = cards?.find((entry) => String(entry.number) === number)
  // Une carte sans enfant n'est pas un jalon : le serveur refuserait de la lire, et elle
  // ne peut pas être lancée. On le dit au lieu de promettre un lancement impossible.
  const parent = Boolean(card && cards?.some((entry) => entry.parent?.id === card.id))
  const { data: run, isPending: runPending, isError, error } = useMilestoneRun(card?.id ?? '', parent)

  if (isPending || (parent && runPending)) return null
  if (!projectId || !card) return <EmptyState icon={<Flag size={22} />} title={t('milestoneRun.notFound')} />
  if (!parent) {
    return (
      <EmptyState
        icon={<Flag size={22} />}
        title={t('milestoneRun.notParent', { number: card.number })}
        description={t('milestoneRun.notParentHint')}
        action={
          <Link to={`/p/${projectId}/board?carte=${card.number}`} className="text-sm text-accent hover:underline">
            {t('milestoneRun.openCard')}
          </Link>
        }
      />
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 px-4 pt-3">
        <Link
          to={`/p/${projectId}/timeline`}
          className="inline-flex items-center gap-1 rounded text-xs text-ink-faint hover:text-ink"
        >
          <ArrowLeft size={13} aria-hidden />
          {t('milestoneRun.back')}
        </Link>
      </div>
      {isError ? (
        <EmptyState icon={<Flag size={22} />} title={t('milestoneRun.loadFailed')} description={error.message} />
      ) : run ? (
        <MilestoneView projectId={projectId} run={run} dueAt={card.dueAt} />
      ) : (
        <EmptyState
          icon={<Flag size={22} />}
          title={t('milestoneRun.never', { number: card.number })}
          description={t('milestoneRun.neverHint')}
          action={
            <Link to={`/p/${projectId}/board?carte=${card.number}`} className="text-sm text-accent hover:underline">
              {t('milestoneRun.openCard')}
            </Link>
          }
        />
      )}
    </div>
  )
}

function MilestoneView({ projectId, run, dueAt }: { projectId: string; run: MilestoneRunDto; dueAt: number | null }) {
  const t = useTranslate()
  const update = useUpdateMilestone(run.cardId)
  const { data: projects } = useProjects()
  const project = projects?.find((entry) => entry.id === projectId)
  // Les lignes de l'Activité, pour dire d'une carte ce que sa session te demande.
  const rows = useActivityRows(projectId, project)
  const summaries = useMemo(
    () => new Map(rows.flatMap((row) => (row.summary ? [[row.entry.conversation.id, row.summary] as const] : []))),
    [rows],
  )

  const counts = milestoneCounts(run)
  const waves = milestoneWaves(run.cards)
  const { queue, unblocks } = milestoneQueue(run.cards)
  const live = run.state === 'running' || run.state === 'paused'

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-col gap-3 px-4 pt-2 pb-4">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
          <Flag size={18} aria-hidden className="shrink-0 text-accent" />
          <h2 className="min-w-0 truncate text-lg font-semibold text-ink">
            <span className="tabular-nums">#{run.cardNumber}</span> {run.cardTitle}
          </h2>
          <Badge tone={run.state === 'running' ? 'accent' : run.state === 'paused' ? 'caution' : 'neutral'}>
            {run.state === 'running'
              ? t('milestoneRun.launchedAgo', { age: relativeDate(run.createdAt) })
              : t(`milestone.state.${run.state}`)}
          </Badge>
          {run.branch ? (
            <span className="flex min-w-0 items-center gap-1 text-xs text-ink-soft">
              <GitBranch size={13} aria-hidden className="shrink-0 text-ink-faint" />
              <span className="truncate font-mono">{run.branch}</span>
              <span className="text-ink-faint">·</span>
              <span className="tabular-nums">
                {t(`milestoneRun.mergedCount.${counts.merged > 1 ? 'many' : 'one'}`, { count: counts.merged })}
              </span>
            </span>
          ) : null}
          <span className="ml-auto text-sm text-ink-soft tabular-nums">
            {t('milestoneRun.sessions', { busy: run.busy, concurrency: run.concurrency })}
            {' · '}
            {dueAt === null ? t('milestoneRun.noDue') : t('milestoneRun.due', { day: formatDay(dueAt) })}
          </span>
          {live ? (
            run.state === 'running' ? (
              <Button
                size="sm"
                variant="secondary"
                icon={<Pause size={14} />}
                disabled={update.isPending}
                onClick={() => update.mutate({ state: 'paused' })}
              >
                {t('milestoneRun.pause')}
              </Button>
            ) : (
              <Button
                size="sm"
                variant="secondary"
                icon={<Play size={14} />}
                disabled={update.isPending}
                onClick={() => update.mutate({ state: 'running' })}
              >
                {t('milestone.resume')}
              </Button>
            )
          ) : null}
        </div>
        {update.isError ? (
          <p role="alert" className="text-sm text-critical">
            {update.error.message}
          </p>
        ) : null}
        <MilestoneSegments cards={run.cards} className="[&>span]:h-2" />
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-4 pb-4">
        <div
          className="grid gap-4"
          style={{ gridTemplateColumns: `repeat(${Math.max(waves.length, 1)}, minmax(14rem, 1fr))` }}
        >
          {waves.map((wave) => (
            <section key={wave.layer ?? 'cycle'} aria-label={waveLabel(t, wave.layer)} className="flex min-w-0 flex-col gap-3">
              <h3 className="text-xs font-medium tracking-wide text-ink-faint uppercase">{waveLabel(t, wave.layer)}</h3>
              <ul className="flex flex-col gap-3">
                {wave.cards.map((entry) => (
                  <WaveCard
                    key={entry.cardId}
                    projectId={projectId}
                    entry={entry}
                    summary={entry.conversationId ? (summaries.get(entry.conversationId) ?? null) : null}
                  />
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>

      <p className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-t border-line px-4 py-2.5 text-sm text-ink-soft">
        <ListFilter size={15} aria-hidden className="shrink-0 text-ink-faint" />
        {queueLine(t, run, queue, unblocks)}
      </p>
    </div>
  )
}

function waveLabel(t: ReturnType<typeof useTranslate>, layer: number | null): string {
  if (layer === null) return t('milestoneRun.wave.cycle')
  return layer === 0 ? t('milestoneRun.wave.first') : t('milestoneRun.wave', { number: layer + 1 })
}

/** Ce que dit le pied de la vue : la file, et ce qu'elle débloquera. */
function queueLine(
  t: ReturnType<typeof useTranslate>,
  run: MilestoneRunDto,
  queue: MilestoneRunCardDto[],
  unblocks: number,
): string {
  if (run.state === 'paused') return t('milestoneRun.queue.paused', { count: queue.length })
  if (run.state !== 'running') return t('milestoneRun.queue.ended')
  const head = queue[0]
  if (!head) return t('milestoneRun.queue.empty')
  const cards = queue.map((entry) => `#${entry.number}`).join(t('milestoneRun.queue.then'))
  const next =
    unblocks === 0
      ? t('milestoneRun.queue.next', { number: head.number })
      : t(`milestoneRun.queue.unblocks.${unblocks > 1 ? 'many' : 'one'}`, { number: head.number, count: unblocks })
  return `${t('milestoneRun.queue', { cards })} — ${next}`
}

/**
 * Une carte d'une vague : son point, son numéro et son titre, puis son état et ce que sa
 * session te demande, puis « après #N ». Elle mène à sa session, ou à défaut au board.
 */
function WaveCard({
  projectId,
  entry,
  summary,
}: {
  projectId: string
  entry: MilestoneRunCardDto
  summary: SessionSummary | null
}) {
  const t = useTranslate()
  const tone = milestoneToneOf(entry.status)
  const to = entry.conversationId
    ? `/p/${projectId}/c/${entry.conversationId}`
    : `/p/${projectId}/board?carte=${entry.number}`
  // Une carte bloquée sans demande ouverte dit pourquoi ; l'erreur d'un lancement aussi.
  const detail: SessionSummary | null =
    summary ??
    (entry.status === 'blocked' && entry.blockReason
      ? { text: t(`milestone.block.${entry.blockReason}`), tone: 'caution' }
      : entry.status === 'failed' && entry.error
        ? { text: entry.error, tone: 'critical' }
        : null)

  return (
    <li>
      <Link
        to={to}
        className={cx(
          'flex min-w-0 flex-col gap-1 rounded-xl border px-3.5 py-2.5 transition-colors hover:border-accent/60',
          'focus-visible:outline-2 focus-visible:outline-accent',
          TILE_TONES[tone],
        )}
      >
        <span className="flex min-w-0 items-center gap-2 text-sm">
          <span
            aria-hidden
            className={cx(
              'size-2 shrink-0 rounded-full',
              MILESTONE_SEGMENT_TONES[tone],
              tone === 'working' && 'animate-pulse',
            )}
          />
          <span className="shrink-0 text-xs text-ink-faint tabular-nums">#{entry.number}</span>
          <span className="min-w-0 truncate text-ink">{entry.title}</span>
        </span>
        <span className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 text-sm text-ink-soft">
          {t(`milestoneRun.status.${entry.status}`)}
          {detail ? (
            <span className={cx('min-w-0 truncate', SUMMARY_TONES[detail.tone])}>· {detail.text}</span>
          ) : null}
        </span>
        {entry.blockedBy.length > 0 ? (
          <span className="flex min-w-0 items-center gap-1 text-xs text-ink-faint">
            <Workflow size={12} aria-hidden className="shrink-0" />
            <span className="truncate">
              {t('milestoneRun.after', { cards: entry.blockedBy.map((blocker) => `#${blocker.number}`).join(', ') })}
            </span>
          </span>
        ) : null}
      </Link>
    </li>
  )
}
