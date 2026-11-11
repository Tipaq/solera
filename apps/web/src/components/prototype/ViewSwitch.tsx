/* PROTOTYPE — jetable (branche proto/page-projet). Ne pas fusionner dans main.
 *
 * Changer d'affichage n'est pas naviguer : c'est un réglage de la page, comme un tri.
 * D'où un petit contrôle segmenté dans la barre d'outils de la page, jamais une
 * seconde rangée d'onglets sous celle du projet. Même composant, même place, même
 * taille sur le Tableau et les Jalons.
 */
import { Search } from 'lucide-react'
import { useCallback, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { cx } from '@solera/ui'

export interface ViewOption<K extends string> {
  key: K
  label: string
  icon: ReactNode
}

/**
 * La vue d'une page : l'adresse (`?vue=`) d'abord, pour qu'un lien la partage ; sinon
 * la dernière choisie dans ce projet ; sinon la première.
 */
export function useView<K extends string>(scope: string, projectId: string | undefined, keys: readonly K[]): [K, (next: K) => void] {
  const [params, setParams] = useSearchParams()
  const storage = `proto-vue:${scope}:${projectId ?? ''}`
  const fromUrl = params.get('vue') as K | null
  const remembered = (typeof localStorage === 'undefined' ? null : localStorage.getItem(storage)) as K | null
  const view = fromUrl && keys.includes(fromUrl) ? fromUrl : remembered && keys.includes(remembered) ? remembered : keys[0]!
  const setView = useCallback(
    (next: K) => {
      localStorage.setItem(storage, next)
      setParams((current) => {
        current.set('vue', next)
        return current
      }, { replace: true })
    },
    [setParams, storage],
  )
  return [view, setView]
}

/** Le contrôle : libellés au large, icônes seules au téléphone, infobulle toujours. */
export function ViewSwitch<K extends string>({ options, value, onChange }: { options: ViewOption<K>[]; value: K; onChange: (next: K) => void }) {
  return (
    <span role="radiogroup" aria-label="Affichage" className="inline-flex h-11 md:h-9 pointer-coarse:h-11 shrink-0 items-center rounded-md border border-line p-0.5">
      {options.map((option) => {
        const active = option.key === value
        return (
          <button
            key={option.key}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={option.label}
            title={option.label}
            onClick={() => onChange(option.key)}
            className={cx(
              'inline-flex h-full items-center gap-1.5 rounded-md px-2 text-xs transition-colors',
              active ? 'bg-surface-high font-medium text-ink' : 'text-ink-faint hover:text-ink',
            )}
          >
            <span className="shrink-0">{option.icon}</span>
            <span className="hidden md:inline">{option.label}</span>
          </button>
        )
      })}
    </span>
  )
}

/**
 * La barre d'outils d'une page du projet, sous la rangée d'onglets : à gauche ce qui
 * restreint (recherche, filtres), à droite ce qui règle l'affichage puis l'action
 * principale. Hauteur et marges identiques d'une page à l'autre.
 */
export function PageToolbar({ left, right, view, action, below }: {
  left?: ReactNode
  /** Réglages secondaires de la vue (interrupteurs, démo), avant le sélecteur. */
  right?: ReactNode
  /** Le `ViewSwitch`. */
  view?: ReactNode
  /** L'action principale : « + Carte », « + Jalon ». */
  action?: ReactNode
  /** Une seconde ligne facultative, propre à la page (puces de filtre). */
  below?: ReactNode
}) {
  return (
    <div className="shrink-0 border-b border-line px-4 md:px-6">
      <div className="flex min-h-12 flex-wrap items-center gap-2 py-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">{left}</div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {right}
          {view}
          {action}
        </div>
      </div>
      {below ? <div className="pb-2.5">{below}</div> : null}
    </div>
  )
}

/* ------------------------------------------------------------------ barre sur une ligne
 *
 * Le motif des bons outils (Linear, GitHub Projects) : tout tient sur **une ligne**.
 * À gauche ce qui restreint — la recherche, compacte, puis « Filtrer ▾ » et les puces
 * des filtres actifs ; à droite « Affichage ▾ », qui porte le choix de vue et les
 * réglages de présentation, puis l'action principale, seule.
 */

/** La recherche compacte : étroite au repos, elle s'élargit au focus ou quand elle a du texte. */
export function ToolbarSearch({ value, onChange, placeholder = 'Chercher' }: { value: string; onChange: (next: string) => void; placeholder?: string }) {
  return (
    <label
      className={cx(
        // Le champ de la sidebar (« Rechercher ») : mêmes coins, même icône, même encre,
        // même survol ; un filet en plus, puisqu'ici c'est un champ et non un bouton.
        'group flex h-11 md:h-9 pointer-coarse:h-11 shrink-0 items-center gap-2.5 rounded-md border border-line px-2.5 text-sm text-ink-soft transition-[width,background-color] hover:bg-surface-high focus-within:border-line-strong focus-within:text-ink',
        value ? 'w-56' : 'w-36 focus-within:w-56',
      )}
    >
      <Search size={16} className="shrink-0" />
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-ink-soft"
      />
      {value ? (
        <button type="button" aria-label="Effacer la recherche" onClick={() => onChange('')} className="text-ink-faint hover:text-ink">
          ✕
        </button>
      ) : null}
    </label>
  )
}


/** Le bouton d'un menu de la barre (« Filtrer », « Affichage ») : icône, libellé, compte. */
export const toolbarButtonClass = (active: boolean) =>
  cx(
    // La hauteur de `Button size="sm"` (« + Jalon », « + Carte ») : 36 px à la souris, 44 au doigt.
    'inline-flex h-11 shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-xs transition-colors md:h-9 pointer-coarse:h-11',
    active ? 'border-line-strong bg-surface-high text-ink' : 'border-line text-ink-soft hover:border-line-strong hover:text-ink',
  )

/** Une puce de filtre actif, effaçable, posée sur la même ligne que « Filtrer ». */
export function FilterChip({ children, onClear, title }: { children: ReactNode; onClear: () => void; title?: string }) {
  return (
    <span title={title} className="inline-flex h-7 max-w-56 shrink-0 items-center gap-1.5 rounded-md bg-surface-high pl-2 pr-1 text-xs text-ink">
      <span className="min-w-0 truncate">{children}</span>
      <button type="button" aria-label="Retirer ce filtre" onClick={onClear} className="grid size-5 place-items-center rounded text-ink-faint hover:bg-canvas hover:text-ink">
        ✕
      </button>
    </span>
  )
}

/** Un titre de groupe dans un popover de la barre. */
export function MenuHeading({ children }: { children: ReactNode }) {
  return <p className="px-3 pt-3 pb-1 text-[11px] font-medium tracking-wide text-ink-faint uppercase">{children}</p>
}

/** Une ligne cochable d'un popover. */
export function MenuCheck({ checked, onChange, children, aside }: { checked: boolean; onChange: (next: boolean) => void; children: ReactNode; aside?: ReactNode }) {
  return (
    <button
      type="button"
      role="menuitemcheckbox"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-surface-high"
    >
      <span className={cx('grid size-4 shrink-0 place-items-center rounded border text-[10px]', checked ? 'border-accent bg-accent text-accent-ink' : 'border-line-strong')}>
        {checked ? '✓' : ''}
      </span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {aside ? <span className="shrink-0 text-xs tabular-nums text-ink-faint">{aside}</span> : null}
    </button>
  )
}

/** Un choix exclusif d'un popover, en boutons segmentés pleine largeur. */
export function MenuSegment<K extends string>({ options, value, onChange }: { options: { key: K; label: string }[]; value: K; onChange: (next: K) => void }) {
  return (
    <div className="mx-3 my-1 flex rounded-lg border border-line p-0.5">
      {options.map((option) => (
        <button
          key={option.key}
          type="button"
          aria-pressed={option.key === value}
          onClick={() => onChange(option.key)}
          className={cx(
            'flex-1 rounded-md px-2 py-1 text-xs transition-colors',
            option.key === value ? 'bg-surface-high font-medium text-ink' : 'text-ink-faint hover:text-ink',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

/** Les vues en tuiles à icône, en tête du popover « Affichage ». */
export function ViewTiles<K extends string>({ options, value, onChange }: { options: ViewOption<K>[]; value: K; onChange: (next: K) => void }) {
  return (
    <div className="grid gap-1.5 px-3 pt-3 pb-2" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map((option) => {
        const active = option.key === value
        return (
          <button
            key={option.key}
            type="button"
            aria-pressed={active}
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

/** La barre sur une ligne. Les puces débordent par défilement horizontal, jamais à la ligne. */
export function OneLineToolbar({ search, filter, chips, display, action, extra }: {
  search: ReactNode
  filter: ReactNode
  /** Les filtres actifs, en puces. */
  chips?: ReactNode
  display: ReactNode
  action?: ReactNode
  /** Commandes discrètes (démo), avant « Affichage ». */
  extra?: ReactNode
}) {
  return (
    <div className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-4 md:px-6">
      {search}
      {filter}
      <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto">{chips}</div>
      {extra}
      {display}
      {action}
    </div>
  )
}
