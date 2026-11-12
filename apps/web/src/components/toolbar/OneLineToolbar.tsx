import { Search, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { IconButton, cx } from '@solera/ui'
import { useTranslate } from '../../lib/i18n'

/**
 * La barre d'outils d'une page, sous la rangée d'onglets, tenue sur **une ligne** comme
 * chez les bons outils (Linear, GitHub Projects) : à gauche ce qui restreint — la
 * recherche, « Filtrer ▾ » puis les filtres actifs en puces ; à droite les commandes
 * discrètes, « Affichage ▾ », et l'action principale, seule au bout.
 *
 * Les puces occupent la place qui reste et défilent de côté quand elles débordent : elles
 * ne passent jamais à la ligne, sans quoi la barre changerait de hauteur à chaque coche
 * et le contenu sauterait dessous. La gouttière est celle de la coque (`px-4 md:px-6`).
 * Au téléphone, quand des puces sont posées, la recherche vide se replie sur sa loupe
 * pour leur laisser la place, et se rouvre au focus.
 */
export function OneLineToolbar({
  search,
  filter,
  chips,
  extra,
  display,
  action,
}: {
  search: ReactNode
  filter?: ReactNode
  /** Les filtres actifs, en `FilterChip`. */
  chips?: ReactNode
  /** Commandes discrètes (méta neutre, bascule de portée), avant « Affichage ». */
  extra?: ReactNode
  display?: ReactNode
  /** L'action principale de la page (« + Carte »), en `Button size="sm"`. */
  action?: ReactNode
}) {
  return (
    <div data-toolbar className="group/toolbar flex h-12 shrink-0 items-center gap-2 border-b border-line px-4 md:px-6">
      {search}
      {filter}
      <div data-toolbar-chips className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto [scrollbar-width:none]">
        {chips}
      </div>
      {extra}
      {display}
      {action}
    </div>
  )
}

/**
 * La recherche de la barre : étroite au repos, elle s'élargit au focus ou quand elle a
 * du texte. Le rendu est celui de *Rechercher* dans la sidebar — mêmes coins, même loupe,
 * même encre, même survol — avec un filet en plus, puisqu'ici c'est un champ et non un
 * bouton.
 */
export function ToolbarSearch({
  value,
  onChange,
  placeholder,
  label,
  widthClass,
}: {
  value: string
  onChange: (next: string) => void
  placeholder?: string
  /** Le nom accessible, quand il diffère de l'indication. */
  label?: string
  /** Les classes de largeur posées par l'hôte, à la place de l'élargissement au focus de la barre. */
  widthClass?: string
}) {
  const t = useTranslate()
  const hint = placeholder ?? t('toolbar.search')
  return (
    <label
      className={cx(
        'group shrink transition-[width,background-color,border-color]',
        toolbarFieldClass(),
        widthClass ??
          (value
            ? 'w-56'
            : 'w-36 focus-within:w-56 max-sm:group-has-[[data-filter-chip]]/toolbar:w-11 max-sm:group-has-[[data-filter-chip]]/toolbar:focus-within:w-56'),
      )}
    >
      <Search size={16} className="shrink-0" />
      <input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-label={label ?? hint}
        placeholder={hint}
        className="min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-ink-soft [&::-webkit-search-cancel-button]:hidden"
      />
      {value ? (
        <IconButton label={t('toolbar.search.clear')} size="sm" onClick={() => onChange('')} className="-mr-1.5">
          <X size={14} />
        </IconButton>
      ) : null}
    </label>
  )
}

/**
 * Un champ de la barre au format de *Rechercher* dans la sidebar : mêmes coins, même
 * icône à gauche, même encre, même survol, un filet en plus. La hauteur de `Button
 * size="sm"`. La recherche de la barre, celle du panneau et l'adresse d'une page web
 * le partagent ; chacun pose sa largeur et sa transition. `invalid` borde de rouge.
 */
export const toolbarFieldClass = (invalid = false) =>
  cx(
    'flex h-11 min-w-0 items-center gap-2.5 rounded-md border px-2.5 text-sm text-ink-soft hover:bg-surface-high focus-within:text-ink md:h-9 pointer-coarse:h-11',
    invalid ? 'border-critical' : 'border-line focus-within:border-line-strong',
  )

/**
 * Ce qu'on ajoute à un outil fait d'une seule icône : carré de 36 px à la souris, et
 * 44 px de large au doigt comme de haut (*Gabarit tactile*).
 */
export const iconToolClass = 'justify-center min-w-11 md:min-w-9 pointer-coarse:min-w-11'

/**
 * Le bouton d'un menu de la barre (« Filtrer », « Affichage ») : icône, libellé, compte.
 * La hauteur de `Button size="sm"` (« + Carte »), 36 px à la souris et 44 au doigt, pour
 * que la ligne reste alignée. Actif quand un filtre est posé.
 */
export const toolbarButtonClass = (active: boolean) =>
  cx(
    'inline-flex h-11 shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-xs transition-colors md:h-9 pointer-coarse:h-11 focus-visible:outline-2 focus-visible:outline-accent',
    active ? 'border-line-strong bg-surface-high text-ink' : 'border-line text-ink-soft hover:border-line-strong hover:text-ink',
  )

/**
 * Un filtre actif, effaçable, posé sur la même ligne que « Filtrer ».
 *
 * Une pastille de 28 px : sa croix ne peut pas être un `IconButton`, dont les 44 px au
 * doigt déborderaient de la puce. Elle reste petite à l'œil et prend sa cible de 44 px
 * au doigt par un calque invisible.
 */
export function FilterChip({ children, onClear, title }: { children: ReactNode; onClear: () => void; title?: string }) {
  const t = useTranslate()
  return (
    <span data-filter-chip title={title} className="inline-flex h-7 max-w-56 shrink-0 items-center gap-1.5 rounded-md bg-surface-high pr-1 pl-2 text-xs text-ink">
      <span className="min-w-0 truncate">{children}</span>
      <button
        type="button"
        aria-label={t('toolbar.chip.remove')}
        onClick={onClear}
        className="relative grid size-5 shrink-0 place-items-center rounded text-ink-faint hover:bg-canvas hover:text-ink pointer-coarse:after:absolute pointer-coarse:after:-inset-3"
      >
        <X size={12} />
      </button>
    </span>
  )
}
