import { Settings } from 'lucide-react'
import { useEffect, useRef, type ReactNode } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { TabCount, cx, tabItemClass } from '@solera/ui'
import { useTranslate } from '../../lib/i18n'
import { HeaderBand } from '../HeaderBand'

/** Une vue atteignable depuis la rangée. */
export interface PlaceTab {
  /** Adresse absolue de la vue. */
  to: string
  label: string
  icon: ReactNode
  /** Vrai pour la vue d'arrivée, dont l'adresse est le préfixe de toutes les autres. */
  end?: boolean
  /** `undefined` ou 0 : pas de compte, et pas de place réservée. */
  count?: number
  /** Gris pour un inventaire, ambre pour ce qui t'attend, vert pour ce qui tourne. */
  tone?: 'neutral' | 'caution' | 'running'
  /** Ce que dit le compte, en infobulle et pour le lecteur d'écran (« 2 t'attendent »). */
  countTitle?: string
}

/**
 * Les réglages du lieu, au bout de la rangée : un lien vers une page (ceux d'un projet)
 * ou un geste qui ouvre une fenêtre (ceux de l'instance, depuis le portefeuille).
 * `label` est le nom accessible, plus précis que le « Réglages » qu'on lit.
 */
export type PlaceSettings = { to: string; label: string } | { onOpen: () => void; label: string }

/**
 * La bande d'un lieu : l'icône ou l'avatar, le titre, puis les gestes de la page.
 *
 * Seule, elle sert aux pages de lieu qui n'ont qu'une vue (`/sessions`, `/schedules`) ;
 * sous elle, `PlaceShell` pose la rangée. Les gestes sont des `Button size="sm"` ou à sa
 * hauteur : plus de `⋯` ni de pastille de branche, qui disait la branche extraite à la
 * racine et pas celle sur laquelle on travaille.
 */
export function PlaceBand({ icon, title, actions }: {
  /** L'avatar du projet, ou l'icône du lieu, dans un créneau de 20 px. */
  icon: ReactNode
  title: string
  actions?: ReactNode
}) {
  return (
    <HeaderBand gutter="place">
      <span data-place-icon className="flex size-5 shrink-0 items-center justify-center">{icon}</span>
      <h1 className="min-w-0 flex-1 truncate text-sm font-medium">{title}</h1>
      {actions ? <span className="flex shrink-0 items-center gap-2">{actions}</span> : null}
    </HeaderBand>
  )
}

/**
 * La rangée des vues d'un lieu, sous la bande, et Réglages au bout.
 *
 * Une navigation de liens, pas une liste d'onglets ARIA : ce qu'elle montre sont des
 * pages, chacune avec son adresse, et un lecteur d'écran doit annoncer « lien » et non
 * « onglet 2 sur 5 » devant quelque chose qui change l'URL. Elle partage son apparence
 * avec `Tabs` par `tabItemClass`, parce que c'est le même motif vu par l'œil.
 *
 * Plus aucune action de vue ici : *+ Carte* vit dans la barre du Tableau, *+ Tâche* en
 * tête des Planifiées. La rangée ne porte que des vues, et les réglages.
 */
export function PlaceTabs({ label, tabs, settings }: {
  /** Nom accessible de la rangée. */
  label: string
  tabs: PlaceTab[]
  settings: PlaceSettings
}) {
  const t = useTranslate()
  const nav = useRef<HTMLElement>(null)
  const { pathname } = useLocation()
  /* Au doigt la rangée déborde : l'onglet actif est ramené dans la vue, sans quoi
     arriver sur Réglages, au bout, laisserait la rangée sans onglet souligné. Encore
     quand les comptes arrivent : ils élargissent les onglets et repoussent le bout. */
  const shape = tabs.map((tab) => `${tab.label}:${tab.count ?? 0}`).join('|')
  useEffect(() => {
    nav.current?.querySelector('[aria-current="page"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [pathname, shape])
  const settingsContent = (
    <>
      <Settings size={15} className="shrink-0 text-ink-faint" />
      {/* Au doigt l'icône suffit : le libellé ferait sortir l'onglet de l'écran, et le
          nom reste porté par `aria-label`. */}
      <span className="hidden sm:inline">{t('place.settings')}</span>
    </>
  )
  return (
    <nav
      ref={nav}
      aria-label={label}
      /* La gouttière moins le `px-1` de `tabItemClass` : l'icône du premier onglet tombe
         sur le bord de l'avatar, de la recherche et du texte. Le défilement horizontal au
         doigt : le dernier onglet coupé net dit qu'il y en a d'autres, sans légende. */
      className="flex shrink-0 scroll-px-3 items-center gap-5 overflow-x-auto border-b border-line px-3 md:scroll-px-5 md:px-5"
    >
      {tabs.map((tab) => (
        <NavLink key={tab.to} to={tab.to} end={tab.end} className={({ isActive }) => cx(tabItemClass(isActive), 'shrink-0')}>
          <span className="shrink-0 text-ink-faint">{tab.icon}</span>
          {tab.label}
          {tab.count ? <TabCount count={tab.count} tone={tab.tone} title={tab.countTitle} /> : null}
        </NavLink>
      ))}
      {/* `ml-auto` pousse Réglages au bout ; le filet le tient à l'écart des vues de
          travail sans le mettre dans un bloc à part. Sur un conteneur qui défile, il
          ne pousse qu'au-delà de la largeur visible : au doigt, Réglages suit les vues. */}
      <span className="ml-auto flex shrink-0 items-center gap-5 pl-3">
        <span aria-hidden className="h-5 w-px bg-line" />
        {'to' in settings ? (
          <NavLink
            to={settings.to}
            aria-label={settings.label}
            title={settings.label}
            className={({ isActive }) => cx(tabItemClass(isActive), 'shrink-0')}
          >
            {settingsContent}
          </NavLink>
        ) : (
          <button
            type="button"
            onClick={settings.onOpen}
            aria-label={settings.label}
            title={settings.label}
            className={cx(tabItemClass(false), 'shrink-0')}
          >
            {settingsContent}
          </button>
        )}
      </span>
    </nav>
  )
}

/**
 * La coque d'un lieu — un projet (`/p/:id`) ou le portefeuille (`/projects`) : la
 * bande, la rangée, puis le contenu, identiques des deux côtés.
 *
 * Une seule gouttière pour les quatre étages : 16 px, 24 px dès `md`. La bande la
 * prend de `HeaderBand`, la rangée la retranche du `px-1` de ses onglets, la barre
 * d'outils et le contenu de chaque vue la posent en `px-4 md:px-6` / `p-4 md:p-6`.
 * Pleine largeur partout : aucune vue ne plafonne sa colonne ni ne centre un couloir.
 */
export function PlaceShell({ icon, title, actions, tabs, label, settings, children }: {
  icon: ReactNode
  title: string
  actions?: ReactNode
  tabs: PlaceTab[]
  label: string
  settings: PlaceSettings
  /** Le contenu ; par défaut l'`Outlet` de la route. */
  children?: ReactNode
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PlaceBand icon={icon} title={title} actions={actions} />
      <PlaceTabs label={label} tabs={tabs} settings={settings} />
      {/* `relative` : le tiroir de carte et le panneau du board s'y posent en absolu,
          sous la rangée, et la bande reste lisible pendant qu'on lit un diff. */}
      <div data-place-content className="relative min-h-0 min-w-0 flex-1 overflow-clip">
        {children ?? <Outlet />}
      </div>
    </div>
  )
}
