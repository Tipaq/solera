import { useDraggable } from '@dnd-kit/core'
import { AlarmClock, CircleHelp, Inbox } from 'lucide-react'
import type { MouseEventHandler, TouchEventHandler } from 'react'
import { cx } from '@solera/ui'
import { shortTitle, type BoardCard, type BoardMilestone } from '../../lib/board-model'
import { relativeDate } from '../../lib/dates'
import { useTranslate } from '../../lib/i18n'
import { AgentIcon } from '../AgentIcon'
import { tintDot, tintLabel } from './tints'

/** L'étiquette d'un jalon : un point de sa teinte, son numéro, son titre court ; le titre entier en infobulle. */
export function MilestoneTag({ milestone, className }: { milestone: BoardMilestone; className?: string }) {
  const t = useTranslate()
  return (
    <span
      title={t('board.tile.milestone', { number: milestone.card.number, title: milestone.card.title })}
      style={tintLabel(milestone.tint)}
      className={cx('inline-flex min-w-0 items-center gap-1.5 self-start rounded px-1.5 py-px text-meta', className)}
    >
      <span aria-hidden style={tintDot(milestone.tint)} className="size-1.5 shrink-0 rounded-full" />
      <span className="shrink-0 tabular-nums opacity-80">#{milestone.card.number}</span>
      <span className="truncate">{shortTitle(milestone.card.title)}</span>
    </span>
  )
}

/** La barre fine des sous-tâches, et leur compte. */
export function SubtaskBar({ done, total }: { done: number; total: number }) {
  const t = useTranslate()
  if (total === 0) return null
  return (
    <span className="inline-flex items-center gap-1.5 text-xs tabular-nums text-ink-faint" title={t('board.card.subtasks')}>
      <span className="h-1 w-10 overflow-hidden rounded-full bg-surface-high">
        <span className="block h-full rounded-full bg-ink-soft" style={{ width: `${(done / total) * 100}%` }} />
      </span>
      {t('board.card.subtasks.count', { done, total })}
    </span>
  )
}

/** Les agents qui tournent sur la carte, trois au plus ; l'anneau ambre dit celui qui t'attend. */
export function LiveAgents({ entry }: { entry: BoardCard }) {
  const t = useTranslate()
  if (entry.live.length === 0) return null
  return (
    <span className="flex items-center -space-x-1">
      {entry.live.slice(0, 3).map((session) => {
        const waiting = session.status === 'awaiting_input'
        return (
          <span
            key={session.id}
            title={t(waiting ? 'board.tile.agent.waiting' : 'board.tile.agent.running', { title: session.title })}
            className={cx(
              'relative flex size-5 items-center justify-center rounded-full bg-canvas ring-2',
              waiting ? 'ring-caution' : 'ring-accent/60',
            )}
          >
            <AgentIcon agent={session.agent} size={11} decorative />
            {waiting ? null : <span aria-hidden className="absolute -top-0.5 -right-0.5 size-1.5 animate-pulse rounded-full bg-accent" />}
          </span>
        )
      })}
    </span>
  )
}

/** Les drapeaux qui changent ce qu'on fait d'une carte. */
export function CardFlags({ entry }: { entry: BoardCard }) {
  const t = useTranslate()
  const { card } = entry
  return (
    <>
      {entry.waiting ? <span className="rounded bg-caution/15 px-1.5 py-px text-meta font-medium text-caution">{t('board.tile.waiting')}</span> : null}
      {card.acceptedAt === null ? (
        <span className="inline-flex items-center gap-1 rounded bg-surface-high px-1.5 py-px text-meta text-ink-soft">
          <Inbox size={11} aria-hidden /> {t('board.tile.accept')}
        </span>
      ) : null}
      {card.toClarifySince !== null ? (
        <span className="inline-flex items-center gap-1 rounded bg-surface-high px-1.5 py-px text-meta text-ink-soft">
          <CircleHelp size={11} aria-hidden /> {t('board.card.toClarify')}
        </span>
      ) : null}
    </>
  )
}

/** L'échéance, relative ; rouge quand elle est passée. */
export function DueLabel({ entry }: { entry: BoardCard }) {
  const t = useTranslate()
  if (entry.card.dueAt === null) return null
  return (
    <span title={t('board.card.due')} className={cx('inline-flex items-center gap-1 text-xs', entry.late ? 'font-medium text-critical' : 'text-ink-faint')}>
      <AlarmClock size={11} aria-hidden /> {relativeDate(entry.card.dueAt)}
    </span>
  )
}

const tileClass = (entry: BoardCard) =>
  cx(
    'flex w-full touch-manipulation flex-col gap-2 rounded-lg border bg-canvas p-3 text-left transition-colors',
    entry.waiting ? 'border-caution/60 shadow-[inset_3px_0_0_var(--sg-caution)]' : 'border-line',
    (entry.card.column === 'done' || entry.card.column === 'abandoned') && 'opacity-60',
  )

/** Le contenu d'une tuile, commun à la tuile et au calque qui suit le pointeur. */
function TileBody({ entry, showMilestone }: { entry: BoardCard; showMilestone: boolean }) {
  return (
    <>
      {showMilestone && entry.milestone ? <MilestoneTag milestone={entry.milestone} /> : null}
      <span className="line-clamp-2 text-sm leading-5 text-ink">{entry.card.title}</span>
      <span className="flex flex-wrap items-center gap-1.5 empty:hidden">
        <CardFlags entry={entry} />
      </span>
      <span className="flex items-center gap-2.5">
        <span className="text-xs tabular-nums text-ink-faint">#{entry.card.number}</span>
        <SubtaskBar {...entry.subtasks} />
        <DueLabel entry={entry} />
        <span className="ml-auto flex items-center gap-1.5">
          <LiveAgents entry={entry} />
        </span>
      </span>
    </>
  )
}

/**
 * Une tuile du Tableau (B-3). Ce qui se lit d'abord : le titre ; puis ce qui demande un
 * geste (t'attend, à accepter, à préciser, en retard) ; le reste en méta discrète.
 *
 * Le bouton entier ouvre la fiche, et se saisit au pointeur : le seuil des capteurs
 * (6 px à la souris, un appui long au doigt) sépare le clic du geste. Au clavier, il
 * reste un bouton : la barre d'espace l'ouvre, elle ne le soulève pas.
 */
export function BoardTile({
  entry,
  onOpen,
  showMilestone = true,
}: {
  entry: BoardCard
  onOpen?: () => void
  /** Dans un couloir, le jalon est dit par son en-tête. */
  showMilestone?: boolean
}) {
  const { setNodeRef, listeners, isDragging } = useDraggable({ id: entry.card.id })
  // dnd-kit type ses écouteurs en `Function` ; on ne garde que ceux du pointeur.
  const gesture = listeners as { onMouseDown?: MouseEventHandler; onTouchStart?: TouchEventHandler } | undefined
  return (
    <button
      ref={setNodeRef}
      type="button"
      data-card-tile={entry.card.number}
      onMouseDown={gesture?.onMouseDown}
      onTouchStart={gesture?.onTouchStart}
      onClick={onOpen}
      className={cx(tileClass(entry), 'hover:border-line-strong', isDragging && 'opacity-40')}
    >
      <TileBody entry={entry} showMilestone={showMilestone} />
    </button>
  )
}

/**
 * La tuile tenue, qui suit le pointeur. Sans `useDraggable` : un second enregistrement du
 * même identifiant remplacerait le nœud de la vraie tuile, et le dépôt se perdrait.
 */
export function HeldTile({ entry, showMilestone = true }: { entry: BoardCard; showMilestone?: boolean }) {
  return (
    <div className={cx(tileClass(entry), 'rotate-2 shadow-float')}>
      <TileBody entry={entry} showMilestone={showMilestone} />
    </div>
  )
}
