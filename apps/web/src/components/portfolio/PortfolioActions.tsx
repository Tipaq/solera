import { ArrowUpRight, Server, SquareTerminal } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { ProjectDto } from '@solera/protocol'
import { cx } from '@solera/ui'
import { isService, liveText, type Automation } from '../../lib/automations'
import { useTranslate, type MessageKey } from '../../lib/i18n'
import { listStateOf, type ListState, type RunningEntry } from '../../lib/portfolio-actions'
import { humanLabel } from '../../lib/session-works'
import { AgentIcon } from '../AgentIcon'
import { ProjectPip } from '../places/ProjectPip'
import { SectionTitle } from '../places/SectionTitle'

type PipProject = Pick<ProjectDto, 'id' | 'name' | 'image' | 'color'>

/** L'icône de nature d'une action : son CLI pour un agent, un serveur ou un terminal pour une commande. */
function NatureIcon({ item }: { item: Automation }) {
  if (item.what === 'agent' && item.agent) return <AgentIcon agent={item.agent} size={13} decorative />
  const Icon = isService(item) ? Server : SquareTerminal
  return <Icon size={13} aria-hidden className="shrink-0 text-ink-faint" />
}

/**
 * Tourne maintenant, tous projets (PF-33) : une pastille par chose vivante — une action en
 * marche, ce qu'une session a laissé tourner —, avec son projet. Un clic mène à l'onglet
 * Actions du projet ; la page Services, à droite, montre toute la machine. Rien quand rien
 * ne tourne.
 */
export function PortfolioRunningNow({
  entries,
  projectOf,
  onOpen,
}: {
  entries: readonly RunningEntry[]
  projectOf: (projectId: string) => PipProject | undefined
  onOpen: (entry: RunningEntry) => void
}) {
  const t = useTranslate()
  if (entries.length === 0) return null
  const now = Date.now()
  return (
    <section data-portfolio-running className="flex flex-col gap-2 border-b border-line px-4 py-4 md:px-6">
      <SectionTitle
        count={entries.length}
        aside={
          <Link to="/services" className="inline-flex items-center gap-1 text-xs text-ink-faint hover:text-ink hover:underline">
            {t('portfolio.actions.servicesPage')} <ArrowUpRight size={12} aria-hidden />
          </Link>
        }
      >
        {t('portfolio.actions.running')}
      </SectionTitle>
      <ul className="flex flex-wrap gap-2">
        {entries.map((entry) => {
          const project = projectOf(entry.projectId)
          const label = entry.kind === 'action' ? entry.item.label : humanLabel(entry.work, t)
          const text =
            entry.kind === 'action'
              ? liveText(entry.item, now, t)
              : entry.work.port !== null
                ? t('portfolio.actions.work.byPort', { port: entry.work.port })
                : null
          return (
            <li key={entry.key} className="max-w-full min-w-0">
              <button
                type="button"
                onClick={() => onOpen(entry)}
                title={entry.kind === 'work' ? t('portfolio.actions.work.from', { title: entry.work.conversationTitle }) : undefined}
                className="inline-flex max-w-full min-w-0 items-center gap-2 rounded-lg border border-line px-3 py-2 text-left text-sm transition-colors hover:border-line-strong focus-visible:outline-2 focus-visible:outline-accent"
              >
                <span aria-hidden className="size-2 shrink-0 rounded-full bg-positive motion-safe:animate-pulse" />
                {entry.kind === 'action' ? <NatureIcon item={entry.item} /> : <SquareTerminal size={13} aria-hidden className="shrink-0 text-ink-faint" />}
                <span className="min-w-0 truncate font-medium">{label}</span>
                {text ? <span className="min-w-0 shrink-[2] truncate text-xs text-ink-faint">{text}</span> : null}
                {project ? <ProjectPip project={project} plain className="shrink-0" /> : null}
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

const STATE_WORD: Record<Exclude<ListState, 'live'>, MessageKey> = {
  review: 'portfolio.actions.state.review',
  scheduled: 'portfolio.actions.state.scheduled',
  paused: 'portfolio.actions.state.paused',
  demand: 'portfolio.actions.state.demand',
}

/**
 * La Liste du portefeuille (PF-35) : une ligne par action — son projet, son libellé et
 * sa commande (`$ …`) ou son prompt, sa nature, son état : à relire en ambre, ce qui
 * tourne en vert. Au téléphone, le projet passe au-dessus et la nature se tait.
 */
export function PortfolioActionsList({
  items,
  projectOf,
  onOpen,
}: {
  items: readonly Automation[]
  projectOf: (projectId: string) => PipProject | undefined
  onOpen: (item: Automation) => void
}) {
  const t = useTranslate()
  const now = Date.now()
  return (
    <ul data-portfolio-actions-list className="divide-y divide-line">
      {items.map((item) => {
        const project = item.projectId ? projectOf(item.projectId) : undefined
        const state = listStateOf(item)
        const kind = item.what === 'agent' ? 'agent' : isService(item) ? 'service' : 'command'
        return (
          <li key={item.id}>
            <button
              type="button"
              data-portfolio-action={item.id}
              onClick={() => onOpen(item)}
              className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-0.5 px-4 py-2.5 text-left transition-colors hover:bg-surface-high/40 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent md:grid-cols-[9rem_minmax(0,1fr)_8rem_12rem] md:px-6"
            >
              <span className="col-span-2 flex min-w-0 md:col-span-1">{project ? <ProjectPip project={project} plain /> : null}</span>
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-sm font-medium text-ink">{item.label}</span>
                <span className={cx('truncate text-xs text-ink-faint', item.what === 'command' && 'font-mono')}>
                  {item.what === 'command' ? `$ ${item.command ?? ''}` : item.prompt}
                </span>
              </span>
              <span className="hidden text-xs text-ink-soft md:block">{t(`portfolio.actions.kind.${kind}`)}</span>
              <span
                className={cx(
                  'max-w-36 truncate text-right text-xs md:max-w-none',
                  state === 'review' ? 'text-caution' : state === 'live' ? 'text-positive' : 'text-ink-faint',
                )}
              >
                {state === 'live' ? liveText(item, now, t) : t(STATE_WORD[state])}
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}
