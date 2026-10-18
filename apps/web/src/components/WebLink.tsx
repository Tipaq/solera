import { useContext, type MouseEvent, type ReactNode } from 'react'
import { FileLinkContext } from '../lib/file-links'
import { openWebPage } from '../lib/web-pane'

/**
 * Un lien vers le web qui s'ouvre dans la vue *Web* du panneau.
 *
 * Hors d'un fil — une carte, une note —, il n'y a pas de panneau de fil où l'ouvrir :
 * le lien reste un lien. Avec ⌘, Ctrl, Maj ou ⌥, il part au navigateur comme partout.
 */
export function WebLink({ href, className, title, children }: {
  href: string
  className?: string
  title?: string
  children: ReactNode
}) {
  const scope = useContext(FileLinkContext)
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={title}
      className={className}
      onClick={(event) => openInPanel(event, scope, href)}
    >
      {children}
    </a>
  )
}

/** Détourne un clic simple vers la vue *Web* ; vrai s'il l'a fait. */
export function openInPanel(event: MouseEvent, scope: string | null, href: string): boolean {
  if (!scope || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return false
  if (!/^https?:\/\//.test(href)) return false
  event.preventDefault()
  openWebPage(scope, href)
  return true
}
