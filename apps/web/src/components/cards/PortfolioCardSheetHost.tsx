import { useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { CardDto } from '@solera/protocol'
import { portfolioSheet, withPortfolioSheet, type PortfolioSheet } from '../../lib/card-sheet'
import { useCards } from '../../lib/cards'
import { CardSheet } from './CardSheet'

/**
 * L'hôte de la fiche sur place **au portefeuille** : `CardSheetHost`, mais pour des
 * cartes de plusieurs projets. Il lit `?fiche=<projet>:<N>` ; monté une fois dans la
 * coque du portefeuille, il sert toutes ses vues.
 */
export function PortfolioCardSheetHost() {
  const [params, setParams] = useSearchParams()
  const wanted = portfolioSheet(params)
  // Les cartes du projet sont déjà en cache : le portefeuille les a chargées pour ses vues.
  const { data: cards } = useCards(wanted?.projectId)
  const card = wanted === null ? undefined : cards?.find((entry) => entry.number === wanted.number)
  // La dernière carte montrée reste rendue le temps que le tiroir sorte de l'écran.
  const last = useRef<{ card: CardDto; projectId: string } | undefined>(undefined)
  if (card && wanted) last.current = { card, projectId: wanted.projectId }
  const shown = last.current
  if (!shown) return null
  const write = (sheet: PortfolioSheet | null) => setParams((current) => withPortfolioSheet(current, sheet))
  return (
    <CardSheet
      open={Boolean(card)}
      projectId={shown.projectId}
      card={card ?? shown.card}
      onClose={() => write(null)}
      onSelect={(number) => write({ projectId: shown.projectId, number })}
    />
  )
}
