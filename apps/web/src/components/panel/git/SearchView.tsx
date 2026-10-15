import { Check, Plus, Search, X } from 'lucide-react'
import { useState } from 'react'
import { useTranslate } from '../../../lib/i18n'
import { decodeScope, type WorkspaceScope } from '../../../lib/workspace-scope'
import { cx } from '@solera/ui'
import { GraphView } from './GraphView'
import type { MenuContext } from './menus'
import type { GraphFilters } from './queries'

/**
 * La destination *Recherche* : le graphe, filtré.
 *
 * GitKraken filtre par message, auteur, fichier, branche et date ; on reprend les
 * cinq, et on ajoute les deux qui n'existent que chez nous — **par fil**, et
 * « écrit par un agent / écrit à la main ». La seconde se lit sur le `Co-Authored-By`
 * du message, qui est le seul endroit où l'agent est écrit.
 *
 * Les filtres ne s'empilent pas dans un panneau de réglages : ce sont des pastilles,
 * posées et retirées d'un clic, parce qu'une recherche se corrige plus souvent qu'elle
 * ne se compose.
 */

/** Les champs qu'on saisit, par opposition aux pastilles qui se cochent. */
const TYPED = ['author', 'file', 'branch'] as const
type Typed = (typeof TYPED)[number]

export function SearchView({
  scope,
  filters,
  onFilters,
  limit,
  onMore,
  selected,
  onSelect,
  menus,
  onOpenThread,
}: {
  scope: WorkspaceScope
  /**
   * Les filtres vivent au-dessus : ouvrir un commit depuis la recherche démonte cette
   * vue, et une frappe perdue au retour est la pire façon de répondre à un clic.
   */
  filters: GraphFilters
  onFilters: (next: GraphFilters) => void
  limit: number
  onMore: () => void
  selected: string | null
  onSelect: (hash: string) => void
  menus: MenuContext
  onOpenThread: (id: string) => void
}) {
  const t = useTranslate()
  const [open, setOpen] = useState<Typed[]>([])
  const here = decodeScope(scope)

  const set = (patch: GraphFilters): void => onFilters({ ...filters, ...patch })

  const chip = (label: string, on: boolean, onClick: () => void) => (
    <button
      key={label}
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={cx(
        'flex items-center gap-1 rounded-full px-2 py-0.5 text-micro font-medium',
        on ? 'bg-accent-wash text-accent' : 'bg-surface-high text-ink-faint hover:text-ink',
      )}
    >
      {on ? <Check size={9} /> : <Plus size={9} />}
      {label}
    </button>
  )

  return (
    <GraphView
      scope={scope}
      filters={filters}
      limit={limit}
      onMore={onMore}
      selected={selected}
      onSelect={onSelect}
      menus={menus}
      onOpenThread={onOpenThread}
      header={(count) => (
        <div className="px-2.5 pt-1 pb-2">
          <div className="flex items-center gap-2 rounded-md border border-line bg-surface-high/50 px-2 py-1.5">
            <Search size={13} className="shrink-0 text-ink-faint" />
            <input
              type="search"
              value={filters.q ?? ''}
              onChange={(event) => set({ q: event.target.value })}
              placeholder={t('git.search.placeholder')}
              className="min-w-0 flex-1 bg-transparent text-xs text-ink outline-none placeholder:text-ink-faint"
            />
            <span className="shrink-0 text-micro text-ink-faint tabular-nums">
              {t(count > 1 ? 'git.search.count' : 'git.search.countOne', { count })}
            </span>
          </div>

          <div className="mt-1.5 flex flex-wrap items-center gap-1">
            {TYPED.map((field) =>
              chip(
                filters[field] ? `${t(`git.search.${field}`)} : ${filters[field]}` : t(`git.search.${field}`),
                Boolean(filters[field]),
                () => {
                  if (filters[field]) set({ [field]: undefined })
                  setOpen((current) =>
                    current.includes(field) ? current.filter((value) => value !== field) : [...current, field],
                  )
                },
              ),
            )}
            {/* `7 days ago` est une date au sens de git, qui la comprend telle quelle. */}
            {chip(t('git.search.week'), Boolean(filters.since), () =>
              set({ since: filters.since ? undefined : '7 days ago' }),
            )}
            {chip(t('git.search.byHand'), filters.hand === 'human', () =>
              set({ hand: filters.hand === 'human' ? undefined : 'human' }),
            )}
            {chip(t('git.search.byAgent'), filters.hand === 'agent', () =>
              set({ hand: filters.hand === 'agent' ? undefined : 'agent' }),
            )}
            {/* Le filtre que GitKraken ne peut pas avoir : les commits de ce fil-ci. */}
            {here.kind === 'conversation'
              ? chip(t('git.search.thisThread'), Boolean(filters.thread), () =>
                  set({ thread: filters.thread ? undefined : here.id }),
                )
              : null}
          </div>

          {open.map((field) => (
            <div key={field} className="mt-1.5 flex items-center gap-1.5">
              <span className="shrink-0 text-micro text-ink-faint">{t(`git.search.${field}`)}</span>
              <input
                autoFocus
                value={filters[field] ?? ''}
                onChange={(event) => set({ [field]: event.target.value })}
                className="min-w-0 flex-1 rounded border border-line bg-surface-high/50 px-1.5 py-0.5 text-xs text-ink outline-none"
              />
              <button
                type="button"
                aria-label={t('git.search.remove')}
                onClick={() => {
                  set({ [field]: undefined })
                  setOpen((current) => current.filter((value) => value !== field))
                }}
                className="shrink-0 text-ink-faint hover:text-ink"
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
    />
  )
}
