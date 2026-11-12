import { CheckCheck, Hand, Hourglass, Play, Sparkles } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { cx } from '@solera/ui'
import { gestureSections, openBlockers, type BoardCard } from '../../lib/board-model'
import { cardDestinationHref } from '../../lib/card-destination'
import type { StatusOf } from '../../lib/card-state'
import { useTranslate } from '../../lib/i18n'
import { StillTile } from './BoardTile'

export interface GestureViewProps {
  /** Les tuiles qui passent la recherche et les filtres. */
  entries: BoardCard[]
  projectId: string
  /** Le statut vivant des sessions, pour savoir où mène « Lancer ». */
  statusOf?: StatusOf
  onOpen: (number: number) => void
}

/**
 * **Par geste** (B-6) : les mêmes cartes, rangées non par colonne mais par ce qu'elles
 * attendent de quelqu'un — ce qui t'attend, ce que les agents font, ce qui peut partir,
 * ce qui attend une autre carte, ce qui vient d'aboutir. Pas de glisser-déposer : le
 * geste est celui de la section.
 */
export function GestureView({ entries, projectId, statusOf, onOpen }: GestureViewProps) {
  const t = useTranslate()
  const [search] = useSearchParams()
  const sections = gestureSections(entries)

  const launch = (entry: BoardCard) => (
    <Link
      to={cardDestinationHref(projectId, entry.card, { statusOf, search })}
      className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-accent hover:bg-accent-wash/50"
    >
      <Play size={11} aria-hidden /> {t('board.gesture.launch')}
    </Link>
  )
  const after = (entry: BoardCard) => (
    <span className="text-xs text-ink-faint">
      {t('board.gesture.after', { cards: openBlockers(entry.card).map((blocker) => `#${blocker.number}`).join(', ') })}
    </span>
  )

  return (
    <div data-board-gestures className="h-full min-h-0 overflow-y-auto px-4 py-5 md:px-6">
      <div className="flex flex-col gap-7">
        <Section icon={<Hand size={14} />} tone="text-caution" title={t('board.gesture.forYou')} hint={t('board.gesture.forYouHint')} entries={sections.forYou} onOpen={onOpen} />
        <Section icon={<Sparkles size={14} />} tone="text-accent" title={t('board.gesture.agents')} hint={t('board.gesture.agentsHint')} entries={sections.agents} onOpen={onOpen} />
        <Section icon={<Play size={14} />} tone="text-ink" title={t('board.gesture.ready')} hint={t('board.gesture.readyHint')} entries={sections.ready} onOpen={onOpen} aside={launch} />
        <Section
          icon={<Hourglass size={14} />}
          tone="text-ink-soft"
          title={t('board.gesture.blocked')}
          hint={t('board.gesture.blockedHint')}
          entries={sections.blocked}
          onOpen={onOpen}
          aside={after}
        />
        <Section icon={<CheckCheck size={14} />} tone="text-positive" title={t('board.gesture.doneWeek')} entries={sections.doneWeek} onOpen={onOpen} folded />
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
  hint?: string
  entries: BoardCard[]
  onOpen: (number: number) => void
  aside?: (entry: BoardCard) => ReactNode
  folded?: boolean
}) {
  const t = useTranslate()
  const [open, setOpen] = useState(!folded)
  return (
    <section aria-label={title} className="flex flex-col gap-3">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex items-baseline gap-2 text-left">
        <span className={cx('flex items-center gap-1.5 text-sm font-medium', tone)}>
          {icon} {title}
        </span>
        <span className="text-xs tabular-nums text-ink-faint">{entries.length}</span>
        {hint ? <span className="hidden text-xs text-ink-faint sm:inline">· {hint}</span> : null}
      </button>
      {!open ? null : entries.length === 0 ? (
        <p className="text-xs text-ink-faint">{t('board.gesture.empty')}</p>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] gap-2">
          {entries.map((entry) => (
            <div key={entry.card.id} className="flex flex-col gap-1">
              <StillTile entry={entry} onOpen={() => onOpen(entry.card.number)} />
              {aside ? <div className="flex justify-end px-1">{aside(entry)}</div> : null}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
