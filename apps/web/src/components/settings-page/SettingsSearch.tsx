import * as Dialog from '@radix-ui/react-dialog'
import { Search, X } from 'lucide-react'
import { useState } from 'react'
import { IconButton, cx } from '@solera/ui'
import { useTranslate } from '../../lib/i18n'
import { searchSettings } from './search'
import type { SettingItem } from './SettingRow'

/**
 * La recherche d'une page de réglages, à la demande (R-2) : une palette ouverte par la
 * loupe ou la touche `/`. ↑↓ choisissent, Entrée y va, Échap ferme ; choisir ferme la
 * palette et laisse la page amener le réglage au centre.
 */
export function SettingsSearch({
  open,
  onOpenChange,
  items,
  categoryLabel,
  onPick,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  items: SettingItem[]
  categoryLabel: (key: string) => string
  onPick: (item: SettingItem) => void
}) {
  const t = useTranslate()
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const results = searchSettings(items, query, categoryLabel)
  const typed = query.trim().length > 0

  const close = (next: boolean) => {
    if (!next) {
      setQuery('')
      setCursor(0)
    }
    onOpenChange(next)
  }
  const pick = (item: SettingItem) => {
    close(false)
    onPick(item)
  }

  return (
    <Dialog.Root open={open} onOpenChange={close}>
      <Dialog.Portal>
        <Dialog.Overlay className="scrim z-40" />
        <Dialog.Content
          aria-describedby={undefined}
          className="surface fixed top-[12vh] left-1/2 z-50 flex w-[min(32rem,calc(100vw-2rem))] -translate-x-1/2 flex-col overflow-hidden rounded-xl border border-line shadow-pop"
        >
          <Dialog.Title className="sr-only">{t('settingsPage.search.title')}</Dialog.Title>
          <div className="flex h-12 items-center gap-2.5 border-b border-line pr-2 pl-4">
            <Search size={16} className="shrink-0 text-ink-faint" />
            <input
              autoFocus
              type="search"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value)
                setCursor(0)
              }}
              aria-label={t('settingsPage.search.title')}
              onKeyDown={(event) => {
                // Sur le champ seulement : Entrée sur ✕ ferme, elle n'ouvre pas un résultat.
                if (event.key === 'ArrowDown') {
                  event.preventDefault()
                  setCursor((value) => Math.min(value + 1, results.length - 1))
                } else if (event.key === 'ArrowUp') {
                  event.preventDefault()
                  setCursor((value) => Math.max(value - 1, 0))
                } else if (event.key === 'Enter' && results[cursor]) {
                  event.preventDefault()
                  pick(results[cursor]!)
                }
              }}
              placeholder={t('settingsPage.search.placeholder')}
              className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-faint [&::-webkit-search-cancel-button]:hidden"
            />
            <Dialog.Close asChild>
              <IconButton label={t('settingsPage.search.close')} size="sm">
                <X size={15} />
              </IconButton>
            </Dialog.Close>
          </div>
          {!typed ? (
            <p className="px-4 py-3 text-xs text-ink-faint">{t('settingsPage.search.hint')}</p>
          ) : results.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-ink-faint">{t('settingsPage.search.empty', { query: query.trim() })}</p>
          ) : (
            <ul role="listbox" aria-label={t('settingsPage.search.results')} className="max-h-80 overflow-y-auto py-1">
              {results.map((item, position) => (
                <li key={item.id} role="option" aria-selected={position === cursor}>
                  <button
                    type="button"
                    tabIndex={-1}
                    onMouseEnter={() => setCursor(position)}
                    onClick={() => pick(item)}
                    className={cx('flex w-full items-baseline gap-2 px-4 py-2 text-left', position === cursor && 'bg-surface-high')}
                  >
                    <span className="shrink-0 text-sm text-ink">{item.label}</span>
                    <span className="min-w-0 truncate text-xs text-ink-faint">
                      {categoryLabel(item.category)} › {item.group}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
