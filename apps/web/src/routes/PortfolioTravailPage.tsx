import { Clock, FolderTree, Table2 } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { AskInbox } from '../components/inbox/AskInbox'
import { ProjectGroupHeader } from '../components/places/ProjectPip'
import { PortfolioCleanButton, PortfolioCleanHost } from '../components/portfolio/PortfolioClean'
import { PortfolioToolbar } from '../components/portfolio/PortfolioToolbar'
import { WorkFolded, WorkMoments, WorkTreeList } from '../components/portfolio/PortfolioWork'
import { verdictReason } from '../components/code/VerdictDot'
import { FilterChip } from '../components/toolbar/OneLineToolbar'
import { MenuCheck, MenuHeading, type ViewOption } from '../components/toolbar/ToolbarMenus'
import { usePortfolioCode } from '../lib/code-data'
import { formatBytes, pluralOf } from '../lib/code-model'
import { useLocale, useTranslate, type MessageKey } from '../lib/i18n'
import { useJournal, useJournalDays } from '../lib/journal'
import { usePortfolioLive } from '../lib/portfolio'
import { WORK_STATES, inboxInProjects, readWorkFilters, workEvents, workLayout, type WorkFilters, type WorkState } from '../lib/portfolio-work'
import { useInbox } from '../lib/use-inbox'
import { useStoredPref, useView } from '../lib/use-view'
import { viewStorageKey } from '../lib/view-pref'

type View = 'projet' | 'tableau' | 'moment'
const VIEW_KEYS: View[] = ['projet', 'tableau', 'moment']
const VIEW_ICONS: Record<View, ReactNode> = {
  projet: <FolderTree size={16} />,
  tableau: <Table2 size={16} />,
  moment: <Clock size={16} />,
}

const STATE_LABEL: Record<WorkState, MessageKey> = {
  waiting: 'portfolio.work.state.waiting',
  active: 'portfolio.work.state.active',
  review: 'portfolio.work.state.review',
  clean: 'portfolio.work.state.clean',
}

const readShowMerged = (raw: string | null) => raw === 'true'

/**
 * L'onglet **Travail** du portefeuille (#238, `coque.md` PF-14 à PF-21) : les arbres et
 * les branches de tous les projets, avec la barre d'une page de projet et la section
 * Projet en tête de Filtrer ▾.
 *
 * Trois vues : **Par projet** (un groupe par projet, les fusionnés repliés dessous),
 * **Tableau** (une seule table, colonne Projet), **Par moment** (le fil de tous les
 * projets). Un arbre s'ouvre dans Travail de son projet (`?arbre=`), qui porte ses gestes
 * et son tiroir. « Nettoyer » se fait projet par projet, par le dialogue de Travail.
 *
 * Les filtres et « Montrer » sont retenus par le navigateur, la vue aussi (`?vue=`).
 */
export function PortfolioTravailPage() {
  const t = useTranslate()
  const lang = useLocale()
  const { projects, live } = usePortfolioLive()
  const byId = useMemo(() => new Map(projects.map((project) => [project.id, project])), [projects])
  const code = usePortfolioCode(projects, live)
  const inbox = useInbox({ portfolio: true })
  const { data: journal } = useJournal(undefined)

  const views: ViewOption<View>[] = VIEW_KEYS.map((key) => ({ key, label: t(`portfolio.work.view.${key}`), icon: VIEW_ICONS[key] }))
  const [view, setView] = useView<View>('portfolio-travail', null, VIEW_KEYS)
  const [filters, setFilters] = useStoredPref(viewStorageKey('portfolio-travail.filtres', null), readWorkFilters)
  const [showMerged, setShowMerged] = useStoredPref(viewStorageKey('portfolio-travail.fusionnes', null), readShowMerged)
  const [query, setQuery] = useState('')

  const set = (patch: Partial<WorkFilters>) => setFilters({ ...filters, ...patch })
  // Un projet coché puis archivé reste dans la mémoire du navigateur : il ne filtre plus
  // rien, sinon la page se viderait sans puce ni « Effacer » pour en sortir.
  const kept = useMemo(() => ({ ...filters, projects: filters.projects.filter((id) => byId.has(id)) }), [filters, byId])
  const selected = useMemo(() => new Set(kept.projects), [kept.projects])
  // « Effacer tous les filtres » : la barre vide les projets puis appelle ceci ; les deux
  // écritures partent du même état, la dernière doit donc tout vider.
  const clearAll = () => setFilters({ projects: [], states: [] })
  // « À nettoyer » réclame les fusionnés : « Montrer » se lit coché tant qu'il est posé.
  const forced = filters.states.includes('clean')
  const toggleState = (state: WorkState) =>
    set({ states: filters.states.includes(state) ? filters.states.filter((entry) => entry !== state) : [...filters.states, state] })

  const layout = useMemo(
    () => workLayout({ projects: code.groups, filters: kept, query, showMerged, reasonOf: (tree) => verdictReason(t, tree.reason) }),
    [code.groups, kept, query, showMerged, t],
  )
  const events = useMemo(
    () => workEvents(journal?.entries ?? [], { projects: byId, selected: kept.projects, query }),
    [journal, byId, kept.projects, query],
  )
  const days = useJournalDays(events, 'all')
  const asking = inboxInProjects(inbox, kept.projects)

  const meta = [
    t(`travail.summary.trees.${pluralOf(layout.summary.count)}`, { count: layout.summary.count }),
    layout.summary.bytes !== null ? formatBytes(layout.summary.bytes, lang) : null,
  ]
    .filter(Boolean)
    .join(' · ')

  const nothing = layout.groups.length === 0

  return (
    <PortfolioCleanHost>
      <div className="flex h-full min-h-0 flex-col">
        <PortfolioToolbar<View>
          search={query}
          onSearch={setQuery}
          placeholder={t('portfolio.work.search')}
          projects={projects}
          selected={selected}
          onSelected={(next) => set({ projects: [...next] })}
          counts={layout.counts}
          filterExtra={
            <>
              <MenuHeading>{t('travail.section.state')}</MenuHeading>
              {WORK_STATES.map((state) => (
                <MenuCheck key={state} checked={filters.states.includes(state)} onChange={() => toggleState(state)}>
                  {t(STATE_LABEL[state])}
                </MenuCheck>
              ))}
            </>
          }
          extraActive={filters.states.length}
          onClearExtra={clearAll}
          extraChips={filters.states.map((state) => (
            <FilterChip key={state} onClear={() => toggleState(state)}>
              {t(STATE_LABEL[state])}
            </FilterChip>
          ))}
          views={views}
          view={view}
          onView={setView}
          displayExtra={
            view === 'moment' ? null : (
              <>
                <MenuHeading>{t('toolbar.show')}</MenuHeading>
                <MenuCheck checked={showMerged || forced} onChange={(next) => (forced ? undefined : setShowMerged(next))}>
                  {t('portfolio.work.showMerged')}
                </MenuCheck>
              </>
            )
          }
          meta={code.pending ? null : meta}
          action={layout.cleanCount > 0 ? <PortfolioCleanButton offers={layout.offers} /> : null}
        />
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="flex flex-col gap-6 px-4 pt-4 pb-28 md:px-6">
            {asking.length > 0 ? <AskInbox items={asking} /> : null}
            {view === 'moment' ? (
              journal ? <WorkMoments days={days} projects={byId} /> : null
            ) : code.pending ? null : nothing ? (
              <p className="text-sm text-ink-faint">{t('portfolio.work.empty')}</p>
            ) : view === 'tableau' ? (
              <section aria-label={t('portfolio.work.view.tableau')} className="flex flex-col">
                <WorkTreeList trees={layout.trees} mode="table" />
                <WorkFolded trees={layout.folded} offers={layout.offers} />
              </section>
            ) : (
              layout.groups.map((group) => (
                <section key={group.project.id} aria-label={group.project.name} data-work-group={group.project.id} className="flex flex-col gap-1">
                  <ProjectGroupHeader
                    project={group.project}
                    count={group.count}
                    aside={
                      group.branches > 0 ? (
                        <span className="text-xs text-ink-faint">
                          {t(`portfolio.work.branchesWithoutTree.${pluralOf(group.branches)}`, { count: group.branches })}
                        </span>
                      ) : null
                    }
                  />
                  <WorkTreeList trees={group.trees} mode="group" />
                  <WorkFolded trees={group.folded} offers={layout.offers} />
                </section>
              ))
            )}
          </div>
        </div>
      </div>
    </PortfolioCleanHost>
  )
}
