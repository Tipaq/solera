import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { JournalEntryDto, ProjectDto } from '@solera/protocol'
import { cx } from '@solera/ui'
import { ProjectAvatar } from '../ProjectAvatar'
import { elapsed } from '../../lib/dates'
import { useTranslate } from '../../lib/i18n'
import { JOURNAL_KIND_LABELS, useJournal } from '../../lib/journal'
import { JOURNAL_KIND_ICONS, journalDestination, journalIconTone } from '../journal/JournalView'
import { MoreLink, OverviewSection } from './OverviewSection'

/** Lignes montrées : l'Aperçu donne le pouls, Travail › Par moment tout le fil. */
const EVENTS_SHOWN = 5

/**
 * « Derniers événements » (`projet.md` A-6) : les cinq dernières lignes du journal,
 * toutes natures mêlées, et le lien vers Travail › Par moment, qui a absorbé le Journal.
 *
 * Même requête que la vue Par moment (`useJournal(projectId)`, même clé) : l'ouvrir
 * ensuite ne coûte rien de plus, et une fenêtre plus courte ferait un second `git log`.
 */
export function RecentEvents({ projectId }: { projectId: string }) {
  const t = useTranslate()
  const { data } = useJournal(projectId)
  // Rien tant que le journal charge (A-1.4) : « Rien ces 14 derniers jours » serait faux.
  if (!data) return null
  return (
    <RecentEventsView
      entries={data.entries.slice(0, EVENTS_SHOWN)}
      days={data.days}
      more={<MoreLink to={`/p/${projectId}/travail?vue=fil`}>{t('project.overview.events.more')}</MoreLink>}
    />
  )
}

const SHAPE = 'grid h-9 pointer-coarse:h-11 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 text-sm'

type EventProject = Pick<ProjectDto, 'id' | 'name' | 'image' | 'color'>

/**
 * Le bloc sans sa requête, pour sa story et pour le portefeuille.
 *
 * `projects` : le projet de chaque ligne, quand la liste en mêle plusieurs (PF-12). Son
 * avatar prend alors la place de la nature de la ligne, que l'icône dit déjà.
 */
export function RecentEventsView({
  entries,
  days,
  more,
  projects,
}: {
  entries: JournalEntryDto[]
  days: number
  /** Le lien du titre vers la vue qui montre tout le fil. */
  more?: ReactNode
  projects?: ReadonlyMap<string, EventProject>
}) {
  const t = useTranslate()
  return (
    <OverviewSection title={t('project.overview.events.title')} more={more}>
      {entries.length === 0 ? (
        <p className="text-sm text-ink-faint">{t('project.overview.events.empty', { count: days })}</p>
      ) : (
        <ul className="flex flex-col">
          {entries.map((entry) => {
            const to = journalDestination(entry)
            const project = projects?.get(entry.projectId)
            const body = (
              <>
                <span aria-hidden className={cx('flex', journalIconTone(entry))}>
                  {JOURNAL_KIND_ICONS[entry.kind]}
                </span>
                <span className="flex min-w-0 items-baseline gap-3">
                  <span className={cx('truncate text-ink', project && 'flex-1')}>{entry.title}</span>
                  {project ? (
                    <span className="flex shrink-0 self-center" title={project.name}>
                      <ProjectAvatar project={project} className="size-3.5" />
                      <span className="sr-only">{project.name}</span>
                    </span>
                  ) : (
                    <span className="hidden shrink-0 text-xs text-ink-faint sm:inline">{t(JOURNAL_KIND_LABELS[entry.kind])}</span>
                  )}
                </span>
                <span className="text-xs text-ink-faint tabular-nums">{elapsed(entry.at)}</span>
              </>
            )
            return (
              <li key={entry.id}>
                {to ? (
                  <Link
                    to={to}
                    className={cx(
                      SHAPE,
                      '-mx-2 rounded-md px-2 transition-colors hover:bg-surface-high focus-visible:outline-2 focus-visible:outline-accent',
                    )}
                  >
                    {body}
                  </Link>
                ) : (
                  /* Une fusion faite au terminal, un audit versé sur le disque : Solera n'a
                     pas de page pour eux, et une ligne qui a l'air cliquable sans l'être
                     est pire qu'une ligne inerte. */
                  <div className={SHAPE}>{body}</div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </OverviewSection>
  )
}
