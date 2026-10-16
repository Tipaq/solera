import { AlertTriangle, Archive, FilePen, GitBranch, GitMerge, History, Search } from 'lucide-react'
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
 * **Conflits est la septième, et elle est conditionnelle** : la planche T10 la veut
 * visible seulement pendant un conflit, et invisible le reste du temps. Ce n'est pas
 * la même chose qu'une destination grisée — une destination qui ne sert à rien
 * aujourd'hui prend la place d'une qui sert, dans un rail de sept icônes sur 44 px.
 * Elle est en ambre, qui est la couleur de « il y a quelque chose à faire ici ».
 */
export type Destination =
  | 'graph'
  | 'working'
  | 'branches'
  | 'stashes'
  | 'search'
  | 'history'
  | 'conflicts'

const DESTINATIONS: { id: Destination; icon: LucideIcon; label: MessageKey }[] = [
  { id: 'graph', icon: GitMerge, label: 'git.rail.graph' },
  { id: 'working', icon: FilePen, label: 'git.rail.working' },
  { id: 'branches', icon: GitBranch, label: 'git.rail.branches' },
  { id: 'stashes', icon: Archive, label: 'git.rail.stashes' },
  { id: 'search', icon: Search, label: 'git.rail.search' },
  { id: 'history', icon: History, label: 'git.rail.history' },
]

const CONFLICTS: { id: Destination; icon: LucideIcon; label: MessageKey } = {
  id: 'conflicts',
  icon: AlertTriangle,
  label: 'git.rail.conflicts',
}

export function Rail({
  active,
  counts,
  conflicted,
  onSelect,
}: {
  active: Destination
  /** Ce qui attend derrière une destination : fichiers sales, branches, remises. */
  counts: Partial<Record<Destination, number>>
  /** Combien de fichiers en conflit : zéro fait disparaître la septième destination. */
  conflicted: number
  onSelect: (destination: Destination) => void
}) {
  const t = useTranslate()
  const destinations = conflicted > 0 ? [...DESTINATIONS, CONFLICTS] : DESTINATIONS

  return (
    <div
      role="tablist"
      aria-orientation="vertical"
      aria-label={t('git.rail.label')}
      className="flex w-11 shrink-0 flex-col items-center gap-1 border-r border-line py-2"
    >
      {destinations.map(({ id, icon: Icon, label }) => {
        const here = id === active
        const count = id === 'conflicts' ? conflicted : counts[id]
        const warn = id === 'conflicts'
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
              warn && here && 'bg-caution/15 text-caution',
              warn && !here && 'text-caution hover:bg-caution/10',
              !warn && here && 'bg-accent-wash text-accent',
              !warn && !here && 'text-ink-faint hover:bg-surface-high hover:text-ink',
            )}
          >
            <Icon size={15} />
            {count ? (
              <span
                className={cx(
                  'absolute right-0 -bottom-0.5 rounded-full px-1 text-[0.5rem] font-semibold tabular-nums',
                  warn ? 'bg-caution text-on-accent' : 'bg-surface-high text-ink-soft',
                )}
              >
                {count}
              </span>
            ) : null}
          </button>
        )
      })}
    </div>
  )
}
