import { Search, SquareKanban } from 'lucide-react'
import { type ReactNode, useMemo, useState } from 'react'
import type { CardDto, CardLinkDto } from '@solera/protocol'
import { useCards } from '../../lib/cards'
import { useTranslate } from '../../lib/i18n'
import { Popover, cx } from '@solera/ui'
import { columnLabel } from './columns'

const RESULT_LIMIT = 12

/**
 * Choisit une carte du projet : celle qui sert de jalon, celle qu'on déclare bloquée.
 *
 * Les cartes viennent de celles que le board a déjà chargées, sans requête de plus :
 * le panneau ne s'ouvre que depuis un board, qui les tient toutes. Au repos la liste
 * propose `suggested` — pour un jalon, les cartes qui en servent déjà, parce qu'un
 * jalon se réutilise bien plus souvent qu'il ne s'en crée.
 */
export function CardChooser({
  projectId,
  trigger,
  label,
  excludeIds,
  suggested = [],
  suggestedLabel,
  onPick,
}: {
  projectId: string
  trigger: ReactNode
  label: string
  /** La carte courante et celles déjà liées : les reproposer n'aurait aucun effet. */
  excludeIds: string[]
  suggested?: CardLinkDto[]
  suggestedLabel?: string
  onPick: (card: CardLinkDto) => void
}) {
  const t = useTranslate()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const { data: cards } = useCards(open ? projectId : undefined)

  const results = useMemo(() => {
    const hidden = new Set(excludeIds)
    const text = query.trim().toLowerCase()
    const pool = (cards ?? []).filter((card: CardDto) => !hidden.has(card.id))
    if (!text) return suggested.filter((card) => !hidden.has(card.id)).slice(0, RESULT_LIMIT)
    return pool
      .filter(
        (card) =>
          card.title.toLowerCase().includes(text) || String(card.number).startsWith(text),
      )
      .slice(0, RESULT_LIMIT)
      .map((card) => ({ id: card.id, number: card.number, title: card.title, column: card.column }))
  }, [cards, excludeIds, query, suggested])

  const empty = query.trim() ? t('board.card.chooser.noResult') : t('board.card.chooser.empty')

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setQuery('')
      }}
      side="bottom"
      label={label}
      trigger={trigger}
      className="w-80 max-w-[90vw]"
    >
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <Search size={14} className="shrink-0 text-ink-faint" />
        <input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t('board.card.chooser.search')}
          className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-faint"
        />
      </div>
      {!query.trim() && suggestedLabel && results.length > 0 ? (
        <p className="px-3 pt-2 text-meta tracking-wide text-ink-faint uppercase">
          {suggestedLabel}
        </p>
      ) : null}
      <div className="min-h-0 flex-1 overflow-y-auto p-1">
        {results.length === 0 ? (
          <p className="px-2 py-3 text-sm text-ink-faint">{empty}</p>
        ) : (
          <ul>
            {results.map((card) => (
              <li key={card.id}>
                <button
                  type="button"
                  onClick={() => {
                    onPick(card)
                    setOpen(false)
                    setQuery('')
                  }}
                  className={cx(
                    'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm',
                    'text-ink-soft hover:bg-surface-high hover:text-ink',
                  )}
                >
                  <SquareKanban size={14} className="shrink-0 text-ink-faint" />
                  <span className="shrink-0 text-ink-faint">#{card.number}</span>
                  <span className="min-w-0 flex-1 truncate">{card.title}</span>
                  <span className="shrink-0 text-meta text-ink-faint">
                    {columnLabel(card.column)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Popover>
  )
}
