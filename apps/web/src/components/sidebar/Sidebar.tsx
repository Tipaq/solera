import { FolderPlus, PanelLeftClose, Plus, Search, X } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { useNavigate } from 'react-router-dom'
import type { ConversationDto } from '@solera/protocol'
import { useAllConversations } from '../../lib/conversations'
import { useRefreshLists, useStatusFeed } from '../../lib/conversation-status'
import { useDisplaySettings, useProjectFocus } from '../../lib/display-settings'
import { useTranslate } from '../../lib/i18n'
import { useProjects, useReorderProjects } from '../../lib/projects'
import { unreadNow } from '../../lib/reads'
import { useSchedules } from '../../lib/schedules'
import { useSidebarPlace, type Place } from '../../lib/sidebar'
import { SidebarFitBudget, useSidebarSessionLimit } from '../../lib/prototype-sidebar'
import { useVaultState } from '../../lib/vault'
import { useMediaQuery } from '../../lib/viewport'
import { HeaderBand } from '../HeaderBand'
import { Logo } from '../Logo'
import { PullToRefresh } from '../PullToRefresh'
import { SidebarActivity } from '../SidebarActivity'
import { AccountMenu } from './AccountMenu'
import { PlaceKnowledge } from './PlaceKnowledge'
import { PlacePlanned } from './PlacePlanned'
import { PlaceProjects, useFocusFollowsConversation } from './PlaceProjects'
import { PlaceThreads } from './PlaceThreads'
import { PLACE_ICONS, PLACE_LABELS, SidebarPlaces, type PlaceSpec } from './SidebarPlaces'
import { cx, IconButton } from '@solera/ui'

const EMPTY: ConversationDto[] = []

/** Le raccourci porte la touche que la plateforme utilise réellement. */
const SEARCH_HINT = navigator.userAgent.includes('Mac') ? '⌘ K' : 'Ctrl K'

/**
 * La colonne de gauche.
 *
 * De haut en bas, et **toujours visible** : logo et repli · *Rechercher* ·
 * *Nouvelle conversation* · la liste verticale des lieux · l'Activité, ce qui t'attend
 * en tête (#121) · puis la **zone basse, seule partie variable et seule partie qui
 * défile** · le compte en une ligne.
 *
 * Le haut est fixe par construction : c'est ce qui garde les lieux et leurs compteurs
 * sous les yeux quoi qu'il arrive en dessous.
 */
export function Sidebar({
  onNavigate,
  onClose,
  onCollapse,
  onSearch,
}: {
  onNavigate: () => void
  onClose: () => void
  onCollapse: () => void
  onSearch: () => void
}) {
  // La coque passe une fonction neuve à chaque rendu. Les lignes de la colonne sont
  // mémoïsées : elles reçoivent une fonction stable, qui appelle toujours la dernière.
  const latestNavigate = useRef(onNavigate)
  useLayoutEffect(() => {
    latestNavigate.current = onNavigate
  })
  const stableNavigate = useCallback(() => latestNavigate.current(), [])
  const t = useTranslate()
  const navigate = useNavigate()
  const wide = useMediaQuery('(min-width: 48rem)')
  const display = useDisplaySettings()
  const requested = useSidebarPlace()
  const focus = useProjectFocus()
  const { data: projects } = useProjects()
  const { data: conversations } = useAllConversations()
  const { data: schedules } = useSchedules()
  // L'état du vault ne se demande que si le lieu est affiché : une instance qui ne
  // prend pas de notes n'a pas à interroger un index qu'elle n'a pas.
  const { data: vaultState } = useVaultState(display.knowledge)
  const reorderProjects = useReorderProjects()
  const scroller = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)
  // PROTOTYPE : en « Ajuster à la hauteur », le nombre de sessions qui tient sans défiler.
  const sessionLimit = useSidebarSessionLimit()
  const { budget: fitBudget, activityCollapsed } = useFitBudget(scroller, content, sessionLimit === 'fit' && wide)
  useStatusFeed()
  useFocusFollowsConversation(conversations ?? EMPTY)
  const { refreshing, refresh } = useRefreshLists()

  // Les tirs planifiés ne comptent pas dans l'activité : une tâche qui tourne toute
  // seule n'est pas une session qu'on suit, et le lieu *Planifiées* dit déjà où elle en
  // est. Leurs fils se lisent sur la page de planification du projet, pas ici.
  const attended = useMemo(
    () => (conversations ?? []).filter((entry) => !entry.scheduleId),
    [conversations],
  )
  const threads = useMemo(
    () => attended.filter((entry) => !entry.archivedAt),
    [attended],
  )

  const places: PlaceSpec[] = [
    {
      id: 'threads',
      label: PLACE_LABELS.threads,
      icon: PLACE_ICONS.threads,
      // PROTOTYPE : *Fils* a désormais sa page, `/sessions` (toutes les sessions). Le lieu
      // devient une destination comme les autres : son « ↗ » au survol le dit, à la
      // même place que celui des autres lieux et de l'Activité.
      page: '/sessions',
      count: threads.length,
    },
    {
      id: 'projects',
      label: PLACE_LABELS.projects,
      icon: PLACE_ICONS.projects,
      page: '/projects',
      count: null,
      dot: threads.some((entry) => unreadNow(entry)),
      // Créer un projet demandait de dérouler toute la zone basse jusqu'à sa dernière
      // ligne ; passé une dizaine de projets, c'est loin. Le raccourci la double ici,
      // sans la remplacer : la ligne du bas reste la voie visible au doigt.
      action: { page: '/projects/new', icon: FolderPlus, label: 'shell.places.newProject' },
    },
    // Le compte d'un lieu dit ce qui **réclame**, et le Savoir n'a rien de tel à dire
    // tant que la boîte des agents n'existe pas : les ébauches et les orphelines sont
    // du rangement, pas une sollicitation. La colonne les compte, le lieu non.
    ...(display.knowledge
      ? [{
        id: 'knowledge' as Place,
        label: PLACE_LABELS.knowledge,
        icon: PLACE_ICONS.knowledge,
        page: '/vault',
        count: null,
      }]
      : []),
    ...(display.schedules
      ? [{
        id: 'planned' as Place,
        label: PLACE_LABELS.planned,
        icon: PLACE_ICONS.planned,
        page: '/schedules',
        count: (schedules ?? []).length,
      }]
      : []),
  ]

  // Un lieu retiré de l'affichage n'a plus de ligne à surligner : la zone basse
  // retombe sur *Fils* plutôt que de montrer un lieu que la colonne ne nomme pas.
  const place = places.some((entry) => entry.id === requested) ? requested : 'threads'

  return (
    <div className="flex h-full flex-col">
      {/* PROTOTYPE : la bande réserve la même gouttière de barre que le bloc qui défile
          (`overflow-y-hidden` + `scrollbar-gutter: stable`), quelle que soit la largeur de
          la barre sur la plateforme : son bord droit est celui des lignes. Le bouton de
          repli en `sm` (28 px) avec le `px-3` (12 px) de la bande se centre à 26 px de ce
          bord, comme le ⋯ du projet (conteneur 8 + ligne 4 + 14). */}
      <HeaderBand zone="nav" className="pl-4 overflow-y-hidden [scrollbar-gutter:stable]">
        <Logo size={20} className="text-accent" />
        <span className="text-heading font-semibold tracking-tight">Solera</span>
        {/* Enveloppes plutôt que `hidden` sur le bouton : `IconButton` pose déjà un
            `inline-flex`, et entre deux utilitaires de display c'est l'ordre du CSS
            généré qui tranche, pas celui de la chaîne de classes. */}
        <span className="ml-auto md:hidden">
          <IconButton label={t('shell.nav.close')} size="sm" onClick={onClose}>
            <X size={16} />
          </IconButton>
        </span>
        <span className="ml-auto hidden md:block">
          <IconButton label={t('shell.nav.collapse')} size="sm" onClick={onCollapse}>
            <PanelLeftClose size={16} />
          </IconButton>
        </span>
      </HeaderBand>

      {/* Un filet sépare les deux gestes des lieux. Seul ajout du 2026-10-15 au haut de
          la colonne : *Rechercher* et *Nouvelle conversation* restent les deux boutons
          sobres d'avant, mais rien ne disait qu'ils ne sont pas eux-mêmes des lieux. */}
      <div className="shrink-0 overflow-y-hidden border-b border-line px-2 py-1.5 [scrollbar-gutter:stable]">
        {/* Le raccourci n'existe pas au doigt : sans cette entrée, la recherche serait
            inatteignable depuis un téléphone. */}
        <button
          type="button"
          onClick={onSearch}
          className="flex h-11 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-sm text-ink-soft transition-colors hover:bg-surface-high hover:text-ink md:h-9 pointer-coarse:h-11"
        >
          <Search size={16} className="shrink-0" />
          <span className="flex-1">{t('shell.search')}</span>
          <kbd className="hidden shrink-0 rounded border border-line px-1 text-micro text-ink-faint md:block">
            {SEARCH_HINT}
          </kbd>
        </button>

        {/* Sobre, sans pastille ni chevron, et **sans projet** : un fil neuf n'appartient
            à rien, sa destination se choisit sur sa page. Il retombait sur le dernier
            projet visité, faute de fils libres dans la branche qui l'a écrit — et sur la
            page de création de projet quand il n'y en avait aucun, c'est-à-dire que le
            geste le plus fréquent de l'application ouvrait un formulaire. */}
        <button
          type="button"
          onClick={() => {
            onNavigate()
            navigate('/c/new')
          }}
          className="flex h-11 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-sm text-ink-soft transition-colors hover:bg-surface-high hover:text-ink md:h-9 pointer-coarse:h-11"
        >
          <Plus size={16} className="shrink-0" />
          <span className="flex-1">{t('shell.conversation.new')}</span>
        </button>
      </div>

      {/* PROTOTYPE : un seul bloc qui défile, comme la colonne de Claude — lieux, Activité,
          projet et ses sessions. Le haut (Rechercher, Nouvelle conversation) et le bas
          (compte) restent fixes. La gouttière de la barre est réservée : rien ne se
          décale quand elle apparaît, les icônes de droite restent sur une même colonne. */}
      <div
        ref={scroller}
        data-sidebar-scroll
        className={cx('relative min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]')}
      >
        <PullToRefresh target={scroller} refreshing={refreshing} onRefresh={refresh} />
        <SidebarFitBudget.Provider value={sessionLimit === 'fit' ? fitBudget : null}>
        <div ref={content} data-sidebar-content>
        <SidebarPlaces places={places} current={place} onNavigate={stableNavigate} />

        {/* Toujours là, même l'Activité éteinte : ce qui t'attend ne se retire pas. */}
        <SidebarActivity
          conversations={attended}
          projects={projects}
          onNavigate={stableNavigate}
          // PROTOTYPE : en « Ajuster à la hauteur », l'Activité se replie sur son en-tête
          // (le rendu du téléphone) quand moins de 5 sessions tiendraient sous elle.
          coarse={!wide || activityCollapsed}
          // En mode projet (#51), ses demandes passent devant dans chaque rang (Q15).
          focus={place === 'projects' ? focus : undefined}
        />
        {place === 'projects' ? (
          <PlaceProjects
            projects={projects ?? []}
            conversations={conversations ?? []}
            onNavigate={stableNavigate}
            onReorder={(ids) => reorderProjects.mutate(ids)}
          />
        ) : place === 'knowledge' ? (
          <PlaceKnowledge state={vaultState} onNavigate={stableNavigate} />
        ) : place === 'planned' ? (
          <PlacePlanned tasks={schedules ?? []} projects={projects ?? []} onNavigate={stableNavigate} />
        ) : (
          <PlaceThreads
            conversations={threads}
            projects={projects ?? []}
            onNavigate={stableNavigate}
            onSearch={onSearch}
          />
        )}
        </div>
        </SidebarFitBudget.Provider>
      </div>

      <AccountMenu onNavigate={stableNavigate} />
    </div>
  )
}

/**
 * PROTOTYPE : « Ajuster à la hauteur ». Le nombre de lignes de session par liste qui
 * tient dans la colonne sans la faire défiler. Mesuré et non calculé : la colonne dit
 * ce qui déborde (ou ce qui reste), on retire ou on rajoute autant de lignes, puis on
 * remesure — deux ou trois passes suffisent, à chaque redimensionnement ou changement de
 * contenu. Les lignes comptées sont celles des listes de sessions (`data-session-list`),
 * et leur hauteur est lue sur la première (36 px, 44 au doigt).
 */
function useFitBudget(
  scroller: RefObject<HTMLDivElement | null>,
  content: RefObject<HTMLDivElement | null>,
  enabled: boolean,
): { budget: number; activityCollapsed: boolean } {
  const [budget, setBudget] = useState(10)
  const [tick, setTick] = useState(0)
  const [collapsed, setCollapsed] = useState(false)
  /** La hauteur de l'Activité dépliée, mesurée la dernière fois qu'elle l'était. */
  const fullActivity = useRef(0)

  useEffect(() => {
    if (!enabled) return
    const el = scroller.current
    const inner = content.current
    if (!el || !inner) return
    const observer = new ResizeObserver(() => setTick((value) => value + 1))
    observer.observe(el)
    observer.observe(inner)
    return () => observer.disconnect()
  }, [enabled, scroller, content])

  useLayoutEffect(() => {
    if (!enabled) return
    const el = scroller.current
    const inner = content.current
    if (!el || !inner) return
    const rows = inner.querySelectorAll<HTMLElement>('[data-session-list] > li')
    const rowHeight = rows[0]?.offsetHeight || 36
    const overflow = inner.offsetHeight - el.clientHeight
    const lists = inner.querySelectorAll('[data-session-list][data-cut="true"]')
    if (overflow > 0) {
      const next = Math.max(0, budget - Math.ceil(overflow / rowHeight))
      if (next !== budget) {
        setBudget(next)
        return
      }
    } else if (lists.length > 0 && -overflow >= rowHeight) {
      // De la place : on n'en rajoute que si une liste est effectivement coupée au budget.
      setBudget(budget + Math.floor(-overflow / rowHeight / lists.length))
      return
    }

    // L'Activité (Tim, 2026-11-11) : dépliée, elle garde son quart de colonne tant qu'il
    // tient au moins 5 sessions sous elle ; sinon elle se réduit à son en-tête, comme au
    // téléphone, et rend sa place. Elle se redéplie quand la place gagnée en la repliant
    // laisserait encore 5 sessions — l'écart entre les deux seuils évite le clignotement.
    const activity = inner.querySelector<HTMLElement>('[data-sidebar-activity]')
    if (!activity) return
    if (!collapsed) {
      fullActivity.current = activity.offsetHeight
      if (lists.length > 0 && budget < MIN_SESSIONS) setCollapsed(true)
    } else {
      const gain = fullActivity.current - activity.offsetHeight
      // Rien de coupé : il suffit que la place libre couvre l'Activité dépliée.
      const fits = lists.length === 0 ? -overflow >= gain : budget - Math.ceil(gain / rowHeight) >= MIN_SESSIONS
      if (fits) setCollapsed(false)
    }
  }, [enabled, budget, tick, collapsed, scroller, content])

  return { budget, activityCollapsed: enabled && collapsed }
}

/** Sous ce nombre de sessions visibles, l'Activité se replie pour leur rendre la place. */
const MIN_SESSIONS = 5
