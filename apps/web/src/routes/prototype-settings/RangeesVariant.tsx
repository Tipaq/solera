/* PROTOTYPE — jetable (branche proto/page-projet). Ne pas fusionner dans main.
 *
 * `rangees` : navigation à gauche, et les réglages en rangées façon macOS / GitHub —
 * le libellé et son explication à gauche, le contrôle à droite, sur toute la largeur.
 * Plus de carte par réglage ni de bouton par carte : une barre « N modifications non
 * enregistrées » collée en bas.
 */
import type { ProjectDto } from '@solera/protocol'
import { cx } from '@solera/ui'
import { CATEGORIES, CATEGORY_ICON_TINT, SaveBar, groupsOf, useCategories, useCategoryParam, useSettingItems, useSettingsModel } from './model'
import { OwnerNotice, RowGroup } from './parts'

export function RangeesVariant({ project }: { project: ProjectDto }) {
  const model = useSettingsModel(project)
  const items = useSettingItems(model)
  const categories = useCategories()
  const [current, pick] = useCategoryParam('general')
  const category = CATEGORIES.find((entry) => entry.key === current)!
  const changedIn = (key: string) => items.some((item) => item.category === key && (item.fields ?? []).some((field) => model.changed.includes(field)))

  return (
    <div className="h-full overflow-y-auto">
      <div className="flex flex-col gap-6 p-4 pb-40 md:flex-row md:gap-10 md:p-6 md:pb-40">
        <nav aria-label="Catégories des réglages" className="shrink-0 md:sticky md:top-6 md:w-48 md:self-start">
          <ul className="-mx-4 flex gap-1 overflow-x-auto border-b border-line px-4 md:mx-0 md:flex-col md:gap-0.5 md:border-0 md:px-0">
            {categories.map((entry) => {
              const active = entry.key === current
              return (
                <li key={entry.key} className="shrink-0">
                  <button
                    type="button"
                    aria-current={active ? 'page' : undefined}
                    onClick={() => pick(entry.key)}
                    className={cx(
                      'flex h-9 w-full items-center gap-2.5 px-3 text-left text-sm whitespace-nowrap transition-colors',
                      'border-b-2 md:rounded-lg md:border-b-0',
                      active ? 'border-accent text-ink md:bg-surface-high' : 'border-transparent text-ink-soft hover:text-ink md:hover:bg-surface-high/60',
                      entry.key === 'danger' && !active && 'md:text-critical/80',
                    )}
                  >
                    <span className={cx('shrink-0', active ? CATEGORY_ICON_TINT[entry.key] : 'text-ink-faint')}>{entry.icon(15)}</span>
                    <span className="flex-1">{entry.label}</span>
                    {changedIn(entry.key) ? <span className="size-1.5 rounded-full bg-accent" /> : null}
                  </button>
                </li>
              )
            })}
          </ul>
        </nav>

        <main className="flex min-w-0 flex-1 flex-col gap-6">
          <header className="flex flex-col gap-1">
            <h1 className="text-lg font-semibold tracking-tight">{category.label}</h1>
            <p className="text-sm text-ink-faint">{category.hint}</p>
          </header>
          <OwnerNotice project={project} />
          {groupsOf(items, category.key).map((group) => (
            <RowGroup key={group.name} model={model} name={group.name} items={group.items} />
          ))}
        </main>
      </div>
      <SaveBar model={model} />
    </div>
  )
}
