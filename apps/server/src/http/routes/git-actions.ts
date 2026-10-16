import { eq, inArray } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { conversations, projects, worktrees, type Db } from '@solera/db'
import {
  gitActionSchema,
  type GitAction,
  type GitImpactDto,
  type GitLockDto,
  type GitStateDto,
  type StashesDto,
} from '@solera/protocol'
import { credentialEnv } from '../../git-credential/helper.js'
import { GitError } from '../../git.js'
import { impactOf, perform, readStashDetails, readWriteState, UndoJournal } from '../../git-write.js'
import type { AppContext } from '../context.js'
import { HttpError, badRequest, conflict } from '../errors.js'
import { requireUser } from '../require-user.js'
import { workspaceScopes } from './workspace-scopes.js'

/**
 * Les **écritures** de la vue Git du panneau : indexer, commiter, pousser, basculer,
 * remiser, fusionner, rebaser, réinitialiser.
 *
 * Lot 2 de la carte #29. Jusqu'ici tout le volet git était en lecture
 * (`git-views.ts`), et c'est la frontière qu'on franchit ici — d'où trois règles qui
 * valent pour toute route de ce fichier, et qu'il ne faut pas contourner en ajoutant
 * un geste :
 *
 * 1. **Un seul écrivain à la fois.** Tant qu'un agent travaille dans ce répertoire,
 *    les écritures de l'interface sont refusées. Décision de la carte #10, question 2,
 *    planche `tour-1/clair/04` : pas d'index concurrent, pas de fichier qui bouge sous
 *    un patch. L'interface éteint ses gestes, mais c'est **ici** que ça se décide —
 *    une interface n'est pas un garde-fou.
 * 2. **Ce qui n'est pas annulable passe par un garde-fou qui nomme la perte**
 *    (`POST …/impact`, planche T13). La route ne le force pas, l'interface le demande ;
 *    ce que la route garantit, c'est que les deux réponses viennent du même calcul.
 * 3. **Les identifiants passent par la porte existante.** `credentialEnv` est celle du
 *    clone et celle des agents — pas une seconde, et surtout pas un jeton qui
 *    transiterait par une ligne de commande.
 */

/** Ce qu'un agent écrit comme co-auteur, par CLI. L'adresse n'est pas une boîte. */
const CO_AUTHORS: Record<string, string> = {
  claude: 'Co-Authored-By: Claude <noreply@anthropic.com>',
  codex: 'Co-Authored-By: Codex <noreply@openai.com>',
  opencode: 'Co-Authored-By: OpenCode <noreply@opencode.ai>',
}

/**
 * Le fil qui tient ce répertoire, s'il y en a un.
 *
 * Lu en base et non dans le gestionnaire de sessions : le statut d'une conversation y
 * est écrit à chaque transition, il survit à un redémarrage (où les `running` fantômes
 * sont d'ailleurs remis à plat au démarrage), et il porte déjà la bonne notion —
 * `awaiting_input` compte, parce qu'un agent arrêté sur une demande de permission
 * reprendra la main sans nous prévenir.
 */
function lockOf(db: Db, cwd: string): GitLockDto | null {
  const rows = db
    .select({
      id: conversations.id,
      title: conversations.title,
      worktreePath: worktrees.path,
      worktreeRemovedAt: worktrees.removedAt,
      workspacePath: projects.workspacePath,
    })
    .from(conversations)
    .innerJoin(projects, eq(projects.id, conversations.projectId))
    .leftJoin(worktrees, eq(worktrees.id, conversations.worktreeId))
    .where(inArray(conversations.status, ['running', 'awaiting_input']))
    .all()

  const busy = rows.find((row) => {
    const path = row.worktreePath && !row.worktreeRemovedAt ? row.worktreePath : row.workspacePath
    return path === cwd
  })
  return busy ? { threadId: busy.id, title: busy.title } : null
}

/** Le co-auteur à proposer : l'agent du fil consulté, et rien en portée projet. */
function coAuthorOf(db: Db, base: string, id: string): string | null {
  if (!base.startsWith('/api/conversations')) return null
  const row = db
    .select({ agent: conversations.agent })
    .from(conversations)
    .where(eq(conversations.id, id))
    .get()
  return row ? CO_AUTHORS[row.agent] ?? null : null
}

/**
 * Le journal d'annulation, partagé par toutes les portées.
 *
 * Par répertoire et non par conversation : deux fils qui regardent le même worktree
 * voient le même dépôt, donc le même dernier geste. Il vit ici plutôt que dans le
 * contexte parce que rien d'autre dans le serveur n'a affaire à lui.
 */
const journal = new UndoJournal()

export function registerGitActionRoutes(app: FastifyInstance, ctx: AppContext): void {
  for (const { base, cwdOf } of workspaceScopes) {
    /** Où en est l'écriture : l'index, l'arbre, le verrou, et ce qui s'annule. */
    app.get(`${base}/git/state`, async (request): Promise<GitStateDto> => {
      const user = requireUser(request)
      const { id } = request.params as { id: string }
      const cwd = cwdOf(ctx.db, id, user.id)

      const state = await readWriteState(cwd).catch((err: unknown) => {
        throw badRequest('git_failed', err instanceof Error ? err.message : String(err))
      })
      if (!state) {
        return {
          branch: null,
          upstream: null,
          ahead: null,
          behind: null,
          detached: false,
          staged: [],
          unstaged: [],
          stagedPatch: '',
          unstagedPatch: '',
          truncated: false,
          head: null,
          lock: null,
          undo: null,
          redo: null,
          coAuthor: null,
          conflicted: [],
          rebase: null,
        }
      }

      const [undo, redo] = await Promise.all([journal.undoable(cwd), journal.redoable(cwd)])
      return {
        ...state,
        lock: lockOf(ctx.db, cwd),
        undo,
        redo,
        coAuthor: coAuthorOf(ctx.db, base, id),
      }
    })

    /** La destination *Remises*, aperçu compris (planche T8). */
    app.get(`${base}/git/stashes`, async (request): Promise<StashesDto> => {
      const user = requireUser(request)
      const { id } = request.params as { id: string }
      const cwd = cwdOf(ctx.db, id, user.id)
      try {
        return { stashes: await readStashDetails(cwd) }
      } catch (err) {
        throw badRequest('git_failed', err instanceof Error ? err.message : String(err))
      }
    })

    /**
     * Ce que le geste coûterait, demandé avant de le faire.
     *
     * Un POST pour une lecture : le geste est un objet, pas une chaîne de requête, et
     * le décrire deux fois — une fois en URL pour l'impact, une fois en corps pour
     * l'action — serait deux descriptions à garder d'accord.
     */
    app.post(`${base}/git/impact`, async (request): Promise<GitImpactDto> => {
      const user = requireUser(request)
      const { id } = request.params as { id: string }
      const cwd = cwdOf(ctx.db, id, user.id)
      const action = parseAction(request.body)
      try {
        return await impactOf(cwd, action)
      } catch (err) {
        throw badRequest('git_failed', err instanceof Error ? err.message : String(err))
      }
    })

    /** Le geste lui-même. */
    app.post(`${base}/git/act`, async (request): Promise<{ message: string }> => {
      const user = requireUser(request)
      const { id } = request.params as { id: string }
      const cwd = cwdOf(ctx.db, id, user.id)
      const action = parseAction(request.body)

      refuseWhileRunning(ctx, cwd)
      try {
        const outcome = await perform(cwd, action, credentialEnv(ctx.config.paths, user.id))
        journal.record(cwd, outcome.undo)
        return { message: outcome.message }
      } catch (err) {
        throw gitFailure(err)
      }
    })

    app.post(`${base}/git/undo`, async (request): Promise<{ message: string }> => {
      const user = requireUser(request)
      const { id } = request.params as { id: string }
      const cwd = cwdOf(ctx.db, id, user.id)

      refuseWhileRunning(ctx, cwd)
      try {
        await journal.undo(cwd)
        return { message: '' }
      } catch (err) {
        throw gitFailure(err)
      }
    })

    app.post(`${base}/git/redo`, async (request): Promise<{ message: string }> => {
      const user = requireUser(request)
      const { id } = request.params as { id: string }
      const cwd = cwdOf(ctx.db, id, user.id)

      refuseWhileRunning(ctx, cwd)
      try {
        await journal.redo(cwd, credentialEnv(ctx.config.paths, user.id))
        return { message: '' }
      } catch (err) {
        throw gitFailure(err)
      }
    })
  }
}

function parseAction(body: unknown): GitAction {
  const parsed = gitActionSchema.safeParse(body)
  if (!parsed.success) {
    throw badRequest('bad_git_action', parsed.error.issues[0]?.message ?? 'Unsupported git action.')
  }
  return parsed.data
}

/**
 * Le verrou, du côté où il tient.
 *
 * 409 et non 403 : la demande est légitime, c'est l'état du dépôt qui la refuse, et
 * elle redeviendra possible à la fin du tour. Le titre du fil part avec, parce qu'un
 * bandeau qui dit « indisponible » sans dire qui travaille ni quoi attendre n'apprend
 * rien (planche `tour-1/clair/04`).
 */
function refuseWhileRunning(ctx: AppContext, cwd: string): void {
  const lock = lockOf(ctx.db, cwd)
  if (!lock) return
  throw conflict('turn_running', 'An agent is working in this directory ({title}).', {
    title: lock.title,
  })
}

/** L'erreur de git telle quelle : c'est elle qui dit quoi faire, pas une reformulation. */
function gitFailure(err: unknown): HttpError {
  if (err instanceof HttpError) return err
  if (err instanceof GitError) return badRequest('git_failed', err.message)
  return badRequest('git_failed', err instanceof Error ? err.message : String(err))
}
