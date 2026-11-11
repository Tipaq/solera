/* PROTOTYPE — jetable (branche proto/page-projet). Ne pas fusionner dans main.
 *
 * Les Actions du portefeuille : celles de tous les projets. En tête, ce qui tourne sur
 * l'instance (services, passages en cours), avec le lien vers la page Services ; puis
 * le Lanceur groupé par projet (puis par nature, celui d'un projet), la Liste ou
 * l'agenda commun. Un clic sur une action mène à l'onglet Actions de son projet, où
 * vivent son détail et son éditeur.
 */
import { ArrowUpRight, CalendarDays, LayoutGrid, List, Plus, Server } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Button, cx } from '@solera/ui'
import { AgentIcon } from '../../components/AgentIcon'
import { FilterChip, MenuCheck, MenuHeading, useView, type ViewOption } from '../../components/prototype/ViewSwitch'
import { ActionsAgenda, type ActionsAgendaMode } from '../prototype-automations/ActionsAgenda'
import { LauncherView } from '../prototype-automations/Launcher'
import type { EditorSeed } from '../prototype-automations/Editor'
import { inProjects, usePortfolioV2, type PAutomation } from './data'
import { PortfolioToolbar, ProjectGroupHeader, ProjectPip, SectionTitle, toggled, useNotice } from './parts'

type View = 'lanceur' | 'liste' | 'agenda'
const VIEWS: ViewOption<View>[] = [
  { key: 'lanceur', label: 'Lanceur', icon: <LayoutGrid size={14} /> },
  { key: 'liste', label: 'Liste', icon: <List size={14} /> },
  { key: 'agenda', label: 'Agenda', icon: <CalendarDays size={14} /> },
]
type What = 'command' | 'agent'
type When = 'demand' | 'planned'

export function PortfolioActions() {
  const data = usePortfolioV2()
  const navigate = useNavigate()
  const [notice, simulate] = useNotice()
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set())
  const [whats, setWhats] = useState<ReadonlySet<What>>(() => new Set())
  const [whens, setWhens] = useState<ReadonlySet<When>>(() => new Set())
  const [view, setView] = useView<View>('portfolio-actions', 'all', ['lanceur', 'liste', 'agenda'])
  const [mode, setMode] = useState<ActionsAgendaMode>('semaine')

  const query = search.trim().toLocaleLowerCase()
  const shown = data.automations.filter(
    (item) =>
      inProjects(selected, item.project.id) &&
      (whats.size === 0 || whats.has(item.what)) &&
      (whens.size === 0 || (whens.has('demand') && item.onDemand) || (whens.has('planned') && item.schedule !== null)) &&
      (!query || `${item.label} ${item.command ?? ''} ${item.prompt ?? ''} ${item.project.name}`.toLocaleLowerCase().includes(query)),
  )
  const running = data.automations.filter((item) => item.live)
  const counts = useMemo(() => {
    const map = new Map<string, number>()
    for (const item of data.automations) map.set(item.project.id, (map.get(item.project.id) ?? 0) + 1)
    return map
  }, [data.automations])

  const toProject = (item: PAutomation) => {
    if (data.demo) return simulate(`ouvrirait « ${item.label} » dans les Actions de ${item.project.name}`)
    navigate(`/p/${item.project.id}/actions`)
  }
  const editIn = (projectId: string) => (seed: EditorSeed) => {
    if (data.demo) return simulate('ouvrirait l’éditeur dans les Actions du projet')
    const preset = seed.preset ? (seed.preset.what === 'agent' ? 'agent' : seed.preset.kind === 'service' ? 'service' : 'commande') : seed.schedule ? 'planifier' : '1'
    navigate(`/p/${projectId}/actions?nouvelle=${preset}`)
  }

  const chips = (
    <>
      {[...whats].map((what) => <FilterChip key={what} onClear={() => setWhats(toggled(whats, what))}>{what === 'agent' ? 'Agents' : 'Commandes'}</FilterChip>)}
      {[...whens].map((when) => <FilterChip key={when} onClear={() => setWhens(toggled(whens, when))}>{when === 'demand' ? 'À la demande' : 'Planifiées'}</FilterChip>)}
    </>
  )

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PortfolioToolbar
        search={search}
        onSearch={setSearch}
        placeholder="Chercher une action"
        projects={data.projects}
        selected={selected}
        onSelected={setSelected}
        counts={counts}
        filterExtra={
          <>
            <MenuHeading>Quoi</MenuHeading>
            <MenuCheck checked={whats.has('command')} onChange={() => setWhats(toggled(whats, 'command'))}>Commandes</MenuCheck>
            <MenuCheck checked={whats.has('agent')} onChange={() => setWhats(toggled(whats, 'agent'))}>Agents</MenuCheck>
            <MenuHeading>Quand</MenuHeading>
            <MenuCheck checked={whens.has('demand')} onChange={() => setWhens(toggled(whens, 'demand'))}>À la demande</MenuCheck>
            <MenuCheck checked={whens.has('planned')} onChange={() => setWhens(toggled(whens, 'planned'))}>Planifiées</MenuCheck>
          </>
        }
        extraActive={whats.size + whens.size}
        onClearExtra={() => { setWhats(new Set()); setWhens(new Set()) }}
        extraChips={chips}
        views={VIEWS}
        view={view}
        onView={setView}
        demo={data.demo}
        meta={`${data.automations.length} actions`}
        action={
          <Button size="sm" icon={<Plus size={15} />} onClick={() => simulate('une action appartient à un projet : « + Action » dans son onglet Actions, ou ⚡ dans sa bande.')}>
            Action
          </Button>
        }
      />
      {notice}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {running.length > 0 && view !== 'agenda' ? (
          <section className="flex flex-col gap-2 border-b border-line px-4 py-4 md:px-6">
            <SectionTitle count={running.length} aside={<Link to="/services" className="inline-flex items-center gap-1 text-xs text-ink-faint hover:text-ink hover:underline">Page Services <ArrowUpRight size={12} /></Link>}>
              Tourne maintenant, tous projets
            </SectionTitle>
            <ul className="flex flex-wrap gap-2">
              {running.map((item) => (
                <li key={`${item.project.id}:${item.id}`}>
                  <button type="button" onClick={() => toProject(item)} className="inline-flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-left text-sm hover:border-line-strong">
                    <span aria-hidden className="size-2 animate-pulse rounded-full bg-positive" />
                    {item.what === 'agent' && item.agent ? <AgentIcon agent={item.agent} size={13} /> : <Server size={13} className="text-ink-faint" />}
                    <span className="font-medium">{item.label}</span>
                    <span className="text-xs text-ink-faint">{item.live?.text}</span>
                    <ProjectPip project={item.project} plain />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {view === 'agenda' ? (
          <ActionsAgenda items={shown} mode={mode} onMode={setMode} onOpen={(item) => toProject(item as PAutomation)} />
        ) : view === 'liste' ? (
          <ul className="divide-y divide-line">
            {shown.map((item) => (
              <li key={`${item.project.id}:${item.id}`}>
                <button type="button" onClick={() => toProject(item)} className="grid w-full grid-cols-[9rem_minmax(0,1fr)_8rem_12rem] items-center gap-4 px-4 py-2.5 text-left hover:bg-surface-high/40 md:px-6">
                  <ProjectPip project={item.project} plain />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-sm font-medium">{item.label}</span>
                    <span className={cx('truncate text-xs text-ink-faint', item.what === 'command' && 'font-mono')}>{item.what === 'command' ? `$ ${item.command ?? ''}` : item.prompt}</span>
                  </span>
                  <span className="text-xs text-ink-soft">{item.what === 'agent' ? 'Agent' : item.commandKind === 'service' ? 'Service' : 'Commande'}</span>
                  <span className={cx('truncate text-right text-xs', item.review ? 'text-caution' : item.live ? 'text-positive' : 'text-ink-faint')}>
                    {item.review ? 'à relire' : item.live ? item.live.text : item.schedule ? (item.schedule.enabled ? 'planifiée' : 'en pause') : 'à la demande'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          data.projects
            .filter((project) => shown.some((item) => item.project.id === project.id))
            .map((project) => (
              <section key={project.id} className="border-b border-line pt-4 last:border-b-0">
                <div className="px-4 md:px-6">
                  <ProjectGroupHeader project={project} count={shown.filter((item) => item.project.id === project.id).length} />
                </div>
                <LauncherView
                  projectId={project.id}
                  items={shown.filter((item) => item.project.id === project.id)}
                  onOpen={(item) => toProject(item as PAutomation)}
                  onEdit={editIn(project.id)}
                  simulate={simulate}
                />
              </section>
            ))
        )}
      </div>
    </div>
  )
}
