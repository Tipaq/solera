/* PROTOTYPE — jetable (branche proto/page-projet). Ne pas fusionner dans main.
 *
 * La coque haute d'un lieu — un projet (`/p/:id`) ou le portefeuille (`/projects`) :
 * **une bande** puis **une rangée d'onglets**, identiques des deux côtés (Tim,
 * 2026-11-11 : « je n'ai pas la même UI pour la top bar et les onglets »).
 *
 * - La bande : icône ou avatar, titre, puis les gestes de la page à droite, tous en
 *   `Button size="sm"` ou à sa hauteur, dans le même ordre (⚡ puis l'action principale).
 * - La rangée : même hauteur, même typographie, même soulignement, mêmes marges. Un
 *   compte suit une seule règle : **gris pour un inventaire, ambre pour ce qui t'attend**.
 * - **Réglages** au bout, après le même séparateur, libellé « Réglages » des deux côtés :
 *   un lien (les réglages du projet) ou un bouton (ceux de l'instance, en fenêtre).
 */
import { Settings } from 'lucide-react'
import type { ReactNode } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { cx, tabItemClass } from '@solera/ui'
import { PlaceTabCount } from './actionsCount'
import { HeaderBand } from '../HeaderBand'
import { DrawerLayer } from './Drawer'

export interface PlaceTab {
  /** Adresse absolue de la vue. */
  to: string
  label: string
  icon: ReactNode
  /** Vrai pour la vue d'arrivée, préfixe de toutes les autres. */
  end?: boolean
  /** `undefined` ou 0 : pas de compte. */
  count?: number
  /** Trois tons : `caution` = ce qui t'attend (ambre), `running` = ce qui tourne (vert),
      par défaut un inventaire (gris). */
  tone?: 'neutral' | 'caution' | 'running'
  /** Ce que dit le compte, en infobulle (« 2 en marche »). */
  countTitle?: string
}

export type PlaceSettings =
  | { to: string; title?: string }
  | { onOpen: () => void; title?: string }

export function PlaceShell({
  icon,
  title,
  actions,
  tabs,
  label,
  settings,
  search = '',
  children,
}: {
  /** L'avatar du projet, ou l'icône du portefeuille, en 20 px. */
  icon: ReactNode
  title: string
  /** Les gestes de la bande, de gauche à droite : ⚡ puis l'action principale. */
  actions: ReactNode
  tabs: PlaceTab[]
  /** Nom accessible de la rangée. */
  label: string
  settings: PlaceSettings
  /** Ajouté aux liens d'onglets (`?demo=1`). */
  search?: string
  /** Le contenu ; par défaut l'`Outlet` de la route. */
  children?: ReactNode
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Une seule gouttière pour la bande, la rangée, la barre d'outils et le contenu :
          16 px, 24 px au large. La rangée retranche le `px-1` des onglets, pour que leurs
          icônes tombent sur le même bord que l'avatar, la recherche et le texte. */}
      <HeaderBand className="pl-4! pr-4! md:pl-6! md:pr-6!">
        <span className="flex size-5 shrink-0 items-center justify-center">{icon}</span>
        <h1 className="min-w-0 flex-1 truncate text-sm font-medium">{title}</h1>
        <span className="flex shrink-0 items-center gap-2">{actions}</span>
      </HeaderBand>

      <nav aria-label={label} className="flex shrink-0 items-center gap-5 overflow-x-auto border-b border-line px-3 md:px-5">
        {tabs.map((tab) => (
          <NavLink key={tab.to} to={`${tab.to}${search}`} end={tab.end} className={({ isActive }) => cx(tabItemClass(isActive), 'shrink-0')}>
            <span className="shrink-0 text-ink-faint">{tab.icon}</span>
            {tab.label}
            {tab.count ? <PlaceTabCount count={tab.count} tone={tab.tone ?? 'neutral'} title={tab.countTitle} /> : null}
          </NavLink>
        ))}
        {/* `ml-auto` pousse Réglages au bout ; le séparateur le tient à l'écart des vues
            de travail sans le mettre dans un bloc à part. */}
        <span className="ml-auto flex shrink-0 items-center gap-5 pl-3">
          <span aria-hidden className="h-5 w-px bg-line" />
          {'to' in settings ? (
            <NavLink
              to={settings.to}
              aria-label={settings.title ?? 'Réglages'}
              title={settings.title}
              className={({ isActive }) => cx(tabItemClass(isActive), 'shrink-0')}
            >
              <Settings size={15} className="shrink-0 text-ink-faint" />
              <span className="hidden sm:inline">Réglages</span>
            </NavLink>
          ) : (
            <button
              type="button"
              onClick={settings.onOpen}
              aria-label={settings.title ?? 'Réglages'}
              title={settings.title}
              className={cx(tabItemClass(false), 'shrink-0')}
            >
              <Settings size={15} className="shrink-0 text-ink-faint" />
              <span className="hidden sm:inline">Réglages</span>
            </button>
          )}
        </span>
      </nav>

      {/* `relative` : les tiroirs et le panneau s'y posent en absolu, sous la rangée. */}
      <div className="relative min-h-0 min-w-0 flex-1 overflow-clip">
        {children ?? <Outlet />}
        <DrawerLayer />
      </div>
    </div>
  )
}
