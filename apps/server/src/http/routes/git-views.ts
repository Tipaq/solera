import type { FastifyInstance } from 'fastify'
import {
  commitHashSchema,
  filePathQuerySchema,
  graphQuerySchema,
  type BlameDto,
  type CommitDetailDto,
  type ConflictsDto,
  type FileHistoryDto,
  type GraphDto,
  type GraphNodeDto,
  type GraphQuery,
  type RebasePlanDto,
  type RefsDto,
  type ThreadRefDto,
} from '@solera/protocol'
import { readCommitDiff } from '../../git.js'
import { readConflicts } from '../../git-conflicts.js'
import {
  agentOf,
  parseDecoration,
  readBlame,
  readCommitFacts,
  readEntries,
  readGraphWindow,
  readRefSections,
  uniqueOwners,
  workingNode,
  worktreeBranches,
  type GraphWindow,
} from '../../git-graph.js'
import { readWriteState } from '../../git-write.js'
import { readThreadWindows, threadAt, threadByPath, type ThreadWindow } from '../../git-threads.js'
import { projectWorkspace } from '../../workspace.js'
import type { AppContext } from '../context.js'
import { badRequest } from '../errors.js'
import { requireUser } from '../require-user.js'
import { workspaceScopes } from './workspace-scopes.js'

/**
 * Le fil d'un commit, question posée par le graphe, par l'historique d'un fichier et
 * par le blâme.
 *
 * Le rattachement se fait ici et non dans `git-graph.ts` : celui-ci ne connaît que le
 * dépôt, et aller chercher la base depuis une lecture git mélangerait les deux. Voir
 * `git-threads.ts` pour les deux règles et ce qu'elles valent.
 */
type ThreadOf = (hash: string, ts: number) => ThreadRefDto | null

/**
 * Le rattachement commit → fil, appliqué à une fenêtre de graphe.
 *
 * Extrait de `graphNodes` parce que l'historique d'un fichier et le blâme (planche
 * T12) posent exactement la même question sur d'autres commits. **Les deux règles
 * vivent dans `git-threads.ts`** et ne se réinventent pas ici : ce qui est ici, c'est
 * la première — celle par la branche — qui a besoin de la fenêtre pour savoir quelle
 * tête atteint quel commit.
 */
function threadLookup(
  window: GraphWindow,
  threads: ThreadWindow[],
  rootPath: string,
): ThreadOf {
  const worktreeNames = new Set(window.worktrees.keys())
  const byPath = threadByPath(threads)

  // Les têtes qu'on connaît sont celles que la fenêtre décore : une branche dont le
  // sommet est hors fenêtre n'a de toute façon aucun commit à revendiquer ici.
  const tips = window.rows.flatMap((row) =>
    parseDecoration(row.entry.decoration, worktreeNames)
      .filter((ref) => ref.kind !== 'tag' && ref.kind !== 'head')
      .map((ref) => ({ hash: row.entry.hash, key: ref.name })),
  )
  const owners = uniqueOwners(
    window.rows.map((row) => ({ hash: row.entry.hash, parents: row.entry.parents })),
    tips,
  )

  return (hash: string, ts: number): ThreadRefDto | null => {
    const branch = owners.get(hash)
    const path = branch ? window.worktrees.get(branch) : undefined
    const sure = path ? byPath.get(path) : undefined
    return sure ?? threadAt(threads, rootPath, ts)
  }
}

function graphNodes(
  window: GraphWindow,
  threads: ThreadWindow[],
  rootPath: string,
): GraphNodeDto[] {
  const worktreeNames = new Set(window.worktrees.keys())
  const threadOf = threadLookup(window, threads, rootPath)

  return window.rows.map((row) => {
    const stash = window.stashes.get(row.entry.hash)
    return {
      kind: stash ? 'stash' : row.entry.parents.length > 1 ? 'merge' : 'commit',
      hash: row.entry.hash,
      shortHash: row.entry.shortHash,
      subject: row.entry.subject,
      author: row.entry.author,
      agent: agentOf(row.entry.coAuthors),
      ts: row.entry.ts,
      parents: row.entry.parents,
      refs: parseDecoration(row.entry.decoration, worktreeNames),
      thread: threadOf(row.entry.hash, row.entry.ts),
      lane: row.lane,
      through: row.through,
      joins: row.joins,
      collapses: row.collapses,
      tip: row.tip,
      root: row.root,
      run: row.run,
      throughRuns: row.throughRuns,
      joinRuns: row.joinRuns,
      collapseRuns: row.collapseRuns,
      working: null,
    }
  })
}

/**
 * Les filtres que git ne sait pas poser : le fil, l'agent, et l'auteur.
 *
 * L'auteur est ici plutôt qu'en `--author` parce que la colonne *Auteur* montre
 * l'agent quand il y en a un : chercher « Claude » doit trouver ses commits, alors que
 * git n'y voit que l'identité de l'utilisateur.
 */
function applyFilters(nodes: GraphNodeDto[], query: GraphQuery): GraphNodeDto[] {
  const author = query.author?.toLocaleLowerCase()
  return nodes.filter((node) => {
    if (query.thread && node.thread?.id !== query.thread) return false
    if (query.hand === 'agent' && node.agent === null) return false
    if (query.hand === 'human' && node.agent !== null) return false
    if (author) {
      const haystack = `${node.author} ${node.agent ?? ''}`.toLocaleLowerCase()
      if (!haystack.includes(author)) return false
    }
    return true
  })
}

/**
 * Un graphe filtré n'est plus un graphe, c'est une liste.
 *
 * Les couloirs relient un commit à ses parents ; dès qu'on retire des rangées, les
 * traits qui restent ne mènent plus nulle part et dessinent des lignes flottantes
 * entre des commits sans rapport. GitKraken aplatit pareil quand on filtre.
 */
const flatten = (nodes: GraphNodeDto[]): GraphNodeDto[] =>
  nodes.map((node) => ({
    ...node,
    lane: 0,
    through: [],
    joins: [],
    collapses: [],
    tip: true,
    root: true,
    throughRuns: [],
    joinRuns: [],
    collapseRuns: [],
  }))

/** La fenêtre de l'historique d'un fichier : au-delà, on ne défile plus, on cherche. */
const FILE_LOG = 100

/** Et celle du blâme : un fichier plus long ne se lit pas ligne à ligne à l'écran. */
const BLAME_LINES = 2000

const isFiltered = (query: GraphQuery): boolean =>
  Boolean(query.q || query.author || query.file || query.branch || query.since || query.until
    || query.thread || query.hand)

/**
 * Lectures git de l'onglet Git du panneau : le graphe du dépôt, ses références, un
 * commit, et le diff du répertoire de travail.
 *
 * Sorties de `conversations.ts` parce qu'elles n'ont rien de propre à un fil : elles ne
 * regardent qu'un répertoire, et existent donc aussi par projet, où le panneau montre
 * l'état du workspace. Calculées à la demande plutôt que journalisées : c'est un état
 * courant du disque, pas un événement.
 *
 * **Tout y est en lecture, et ça doit le rester.** Indexer, commiter, pousser,
 * basculer, remiser et rebaser vivent dans `git-actions.ts`, où ils partagent le
 * verrou de concurrence, le garde-fou et le journal d'annulation. Une écriture glissée
 * ici serait une écriture sans ces trois-là.
 */
export function registerGitViewRoutes(app: FastifyInstance, ctx: AppContext): void {
  // Deux portées, conversation et projet : voir `workspace-scopes.ts`.
  for (const { base, cwdOf, projectIdOf } of workspaceScopes) {
    /**
     * Le graphe du dépôt : la destination *Graphe*, et la destination *Recherche*.
     *
     * Le dépôt entier et non la branche consultée : le graphe d'un worktree est une
     * ligne droite, donc une décoration (planche C1 du tour 1). La fenêtre est bornée
     * et paginée comme les commits — un `git log --all` complet se paierait à chaque
     * ouverture du panneau.
     */
    app.get(`${base}/graph`, async (request): Promise<GraphDto> => {
      const user = requireUser(request)
      const { id } = request.params as { id: string }
      const query = graphQuerySchema.parse(request.query)

      const cwd = cwdOf(ctx.db, id, user.id)
      const projectId = projectIdOf(ctx.db, id)

      try {
        const window = await readGraphWindow(cwd, query)
        if (!window) return { nodes: null, lanes: 1, runs: [], hasMore: false, branch: null, filtered: false }

        const threads = projectId ? readThreadWindows(ctx.db, projectId) : []
        // Les fils sans worktree travaillent à la racine du projet : c'est là que le
        // recoupement par dates a un sens, et nulle part ailleurs.
        const rootPath = projectId ? projectWorkspace(ctx.db, projectId, user.id) : cwd
        const nodes = applyFilters(graphNodes(window, threads, rootPath), query)

        // Le nœud « en cours » n'est posé qu'en tête de la première page et hors
        // filtre : il n'est pas un commit, donc il ne répond à aucune recherche.
        const working =
          query.skip === 0 && !isFiltered(query) && window.status.changedFiles > 0
            ? [workingNode(window.status, nodes[0])]
            : []

        const filtered = isFiltered(query)
        return {
          nodes: filtered ? flatten(nodes) : [...working, ...nodes],
          lanes: filtered ? 1 : window.lanes,
          runs: window.runs,
          hasMore: window.hasMore,
          branch: window.branch,
          filtered,
        }
      } catch (err) {
        throw badRequest('git_failed', err instanceof Error ? err.message : String(err))
      }
    })

    /** La destination *Branches* : Local, Worktrees, Distants, Étiquettes, Sous-modules. */
    app.get(`${base}/refs`, async (request): Promise<RefsDto> => {
      const user = requireUser(request)
      const { id } = request.params as { id: string }

      const cwd = cwdOf(ctx.db, id, user.id)
      const projectId = projectIdOf(ctx.db, id)
      const byPath = threadByPath(projectId ? readThreadWindows(ctx.db, projectId) : [])

      try {
        const sections = await readRefSections(cwd, (line) =>
          line.worktreePath ? byPath.get(line.worktreePath) ?? null : null,
        )
        return { sections }
      } catch (err) {
        throw badRequest('git_failed', err instanceof Error ? err.message : String(err))
      }
    })

    /**
     * Le commit sélectionné : ses faits, son diff, et le fil qui l'a écrit.
     *
     * Le diff part avec le reste plutôt qu'à la demande : on ouvre un commit pour voir
     * ce qu'il a changé, et une seconde requête ajouterait un aller-retour à chaque
     * clic dans le graphe.
     */
    app.get(`${base}/commits/:hash/detail`, async (request): Promise<CommitDetailDto> => {
      const user = requireUser(request)
      const { id, hash } = request.params as { id: string; hash: string }
      const cwd = cwdOf(ctx.db, id, user.id)
      const projectId = projectIdOf(ctx.db, id)

      const parsed = commitHashSchema.safeParse(hash)
      if (!parsed.success) throw badRequest('bad_commit', 'This is not a commit hash.')

      try {
        const [facts, diff, worktrees] = await Promise.all([
          readCommitFacts(cwd, parsed.data),
          readCommitDiff(cwd, parsed.data),
          worktreeBranches(cwd),
        ])
        if (!facts) throw badRequest('bad_commit', 'This commit does not exist.')

        const threads = projectId ? readThreadWindows(ctx.db, projectId) : []
        const byPath = threadByPath(threads)
        const rootPath = projectId ? projectWorkspace(ctx.db, projectId, user.id) : cwd

        // Même règle que pour le graphe, par un autre chemin : une seule branche locale
        // contient ce commit, et elle est sortie dans un worktree — il n'existe que par
        // ce chantier-là. Voir `git-threads.ts`.
        const locals = facts.containedIn
          .filter((name) => name.startsWith('refs/heads/'))
          .map((name) => name.slice('refs/heads/'.length))
        const only = locals.length === 1 ? worktrees.get(locals[0] as string) : undefined

        return {
          hash: facts.entry.hash,
          shortHash: facts.entry.shortHash,
          subject: facts.entry.subject,
          body: facts.body,
          author: facts.entry.author,
          authorEmail: facts.entry.email,
          agent: agentOf(facts.entry.coAuthors),
          ts: facts.entry.ts,
          parents: facts.entry.parents.map((parent) => ({
            hash: parent,
            shortHash: parent.slice(0, 7),
          })),
          refs: parseDecoration(facts.entry.decoration, new Set(worktrees.keys())),
          containedIn: facts.containedIn.map((name) =>
            name.replace(/^refs\/(heads|remotes|tags)\//, ''),
          ),
          thread: (only ? byPath.get(only) ?? null : null)
            ?? threadAt(threads, rootPath, facts.entry.ts),
          files: diff.files,
          patch: diff.patch,
          truncated: diff.truncated,
        }
      } catch (err) {
        if (err instanceof Error && 'statusCode' in err) throw err
        throw badRequest('git_failed', err instanceof Error ? err.message : String(err))
      }
    })

    /**
     * Les conflits ouverts, prêts pour l'éditeur de la planche T10.
     *
     * Une lecture à part de l'état : elle lit le contenu de chaque fichier en conflit,
     * ce qui n'a aucune raison d'être payé à chaque ouverture du panneau. La
     * destination *Conflits* du rail, elle, apparaît sur `GitStateDto.conflicted`, qui
     * ne coûte qu'un `diff --name-only`.
     */
    app.get(`${base}/git/conflicts`, async (request): Promise<ConflictsDto> => {
      const user = requireUser(request)
      const { id } = request.params as { id: string }
      const cwd = cwdOf(ctx.db, id, user.id)

      try {
        const state = await readWriteState(cwd)
        if (!state || state.conflicted.length === 0) {
          return { origin: null, oursLabel: '', theirsLabel: '', files: [] }
        }
        return await readConflicts(cwd, state.conflicted)
      } catch (err) {
        throw badRequest('git_failed', err instanceof Error ? err.message : String(err))
      }
    })

    /**
     * Ce qu'il y aurait à rebaser, et sur quoi : la liste que l'écran T9 propose.
     *
     * L'amont par défaut est `@{upstream}` : c'est la réponse à « mes commits qui ne
     * sont pas encore partis », qui est la question qu'on se pose en ouvrant un rebase
     * interactif. Le menu d'un commit, lui, désigne son point de départ.
     */
    app.get(`${base}/git/rebase/plan`, async (request): Promise<RebasePlanDto> => {
      const user = requireUser(request)
      const { id } = request.params as { id: string }
      const query = request.query as { onto?: string }
      const cwd = cwdOf(ctx.db, id, user.id)
      const projectId = projectIdOf(ctx.db, id)

      try {
        const state = await readWriteState(cwd)
        if (!state) return { onto: null, commits: [], branch: null, guessed: false }

        const guessed = !query.onto
        const onto = query.onto?.trim() || state.upstream
        if (!onto) return { onto: null, commits: [], branch: state.branch, guessed }

        // `--reverse` : l'écran liste du plus ancien au plus récent, c'est-à-dire dans
        // l'ordre où git les rejouera. L'inverse du graphe, et c'est voulu — un plan
        // de rebase se lit comme une recette.
        const entries = await readEntries(cwd, ['--reverse', '--max-count=200', `${onto}..HEAD`])
        const threads = projectId ? readThreadWindows(ctx.db, projectId) : []
        const rootPath = projectId ? projectWorkspace(ctx.db, projectId, user.id) : cwd
        const window = await readGraphWindow(cwd, { ...graphQuerySchema.parse({}), limit: 200 })
        const threadOf = window ? threadLookup(window, threads, rootPath) : () => null

        const head = await readCommitFacts(cwd, onto).catch(() => null)
        return {
          onto: head
            ? { ref: onto, shortHash: head.entry.shortHash, subject: head.entry.subject }
            : null,
          branch: state.branch,
          guessed,
          commits: entries.map((entry) => ({
            hash: entry.hash,
            shortHash: entry.shortHash,
            subject: entry.subject,
            body: '',
            author: entry.author,
            agent: agentOf(entry.coAuthors),
            ts: entry.ts,
            thread: threadOf(entry.hash, entry.ts),
          })),
        }
      } catch (err) {
        throw badRequest('git_failed', err instanceof Error ? err.message : String(err))
      }
    })

    /** L'historique d'un fichier, **par fil** (planche T12, moitié haute). */
    app.get(`${base}/git/file/history`, async (request): Promise<FileHistoryDto> => {
      const user = requireUser(request)
      const { id } = request.params as { id: string }
      const { path } = filePathQuerySchema.parse(request.query)
      const cwd = cwdOf(ctx.db, id, user.id)
      const projectId = projectIdOf(ctx.db, id)

      try {
        const window = await readGraphWindow(cwd, { ...graphQuerySchema.parse({}), limit: 200 })
        if (!window) return { commits: null, threads: 0, truncated: false }

        const threads = projectId ? readThreadWindows(ctx.db, projectId) : []
        const rootPath = projectId ? projectWorkspace(ctx.db, projectId, user.id) : cwd
        const threadOf = threadLookup(window, threads, rootPath)

        const entries = await readEntries(cwd, [`--max-count=${FILE_LOG + 1}`, '--', path])
        const commits = entries.slice(0, FILE_LOG).map((entry) => ({
          hash: entry.hash,
          shortHash: entry.shortHash,
          subject: entry.subject,
          author: entry.author,
          agent: agentOf(entry.coAuthors),
          ts: entry.ts,
          thread: threadOf(entry.hash, entry.ts),
        }))

        return {
          commits,
          threads: new Set(commits.map((commit) => commit.thread?.id).filter(Boolean)).size,
          truncated: entries.length > FILE_LOG,
        }
      } catch (err) {
        throw badRequest('git_failed', err instanceof Error ? err.message : String(err))
      }
    })

    /**
     * Le blâme d'un fichier, **par fil et non par auteur** (planche T12, moitié basse).
     *
     * C'est le deuxième écart assumé avec GitKraken, et le plus profond : dans un dépôt
     * où presque tout est signé d'un agent, « qui a écrit cette ligne » répond « Tim »
     * partout — le CLI commite sous son identité. « Quelle conversation » répond
     * quelque chose. L'auteur reste rendu, et c'est l'interface qui le montre pour les
     * seules lignes écrites à la main, où il apprend encore quelque chose.
     */
    app.get(`${base}/git/file/blame`, async (request): Promise<BlameDto> => {
      const user = requireUser(request)
      const { id } = request.params as { id: string }
      const { path } = filePathQuerySchema.parse(request.query)
      const cwd = cwdOf(ctx.db, id, user.id)
      const projectId = projectIdOf(ctx.db, id)

      try {
        const window = await readGraphWindow(cwd, { ...graphQuerySchema.parse({}), limit: 200 })
        if (!window) return { lines: null, truncated: false }

        const rows = await readBlame(cwd, path, BLAME_LINES)
        const threads = projectId ? readThreadWindows(ctx.db, projectId) : []
        const rootPath = projectId ? projectWorkspace(ctx.db, projectId, user.id) : cwd
        const threadOf = threadLookup(window, threads, rootPath)

        // Un seul `log` pour tous les commits cités : le `Co-Authored-By` ne figure pas
        // dans la sortie de `blame`, et le demander ligne par ligne ferait mille
        // process git sur un fichier de mille lignes.
        const hashes = [...new Set(rows.map((row) => row.hash))]
        const agents = new Map(
          (await readEntries(cwd, ['--no-walk', ...hashes])).map((entry) => [
            entry.hash,
            agentOf(entry.coAuthors),
          ]),
        )

        return {
          lines: rows.slice(0, BLAME_LINES).map((row) => ({
            line: row.line,
            text: row.text,
            hash: row.hash,
            shortHash: row.hash.slice(0, 7),
            author: row.author,
            agent: agents.get(row.hash) ?? null,
            ts: row.ts,
            thread: threadOf(row.hash, row.ts),
          })),
          truncated: rows.length > BLAME_LINES,
        }
      } catch (err) {
        throw badRequest('git_failed', err instanceof Error ? err.message : String(err))
      }
    })

  }
}
