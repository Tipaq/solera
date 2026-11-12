import type { ReactNode } from 'react'
import type { ProjectDto } from '@solera/protocol'
import { toggled } from '../../lib/filters'
import { useTranslate } from '../../lib/i18n'
import { ProjectAvatar } from '../ProjectAvatar'
import { ProjectPip } from '../places/ProjectPip'
import { FilterChip, OneLineToolbar, ToolbarSearch } from '../toolbar/OneLineToolbar'
import { DisplayMenu, FilterMenu, MenuCheck, MenuHeading, type ViewOption } from '../toolbar/ToolbarMenus'

type ToolbarProject = Pick<ProjectDto, 'id' | 'name' | 'image' | 'color'>

/**
 * La barre d'outils du portefeuille (`coque.md` PF-5), sur Travail, Tableau, Jalons et
 * Actions : la même qu'une page de projet (recherche, Filtrer ▾, puces, Affichage ▾,
 * action), avec la section **Projet** en tête de Filtrer ▾. Chaque projet y porte son
 * avatar, son nom et, en regard, ce qu'il compte dans la page ; ses puces aussi.
 *
 * Les filtres propres à la page s'ajoutent sous la section Projet (`filterExtra`), leurs
 * puces après celles des projets (`extraChips`) ; « Effacer tous les filtres » vide les
 * deux. La méta est un bilan neutre, qui ne se lit qu'à partir de `lg`.
 */
export function PortfolioToolbar<K extends string>({
  search,
  onSearch,
  placeholder,
  projects,
  selected,
  onSelected,
  counts,
  filterExtra,
  extraChips,
  extraActive = 0,
  onClearExtra,
  views,
  view,
  onView,
  displayExtra,
  action,
  meta,
}: {
  search: string
  onSearch: (next: string) => void
  placeholder: string
  projects: ToolbarProject[]
  selected: ReadonlySet<string>
  onSelected: (next: ReadonlySet<string>) => void
  /** Combien d'éléments par projet, en regard de sa case. */
  counts?: ReadonlyMap<string, number>
  filterExtra?: ReactNode
  extraChips?: ReactNode
  /** Le nombre de filtres propres à la page posés, pour le compte de Filtrer ▾. */
  extraActive?: number
  onClearExtra?: () => void
  views?: ViewOption<K>[]
  view?: K
  onView?: (next: K) => void
  /** Les réglages de présentation, sous les tuiles des vues. */
  displayExtra?: ReactNode
  /** L'action de la page, au bout de la barre. */
  action?: ReactNode
  /** Le bilan, à droite : un texte méta neutre. */
  meta?: ReactNode
}) {
  const t = useTranslate()
  // Un projet coché puis archivé ne se voit plus : il ne compte pas comme filtre posé.
  const chosen = projects.filter((project) => selected.has(project.id))
  const active = chosen.length + extraActive
  const clearAll = () => {
    onSelected(new Set())
    onClearExtra?.()
  }

  return (
    <OneLineToolbar
      search={<ToolbarSearch value={search} onChange={onSearch} placeholder={placeholder} />}
      filter={
        <FilterMenu active={active} onClearAll={clearAll}>
          <MenuHeading>{t('portfolio.toolbar.project')}</MenuHeading>
          {projects.map((project) => (
            <MenuCheck
              key={project.id}
              checked={selected.has(project.id)}
              onChange={() => onSelected(toggled(selected, project.id))}
              aside={counts?.get(project.id)}
            >
              <ProjectPip project={project} plain />
            </MenuCheck>
          ))}
          {filterExtra}
        </FilterMenu>
      }
      chips={
        <>
          {chosen.map((project) => (
            <FilterChip key={project.id} onClear={() => onSelected(toggled(selected, project.id))}>
              <span className="inline-flex min-w-0 items-center gap-1">
                <ProjectAvatar project={project} className="size-3 shrink-0" />
                <span className="truncate">{project.name}</span>
              </span>
            </FilterChip>
          ))}
          {extraChips}
        </>
      }
      extra={meta ? <span className="hidden shrink-0 px-1 text-xs text-ink-faint tabular-nums lg:inline">{meta}</span> : undefined}
      display={
        views && view !== undefined && onView ? (
          <DisplayMenu views={views} value={view} onChange={onView}>
            {displayExtra}
          </DisplayMenu>
        ) : displayExtra ? (
          <DisplayMenu>{displayExtra}</DisplayMenu>
        ) : undefined
      }
      action={action}
    />
  )
}
