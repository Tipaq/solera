import {
  ExternalLink,
  Loader,
  MoreHorizontal,
  Pencil,
  Play,
  RotateCw,
  ScrollText,
  Server,
  ShieldQuestion,
  Square,
  SquareTerminal,
  Trash2,
  Zap,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import type { ProjectActionDto } from '@solera/protocol'
import {
  actionView,
  describeActionState,
  useApproveAction,
  useDeleteAction,
  useRunAction,
} from '../../lib/actions'
import type { EditorSeed } from '../../lib/action-editor'
import { actionAutomationId, fromAction } from '../../lib/automations'
import { useTranslate } from '../../lib/i18n'
import { ActionEditorDrawer } from '../automations/ActionEditorDrawer'
import { showTerminal } from '../../lib/panel'
import { actionInTree, servedInstances, switchTargets, unlessElsewhere, type ServedInstance } from '../../lib/served'
import { useServedIndex, type ServedData, type ServedRow } from '../../lib/served-query'
import { Badge, Banner, Button, Card, ConfirmDialog, IconButton, Menu, MenuItem, MenuSeparator, cx } from '@solera/ui'
import { ServedLine } from '../automations/served/ServedLine'
import { ServiceInstances } from '../automations/served/ServiceInstances'
import { ServeItems, useTargetName } from '../automations/served/ServeMenu'
import { switchToTree, useHereTree, useLaunchHere, useServiceSwitch, type SwitchRequest } from '../automations/served/SwitchServiceDialog'

/** « + Action » : une commande, à la demande. */
const NEW_ACTION: EditorSeed = { preset: { what: 'command' } }

/**
 * Les actions d'un projet, présentées comme les listes des réglages. Chaque élément
 * porte un seul geste nommé, celui qui compte à cet instant : lancer quand rien ne
 * tourne, arrêter un service en marche, voir la sortie d'une tâche en cours, relire une
 * commande qu'un agent a proposée. Le reste (journal, relance, édition) se range dans
 * son menu.
 *
 * Partagée par l'onglet du panneau et le lanceur de l'en-tête.
 */
export interface ActionHandlers {
  /** Le détail de l'action ; sans, son nom n'est pas un geste. */
  onOpen?: (action: ProjectActionDto) => void
  onReview: (action: ProjectActionDto) => void
  onEdit: (action: ProjectActionDto) => void
  onDelete: (action: ProjectActionDto) => void
  /** « Basculer sur » : le dialogue qui dit ce que la bascule redémarre. */
  onSwitch: (request: SwitchRequest) => void
  /** Un lancement refusé parce que le service tourne ailleurs : vrai si le dialogue s'ouvre. */
  onElsewhere: (action: ProjectActionDto, error: unknown) => boolean
}

export function ActionList({
  projectId,
  actions,
  conversationId,
  handlers,
  compact = false,
}: {
  projectId: string
  actions: ProjectActionDto[]
  /** Dans le lanceur, plus étroit : marges resserrées et geste réduit à son icône. */
  compact?: boolean
  /** Depuis une conversation, l'action tourne dans son worktree. */
  conversationId?: string
  handlers: ActionHandlers
}) {
  const run = useRunAction()
  const served = useServedIndex(projectId)
  const here = useHereTree(served.trees, conversationId)
  // Le refus d'un service qui tourne ailleurs n'est pas une erreur : il ouvre le dialogue.
  const failure = unlessElsewhere(run.error)

  const primary = (action: ProjectActionDto) => {
    const view = actionView(action)
    if (view.primary === 'review') handlers.onReview(action)
    else if (view.primary === 'output' && action.lastRun) showTerminal(action.lastRun.terminalId)
    else {
      run.mutate(
        { action, op: view.primary === 'stop' ? 'stop' : 'run', conversationId },
        { onError: (error) => handlers.onElsewhere(action, error) },
      )
    }
  }

  return (
    <>
      {failure ? (
        <div className="px-3 pt-2">
          <Banner>{failure.message}</Banner>
        </div>
      ) : null}

      <ul className={cx('flex flex-col', compact ? '' : 'gap-2 p-3')}>
        {actions.map((listed) => {
          // Une instance par worktree : le geste vise celle de cet arbre-ci.
          const action = actionInTree(listed, served.trees, here)
          return (
            <ActionRow
              key={action.id}
              projectId={projectId}
              action={action}
              busy={run.isPending && run.variables?.action.id === action.id}
              compact={compact}
              served={served.byAutomation.get(actionAutomationId(action.id)) ?? null}
              instances={servedInstances(fromAction(listed), served.trees)}
              targets={served.trees}
              onSwitch={handlers.onSwitch}
              onOpen={handlers.onOpen ? () => handlers.onOpen!(listed) : undefined}
              onPrimary={() => primary(action)}
              onRun={(op) => run.mutate({ action, op, conversationId })}
              onEdit={() => handlers.onEdit(action)}
              onDelete={() => handlers.onDelete(action)}
            />
          )
        })}
      </ul>
    </>
  )
}

/**
 * Relire, modifier, supprimer : les dialogues d'une liste d'actions, tenus par son
 * hôte et non par la liste. Dans le lanceur, la liste vit dans un popover qui se ferme
 * au premier clic dans un dialogue ; un dialogue qu'elle porterait disparaîtrait avec.
 */
export function useActionDialogs(projectId: string, conversationId?: string) {
  const t = useTranslate()
  const run = useRunAction()
  const approve = useApproveAction()
  const remove = useDeleteAction()
  const [reviewing, setReviewing] = useState<ProjectActionDto | null>(null)
  const [deleting, setDeleting] = useState<ProjectActionDto | null>(null)
  const [editing, setEditing] = useState<ProjectActionDto | 'new' | null>(null)
  const switching = useServiceSwitch()
  const here = useLaunchHere(useServedIndex(projectId).trees, conversationId)
  const failure = approve.error ?? remove.error ?? unlessElsewhere(run.error)
  const seed = useMemo<EditorSeed | null>(
    () => (editing === null ? null : editing === 'new' ? NEW_ACTION : { from: fromAction(editing) }),
    [editing],
  )

  const handlers: ActionHandlers = {
    onReview: setReviewing,
    onEdit: setEditing,
    onDelete: setDeleting,
    onSwitch: switching.ask,
    onElsewhere: (action, error) => switching.askIfElsewhere(action, error, here),
  }

  const dialogs = (
    <>
      {switching.dialog}
      <ActionEditorDrawer projectId={projectId} seed={seed} conversationId={conversationId} onClose={() => setEditing(null)} />

      <ConfirmDialog
        open={reviewing !== null}
        onOpenChange={(open) => { if (!open) setReviewing(null) }}
        title={t('actions.review.title', { label: reviewing?.label ?? '' })}
        confirmLabel={t('actions.review.confirm')}
        busy={approve.isPending}
        onConfirm={() => {
          const action = reviewing
          setReviewing(null)
          if (!action) return
          approve.mutate(action.id, {
            onSuccess: (approved) =>
              run.mutate({ action: approved, conversationId }, { onError: (error) => handlers.onElsewhere(approved, error) }),
          })
        }}
      >
        <p>
          {t(reviewing?.kind === 'service' ? 'actions.review.bodyService' : 'actions.review.bodyTask', {
            title: reviewing?.agentConversationTitle ?? t('actions.proposedInGone'),
          })}
        </p>
        <pre className="max-h-48 overflow-auto rounded-md border border-line bg-sunken px-3 py-2 font-mono text-xs break-all whitespace-pre-wrap text-ink">
          {reviewing?.subdir ? `${reviewing.subdir}/ $ ` : '$ '}
          {reviewing?.command}
        </pre>
        {reviewing?.url ? (
          <p className="text-xs text-ink-faint">{t('actions.opensAt', { url: reviewing.url })}</p>
        ) : null}
      </ConfirmDialog>

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => { if (!open) setDeleting(null) }}
        title={t('actions.delete.title', { label: deleting?.label ?? '' })}
        confirmLabel={t('actions.delete.confirm')}
        tone="critical"
        busy={remove.isPending}
        onConfirm={() => {
          if (deleting) remove.mutate(deleting.id)
          setDeleting(null)
        }}
      >
        <p>{t(deleting?.kind === 'service' ? 'actions.delete.bodyService' : 'actions.delete.bodyTask')}</p>
      </ConfirmDialog>
    </>
  )

  return { handlers, create: () => setEditing('new'), dialogs, failure }
}

type RunOp = 'run' | 'stop' | 'restart' | 'logs'

const PRIMARY = {
  review: { label: 'actions.review', icon: <ShieldQuestion size={14} /> },
  run: { label: 'actions.run', icon: <Play size={14} /> },
  stop: { label: 'actions.stop', icon: <Square size={13} /> },
  output: { label: 'actions.showOutput', icon: <SquareTerminal size={14} /> },
} as const

/**
 * Une action, sous la forme des éléments de liste des réglages : tuile d'icône, nom et
 * badges, commande, état, puis le geste du moment en bouton nommé et le reste au menu.
 */
function ActionRow({
  projectId,
  action,
  busy,
  compact,
  served,
  instances,
  targets,
  onSwitch,
  onOpen,
  onPrimary,
  onRun,
  onEdit,
  onDelete,
}: {
  projectId: string
  action: ProjectActionDto
  busy: boolean
  compact: boolean
  /** Ce qu'il sert, s'il tourne. */
  served: ServedRow | null
  /** Une instance par worktree : toutes les siennes, à la place de ce qu'il sert. */
  instances: ServedInstance<ServedData['trees'][number]>[]
  /** Les arbres du projet, d'où tirer ceux où le basculer. */
  targets: ServedData['trees']
  onSwitch: (request: SwitchRequest) => void
  onOpen?: () => void
  onPrimary: () => void
  onRun: (op: RunOp) => void
  onEdit: () => void
  onDelete: () => void
}) {
  const t = useTranslate()
  const view = actionView(action)
  const isService = action.kind === 'service'
  const primary = PRIMARY[view.primary]
  const nameOf = useTargetName()
  const switchable = served?.switchable ? switchTargets(targets, served) : []

  const body = (
        <div className={cx('flex items-start gap-3', compact ? 'px-3 py-2.5' : 'px-5 py-4')}>
          <span
            className={cx(
              'mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md',
              view.live ? 'bg-positive/15 text-positive' : 'bg-accent-wash text-accent',
            )}
          >
            {isService ? <Server size={15} /> : <Zap size={15} />}
          </span>

          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              {onOpen ? (
                <button type="button" onClick={onOpen} className="text-left font-medium hover:underline focus-visible:outline-2 focus-visible:outline-accent">
                  {action.label}
                </button>
              ) : (
                <span className="font-medium">{action.label}</span>
              )}
              {action.status === 'proposed' ? <Badge tone="caution">{t('actions.badge.proposed')}</Badge> : null}
              {isService && view.live ? <Badge tone="positive">{t('actions.badge.running')}</Badge> : null}
              {view.failed ? <Badge tone="critical">{t('actions.badge.failed')}</Badge> : null}
            </div>
            {compact ? null : (
              <p title={action.command} className="truncate font-mono text-xs text-ink-faint">
                {action.subdir ? `${action.subdir}/ · ` : ''}
                {action.command}
              </p>
            )}
            {view.href ? (
              <a
                href={view.href}
                target="_blank"
                rel="noreferrer"
                className="flex min-w-0 items-center gap-1 text-xs text-accent hover:underline"
              >
                <span className="truncate">{view.href.replace(/^https?:\/\//, '')}</span>
                <ExternalLink size={12} className="shrink-0" />
              </a>
            ) : null}
            <p className="text-xs text-ink-faint">{describeActionState(action, t)}</p>
            {instances.length ? (
              <ServiceInstances projectId={projectId} instances={instances} className="mt-1" />
            ) : served ? (
              <ServedLine served={served} className="max-w-full" />
            ) : null}
          </div>

          <div className="flex shrink-0 items-center gap-1">
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              aria-label={`${t(primary.label)} : ${action.label}`}
              icon={busy ? <Loader size={14} className="animate-spin" /> : primary.icon}
              onClick={onPrimary}
            >
              <span className={cx(compact && 'sr-only')}>{t(primary.label)}</span>
            </Button>
            <Menu trigger={<IconButton label={t('actions.more')} size="sm"><MoreHorizontal size={16} /></IconButton>}>
              {isService && view.live ? (
                <MenuItem icon={<RotateCw size={15} />} onSelect={() => onRun('restart')}>
                  {t('actions.restart')}
                </MenuItem>
              ) : null}
              {served && switchable.length > 0 ? (
                <>
                  <ServeItems targets={switchable} onSwitch={(tree) => onSwitch({ action, from: served, to: switchToTree(tree, nameOf(tree)) })} />
                  <MenuSeparator />
                </>
              ) : null}
              {isService && (view.live || view.failed) ? (
                <MenuItem icon={<ScrollText size={15} />} onSelect={() => onRun('logs')}>
                  {t('actions.logs')}
                </MenuItem>
              ) : null}
              {!isService && action.lastRun ? (
                <MenuItem icon={<SquareTerminal size={15} />} onSelect={() => showTerminal(action.lastRun!.terminalId)}>
                  {t('actions.showOutput')}
                </MenuItem>
              ) : null}
              <MenuItem icon={<Pencil size={15} />} onSelect={onEdit}>
                {t('actions.edit')}
              </MenuItem>
              <MenuSeparator />
              <MenuItem icon={<Trash2 size={15} />} tone="critical" onSelect={onDelete}>
                {t('actions.delete')}
              </MenuItem>
            </Menu>
          </div>
        </div>
  )

  // Dans le lanceur, une carte par action ferait une pile de boîtes dans une boîte :
  // même anatomie, séparée par des filets.
  return compact ? <li className="border-b border-line last:border-b-0">{body}</li> : <li><Card>{body}</Card></li>
}
