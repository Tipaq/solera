import { PanelLeftClose, Plus, Search, X } from 'lucide-react'
import { useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAllConversations } from '../../lib/conversations'
import { useRefreshLists, useStatusFeed } from '../../lib/conversation-status'
import { useDisplaySettings } from '../../lib/display-settings'
import { useTranslate } from '../../lib/i18n'
import { useProjects, useReorderProjects } from '../../lib/projects'
import { unreadNow } from '../../lib/reads'
import { useSchedules } from '../../lib/schedules'
import { useSidebarPlace, type Place } from '../../lib/sidebar'
import { useVaultState } from '../../lib/vault'
import { useMediaQuery } from '../../lib/viewport'
import { HeaderBand } from '../HeaderBand'
import { Logo } from '../Logo'
import { PullToRefresh } from '../PullToRefresh'
import { SidebarActivity } from '../SidebarActivity'
import { AccountMenu } from './AccountMenu'
import { PlaceKnowledge } from './PlaceKnowledge'
import { PlacePlanned } from './PlacePlanned'
import { PlaceProjects } from './PlaceProjects'
import { PlaceThreads } from './PlaceThreads'
import { PLACE_ICONS, PLACE_LABELS, SidebarPlaces, type PlaceSpec } from './SidebarPlaces'
import { cx, IconButton } from '@solera/ui'

/** Le raccourci porte la touche que la plateforme utilise réellement. */
const SEARCH_HINT = navigator.userAgent.includes('Mac') ? '⌘ K' : 'Ctrl K'

/**
 * La colonne de gauche.
 *
 * De haut en bas, et **toujours visible** : logo et repli · *Rechercher* ·
 * *Nouvelle conversation* · la liste verticale des lieux · l'activité · puis la **zone
 * basse, seule partie variable et seule partie qui défile** · le compte en une ligne.
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
  const t = useTranslate()
  const navigate = useNavigate()
  const wide = useMediaQuery('(min-width: 48rem)')
  const display = useDisplaySettings()
  const requested = useSidebarPlace()
  const { data: projects } = useProjects()
  const { data: conversations } = useAllConversations()
  const { data: schedules } = useSchedules()
  // L'état du vault ne se demande que si le lieu est affiché : une instance qui ne
  // prend pas de notes n'a pas à interroger un index qu'elle n'a pas.
  const { data: vaultState } = useVaultState(display.knowledge)
  const reorderProjects = useReorderProjects()
  const scroller = useRef<HTMLDivElement>(null)
  useStatusFeed()
  const { refreshing, refresh } = useRefreshLists()

  // Les tirs planifiés ne comptent pas dans l'activité : une tâche qui tourne toute
  // seule n'est pas une session qu'on suit, et sa section dit déjà où elle en est.
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
      page: null,
      count: threads.length,
    },
    {
      id: 'projects',
      label: PLACE_LABELS.projects,
      icon: PLACE_ICONS.projects,
      page: '/projects',
      count: null,
      dot: threads.some((entry) => unreadNow(entry)),
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
      <HeaderBand zone="nav" className="px-4">
        <Logo size={20} className="text-accent" />
        <span className="text-heading font-semibold tracking-tight">Solera</span>
        {/* Enveloppes plutôt que `hidden` sur le bouton : `IconButton` pose déjà un
            `inline-flex`, et entre deux utilitaires de display c'est l'ordre du CSS
            généré qui tranche, pas celui de la chaîne de classes. */}
        <span className="ml-auto md:hidden">
          <IconButton label={t('shell.nav.close')} onClick={onClose}>
            <X size={16} />
          </IconButton>
        </span>
        <span className="ml-auto hidden md:block">
          <IconButton label={t('shell.nav.collapse')} onClick={onCollapse}>
            <PanelLeftClose size={16} />
          </IconButton>
        </span>
      </HeaderBand>

      <div className="shrink-0 px-2 py-1.5">
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

      <SidebarPlaces places={places} current={place} onNavigate={onNavigate} />

      {display.activity ? (
        <SidebarActivity
          conversations={attended}
          projects={projects}
          onNavigate={onNavigate}
          coarse={!wide}
        />
      ) : null}

      {/* La seule partie qui défile. Ce qui déborde passe sous le pli : le haut de la
          colonne est fixe par construction, pas par accident. */}
      <div ref={scroller} className={cx('relative min-h-0 flex-1 overflow-y-auto')}>
        <PullToRefresh target={scroller} refreshing={refreshing} onRefresh={refresh} />
        {place === 'projects' ? (
          <PlaceProjects
            projects={projects ?? []}
            conversations={conversations ?? []}
            schedules={schedules ?? []}
            onNavigate={onNavigate}
            onReorder={(ids) => reorderProjects.mutate(ids)}
          />
        ) : place === 'knowledge' ? (
          <PlaceKnowledge state={vaultState} onNavigate={onNavigate} />
        ) : place === 'planned' ? (
          <PlacePlanned tasks={schedules ?? []} projects={projects ?? []} onNavigate={onNavigate} />
        ) : (
          <PlaceThreads
            conversations={threads}
            projects={projects ?? []}
            onNavigate={onNavigate}
            onSearch={onSearch}
          />
        )}
      </div>

      <AccountMenu onNavigate={onNavigate} />
    </div>
  )
}
