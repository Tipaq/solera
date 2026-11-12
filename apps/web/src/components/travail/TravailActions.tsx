import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import { ConfirmDialog } from '@solera/ui'
import type { TreeRow } from '../../lib/code-model'
import { useTranslate } from '../../lib/i18n'
import { useMergePullRequest } from '../../lib/pull-requests'
import type { CleanRequest } from '../../lib/travail-clean'
import { CleanDialog } from './CleanDialog'
import { errorText, useTravailNotice } from './TravailNotice'

/**
 * Les gestes de Travail qui passent par une confirmation de la page : le nettoyage, un
 * seul dialogue pour tout (`projet.md` T-12), et la fusion d'une PR prête (T-6.2). Un
 * couloir, une ligne du tableau, le tiroir ou la barre les demandent ; la page les tient.
 */
export interface TravailActions {
  clean: (request: CleanRequest) => void
  merge: (tree: TreeRow) => void
  /** La base du projet : le rebase s'y fait, la fusion y mène. */
  base: string | null
}

const ActionsContext = createContext<TravailActions>({ clean: () => {}, merge: () => {}, base: null })

export function useTravailActions(): TravailActions {
  return useContext(ActionsContext)
}

/**
 * L'hôte des deux confirmations. `onRemoved` reçoit les clés des arbres partis, pour
 * que la page ferme un tiroir ouvert sur l'un d'eux.
 */
export function TravailActionsHost({
  projectId,
  base,
  onRemoved,
  children,
}: {
  projectId: string
  base: string | null
  onRemoved: (keys: string[]) => void
  children: ReactNode
}) {
  const [cleaning, setCleaning] = useState<CleanRequest | null>(null)
  const [merging, setMerging] = useState<TreeRow | null>(null)
  const value = useMemo<TravailActions>(() => ({ clean: setCleaning, merge: setMerging, base }), [base])
  return (
    <ActionsContext.Provider value={value}>
      {children}
      <CleanDialog projectId={projectId} request={cleaning} base={base} onClose={() => setCleaning(null)} onRemoved={onRemoved} />
      <MergeDialog projectId={projectId} tree={merging} base={base} onClose={() => setMerging(null)} />
    </ActionsContext.Provider>
  )
}

/** « Fusionner la PR » d'un arbre, après confirmation ; le serveur rejuge « prête ». */
function MergeDialog({ projectId, tree, base, onClose }: { projectId: string; tree: TreeRow | null; base: string | null; onClose: () => void }) {
  const t = useTranslate()
  const say = useTravailNotice()
  const merge = useMergePullRequest(projectId)
  const number = tree?.pr?.number ?? 0
  return (
    <ConfirmDialog
      open={tree !== null}
      onOpenChange={(open) => (open || merge.isPending ? null : onClose())}
      title={t('travail.merge.title', { number })}
      confirmLabel={t('travail.merge.confirm')}
      busy={merge.isPending}
      onConfirm={() =>
        merge.mutate(number, {
          onSuccess: (result) => say(t('travail.merge.done', { number: result.number, base: result.base })),
          onError: (error) => say(errorText(error), 'critical'),
          onSettled: onClose,
        })
      }
    >
      <p>{t('travail.merge.body', { branch: tree?.branch ?? tree?.name ?? '', base: base ?? '' })}</p>
    </ConfirmDialog>
  )
}
