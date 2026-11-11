import { Suspense, lazy } from 'react'
import { usePanelPresence } from '../../lib/panel'

const SidePanel = lazy(() => import('../panel/SidePanel').then((m) => ({ default: m.SidePanel })))

/**
 * Le panneau d'une vue de lieu, « appelé » (TIR-9) : il n'a pas de bouton pour
 * l'ouvrir, c'est un geste de la vue qui le demande (`setPanelOpen`), un « Diff » sur
 * la branche par défaut, qui n'a pas de conversation où s'ouvrir. Monté paresseusement,
 * et seulement le temps qu'il est ouvert : il tient des terminaux et des requêtes
 * d'arborescence qu'on ne garde pas derrière un panneau fermé.
 *
 * Un tiroir ouvert par-dessus le recouvre (le calque de la coque est au-dessus), et
 * Échap ferme le tiroir d'abord.
 */
export function PanelHost({ projectId }: { projectId: string }) {
  const panel = usePanelPresence()
  if (!panel.mounted) return null
  return (
    <Suspense fallback={null}>
      <SidePanel projectId={projectId} open={panel.open} />
    </Suspense>
  )
}
