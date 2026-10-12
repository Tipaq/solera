import { cx } from '@solera/ui'
import type { ReactNode } from 'react'
import { useSidebarHidden } from '../lib/sidebar'
import { MobileNavigationButton } from './MobileNavigation'
import { SidebarRestoreButton } from './SidebarRestoreButton'

/**
 * La bande du haut — un segment par zone, une seule hauteur.
 *
 * L'application n'a qu'une barre, mais elle est coupée par les colonnes qui passent
 * dessous : la navigation en tient le premier segment, la vue ouverte le deuxième, le
 * panneau droit le troisième. Chacun est rendu par la colonne à laquelle il
 * appartient — c'est ce qui fait que les séparations de la bande sont exactement les
 * bordures des colonnes, sans rien à aligner à la main.
 *
 * Ce composant est ce qu'ils ont en commun, et la seule raison pour laquelle il
 * existe : avant lui, quatre vues écrivaient quatre hauteurs différentes et aucune ne
 * lisait `--header-height`.
 *
 * Le segment `view` porte aussi les deux boutons qui ouvrent la navigation — celui du
 * téléphone, et celui qui la redéploie sur grand écran. C'est ce qui fait disparaître
 * le `md:pl-14` que chaque vue recopiait pour réserver la place d'un bouton posé en
 * absolu par la coque : le bouton est maintenant *dans* la bande, donc il occupe sa
 * place au lieu de la demander.
 */
export function HeaderBand({
  zone = 'view',
  className,
  children,
}: {
  /**
   * La colonne à laquelle ce segment appartient. Seul `view` porte les boutons de
   * navigation ; `nav` est au-dessus de la colonne de gauche, `panel` au-dessus du
   * panneau droit, et tous deux ont leur propre contenu.
   */
  zone?: 'nav' | 'view' | 'panel'
  className?: string
  children: ReactNode
}) {
  const sidebarHidden = useSidebarHidden()
  return (
    <header
      className={cx(
        // `header-bar` et non `h-[var(--header-height)]` : la barre doit *ajouter*
        // l'encoche à sa hauteur, ce qu'une classe utilitaire ne sait pas faire.
        'header-bar flex shrink-0 items-center gap-2 border-b border-line',
        zone === 'panel' ? 'px-2' : 'px-3',
        className,
      )}
    >
      {zone === 'view' ? (
        <>
          <MobileNavigationButton />
          {sidebarHidden ? <SidebarRestoreButton /> : null}
        </>
      ) : null}
      {children}
    </header>
  )
}
