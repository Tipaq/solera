/* PROTOTYPE — jetable (branche proto/page-projet). Ne pas fusionner dans main.
 *
 * `page-gauche`, affinée après le retour de Tim :
 * - un menu sobre, aligné sur le haut du contenu : catégorie en texte net, l'active
 *   marquée d'un trait d'accent ; sous-catégories lisibles mais secondaires ; un point
 *   quand une catégorie a des modifications en attente ; Zone de danger à part, en bas ;
 * - plus de champ de recherche permanent : une loupe dans l'en-tête du menu, ou `/`,
 *   ouvre une palette ; Échap la referme. La variante sœur `page-gauche-sans-recherche`
 *   n'en a aucune, pour comparer ;
 * - des réglages à plat (`flat.tsx`) : la mention « lecture seule » une fois par
 *   catégorie, en tête.
 *
 * Itération suivante (Tim : « un peu trop flat », « le bord bleu de la section active ne
 * se voit pas », « un slash à côté de la loupe ») :
 * - chaque groupe dans **une seule surface légère**, son titre au-dessus, hors d'elle ; les
 *   rangées séparées de filets à l'intérieur. Jamais deux niveaux de surface ;
 * - un en-tête de catégorie plus affirmé, et une séparation nette entre catégories ;
 * - dans le menu, la catégorie lue en pilule teintée, la sous-catégorie lue en accent avec
 *   un trait épais ; la loupe seule, le raccourci `/` dit par l'infobulle ;
 * - des proportions resserrées : libellé sur 22 rem, contrôle à côté, plafonné.
 */
import { Search, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ProjectDto } from '@solera/protocol'
import { Button, cx } from '@solera/ui'
import { ItemTitle, groupsOf, isChanged, searchItems, useCategories, useSettingsModel, type CategoryKey, type SettingItem, type SettingsModel } from './model'
import { OwnerNotice } from './parts'
import { ReadOnlyNote, useFlatItems } from './flat'

const groupAnchor = (category: CategoryKey, index: number) => `grp-${category}-${index}`
const itemAnchor = (id: string) => `reglage-${id}`

interface NavCategory {
  key: CategoryKey
  label: string
  hint: string
  groups: { anchor: string; name: string; items: SettingItem[] }[]
}

export function PageLeftFlatVariant({ project, search = true }: { project: ProjectDto; search?: boolean }) {
  const model = useSettingsModel(project)
  const { items, agentChanges, resetAgent } = useFlatItems(model)
  const categories = useCategories()

  const nav: NavCategory[] = useMemo(
    () =>
      categories
        .map((category) => ({
          key: category.key,
          label: category.label,
          hint: category.hint,
          groups: groupsOf(items, category.key).map((group, index) => ({ anchor: groupAnchor(category.key, index), name: group.name, items: group.items })),
        }))
        .filter((category) => category.groups.length > 0),
    [categories, items],
  )
  const work = nav.filter((category) => category.key !== 'danger')
  const danger = nav.find((category) => category.key === 'danger')

  /* ------------------------------------------------ suivre la lecture */
  const scroller = useRef<HTMLDivElement>(null)
  const anchors = nav.flatMap((category) => category.groups.map((group) => group.anchor))
  const anchorsKey = anchors.join(',')
  const [active, setActive] = useState<string | null>(anchors[0] ?? null)
  /* Un clic dans le menu fixe l'élément cliqué jusqu'au prochain défilement à la main :
     le défilement doux qu'il déclenche ne doit pas rallumer, en passant, ce qu'il survole. */
  const pinned = useRef(false)

  useEffect(() => {
    const root = scroller.current
    if (!root) return
    const keys = anchorsKey ? anchorsKey.split(',') : []
    const onScroll = () => {
      if (pinned.current) return
      const rect = root.getBoundingClientRect()
      const line = rect.top + 96
      let current: string | null = null
      for (const key of keys) {
        const element = root.querySelector<HTMLElement>(`#${key}`)
        if (element && element.getBoundingClientRect().top <= line) current = key
      }
      /* En bas, la ligne de déclenchement n'est plus atteignable : la dernière
         sous-catégorie dont le titre est à l'écran l'emporte. */
      if (root.scrollTop + root.clientHeight >= root.scrollHeight - 2) {
        const visible = keys.filter((key) => {
          const top = root.querySelector<HTMLElement>(`#${key}`)?.getBoundingClientRect().top
          return top !== undefined && top >= rect.top && top < rect.bottom
        })
        if (visible.length) current = visible[visible.length - 1]!
      }
      setActive(current ?? keys[0] ?? null)
    }
    const release = () => {
      if (!pinned.current) return
      pinned.current = false
      onScroll()
    }
    const onKey = (event: KeyboardEvent) => {
      if (['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', ' '].includes(event.key)) release()
    }
    onScroll()
    root.addEventListener('scroll', onScroll, { passive: true })
    root.addEventListener('wheel', release, { passive: true })
    root.addEventListener('touchmove', release, { passive: true })
    root.addEventListener('pointerdown', release)
    window.addEventListener('keydown', onKey)
    return () => {
      root.removeEventListener('scroll', onScroll)
      root.removeEventListener('wheel', release)
      root.removeEventListener('touchmove', release)
      root.removeEventListener('pointerdown', release)
      window.removeEventListener('keydown', onKey)
    }
  }, [anchorsKey])

  /* Une catégorie se lit par sa première sous-catégorie : cliquer « Agents » allume
     « Agents › Ce que les agents savent », jamais la catégorie seule. */
  const firstAnchorOf = (key: CategoryKey) => nav.find((category) => category.key === key)?.groups[0]?.anchor ?? null
  const scrollTo = (id: string, anchor: string | null = id) => {
    pinned.current = true
    if (anchor) setActive(anchor)
    scroller.current?.querySelector(`#${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  const activeCategory = nav.find((category) => category.groups.some((group) => group.anchor === active))?.key

  /* ------------------------------------------------ recherche à la demande */
  const [searching, setSearching] = useState(false)
  const [highlight, setHighlight] = useState<string | null>(null)
  useEffect(() => {
    if (!search) return
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (event.key === '/' && !target?.closest('input, textarea, select, [contenteditable="true"]')) {
        event.preventDefault()
        setSearching(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [search])
  useEffect(() => {
    if (!highlight) return
    const timer = window.setTimeout(() => setHighlight(null), 1800)
    return () => window.clearTimeout(timer)
  }, [highlight])

  const pickResult = (item: SettingItem) => {
    setSearching(false)
    setHighlight(item.id)
    window.setTimeout(() => scroller.current?.querySelector(`#${itemAnchor(item.id)}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 0)
  }

  const changedIn = (category: NavCategory) => category.groups.some((group) => group.items.some((item) => isChanged(model, item)))

  return (
    <div className="flex h-full min-h-0 flex-col md:flex-row">
      {/* ---------------------------------------------- menu, au large */}
      <aside aria-label="Réglages" className="hidden w-64 shrink-0 flex-col border-r border-line md:flex">
        <div className="flex h-16 shrink-0 items-center justify-between pr-3 pl-6">
          <span className="text-xs font-medium tracking-wide text-ink-faint uppercase">Réglages</span>
          {search ? (
            <button
              type="button"
              onClick={() => setSearching(true)}
              title="Rechercher un réglage (touche /)"
              aria-label="Rechercher un réglage"
              className="grid size-8 place-items-center rounded-md text-ink-faint transition-colors hover:bg-surface-high hover:text-ink"
            >
              <Search size={15} />
            </button>
          ) : null}
        </div>
        <nav className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3.5 pb-4">
          <div className="flex flex-col gap-4">
            {work.map((category) => (
              <MenuCategory key={category.key} category={category} lit={category.key === activeCategory} active={active} changed={changedIn(category)} onCategory={() => scrollTo(`cat-${category.key}`, firstAnchorOf(category.key))} onGroup={scrollTo} />
            ))}
          </div>
          {danger ? (
            <div className="mt-auto border-t border-line pt-3">
              <MenuCategory category={danger} lit={danger.key === activeCategory} active={active} changed={false} onCategory={() => scrollTo(`cat-${danger.key}`, firstAnchorOf(danger.key))} onGroup={scrollTo} hideGroups />
            </div>
          ) : null}
        </nav>
      </aside>

      {/* ---------------------------------------------- menu, au téléphone */}
      <div className="flex shrink-0 items-center gap-2 border-b border-line px-4 py-2.5 md:hidden">
        <select
          aria-label="Aller à"
          value={active ?? ''}
          onChange={(event) => scrollTo(event.target.value)}
          className="h-10 min-w-0 flex-1 rounded-lg border border-line bg-canvas px-3 text-sm"
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
        {search ? (
          <button type="button" aria-label="Chercher un réglage" onClick={() => setSearching(true)} className="grid size-10 place-items-center rounded-lg border border-line text-ink-faint">
            <Search size={16} />
          </button>
        ) : null}
      </div>

      {/* ---------------------------------------------- contenu */}
      <div ref={scroller} className="min-h-0 min-w-0 flex-1 overflow-y-auto">
        <main className="flex max-w-[72rem] flex-col px-4 pt-4 pb-[60vh] md:px-6 md:pt-0">
          <OwnerNotice project={project} />
          {nav.map((category, position) => (
            <section
              key={category.key}
              id={`cat-${category.key}`}
              className={cx('flex scroll-mt-0 flex-col', position > 0 && 'mt-16 border-t border-line pt-10')}
            >
              {/* La première est alignée sur l'en-tête du menu ; les suivantes s'ouvrent sur un
                  filet pleine largeur et un grand blanc, pour qu'on sache qu'on a changé de catégorie. */}
              <header className={cx('flex flex-wrap gap-x-3 gap-y-1', position === 0 ? 'min-h-16 items-center' : 'items-baseline')}>
                <h2 className={cx('text-xl font-semibold tracking-tight', category.key === 'danger' && 'text-critical')}>{category.label}</h2>
                {category.groups.some((group) => group.items.some((item) => item.readOnly)) ? <span className="ml-auto"><ReadOnlyNote /></span> : null}
              </header>
              {category.groups.map((group) => (
                <FlatGroup key={group.anchor} id={group.anchor} name={group.name} items={group.items} model={model} highlight={highlight} />
              ))}
            </section>
          ))}
        </main>
      </div>

      <FlatSaveBar model={model} extra={agentChanges} onResetExtra={resetAgent} />
      {searching ? <SearchPalette items={items} nav={nav} onPick={pickResult} onClose={() => setSearching(false)} /> : null}
    </div>
  )
}

/* ------------------------------------------------------------------ menu */

function MenuCategory({
  category,
  lit,
  active,
  changed,
  onCategory,
  onGroup,
  hideGroups = false,
}: {
  category: NavCategory
  lit: boolean
  active: string | null
  changed: boolean
  onCategory: () => void
  onGroup: (anchor: string) => void
  hideGroups?: boolean
}) {
  const danger = category.key === 'danger'
  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={onCategory}
        className={cx(
          'flex h-9 items-center gap-2 rounded-lg px-2.5 text-left text-sm transition-colors',
          lit
            ? danger
              ? 'bg-critical/10 font-semibold text-critical'
              : 'bg-accent-wash/60 font-semibold text-ink'
            : danger
              ? 'text-critical/80 hover:bg-critical/5 hover:text-critical'
              : 'text-ink-soft hover:bg-surface-high hover:text-ink',
        )}
      >
        <span className="min-w-0 flex-1 truncate">{category.label}</span>
        {changed ? <span title="Modifications en attente" className="size-1.5 shrink-0 rounded-full bg-accent" /> : null}
      </button>
      {hideGroups
        ? null
        : <div className="flex flex-col">{category.groups.map((group) => {
            const here = group.anchor === active
            return (
              <button
                key={group.anchor}
                type="button"
                onClick={() => onGroup(group.anchor)}
                className={cx(
                  'relative ml-3 flex h-7 items-center border-l-2 pr-2 pl-3 text-left text-[13px] transition-colors',
                  here ? 'border-accent font-medium text-accent' : 'border-line text-ink-faint hover:border-line-strong hover:text-ink-soft',
                )}
              >
                <span className="truncate">{group.name}</span>
              </button>
            )
          })}</div>}
    </div>
  )
}

/* ------------------------------------------------------------------ rangées à plat */

function FlatGroup({ id, name, items, model, highlight }: { id: string; name: string; items: SettingItem[]; model: SettingsModel; highlight: string | null }) {
  return (
    <section id={id} className="flex scroll-mt-6 flex-col pt-8">
      <h3 className="pb-2.5 pl-1 text-sm font-semibold text-ink-soft">{name}</h3>
      {/* Une seule surface par groupe, légère : c'est elle qui tient les rangées ensemble.
          Rien à l'intérieur n'a de surface à soi, seulement des filets. */}
      <div className="flex flex-col divide-y divide-line/70 rounded-xl border border-line/60 bg-surface/50 px-5">
        {items.map((item) => (
          <FlatRow key={item.id} item={item} model={model} highlighted={highlight === item.id} />
        ))}
      </div>
    </section>
  )
}

function FlatRow({ item, model, highlighted }: { item: SettingItem; model: SettingsModel; highlighted: boolean }) {
  const shell = cx('scroll-mt-24 -mx-5 px-5 py-4 transition-colors duration-500 first:rounded-t-xl last:rounded-b-xl', highlighted && 'bg-accent-wash/50')
  const label = (
    <div className="flex min-w-0 flex-col gap-0.5">
      <ItemTitle model={model} item={item} />
      {item.help ? <p className="text-xs leading-relaxed text-ink-faint">{item.help}</p> : null}
    </div>
  )
  if (item.kind === 'block') {
    return (
      <div id={itemAnchor(item.id)} className={cx(shell, 'flex flex-col gap-3')}>
        {label}
        {item.render()}
      </div>
    )
  }
  return (
    <div id={itemAnchor(item.id)} className={cx(shell, 'grid gap-x-10 gap-y-2 md:grid-cols-[22rem_minmax(0,36rem)] md:items-start')}>
      {label}
      <div className="min-w-0 md:pt-0.5">{item.render()}</div>
    </div>
  )
}

/* ------------------------------------------------------------------ barre du bas */

function FlatSaveBar({ model, extra, onResetExtra }: { model: SettingsModel; extra: number; onResetExtra: () => void }) {
  const count = model.changed.length + extra
  if (count === 0 && !model.notice) return null
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-24 z-20 flex justify-center px-4">
      {count > 0 ? (
        <div className="pointer-events-auto flex items-center gap-3 rounded-xl border border-line bg-surface px-4 py-2.5 shadow-lg">
          <span className="text-sm">
            <span className="font-medium">{count} modification{count > 1 ? 's' : ''}</span> <span className="text-ink-faint">non enregistrée{count > 1 ? 's' : ''}</span>
          </span>
          <Button size="sm" variant="ghost" onClick={() => { model.reset(); onResetExtra() }}>Annuler</Button>
          <Button size="sm" onClick={() => { model.save(); onResetExtra() }}>Enregistrer</Button>
        </div>
      ) : (
        <div className="pointer-events-auto rounded-xl border border-line bg-surface px-4 py-2.5 text-sm text-ink-soft shadow-lg">{model.notice}</div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ palette */

function SearchPalette({ items, nav, onPick, onClose }: { items: SettingItem[]; nav: NavCategory[]; onPick: (item: SettingItem) => void; onClose: () => void }) {
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const results = query.trim() ? searchItems(items, query).slice(0, 10) : []
  const labelOf = (key: CategoryKey) => nav.find((category) => category.key === key)?.label ?? key

  useEffect(() => setIndex(0), [query])

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center bg-black/30 px-4 pt-[12vh]" onMouseDown={onClose}>
      <div className="w-full max-w-lg overflow-hidden rounded-xl border border-line bg-surface shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
        <label className="flex h-12 items-center gap-2.5 border-b border-line px-4">
          <Search size={16} className="shrink-0 text-ink-faint" />
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') onClose()
              if (event.key === 'ArrowDown') { event.preventDefault(); setIndex((value) => Math.min(value + 1, results.length - 1)) }
              if (event.key === 'ArrowUp') { event.preventDefault(); setIndex((value) => Math.max(value - 1, 0)) }
              if (event.key === 'Enter' && results[index]) onPick(results[index]!)
            }}
            placeholder="Chercher un réglage : couleur, confin, modèle…"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-ink-faint"
          />
          <button type="button" aria-label="Fermer" onClick={onClose} className="text-ink-faint hover:text-ink"><X size={15} /></button>
        </label>
        {query.trim() ? (
          results.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-ink-faint">Aucun réglage pour « {query} ».</p>
          ) : (
            <ul className="max-h-80 overflow-y-auto py-1">
              {results.map((item, position) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onMouseEnter={() => setIndex(position)}
                    onClick={() => onPick(item)}
                    className={cx('flex w-full items-baseline gap-2 px-4 py-2 text-left', position === index && 'bg-surface-high')}
                  >
                    <span className="text-sm">{item.label}</span>
                    <span className="truncate text-xs text-ink-faint">{labelOf(item.category)} › {item.group}</span>
                  </button>
                </li>
              ))}
            </ul>
          )
        ) : (
          <p className="px-4 py-3 text-xs text-ink-faint">↑↓ pour choisir, Entrée pour y aller, Échap pour fermer.</p>
        )}
      </div>
    </div>
  )
}
