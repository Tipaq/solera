import { IconButton } from '@solera/ui'
import { PanelLeft } from 'lucide-react'
import { useTranslate } from '../lib/i18n'
import { setSidebarHidden } from '../lib/sidebar'

/**
 * Redéploie la colonne de gauche, depuis la bande.
 *
 * Il était posé en absolu dans le coin haut-gauche par la coque, et chaque vue à
 * en-tête lui réservait sa place avec un `md:pl-14` recopié. Rendu par le premier
 * segment de la bande, il occupe sa place comme n'importe quel bouton : plus rien à
 * réserver, et le repli de la navigation ne décale plus le contenu de la vue.
 *
 * Grand écran seulement : au téléphone la colonne est un tiroir, et c'est
 * `MobileNavigationButton` qui l'ouvre.
 */
export function SidebarRestoreButton() {
  const t = useTranslate()
  return (
    <span className="hidden md:block">
      <IconButton data-sidebar-restore label={t('shell.nav.show')} onClick={() => setSidebarHidden(false)}>
        <PanelLeft size={16} />
      </IconButton>
    </span>
  )
}
