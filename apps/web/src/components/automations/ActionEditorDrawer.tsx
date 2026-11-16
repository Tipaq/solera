import { Suspense, lazy, useState } from 'react'
import type { EditorSeed } from '../../lib/action-editor'
import { useTranslate } from '../../lib/i18n'
import { Drawer } from '../shell/Drawer'

/**
 * L'éditeur, chargé à son ouverture : il porte l'arborescence, le planificateur et les
 * réglages des CLI, hors du paquet d'entrée (#128).
 */
const ActionEditor = lazy(() => import('./ActionEditor').then((m) => ({ default: m.ActionEditor })))

/**
 * L'éditeur d'une action dans le tiroir large, ouvert tant qu'une graine est donnée. La
 * dernière graine reste le temps que le tiroir sorte de l'écran ; une graine neuve remonte
 * l'éditeur à neuf (EDI-1).
 */
export function ActionEditorDrawer({
  projectId,
  seed,
  conversationId,
  onClose,
}: {
  projectId: string
  seed: EditorSeed | null
  conversationId?: string
  onClose: () => void
}) {
  const t = useTranslate()
  const [shown, setShown] = useState<{ seed: EditorSeed; key: number; closed: boolean } | null>(null)
  // Rouvert, même sur la même graine, l'éditeur repart d'elle et non de la saisie abandonnée.
  if (!seed && shown && !shown.closed) setShown({ ...shown, closed: true })
  if (seed && (seed !== shown?.seed || shown.closed)) setShown({ seed, key: (shown?.key ?? 0) + 1, closed: false })
  return (
    <Drawer open={seed !== null} onClose={onClose} label={t('actionEditor.label')} width="wide">
      {shown ? (
        <Suspense fallback={null}>
          <ActionEditor key={shown.key} projectId={projectId} seed={shown.seed} conversationId={conversationId} onClose={onClose} />
        </Suspense>
      ) : null}
    </Drawer>
  )
}
