import { ArrowLeft, Flag, Plus } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { DEFAULT_MILESTONE_CONCURRENCY } from '@solera/protocol'
import type { CardDto } from '@solera/protocol'
import { Badge, Button, EmptyState, cx } from '@solera/ui'
import { CardMilestone } from '../../components/board/CardMilestone'
import { CardInfoButton } from '../../components/cards/CardInfoButton'
import { CardSheetHost } from '../../components/cards/CardSheetHost'
import { AddToMilestoneDrawer } from '../../components/milestones/AddToMilestoneDrawer'
import { LaunchPanel } from '../../components/milestones/LaunchPanel'
import { MaturityPill } from '../../components/milestones/MaturityPill'
import { ExplainedSteps } from '../../components/milestones/MaturitySteps'
import { RefinementPanel } from '../../components/milestones/RefinementPanel'
import { SettleList } from '../../components/milestones/SettleList'
import { WaveGraph } from '../../components/milestones/WaveGraph'
import { withSheet } from '../../lib/card-sheet'
import type { StatusOf } from '../../lib/card-state'
import { formatDay, relativeDate } from '../../lib/dates'
import { useTranslate } from '../../lib/i18n'
import { gestureOf, nextAction, nextActionText, refinePending, type MilestoneEntry } from '../../lib/milestone-model'
import { launchStage } from '../../lib/milestone-launch'
import { useMilestones } from '../../lib/milestones'
import { useMergeBranchPullRequest } from '../../lib/pull-requests'
import { refineHref } from '../../lib/refinement'

/**
 * **La page d'un jalon** (spec jalons JAL-1..8), sous l'onglet Jalons : où il en est et
 * pourquoi, ce qu'il attend de toi, et ses cartes en vagues. Une idée a la sienne aussi :
 * c'est d'ici qu'on l'affine.
 *
 * Deux emplacements, `#affinage` et `#lancer`, que la prochaine action fait défiler.
 * `#affinage` porte la session d'affinage résumée (#195) et « À régler avant de partir »
 * (#196), `#lancer` le panneau Lancer (#197). En attendant le suivi d'un jalon lancé
 * (#198), il porte aussi ce que `main` savait déjà faire : le suivi du pilotage
 * (`CardMilestone`).
 */
export function MilestonePage() {
  const { projectId, number } = useParams()
  const t = useTranslate()
  const { entries, cards, statusOf, isPending } = useMilestones(projectId)
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
  return <MilestoneView projectId={projectId} entry={entry} cards={cards} statusOf={statusOf} />
}

function MilestoneView({
  projectId,
  entry,
  cards,
  statusOf,
}: {
  projectId: string
  entry: MilestoneEntry
  cards: readonly CardDto[]
  statusOf: StatusOf
}) {
  const t = useTranslate()
  const navigate = useNavigate()
  const [, setParams] = useSearchParams()
  const merge = useMergeBranchPullRequest(projectId, entry.card.id)
  const [adding, setAdding] = useState(false)
  // Choisie dans Lancer, montrée par les vagues (VAG-1) ; celle du pilotage, une fois lancé.
  const [concurrency, setConcurrency] = useState(DEFAULT_MILESTONE_CONCURRENCY)
  const { card } = entry

  const action = nextActionText(nextAction(entry), t)
  const gesture = gestureOf(entry)
  const act = gesture
    ? () => {
        switch (gesture.kind) {
          case 'refine':
            // La session d'affinage déjà ouverte, sinon un découpage neuf de cette carte (AFF-2).
            return navigate(refineHref(projectId, card, 'questions'))
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
    <div id="affinage" className="flex min-w-0 scroll-mt-4 flex-col gap-5 xl:col-start-1">
      <RefinementPanel projectId={projectId} entry={entry} />
      <SettleList projectId={projectId} entry={entry} />
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
          {entry.maturity === 'delivered' ? null : (
            <span className="ml-auto">
              <Button size="sm" variant="secondary" icon={<Plus size={14} />} onClick={() => setAdding(true)}>
                {t('milestone.page.addTo')}
              </Button>
            </span>
          )}
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
            <Waves projectId={projectId} entry={entry} statusOf={statusOf} concurrency={entry.run?.concurrency ?? concurrency} />
          </div>
          <div id="lancer" className="min-w-0 scroll-mt-4 xl:sticky xl:top-0 xl:col-start-2 xl:row-span-3 xl:row-start-1">
            {launchStage(entry) === 'launched' ? (
              <RunSlot projectId={projectId} entry={entry} />
            ) : (
              <LaunchPanel projectId={projectId} entry={entry} concurrency={concurrency} onConcurrency={setConcurrency} statusOf={statusOf} />
            )}
          </div>
          {pending ? null : refine}
        </div>
      </div>
      <CardSheetHost projectId={projectId} />
      <AddToMilestoneDrawer open={adding} onClose={() => setAdding(false)} projectId={projectId} milestone={card} cards={cards} />
    </div>
  )
}

/** Le graphe, surmonté de ce qu'il dit : ce qui part ensemble, et combien à la fois (VAG-1, VAG-2). */
function Waves({
  projectId,
  entry,
  statusOf,
  concurrency,
}: {
  projectId: string
  entry: MilestoneEntry
  statusOf: StatusOf
  concurrency: number
}) {
  const t = useTranslate()
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
 * Le suivi d'un jalon lancé, en attendant son panneau (#198) : le pilotage tel que la
 * fiche du board l'offre.
 */
function RunSlot({ projectId, entry }: { projectId: string; entry: MilestoneEntry }) {
  const t = useTranslate()
  const [, setParams] = useSearchParams()
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
