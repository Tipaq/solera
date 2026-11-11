/* PROTOTYPE — jetable (branche proto/page-projet). Ne pas fusionner dans main. */
import { CheckCheck, Hand, Hourglass, Play, Sparkles } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { cx } from '@solera/ui'
import { DAY, useProtoHref } from '../prototype-milestones/model'
import { cardDestination } from '../prototype-milestones/destination'
import { inMilestone, matches, useBoardData, useOpenFiche, type BoardCard, type ExternalControls, type MilestoneFilter } from './data'
import { Tile, Toolbar, type SharedView } from './parts'

/**
 * **Par geste** : les mêmes cartes, rangées non plus par colonne mais par **ce qu'elles
 * attendent de quelqu'un**. La colonne est un état du travail ; ici on lit la file des
 * gestes : ce qui t'attend, ce que les agents font, ce qui peut partir, ce qui attend
 * une autre carte, ce qui vient d'aboutir. Pas de glisser-déposer : le geste est le
 * bouton de la section.
 */
export function GestureVariant({ shared, external }: { shared?: SharedView; external?: ExternalControls } = {}) {
  const { projectId } = useParams()
  const data = useBoardData(projectId)
  const open = useOpenFiche()
  const href = useProtoHref()
  const [ownQuery, setOwnQuery] = useState('')
  const [ownFilter, setOwnFilter] = useState<MilestoneFilter>(null)
  const query = shared?.query ?? ownQuery
  const setQuery = shared?.setQuery ?? setOwnQuery
  const filter = shared ? shared.filter : ownFilter
  const setFilter = shared?.setFilter ?? setOwnFilter

  const visible = data.cards.filter((entry) => (external ? external.predicate(entry) : matches(entry, query) && inMilestone(entry, filter)))
  const closed = (entry: BoardCard) => entry.column === 'done' || entry.column === 'abandoned'
  const blockedBy = (entry: BoardCard) => entry.card.blockedBy.filter((blocker) => blocker.column !== 'done' && blocker.column !== 'abandoned')

  const forYou = visible.filter(
    (entry) => !closed(entry) && (entry.waiting || entry.column === 'review' || entry.card.acceptedAt === null || entry.card.toClarifySince !== null),
  )
  const taken = new Set(forYou.map((entry) => entry.card.id))
  const agents = visible.filter((entry) => !taken.has(entry.card.id) && entry.column === 'in_progress')
  const waiting = visible.filter((entry) => !taken.has(entry.card.id) && entry.column === 'todo' && blockedBy(entry).length > 0)
  const ready = visible.filter((entry) => !taken.has(entry.card.id) && entry.column === 'todo' && blockedBy(entry).length === 0)
  const recent = visible
    .filter((entry) => entry.column === 'done' && Date.now() - entry.card.columnSince < 7 * DAY)
    .sort((a, b) => b.card.columnSince - a.card.columnSince)

  const launch = (entry: BoardCard) => (
    <Link
      to={href(cardDestination(projectId ?? '', entry.card))}
      onClick={(event) => event.stopPropagation()}
      className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-accent hover:bg-accent-wash/50"
    >
      <Play size={11} /> Lancer
    </Link>
  )

  return (
    <div className="flex h-full min-h-0 flex-col">
      {external ? null : <Toolbar data={data} query={query} onQuery={setQuery} filter={filter} onFilter={setFilter} view={shared?.view} />}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 md:px-6">
        <div className="flex flex-col gap-7">
          <Section icon={<Hand size={14} />} tone="text-caution" title="À toi" hint="une réponse, une relecture, une carte à accepter ou à préciser" entries={forYou} onOpen={open} />
          <Section icon={<Sparkles size={14} />} tone="text-accent" title="Les agents travaillent" hint="en cours, rien à faire pour l'instant" entries={agents} onOpen={open} />
          <Section
            icon={<Play size={14} />}
            tone="text-ink"
            title="Prêtes à partir"
            hint="à faire, rien ne les bloque"
            entries={ready}
            onOpen={open}
            aside={launch}
          />
          <Section
            icon={<Hourglass size={14} />}
            tone="text-ink-soft"
            title="Attendent une autre carte"
            hint="elles partiront quand leurs bloqueuses seront finies"
            entries={waiting}
            onOpen={open}
            aside={(entry) => (
              <span className="text-xs text-ink-faint">
                après {blockedBy(entry).map((blocker) => `#${blocker.number}`).join(', ')}
              </span>
            )}
          />
          <Section icon={<CheckCheck size={14} />} tone="text-positive" title="Fait cette semaine" hint="" entries={recent} onOpen={open} folded />
        </div>
      </div>
    </div>
  )
}

function Section({
  icon,
  tone,
  title,
  hint,
  entries,
  onOpen,
  aside,
  folded = false,
}: {
  icon: ReactNode
  tone: string
  title: string
  hint: string
  entries: BoardCard[]
  onOpen: (number: number) => void
  aside?: (entry: BoardCard) => ReactNode
  folded?: boolean
}) {
  const [open, setOpen] = useState(!folded)
  return (
    <section className="flex flex-col gap-3">
      <button type="button" onClick={() => setOpen(!open)} className="flex items-baseline gap-2 text-left">
        <span className={cx('flex items-center gap-1.5 text-sm font-medium', tone)}>
          {icon} {title}
        </span>
        <span className="text-xs tabular-nums text-ink-faint">{entries.length}</span>
        {hint ? <span className="hidden text-xs text-ink-faint sm:inline">· {hint}</span> : null}
      </button>
      {!open ? null : entries.length === 0 ? (
        <p className="text-xs text-ink-faint">Rien ici.</p>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] gap-2">
          {entries.map((entry) => (
            <div key={entry.card.id} className="flex flex-col gap-1">
              <Tile entry={entry} draggable={false} onOpen={() => onOpen(entry.card.number)} />
              {aside ? <div className="flex justify-end px-1">{aside(entry)}</div> : null}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
