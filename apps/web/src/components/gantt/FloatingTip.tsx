import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'

/** Écart entre l'ancre et l'infobulle, et marge gardée au bord de la fenêtre. */
const GAP = 6
const EDGE = 8

/**
 * Une infobulle sortie du flux : portail dans `body`, position fixe sous l'ancre, ou
 * au-dessus quand la place manque, et tenue dans la fenêtre. Posée en absolu dans le
 * Gantt, elle agrandissait le conteneur qui défile et y faisait naître une barre de
 * défilement dès qu'on survolait la dernière ligne.
 *
 * Elle ne capte pas le pointeur : c'est le survol de l'ancre qui la montre et la retire.
 *
 * La mesure attend un effet passif : quand l'ancre et l'infobulle montent ensemble
 * (une ligne survolée d'office), l'effet de mise en page de l'enfant passe avant que
 * React pose la ref de l'ancre, son parent, et l'infobulle restait cachée. D'ici là, elle
 * est hors de l'écran et invisible : rien ne clignote.
 */
export function FloatingTip({ anchor, children }: { anchor: RefObject<HTMLElement | null>; children: ReactNode }) {
  const tip = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null)
  useEffect(() => {
    const a = anchor.current?.getBoundingClientRect()
    const t = tip.current?.getBoundingClientRect()
    if (!a || !t) return
    const below = a.bottom + GAP + t.height <= window.innerHeight - EDGE
    const top = below ? a.bottom + GAP : Math.max(EDGE, a.top - GAP - t.height)
    const left = Math.min(Math.max(EDGE, a.left), window.innerWidth - t.width - EDGE)
    setPosition({ left, top })
  }, [anchor])
  return createPortal(
    <div
      ref={tip}
      role="tooltip"
      className="pointer-events-none fixed z-50"
      style={position ? { left: position.left, top: position.top } : { left: -9999, top: 0, visibility: 'hidden' }}
    >
      {children}
    </div>,
    document.body,
  )
}
