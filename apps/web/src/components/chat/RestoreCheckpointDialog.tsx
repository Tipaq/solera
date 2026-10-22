import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { TurnCheckpoint } from '../../lib/chat-fold'
import { restoreCheckpoint } from '../../lib/checkpoints'
import { conversationPath } from '../../lib/conversation-route'
import { forkConversation } from '../../lib/conversations'
import { useTranslate } from '../../lib/i18n'
import { Banner, ConfirmDialog } from '@solera/ui'

/**
 * Confirmation avant de ramener le workspace à l'état d'avant un tour.
 *
 * Le geste réécrit des fichiers sans que l'agent le sache : il garde le souvenir de ce
 * qu'il a écrit. D'où la case qui propose de brancher la conversation juste avant le
 * message du tour, pendant conversationnel du retour arrière : la branche repart d'un
 * agent qui n'a jamais vu ces fichiers, et le message du tour revient dans sa barre de
 * saisie pour être reformulé.
 */
export function RestoreCheckpointDialog({
  conversationId,
  checkpoint,
  openerText,
  onClose,
}: {
  conversationId: string
  /** Null quand le dialogue est fermé. */
  checkpoint: TurnCheckpoint | null
  /** Texte du message qui a ouvert le tour, repris en brouillon de la branche. */
  openerText: string
  onClose: () => void
}) {
  const t = useTranslate()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [fork, setFork] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Chaque ouverture repart propre : la case cochée pour un tour ne vaut pas pour le suivant.
  useEffect(() => {
    if (checkpoint) {
      setFork(false)
      setError(null)
    }
  }, [checkpoint])

  const confirm = async () => {
    if (!checkpoint) return
    setBusy(true)
    setError(null)
    try {
      await restoreCheckpoint(conversationId, checkpoint.key)
      // Le disque a changé sous la vue Git et l'onglet Fichiers : tout ce qu'ils lisent se relit.
      void queryClient.invalidateQueries({
        predicate: (query) => {
          const head = query.queryKey[0]
          return typeof head === 'string' && (head.startsWith('git-') || head === 'tree')
        },
      })
      if (fork) {
        // Coupe avant la capture d'avant, qui précède le message du tour : gardée, elle
        // attendrait dans la branche un message d'ouverture et prendrait le suivant.
        const branch = await forkConversation(conversationId, checkpoint.seq - 1)
        void queryClient.invalidateQueries({ queryKey: ['conversations'] })
        onClose()
        navigate(conversationPath(branch), { state: { draft: openerText } })
        return
      }
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('checkpoint.restore.error'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <ConfirmDialog
      open={checkpoint !== null}
      onOpenChange={(next) => {
        if (!next && !busy) onClose()
      }}
      title={t('checkpoint.restore.confirm.title')}
      confirmLabel={t('checkpoint.restore.confirm.action')}
      tone="critical"
      busy={busy}
      onConfirm={() => void confirm()}
    >
      <p>
        {checkpoint && checkpoint.files.length > 1
          ? t('checkpoint.restore.confirm.body.many', { count: checkpoint.files.length })
          : t('checkpoint.restore.confirm.body.one')}
      </p>
      <p>{t('checkpoint.restore.confirm.commits')}</p>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={fork}
          disabled={busy}
          onChange={(event) => setFork(event.target.checked)}
        />
        <span>
          <span className="font-medium">{t('checkpoint.restore.fork.label')}</span>
          <br />
          <span className="text-ink-faint">{t('checkpoint.restore.fork.hint')}</span>
        </span>
      </label>
      {error ? <Banner>{error}</Banner> : null}
    </ConfirmDialog>
  )
}
