import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslate } from '../../lib/i18n'
import type { WorkspaceScope } from '../../lib/workspace-scope'
import { GitActionsProvider, useGitActions } from './git/actions'
import { ErrorBanner, LockBanner, UndoBanner } from './git/banners'
import { BranchesView } from './git/BranchesView'
import { CommitDetail } from './git/CommitDetail'
import { GraphView } from './git/GraphView'
import { Rail, type Destination } from './git/rail'
import { SearchView } from './git/SearchView'
import { StashesView } from './git/StashesView'
import { Toolbar } from './git/toolbar'
import { WorkingView } from './git/WorkingView'
import type { MenuContext } from './git/menus'
import {
  GRAPH_PAGE,
  useGitState,
  useGraph,
  useRefs,
  useStashes,
  type GraphFilters,
} from './git/queries'

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
 * Le lot 1 posait la lecture ; **ce lot-ci écrit** : indexer, commiter, pousser,
 * basculer, remiser, fusionner, rebaser, réinitialiser. Deux règles traversent tout :
 *
 * - **un seul écrivain à la fois** — pendant qu'un agent travaille dans ce répertoire,
 *   les gestes s'éteignent et un bandeau dit quoi attendre, la lecture continuant de
 *   se rafraîchir (`tour-1/clair/04`). Le refus, lui, est dans la route ;
 * - **ce qui ne s'annule pas demande avant** — et nomme exactement ce qui sera perdu
 *   (`tour-3/clair/14`). Le reste s'annule, et le bandeau dit quoi et où ça ramène.
 *
 * Restent au lot 3 : l'indexation par bloc et par ligne, le rebase interactif, les
 * conflits, l'historique d'un fichier et le blâme.
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
  const navigate = useNavigate()
  const client = useQueryClient()
  const [destination, setDestination] = useState<Destination>('graph')
  const [limit, setLimit] = useState(GRAPH_PAGE)
  /** Hash ouvert dans le graphe. `''` est le nœud « en cours », qui n'est pas un commit. */
  const [selected, setSelected] = useState<string | null>(null)
  const [filters, setFilters] = useState<GraphFilters>({})
  /** Un tour vient de finir : *En cours* propose la relecture au lieu de l'imposer. */
  const [pendingReview, setPendingReview] = useState(false)

  const state = useGitState(scope)
  const graph = useGraph(scope, {}, limit)
  // Lus dès l'ouverture et pas seulement sur leur destination : c'est d'eux que le
  // rail tire ses compteurs, et un compteur qui n'apparaît qu'une fois la destination
  // visitée ne sert à rien.
  const refs = useRefs(scope, true)
  const stashes = useStashes(scope, true)

  const refresh = (): void => {
    for (const key of ['git-graph', 'git-refs', 'git-state', 'git-stashes']) {
      void client.invalidateQueries({ queryKey: [key, scope] })
    }
  }

  // Un tour qui se termine a pu commiter : tout se relit — c'est de la lecture, elle
  // ne s'arrête jamais — mais *En cours* garde ce qu'il affichait jusqu'au clic sur
  // *Relire*. Le détail d'un commit, lui, ne bouge pas : il est immuable.
  const wasRunning = useRef(turnRunning)
  useEffect(() => {
    if (wasRunning.current && !turnRunning) {
      setPendingReview(true)
      refresh()
    }
    wasRunning.current = turnRunning
    // `refresh` tient à `client`, qui change à chaque rendu : la dépendance utile est
    // la fin du tour, et elle seule.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turnRunning])

  const openThread = (id: string): void => {
    if (projectId) navigate(`/p/${projectId}/c/${id}`)
  }

  const counts = {
    working: (state.data?.staged.length ?? 0) + (state.data?.unstaged.length ?? 0),
    branches: (refs.data?.sections ?? [])
      .filter((section) => section.kind === 'local' || section.kind === 'worktrees')
      .reduce((sum, section) => sum + section.lines.length, 0),
    stashes: stashes.data?.stashes.length ?? 0,
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

  const menus: MenuContext = {
    branch: state.data?.branch ?? null,
    locked: state.data?.lock !== null && state.data?.lock !== undefined,
    projectId,
    onOpenThread: openThread,
  }

  return (
    // `@container` : les colonnes du graphe et les libellés de la barre d'outils
    // suivent la largeur du **panneau**, pas celle de la fenêtre. Voir `GraphRows`.
    <GitActionsProvider scope={scope} lock={state.data?.lock ?? null}>
      <div className="@container flex h-full min-h-0 min-w-0 flex-col">
        <Toolbar
          state={state.data}
          stashes={counts.stashes}
          onRefresh={refresh}
          refreshing={graph.isFetching || state.isFetching}
        />

        <Banners state={state.data} onOpenThread={openThread} />

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
                menus={menus}
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
                menus={menus}
                onOpenThread={openThread}
              />
            ) : null}

            {destination === 'working' ? (
              <WorkingView
                scope={scope}
                pendingReview={pendingReview}
                onReviewed={() => setPendingReview(false)}
                onOpenFile={onOpenFile}
              />
            ) : null}

            {destination === 'branches' ? (
              <BranchesView scope={scope} menus={menus} onOpenThread={openThread} />
            ) : null}

            {destination === 'stashes' ? <StashesView scope={scope} /> : null}

            {destination === 'search' && !reading ? (
              <SearchView
                scope={scope}
                filters={filters}
                onFilters={setFilters}
                limit={limit}
                onMore={() => setLimit((value) => value + GRAPH_PAGE)}
                selected={null}
                onSelect={select}
                menus={menus}
                onOpenThread={openThread}
              />
            ) : null}

            {/* La dernière destination attend son lot : *Historique d'un fichier*
                avec le blâme par fil (lot 3). Elle est dans le rail dès maintenant
                parce qu'une destination qui apparaît un jour sans prévenir est pire
                qu'une destination vide. */}
            {destination === 'history' ? <Later /> : null}
          </div>
        </div>
      </div>
    </GitActionsProvider>
  )
}

function Later() {
  const t = useTranslate()
  return <p className="px-3 py-3 text-xs text-ink-faint">{t('git.history.later')}</p>
}

/**
 * Les bandeaux, qui lisent le contexte des gestes : ils vivent donc sous le
 * fournisseur, et non dans `GitPane` qui le pose.
 */
function Banners({
  state,
  onOpenThread,
}: {
  state: ReturnType<typeof useGitState>['data']
  onOpenThread: (id: string) => void
}) {
  const { error, clearError } = useGitActions()
  return (
    <>
      {state?.lock ? <LockBanner lock={state.lock} onOpenThread={onOpenThread} /> : null}
      {state?.undo && !state.lock ? <UndoBanner undo={state.undo} /> : null}
      {error ? <ErrorBanner message={error} onClose={clearError} /> : null}
    </>
  )
}
