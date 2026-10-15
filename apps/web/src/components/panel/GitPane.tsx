import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslate } from '../../lib/i18n'
import type { WorkspaceScope } from '../../lib/workspace-scope'
import { BranchesView } from './git/BranchesView'
import { CommitDetail } from './git/CommitDetail'
import { GraphView } from './git/GraphView'
import { Rail, type Destination } from './git/rail'
import { SearchView } from './git/SearchView'
import { Toolbar } from './git/toolbar'
import { WorkingView } from './git/WorkingView'
import { GRAPH_PAGE, useGraph, useRefs, useWorkingDiff, type GraphFilters } from './git/queries'

/**
 * La vue Git du panneau : un rail de destinations, une barre d'outils au-dessus, et
 * le dépôt partout ailleurs.
 *
 * Le dessin est arrêté par la carte #10 et daté dans `docs/audits/2026-10-15-git/` :
 * quatre tours de maquettes, dont le tour 3 pour la règle de rangement et le tour 4
 * pour l'échelle des colonnes. **Les planches sont la spécification**, pas une
 * inspiration — les notes sous chaque image disent pourquoi, ce qui évite de défaire
 * une décision en croyant l'améliorer.
 *
 * Ce lot-ci (lot 1 de la carte #29) est **en lecture seule** : le graphe, le commit
 * sélectionné, les branches et la recherche. Indexer, commiter, pousser, basculer,
 * remiser et rebaser sont le lot 2, et aucune route ne les sert encore.
 *
 * Ce que la vue dit, et que l'onglet *Agent* ne dit pas : l'état du disque, tous
 * auteurs confondus. « Ses écritures » raconte ce que l'agent a écrit dans ce fil
 * d'après le journal — deux questions différentes, et la frontière doit rester lisible.
 */
export function GitPane({
  scope,
  projectId,
  turnRunning,
  onOpenFile,
}: {
  scope: WorkspaceScope
  /** Pour ouvrir le fil qui a écrit un commit : une conversation vit sous son projet. */
  projectId: string | null
  turnRunning: boolean
  onOpenFile: (path: string) => void
}) {
  const t = useTranslate()
  const navigate = useNavigate()
  const client = useQueryClient()
  const [destination, setDestination] = useState<Destination>('graph')
  const [limit, setLimit] = useState(GRAPH_PAGE)
  /** Hash ouvert dans le graphe. `''` est le nœud « en cours », qui n'est pas un commit. */
  const [selected, setSelected] = useState<string | null>(null)
  const [filters, setFilters] = useState<GraphFilters>({})

  const working = useWorkingDiff(scope)
  const graph = useGraph(scope, {}, limit)
  // Lu dès l'ouverture et pas seulement sur sa destination : c'est de lui que le rail
  // tire son compteur, et un compteur qui n'apparaît qu'une fois la destination
  // visitée ne sert à rien.
  const refs = useRefs(scope, true)

  const refresh = (): void => {
    void client.invalidateQueries({ queryKey: ['git-graph', scope] })
    void client.invalidateQueries({ queryKey: ['git-refs', scope] })
    void working.refetch()
  }

  // Un tour qui se termine a pu commiter : tout se relit ensemble, et le détail d'un
  // commit non — il est immuable.
  const wasRunning = useRef(turnRunning)
  useEffect(() => {
    if (wasRunning.current && !turnRunning) refresh()
    wasRunning.current = turnRunning
    // `refresh` tient à `client` et `working`, qui changent à chaque rendu : la
    // dépendance utile est la fin du tour, et elle seule.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turnRunning])

  const openThread = (id: string): void => {
    if (projectId) navigate(`/p/${projectId}/c/${id}`)
  }

  const counts = {
    working: working.data?.files?.length ?? 0,
    branches: (refs.data?.sections ?? [])
      .filter((section) => section.kind === 'local' || section.kind === 'worktrees')
      .reduce((sum, section) => sum + section.lines.length, 0),
    stashes: (graph.data?.nodes ?? []).filter((node) => node.kind === 'stash').length,
  }

  const select = (hash: string): void => {
    // Le nœud « en cours » n'est pas un commit : le sélectionner mène à *En cours*,
    // qui est sa vue, plutôt qu'à un détail qui n'existerait pas.
    if (hash === '') {
      setDestination('working')
      return
    }
    setSelected(hash)
  }

  // Le détail d'un commit remplace la liste, dans les deux destinations qui en
  // ouvrent un : le panneau peut n'avoir que 20 rem, et un volet de plus y laisserait
  // deux colonnes illisibles.
  const reading = selected !== null && (destination === 'graph' || destination === 'search')

  return (
    // `@container` : les colonnes du graphe et les libellés de la barre d'outils
    // suivent la largeur du **panneau**, pas celle de la fenêtre. Voir `GraphRows`.
    <div className="@container flex h-full min-h-0 min-w-0 flex-col">
      <Toolbar onRefresh={refresh} refreshing={graph.isFetching || working.isFetching} />

      <div className="flex min-h-0 min-w-0 flex-1">
        <Rail
          active={destination}
          counts={counts}
          onSelect={(next) => {
            setDestination(next)
            setSelected(null)
          }}
        />

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {reading && selected !== null ? (
            <CommitDetail
              scope={scope}
              hash={selected}
              onBack={() => setSelected(null)}
              onOpenThread={openThread}
            />
          ) : null}

          {destination === 'graph' && !reading ? (
            <GraphView
              scope={scope}
              filters={{}}
              limit={limit}
              onMore={() => setLimit((value) => value + GRAPH_PAGE)}
              selected={null}
              onSelect={select}
              onOpenThread={openThread}
            />
          ) : null}

          {destination === 'working' ? <WorkingView query={working} onOpenFile={onOpenFile} /> : null}

          {destination === 'branches' ? (
            <BranchesView scope={scope} onOpenThread={openThread} />
          ) : null}

          {destination === 'search' && !reading ? (
            <SearchView
              scope={scope}
              filters={filters}
              onFilters={setFilters}
              limit={limit}
              onMore={() => setLimit((value) => value + GRAPH_PAGE)}
              selected={null}
              onSelect={select}
              onOpenThread={openThread}
            />
          ) : null}

          {/* Deux destinations du rail attendent leur lot : *Remises* avec l'aperçu et
              le dépilage (lot 2), *Historique d'un fichier* avec le blâme par fil
              (lot 3). Elles sont dans le rail dès maintenant parce qu'une destination
              qui apparaît un jour sans prévenir est pire qu'une destination vide. */}
          {destination === 'stashes' || destination === 'history' ? (
            <p className="px-3 py-3 text-xs text-ink-faint">
              {destination === 'stashes' ? t('git.stashes.later') : t('git.history.later')}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  )
}
