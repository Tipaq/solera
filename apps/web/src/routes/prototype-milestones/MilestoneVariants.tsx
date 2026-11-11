/* PROTOTYPE — jetable (branche proto/page-projet). Ne pas fusionner dans main. */
import { ArrowLeft, Flag, TriangleAlert } from 'lucide-react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import type { CardDto } from '@solera/protocol'
import { Badge, EmptyState, cx } from '@solera/ui'
import { AgentIcon } from '../../components/AgentIcon'
import { formatDay, relativeDate } from '../../lib/dates'
import { DemoNotice } from './gantt'
import { DependencyGraph, type GraphLayout } from './graph'
import { STATE_DOT, STATE_LABEL, isLate, liveSessions, stateOf, useProtoData, useProtoHref, type CardState } from './model'

const ORDER: CardState[] = ['done', 'review', 'running', 'blocked', 'todo']
const FILL: Record<CardState, string> = {
  done: 'bg-positive',
  review: 'bg-positive/45',
  running: 'bg-accent',
  blocked: 'bg-caution',
  todo: 'bg-ink-faint/30',
  abandoned: 'bg-transparent',
}

/**
 * La vue d'un jalon en graphe, lancé ou non : l'en-tête dit où il en est, le graphe dit
 * qui attend qui. `couches` range de gauche à droite dans l'ordre où le travail peut
 * partir ; `etats` range par colonne d'état.
 */
function MilestoneGraphPage({ layout }: { layout: GraphLayout }) {
  const { projectId, number } = useParams()
  const href = useProtoHref()
  const data = useProtoData(projectId)
  const [, setParams] = useSearchParams()

  if (data.isPending) return null
  const milestone = data.milestones.find((entry) => String(entry.card.number) === number)
  if (!projectId || !milestone) {
    return <EmptyState icon={<Flag size={22} />} title={`#${number} n’est pas un jalon`} description={data.demo ? '' : 'Avec ?demo=1, essaie /timeline/901.'} />
  }

  const cards = milestone.cards.filter((card) => card.column !== 'abandoned')
  const counts = ORDER.map((state) => ({ state, count: cards.filter((card) => stateOf(card) === state).length }))
  const live = cards.flatMap((card) => liveSessions(card).map((session) => ({ card, session })))
  const late = cards.filter((card) => isLate(card))
  const launched = data.launched.has(milestone.card.id)
  const due = milestone.card.dueAt

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 flex-col gap-3 border-b border-line px-4 pt-3 pb-4">
        <div className="flex items-center gap-3">
          <Link to={href(`/p/${projectId}/timeline`)} className="inline-flex items-center gap-1 rounded text-xs text-ink-faint hover:text-ink">
            <ArrowLeft size={13} /> Jalons
          </Link>
          <span className="ml-auto flex items-center gap-2">
            <DemoNotice demo={data.demo} />
            <button
              type="button"
              onClick={() => setParams((current) => {
                if (data.demo) current.delete('demo')
                else current.set('demo', '1')
                return current
              })}
              className="rounded-lg border border-dashed border-fuchsia-500/60 px-2 py-1 text-xs text-fuchsia-600 hover:bg-fuchsia-500/10 dark:text-fuchsia-300"
            >
              {data.demo ? 'Vraies cartes' : 'Données de démo'}
            </button>
          </span>
        </div>

        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
          <Flag size={18} className={cx('shrink-0', launched ? 'text-accent' : 'text-ink-faint')} />
          <h2 className="min-w-0 truncate text-lg font-semibold">
            <span className="text-ink-faint tabular-nums">#{milestone.card.number}</span> {milestone.card.title}
          </h2>
          {launched ? <Badge tone="accent">lancé</Badge> : <Badge>pas lancé</Badge>}
          <span className={cx('text-sm', due !== null && due < Date.now() && milestone.done < cards.length ? 'text-critical' : 'text-ink-soft')}>
            {due === null ? 'sans échéance' : `échéance ${formatDay(due)} · ${relativeDate(due)}`}
          </span>
        </div>

        {/* barre composée + compte par état */}
        <div className="flex flex-col gap-2">
          <div className="flex h-2.5 w-full max-w-2xl overflow-hidden rounded-full bg-surface-high">
            {counts.map((entry) => (
              <span key={entry.state} className={FILL[entry.state]} style={{ width: `${(entry.count / Math.max(cards.length, 1)) * 100}%` }} />
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-soft">
            {counts.filter((entry) => entry.count > 0).map((entry) => (
              <span key={entry.state} className="flex items-center gap-1.5">
                <span className={cx('size-2 rounded-full', STATE_DOT[entry.state])} />
                {STATE_LABEL[entry.state]} <span className="tabular-nums text-ink-faint">{entry.count}</span>
              </span>
            ))}
            {late.length > 0 ? (
              <span className="flex items-center gap-1 text-critical">
                <TriangleAlert size={12} /> {late.length} en retard
              </span>
            ) : null}
          </div>
        </div>

        {live.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-ink-faint">Au travail :</span>
            {live.map(({ card, session }) => (
              <Link
                key={session.id}
                to={href(`/p/${projectId}/c/${session.id}`)}
                className={cx(
                  'flex items-center gap-1.5 rounded-full border px-2 py-0.5 hover:border-accent',
                  session.status === 'awaiting_input' ? 'border-caution/60 text-caution' : 'border-accent/50 text-accent',
                )}
              >
                <AgentIcon agent={session.agent} size={12} />
                <span className="tabular-nums">#{card.number}</span>
                {session.status === 'awaiting_input' ? 't’attend' : 'tourne'}
              </Link>
            ))}
          </div>
        ) : null}
      </header>

      <div className="min-h-0 flex-1 overflow-auto p-6">
        {cards.length === 0 ? (
          <p className="text-sm text-ink-faint">Ce jalon n’a pas encore de carte.</p>
        ) : (
          <DependencyGraph projectId={projectId} cards={cards} layout={layout} hrefOf={href} />
        )}
      </div>

      <Footer cards={cards} />
    </div>
  )
}

/** Le pied : la prochaine carte qui peut partir, et ce qu'elle débloquerait. */
function Footer({ cards }: { cards: CardDto[] }) {
  const ready = cards.filter((card) => stateOf(card) === 'todo')
  const head = [...ready].sort((a, b) => b.blocks.length - a.blocks.length)[0]
  return (
    <p className="shrink-0 border-t border-line px-4 py-2.5 text-sm text-ink-soft">
      {head
        ? `Prête à partir : #${head.number} ${head.title}${head.blocks.length > 0 ? ` — débloquerait ${head.blocks.map((link) => `#${link.number}`).join(', ')}` : ''}`
        : 'Rien de prêt à partir : tout est en cours, bloqué ou fait.'}
    </p>
  )
}

/** A — graphe en couches, gauche → droite. */
export function MilestoneLayers() {
  return <MilestoneGraphPage layout="couches" />
}

/** B — colonnes par état, arêtes « bloque » entre elles. */
export function MilestoneByState() {
  return <MilestoneGraphPage layout="etats" />
}
