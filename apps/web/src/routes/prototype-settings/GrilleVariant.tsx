/* PROTOTYPE — jetable (branche proto/page-projet). Ne pas fusionner dans main.
 *
 * `grille` : les catégories en onglets horizontaux, et les réglages en grille de petites
 * cartes sur 2 à 3 colonnes selon la largeur. Les gros blocs (consignes, mémoire,
 * skills, actions) prennent toute la largeur.
 */
import type { ProjectDto } from '@solera/protocol'
import { cx, tabItemClass } from '@solera/ui'
import { CATEGORY_ICON_TINT, ItemTitle, SaveBar, groupsOf, useCategories, useCategoryParam, useSettingItems, useSettingsModel } from './model'
import { OwnerNotice } from './parts'

export function GrilleVariant({ project }: { project: ProjectDto }) {
  const model = useSettingsModel(project)
  const items = useSettingItems(model)
  const categories = useCategories()
  const [current, pick] = useCategoryParam('general')
  const groups = groupsOf(items, current ?? 'general')

  return (
    <div className="flex h-full min-h-0 flex-col">
      <nav aria-label="Catégories des réglages" className="flex shrink-0 gap-5 overflow-x-auto border-b border-line px-4 md:px-6">
        {categories.map((entry) => {
          const active = entry.key === current
          return (
            <button
              key={entry.key}
              type="button"
              aria-current={active ? 'page' : undefined}
              onClick={() => pick(entry.key)}
              className={cx(tabItemClass(active), 'shrink-0', entry.key === 'danger' && !active && 'text-critical/80')}
            >
              <span className={cx('shrink-0', active ? CATEGORY_ICON_TINT[entry.key] : 'text-ink-faint')}>{entry.icon(15)}</span>
              {entry.label}
            </button>
          )
        })}
      </nav>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex flex-col gap-6 p-4 pb-40 md:p-6 md:pb-40">
          <OwnerNotice project={project} />
          {groups.map((group) => (
            <section key={group.name} className="flex flex-col gap-3">
              <h3 className="text-xs font-medium tracking-wide text-ink-faint uppercase">{group.name}</h3>
              <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
                {group.items.map((item) => (
                  <article
                    key={item.id}
                    className={cx(
                      'flex min-w-0 flex-col gap-3 rounded-xl border border-line p-4',
                      item.span === 'full' && 'md:col-span-2 2xl:col-span-3',
                      item.category === 'danger' && 'border-critical/40 bg-critical/5',
                    )}
                  >
                    <div className="flex flex-col gap-1">
                      <ItemTitle model={model} item={item} />
                      {item.help ? <p className="text-xs leading-relaxed text-ink-faint">{item.help}</p> : null}
                    </div>
                    <div className="min-w-0">{item.render()}</div>
                  </article>
                ))}
              </div>
            </section>
          ))}
        </div>
        <SaveBar model={model} />
      </div>
    </div>
  )
}
