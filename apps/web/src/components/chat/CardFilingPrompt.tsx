import { ArrowRight, Columns3 } from 'lucide-react'
import { useState } from 'react'
import type { CardFilingItem } from '../../lib/chat-fold'
import { decideCardFiling } from '../../lib/conversations'
import { useTranslate, type MessageKey } from '../../lib/i18n'
import { Badge, Button, cx } from '@solera/ui'

/**
 * Un déplacement de cartes qu'un agent propose, et que l'utilisateur accorde.
 *
 * Elle montre **la raison écrite pour chaque carte**, et c'est ce qui distingue cette
 * demande de celle d'un rangement de conversation : le prix d'un déplacement de
 * conversation se calcule, celui d'une carte ne se juge que sur le constat que l'agent
 * rapporte. Une proposition sans raison est refusée en amont ; ici, la raison est donc
 * toujours là, et c'est la seule chose que la personne a vraiment à lire.
 *
 * Le bouton n'apparaît qu'au **propriétaire du projet**, et non du fil : c'est le board
 * qu'on range. Les autres voient la proposition et sa réponse, sans pouvoir trancher.
 */
export function CardFilingPrompt({
  conversationId,
  filing,
  canDecide,
}: {
  conversationId: string
  filing: CardFilingItem
  canDecide: boolean
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const t = useTranslate()

  const STATUS_LABEL: Record<Exclude<CardFilingItem['status'], 'pending'>, string> = {
    accepted: t('cardFiling.status.accepted'),
    refused: t('cardFiling.status.refused'),
    impossible: t('cardFiling.status.impossible'),
  }

  const decide = async (decision: 'accepted' | 'refused') => {
    setBusy(true)
    setError(null)
    try {
      await decideCardFiling(conversationId, filing.id, decision)
    } catch (err) {
      // L'événement `card_filing.resolved` viendra du serveur : on n'anticipe pas l'état
      // ici, sinon l'affichage cesserait d'être un pur fold du journal.
      setError(err instanceof Error ? err.message : t('cardFiling.error.generic'))
      setBusy(false)
    }
  }

  // Accordée, on affiche ce qui a réellement bougé plutôt que ce qui était proposé : une
  // carte a pu partir d'une autre colonne entre le dépôt et le clic, et c'est ce
  // mouvement-là qui est dans le Journal.
  const movedByNumber = new Map(filing.moved.map((move) => [move.number, move]))

  return (
    <div
      className={cx(
        'rounded-lg border p-3',
        filing.status === 'pending'
          ? 'border-accent bg-accent-wash/40 shadow-card'
          : 'border-line bg-surface/60',
      )}
    >
      <div className="flex items-start gap-2.5">
        <Columns3 size={16} className="mt-0.5 shrink-0 text-accent" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">
            {filing.status === 'pending'
              ? t('cardFiling.title.pending', { count: String(filing.cards.length) })
              : t('cardFiling.title.past', { count: String(filing.cards.length) })}
          </p>
          <ul className="mt-1.5 space-y-1.5">
            {filing.cards.map((card) => {
              const applied = movedByNumber.get(card.number)
              const from = applied ? applied.fromColumn : card.fromColumn
              return (
                <li key={card.cardId} className="text-xs">
                  <span className="flex flex-wrap items-center gap-1 text-ink">
                    <span className="font-medium">#{card.number}</span>
                    <span className="min-w-0 truncate">{card.title}</span>
                    <span className="text-ink-faint">{columnLabel(from, t)}</span>
                    <ArrowRight size={11} className="shrink-0 text-ink-faint" />
                    <span className="text-ink-soft">{columnLabel(card.toColumn, t)}</span>
                  </span>
                  <span className="mt-0.5 block text-ink-soft">{card.reason}</span>
                </li>
              )
            })}
          </ul>
          {filing.status === 'impossible' && filing.reason ? (
            <p className="mt-1.5 text-xs text-ink-soft">{reasonLabel(filing.reason, t)}</p>
          ) : null}
        </div>
        {filing.status !== 'pending' ? (
          <Badge tone={filing.status === 'accepted' ? 'positive' : 'neutral'}>
            {STATUS_LABEL[filing.status]}
          </Badge>
        ) : null}
      </div>

      {filing.status === 'pending' && canDecide ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" disabled={busy} onClick={() => void decide('accepted')}>
            {filing.cards.length > 1
              ? t('cardFiling.accept.many', { count: String(filing.cards.length) })
              : t('cardFiling.accept')}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={() => void decide('refused')}
          >
            {t('cardFiling.refuse')}
          </Button>
        </div>
      ) : null}

      {filing.status === 'pending' && !canDecide ? (
        <p className="mt-2 text-xs text-ink-faint">{t('cardFiling.ownerOnly')}</p>
      ) : null}

      {error ? <p className="mt-2 text-xs text-critical">{error}</p> : null}
    </div>
  )
}

/**
 * Les colonnes du board, dans la langue du lecteur : la base n'en stocke que les clés.
 *
 * Table explicite plutôt qu'une clé construite : le catalogue écrit `inProgress` là où la
 * colonne s'appelle `in_progress`, et une interpolation ferait perdre au type `MessageKey`
 * toute capacité à voir une clé manquante.
 */
const COLUMN_KEYS: Record<CardFilingItem['cards'][number]['toColumn'], MessageKey> = {
  todo: 'board.column.todo',
  in_progress: 'board.column.inProgress',
  review: 'board.column.review',
  done: 'board.column.done',
  abandoned: 'board.column.abandoned',
}

function columnLabel(
  column: CardFilingItem['cards'][number]['toColumn'],
  t: (key: MessageKey) => string,
): string {
  return t(COLUMN_KEYS[column])
}

/**
 * Pourquoi une proposition n'a pas pu s'appliquer. Le serveur envoie un code, et non une
 * phrase : le journal est rejoué dans la langue de qui le relit.
 */
function reasonLabel(reason: string, t: (key: MessageKey) => string): string {
  if (reason === 'cards_gone') return t('cardFiling.reason.cardsGone')
  return t('cardFiling.reason.unknown')
}
