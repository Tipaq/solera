import { useState } from 'react'
import { ConfirmDialog } from '@solera/ui'
import { useRunAction } from '../../lib/actions'
import { detailPanel, type ActionPanel } from '../../lib/action-panel'
import { actionOf, duplicateDraft } from '../../lib/automations'
import { useAutomationMutations } from '../../lib/automations-query'
import { useTranslate } from '../../lib/i18n'
import { targetOf, type PlannedItem } from '../../lib/planned'
import type { PlannedHandlers } from './PlannedTile'

/**
 * Les gestes d'une tuile ou d'une ligne de la page Planifiées : lancer maintenant là où la
 * portée le dit, mettre en pause ou reprendre, dupliquer dans la même portée, supprimer
 * après confirmation. Chaque action s'ouvre et se modifie dans le tiroir unifié.
 *
 * Une commande lancée ouvre son passage dans le tiroir : la page n'a pas de panneau où
 * montrer son terminal. L'hôte rend `dialogs` et `error` en tête de sa vue.
 */
export function usePlannedGestures(onPanel: (panel: ActionPanel) => void) {
  const t = useTranslate()
  const mutations = useAutomationMutations(null)
  const run = useRunAction()
  const [error, setError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<PlannedItem | null>(null)
  const [busy, setBusy] = useState(false)

  const fail = (reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason))

  const launch = (item: PlannedItem) => {
    setError(null)
    const action = actionOf(item)
    if (!action) {
      mutations.run(item).catch(fail)
      return
    }
    run.mutate(
      { action, reveal: false },
      {
        onSuccess: (result) => {
          if (result.terminal && action.kind === 'task') onPanel({ mode: 'run', terminalId: result.terminal.id, back: item.id })
        },
        onError: fail,
      },
    )
  }

  const remove = () => {
    if (!deleting) return
    setBusy(true)
    mutations
      .remove(deleting)
      .then(() => setDeleting(null))
      .catch((reason: unknown) => {
        setDeleting(null)
        fail(reason)
      })
      .finally(() => setBusy(false))
  }

  const handlers: PlannedHandlers = {
    onOpen: (item, review) => onPanel(detailPanel(item.id, review)),
    onEdit: (item) => onPanel({ mode: 'edit', seed: { from: item }, back: null }),
    onLaunch: launch,
    onPause: (item, paused) => {
      setError(null)
      mutations.setPaused(item, paused).catch(fail)
    },
    onDuplicate: (item) =>
      onPanel({ mode: 'edit', seed: { draft: duplicateDraft(item, t), target: targetOf(item.scope) }, back: null }),
    onDelete: setDeleting,
  }

  return {
    handlers,
    error,
    dialogs: (
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={t('actionsTab.delete.title', { label: deleting?.label ?? '' })}
        confirmLabel={t('actionsTab.delete.confirm')}
        tone="critical"
        busy={busy}
        onConfirm={remove}
      >
        <p className="text-sm text-ink-soft">{t('planned.delete.description')}</p>
      </ConfirmDialog>
    ),
  }
}
