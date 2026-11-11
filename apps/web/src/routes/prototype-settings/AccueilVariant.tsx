/* PROTOTYPE — jetable (branche proto/page-projet). Ne pas fusionner dans main.
 *
 * `accueil` : une page d'accueil des réglages en tuiles de catégories, chacune avec
 * l'état de ce qu'elle règle (« Privé · cyan · hôte confiné », « 7 actions · 1 à
 * relire »…). Un clic ouvre la catégorie en rangées ; la recherche, en tête, trouve un
 * réglage dans toutes à la fois et y mène.
 */
import { ArrowLeft, ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { ProjectDto } from '@solera/protocol'
import { cx } from '@solera/ui'
import {
  CATEGORIES,
  CATEGORY_ICON_TINT,
  SaveBar,
  groupsOf,
  searchItems,
  useCategories,
  useCategoryParam,
  useCategorySummaries,
  useSettingItems,
  useSettingsModel,
  type CategoryKey,
} from './model'
import { NoResult, OwnerNotice, RowGroup, SearchBox } from './parts'

const FOCUS_PARAM = 'reglage'

export function AccueilVariant({ project }: { project: ProjectDto }) {
  const model = useSettingsModel(project)
  const items = useSettingItems(model)
  const categories = useCategories()
  const summaries = useCategorySummaries(model)
  const [current, pick] = useCategoryParam(null)
  const [params, setParams] = useSearchParams()
  const [query, setQuery] = useState('')
  const focus = params.get(FOCUS_PARAM)

  const open = (key: CategoryKey, itemId?: string) => {
    setQuery('')
    setParams((previous) => {
      previous.set('section', key)
      if (itemId) previous.set(FOCUS_PARAM, itemId)
      else previous.delete(FOCUS_PARAM)
      return previous
    }, { replace: true })
  }

  if (current) {
    const category = CATEGORIES.find((entry) => entry.key === current)!
    return (
      <div className="h-full overflow-y-auto">
        <div className="flex flex-col gap-6 p-4 pb-40 md:p-6 md:pb-40">
          <header className="flex flex-col gap-3">
            <button type="button" onClick={() => pick(null)} className="inline-flex w-fit items-center gap-1.5 text-sm text-ink-faint hover:text-ink">
              <ArrowLeft size={14} /> Tous les réglages
            </button>
            <div className="flex items-center gap-3">
              <span className={cx('grid size-9 place-items-center rounded-lg bg-surface-high', CATEGORY_ICON_TINT[category.key])}>{category.icon(18)}</span>
              <div className="flex flex-col">
                <h1 className="text-lg font-semibold tracking-tight">{category.label}</h1>
                <p className="text-sm text-ink-faint">{category.hint}</p>
              </div>
            </div>
          </header>
          <OwnerNotice project={project} />
          {groupsOf(items, category.key).map((group) => (
            <RowGroup key={group.name} model={model} name={group.name} items={group.items} highlight={focus} />
          ))}
        </div>
        <SaveBar model={model} />
      </div>
    )
  }

  const results = query.trim() ? searchItems(items, query) : null

  return (
    <div className="h-full overflow-y-auto">
      <div className="flex flex-col gap-6 p-4 pb-40 md:p-6 md:pb-40">
        <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-col">
            <h1 className="text-lg font-semibold tracking-tight">Réglages de {project.name}</h1>
            <p className="text-sm text-ink-faint">Ce qui est réglé, d'un coup d'œil. Un clic pour changer.</p>
          </div>
          <SearchBox value={query} onChange={setQuery} className="md:w-96" />
        </header>
        <OwnerNotice project={project} />

        {results ? (
          results.length === 0 ? (
            <NoResult query={query} />
          ) : (
            <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line">
              {results.map((item) => {
                const category = CATEGORIES.find((entry) => entry.key === item.category)!
                return (
                  <li key={item.id}>
                    <button type="button" onClick={() => open(item.category, item.id)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface-high">
                      <span className={cx('shrink-0', CATEGORY_ICON_TINT[item.category])}>{category.icon(16)}</span>
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="text-sm">
                          <span className="text-ink-faint">{category.label} › {item.group} › </span>
                          <span className="font-medium">{item.label}</span>
                        </span>
                        {item.help ? <span className="truncate text-xs text-ink-faint">{item.help}</span> : null}
                      </span>
                      <ChevronRight size={15} className="shrink-0 text-ink-faint" />
                    </button>
                  </li>
                )
              })}
            </ul>
          )
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {categories.map((category) => {
              const count = items.filter((item) => item.category === category.key).length
              return (
                <button
                  key={category.key}
                  type="button"
                  onClick={() => open(category.key)}
                  className={cx(
                    'group flex min-h-40 flex-col gap-3 rounded-xl border border-line p-5 text-left transition-colors hover:border-line-strong hover:bg-surface/60',
                    category.key === 'danger' && 'border-critical/30',
                  )}
                >
                  <span className="flex items-center gap-3">
                    <span className={cx('grid size-9 place-items-center rounded-lg bg-surface-high', CATEGORY_ICON_TINT[category.key])}>{category.icon(18)}</span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="text-sm font-semibold">{category.label}</span>
                      <span className="truncate text-xs text-ink-faint">{category.hint}</span>
                    </span>
                    <ChevronRight size={16} className="shrink-0 text-ink-faint transition-transform group-hover:translate-x-0.5" />
                  </span>
                  <ul className="flex flex-col gap-1 border-t border-line pt-3">
                    {summaries[category.key].map((line) => (
                      <li key={line} className="truncate text-sm text-ink-soft">{line}</li>
                    ))}
                  </ul>
                  <span className="mt-auto text-xs text-ink-faint">{count} réglage{count > 1 ? 's' : ''}</span>
                </button>
              )
            })}
          </div>
        )}
      </div>
      <SaveBar model={model} />
    </div>
  )
}
