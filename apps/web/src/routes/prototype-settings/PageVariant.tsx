/* PROTOTYPE — jetable (branche proto/page-projet). Ne pas fusionner dans main.
 *
 * `page` : une seule page qui défile avec toutes les catégories, un sommaire collant à
 * droite qui suit la lecture, et une recherche en haut qui filtre les réglages par mot.
 */
import { useEffect, useRef, useState } from 'react'
import type { ProjectDto } from '@solera/protocol'
import { cx } from '@solera/ui'
import { CATEGORY_ICON_TINT, SaveBar, groupsOf, searchItems, useCategories, useSettingItems, useSettingsModel, type CategoryKey } from './model'
import { NoResult, OwnerNotice, RowGroup, SearchBox } from './parts'

export function PageVariant({ project }: { project: ProjectDto }) {
  const model = useSettingsModel(project)
  const all = useSettingItems(model)
  const categories = useCategories()
  const [query, setQuery] = useState('')
  const items = searchItems(all, query)
  const shown = categories.filter((entry) => items.some((item) => item.category === entry.key))

  const shownKeys = shown.map((entry) => entry.key).join(',')
  const scroller = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState<CategoryKey | null>(shown[0]?.key ?? null)

  // Le sommaire suit la lecture : la catégorie dont le titre a passé le haut de la vue.
  useEffect(() => {
    const root = scroller.current
    if (!root) return
    const keys = (shownKeys ? shownKeys.split(',') : []) as CategoryKey[]
    const onScroll = () => {
      const top = root.getBoundingClientRect().top + 96
      let current: CategoryKey | null = null
      for (const key of keys) {
        const element = root.querySelector<HTMLElement>(`#cat-${key}`)
        if (element && element.getBoundingClientRect().top <= top) current = key
      }
      setVisible(current ?? keys[0] ?? null)
    }
    onScroll()
    root.addEventListener('scroll', onScroll, { passive: true })
    return () => root.removeEventListener('scroll', onScroll)
  }, [shownKeys])

  const jump = (key: CategoryKey) => {
    scroller.current?.querySelector(`#cat-${key}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div ref={scroller} className="h-full overflow-y-auto">
      {/* La recherche reste en haut : c'est la porte d'entrée d'une page longue. */}
      <div className="sticky top-0 z-10 border-b border-line bg-canvas/95 px-4 py-3 backdrop-blur md:px-6">
        <SearchBox value={query} onChange={setQuery} className="max-w-xl" />
      </div>

      <div className="flex gap-10 p-4 pb-40 md:p-6 md:pb-40">
        <main className="flex min-w-0 flex-1 flex-col gap-10">
          <OwnerNotice project={project} />
          {shown.length === 0 ? <NoResult query={query} /> : null}
          {shown.map((category) => (
            <section key={category.key} id={`cat-${category.key}`} className="flex scroll-mt-20 flex-col gap-4">
              <header className="flex items-center gap-2.5">
                <span className={CATEGORY_ICON_TINT[category.key]}>{category.icon(18)}</span>
                <h2 className="text-base font-semibold tracking-tight">{category.label}</h2>
                <span className="text-sm text-ink-faint">{category.hint}</span>
              </header>
              {groupsOf(items, category.key).map((group) => (
                <RowGroup key={group.name} model={model} name={group.name} items={group.items} />
              ))}
            </section>
          ))}
        </main>

        <aside aria-label="Sommaire" className="hidden w-52 shrink-0 lg:block">
          <nav className="sticky top-24 flex flex-col gap-0.5 border-l border-line">
            {shown.map((category) => {
              const active = category.key === visible
              return (
                <div key={category.key} className="flex flex-col">
                  <button
                    type="button"
                    onClick={() => jump(category.key)}
                    className={cx(
                      '-ml-px flex h-8 items-center gap-2 border-l-2 pl-3 text-left text-sm transition-colors',
                      active ? 'border-accent text-ink' : 'border-transparent text-ink-faint hover:text-ink',
                    )}
                  >
                    {category.label}
                  </button>
                  {active
                    ? groupsOf(items, category.key).map((group) => (
                        <button
                          key={group.name}
                          type="button"
                          onClick={() => scroller.current?.querySelector(`#reglage-${group.items[0]!.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
                          className="h-7 pl-6 text-left text-xs text-ink-faint hover:text-ink"
                        >
                          {group.name}
                        </button>
                      ))
                    : null}
                </div>
              )
            })}
          </nav>
        </aside>
      </div>
      <SaveBar model={model} />
    </div>
  )
}
