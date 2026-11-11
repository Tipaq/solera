/* PROTOTYPE — jetable (branche proto/page-projet). Ne pas fusionner dans main.
 *
 * Les pièces communes du portefeuille v2 : la pastille de projet, la barre d'outils sur
 * une ligne avec le filtre Projet, le retour des gestes simulés.
 */
import { Filter } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { ProjectDto } from '@solera/protocol'
import { Popover, cx } from '@solera/ui'
import { ProjectAvatar } from '../../components/ProjectAvatar'
import {
  FilterChip,
  MenuHeading,
  MenuCheck,
  OneLineToolbar,
  ToolbarSearch,
  ViewTiles,
  toolbarButtonClass,
  type ViewOption,
} from '../../components/prototype/ViewSwitch'
import { DemoToggle } from '../prototype-milestones/HorizonVariant'

/** La pastille d'un projet : son avatar et son nom, qui mène à sa page. */
/** `plain` : sans lien, pour une pastille posée dans une ligne déjà cliquable. */
export function ProjectPip({ project, to, className, plain = false }: { project: ProjectDto; to?: string; className?: string; plain?: boolean }) {
  const body = (
    <>
      <ProjectAvatar project={project} className="size-3.5 shrink-0" />
      <span className="truncate">{project.name}</span>
    </>
  )
  const shape = cx('inline-flex min-w-0 max-w-[12rem] items-center gap-1.5 text-xs text-ink-soft', className)
  if (plain || project.id.startsWith('demo-')) return <span className={shape}>{body}</span>
  return (
    <Link to={to ?? `/p/${project.id}`} onClick={(event) => event.stopPropagation()} className={cx(shape, 'hover:text-ink hover:underline underline-offset-2')}>
      {body}
    </Link>
  )
}

/** Un ensemble coché, pour les filtres multi-choix. */
export function toggled<T>(set: ReadonlySet<T>, value: T): Set<T> {
  const next = new Set(set)
  if (next.has(value)) next.delete(value)
  else next.add(value)
  return next
}

/**
 * La barre d'outils du portefeuille : la même que celle d'un projet (recherche,
 * Filtrer ▾, puces, Affichage ▾, action), avec la section **Projet** en tête de Filtrer.
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
  demo,
  meta,
}: {
  search: string
  onSearch: (next: string) => void
  placeholder: string
  projects: ProjectDto[]
  selected: ReadonlySet<string>
  onSelected: (next: ReadonlySet<string>) => void
  /** Combien d'éléments par projet, en regard de la case. */
  counts?: Map<string, number>
  filterExtra?: ReactNode
  extraChips?: ReactNode
  extraActive?: number
  onClearExtra?: () => void
  views?: ViewOption<K>[]
  view?: K
  onView?: (next: K) => void
  displayExtra?: ReactNode
  action?: ReactNode
  demo: boolean
  /** Texte méta neutre, à droite (un bilan). */
  meta?: ReactNode
}) {
  const [filterOpen, setFilterOpen] = useState(false)
  const [displayOpen, setDisplayOpen] = useState(false)
  const active = selected.size + extraActive
  const current = views?.find((option) => option.key === view)

  return (
    <OneLineToolbar
      search={<ToolbarSearch value={search} onChange={onSearch} placeholder={placeholder} />}
      filter={
        <Popover
          open={filterOpen}
          onOpenChange={setFilterOpen}
          label="Filtrer"
          side="bottom"
          align="start"
          className="w-80"
          trigger={
            <button type="button" className={toolbarButtonClass(active > 0)}>
              <Filter size={13} /> Filtrer
              {active > 0 ? <span className="rounded bg-accent px-1 text-[10px] font-semibold tabular-nums text-accent-ink">{active}</span> : null}
            </button>
          }
        >
          <div className="max-h-[70vh] overflow-y-auto pb-2">
            <MenuHeading>Projet</MenuHeading>
            {projects.map((project) => (
              <MenuCheck
                key={project.id}
                checked={selected.has(project.id)}
                onChange={() => onSelected(toggled(selected, project.id))}
                aside={counts?.get(project.id)}
              >
                <span className="inline-flex min-w-0 items-center gap-1.5">
                  <ProjectAvatar project={project} className="size-3.5 shrink-0" />
                  <span className="truncate">{project.name}</span>
                </span>
              </MenuCheck>
            ))}
            {filterExtra}
            {active > 0 ? (
              <div className="mt-2 border-t border-line px-3 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    onSelected(new Set())
                    onClearExtra?.()
                  }}
                  className="text-xs text-ink-faint hover:text-ink"
                >
                  Effacer tous les filtres
                </button>
              </div>
            ) : null}
          </div>
        </Popover>
      }
      chips={
        <>
          {projects
            .filter((project) => selected.has(project.id))
            .map((project) => (
              <FilterChip key={project.id} onClear={() => onSelected(toggled(selected, project.id))}>
                <span className="inline-flex items-center gap-1">
                  <ProjectAvatar project={project} className="size-3 shrink-0" /> {project.name}
                </span>
              </FilterChip>
            ))}
          {extraChips}
        </>
      }
      extra={
        <span className="hidden items-center gap-2 lg:flex">
          {meta ? <span className="text-xs text-ink-faint tabular-nums">{meta}</span> : null}
          <DemoToggle demo={demo} />
        </span>
      }
      display={
        views && view && onView ? (
          <Popover
            open={displayOpen}
            onOpenChange={setDisplayOpen}
            label="Affichage"
            side="bottom"
            align="end"
            className="w-80"
            trigger={
              <button type="button" className={toolbarButtonClass(false)} title={`Affichage : ${current?.label ?? ''}`}>
                {current?.icon} <span className="hidden sm:inline">Affichage</span>
              </button>
            }
          >
            <div className="pb-3">
              <ViewTiles options={views} value={view} onChange={onView} />
              {displayExtra}
            </div>
          </Popover>
        ) : null
      }
      action={action}
    />
  )
}

/** Le retour des gestes simulés, au même endroit sur toutes les pages. */
export function useNotice(): [ReactNode, (text: string) => void] {
  const [text, setText] = useState<string | null>(null)
  const node = text ? (
    <div className="mx-4 mt-2 flex items-center gap-2 rounded-lg border border-dashed border-fuchsia-500/60 px-3 py-2 text-xs text-fuchsia-600 md:mx-6 dark:text-fuchsia-300">
      Simulé : {text}
      <button type="button" className="ml-auto underline" onClick={() => setText(null)}>Fermer</button>
    </div>
  ) : null
  return [node, setText]
}

/** Un titre de section, sobre, avec son compte. */
export function SectionTitle({ children, count, aside }: { children: ReactNode; count?: number; aside?: ReactNode }) {
  return (
    <div className="flex items-baseline gap-2">
      <h2 className="text-sm font-medium text-ink">{children}</h2>
      {count !== undefined ? <span className="text-xs tabular-nums text-ink-faint">{count}</span> : null}
      {aside ? <span className="ml-auto">{aside}</span> : null}
    </div>
  )
}

/** L'en-tête d'un groupe par projet. */
export function ProjectGroupHeader({ project, count, aside }: { project: ProjectDto; count?: number; aside?: ReactNode }) {
  return (
    <div className="flex items-center gap-2 py-1">
      <ProjectAvatar project={project} className="size-4 shrink-0" />
      {project.id.startsWith('demo-') ? (
        <span className="text-sm font-medium text-ink">{project.name}</span>
      ) : (
        <Link to={`/p/${project.id}`} className="text-sm font-medium text-ink hover:underline underline-offset-2">{project.name}</Link>
      )}
      {count !== undefined ? <span className="text-xs tabular-nums text-ink-faint">{count}</span> : null}
      {aside ? <span className="ml-auto flex items-center gap-2">{aside}</span> : null}
    </div>
  )
}
