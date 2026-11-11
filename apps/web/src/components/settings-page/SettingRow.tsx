import type { ReactNode } from 'react'
import { cx } from '@solera/ui'
import { useTranslate } from '../../lib/i18n'
import type { SearchableSetting } from './search'

/** Un réglage d'une page de réglages : ce que la recherche lit, et ce qu'il montre. */
export interface SettingItem extends SearchableSetting {
  /**
   * `row` : libellé et aide à gauche, contrôle à droite ; `block` : le contrôle prend
   * toute la largeur sous son titre (consignes, dev container) ; `bare` : un composant
   * qui porte déjà son titre et sa surface, posé tel quel, hors de la surface du groupe.
   */
  kind: 'row' | 'block' | 'bare'
  /** Le brouillon le change : un point le dit, sur la rangée et sur sa catégorie. */
  changed?: boolean
  /** Lu sans pouvoir être changé : un projet partagé, pour qui n'en est pas propriétaire. */
  disabled?: boolean
  render: () => ReactNode
}

export const itemAnchor = (id: string) => `reglage-${id}`

/** Le point « modifié », sur une rangée ou, avec `label`, sur sa catégorie dans le menu. */
export function ChangedDot({ label }: { label?: string }) {
  const t = useTranslate()
  const text = label ?? t('settingsPage.changed')
  return (
    <span
      role="img"
      aria-label={text}
      title={text}
      className="inline-block size-1.5 shrink-0 rounded-full bg-accent"
    />
  )
}

/**
 * Un groupe de réglages : son titre au-dessus, ses rangées dans **une seule surface
 * légère**, séparées de filets. Rien à l'intérieur n'a de surface à soi : jamais deux
 * niveaux. Les composants `bare`, qui portent déjà la leur, se posent à côté.
 */
export function SettingGroup({
  id,
  name,
  items,
  highlight,
}: {
  id: string
  name: string
  items: SettingItem[]
  highlight: string | null
}) {
  const framed = items.filter((item) => item.kind !== 'bare')
  const bare = items.filter((item) => item.kind === 'bare')
  return (
    <section id={id} aria-label={name} className="flex scroll-mt-6 flex-col pt-8">
      <h3 className="pb-2.5 pl-1 text-sm font-semibold text-ink-soft">{name}</h3>
      {framed.length > 0 ? (
        <div className="flex flex-col divide-y divide-line/70 rounded-xl border border-line/60 bg-surface/50 px-5">
          {framed.map((item) => (
            <SettingRow key={item.id} item={item} highlighted={highlight === item.id} />
          ))}
        </div>
      ) : null}
      {bare.map((item) => (
        <div
          key={item.id}
          id={itemAnchor(item.id)}
          className={cx('scroll-mt-24 rounded-xl transition-colors duration-500', framed.length > 0 && 'mt-4', highlight === item.id && 'bg-accent-wash/50')}
        >
          {item.render()}
        </div>
      ))}
    </section>
  )
}

function SettingRow({ item, highlighted }: { item: SettingItem; highlighted: boolean }) {
  const shell = cx(
    '-mx-5 scroll-mt-24 px-5 py-4 transition-colors duration-500 first:rounded-t-xl last:rounded-b-xl',
    highlighted && 'bg-accent-wash/50',
  )
  const label = (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="flex items-center gap-2">
        <span className="text-sm font-medium text-ink">{item.label}</span>
        {item.changed ? <ChangedDot /> : null}
      </span>
      {item.help ? <p className="text-xs leading-relaxed text-ink-faint">{item.help}</p> : null}
    </div>
  )
  /* Un `fieldset` désactivé éteint tous les contrôles qu'il contient, boutons de segment
     et déclencheurs de liste compris, sans que chacun ait à le savoir. */
  const control = (
    <fieldset disabled={item.disabled} className="min-w-0">
      {item.render()}
    </fieldset>
  )
  if (item.kind === 'block') {
    return (
      <div id={itemAnchor(item.id)} className={cx(shell, 'flex flex-col gap-3')}>
        {label}
        {control}
      </div>
    )
  }
  return (
    <div
      id={itemAnchor(item.id)}
      className={cx(shell, 'grid gap-x-10 gap-y-2 md:grid-cols-[22rem_minmax(0,36rem)] md:items-start')}
    >
      {label}
      <div className="min-w-0 md:pt-0.5">{control}</div>
    </div>
  )
}
