import { Check, Filter, SlidersHorizontal } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Button, Popover, SegmentedControl, TooltipButton, cx, type Segment } from '@solera/ui'
import { useTranslate } from '../../lib/i18n'
import { toolbarButtonClass } from './OneLineToolbar'

/*
 * Les deux menus de la barre sur une ligne, et leurs pièces.
 *
 * Des `Popover` et non des `Menu` du design system : un `Menu` Radix se ferme à chaque
 * choix, alors qu'on coche plusieurs filtres d'affilée et qu'on règle l'affichage en
 * regardant la page changer dessous.
 */

export interface ViewOption<K extends string> {
  key: K
  label: string
  icon: ReactNode
}

/**
 * « Filtrer ▾ » : le popover des filtres d'une page, ses groupes en `MenuHeading` et
 * `MenuCheck`. Le bouton compte les filtres posés ; le pied les efface tous.
 *
 * `compact` le range au bout d'une ligne d'outils du panneau : le libellé ne paraît
 * qu'à partir de 22 rem de ligne (son conteneur), le popover s'aligne sur la fin, et
 * le nom accessible garde le libellé quand il se tait.
 */
export function FilterMenu({ active, onClearAll, compact = false, children }: {
  active: number
  onClearAll?: () => void
  compact?: boolean
  children: ReactNode
}) {
  const t = useTranslate()
  const [open, setOpen] = useState(false)
  const label = t('toolbar.filter')
  const activeLabel = active > 0 ? t(active === 1 ? 'toolbar.filter.active.one' : 'toolbar.filter.active.many', { count: active }) : undefined
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      label={label}
      side="bottom"
      align={compact ? 'end' : 'start'}
      className={compact ? 'w-72' : 'w-80'}
      trigger={
        <TooltipButton
          type="button"
          className={toolbarButtonClass(active > 0)}
          title={activeLabel}
          aria-label={compact ? (activeLabel ? `${label} — ${activeLabel}` : label) : undefined}
        >
          <Filter size={13} />
          {compact ? <span className="hidden @min-[22rem]:inline">{label}</span> : label}
          {active > 0 ? <span className="rounded bg-accent px-1 text-micro font-semibold tabular-nums text-accent-ink">{active}</span> : null}
        </TooltipButton>
      }
    >
      <div className="max-h-[70vh] overflow-y-auto pb-2">
        {children}
        {active > 0 && onClearAll ? (
          <div className="mt-2 border-t border-line px-1.5 pt-1.5">
            <Button variant="ghost" size="sm" onClick={onClearAll}>
              {t('toolbar.filter.clearAll')}
            </Button>
          </div>
        ) : null}
      </div>
    </Popover>
  )
}

/**
 * « Affichage ▾ » : en tête les vues de la page en tuiles, dessous ses réglages de
 * présentation (regroupement, tri, ce qu'on montre). Le bouton porte l'icône de la vue
 * courante ; son libellé se tait au téléphone, l'infobulle nomme la vue.
 *
 * Une page qui n'a qu'une vue ne passe pas `views` : pas de tuile seule, une icône de
 * réglages à la place.
 */
export function DisplayMenu<K extends string>(
  props: { children?: ReactNode } & ({ views: ViewOption<K>[]; value: K; onChange: (next: K) => void } | { views?: undefined }),
) {
  const t = useTranslate()
  const [open, setOpen] = useState(false)
  const label = t('toolbar.display')
  const current = props.views?.find((option) => option.key === props.value)
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      label={label}
      side="bottom"
      align="end"
      className="w-80"
      trigger={
        <TooltipButton
          type="button"
          className={toolbarButtonClass(false)}
          title={current ? t('toolbar.display.current', { view: current.label }) : undefined}
          aria-label={current ? t('toolbar.display.current', { view: current.label }) : label}
        >
          {current?.icon ?? <SlidersHorizontal size={16} />}
          <span className="hidden sm:inline">{label}</span>
        </TooltipButton>
      }
    >
      <div className="max-h-[70vh] overflow-y-auto pb-3">
        {props.views ? <ViewTiles options={props.views} value={props.value} onChange={props.onChange} /> : null}
        {props.children}
      </div>
    </Popover>
  )
}

/** Les vues en tuiles à icône, en tête d'« Affichage ». */
export function ViewTiles<K extends string>({ options, value, onChange }: { options: ViewOption<K>[]; value: K; onChange: (next: K) => void }) {
  const t = useTranslate()
  return (
    <div
      role="radiogroup"
      aria-label={t('toolbar.display.views')}
      className="grid gap-1.5 px-3 pt-3 pb-2"
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map((option) => {
        const active = option.key === value
        return (
          <button
            key={option.key}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option.key)}
            className={cx(
              'flex flex-col items-center gap-1.5 rounded-lg border px-2 py-2.5 text-xs transition-colors',
              active ? 'border-accent bg-accent-wash/40 font-medium text-ink' : 'border-line text-ink-soft hover:border-line-strong',
            )}
          >
            {option.icon}
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

/** Le titre d'un groupe dans un popover de la barre, en petites capitales. */
export function MenuHeading({ children }: { children: ReactNode }) {
  return <p className="px-3 pt-3 pb-1 text-meta font-medium tracking-wide text-ink-faint uppercase">{children}</p>
}

/**
 * Une ligne cochable d'un popover, son compte en regard. Une case à cocher et non un
 * `menuitemcheckbox` : le popover n'est pas un menu, et ce rôle n'y aurait pas de sens.
 *
 * `exclusive` en fait une option d'un choix unique trop long pour un `MenuSegment` (une
 * carte parente parmi vingt) : un rond au lieu d'une case, et l'appelant pose le
 * `radiogroup` autour. Choisie, elle ne se décoche pas d'un clic : sa puce l'efface.
 */
export function MenuCheck({
  checked,
  onChange,
  aside,
  exclusive = false,
  children,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  aside?: ReactNode
  exclusive?: boolean
  children: ReactNode
}) {
  return (
    <button
      type="button"
      role={exclusive ? 'radio' : 'checkbox'}
      aria-checked={checked}
      onClick={() => onChange(exclusive || !checked)}
      className="flex min-h-11 w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-surface-high md:min-h-8 pointer-coarse:min-h-11"
    >
      <span
        aria-hidden
        className={cx(
          'grid size-4 shrink-0 place-items-center border',
          exclusive ? 'rounded-full' : 'rounded',
          checked ? 'border-accent bg-accent text-accent-ink' : 'border-line-strong',
        )}
      >
        {checked ? exclusive ? <span className="size-1.5 rounded-full bg-accent-ink" /> : <Check size={11} strokeWidth={3} /> : null}
      </span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {aside !== undefined ? <span className="shrink-0 text-xs tabular-nums text-ink-faint">{aside}</span> : null}
    </button>
  )
}

/** Un choix exclusif d'un popover : le `SegmentedControl` du design system, pleine largeur. */
export function MenuSegment<K extends string>({ label, segments, value, onChange }: { label: string; segments: Segment<K>[]; value: K; onChange: (next: K) => void }) {
  return (
    <div className="px-3 py-1">
      <SegmentedControl label={label} segments={segments} value={value} onChange={onChange} className="flex w-full" />
    </div>
  )
}
