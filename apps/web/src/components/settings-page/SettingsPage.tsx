import { Search } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { IconButton, cx } from '@solera/ui'
import { useTranslate } from '../../lib/i18n'
import { groupsOf } from './search'
import { ChangedDot, SettingGroup, itemAnchor, type SettingItem } from './SettingRow'
import { SettingsSearch } from './SettingsSearch'
import { useReadingAnchor } from './useReadingAnchor'

export interface SettingsCategory {
  key: string
  label: string
  /** La Zone de danger : en rouge, en bas du menu, sans sous-catégories. */
  danger?: boolean
}

interface NavCategory extends SettingsCategory {
  groups: { anchor: string; name: string; items: SettingItem[] }[]
}

const groupAnchor = (category: string, index: number) => `reglages-${category}-${index}`
const categoryAnchor = (category: string) => `reglages-${category}`

/** Combien de temps un réglage trouvé par la recherche reste surligné. */
const HIGHLIGHT_MS = 1800

/**
 * Une page de réglages à menu gauche (page projet v2, R-1 et R-2) : une seule page qui
 * défile, ses catégories et leurs groupes dans le menu, la recherche à la demande.
 *
 * - Au large, un menu de 16 rem : les catégories en texte, celle qu'on lit en pilule
 *   teintée, leurs groupes le long d'un rail, celui qu'on lit en accent avec un trait
 *   épais ; un point sur une catégorie qui a des modifications en attente ; la Zone de
 *   danger à part, en bas.
 * - Au téléphone, un sélecteur « Catégorie › Groupe » et la loupe.
 * - La page ne sait rien du brouillon : chaque réglage dit s'il est `changed`, et la
 *   barre d'enregistrement arrive par `footer`.
 */
export function SettingsPage({
  categories,
  items,
  notice,
  footer,
}: {
  categories: SettingsCategory[]
  items: SettingItem[]
  /** Une bannière en tête du contenu : « projet partagé, lecture seule ». */
  notice?: ReactNode
  /** Posé en bas de la page, hors du défilement : la `SaveBar`. */
  footer?: ReactNode
}) {
  const t = useTranslate()

  const nav: NavCategory[] = categories
    .map((category) => ({
      ...category,
      groups: groupsOf(items, category.key).map((group, index) => ({
        anchor: groupAnchor(category.key, index),
        name: group.name,
        items: group.items,
      })),
    }))
    .filter((category) => category.groups.length > 0)
  const work = nav.filter((category) => !category.danger)
  const danger = nav.filter((category) => category.danger)
  const categoryLabel = (key: string) => categories.find((category) => category.key === key)?.label ?? key

  /* ------------------------------------------------ suivre la lecture */
  const scroller = useRef<HTMLDivElement>(null)
  // Le hook compare la liste par sa jointure : une nouvelle liste à chaque rendu ne le relance pas.
  const anchors = nav.flatMap((category) => category.groups.map((group) => group.anchor))
  const { active, pin } = useReadingAnchor(scroller, anchors)
  const activeCategory = nav.find((category) => category.groups.some((group) => group.anchor === active))?.key

  const scrollTo = (target: string, anchor: string) => {
    pin(anchor)
    scroller.current
      ?.querySelector(`#${CSS.escape(target)}`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  /* Une catégorie se lit par son premier groupe : cliquer « Général » allume « Identité ». */
  const openCategory = (category: NavCategory) => scrollTo(categoryAnchor(category.key), category.groups[0]!.anchor)

  /* ------------------------------------------------ recherche */
  const [searching, setSearching] = useState(false)
  const [highlight, setHighlight] = useState<string | null>(null)
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]')) return
      event.preventDefault()
      setSearching(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  useEffect(() => {
    if (!highlight) return
    const timer = window.setTimeout(() => setHighlight(null), HIGHLIGHT_MS)
    return () => window.clearTimeout(timer)
  }, [highlight])

  const reveal = (item: SettingItem) => {
    setHighlight(item.id)
    // Après la fermeture de la palette, qui rend le focus et pourrait faire défiler.
    window.setTimeout(() => {
      scroller.current
        ?.querySelector(`#${CSS.escape(itemAnchor(item.id))}`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 0)
  }

  const changedIn = (category: NavCategory) =>
    category.groups.some((group) => group.items.some((item) => item.changed))

  return (
    <div className="flex h-full min-h-0 flex-col md:flex-row">
      {/* ---------------------------------------------- menu, au large */}
      <aside aria-label={t('settingsPage.nav')} className="hidden w-64 shrink-0 flex-col border-r border-line md:flex">
        <div className="flex h-16 shrink-0 items-center justify-between pr-3 pl-6">
          <h2 className="text-xs font-medium tracking-wide text-ink-faint uppercase">{t('settingsPage.title')}</h2>
          <IconButton
            label={t('settingsPage.search.open')}
            title={t('settingsPage.search.openHint')}
            onClick={() => setSearching(true)}
          >
            <Search size={15} />
          </IconButton>
        </div>
        <nav className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3.5 pb-4">
          <div className="flex flex-col gap-4">
            {work.map((category) => (
              <MenuCategory
                key={category.key}
                category={category}
                lit={category.key === activeCategory}
                active={active}
                changed={changedIn(category)}
                onCategory={() => openCategory(category)}
                onGroup={(anchor) => scrollTo(anchor, anchor)}
              />
            ))}
          </div>
          {danger.map((category) => (
            <div key={category.key} className="mt-auto border-t border-line pt-3">
              <MenuCategory
                category={category}
                lit={category.key === activeCategory}
                active={active}
                changed={changedIn(category)}
                onCategory={() => openCategory(category)}
                onGroup={(anchor) => scrollTo(anchor, anchor)}
              />
            </div>
          ))}
        </nav>
      </aside>

      {/* ---------------------------------------------- menu, au téléphone */}
      <div className="flex shrink-0 items-center gap-2 border-b border-line px-4 py-2.5 md:hidden">
        <select
          aria-label={t('settingsPage.goTo')}
          value={active ?? ''}
          onChange={(event) => scrollTo(event.target.value, event.target.value)}
          className="h-10 min-w-0 flex-1 rounded-lg border border-line bg-canvas px-3 text-sm text-ink"
        >
          {nav.map((category) => (
            <optgroup key={category.key} label={category.label}>
              {category.groups.map((group) => (
                <option key={group.anchor} value={group.anchor}>
                  {category.label} › {group.name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <IconButton
          label={t('settingsPage.search.open')}
          onClick={() => setSearching(true)}
          className="size-10 rounded-lg border border-line"
        >
          <Search size={16} />
        </IconButton>
      </div>

      {/* ---------------------------------------------- contenu
          Le défilement dans un enfant : la barre du bas se pose sur ce cadre, centrée
          sur le contenu et non sur le menu, et ne défile pas avec lui. */}
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        <div ref={scroller} className="min-h-0 min-w-0 flex-1 overflow-y-auto">
          <div className="flex max-w-[72rem] flex-col px-4 pt-4 pb-[60vh] md:px-6 md:pt-0">
            {notice}
            {nav.map((category, position) => (
              <section
                key={category.key}
                id={categoryAnchor(category.key)}
                aria-labelledby={`${categoryAnchor(category.key)}-titre`}
                className={cx('flex flex-col', position > 0 && 'mt-16 border-t border-line pt-10')}
              >
                {/* La première s'aligne sur l'en-tête du menu ; les suivantes s'ouvrent sur un
                    filet et un grand blanc, pour qu'on sache qu'on a changé de catégorie. */}
                <header className={cx('flex items-center', position === 0 && 'min-h-16')}>
                  <h2
                    id={`${categoryAnchor(category.key)}-titre`}
                    className={cx('text-lg font-semibold tracking-tight', category.danger ? 'text-critical' : 'text-ink')}
                  >
                    {category.label}
                  </h2>
                </header>
                {category.groups.map((group) => (
                  <SettingGroup key={group.anchor} id={group.anchor} name={group.name} items={group.items} highlight={highlight} />
                ))}
              </section>
            ))}
          </div>
        </div>
        {footer}
      </div>

      <SettingsSearch
        open={searching}
        onOpenChange={setSearching}
        items={items}
        categoryLabel={categoryLabel}
        onPick={reveal}
      />
    </div>
  )
}

function MenuCategory({
  category,
  lit,
  active,
  changed,
  onCategory,
  onGroup,
}: {
  category: NavCategory
  lit: boolean
  active: string | null
  changed: boolean
  onCategory: () => void
  onGroup: (anchor: string) => void
}) {
  const t = useTranslate()
  const danger = Boolean(category.danger)
  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={onCategory}
        aria-current={lit ? 'location' : undefined}
        className={cx(
          'flex h-9 items-center gap-2 rounded-lg px-2.5 text-left text-sm transition-colors',
          lit
            ? danger
              ? 'bg-critical/10 font-semibold text-critical'
              : 'bg-accent-wash/60 font-semibold text-ink'
            : danger
              ? 'text-critical hover:bg-critical/5'
              : 'text-ink-soft hover:bg-surface-high hover:text-ink',
        )}
      >
        <span className="min-w-0 flex-1 truncate">{category.label}</span>
        {changed ? <ChangedDot label={t('settingsPage.pending')} /> : null}
      </button>
      {/* La Zone de danger n'a qu'un groupe : le redire en dessous n'apprendrait rien. */}
      {danger ? null : (
        <div className="flex flex-col">
          {category.groups.map((group) => {
            const here = group.anchor === active
            return (
              <button
                key={group.anchor}
                type="button"
                onClick={() => onGroup(group.anchor)}
                aria-current={here ? 'location' : undefined}
                className={cx(
                  'relative ml-3 flex h-7 items-center border-l-2 pr-2 pl-3 text-left text-xs transition-colors',
                  here
                    ? 'border-accent font-medium text-accent'
                    : 'border-line text-ink-faint hover:border-line-strong hover:text-ink-soft',
                )}
              >
                <span className="truncate">{group.name}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
