import { Suspense, lazy } from 'react'
import { usePanelPresence, usePanelWorktree } from '../../lib/panel'

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
 *
 * Le « Diff » d'un arbre sans session l'ouvre sur cet arbre (`openGitPanel`) plutôt que
 * sur le dossier du projet.
 */
export function PanelHost({ projectId }: { projectId: string }) {
  const panel = usePanelPresence()
  const worktree = usePanelWorktree()
  if (!panel.mounted) return null
  return (
    <Suspense fallback={null}>
      <SidePanel projectId={projectId} worktree={worktree ?? undefined} open={panel.open} />
    </Suspense>
  )
}
