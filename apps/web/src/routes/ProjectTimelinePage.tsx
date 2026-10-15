import { Flag, Inbox } from 'lucide-react'
import { useMemo } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { EmptyState, cx } from '@solera/ui'
import { Timeline, type TimelineRow } from '../components/project/Timeline'
import { useCards } from '../lib/cards'
import { formatDay, relativeDate } from '../lib/dates'
import { useTranslate } from '../lib/i18n'
import { cardSpan, milestoneIdsOf, milestonesOf, unplacedOf, windowOf } from '../lib/timeline'

/**
 * La **Chronologie** d'un projet : ses jalons en lignes, ses cartes en barres.
 *
 * Elle ne lit rien de neuf — les jalons se déduisent de la liste des cartes, un jalon
 * *étant* une carte (décision de la carte #32). Aucune requête de plus que le board.
 *
 * Trois choses que la maquette F4 fixe et qu'il ne faut pas défaire :
 *
 * - une barre **en pointillé** est une carte sans échéance : elle court jusqu'à
 *   aujourd'hui et ne promet rien ;
 * - une barre **rouge** est en retard, et seulement si la carte est encore ouverte ;
 * - le **pied de vue compte ce qui n'a ni jalon ni date**, sans quoi la vue mentirait par
 *   omission : on y lirait « voilà le travail » en n'en voyant qu'une part.
 *
 * Pas d'action dans la rangée, à la différence de la maquette qui montrait *+ Jalon*.
 * Elle a été dessinée avant que la carte #32 ne décide qu'**un jalon est une carte sans
 * drapeau** : une carte n'est un jalon que parce qu'une autre la désigne, donc un bouton
 * qui en créerait une n'aurait rien produit de visible ici. La désignation se fait depuis
 * le panneau d'une carte, qui est le seul endroit où elle existe.
 */
export function ProjectTimelinePage() {
  const { projectId } = useParams()
  const navigate = useNavigate()
  const t = useTranslate()
  const { data: cards, isPending } = useCards(projectId)

  const milestones = useMemo(() => milestonesOf(cards ?? []), [cards])
  const milestoneIds = useMemo(() => milestoneIdsOf(cards ?? []), [cards])
  const unplaced = useMemo(() => unplacedOf(cards ?? []), [cards])

  /* Les cartes datées mais sans jalon ont leur propre ligne : elles sont placées sur
     l'axe, donc les taire les ferait disparaître alors qu'on sait où les mettre. */
  const loose = useMemo(
    () =>
      (cards ?? []).filter(
        (card) =>
          card.milestone === null &&
          card.dueAt !== null &&
          card.column !== 'abandoned' &&
          // Une carte-jalon a sa propre ligne : la remettre en barre la dirait deux fois.
          !milestoneIds.has(card.id),
      ),
    [cards, milestoneIds],
  )

  const bounds = useMemo(() => {
    const dates = [
      ...milestones.flatMap((milestone) => [
        milestone.card.createdAt,
        ...(milestone.card.dueAt === null ? [] : [milestone.card.dueAt]),
      ]),
      ...(cards ?? []).flatMap((card) => (card.dueAt === null ? [] : [card.dueAt])),
    ]
    return windowOf(dates)
  }, [milestones, cards])

  if (isPending) return null

  if (milestones.length === 0 && loose.length === 0) {
    return (
      <div className="h-full overflow-y-auto p-4 md:p-6">
        <EmptyState
          icon={<Flag size={22} />}
          title={t('timeline.empty')}
          description={t('timeline.emptyHint')}
        />
      </div>
    )
  }

  const open = (number: number) => navigate(`/p/${projectId}/board?carte=${number}`)

  const rows: TimelineRow[] = milestones.map((milestone) => ({
    key: milestone.card.id,
    head: (
      <button
        type="button"
        onClick={() => open(milestone.card.number)}
        className="flex min-w-0 flex-col items-start gap-0.5 rounded px-1 text-left hover:text-accent focus-visible:outline-2 focus-visible:outline-accent"
      >
        <span className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
          <Flag size={13} className="shrink-0 text-ink-faint" />
          <span className="min-w-0 truncate">{milestone.card.title}</span>
        </span>
        <span className="pl-5 text-xs text-ink-faint">
          {milestone.card.dueAt === null
            ? t('timeline.noDate')
            : milestone.done === milestone.cards.length
              ? t('timeline.delivered', { day: formatDay(milestone.card.dueAt) })
              : relativeDate(milestone.card.dueAt)}
          {milestone.cards.length > 0
            ? ` · ${t('timeline.progress', { done: milestone.done, total: milestone.cards.length })}`
            : ''}
        </span>
      </button>
    ),
    empty: t('timeline.milestone.empty'),
    bars: milestone.cards
      .filter((card) => card.column !== 'abandoned')
      .map((card) => {
        const span = cardSpan(card)
        return {
          key: card.id,
          start: span.start,
          end: span.end,
          loose: span.loose,
          tone: span.late ? ('late' as const) : card.column === 'done' ? ('done' as const) : ('neutral' as const),
          label: card.title,
          prefix: <span className="shrink-0 text-meta tabular-nums opacity-70">#{card.number}</span>,
          title: `#${card.number} ${card.title}`,
          onOpen: () => open(card.number),
        }
      }),
  }))

  if (loose.length > 0) {
    rows.push({
      key: 'sans-jalon',
      head: (
        <span className="flex min-w-0 flex-col gap-0.5 px-1">
          <span className="truncate text-sm font-medium text-ink-soft">{t('timeline.noMilestone')}</span>
          <span className="text-xs text-ink-faint">{t('timeline.noMilestone.hint')}</span>
        </span>
      ),
      bars: loose.map((card) => {
        const span = cardSpan(card)
        return {
          key: card.id,
          start: span.start,
          end: span.end,
          loose: span.loose,
          tone: span.late ? ('late' as const) : card.column === 'done' ? ('done' as const) : ('neutral' as const),
          label: card.title,
          prefix: <span className="shrink-0 text-meta tabular-nums opacity-70">#{card.number}</span>,
          title: `#${card.number} ${card.title}`,
          onOpen: () => open(card.number),
        }
      }),
    })
  }

  return (
    <div className="h-full overflow-y-auto p-4 md:p-6">
      <Timeline from={bounds.from} to={bounds.to} rows={rows} />

      {/* Le pied compte ce qu'aucune ligne ne peut porter. Les numéros plutôt qu'un
          simple total : « 4 cartes » laisse chercher lesquelles. */}
      {unplaced.length > 0 ? (
        <p className={cx('mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 px-1 text-xs text-ink-faint')}>
          <Inbox size={14} className="shrink-0" />
          {t('timeline.unplaced', { count: unplaced.length })}
          <span className="flex flex-wrap gap-x-1.5">
            {unplaced.map((card) => (
              <button
                key={card.id}
                type="button"
                onClick={() => open(card.number)}
                className="tabular-nums hover:text-ink"
                title={card.title}
              >
                #{card.number}
              </button>
            ))}
          </span>
        </p>
      ) : null}
    </div>
  )
}
