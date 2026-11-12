import { FolderOpen } from 'lucide-react'
import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Button, EmptyState } from '@solera/ui'
import { AskInbox } from '../components/inbox/AskInbox'
import { OverviewSection } from '../components/overview/OverviewSection'
import { RecentEventsView } from '../components/overview/RecentEvents'
import { PortfolioCode } from '../components/portfolio/PortfolioCode'
import { ProjectSummaryCard } from '../components/portfolio/ProjectSummaryCard'
import { useAllCards } from '../lib/cards'
import { codeSessionOf, usePortfolioCode } from '../lib/code-data'
import { useTranslate } from '../lib/i18n'
import { useJournal } from '../lib/journal'
import { activeTrees, EVENTS_SHOWN, projectSummaries, recentEvents } from '../lib/portfolio-overview'
import { useAllActiveMilestones } from '../lib/milestones'
import { usePortfolioLive } from '../lib/portfolio'
import { useInbox } from '../lib/use-inbox'

/**
 * L'**Aperçu** du portefeuille (#237, `coque.md` PF-8 à PF-13) : « où en sont mes
 * projets ? ». Le pendant de l'Aperçu d'un projet, un cran au-dessus : ce qui t'attend
 * dans tous les projets, une carte par projet, le code en cours et les derniers
 * événements, chaque ligne avec son projet.
 *
 * Pas de barre recherche / Filtrer / Affichage (PF-8, décidé le 2026-11-11) : c'est une
 * page qu'on lit, pas une liste qu'on trie.
 *
 * Toutes ses requêtes sont celles que la coque et « Ce qui t'attend » lisent déjà (liste
 * des projets et des conversations, cartes de chaque projet, PR), plus deux pour tous
 * les projets : l'état des worktrees et le journal.
 */
export function PortfolioOverviewPage() {
  const t = useTranslate()
  const { projects: visible, live, isPending } = usePortfolioLive()
  const byId = useMemo(() => new Map(visible.map((project) => [project.id, project])), [visible])
  const runs = useAllActiveMilestones(useMemo(() => visible.map((project) => project.id), [visible]))
  const inbox = useInbox({ portfolio: true })
  const { cards } = useAllCards(visible)
  const code = usePortfolioCode(visible, live)
  const { data: journal } = useJournal(undefined)

  const summaries = useMemo(
    () =>
      projectSummaries({
        projects: visible,
        cards,
        runs,
        sessions: live.map(codeSessionOf).flatMap((session) => (session.projectId ? [{ projectId: session.projectId, tone: session.tone }] : [])),
        events: journal?.entries ?? [],
      }),
    [visible, cards, runs, live, journal],
  )
  const trees = useMemo(() => activeTrees(code.groups), [code.groups])
  const events = useMemo(() => recentEvents(journal?.entries ?? [], byId, EVENTS_SHOWN), [journal, byId])

  // Rien tant que les projets chargent : l'état vide serait faux.
  if (isPending) return null
  if (visible.length === 0) {
    return (
      <div className="h-full overflow-y-auto p-4 md:p-6">
        <EmptyState
          icon={<FolderOpen size={22} />}
          title={t('home.empty.title')}
          description={t('home.empty.description')}
          action={
            <Link to="/projects/new">
              <Button>{t('home.createProject')}</Button>
            </Link>
          }
        />
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto p-4 md:p-6">
      <div className="flex flex-col gap-8">
        <AskInbox items={inbox} />
        <OverviewSection title={t('portfolio.overview.projects')} count={summaries.length}>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {summaries.map((summary) => (
              <ProjectSummaryCard key={summary.project.id} summary={summary} />
            ))}
          </div>
        </OverviewSection>
        <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_26rem]">
          {/* Une case à lui, même vide le temps qu'il charge : les événements restent à droite. */}
          <div className="min-w-0">{code.pending ? null : <PortfolioCode trees={trees} />}</div>
          <div className="min-w-0">
            {journal ? (
              <RecentEventsView entries={events} days={journal.days} projects={byId} />
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}
