import { ArrowUpRight, Columns3, FolderInput, MessageCircleQuestion } from 'lucide-react'
import { NavLink } from 'react-router-dom'
import type { AwaitingRequestDto } from '@solera/protocol'
import { conversationPath } from '../../lib/conversation-route'
import { decisionDue, openDecision, useAwaiting } from '../../lib/decisions'
import { formatAgo } from '../../lib/loops'
import { useTranslate } from '../../lib/i18n'
import { StateDot } from '../chat/Signals'
import { cx } from '@solera/ui'
import { decisionQuestion } from '../decisions/decision-text'

/**
 * Au-delà, le reste est **compté** plutôt que listé, comme l'activité : la colonne ne
 * doit pas devenir la file. Deux au doigt, où chaque ligne coûte 44 px.
 */
const SHOWN = 5
const SHOWN_COARSE = 2

const ROW =
  'flex h-11 w-full items-center gap-2 rounded-md px-1.5 pl-2.5 text-left text-sm text-ink-soft transition-colors hover:bg-surface-high hover:text-ink md:h-8 pointer-coarse:h-11'

/**
 * « À décider » : les demandes d'agent qui attendent une personne — les décisions
 * (`request_decision`) et les deux rangements qu'un clic accorde.
 *
 * **La section n'existe que s'il y a quelque chose**, la règle du bandeau d'un lieu :
 * elle dit une demande, jamais un inventaire, et c'est son apparition qui la rend
 * visible. Posée entre les lieux et l'activité, au-dessus de ce qui ne fait que tourner.
 *
 * Une décision se tranche d'ici, dans son dialogue ; un rangement mène à la conversation
 * où se trouve déjà son bouton d'accord, plutôt que d'en recopier un second.
 */
export function SidebarAwaiting({ onNavigate, coarse = false }: {
  onNavigate: () => void
  /** Vrai au doigt : la section est coupée à deux lignes. */
  coarse?: boolean
}) {
  const t = useTranslate()
  const { data } = useAwaiting()
  const requests = data ?? []
  if (requests.length === 0) return null

  const shown = coarse ? SHOWN_COARSE : SHOWN
  const rest = requests.length - shown

  return (
    <section
      aria-label={t('awaiting.heading')}
      className="shrink-0 border-b border-line px-2 py-1.5"
    >
      {/* Même en-tête que l'activité : il mène à l'historique des décisions, la seule
          liste complète de ce que la section résume. */}
      <NavLink
        to="/decisions"
        onClick={onNavigate}
        className="flex h-8 w-full items-center gap-2 rounded-md px-1.5 text-left transition-colors hover:bg-surface-high"
      >
        <MessageCircleQuestion size={14} className="shrink-0 text-caution" />
        <span className="flex-1 text-meta font-semibold uppercase tracking-wider text-ink-faint">
          {t('awaiting.heading')}
        </span>
        <span className="flex items-center gap-1 rounded-full bg-caution/12 px-1.5 py-px text-meta font-medium tabular-nums text-caution">
          <StateDot state="awaiting" labelled={false} />
          <span aria-hidden>{requests.length}</span>
          <span className="sr-only">{t('awaiting.count', { count: requests.length })}</span>
        </span>
        <ArrowUpRight size={14} className="shrink-0 text-ink-faint" />
      </NavLink>

      <ul>
        {requests.slice(0, shown).map((request) => (
          <li key={request.id}>
            <AwaitingLine request={request} onNavigate={onNavigate} />
          </li>
        ))}
      </ul>

      {rest > 0 ? (
        <NavLink
          to="/decisions"
          onClick={onNavigate}
          className="flex h-8 w-full items-center gap-2 rounded-md px-1.5 text-left text-xs text-ink-faint transition-colors hover:bg-surface-high hover:text-ink"
        >
          <MessageCircleQuestion size={14} className="shrink-0" />
          {t('awaiting.more', { count: rest })}
        </NavLink>
      ) : null}
    </section>
  )
}

/**
 * Une demande en 32 px : son genre en icône, ce qu'elle demande, et pour une décision
 * le temps qu'il lui reste — c'est le seul des trois genres qui expire.
 */
function AwaitingLine({ request, onNavigate }: {
  request: AwaitingRequestDto
  onNavigate: () => void
}) {
  const t = useTranslate()

  if (request.kind === 'decision') {
    const question = decisionQuestion(request.question, request.worktreeBranch, t)
    return (
      <button
        type="button"
        onClick={() => openDecision(request.id)}
        title={`${question} — ${decisionDue(request.expiresAt)}`}
        className={ROW}
      >
        <MessageCircleQuestion size={14} className="shrink-0 text-ink-faint" />
        <span className="min-w-0 flex-1 truncate">{question}</span>
        {/* Le temps restant seul : la phrase entière est dans l'infobulle, et la colonne
            n'a pas la place de la porter à côté de la question. */}
        {request.expiresAt !== null ? (
          <span className="shrink-0 text-meta tabular-nums text-ink-faint">
            {formatAgo(Math.max(0, request.expiresAt - Date.now()))}
          </span>
        ) : null}
      </button>
    )
  }

  const label =
    request.kind === 'request_card_change'
      ? t(request.count > 1 ? 'awaiting.cardMove.other' : 'awaiting.cardMove.one', { count: request.count })
      : request.kind === 'propose_cards'
        ? t(request.count > 1 ? 'awaiting.cardDraft.other' : 'awaiting.cardDraft.one', { count: request.count })
        : t('awaiting.moveConversation')
  return (
    <NavLink
      to={conversationPath({ id: request.conversationId, projectId: request.projectId })}
      onClick={onNavigate}
      title={`${label} — ${request.conversationTitle}`}
      className={({ isActive }) => cx(ROW, isActive && 'bg-accent-wash text-ink')}
    >
      {request.kind === 'request_card_change' || request.kind === 'propose_cards'
        ? <Columns3 size={14} className="shrink-0 text-ink-faint" />
        : <FolderInput size={14} className="shrink-0 text-ink-faint" />}
      <span className="min-w-0 flex-1 truncate">{request.conversationTitle}</span>
      <span className="shrink-0 truncate text-meta text-ink-faint">{label}</span>
    </NavLink>
  )
}
