import { useRef, type ReactNode } from 'react'
import { StackHeader } from '@solera/ui'
import { useDetailSurface } from '../../lib/detail-surface'
import { useEscapeLayer } from '../../lib/escape-layers'
import { Drawer, type DrawerWidth } from './Drawer'

interface DetailProps {
  open: boolean
  onClose: () => void
  /** Nom accessible du tiroir. */
  label: string
  title: ReactNode
  subtitle?: ReactNode
  /** Le nom de l'onglet du panneau où l'on revient : « ‹ Actions ». */
  back: string
  width?: DrawerWidth
  children: ReactNode
}

/**
 * Un détail — une action, une carte, un commit — là où la page veut qu'il s'ouvre
 * (TIR-8) : dans le tiroir commun sur une page sans panneau, en pile dans le panneau
 * d'une conversation. Jamais un tiroir à côté du panneau.
 *
 * En pile, il **remplace** ce que l'onglet montrait : c'est à l'onglet de ne plus rendre
 * sa liste pendant qu'il est ouvert. Échap remonte d'un niveau, comme `‹` — s'il est
 * tapé dans le détail : dans le champ de la conversation, il reste à son autocomplétion.
 */
export function Detail({ open, onClose, label, title, subtitle, back, width, children }: DetailProps) {
  const surface = useDetailSurface()
  if (surface === 'drawer') {
    return (
      <Drawer open={open} onClose={onClose} label={label} title={title} subtitle={subtitle} width={width}>
        {children}
      </Drawer>
    )
  }
  return open ? <StackedDetail onClose={onClose} title={title} subtitle={subtitle} back={back}>{children}</StackedDetail> : null
}

function StackedDetail({ onClose, title, subtitle, back, children }: Pick<DetailProps, 'onClose' | 'title' | 'subtitle' | 'back' | 'children'>) {
  const frame = useRef<HTMLDivElement>(null)
  useEscapeLayer(true, onClose, frame)
  return (
    <div ref={frame} className="flex min-h-0 min-w-0 flex-1 flex-col">
      <StackHeader back={back} onBack={onClose} title={title} meta={subtitle} />
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </div>
  )
}
