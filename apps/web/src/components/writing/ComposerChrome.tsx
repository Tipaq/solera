import { CornerDownLeft, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { IconButton } from '@solera/ui'
import { useTranslate } from '../../lib/i18n'

/*
 * Le cadre des tiroirs d'écriture (« Nouveau jalon », « Ajouter au jalon ») : un en-tête
 * qui dit la nature en petit et le titre en grand, et un pied collant — ce qui va se
 * passer à gauche, les gestes à droite.
 */

/** L'en-tête : la nature en petit, le titre (passé en enfant) en grand, ✕ à droite. */
export function ComposerHeader({ eyebrow, onClose, children }: { eyebrow: string; onClose: () => void; children: ReactNode }) {
  const t = useTranslate()
  return (
    <header className="flex shrink-0 items-start gap-3 px-6 pt-4 pb-2">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-xs text-ink-faint">{eyebrow}</span>
        {children}
      </div>
      <IconButton label={t('composer.close')} size="sm" onClick={onClose}>
        <X size={15} />
      </IconButton>
    </header>
  )
}

/** Le pied collant : `info` à gauche, `actions` à droite, qui passent dessous s'il manque de place. */
export function ComposerFooter({ info, actions }: { info: ReactNode; actions: ReactNode }) {
  return (
    <footer className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-3 border-t border-line bg-canvas px-6 py-3">
      {info}
      <div className="ml-auto flex shrink-0 items-center gap-2">{actions}</div>
    </footer>
  )
}

const MAC = typeof navigator !== 'undefined' && navigator.userAgent.includes('Mac')

/** `⌘↵` ou `Ctrl↵` dans le bouton du geste principal, dès qu'il y a un clavier (`md`). */
export function SubmitShortcut() {
  return (
    <span aria-hidden className="ml-1.5 hidden items-center gap-0.5 rounded border border-current/30 px-1 text-meta opacity-70 md:inline-flex">
      {MAC ? '⌘' : 'Ctrl'}
      <CornerDownLeft size={10} />
    </span>
  )
}
