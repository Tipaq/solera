import { X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { type CardDto } from '@solera/protocol'
import { restoreCardPanelWidth, setCardPanelWidth } from '../../lib/board-panel'
import { useTranslate } from '../../lib/i18n'
import { resizeHandle } from '../../lib/resize-handle'
import { useMediaQuery } from '../../lib/viewport'
import { PanelFocus } from '../PanelFocus'
import { IconButton, cx } from '@solera/ui'
import { CardDetail } from './CardDetail'

interface CardPanelProps {
  card: CardDto
  projectId: string
  /** État visé, distinct de la présence : le panneau reste monté le temps de sortir. */
  open: boolean
  onClose: () => void
  onSelectCard: (number: number) => void
}

/**
 * Le détail d'une carte, à côté du board plutôt qu'à sa place.
 *
 * Il se pose par-dessus plutôt que de pousser les colonnes, et glisse depuis le bord
 * droit comme le panneau d'outils d'une conversation : c'est le même geste sur le même
 * bord, et deux animations différentes pour deux tiroirs voisins se remarquent.
 *
 * Le tiroir, et rien de plus : son contenu est `CardDetail`, qui loge aussi dans
 * l'onglet *Carte* du panneau d'une session.
 */
export function CardPanel({ card, projectId, open, onClose, onSelectCard }: CardPanelProps) {
  const t = useTranslate()
  /**
   * Le premier rendu se fait volontairement hors écran, l'entrée n'étant lancée qu'au
   * rendu suivant : un élément qui naît déjà en place n'a aucune transition à jouer.
   */
  const [entered, setEntered] = useState(false)
  useEffect(() => {
    const frame = requestAnimationFrame(() => setEntered(true))
    return () => cancelAnimationFrame(frame)
  }, [])

  const aside = useRef<HTMLElement>(null)
  useEffect(restoreCardPanelWidth, [])

  /**
   * Le tiroir est collé au bord droit de la fenêtre : sa largeur vaut donc la distance
   * du pointeur à ce bord, sans décalage à mémoriser au début du geste.
   */
  const handle = resizeHandle({
    widthAt: (clientX) => window.innerWidth - clientX,
    current: () => aside.current?.getBoundingClientRect().width ?? null,
    apply: setCardPanelWidth,
  })

  const modal = !useMediaQuery('(min-width: 48rem)')

  return (
    <PanelFocus open={open} modal={modal} onClose={onClose} fallbackFocus={`[data-card-open="${card.id}"], [data-navigation-trigger]`}>
    <aside
      ref={aside}
      inert={!open}
      aria-hidden={!open}
      role={modal ? 'dialog' : 'complementary'}
      aria-modal={modal && open ? true : undefined}
      aria-label={t('board.card.panelLabel', { number: card.number })}
      className={cx(
        // Pas d'`overflow` ici : il rognerait la poignée, posée en débord sur le bord
        // gauche. C'est la zone de défilement interne qui borne le contenu.
        'surface z-20 flex flex-col border-l border-line shadow-pop',
        // `absolute` et non `fixed` : le repère est le calque de la coque, donc le
        // panneau suit le viewport visuel quand le clavier s'ouvre.
        // La largeur est bornée en CSS et pas seulement à l'enregistrement : une
        // fenêtre rétrécie après coup laisserait sinon un tiroir plus large qu'elle.
        'absolute inset-0 md:left-auto md:w-[min(var(--card-panel-width,40rem),calc(100vw-10rem))]',
        // `translate` et non `transform` : Tailwind v4 pose les utilitaires de
        // translation sur cette propriété CSS, distincte de `transform`.
        'transition-[translate] duration-200 ease-out',
        entered && open ? 'translate-x-0' : 'translate-x-full',
      )}
    >
      <CardDetail
        card={card}
        projectId={projectId}
        onSelectCard={onSelectCard}
        onDeleted={onClose}
        headerActions={
          <IconButton data-panel-initial-focus label={t('board.panel.close')} size="sm" onClick={onClose}>
            <X size={14} />
          </IconButton>
        }
      />

      {/* Poignée de largeur sur le bord gauche, grand écran seulement : au doigt le
          tiroir occupe tout l'écran, il n'y a rien à ajuster. */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={t('board.panel.resize')}
        tabIndex={0}
        onPointerDown={handle.onPointerDown}
        onKeyDown={handle.onKeyDown}
        className={cx(
          'absolute inset-y-0 -left-1 hidden w-2 cursor-col-resize md:block',
          'after:absolute after:inset-y-0 after:left-1/2 after:w-0.5 after:-translate-x-1/2',
          'after:transition-colors hover:after:bg-accent focus-visible:after:bg-accent',
          'outline-none',
        )}
      />
    </aside>
    </PanelFocus>
  )
}
