import { TooltipButton, cx } from '@solera/ui'
import { Check, ChevronLeft, Search, X } from 'lucide-react'
import { useId, useRef, useState } from 'react'
import { useTranslate } from '../../lib/i18n'
import type { SettingGroup } from './ComposerSettings'

/**
 * L'en-tête et la liste d'options d'un réglage, partagées par les deux présentations
 * du composer : la pile de vues au doigt, et le panneau de la puce du modèle.
 */

export function SettingsHeading({ title, onBack, onClose }: {
  title: string
  onBack?: () => void
  /** Absente quand la surface se ferme autrement : un menu, une feuille qu'on tire. */
  onClose?: () => void
}) {
  const t = useTranslate()
  return (
    <header className={cx('flex shrink-0 items-center justify-between gap-2 border-b border-line py-2 pr-2', onBack ? 'pl-1' : 'pl-4')}>
      {/* Revenir, et non fermer : la vue est une branche du menu « + », et la refermer
          pour y retourner coûterait deux gestes au lieu d'un. */}
      {onBack ? (
        <TooltipButton type="button" onClick={onBack} aria-label={t('composer.settings.back')} className="flex size-11 shrink-0 items-center justify-center rounded-md text-ink-faint hover:bg-surface-high hover:text-ink focus-visible:outline-2 focus-visible:outline-accent">
          <ChevronLeft size={16} />
        </TooltipButton>
      ) : null}
      <h2 tabIndex={-1} data-settings-heading className="min-w-0 flex-1 truncate text-sm font-semibold outline-none">{title}</h2>
      {onClose ? (
        <TooltipButton type="button" onClick={onClose} aria-label={t('common.close')} className="flex size-11 shrink-0 items-center justify-center rounded-md text-ink-faint hover:bg-surface-high hover:text-ink focus-visible:outline-2 focus-visible:outline-accent">
          <X size={16} />
        </TooltipButton>
      ) : null}
    </header>
  )
}

/** Flèches pour parcourir ; Entrée/Espace pour choisir, sans fermeture accidentelle. */
export function SettingOptions({ group, onPick, disabled = false, compact = false, quietHint = false }: {
  group: SettingGroup
  onPick: (value: string) => void
  disabled?: boolean
  compact?: boolean
  /**
   * L'explication du choix retenu reste annoncée, sans s'écrire sous le rail : dans un
   * menu court, cette ligne ajoute une hauteur que le rail seul dit déjà.
   */
  quietHint?: boolean
}) {
  const t = useTranslate()
  const id = useId()
  const [query, setQuery] = useState('')
  const searchable = group.key === 'model' && group.options.length > 8
  const normalized = query.trim().toLocaleLowerCase()
  const options = searchable && normalized
    ? group.options.filter((option) => `${option.label} ${option.hint ?? ''}`.toLocaleLowerCase().includes(normalized))
    : group.options
  const items = useRef<(HTMLButtonElement | null)[]>([])
  const selectable = options.flatMap((option, index) => option.disabled || disabled ? [] : [index])
  const checkedIndex = options.findIndex((option) => option.value === group.value)
  const tabIndex = selectable.includes(checkedIndex) ? checkedIndex : selectable[0]
  const selected = group.options.find((option) => option.value === group.value)

  const onKeyDown = (event: React.KeyboardEvent, index: number) => {
    if (selectable.length === 0) return
    const step = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? -1 : 0
    if (step !== 0) {
      event.preventDefault()
      const next = selectable[(selectable.indexOf(index) + step + selectable.length) % selectable.length]
      if (next !== undefined) items.current[next]?.focus()
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      const edge = event.key === 'Home' ? selectable[0] : selectable[selectable.length - 1]
      if (edge !== undefined) items.current[edge]?.focus()
    }
  }

  return (
    <>
      {searchable ? (
        <label className="mb-2 flex min-h-11 items-center gap-2 rounded-md border border-line px-3 text-ink-faint">
          <Search size={16} className="shrink-0" />
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} aria-label={t('composer.settings.searchModels')} placeholder={t('composer.settings.searchModels')} className="min-w-0 flex-1 bg-transparent py-2 text-sm text-ink outline-none focus-visible:outline-2 focus-visible:outline-accent" />
        </label>
      ) : null}
      <div role="radiogroup" aria-label={group.label} className={cx(compact ? 'grid gap-1.5' : 'flex flex-col gap-1', compact && (options.length <= 2 ? 'grid-cols-2' : 'grid-cols-3'))}>
        {options.map((option, index) => {
          const checked = option.value === group.value
          return (
            <button key={option.value} type="button" role="radio" aria-checked={checked}
              aria-describedby={compact && checked && option.hint ? `${id}-hint` : undefined}
              disabled={disabled || option.disabled}
              ref={(node) => { items.current[index] = node }}
              tabIndex={index === tabIndex ? 0 : -1}
              onKeyDown={(event) => onKeyDown(event, index)}
              onClick={() => onPick(option.value)}
              className={cx(
                'flex min-h-11 min-w-0 items-center gap-2 rounded-md border text-left transition-colors',
                'hover:bg-accent-wash focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent',
                'disabled:pointer-events-none disabled:opacity-45',
                compact ? 'justify-center px-1.5 py-2 text-center text-xs' : 'px-3 py-2 text-sm',
                checked ? 'border-accent/40 bg-accent-wash' : compact ? 'border-line' : 'border-transparent',
                option.tone === 'caution' ? 'text-caution' : checked ? 'text-ink' : 'text-ink-soft',
              )}
            >
              <span className="min-w-0 flex-1 wrap-anywhere">
                <span className={cx('flex items-center gap-1.5 font-medium', compact && 'justify-center')}>
                  {option.icon ? <span className="shrink-0">{option.icon}</span> : null}{option.label}
                </span>
                {!compact && option.hint ? <span className="mt-0.5 block text-xs text-ink-faint">{option.hint}</span> : null}
              </span>
              {!compact ? <Check size={16} aria-hidden className={cx('shrink-0 text-accent', !checked && 'invisible')} /> : null}
            </button>
          )
        })}
      </div>
      {options.length === 0 ? <p className="px-3 py-4 text-sm text-ink-faint">{t('composer.settings.empty')}</p> : null}
      {compact && selected?.hint ? <p id={`${id}-hint`} className={quietHint ? 'sr-only' : 'mt-2 text-xs text-ink-faint'}>{selected.hint}</p> : null}
    </>
  )
}
