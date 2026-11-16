import { Link } from 'react-router-dom'
import { useTranslate } from '../../lib/i18n'
import { CODE_SHOWN, type PortfolioTree } from '../../lib/portfolio-overview'
import { AgentIcon } from '../AgentIcon'
import { PrTag } from '../code/PrTag'
import { VerdictDot, verdictReason } from '../code/VerdictDot'
import { MoreLink, OverviewSection } from '../overview/OverviewSection'
import { ProjectPip } from '../places/ProjectPip'

/**
 * « Code en cours » à l'Aperçu du portefeuille (PF-11) : les arbres actifs de tous les
 * projets (`activeTrees`), les douze premiers, le titre comptant tous les autres. Une
 * ligne par arbre — son verdict, son projet, sa branche, pourquoi elle est là et sa
 * carte, les agents qui y vivent, sa PR —, qui ouvre l'arbre dans Travail du projet.
 * « Tout le travail » mène à Travail du portefeuille.
 *
 * Une liste et non le graphe de l'Aperçu d'un projet : le graphe dessine les branches
 * d'**un** dépôt autour de sa base, et douze dépôts mêlés n'en ont pas de commune.
 */
export function PortfolioCode({ trees }: { trees: PortfolioTree[] }) {
  const t = useTranslate()
  return (
    <OverviewSection
      title={t('portfolio.overview.code')}
      count={trees.length}
      more={<MoreLink to="/projects/travail">{t('portfolio.overview.allWork')}</MoreLink>}
    >
      {trees.length === 0 ? (
        <p className="text-sm text-ink-faint">{t('portfolio.overview.nothingRunning')}</p>
      ) : (
        <ul className="flex flex-col">
          {trees.slice(0, CODE_SHOWN).map((tree) => (
            <li key={`${tree.project.id}:${tree.key}`}>
              <Link
                to={`/p/${tree.project.id}/travail?arbre=${encodeURIComponent(tree.key)}`}
                className="-mx-2 grid min-h-11 grid-cols-[0.5rem_minmax(0,9rem)_minmax(0,1fr)_auto] items-center gap-3 rounded-md px-2 py-1.5 transition-colors hover:bg-surface-high focus-visible:outline-2 focus-visible:outline-accent"
              >
                <VerdictDot verdict={tree.verdict} />
                <ProjectPip project={tree.project} plain />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate font-mono text-xs text-ink">{tree.branch ?? tree.name}</span>
                  <span className="truncate text-xs text-ink-faint">
                    {tree.card
                      ? t('portfolio.overview.treeCard', { reason: verdictReason(t, tree.reason), number: tree.card.number, title: tree.card.title })
                      : verdictReason(t, tree.reason)}
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  {tree.sessions.map((session) => (
                    <AgentIcon key={session.id} agent={session.agent} size={13} />
                  ))}
                  {/* Le numéro seul, sans lien : la ligne en est déjà un. */}
                  {tree.pr ? <PrTag pr={{ ...tree.pr, url: null }} compact /> : null}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </OverviewSection>
  )
}
