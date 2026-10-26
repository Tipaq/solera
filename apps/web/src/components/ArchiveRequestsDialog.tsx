import { useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import type { PendingRequestCounts, PendingRequestsDto } from '@solera/protocol'
import { Button, ConfirmDialog } from '@solera/ui'
import { api } from '../lib/api'
import { conversationPath } from '../lib/conversation-route'
import { useArchiveConversation } from '../lib/conversations'
import { useTranslate, type MessageKey } from '../lib/i18n'

/**
 * La fenêtre d'avant l'archivage, quand des demandes attendent (#119).
 *
 * Archiver un fil retire ses demandes en attente : une décision retirée n'applique pas
 * son défaut, un rangement ou un brouillon ne s'appliquera plus. Rien ne doit partir sans
 * avoir été vu, d'où cette fenêtre — mais seulement quand il y a quelque chose à perdre :
 * une fenêtre à chaque archivage finirait cliquée sans être lue.
 *
 * Un seul récapitulatif pour un lot, plutôt qu'une fenêtre par fil.
 */
export function ArchiveRequestsDialog({
  pending,
  busy = false,
  onShow,
  onConfirm,
  onClose,
}: {
  /** Les fils qui ont des demandes en attente, et seulement eux. */
  pending: PendingRequestsDto['conversations']
  busy?: boolean
  /** « Voir les demandes » : ouvre le fil qui les porte. */
  onShow: () => void
  onConfirm: () => void
  onClose: () => void
}) {
  const t = useTranslate()
  const total = sum(pending)
  const count = total.decision + total.cardChange + total.cardDraft + total.move
  const details = (Object.keys(KIND_KEYS) as (keyof PendingRequestCounts)[])
    .filter((kind) => total[kind] > 0)
    .map((kind) => t(KIND_KEYS[kind][total[kind] > 1 ? 1 : 0], { count: String(total[kind]) }))
    .join(', ')

  return (
    <ConfirmDialog
      open
      onOpenChange={(open: boolean) => {
        if (!open) onClose()
      }}
      title={t('archive.requests.title')}
      confirmLabel={t('archive.requests.confirm')}
      tone="critical"
      busy={busy}
      onConfirm={onConfirm}
    >
      <p>
        {pending.length > 1
          ? t('archive.requests.batch', { threads: String(pending.length), count: String(count), details })
          : t(count > 1 ? 'archive.requests.single.many' : 'archive.requests.single.one', { count: String(count), details })}
      </p>
      <p>{t('archive.requests.note')}</p>
      <div>
        <Button size="sm" variant="secondary" onClick={onShow}>
          {t('archive.requests.show')}
        </Button>
      </div>
    </ConfirmDialog>
  )
}

const KIND_KEYS: Record<keyof PendingRequestCounts, [MessageKey, MessageKey]> = {
  decision: ['archive.requests.decision.one', 'archive.requests.decision.many'],
  cardChange: ['archive.requests.cardChange.one', 'archive.requests.cardChange.many'],
  cardDraft: ['archive.requests.cardDraft.one', 'archive.requests.cardDraft.many'],
  move: ['archive.requests.move.one', 'archive.requests.move.many'],
}

function sum(pending: PendingRequestsDto['conversations']): PendingRequestCounts {
  const total = { decision: 0, cardChange: 0, cardDraft: 0, move: 0 }
  for (const entry of pending) {
    total.decision += entry.decision
    total.cardChange += entry.cardChange
    total.cardDraft += entry.cardDraft
    total.move += entry.move
  }
  return total
}

/**
 * Archiver un ou plusieurs fils, en passant par la fenêtre quand des demandes attendent.
 *
 * Le compte se relit au geste et non à l'affichage du menu : une demande a pu arriver
 * depuis. Le serveur, lui, ne refuse rien — il retire au balayage ce qu'un fil archivé
 * laisse en attente, quel que soit le chemin qui l'a archivé.
 */
export function useGuardedArchive(): {
  archive: (ids: string[]) => void
  dialog: ReactNode
  pending: boolean
  error: unknown
} {
  const archive = useArchiveConversation()
  const navigate = useNavigate()
  const [ask, setAsk] = useState<{ ids: string[]; pending: PendingRequestsDto['conversations'] } | null>(null)
  const [error, setError] = useState<unknown>(null)

  const commit = async (ids: string[]) => {
    try {
      for (const id of ids) await archive.mutateAsync({ id, archived: true })
      setAsk(null)
    } catch (err) {
      setError(err)
    }
  }

  const start = (ids: string[]) => {
    setError(null)
    void api
      .get<PendingRequestsDto>(`/api/conversations/pending-requests?ids=${ids.map(encodeURIComponent).join(',')}`)
      .then(({ conversations }) => {
        if (conversations.length === 0) void commit(ids)
        else setAsk({ ids, pending: conversations })
      })
      .catch(setError)
  }

  const dialog = ask ? (
    <ArchiveRequestsDialog
      pending={ask.pending}
      busy={archive.isPending}
      onShow={() => {
        const first = ask.pending[0]!
        setAsk(null)
        navigate(conversationPath(first))
      }}
      onConfirm={() => void commit(ask.ids)}
      onClose={() => setAsk(null)}
    />
  ) : null

  return { archive: start, dialog, pending: archive.isPending, error: error ?? archive.error }
}
