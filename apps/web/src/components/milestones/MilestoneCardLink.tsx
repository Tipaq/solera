import { Link, useSearchParams } from 'react-router-dom'
import type { CardDto } from '@solera/protocol'
import { cardDestinationHref } from '../../lib/card-destination'
import type { StatusOf } from '../../lib/card-state'

/**
 * Une carte d'un jalon dans une liste de Lancer ou du suivi : `#N titre`, qui mène à sa
 * session (FCH-10) ; la fiche s'ouvre par le `ℹ` posé à côté.
 */
export function MilestoneCardLink({ projectId, card, statusOf }: { projectId: string; card: CardDto; statusOf: StatusOf }) {
  const [search] = useSearchParams()
  return (
    <Link to={cardDestinationHref(projectId, card, { statusOf, search })} className="min-w-0 flex-1 truncate text-ink hover:text-accent">
      <span className="text-xs text-ink-faint tabular-nums">#{card.number}</span> {card.title}
    </Link>
  )
}
