/* PROTOTYPE — jetable (branche proto/page-projet). Ne pas fusionner dans main.
 *
 * Le rendu sobre de `page`, avec le menu à gauche, catégories ET sous-catégories
 * toujours visibles. Deux façons de s'en servir, pour que Tim tranche :
 * - `page-gauche` : une seule page qui défile, le menu suit la lecture ;
 * - `section-gauche` : une catégorie à la fois à droite (`?section=`), le menu suit la
 *   lecture à l'intérieur de la catégorie.
 * Au téléphone, le menu devient un sélecteur « catégorie › sous-catégorie » en haut.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { ProjectDto } from '@solera/protocol'
import { cx } from '@solera/ui'
import {
  CATEGORY_ICON_TINT,
  SaveBar,
  groupsOf,
  searchItems,
  useCategories,
  useSettingItems,
  useSettingsModel,
  type CategoryKey,
  type SettingItem,
} from './model'
import { NoResult, OwnerNotice, RowGroup, SearchBox } from './parts'

type Mode = 'page' | 'section'

/** L'ancre d'une sous-catégorie : la catégorie et le rang du groupe, stables. */
const groupAnchor = (category: CategoryKey, index: number) => `grp-${category}-${index}`

interface NavGroup {
  anchor: string
  name: string
  items: SettingItem[]
}

interface NavCategory {
  key: CategoryKey
  label: string
  hint: string
  icon: (size: number) => React.ReactNode
  groups: NavGroup[]
}

export function PageLeftVariant({ project }: { project: ProjectDto }) {
  return <LeftNavVariant project={project} mode="page" />
}

export function SectionLeftVariant({ project }: { project: ProjectDto }) {
  return <LeftNavVariant project={project} mode="section" />
}

function LeftNavVariant({ project, mode }: { project: ProjectDto; mode: Mode }) {
  const model = useSettingsModel(project)
  const all = useSettingItems(model)
  const categories = useCategories()
  const [query, setQuery] = useState('')
  const [params, setParams] = useSearchParams()
  const items = searchItems(all, query)

  /* Le menu complet, filtré par la recherche : une catégorie sans réglage trouvé
     disparaît, et ses groupes avec. */
  const nav: NavCategory[] = useMemo(
    () =>
      categories
        .map((category) => ({
          ...category,
          groups: groupsOf(items, category.key).map((group, index) => ({
            anchor: groupAnchor(category.key, index),
            name: group.name,
            items: group.items,
          })),
        }))
        .filter((category) => category.groups.length > 0),
    [categories, items],
  )

  // En mode section : la catégorie de l'adresse, sinon la première qui a des réglages.
  const wanted = params.get('section') as CategoryKey | null
  const section: CategoryKey | null =
    mode === 'section' ? (nav.find((category) => category.key === wanted)?.key ?? nav[0]?.key ?? null) : null

  const openSection = (key: CategoryKey) =>
    setParams(
      (current) => {
        current.set('section', key)
        return current
      },
      { replace: true },
    )

  /* La recherche saute à la bonne catégorie : si celle qu'on lit n'a plus rien qui
     corresponde, on passe à la première qui a quelque chose. */
  useEffect(() => {
    if (mode !== 'section' || !query.trim() || nav.length === 0) return
    if (!nav.some((category) => category.key === wanted)) openSection(nav[0]!.key)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, query, nav.map((category) => category.key).join(',')])

  const shown = mode === 'page' ? nav : nav.filter((category) => category.key === section)

  /* ------------------------------------------------ suivre la lecture (scroll-spy) */
  const scroller = useRef<HTMLDivElement>(null)
  const anchors = shown.flatMap((category) => category.groups.map((group) => group.anchor))
  const anchorsKey = anchors.join(',')
  const [active, setActive] = useState<string | null>(anchors[0] ?? null)

  useEffect(() => {
    const root = scroller.current
    if (!root) return
    const keys = anchorsKey ? anchorsKey.split(',') : []
    const onScroll = () => {
      const top = root.getBoundingClientRect().top + 120
      let current: string | null = null
      for (const key of keys) {
        const element = root.querySelector<HTMLElement>(`#${key}`)
        if (element && element.getBoundingClientRect().top <= top) current = key
      }
      // Tout en bas, la dernière sous-catégorie est celle qu'on lit, même courte.
      if (root.scrollTop + root.clientHeight >= root.scrollHeight - 4) current = keys[keys.length - 1] ?? current
      setActive(current ?? keys[0] ?? null)
    }
    onScroll()
    root.addEventListener('scroll', onScroll, { passive: true })
    return () => root.removeEventListener('scroll', onScroll)
  }, [anchorsKey])

  /* Un clic sur une sous-catégorie d'une autre catégorie, en mode section : on ouvre
     d'abord la catégorie, puis on défile une fois qu'elle est rendue. */
  const [pending, setPending] = useState<string | null>(null)
  useEffect(() => {
    if (!pending) return
    const element = scroller.current?.querySelector(`#${pending}`)
    if (!element) return
    element.scrollIntoView({ behavior: 'smooth', block: 'start' })
    setPending(null)
  }, [pending, anchorsKey])

  const goToGroup = (category: CategoryKey, anchor: string) => {
    if (mode === 'section' && category !== section) {
      openSection(category)
      setPending(anchor)
      return
    }
    scroller.current?.querySelector(`#${anchor}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const goToCategory = (category: NavCategory) => {
    if (mode === 'section') {
      if (category.key !== section) openSection(category.key)
      scroller.current?.scrollTo({ top: 0, behavior: 'smooth' })
      return
    }
    scroller.current?.querySelector(`#cat-${category.key}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const activeCategory = nav.find((category) => category.groups.some((group) => group.anchor === active))?.key ?? section ?? nav[0]?.key

  return (
    <div className="flex h-full min-h-0 flex-col md:flex-row">
      {/* ---------------------------------------------- menu, au large */}
      <aside aria-label="Réglages" className="hidden w-64 shrink-0 flex-col border-r border-line md:flex">
        <div className="p-3">
          <SearchBox value={query} onChange={setQuery} />
        </div>
        <nav className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-2 pb-6">
          {nav.length === 0 ? <p className="px-2 text-sm text-ink-faint">Aucun réglage.</p> : null}
          {nav.map((category) => {
            const current = category.key === activeCategory
            return (
              <div key={category.key} className="flex flex-col">
                <button
                  type="button"
                  onClick={() => goToCategory(category)}
                  aria-current={mode === 'section' && category.key === section ? 'page' : undefined}
                  className={cx(
                    'flex h-9 items-center gap-2.5 rounded-md px-2 text-left text-sm transition-colors',
                    current ? 'font-medium text-ink' : 'text-ink-soft hover:bg-surface-high hover:text-ink',
                    mode === 'section' && category.key === section && 'bg-surface-high',
                  )}
                >
                  <span className={cx('shrink-0', current ? CATEGORY_ICON_TINT[category.key] : 'text-ink-faint')}>{category.icon(16)}</span>
                  <span className={cx('min-w-0 flex-1 truncate', category.key === 'danger' && 'text-critical')}>{category.label}</span>
                  {query.trim() ? (
                    <span className="text-xs tabular-nums text-ink-faint">{category.groups.reduce((sum, group) => sum + group.items.length, 0)}</span>
                  ) : null}
                </button>
                {/* Les sous-catégories, toujours visibles : plus discrètes, sous un filet. */}
                <div className="ml-[1.1rem] flex flex-col border-l border-line">
                  {category.groups.map((group) => {
                    const lit = group.anchor === active
                    return (
                      <button
                        key={group.anchor}
                        type="button"
                        onClick={() => goToGroup(category.key, group.anchor)}
                        className={cx(
                          '-ml-px flex h-7 items-center border-l-2 pl-3 text-left text-xs transition-colors',
                          lit ? 'border-accent text-ink' : 'border-transparent text-ink-faint hover:text-ink',
                        )}
                      >
                        <span className="truncate">{group.name}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </nav>
      </aside>

      {/* ---------------------------------------------- menu, au téléphone */}
      <div className="flex shrink-0 flex-col gap-2 border-b border-line px-4 py-3 md:hidden">
        <SearchBox value={query} onChange={setQuery} />
        <select
          aria-label="Aller à"
          value={active ?? ''}
          onChange={(event) => {
            const anchor = event.target.value
            const owner = nav.find((category) => category.groups.some((group) => group.anchor === anchor))
            if (owner) goToGroup(owner.key, anchor)
          }}
          className="h-10 rounded-lg border border-line bg-canvas px-3 text-sm"
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
      </div>

      {/* ---------------------------------------------- contenu */}
      <div ref={scroller} className="min-h-0 min-w-0 flex-1 overflow-y-auto">
        <main className="flex flex-col gap-10 p-4 pb-40 md:p-6 md:pb-40">
          <OwnerNotice project={project} />
          {nav.length === 0 ? <NoResult query={query} /> : null}
          {shown.map((category) => (
            <section key={category.key} id={`cat-${category.key}`} className="flex scroll-mt-6 flex-col gap-5">
              <header className="flex items-baseline gap-2.5">
                <span className={cx('self-center', CATEGORY_ICON_TINT[category.key])}>{category.icon(18)}</span>
                <h2 className="text-base font-semibold tracking-tight">{category.label}</h2>
                <span className="text-sm text-ink-faint">{category.hint}</span>
              </header>
              {category.groups.map((group) => (
                <div key={group.anchor} id={group.anchor} className="scroll-mt-6">
                  <RowGroup model={model} name={group.name} items={group.items} />
                </div>
              ))}
            </section>
          ))}
          {mode === 'section' && section ? <NextSection nav={nav} section={section} onOpen={(key) => { openSection(key); scroller.current?.scrollTo({ top: 0 }) }} /> : null}
        </main>
      </div>
      <SaveBar model={model} />
    </div>
  )
}

/** En mode section, le bas de page mène à la catégorie suivante plutôt qu'au vide. */
function NextSection({ nav, section, onOpen }: { nav: NavCategory[]; section: CategoryKey; onOpen: (key: CategoryKey) => void }) {
  const index = nav.findIndex((category) => category.key === section)
  const next = nav[index + 1]
  if (!next) return null
  return (
    <button
      type="button"
      onClick={() => onOpen(next.key)}
      className="flex items-center justify-between rounded-xl border border-line px-4 py-3 text-left text-sm transition-colors hover:border-line-strong"
    >
      <span className="text-ink-faint">Catégorie suivante</span>
      <span className="flex items-center gap-2 font-medium">
        <span className={CATEGORY_ICON_TINT[next.key]}>{next.icon(16)}</span>
        {next.label} →
      </span>
    </button>
  )
}
