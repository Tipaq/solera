import { SquareKanban } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { Button, EmptyState } from '@solera/ui'
import { useCards } from '../../lib/cards'
import { useTranslate } from '../../lib/i18n'
import { CardDetail } from '../board/CardDetail'

/**
 * La carte que cette session traite, dans le panneau.
 *
 * Même contenu que le tiroir du board — édition comprise — et non un résumé en lecture
 * seule : une description qu'on ne peut que lire oblige à quitter le fil pour la
 * corriger, au moment précis où l'on vient de découvrir ce qui manquait dedans.
 *
 * Une conversation ne traite **qu'une** carte : `conversations.card_id` est une colonne
 * simple, et c'est l'inverse qui est multiple — une carte porte plusieurs sessions,
 * listées ici sous l'onglet *Sessions*. L'onglet n'a donc jamais de liste à montrer,
 * seulement une carte ou rien.
 */
export function CardPane({
  projectId,
  conversationId,
  cardId,
}: {
  projectId: string
  conversationId: string
  /** Null quand la session ne traite aucune carte, ce qui est le cas ordinaire. */
  cardId: string | null
}) {
  const t = useTranslate()
  const navigate = useNavigate()
  // La liste du projet plutôt qu'une route par carte : le board la tient déjà en cache,
  // et aller de la carte à ses voisines référencées se fait alors sans requête.
  const { data: cards } = useCards(cardId ? projectId : undefined)
  const card = cardId ? cards?.find((entry) => entry.id === cardId) : undefined
  const openOnBoard = (number: number) => navigate(`/p/${projectId}/board?carte=${number}`)

  if (!cardId) {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto">
        <EmptyState
          icon={<SquareKanban size={22} />}
          title={t('panel.card.none')}
          description={t('panel.card.none.hint')}
          action={
            <Button size="sm" variant="secondary" onClick={() => navigate(`/p/${projectId}/board`)}>
              {t('panel.card.openBoard')}
            </Button>
          }
        />
      </div>
    )
  }

  // La carte est rattachée mais la liste n'est pas encore là, ou plus : la carte a pu
  // être supprimée depuis, la conversation lui survivant.
  if (!card) {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto">
        <EmptyState
          icon={<SquareKanban size={22} />}
          title={t(cards ? 'panel.card.gone' : 'panel.card.loading')}
        />
      </div>
    )
  }

  return (
    <CardDetail
      card={card}
      projectId={projectId}
      currentConversationId={conversationId}
      onSelectCard={openOnBoard}
    />
  )
}
