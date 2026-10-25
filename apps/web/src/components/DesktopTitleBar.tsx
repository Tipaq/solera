import { useEffect } from 'react'
import { Menu } from 'lucide-react'
import type { DesktopBridge } from '@solera/protocol'
import { IconButton } from '@solera/ui'
import { useTranslate } from '../lib/i18n'
import { Logo } from './Logo'

type WindowChrome = DesktopBridge['window']

/** Posé par le preload de l'app de bureau ; absent dans un navigateur. */
const desktopChrome = typeof window === 'undefined' ? undefined : window.soleraDesktop?.window

/**
 * La barre de titre de l'app de bureau, aux couleurs du thème, à la place de la barre de
 * titre et de la barre de menus natives. On y saisit la fenêtre pour la déplacer ; les
 * contrôles natifs restent à leur place (`titlebar-area-*`), et hors de macOS un bouton
 * ouvre le menu de l'app. Montée hors des routes, pour couvrir aussi la première ouverture.
 *
 * Elle recopie le canevas et l'encre du thème sur les contrôles natifs, à chaque
 * changement de thème ou d'apparence : Electron n'accepte que du sRGB, le navigateur
 * résout donc lui-même les couleurs OKLCH des jetons.
 */
export function DesktopTitleBar({ chrome = desktopChrome }: { chrome?: WindowChrome }) {
  const t = useTranslate()
  useThemeOnWindow(chrome)
  if (!chrome) return null
  return (
    <div
      className="desktop-titlebar fixed inset-x-0 top-0 z-[1000] h-[var(--sg-window-bar,36px)] border-b border-line bg-canvas text-ink-soft select-none [-webkit-app-region:drag]"
      data-platform={chrome.platform}
    >
      <div className="desktop-titlebar-content flex h-full items-center gap-2 px-2.5">
        {chrome.platform !== 'darwin' ? (
          <IconButton
            size="sm"
            label={t('desktop.window.menu')}
            aria-haspopup="menu"
            className="[-webkit-app-region:no-drag]"
            onClick={() => void chrome.menu().catch(() => undefined)}
          >
            <Menu size={15} aria-hidden />
          </IconButton>
        ) : null}
        <Logo size={14} className="text-accent" />
        <span className="text-xs font-medium">Solera</span>
      </div>
    </div>
  )
}

function useThemeOnWindow(chrome: WindowChrome | undefined): void {
  useEffect(() => {
    if (!chrome) return
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 1
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) return
    const hex = (value: string) => {
      context.clearRect(0, 0, 1, 1)
      context.fillStyle = value
      context.fillRect(0, 0, 1, 1)
      const [r = 0, g = 0, b = 0] = context.getImageData(0, 0, 1, 1).data
      return `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, '0')).join('')}`
    }
    let last = ''
    const sync = () => {
      const style = getComputedStyle(document.documentElement)
      const background = hex(style.getPropertyValue('--sg-canvas'))
      const foreground = hex(style.getPropertyValue('--sg-ink'))
      // Les curseurs d'apparence tirent une rafale de mutations.
      if (`${background}${foreground}` === last) return
      last = `${background}${foreground}`
      void chrome.colors(background, foreground).catch(() => undefined)
    }
    sync()
    const observer = new MutationObserver(sync)
    observer.observe(document.documentElement, { attributeFilter: ['data-theme', 'style'] })
    return () => observer.disconnect()
  }, [chrome])
}
