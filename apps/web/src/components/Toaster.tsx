import { MessageCircleQuestion, ShieldQuestion, X } from 'lucide-react'
import { useEffect, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import type { CliRequestKind, InAppNotification } from '@solera/protocol'
import { Button, IconButton } from '@solera/ui'
import { conversationPath, useOpenConversationId } from '../lib/conversation-route'
import { openDecision, useAwaiting } from '../lib/decisions'
import { useTranslate, type MessageKey } from '../lib/i18n'
import {
  dismissConversationToasts,
  dismissToast,
  keepDecisionToasts,
  pushToast,
  useToasts,
  type Toast,
} from '../lib/toasts'
import { wsClient } from '../lib/ws-client'
import { decisionQuestion } from './decisions/decision-text'

/** Au-delà, les toasts se résument : une pile qui couvre l'écran ne se lit plus. */
const VISIBLE = 2

const REQUEST_TITLES: Record<CliRequestKind, MessageKey> = {
  permission: 'toast.cli.permission',
  question: 'toast.cli.question',
  elicitation: 'toast.cli.elicitation',
  plan: 'toast.cli.plan',
}

/**
 * Les toasts de l'application, en haut de l'écran : en bas, ils couvriraient la barre
 * de saisie, la leçon de `UpdatePrompt`. Centrés au téléphone, à droite au large.
 *
 * Seul ce qu'un humain doit traiter arrive ici — un CLI qui attend dans une autre
 * conversation, une décision qu'une session demande. Le serveur ne les envoie qu'aux
 * onglets visibles et pousse la notification système aux autres appareils.
 *
 * Sur leur propre couche, `z-[90]` : au-dessus d'un dialogue, parce qu'une demande
 * arrive pendant qu'on lit autre chose, et sous l'infobulle. Elle manque encore à
 * `LAYERS` dans le design system (Tipaq/solera-ds), qui doit l'accueillir.
 */
export function Toaster() {
  const t = useTranslate()
  const toasts = useToasts()
  const open = useOpenConversationId()
  const { data: awaiting, dataUpdatedAt } = useAwaiting()

  useEffect(() => wsClient.onNotify(pushToast), [])
  // Une décision tranchée, dans cet onglet ou ailleurs, a été traitée : son toast part.
  useEffect(() => {
    if (!awaiting) return
    keepDecisionToasts(
      new Set(awaiting.flatMap((entry) => (entry.kind === 'decision' ? [entry.id] : []))),
      dataUpdatedAt,
    )
  }, [awaiting, dataUpdatedAt, toasts])
  // Ouvrir la conversation, par le toast ou par la sidebar, règle ce qu'il annonçait.
  useEffect(() => {
    if (open) dismissConversationToasts(open)
  }, [open, toasts])

  if (toasts.length === 0) return null
  const shown = toasts.slice(-VISIBLE).reverse()
  const hidden = toasts.length - shown.length

  return (
    <section
      aria-label={t('toast.region')}
      className="pointer-events-none fixed inset-x-3 top-[calc(var(--sg-safe-top)+0.75rem)] z-[90] flex flex-col gap-2 md:left-auto md:w-96"
    >
      {shown.map((toast) => (
        <ToastCard key={toast.id} toast={toast} />
      ))}
      {hidden > 0 ? (
        <p className="surface pointer-events-auto self-end rounded-full border border-line px-3 py-1 text-xs text-ink-faint shadow-pop">
          {t('toast.more', { count: hidden })}
        </p>
      ) : null}
    </section>
  )
}

function ToastCard({ toast }: { toast: Toast }) {
  const { notification } = toast
  return notification.kind === 'decision'
    ? <DecisionToast id={toast.id} notification={notification} />
    : <CliRequestToast id={toast.id} notification={notification} />
}

/** La coque commune : icône, contenu, croix. */
function ToastFrame({ id, icon, children }: { id: string; icon: ReactNode; children: ReactNode }) {
  const t = useTranslate()
  return (
    <div role="status" className="surface pointer-events-auto flex gap-3 rounded-lg border border-line p-3 shadow-pop">
      <span aria-hidden className="mt-0.5 shrink-0 text-accent">{icon}</span>
      <div className="min-w-0 flex-1">{children}</div>
      <IconButton size="sm" label={t('common.close')} onClick={() => dismissToast(id)}>
        <X size={14} />
      </IconButton>
    </div>
  )
}

function CliRequestToast({ id, notification }: {
  id: string
  notification: Extract<InAppNotification, { kind: 'cliRequest' }>
}) {
  const t = useTranslate()
  const navigate = useNavigate()
  return (
    <ToastFrame id={id} icon={<ShieldQuestion size={16} />}>
      <p className="text-xs font-medium text-accent">{t(REQUEST_TITLES[notification.request])}</p>
      <p className="mt-0.5 line-clamp-2 text-sm font-medium text-ink">{notification.conversationTitle}</p>
      {notification.detail ? (
        <p className="mt-0.5 truncate text-xs text-ink-faint">{notification.detail}</p>
      ) : null}
      <div className="mt-2.5 flex gap-2">
        <Button
          size="sm"
          onClick={() => {
            dismissToast(id)
            navigate(conversationPath({ id: notification.conversationId, projectId: notification.projectId }))
          }}
        >
          {t('toast.cli.open')}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => dismissToast(id)}>
          {t('toast.later')}
        </Button>
      </div>
    </ToastFrame>
  )
}

/** Une décision demandée : la question, d'où elle vient, et de quoi y répondre sur place. */
function DecisionToast({ id, notification }: {
  id: string
  notification: Extract<InAppNotification, { kind: 'decision' }>
}) {
  const t = useTranslate()
  return (
    <ToastFrame id={id} icon={<MessageCircleQuestion size={16} />}>
      <p className="text-xs font-medium text-accent">{t('toast.decision.title')}</p>
      <p className="mt-0.5 line-clamp-2 text-sm font-medium text-ink">
        {decisionQuestion(notification.question, notification.worktreeBranch, t)}
      </p>
      <p className="mt-0.5 truncate text-xs text-ink-faint">
        {[notification.projectName, notification.conversationTitle].filter(Boolean).join(' · ')}
      </p>
      <div className="mt-2.5 flex gap-2">
        <Button
          size="sm"
          onClick={() => {
            dismissToast(id)
            openDecision(notification.decisionId)
          }}
        >
          {t('toast.decision.answer')}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => dismissToast(id)}>
          {t('toast.later')}
        </Button>
      </div>
    </ToastFrame>
  )
}
