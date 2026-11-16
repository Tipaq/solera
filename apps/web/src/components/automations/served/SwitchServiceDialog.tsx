import { ArrowUpRight } from 'lucide-react'
import { Fragment, useState, type ReactNode } from 'react'
import type { ProjectActionDto } from '@solera/protocol'
import { ConfirmDialog } from '@solera/ui'
import { useRunAction } from '../../../lib/actions'
import { useConversation } from '../../../lib/conversations'
import { useTranslate } from '../../../lib/i18n'
import { runningElsewhereOf, servedName, type ServedTree, type ServedVersion } from '../../../lib/served'
import { WebLink } from '../../WebLink'
import { useTargetName } from './ServeMenu'

/** Ce qui tourne : un service en marche (`ServedVersion`) ou le corps d'un 409. */
export type SwitchFrom = Pick<ServedVersion, 'root' | 'branch' | 'cwd' | 'ports' | 'href'>

/** Où le servir à la place : un worktree, celui d'une conversation, sinon la racine. */
export interface SwitchTo {
  /** « feat/b », « la racine (main) » ; null quand on ne sait pas le nommer. */
  name: string | null
  worktreeId?: string
  conversationId?: string
}

export interface SwitchRequest {
  action: ProjectActionDto
  from: SwitchFrom
  to: SwitchTo
}

/**
 * Où un lancement d'ici partirait : le worktree de la conversation, sinon la racine,
 * nommé comme « Basculer sur » le nomme.
 */
export function useLaunchHere(trees: readonly ServedTree[], conversationId?: string): SwitchTo {
  const nameOf = useTargetName()
  const tree = useHereTree(trees, conversationId)
  return { name: tree ? nameOf(tree) : null, ...(conversationId ? { conversationId } : {}) }
}

/** L'arbre d'où l'on lance : celui de la conversation, la racine hors conversation. */
export function useHereTree<T extends ServedTree>(trees: readonly T[], conversationId?: string): T | null {
  const { data: conversation } = useConversation(conversationId)
  const worktreeId = conversation?.worktreeId ?? null
  return trees.find((entry) => (worktreeId ? entry.id === worktreeId : entry.root)) ?? null
}

/** Vers un arbre choisi dans « Basculer sur » : son worktree, ou la racine. */
export function switchToTree(tree: ServedTree, name: string): SwitchTo {
  return { name, ...(tree.id ? { worktreeId: tree.id } : {}) }
}

/**
 * Basculer un service d'un arbre à l'autre (SRV-4, SRV-5) : un lancement qui tombe sur
 * un service en marche ailleurs ne se tait plus. `ask` ouvre le dialogue depuis « Servir… »,
 * `askIfElsewhere` depuis l'erreur d'un lancement (409 `service_running_elsewhere`) ;
 * confirmer relance avec `switch: true`, ce qui arrête l'unité et la redémarre là.
 *
 * Le dialogue est rendu par l'hôte (`dialog`) et non par le geste : un menu ou un
 * popover qui se ferme l'emporterait avec lui.
 */
export function useServiceSwitch() {
  const [request, setRequest] = useState<SwitchRequest | null>(null)
  const run = useRunAction()
  const close = () => {
    setRequest(null)
    run.reset()
  }
  return {
    ask: (next: SwitchRequest) => {
      run.reset()
      setRequest(next)
    },
    /** Vrai quand l'erreur était un service en marche ailleurs : le dialogue s'ouvre. */
    askIfElsewhere: (action: ProjectActionDto, error: unknown, to: SwitchTo): boolean => {
      const from = runningElsewhereOf(error)
      if (!from) return false
      run.reset()
      setRequest({ action, from, to })
      return true
    },
    dialog: (
      <SwitchServiceDialog
        request={request}
        busy={run.isPending}
        error={run.error?.message ?? null}
        onClose={close}
        onConfirm={() => {
          if (!request) return
          const { action, to } = request
          run.mutate(
            { action, switch: true, ...(to.conversationId ? { conversationId: to.conversationId } : to.worktreeId ? { worktreeId: to.worktreeId } : {}) },
            { onSuccess: () => setRequest(null) },
          )
        }}
      />
    ),
  }
}

/** Remplace les `{marqueurs}` d'un gabarit par des nœuds : le nom en code, le verbe en gras. */
function withNodes(template: string, nodes: Record<string, ReactNode>): ReactNode[] {
  return template.split(/\{(\w+)\}/g).map((part, index) => (index % 2 === 1 ? <Fragment key={index}>{nodes[part] ?? `{${part}}`}</Fragment> : part))
}

/**
 * « « Dev » sert déjà feat/a » : ce qui tourne, où, et que basculer le redémarre ;
 * « Ouvrir plutôt celui qui tourne ↗ » quand on sait où il écoute.
 */
export function SwitchServiceDialog({
  request,
  busy = false,
  error = null,
  onClose,
  onConfirm,
}: {
  request: SwitchRequest | null
  busy?: boolean
  error?: string | null
  onClose: () => void
  onConfirm: () => void
}) {
  const t = useTranslate()
  const from = request?.from
  const fromName = from ? servedName(t, from) : ''
  const toName = request?.to.name ?? t('served.dialog.here')
  const code = (text: string) => <code className="font-mono text-xs text-ink">{text}</code>
  return (
    <ConfirmDialog
      open={request !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      title={request ? t('served.dialog.title', { label: request.action.label, from: fromName }) : ''}
      confirmLabel={t('served.dialog.confirm', { to: toName })}
      busy={busy}
      onConfirm={onConfirm}
    >
      {from ? (
        <div className="flex flex-col gap-3 text-sm text-ink-soft">
          <p>
            {withNodes(t(from.ports.length ? 'served.dialog.body' : 'served.dialog.bodyNoPort'), {
              from: <span title={from.cwd ?? undefined}>{code(from.branch && !from.root ? from.branch : fromName)}</span>,
              ports: <span className="tabular-nums">{from.ports.map((port) => `:${port}`).join(' ')}</span>,
              to: code(toName),
              restart: <strong className="font-medium text-ink">{t('served.dialog.restart')}</strong>,
            })}
          </p>
          {from.href ? (
            // Le clic remonte jusqu'ici une fois le lien suivi : le dialogue se ferme.
            <span className="w-fit" onClick={onClose}>
              <WebLink href={from.href} className="inline-flex items-center gap-1 text-xs text-accent hover:underline">
                {t('served.dialog.open')} <ArrowUpRight size={12} aria-hidden />
              </WebLink>
            </span>
          ) : null}
          {error ? <p className="text-xs text-critical">{error}</p> : null}
        </div>
      ) : null}
    </ConfirmDialog>
  )
}
