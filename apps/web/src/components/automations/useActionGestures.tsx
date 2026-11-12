import { useState } from 'react'
import { ConfirmDialog } from '@solera/ui'
import { useRunAction } from '../../lib/actions'
import type { ActionPanel } from '../../lib/action-panel'
import { actionOf, duplicateDraft, type Automation } from '../../lib/automations'
import { useAutomationMutations } from '../../lib/automations-query'
import { useTranslate } from '../../lib/i18n'
import { useServedIndex } from '../../lib/served-query'
import { switchTargets, unlessElsewhere } from '../../lib/served'
import type { TileServing } from './ActionTile'
import { useTargetName } from './served/ServeMenu'
import { switchToTree, useLaunchHere, useServiceSwitch } from './served/SwitchServiceDialog'

/** Ce qu'un service accepte en plus de démarrer : arrêter, redémarrer, suivre son journal (Q1). */
export type ServiceOp = 'stop' | 'restart' | 'logs'

/**
 * Les gestes d'une action posés hors du tiroir, sur une tuile du Lanceur ou une ligne de
 * la Liste de l'onglet Actions : lancer (là où le chevron le dit), l'interrupteur d'un
 * service et sa bascule d'un arbre à l'autre, son journal, dupliquer, supprimer.
 *
 * Hors conversation, un lancement part à la racine du projet, ou dans le worktree choisi.
 * Une commande lancée ouvre son passage dans le tiroir (`onPanel`, mode `run`). Un service
 * qui tourne déjà ailleurs ouvre le dialogue de bascule au lieu de se taire (SRV-4).
 *
 * L'hôte rend `dialogs` (la bascule, la confirmation de suppression) hors des menus qui
 * les ont ouverts, et `error` en tête de sa vue.
 */
export function useActionGestures(projectId: string, onPanel: (panel: ActionPanel) => void) {
  const t = useTranslate()
  const mutations = useAutomationMutations(projectId)
  const run = useRunAction()
  const switching = useServiceSwitch()
  const served = useServedIndex(projectId)
  const nameOf = useTargetName()
  const atRoot = useLaunchHere(served.trees)
  const [error, setError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<Automation | null>(null)
  const [busy, setBusy] = useState(false)

  const fail = (reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason))

  /** Lance une commande à la racine ou dans `worktreeId`, démarre un service, ou un passage d'agent. */
  const launch = (item: Automation, worktreeId: string | null = null) => {
    setError(null)
    const action = actionOf(item)
    if (!action) {
      mutations.run(item).catch(fail)
      return
    }
    run.mutate(
      { action, ...(worktreeId ? { worktreeId } : {}), reveal: false },
      {
        onSuccess: (result) => {
          if (result.terminal && action.kind === 'task') onPanel({ mode: 'run', terminalId: result.terminal.id, back: item.id })
        },
        onError: (reason) => {
          if (!switching.askIfElsewhere(action, reason, atRoot)) fail(reason)
        },
      },
    )
  }

  /** Arrêter, redémarrer, suivre le journal : le journal s'ouvre dans un terminal du panneau. */
  const service = (item: Automation, op: ServiceOp) => {
    const action = actionOf(item)
    if (!action) return
    setError(null)
    run.mutate({ action, op }, { onError: fail })
  }

  /** « Servir… » (SRV-5) : les arbres où basculer un service en marche, et la demande. */
  const serving = (item: Automation): TileServing | null => {
    const action = actionOf(item)
    const row = served.byAutomation.get(item.id) ?? null
    if (!action || !row?.switchable) return null
    return {
      targets: switchTargets(served.trees, row),
      onSwitch: (target) => switching.ask({ action, from: row, to: switchToTree(target, nameOf(target)) }),
    }
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

  return {
    error: error ?? unlessElsewhere(run.error)?.message ?? null,
    launch,
    toggle: (item: Automation, on: boolean) => (on ? launch(item) : service(item, 'stop')),
    service,
    serving,
    servedOf: (item: Automation) => served.byAutomation.get(item.id) ?? null,
    /** « Dupliquer » : l'éditeur sur une copie, pour une nouvelle action. */
    duplicate: (item: Automation) => onPanel({ mode: 'edit', seed: { draft: duplicateDraft(item, t) }, back: null }),
    askDelete: setDeleting,
    dialogs: (
      <>
        {switching.dialog}
        <ConfirmDialog
          open={deleting !== null}
          onOpenChange={(open) => !open && setDeleting(null)}
          title={t('actionsTab.delete.title', { label: deleting?.label ?? '' })}
          confirmLabel={t('actionsTab.delete.confirm')}
          tone="critical"
          busy={busy}
          onConfirm={remove}
        >
          <p className="text-sm text-ink-soft">{t('actionsTab.delete.description')}</p>
        </ConfirmDialog>
      </>
    ),
  }
}

export type ActionGestures = ReturnType<typeof useActionGestures>
