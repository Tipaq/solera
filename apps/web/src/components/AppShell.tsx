import { useEffect, useRef, useState } from 'react'
import { useLocation, useMatch } from 'react-router-dom'
import { Outlet } from 'react-router-dom'
import { useAppearanceSync } from '../lib/appearance-sync'
import { useRememberContext } from '../lib/last-context'
import { setPanelScope } from '../lib/panel'
import { useRevalidateLists } from '../lib/conversation-status'
import {
  restoreSidebarWidth,
  setSidebarHidden,
  setSidebarWidth,
  useSidebarHidden,
} from '../lib/sidebar'
import { useFileDropGuard } from '../lib/file-drop'
import { useTranslate } from '../lib/i18n'
import { resizeHandle } from '../lib/resize-handle'
import { useMediaQuery, useVisualViewport } from '../lib/viewport'
import { CommandPalette } from './CommandPalette'
import { Logo } from './Logo'
import { UpdatePrompt } from './UpdatePrompt'
import { Toaster } from './Toaster'
import { MobileNavigationContext } from './MobileNavigation'
import { HeaderBand } from './HeaderBand'
import { McpRegistryDialog } from './mcp/McpRegistryDialog'
import { Sidebar } from './sidebar/Sidebar'
import { cx } from '@solera/ui'

/**
 * Desktop : sidebar persistante. Mobile : la même sidebar en tiroir plein écran.
 * Un seul composant de navigation, deux présentations.
 */
export function AppShell() {
  const t = useTranslate()
  useAppearanceSync()
  const [navOpen, setNavOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const hidden = useSidebarHidden()
  const aside = useRef<HTMLElement>(null)
  const wide = useMediaQuery('(min-width: 48rem)')
  const conversationRoute = useMatch('/p/:projectId/c/:conversationId')
  // Un fil libre n'a pas de segment de projet dans son adresse, et rend pourtant la même
  // page — sans cette ligne il aurait deux bandes au téléphone.
  const freeConversationRoute = useMatch('/c/:conversationId')
  const servicesRoute = useMatch('/services')
  // Les vues d'un projet partagent la bande de `ProjectLayout` : un seul `useMatch`
  // pour toutes, là où chacune se déclarait avant.
  const projectRoute = useMatch('/p/:projectId/*')
  const projectRootRoute = useMatch('/p/:projectId')
  // Les pages de lieu portent leur propre segment de bande : sans ces lignes elles en
  // auraient deux au téléphone.
  const projectsRoute = useMatch('/projects')
  const portfolioRoute = useMatch('/projects/*')
  const plannedRoute = useMatch('/schedules')
  const vaultRoute = useMatch('/vault/*')
  const vaultRootRoute = useMatch('/vault')
  const contextualHeader = Boolean(
    conversationRoute || freeConversationRoute || servicesRoute
    || projectRoute || projectRootRoute || projectsRoute || portfolioRoute || plannedRoute
    || vaultRoute || vaultRootRoute,
  )
  const navInactive = wide ? hidden : !navOpen
  useVisualViewport()
  useFileDropGuard()
  useRememberContext()
  // Le panneau droit appartient à ce qui est ouvert au centre : il se referme en
  // changeant de contexte, et retrouve son état en y revenant.
  const { pathname } = useLocation()
  useEffect(() => setPanelScope(pathname), [pathname])
  const revalidateLists = useRevalidateLists()

  useEffect(restoreSidebarWidth, [])

  useEffect(() => {
    if (!wide && navOpen) revalidateLists()
  }, [wide, navOpen, revalidateLists])

  useEffect(() => {
    if (wide || !navOpen) return
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    aside.current?.querySelector<HTMLButtonElement>('button')?.focus()
    return () => {
      const target = previous?.isConnected && !previous.closest('[inert]')
        ? previous
        : document.querySelector<HTMLElement>('[data-navigation-trigger]')
      target?.focus()
    }
  }, [wide, navOpen])

  useEffect(() => {
    if (wide && hidden && aside.current?.contains(document.activeElement)) {
      document.querySelector<HTMLElement>('[data-sidebar-restore]')?.focus()
    }
  }, [wide, hidden])

  // Raccourci global : la palette doit s'ouvrir depuis n'importe quelle vue, y compris
  // avec le curseur dans la barre de saisie.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'k') return
      event.preventDefault()
      setSearchOpen((value) => !value)
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  /**
   * La sidebar commence au bord gauche de la fenêtre : l'abscisse du pointeur est donc
   * la largeur voulue, sans décalage à mémoriser au début du geste.
   */
  const handle = resizeHandle({
    widthAt: (clientX) => clientX,
    current: () => aside.current?.getBoundingClientRect().width ?? null,
    apply: setSidebarWidth,
  })

  return (
    /**
     * Calque fixe de l'application, dimensionné par `.app-layer`.
     *
     * À l'ouverture du clavier, il se cale sur le viewport visuel et remonte de
     * `--sg-viewport-top` : le clavier pousse tout vers le haut au lieu de recouvrir la
     * barre de saisie.
     */
    <MobileNavigationContext.Provider value={() => setNavOpen(true)}>
    <div className="app-layer flex overflow-hidden text-ink">
      <aside
        ref={aside}
        inert={navInactive}
        aria-hidden={navInactive}
        role={!wide && navOpen ? 'dialog' : undefined}
        aria-modal={!wide && navOpen ? true : undefined}
        aria-label={t('shell.nav.label')}
        onKeyDown={(event) => {
          const node = aside.current
          if (wide || !navOpen || event.defaultPrevented || !node?.contains(event.target as Node)) return
          if (event.key === 'Escape') {
            event.preventDefault()
            setNavOpen(false)
          }
          if (event.key !== 'Tab') return
          const targets = Array.from(node.querySelectorAll<HTMLElement>(
            'button, a[href], input, select, textarea, [tabindex]',
          )).filter((item) => item.tabIndex >= 0 && !item.matches(':disabled') && item.getClientRects().length > 0)
          const first = targets[0]
          const last = targets.at(-1)
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault()
            last?.focus()
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault()
            first?.focus()
          }
        }}
        className={cx(
          // `absolute` et non `fixed` : le repère est le calque ci-dessus, donc le
          // tiroir suit le viewport visuel au lieu de passer sous le clavier.
          // Pleine largeur sur mobile : à 16.5rem, un titre de conversation était coupé
          // au bout de quelques mots. Le tiroir se recouvre de toute façon, rien ne
          // reste à voir derrière lui.
          'absolute inset-y-0 left-0 z-30 w-full shrink-0',
          'md:w-[var(--sidebar-desktop-width)]',
          'surface border-r border-line',
          // Sur mobile, la sidebar est en surimpression : une translation suffit à la
          // faire entrer et sortir. Sur grand écran elle occupe une colonne du flex,
          // donc c'est la marge qui doit se refermer, sinon translater ne ferait que
          // laisser un vide de sa largeur.
          // `translate` et non `transform` : Tailwind v4 pose les utilitaires de
          // translation sur la propriété CSS `translate`, qui est distincte. Une
          // transition déclarée sur `transform` ne portait donc sur rien, et le
          // tiroir sautait d'un bord à l'autre sur mobile.
          'transition-[translate,margin] duration-200 ease-out',
          // `md:left-auto` : en `sticky`, un `left: 0` réépingle l'élément au bord du
          // viewport et annule visuellement la marge négative du repli, alors même
          // que la place, elle, est bien rendue.
          'md:relative md:h-full md:translate-x-0',
          navOpen ? 'translate-x-0' : '-translate-x-full',
          hidden ? 'md:-ml-[var(--sidebar-desktop-width)]' : 'md:ml-0',
        )}
      >
        <Sidebar
          onNavigate={() => setNavOpen(false)}
          onClose={() => setNavOpen(false)}
          onCollapse={() => setSidebarHidden(true)}
          onSearch={() => {
            setNavOpen(false)
            setSearchOpen(true)
          }}
        />

        {/* Poignée de largeur, sur le bord droit. Retirée quand la sidebar est repliée :
            elle se retrouverait sinon au bord gauche de la vue, par-dessus le bouton de
            réaffichage, à redimensionner quelque chose d'invisible. */}
        {hidden ? null : (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label={t('shell.nav.resize.aria')}
            tabIndex={0}
            onPointerDown={handle.onPointerDown}
            onKeyDown={handle.onKeyDown}
            className={cx(
              'absolute inset-y-0 -right-1 z-10 hidden w-2 cursor-col-resize md:block',
              // Le trait n'apparaît qu'au survol : au repos, la bordure de la sidebar
              // suffit, et une seconde ligne permanente la doublerait.
              'after:absolute after:inset-y-0 after:left-1/2 after:w-0.5 after:-translate-x-1/2',
              'after:transition-colors hover:after:bg-accent focus-visible:after:bg-accent',
              'outline-none',
            )}
          />
        )}
      </aside>

      <CommandPalette open={searchOpen} onOpenChange={setSearchOpen} />
      {/* Montée ici et pas dans le composer : elle s'ouvre depuis le « + », donc depuis
          un menu, et un dialogue rendu dans un menu meurt avec lui à la sélection. */}
      <McpRegistryDialog />
      <UpdatePrompt />
      {/* Hors de la colonne principale : un toast apparaît par-dessus n'importe quelle
          vue, sidebar comprise. */}
      <Toaster />

      {/* Aucune gouttière : le bouton de réaffichage se pose dans le coin haut-gauche,
          et ce sont les vues qui ont un en-tête qui lui réservent sa place
          (`useSidebarHidden`). Une colonne décalée de sa largeur laissait une bande vide
          sur toute la hauteur de l'écran. */}
      <div
        inert={!wide && navOpen}
        className="flex min-w-0 flex-1 flex-col"
      >
        {/* Les vues qui ont leur propre segment de bande le rendent elles-mêmes ; les
            autres reçoivent celui-ci. Il ne s'efface sur grand écran que si la colonne
            de gauche est dépliée : sinon il porterait seul le bouton qui la ramène. */}
        {!contextualHeader ? (
          <HeaderBand className={cx('bg-canvas/85 backdrop-blur-md', !hidden && 'md:hidden')}>
            <span className="flex items-center gap-1.5 md:hidden">
              <Logo size={18} className="text-accent" />
              <span className="font-medium">Solera</span>
            </span>
          </HeaderBand>
        ) : null}

        {/* Le calque racine ne défile plus : chaque vue porte son propre défilement.
            Les pages de réglages n'en gèrent aucun, il leur est donné ici. */}
        <main className="min-h-0 min-w-0 flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
    </MobileNavigationContext.Provider>
  )
}
