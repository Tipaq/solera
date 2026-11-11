/* PROTOTYPE — jetable (branche proto/page-projet). Ne pas fusionner dans main.
 *
 * L'Aperçu du portefeuille : « où en sont mes projets ? ». Le pendant de l'Aperçu
 * `combo` d'un projet, un cran au-dessus : Ce qui t'attend (tous projets, une seule
 * liste), un phare compact par projet (son jalon en cours), le code en cours et les
 * derniers événements, chaque ligne avec sa pastille de projet.
 */
import { useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import type { ProjectDto } from '@solera/protocol'
import { cx } from '@solera/ui'
import { AgentIcon } from '../../components/AgentIcon'
import { ProjectAvatar } from '../../components/ProjectAvatar'
import { AskInbox } from '../../components/prototype/AskInbox'
import { JOURNAL_KIND_ICONS, journalDestination, journalIconTone } from '../../components/journal/JournalView'
import { elapsed, relativeDate } from '../../lib/dates'
import { milestonesOf } from '../../lib/timeline'
import { VERDICT_TONE } from '../prototype-code/ProjectCodePage'
import { usePortfolioV2, type PCard, type PTree } from './data'
import { ProjectPip, SectionTitle, useNotice } from './parts'

type View = 'cartes' | 'lignes'
type Sort = 'attente' | 'activite' | 'nom'

/** Ce qui vit dans un arbre : pas les fusionnés, vides ou introuvables ; la racine si elle a du non commité. */
export function isActiveTree(tree: PTree): boolean {
  if (tree.root) return tree.uncommitted > 0 || tree.sessions.length > 0
  return !['clean', 'empty', 'missing'].includes(tree.verdict)
}

interface ProjectSummary {
  project: ProjectDto
  waiting: number
  live: number
  open: number
  milestone: { card: PCard; done: number; total: number } | null
  lastAt: number | null
}

export function PortfolioOverview() {
  const data = usePortfolioV2()
  const navigate = useNavigate()
  const [notice, simulate] = useNotice()
  const view: View = 'cartes'
  const sort = 'attente' as Sort
  const keep = (_project: ProjectDto) => true

  const summaries = useMemo<ProjectSummary[]>(() => {
    return data.projects.map((project) => {
      const cards = data.cards.filter((card) => card.project.id === project.id)
      const current = milestonesOf(cards).find((entry) => entry.done < entry.cards.length) ?? null
      const trees = data.trees.filter((tree) => tree.project.id === project.id)
      const events = data.events.filter((event) => event.project.id === project.id)
      return {
        project,
        waiting: data.inbox.filter((item) => item.project.id === project.id && item.kind === 'session').length,
        live: trees.reduce((sum, tree) => sum + tree.sessions.length, 0),
        open: cards.filter((card) => card.children.length === 0 && !['done', 'abandoned'].includes(card.column)).length,
        milestone: current ? { card: current.card as PCard, done: current.done, total: current.cards.length } : null,
        lastAt: events[0]?.at ?? null,
      }
    })
  }, [data])

  const shown = summaries
    .filter((entry) => keep(entry.project))
    .sort((a, b) =>
      sort === 'nom'
        ? a.project.name.localeCompare(b.project.name)
        : sort === 'activite'
          ? (b.lastAt ?? 0) - (a.lastAt ?? 0)
          : b.waiting - a.waiting || b.live - a.live || (b.lastAt ?? 0) - (a.lastAt ?? 0),
    )
  const inbox = data.inbox.filter((item) => keep(item.project))
  const trees = data.trees.filter((tree) => keep(tree.project) && isActiveTree(tree))
  const events = data.events.filter((event) => keep(event.project)).slice(0, 8)

  const openTree = (tree: PTree) => {
    if (data.demo) return simulate(`ouvrirait l'arbre ${tree.branch} dans Travail de ${tree.project.name}`)
    navigate(`/p/${tree.project.id}/travail?arbre=${encodeURIComponent(tree.key)}`)
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* PROTOTYPE : pas de barre recherche / Filtrer / Affichage sur l'Aperçu du
          portefeuille (Tim, 2026-11-11) : c'est une page qu'on lit, pas une liste qu'on trie. */}
      {notice}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex flex-col gap-8 p-4 md:p-6">
          <AskInbox items={inbox} />

          <section className="flex flex-col gap-3">
            <SectionTitle count={shown.length}>Projets</SectionTitle>
            {view === 'cartes' ? (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                {shown.map((entry) => (
                  <ProjectCard key={entry.project.id} entry={entry} onSimulate={simulate} demo={data.demo} />
                ))}
              </div>
            ) : (
              <ul className="divide-y divide-line rounded-xl border border-line">
                {shown.map((entry) => (
                  <ProjectLine key={entry.project.id} entry={entry} onSimulate={simulate} demo={data.demo} />
                ))}
              </ul>
            )}
          </section>

          <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
            <section className="flex min-w-0 flex-col gap-2">
              <SectionTitle count={trees.length} aside={<Link to="/projects/travail" className="text-xs text-ink-faint hover:text-ink hover:underline">Tout le travail</Link>}>
                Code en cours
              </SectionTitle>
              {trees.length === 0 ? (
                <p className="text-sm text-ink-faint">Rien ne tourne.</p>
              ) : (
                <ul className="flex flex-col">
                  {trees.slice(0, 12).map((tree) => (
                    <li key={`${tree.project.id}:${tree.key}`}>
                      <button
                        type="button"
                        onClick={() => openTree(tree)}
                        className="grid w-full grid-cols-[0.5rem_9rem_minmax(0,1fr)_auto] items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-surface-high/60"
                      >
                        <span aria-hidden className={cx('size-2 rounded-full', VERDICT_TONE[tree.verdict].dot)} />
                        <ProjectPip project={tree.project} plain />
                        <span className="flex min-w-0 flex-col">
                          <span className="truncate font-mono text-xs text-ink">{tree.branch ?? tree.name}</span>
                          <span className="truncate text-xs text-ink-faint">
                            {tree.reason}
                            {tree.card ? ` · #${tree.card.number} ${tree.card.title}` : ''}
                          </span>
                        </span>
                        <span className="flex items-center gap-2 text-xs text-ink-faint">
                          {tree.sessions.map((session) => <AgentIcon key={session.id} agent={session.agent} size={13} />)}
                          {tree.pr ? <span className="tabular-nums">#{tree.pr.number}</span> : null}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="flex min-w-0 flex-col gap-2">
              <SectionTitle>Derniers événements</SectionTitle>
              <ul className="flex flex-col">
                {events.map((event) => {
                  const to = data.demo ? null : journalDestination(event)
                  const body = (
                    <>
                      <span aria-hidden className={cx('shrink-0', journalIconTone(event))}>{JOURNAL_KIND_ICONS[event.kind]}</span>
                      <span className="min-w-0 flex-1 truncate text-sm">{event.title}</span>
                      <ProjectAvatar project={event.project} className="size-3.5 shrink-0" />
                      <span className="w-10 shrink-0 text-right text-xs tabular-nums text-ink-faint">{elapsed(event.at)}</span>
                    </>
                  )
                  const shape = 'flex min-h-9 items-center gap-2 rounded-md px-2'
                  return (
                    <li key={event.id}>
                      {to ? <Link to={to} className={cx(shape, 'hover:bg-surface-high/60')}>{body}</Link> : <div className={shape}>{body}</div>}
                    </li>
                  )
                })}
              </ul>
            </section>
          </div>
        </div>
      </div>
    </div>
  )
}

function ProjectCard({ entry, onSimulate, demo }: { entry: ProjectSummary; onSimulate: (text: string) => void; demo: boolean }) {
  const navigate = useNavigate()
  const { project, milestone } = entry
  const share = milestone && milestone.total > 0 ? milestone.done / milestone.total : 0
  return (
    <button
      type="button"
      onClick={() => (demo ? onSimulate(`ouvrirait le projet ${project.name}`) : navigate(`/p/${project.id}`))}
      className={cx(
        'flex flex-col gap-3 rounded-xl border bg-surface/40 p-4 text-left transition-colors hover:border-line-strong',
        entry.waiting > 0 ? 'border-caution/50' : 'border-line',
      )}
    >
      <span className="flex items-center gap-2">
        <ProjectAvatar project={project} className="size-5 shrink-0" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{project.name}</span>
        {entry.waiting > 0 ? (
          <span className="inline-flex items-center gap-1 text-xs text-caution">
            <span aria-hidden className="size-1.5 rounded-full bg-caution" /> {entry.waiting} t'attend
          </span>
        ) : null}
      </span>
      {milestone ? (
        <span className="flex flex-col gap-1.5">
          <span className="flex items-baseline gap-2 text-xs text-ink-faint">
            <span className="tabular-nums">#{milestone.card.number}</span>
            <span className="min-w-0 flex-1 truncate text-sm text-ink-soft">{milestone.card.title}</span>
          </span>
          <span className="h-1.5 overflow-hidden rounded-full bg-surface-high">
            <span className="block h-full rounded-full bg-accent" style={{ width: `${Math.round(share * 100)}%` }} />
          </span>
          <span className="flex items-center gap-2 text-xs text-ink-faint tabular-nums">
            {milestone.done}/{milestone.total}
            {milestone.card.dueAt ? <span>· {relativeDate(milestone.card.dueAt)}</span> : null}
          </span>
        </span>
      ) : (
        <span className="text-xs text-ink-faint">Aucun jalon en cours.</span>
      )}
      <span className="mt-auto flex items-center gap-3 text-xs text-ink-faint tabular-nums">
        <span>{entry.open} cartes ouvertes</span>
        {entry.live > 0 ? <span className="inline-flex items-center gap-1"><span aria-hidden className="size-1.5 animate-pulse rounded-full bg-accent" /> {entry.live} session{entry.live > 1 ? 's' : ''}</span> : null}
        {entry.lastAt ? <span className="ml-auto">{elapsed(entry.lastAt)}</span> : null}
      </span>
    </button>
  )
}

function ProjectLine({ entry, onSimulate, demo }: { entry: ProjectSummary; onSimulate: (text: string) => void; demo: boolean }) {
  const navigate = useNavigate()
  const { project, milestone } = entry
  return (
    <li>
      <button
        type="button"
        onClick={() => (demo ? onSimulate(`ouvrirait le projet ${project.name}`) : navigate(`/p/${project.id}`))}
        className="grid w-full grid-cols-[minmax(0,14rem)_minmax(0,1fr)_7rem_7rem_4rem] items-center gap-4 px-4 py-2.5 text-left hover:bg-surface-high/40"
      >
        <span className="flex min-w-0 items-center gap-2">
          <ProjectAvatar project={project} className="size-4 shrink-0" />
          <span className="truncate text-sm font-medium">{project.name}</span>
        </span>
        <span className="min-w-0 truncate text-xs text-ink-faint">
          {milestone ? `#${milestone.card.number} ${milestone.card.title} · ${milestone.done}/${milestone.total}` : 'Aucun jalon en cours'}
        </span>
        <span className={cx('text-xs', entry.waiting > 0 ? 'text-caution' : 'text-ink-faint')}>{entry.waiting > 0 ? `${entry.waiting} t'attend` : '—'}</span>
        <span className="text-xs text-ink-faint tabular-nums">{entry.open} ouvertes</span>
        <span className="text-right text-xs text-ink-faint tabular-nums">{entry.lastAt ? elapsed(entry.lastAt) : ''}</span>
      </button>
    </li>
  )
}
