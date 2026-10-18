import { useEffect, useRef, useState, type RefObject } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { decodeScope, type WorkspaceScope } from '../../lib/workspace-scope'
import { GitActionsProvider, useGitActions } from './git/actions'
import { ErrorBanner, LockBanner, UndoBanner } from './git/banners'
import { BranchesView } from './git/BranchesView'
import { CommitDetail } from './git/CommitDetail'
import { ConflictsView } from './git/ConflictsView'
import { GraphView } from './git/GraphView'
import { HistoryView } from './git/HistoryView'
import { RebaseView } from './git/RebaseView'
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
 * Le lot 3 ajoute les quatre fonctions chères, et deux d'entre elles changent ce que
 * la vue entière a le droit de faire :
 *
 * - **le rebase interactif suspend les tours** tant qu'il court (planche T9). Le refus
 *   vit dans le gestionnaire de sessions ; ici on le dit, et on empêche d'ouvrir un
 *   second rebase par-dessus le premier ;
 * - **la destination *Conflits* n'existe que pendant un conflit** (T10), avec le
 *   bouton qui passe la main à l'agent en un clic.
 *
 * S'y ajoutent l'indexation par bloc et par ligne dans *En cours* (T3) et l'historique
 * d'un fichier avec son blâme par fil (T12).
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
  /** Le fichier dont on regarde l'historique, et l'onglet ouvert dessus (T12). */
  const [file, setFile] = useState<{ path: string; blame: boolean } | null>(null)
  /**
   * Le rebase interactif, quand il est ouvert : la valeur est le point de départ
   * désigné par le menu d'un commit, ou `null` pour l'amont.
   *
   * Un état plutôt qu'une destination du rail : la règle T0 range dans le rail les
   * listes qu'on vient consulter, et un rebase n'est pas une liste — c'est un geste
   * sur *ces* commits, qui part du menu de l'un d'eux ou de la branche courante.
   */
  const [rebasing, setRebasing] = useState<{ onto: string | null } | null>(null)

  const body = useRef<HTMLDivElement>(null)
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

  // Le fil où écrire pour passer la main à l'agent : il n'y en a pas en portée
  // projet, où aucun agent n'est désigné.
  const decoded = decodeScope(scope)
  const threadId = decoded.kind === 'conversation' ? decoded.id : null

  const conflicted = state.data?.conflicted.length ?? 0
  const running = state.data?.rebase ?? null

  // Un rebase qui court ouvre son tableau de bord de lui-même : on ne laisse pas
  // l'écran afficher un graphe pendant qu'un rebase attend qu'on le finisse.
  useEffect(() => {
    if (running && !rebasing) setRebasing({ onto: null })
  }, [running, rebasing])

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
  // deux colonnes illisibles. À partir de 56 rem, il y a la place des deux : le détail
  // s'ouvre à côté, et la liste garde sa place et sa sélection.
  const opened = selected !== null && (destination === 'graph' || destination === 'search')
  const beside = useWiderThan(body, BESIDE_REM)
  const reading = opened && !beside

  const openHistory = (path: string, blame: boolean): void => {
    setFile({ path, blame })
    setDestination('history')
    setSelected(null)
  }

  const menus: MenuContext = {
    branch: state.data?.branch ?? null,
    locked: state.data?.lock !== null && state.data?.lock !== undefined,
    projectId,
    onOpenThread: openThread,
    // Le rebase interactif part du menu d'un commit : « rebaser interactivement à
    // partir d'ici », donc le commit désigné est le point de départ, pas un des
    // commits rejoués.
    onRebase: (hash) => setRebasing({ onto: hash }),
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

        <div ref={body} className="flex min-h-0 min-w-0 flex-1">
          <Rail
            active={destination}
            counts={counts}
            conflicted={conflicted}
            onSelect={(next) => {
              setDestination(next)
              setSelected(null)
              // Quitter le rail ferme le plan de rebase qu'on composait — sauf s'il
              // court déjà, auquel cas il n'y a rien à quitter.
              if (!running) setRebasing(null)
            }}
          />

          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            {rebasing ? (
              <RebaseView
                scope={scope}
                onto={rebasing.onto}
                state={state.data}
                onClose={() => setRebasing(null)}
              />
            ) : null}

            {!rebasing && reading && selected !== null ? (
              <CommitDetail
                scope={scope}
                hash={selected}
                menus={menus}
                onBack={() => setSelected(null)}
                onOpenThread={openThread}
              />
            ) : null}

            {!rebasing && destination === 'graph' && !reading ? (
              <GraphView
                scope={scope}
                filters={{}}
                limit={limit}
                onMore={() => setLimit((value) => value + GRAPH_PAGE)}
                selected={beside ? selected : null}
                onSelect={select}
                menus={menus}
                onOpenThread={openThread}
                head={state.data?.head?.hash ?? null}
              />
            ) : null}

            {!rebasing && destination === 'working' ? (
              <WorkingView
                scope={scope}
                pendingReview={pendingReview}
                onReviewed={() => setPendingReview(false)}
                onOpenFile={onOpenFile}
                onOpenHistory={openHistory}
              />
            ) : null}

            {!rebasing && destination === 'branches' ? (
              <BranchesView scope={scope} menus={menus} onOpenThread={openThread} />
            ) : null}

            {!rebasing && destination === 'stashes' ? <StashesView scope={scope} /> : null}

            {!rebasing && destination === 'conflicts' ? (
              <ConflictsView
                scope={scope}
                threadId={threadId}
                rebasing={running !== null}
                onOpenThread={openThread}
              />
            ) : null}

            {!rebasing && destination === 'search' && !reading ? (
              <SearchView
                scope={scope}
                filters={filters}
                onFilters={setFilters}
                limit={limit}
                onMore={() => setLimit((value) => value + GRAPH_PAGE)}
                selected={beside ? selected : null}
                onSelect={select}
                menus={menus}
                onOpenThread={openThread}
              />
            ) : null}

            {!rebasing && destination === 'history' ? (
              <HistoryView
                scope={scope}
                path={file?.path ?? null}
                blame={file?.blame ?? false}
                changed={[...(state.data?.unstaged ?? []), ...(state.data?.staged ?? [])]}
                onPath={(path) => setFile({ path, blame: false })}
                onBlame={(blame) => setFile((current) => (current ? { ...current, blame } : null))}
                onOpenCommit={(hash) => {
                  setDestination('graph')
                  setSelected(hash)
                }}
                onOpenThread={openThread}
              />
            ) : null}
          </div>

          {!rebasing && opened && beside && selected !== null ? (
            <div className="flex min-h-0 w-[28rem] max-w-[45%] shrink-0 flex-col border-l border-line">
              <CommitDetail
                key={selected}
                scope={scope}
                hash={selected}
                menus={menus}
                beside
                onBack={() => setSelected(null)}
                onOpenThread={openThread}
              />
            </div>
          ) : null}
        </div>
      </div>
    </GitActionsProvider>
  )
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

/** La largeur du corps de la vue à partir de laquelle un commit s'ouvre à côté du graphe. */
const BESIDE_REM = 56

/** Vrai quand l'élément est plus large que `rem` : le panneau se redimensionne à la main. */
function useWiderThan(target: RefObject<HTMLElement | null>, rem: number): boolean {
  const [wider, setWider] = useState(false)
  useEffect(() => {
    const node = target.current
    if (!node) return
    const unit = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
    const observer = new ResizeObserver(([entry]) => {
      setWider((entry?.contentRect.width ?? 0) >= rem * unit)
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [target, rem])
  return wider
}
