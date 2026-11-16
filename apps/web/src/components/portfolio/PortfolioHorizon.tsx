import type { PortfolioMilestoneGroup } from '../../lib/portfolio-milestones'
import { ProjectGroupHeader } from '../places/ProjectPip'
import { PortfolioMilestoneTile } from './PortfolioMilestoneTile'

/**
 * L'**Horizon** des Jalons du portefeuille (PF-29) : une bande par projet, son en-tête et
 * son compte, puis une grille de tuiles. `groups` arrivent filtrés et triés par la page
 * (`milestoneGroups`).
 */
export function PortfolioHorizon({ groups, now = Date.now() }: { groups: PortfolioMilestoneGroup[]; now?: number }) {
  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      {groups.map(({ project, rows }) => (
        <section key={project.id} aria-label={project.name} className="flex flex-col gap-2">
          <ProjectGroupHeader project={project} count={rows.length} />
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {rows.map((row) => (
              <PortfolioMilestoneTile key={row.entry.card.id} row={row} now={now} />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
