import { ArrowLeft, Flag } from 'lucide-react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { DEFAULT_MILESTONE_CONCURRENCY } from '@solera/protocol'
import { Badge, Button, EmptyState, cx } from '@solera/ui'
import { CardMilestone } from '../../components/board/CardMilestone'
import { CardInfoButton } from '../../components/cards/CardInfoButton'
import { CardSheetHost } from '../../components/cards/CardSheetHost'
import { MaturityPill } from '../../components/milestones/MaturityPill'
import { ExplainedSteps } from '../../components/milestones/MaturitySteps'
import { WaveGraph } from '../../components/milestones/WaveGraph'
import { withSheet } from '../../lib/card-sheet'
import type { StatusOf } from '../../lib/card-state'
import { formatDay, relativeDate } from '../../lib/dates'
import { useTranslate } from '../../lib/i18n'
import {
  gestureOf,
  maturityReasons,
  nextAction,
  nextActionText,
  reasonText,
  refinePending,
  type MilestoneEntry,
} from '../../lib/milestone-model'
import { useMilestones } from '../../lib/milestones'
import { useMergeBranchPullRequest } from '../../lib/pull-requests'

/**
 * **La page d'un jalon** (spec jalons JAL-1..8), sous l'onglet Jalons : où il en est et
 * pourquoi, ce qu'il attend de toi, et ses cartes en vagues. Une idée a la sienne aussi :
 * c'est d'ici qu'on l'affine.
 *
 * Deux emplacements, `#affinage` et `#lancer`, que la prochaine action fait défiler. En
 * attendant le résumé d'affinage (#195) et le panneau Lancer (#197), ils portent ce que
 * `main` savait déjà faire : les raisons et la session d'affinage, le lancement et le
 * suivi du pilotage (`CardMilestone`).
 */
export function MilestonePage() {
  const { projectId, number } = useParams()
  const t = useTranslate()
  const { entries, statusOf, isPending } = useMilestones(projectId)
  const entry = entries.find((candidate) => String(candidate.card.number) === number) ?? null

  if (isPending) return null
  if (!projectId || !entry) {
    return (
      <>
        <EmptyState
          icon={<Flag size={22} />}
          title={t('milestone.page.notMilestone', { number: number ?? '' })}
          description={t('milestone.page.notMilestoneHint')}
          action={
            projectId ? (
              <Link to={`/p/${projectId}/timeline`} className="text-sm text-accent hover:underline">
                {t('milestone.page.back')}
              </Link>
            ) : undefined
          }
        />
        {projectId ? <CardSheetHost projectId={projectId} /> : null}
      </>
    )
  }
  return <MilestoneView projectId={projectId} entry={entry} statusOf={statusOf} />
}

function MilestoneView({ projectId, entry, statusOf }: { projectId: string; entry: MilestoneEntry; statusOf: StatusOf }) {
  const t = useTranslate()
  const navigate = useNavigate()
  const [, setParams] = useSearchParams()
  const merge = useMergeBranchPullRequest(projectId, entry.card.id)
  const { card } = entry

  const action = nextActionText(nextAction(entry), t)
  const gesture = gestureOf(entry)
  const act = gesture
    ? () => {
        switch (gesture.kind) {
          case 'refine':
            // La session d'affinage déjà ouverte, sinon un découpage neuf de cette carte.
            return navigate(
              card.refinement ? `/p/${projectId}/c/${card.refinement.conversationId}` : `/p/${projectId}/c/new?split=${card.id}`,
            )
          case 'scroll':
            return document.getElementById(gesture.target)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
          case 'merge':
            return merge.mutate()
          case 'sheet':
            return setParams((current) => withSheet(current, gesture.number))
        }
      }
    : null
  const pending = refinePending(entry)
  const refine = (
    <div id="affinage" className="min-w-0 scroll-mt-4 xl:col-start-1">
      <RefineSlot projectId={projectId} entry={entry} pending={pending} />
    </div>
  )

  return (
    <div className="h-full overflow-y-auto">
      <div className="flex flex-col gap-5 p-4 md:p-6">
        <Link
          to={`/p/${projectId}/timeline`}
          className="inline-flex items-center gap-1 self-start rounded text-xs text-ink-faint hover:text-ink"
        >
          <ArrowLeft size={13} aria-hidden />
          {t('milestone.page.back')}
        </Link>

        <header className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          <Flag size={18} aria-hidden className={cx('shrink-0', entry.maturity === 'launched' ? 'text-accent' : 'text-ink-faint')} />
          <h2 className="min-w-0 text-lg leading-snug font-semibold text-ink">
            <span className="text-ink-faint tabular-nums">#{card.number}</span> {card.title}
          </h2>
          <CardInfoButton card={card} />
          <MaturityPill maturity={entry.maturity} entry={entry} />
          <span className="text-sm text-ink-soft">
            {card.dueAt === null
              ? t('milestone.page.noDue')
              : t('milestone.page.due', { day: formatDay(card.dueAt), relative: relativeDate(card.dueAt) })}
          </span>
          {entry.addedSinceLaunch.length ? (
            <Badge tone="caution">{t('milestone.page.sinceLaunch', { count: entry.addedSinceLaunch.length })}</Badge>
          ) : null}
        </header>

        <section
          aria-label={t('milestone.page.nextAction')}
          className="flex flex-col gap-4 rounded-2xl border border-accent/30 bg-accent-wash/25 p-4 md:p-5"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="text-xs font-medium tracking-wide text-accent uppercase">{t('milestone.page.nextAction')}</span>
              <p className="text-lg leading-snug font-semibold text-ink md:text-xl">{action.detail}</p>
            </div>
            {act ? (
              <Button className="shrink-0 self-start sm:self-center" disabled={merge.isPending} onClick={act}>
                {action.label}
              </Button>
            ) : null}
          </div>
          {merge.isError ? (
            <p role="alert" className="text-sm text-critical">
              {t('milestone.page.mergeFailed', { error: merge.error.message })}
            </p>
          ) : null}
          <ExplainedSteps entry={entry} action={action} onAct={act} />
        </section>

        {/* Une colonne au téléphone — l'affinage s'il attend, les vagues, Lancer, puis
            l'affinage s'il n'attend rien —, et Lancer à droite au large, collé en haut
            pendant qu'on lit le graphe. */}
        <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
          {pending ? refine : null}
          <div className="min-w-0 xl:col-start-1">
            <Waves projectId={projectId} entry={entry} statusOf={statusOf} />
          </div>
          <div id="lancer" className="min-w-0 scroll-mt-4 xl:sticky xl:top-0 xl:col-start-2 xl:row-span-3 xl:row-start-1">
            <LaunchSlot projectId={projectId} entry={entry} />
          </div>
          {pending ? null : refine}
        </div>
      </div>
      <CardSheetHost projectId={projectId} />
    </div>
  )
}

/** Le graphe, surmonté de ce qu'il dit : ce qui part ensemble, et combien à la fois (VAG-1, VAG-2). */
function Waves({ projectId, entry, statusOf }: { projectId: string; entry: MilestoneEntry; statusOf: StatusOf }) {
  const t = useTranslate()
  // Le panneau Lancer (#197) fera choisir la concurrence ; d'ici là, celle du pilotage.
  const concurrency = entry.run?.concurrency ?? DEFAULT_MILESTONE_CONCURRENCY
  const empty = entry.children.every((child) => child.column === 'abandoned')
  return (
    <section aria-label={t('milestone.waves.title')} className="flex min-w-0 flex-col gap-2">
      <div className="flex items-baseline gap-2">
        <h3 className="text-sm font-semibold text-ink">{t('milestone.waves.title')}</h3>
        <span className="text-xs text-ink-faint">{t('milestone.waves.hint', { count: concurrency })}</span>
      </div>
      {empty ? (
        <p className="rounded-xl border border-dashed border-line px-3.5 py-4 text-sm text-ink-faint">{t('milestone.waves.empty')}</p>
      ) : (
        <div className="rounded-xl border border-line p-3 md:p-4">
          <WaveGraph
            projectId={projectId}
            cards={entry.children}
            concurrency={concurrency}
            launchedAt={entry.launchedAt}
            statusOf={statusOf}
          />
        </div>
      )}
    </section>
  )
}

/**
 * L'emplacement de l'affinage, en attendant son résumé (#195) et « À régler avant de
 * partir » (#196) : pourquoi le jalon attend, et sa session d'affinage.
 */
function RefineSlot({ projectId, entry, pending }: { projectId: string; entry: MilestoneEntry; pending: boolean }) {
  const t = useTranslate()
  const session = entry.card.refinement
  if (!pending && !session) return null
  return (
    <section aria-label={t('milestone.page.refine')} className="flex flex-col gap-2 rounded-xl border border-line p-3.5">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold text-ink">{t('milestone.page.refine')}</h3>
        {session ? (
          <Link to={`/p/${projectId}/c/${session.conversationId}`} className="ml-auto text-xs text-accent hover:underline">
            {t('milestone.page.refineOpen')}
          </Link>
        ) : null}
      </div>
      {pending ? (
        <ul className="flex flex-col gap-1 text-sm text-ink-soft">
          {maturityReasons(entry).map((reason) => (
            <li key={reason.kind}>{reasonText(reason, t)}</li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}

/**
 * L'emplacement de Lancer, en attendant son panneau (#197) et le suivi (#198) : le
 * lancement et le pilotage tels que la fiche du board les offre. Rien pour une idée sans
 * cartes, ni pour un jalon livré qu'aucun pilotage ne suit plus.
 */
function LaunchSlot({ projectId, entry }: { projectId: string; entry: MilestoneEntry }) {
  const t = useTranslate()
  const [, setParams] = useSearchParams()
  if (entry.children.length === 0 || (entry.maturity === 'delivered' && entry.run === null)) return null
  return (
    <section aria-label={t('milestone.page.launch')} className="rounded-xl border border-line p-3.5">
      <CardMilestone
        card={entry.card}
        projectId={projectId}
        onSelectCard={(number) => setParams((current) => withSheet(current, number))}
      />
    </section>
  )
}
