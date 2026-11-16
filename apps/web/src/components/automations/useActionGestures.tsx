import { useState } from 'react'
import { ConfirmDialog } from '@solera/ui'
import type { EditorSeed } from '../../lib/action-editor'
import { useRunAction } from '../../lib/actions'
import { detailPanel, type ActionPanel } from '../../lib/action-panel'
import { actionOf, duplicateDraft, type Automation } from '../../lib/automations'
import { useAutomationMutations } from '../../lib/automations-query'
import { useTranslate } from '../../lib/i18n'
import { useRunSchedule } from '../../lib/schedules'
import { useServedIndex } from '../../lib/served-query'
import { switchTargets, unlessElsewhere, type ServedTree } from '../../lib/served'
import { useTargetName } from './served/ServeMenu'
import { switchToTree, useLaunchHere, useServiceSwitch } from './served/SwitchServiceDialog'

/** Ce qu'un service accepte en plus de démarrer : arrêter, redémarrer, suivre son journal (Q1). */
export type ServiceOp = 'stop' | 'restart' | 'logs'

/** « Servir… » d'un service en marche : les arbres où le basculer. */
export interface ActionServing {
  targets: ServedTree[]
  onSwitch: (tree: ServedTree) => void
}

/** Ce qu'une tuile ou une ligne de l'onglet sait faire d'une action. */
export interface ActionHandlers {
  onOpen: (item: Automation, review?: boolean) => void
  onEdit: (seed: EditorSeed) => void
  onLaunch: (item: Automation, worktreeId: string | null) => void
  /** « Lancer sans vérifier » : une tâche d'agent dont le script de vérification est validé. */
  onLaunchUnchecked: (item: Automation) => void
  onToggle: (item: Automation, on: boolean) => void
  onService: (item: Automation, op: ServiceOp) => void
  onTerminal: (item: Automation, terminalId: string) => void
  onDuplicate: (item: Automation) => void
  onDelete: (item: Automation) => void
}

/**
 * Les gestes d'une action posés hors du tiroir, sur une tuile du Lanceur ou une ligne de
 * la Liste de l'onglet Actions : lancer (là où le chevron le dit), l'interrupteur d'un
 * service et sa bascule d'un arbre à l'autre, son journal, dupliquer, supprimer.
 *
 * Hors conversation, un lancement part à la racine du projet, ou dans le worktree choisi.
 * Depuis le panneau d'une conversation (`conversationId`), il part dans son worktree, et
 * un service s'y démarre et s'y arrête selon son placement (PACT-7). Une commande lancée
 * ouvre son passage dans le tiroir (`onPanel`, mode `run`). Un service qui tourne déjà
 * ailleurs ouvre le dialogue de bascule au lieu de se taire (SRV-4).
 *
 * Les gestes sont rendus en `handlers`, prêts pour `ActionTile`, `ActionRow` et `ActionLine`. L'hôte rend
 * `dialogs` (la bascule, la confirmation de suppression) hors des menus qui les ont
 * ouverts, et `error` en tête de sa vue.
 */
export function useActionGestures(projectId: string, onPanel: (panel: ActionPanel) => void, { conversationId }: { conversationId?: string } = {}) {
  const t = useTranslate()
  const mutations = useAutomationMutations(projectId)
  const run = useRunAction()
  const runTask = useRunSchedule()
  const switching = useServiceSwitch()
  const served = useServedIndex(projectId)
  const nameOf = useTargetName()
  // Là où « Basculer » redémarrerait le service : l'arbre de la conversation, sinon la racine.
  const here = useLaunchHere(served.trees, conversationId)
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
    const where = conversationId ? { conversationId } : worktreeId ? { worktreeId } : {}
    run.mutate(
      { action, ...where, reveal: false },
      {
        onSuccess: (result) => {
          if (result.terminal && action.kind === 'task') onPanel({ mode: 'run', terminalId: result.terminal.id, back: item.id })
        },
        onError: (reason) => {
          if (!switching.askIfElsewhere(action, reason, here)) fail(reason)
        },
      },
    )
  }

  /** Arrêter, redémarrer, suivre le journal : le journal s'ouvre dans un terminal du panneau. */
  const service = (item: Automation, op: ServiceOp) => {
    const action = actionOf(item)
    if (!action) return
    setError(null)
    run.mutate({ action, op, ...(conversationId ? { conversationId } : {}) }, { onError: fail })
  }

  /** « Servir… » (SRV-5) : les arbres où basculer un service en marche, et la demande. */
  const serving = (item: Automation): ActionServing | null => {
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

  const handlers: ActionHandlers = {
    onOpen: (item, review) => onPanel(detailPanel(item.id, review)),
    onEdit: (seed) => onPanel({ mode: 'edit', seed, back: null }),
    onLaunch: launch,
    onLaunchUnchecked: (item) => {
      if (item.source.kind !== 'task') return
      setError(null)
      runTask.mutate({ id: item.source.task.id, skipCheck: true }, { onError: fail })
    },
    onToggle: (item, on) => (on ? launch(item) : service(item, 'stop')),
    onService: service,
    onTerminal: (item, terminalId) => onPanel({ mode: 'run', terminalId, back: item.id }),
    onDuplicate: (item) => onPanel({ mode: 'edit', seed: { draft: duplicateDraft(item, t) }, back: null }),
    onDelete: setDeleting,
  }

  return {
    handlers,
    error: error ?? unlessElsewhere(run.error)?.message ?? null,
    serving,
    servedOf: (item: Automation) => served.byAutomation.get(item.id) ?? null,
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
