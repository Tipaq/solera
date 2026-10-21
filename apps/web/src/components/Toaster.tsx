import { ShieldQuestion, X } from 'lucide-react'
import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import type { CliRequestKind } from '@solera/protocol'
import { Button, IconButton } from '@solera/ui'
import { conversationPath, useOpenConversationId } from '../lib/conversation-route'
import { useTranslate, type MessageKey } from '../lib/i18n'
import { dismissConversationToasts, dismissToast, pushToast, useToasts, type Toast } from '../lib/toasts'
import { wsClient } from '../lib/ws-client'

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
 * conversation. Le serveur ne les envoie qu'aux onglets visibles et pousse la
 * notification système aux autres appareils.
 */
export function Toaster() {
  const t = useTranslate()
  const toasts = useToasts()
  const open = useOpenConversationId()

  useEffect(() => wsClient.onNotify(pushToast), [])
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
      className="pointer-events-none fixed inset-x-3 top-[calc(var(--sg-safe-top)+0.75rem)] z-50 flex flex-col gap-2 md:left-auto md:w-96"
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
  const t = useTranslate()
  const navigate = useNavigate()
  const { notification } = toast

  return (
    <div role="status" className="surface pointer-events-auto flex gap-3 rounded-lg border border-line p-3 shadow-pop">
      <span aria-hidden className="mt-0.5 shrink-0 text-accent">
        <ShieldQuestion size={16} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-accent">{t(REQUEST_TITLES[notification.request])}</p>
        <p className="mt-0.5 line-clamp-2 text-sm font-medium text-ink">{notification.conversationTitle}</p>
        {notification.detail ? (
          <p className="mt-0.5 truncate text-xs text-ink-faint">{notification.detail}</p>
        ) : null}
        <div className="mt-2.5 flex gap-2">
          <Button
            size="sm"
            onClick={() => {
              dismissToast(toast.id)
              navigate(conversationPath({ id: notification.conversationId, projectId: notification.projectId }))
            }}
          >
            {t('toast.cli.open')}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => dismissToast(toast.id)}>
            {t('toast.later')}
          </Button>
        </div>
      </div>
      <IconButton size="sm" label={t('common.close')} onClick={() => dismissToast(toast.id)}>
        <X size={14} />
      </IconButton>
    </div>
  )
}
