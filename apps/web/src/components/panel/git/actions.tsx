import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Archive } from 'lucide-react'
import type { GitAction, GitImpactDto, GitLockDto, GitLossDto } from '@solera/protocol'
import { api } from '../../../lib/api'
import { useTranslate } from '../../../lib/i18n'
import { workspaceApiBase, type WorkspaceScope } from '../../../lib/workspace-scope'
import { Button, cx } from '@solera/ui'

/**
 * Le passage obligé de tout geste qui écrit dans le dépôt.
 *
 * Un contexte plutôt que des `props` : les gestes partent de partout — la barre
 * d'outils, le menu d'un commit, celui d'une branche, celui d'un fichier, les boutons
 * d'une remise — et les faire descendre à travers cinq composants aurait surtout
 * garanti qu'un chemin oublie le garde-fou.
 *
 * Ce que le contexte garantit, et qui ne doit pas se contourner :
 *
 * - **Ce qui n'est pas annulable demande avant** (planche T13). `run` interroge
 *   `…/git/impact` pour les gestes qui mordent, et n'exécute qu'après accord, le
 *   dialogue ayant nommé la perte — nombre de fichiers, de commits, et combien d'un
 *   agent. L'alternative « remiser d'abord » est là parce qu'elle est presque toujours
 *   ce qu'on voulait.
 * - **Pendant qu'un tour tourne, rien ne part.** Les boutons sont éteints, mais c'est
 *   la route qui refuse (409) : l'interface n'est pas un garde-fou.
 * - **Tout se relit après coup.** Un geste qui change le dépôt périme le graphe, les
 *   références, l'état et les remises — les quatre d'un coup, ou la vue ment à moitié.
 */

export interface GitActions {
  /** Lance le geste, en passant par le garde-fou quand il en faut un. */
  run: (action: GitAction) => void
  undo: () => void
  redo: () => void
  /** Non nul quand un agent tient le répertoire : tous les gestes sont éteints. */
  lock: GitLockDto | null
  pending: boolean
  error: string | null
  clearError: () => void
}

const Context = createContext<GitActions | null>(null)

export function useGitActions(): GitActions {
  const value = useContext(Context)
  if (!value) throw new Error('useGitActions hors de GitActionsProvider')
  return value
}

/**
 * Les gestes qui passent par le garde-fou.
 *
 * La liste est explicite et courte, parce qu'elle décide de ce qu'on demande : tout ce
 * qui peut détruire un travail qu'aucun `reflog` ne rend. Le serveur reste l'autorité
 * sur ce qui est réellement annulable — il répond `undoable` — mais c'est ici qu'on
 * décide d'aller le lui demander avant plutôt qu'après.
 */
const GUARDED: ReadonlySet<GitAction['kind']> = new Set([
  'discard',
  'commit-reset',
  'stash-drop',
  'branch-delete',
  'push',
  // Lot 3 : abandonner un rebase jette les commits déjà rejoués et le travail de
  // résolution ; prendre un côté d'un conflit écrase ce que l'autre portait, et ce
  // qu'on avait déjà résolu à la main.
  'rebase-abort',
  'conflict-take',
  // Lot 4 : les deux issues d'un lâcher. Le serveur sait déjà répondre pour elles —
  // il propose de remiser quand l'arbre est sale — et le lot 4 ouvre vers elles un
  // chemin clavier de quatre touches. Un raccourci qui saute le garde-fou que la
  // voie longue respecte serait la porte dérobée que T6 voulait éviter.
  'branch-merge',
  'branch-rebase',
])

function needsGuard(action: GitAction): boolean {
  if (action.kind === 'commit-reset') return action.mode === 'hard'
  if (action.kind === 'push') return action.force
  return GUARDED.has(action.kind)
}

export function GitActionsProvider({
  scope,
  lock,
  children,
}: {
  scope: WorkspaceScope
  lock: GitLockDto | null
  children: ReactNode
}) {
  const t = useTranslate()
  const client = useQueryClient()
  const base = workspaceApiBase(scope)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [asking, setAsking] = useState<{ action: GitAction; impact: GitImpactDto } | null>(null)

  /** Les lectures de la vue : un geste les périme toutes ensemble. */
  const refresh = useCallback((): void => {
    for (const key of [
      'git-graph',
      'git-refs',
      'git-state',
      'git-stashes',
      'git-conflicts',
      'git-rebase-plan',
      'git-file-history',
      'git-blame',
    ]) {
      void client.invalidateQueries({ queryKey: [key, scope] })
    }
    // L'arborescence de l'onglet *Fichiers* regarde le même disque : basculer de
    // branche la laisserait sur des fichiers qui n'existent plus.
    void client.invalidateQueries({ queryKey: ['tree'] })
  }, [client, scope])

  const call = useCallback(
    async (path: string, body?: unknown): Promise<void> => {
      setPending(true)
      setError(null)
      try {
        await api.post(`${base}/git/${path}`, body)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setPending(false)
        refresh()
      }
    },
    [base, refresh],
  )

  const execute = useCallback((action: GitAction) => void call('act', action), [call])

  const run = useCallback(
    (action: GitAction): void => {
      if (!needsGuard(action)) {
        execute(action)
        return
      }
      setPending(true)
      setError(null)
      api
        .post<GitImpactDto>(`${base}/git/impact`, action)
        .then((impact) => {
          // Un geste qui, ici et maintenant, ne détruit rien et s'annule, part sans
          // rien demander : un dialogue vide apprend à cliquer sans lire.
          //
          // `offerStash` compte comme une raison de s'arrêter, et pas seulement les
          // pertes : un rebase par-dessus un arbre sale ne perd rien — git refuse de
          // partir — mais il échoue, et l'offre de remiser est précisément la réponse
          // qu'on attendait. La laisser filer rendait une erreur git brute à qui
          // venait de demander la seule chose qui marche.
          if (impact.undoable && impact.losses.length === 0 && !impact.offerStash) {
            execute(action)
          }
          else setAsking({ action, impact })
        })
        .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
        .finally(() => setPending(false))
    },
    [base, execute],
  )

  const value = useMemo<GitActions>(
    () => ({
      run,
      undo: () => void call('undo'),
      redo: () => void call('redo'),
      lock,
      pending,
      error,
      clearError: () => setError(null),
    }),
    [run, call, lock, pending, error],
  )

  return (
    <Context.Provider value={value}>
      {children}
      {asking ? (
        <Guard
          action={asking.action}
          impact={asking.impact}
          onClose={() => setAsking(null)}
          onStashFirst={() => {
            setAsking(null)
            // Remiser met le travail à l'abri et **ne fait pas** le geste dans la
            // foulée : la liste des pertes qu'on vient de lire n'est plus la même une
            // fois l'arbre propre, et enchaîner serait décider à la place de quelqu'un
            // qui vient justement d'hésiter.
            void call('act', { kind: 'stash-push', message: t('git.guard.stashMessage') })
          }}
          onConfirm={() => {
            const action = asking.action
            setAsking(null)
            execute(action)
          }}
        />
      ) : null}
    </Context.Provider>
  )
}

/**
 * Le garde-fou : ce qui sera perdu, nommé et chiffré, avant de le perdre.
 *
 * Il ne dit pas « êtes-vous sûr ? » — personne ne l'est jamais, et la question
 * n'apprend rien. Il dit « 5 fichiers modifiés et non commités, 2 fichiers indexés,
 * 4 commits de main dont 2 écrits par un agent dans ce fil », parce que c'est ce
 * qu'on a besoin de savoir pour décider.
 */
function Guard({
  action,
  impact,
  onConfirm,
  onStashFirst,
  onClose,
}: {
  action: GitAction
  impact: GitImpactDto
  onConfirm: () => void
  onStashFirst: () => void
  onClose: () => void
}) {
  const t = useTranslate()

  return (
    // Un dialogue posé sur la vue plutôt qu'une `ConfirmDialog` : celle-ci n'a pas de
    // place pour la liste des pertes ni pour la troisième issue, « remiser d'abord ».
    <div className="scrim fixed inset-0 z-40 flex items-center justify-center p-4" role="presentation">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label={guardTitle(t, action)}
        className="surface flex w-[min(26rem,92vw)] flex-col gap-3 rounded-lg border border-critical/40 p-4 shadow-pop"
      >
        <p className="flex items-center gap-2 text-heading font-semibold text-critical">
          <AlertTriangle size={16} className="shrink-0" />
          {guardTitle(t, action)}
        </p>

        <div className="flex flex-col gap-1.5 text-sm text-ink-soft">
          {/* Rien à perdre, mais quelque chose à ranger : ce n'est pas la même
              question, et « ceci ne s'annule pas » serait faux autant qu'inutile. On
              dit alors pourquoi on s'arrête — git refusera de partir — plutôt que de
              dérouler une liste de pertes vide. */}
          <p>
            {impact.losses.length === 0 && impact.offerStash
              ? t('git.guard.dirtyTree')
              : impact.undoable
                ? t('git.guard.undoable')
                : t('git.guard.final')}
          </p>
          <ul className="flex flex-col gap-1">
            {impact.losses.map((loss) => (
              <li key={loss.kind} className="flex items-start gap-2 text-meta text-ink-soft">
                <span className="text-critical">—</span>
                <span>{lossLine(t, loss)}</span>
              </li>
            ))}
            {impact.losses.length === 0 && !impact.offerStash ? (
              <li className="text-meta text-ink-faint">{t('git.guard.nothingMeasured')}</li>
            ) : null}
          </ul>
        </div>

        <div className="mt-1 flex flex-wrap items-center justify-end gap-2">
          {impact.offerStash ? (
            <button
              type="button"
              onClick={onStashFirst}
              className={cx(
                'mr-auto flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1.5',
                'text-xs font-medium text-ink-soft hover:bg-surface-high',
              )}
            >
              <Archive size={13} />
              {t('git.guard.stashFirst')}
            </button>
          ) : null}
          <Button variant="ghost" onClick={onClose}>
            {t('git.guard.cancel')}
          </Button>
          <Button variant="danger" onClick={onConfirm}>
            {guardConfirm(t, action)}
          </Button>
        </div>
      </div>
    </div>
  )
}

type Translate = ReturnType<typeof useTranslate>

function guardTitle(t: Translate, action: GitAction): string {
  switch (action.kind) {
    case 'commit-reset':
      return t('git.guard.title.reset', { hash: action.hash.slice(0, 7) })
    case 'discard':
      return t('git.guard.title.discard', { count: action.paths.length })
    case 'stash-drop':
      return t('git.guard.title.stashDrop')
    case 'branch-delete':
      return t('git.guard.title.branchDelete', { name: action.name })
    case 'push':
      return t('git.guard.title.forcePush')
    case 'rebase-abort':
      return t('git.guard.title.rebaseAbort')
    case 'conflict-take':
      return t('git.guard.title.conflictTake')
    case 'branch-merge':
      return t('git.guard.title.branchMerge', { name: action.name })
    case 'branch-rebase':
      return t('git.guard.title.branchRebase', { name: action.name })
    default:
      return t('git.guard.title.generic')
  }
}

function guardConfirm(t: Translate, action: GitAction): string {
  switch (action.kind) {
    case 'commit-reset':
      return t('git.guard.confirm.reset')
    case 'discard':
      return t('git.guard.confirm.discard')
    case 'stash-drop':
      return t('git.guard.confirm.stashDrop')
    case 'branch-delete':
      return t('git.guard.confirm.branchDelete')
    case 'push':
      return t('git.guard.confirm.forcePush')
    case 'rebase-abort':
      return t('git.guard.confirm.rebaseAbort')
    case 'conflict-take':
      return t('git.guard.confirm.conflictTake')
    case 'branch-merge':
      return t('git.guard.confirm.branchMerge')
    case 'branch-rebase':
      return t('git.guard.confirm.branchRebase')
    default:
      return t('git.guard.confirm.generic')
  }
}

/** Une perte par ligne, avec son chiffre : c'est le chiffre qui fait décider. */
function lossLine(t: Translate, loss: GitLossDto): string {
  switch (loss.kind) {
    case 'working':
      return t(loss.count === 1 ? 'git.guard.loss.workingOne' : 'git.guard.loss.working', {
        count: loss.count,
        added: loss.added ?? 0,
        removed: loss.removed ?? 0,
      })
    case 'staged':
      return t(loss.count === 1 ? 'git.guard.loss.stagedOne' : 'git.guard.loss.staged', {
        count: loss.count,
      })
    case 'stash':
      return t('git.guard.loss.stash', { count: loss.count })
    case 'remote':
      return t('git.guard.loss.remote', { count: loss.count })
    case 'commits':
      // Le singulier n'est pas de la coquetterie : « 1 commits » sur un garde-fou
      // fait douter de tout ce qu'il annonce par ailleurs.
      if (loss.byAgent) {
        return t(
          loss.count === 1 ? 'git.guard.loss.commitsAgentOne' : 'git.guard.loss.commitsAgent',
          { count: loss.count, agent: loss.byAgent },
        )
      }
      return t(loss.count === 1 ? 'git.guard.loss.commitsOne' : 'git.guard.loss.commits', {
        count: loss.count,
      })
  }
}
