import { Loader } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslate } from '../../../lib/i18n'
import type { WorkspaceScope } from '../../../lib/workspace-scope'
import { Banner } from '@solera/ui'
import { GraphHeader, GraphRow } from './GraphRows'
import type { MenuContext } from './menus'
import { GRAPH_PAGE, useGraph, type GraphFilters } from './queries'

/**
 * La liste du graphe, partagée par les destinations *Graphe* et *Recherche*.
 *
 * Une seule route les sert : chercher, c'est filtrer le graphe, pas afficher autre
 * chose. Les deux destinations ne diffèrent que par ce qui est posé au-dessus — rien,
 * ou le champ et ses filtres.
 */
export function GraphView({
  scope,
  filters,
  limit,
  onMore,
  selected,
  onSelect,
  menus,
  onOpenThread,
  header,
}: {
  scope: WorkspaceScope
  filters: GraphFilters
  limit: number
  onMore: () => void
  /** Hash du commit ouvert, `''` pour le nœud « en cours », null pour aucun. */
  selected: string | null
  onSelect: (hash: string) => void
  menus: MenuContext
  onOpenThread: (id: string) => void
  /** Ce que la destination pose au-dessus de la liste : le champ de recherche. */
  header?: (count: number) => ReactNode
}) {
  const t = useTranslate()
  const { data, error, isPending, isFetching } = useGraph(scope, filters, limit)
  const nodes = data?.nodes ?? []

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto pb-safe">
      {header?.(nodes.length)}

      {isPending ? (
        <p className="flex items-center gap-1.5 px-2.5 py-2 text-xs text-ink-faint">
          <Loader size={11} className="animate-spin" />
          {t('git.graph.loading')}
        </p>
      ) : null}

      {error ? (
        <div className="p-2">
          <Banner>{error instanceof Error ? error.message : t('git.graph.error')}</Banner>
        </div>
      ) : null}

      {data && data.nodes === null ? (
        <p className="px-2.5 py-2 text-xs text-ink-faint">{t('changes.diff.notGitRepo')}</p>
      ) : null}

      {data?.nodes?.length === 0 ? (
        <p className="px-2.5 py-2 text-xs text-ink-faint">
          {data.filtered ? t('git.search.empty') : t('git.graph.empty')}
        </p>
      ) : null}

      {nodes.length > 0 ? <GraphHeader lanes={data?.lanes ?? 1} /> : null}

      {nodes.map((node, index) => (
        <GraphRow
          key={node.hash || `working-${index}`}
          node={node}
          lanes={data?.lanes ?? 1}
          selected={selected === node.hash}
          onSelect={() => onSelect(node.hash)}
          menus={menus}
          onOpenThread={onOpenThread}
        />
      ))}

      {data?.hasMore ? (
        <button
          type="button"
          onClick={onMore}
          disabled={isFetching}
          className="w-full px-2.5 py-2 text-meta text-ink-faint underline hover:text-ink disabled:opacity-45"
        >
          {isFetching ? t('git.graph.loading') : t('git.graph.more', { count: GRAPH_PAGE })}
        </button>
      ) : null}
    </div>
  )
}
