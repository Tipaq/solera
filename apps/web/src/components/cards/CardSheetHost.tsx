import { useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { CardDto } from '@solera/protocol'
import { sheetNumber, withSheet } from '../../lib/card-sheet'
import { useCards } from '../../lib/cards'
import { CardSheet } from './CardSheet'

/**
 * L'hôte de la fiche sur place (FCH-2) : il lit `?fiche=N` et ouvre la fiche de cette
 * carte du projet. Monté **une fois** au niveau de la page ; les `ℹ` de la page n'ont
 * qu'à écrire l'adresse. `back` nomme l'onglet du panneau où l'on revient, quand la
 * page en a un (voir `Detail`).
 */
export function CardSheetHost({ projectId, back }: { projectId: string; back?: string }) {
  const [params, setParams] = useSearchParams()
  const { data: cards } = useCards(projectId)
  const wanted = sheetNumber(params)
  const card = wanted === null ? undefined : cards?.find((entry) => entry.number === wanted)
  // La dernière carte montrée reste rendue le temps que le tiroir sorte de l'écran.
  const last = useRef<CardDto | undefined>(undefined)
  if (card) last.current = card
  const shown = card ?? last.current
  if (!shown) return null
  return (
    <CardSheet
      open={Boolean(card)}
      projectId={projectId}
      card={shown}
      back={back}
      onClose={() => setParams((current) => withSheet(current, null))}
      onSelect={(number) => setParams((current) => withSheet(current, number))}
    />
  )
}
