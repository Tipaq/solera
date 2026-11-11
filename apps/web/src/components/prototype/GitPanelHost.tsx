/* PROTOTYPE — jetable (branche proto/page-projet). Ne pas fusionner dans main.
 *
 * Le panneau git, sorti du board (Tim : « aucun sens de pouvoir voir le panneau de
 * droite sur le board »). Il ne s'ouvre plus que là où un geste « Diff » le demande :
 * Travail et Code, pour la branche par défaut, qui n'a pas de session où l'ouvrir.
 * Pas de bouton pour l'ouvrir à la main : c'est le geste qui l'appelle.
 */
import { Suspense, lazy } from 'react'
import { usePanelPresence } from '../../lib/panel'

const OriginalSidePanel = lazy(() => import('../panel/SidePanel').then((m) => ({ default: m.SidePanel })))
/* PROTOTYPE : la version alignée du panneau, sauf `?panel=actuel`. */
const ProtoSidePanel = lazy(() => import('./panel/ProtoSidePanel').then((m) => ({ default: m.ProtoSidePanel })))
const SidePanel = (props: React.ComponentProps<typeof OriginalSidePanel>) =>
  new URLSearchParams(window.location.search).get('panel') === 'actuel'
    ? <OriginalSidePanel {...props} />
    : <ProtoSidePanel {...props} />

export function GitPanelHost({ projectId }: { projectId: string }) {
  const panel = usePanelPresence()
  if (!panel.mounted) return null
  return (
    <Suspense fallback={null}>
      <SidePanel projectId={projectId} open={panel.open} />
    </Suspense>
  )
}
