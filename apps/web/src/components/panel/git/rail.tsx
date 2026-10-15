import { Archive, FilePen, GitBranch, GitMerge, History, Search } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useTranslate, type MessageKey } from '../../../lib/i18n'
import { cx } from '@solera/ui'

/**
 * Le rail des destinations, à gauche de l'onglet Git.
 *
 * Parti S2 du tour 2, retenu par Tim : un rail vertical plutôt qu'une barre segmentée.
 * Il coûte 44 px qui ne se négocient pas, et c'est le prix assumé — la planche T14 est
 * l'image sur laquelle il s'est confirmé.
 *
 * **Ne pas confondre avec la rangée d'onglets du panneau** (Fichiers · Recherche · Git
 * · Terminaux · Agent), qui est arrêtée par la carte #7 : le rail vit *à l'intérieur*
 * de l'onglet Git. Deux niveaux différents.
 *
 * *Conflits* manque encore : la planche T10 la veut conditionnelle, visible seulement
 * pendant un conflit, et la détection comme l'éditeur sont le lot 3.
 */
export type Destination = 'graph' | 'working' | 'branches' | 'stashes' | 'search' | 'history'

const DESTINATIONS: { id: Destination; icon: LucideIcon; label: MessageKey }[] = [
  { id: 'graph', icon: GitMerge, label: 'git.rail.graph' },
  { id: 'working', icon: FilePen, label: 'git.rail.working' },
  { id: 'branches', icon: GitBranch, label: 'git.rail.branches' },
  { id: 'stashes', icon: Archive, label: 'git.rail.stashes' },
  { id: 'search', icon: Search, label: 'git.rail.search' },
  { id: 'history', icon: History, label: 'git.rail.history' },
]

export function Rail({
  active,
  counts,
  onSelect,
}: {
  active: Destination
  /** Ce qui attend derrière une destination : fichiers sales, branches, remises. */
  counts: Partial<Record<Destination, number>>
  onSelect: (destination: Destination) => void
}) {
  const t = useTranslate()

  return (
    <div
      role="tablist"
      aria-orientation="vertical"
      aria-label={t('git.rail.label')}
      className="flex w-11 shrink-0 flex-col items-center gap-1 border-r border-line py-2"
    >
      {DESTINATIONS.map(({ id, icon: Icon, label }) => {
        const here = id === active
        const count = counts[id]
        return (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={here}
            title={t(label)}
            aria-label={t(label)}
            onClick={() => onSelect(id)}
            className={cx(
              'relative flex size-8 shrink-0 items-center justify-center rounded-md',
              here ? 'bg-accent-wash text-accent' : 'text-ink-faint hover:bg-surface-high hover:text-ink',
            )}
          >
            <Icon size={15} />
            {count ? (
              <span className="absolute right-0 -bottom-0.5 rounded-full bg-surface-high px-1 text-[0.5rem] font-semibold text-ink-soft tabular-nums">
                {count}
              </span>
            ) : null}
          </button>
        )
      })}
    </div>
  )
}
