import { ArrowUpRight, BookOpen, CalendarClock, MessagesSquare, SquareKanban, type LucideIcon } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import type { MessageKey } from '../../lib/i18n'
import { useTranslate } from '../../lib/i18n'
import { setSidebarPlace, type Place } from '../../lib/sidebar'
import { cx } from '@solera/ui'

export interface PlaceSpec {
  id: Place
  label: MessageKey
  icon: LucideIcon
  /**
   * La page du lieu. Un lieu est une **destination** : le clic l'ouvre au centre *et*
   * règle la zone basse, les deux ensemble. C'est la correction du quinzième tour — un
   * clic qui ne changeait qu'un coin de l'écran se lisait mal.
   *
   * `null` pour *Fils*, le seul lieu sans page : la palette couvre déjà la recherche
   * dans l'historique, et `/` renvoie sur le dernier contexte — cliquer *Fils* en
   * lisant une note aurait donc fermé la note.
   */
  page: string | null
  /** Le compteur, ou `null` quand le lieu n'a qu'un point de nouveauté. */
  count: number | null
  /** Du nouveau dans ce lieu, quand il ne se compte pas. */
  dot?: boolean
}

export const PLACE_ICONS: Record<Place, LucideIcon> = {
  threads: MessagesSquare,
  projects: SquareKanban,
  knowledge: BookOpen,
  planned: CalendarClock,
}

export const PLACE_LABELS: Record<Place, MessageKey> = {
  threads: 'shell.place.threads',
  projects: 'shell.place.projects',
  knowledge: 'shell.place.knowledge',
  planned: 'shell.place.planned',
}

/**
 * Les lieux, en liste verticale.
 *
 * Pas une rangée d'onglets : trois tiennent dans 17 rem, quatre à l'étroit, cinq jamais
 * — et il en viendra d'autres. Une liste grandit sans rien casser, et le réglage
 * *Affichage* décide lesquels apparaissent ; ce qu'on retire reste joignable par la
 * palette.
 */
export function SidebarPlaces({ places, current, onNavigate }: {
  places: PlaceSpec[]
  current: Place
  onNavigate: () => void
}) {
  const t = useTranslate()
  const navigate = useNavigate()

  return (
    <nav aria-label={t('shell.places.label')} className="shrink-0 border-b border-line px-2 py-1.5">
      <ul>
        {places.map((place) => {
          const Icon = place.icon
          const active = place.id === current
          return (
            <li key={place.id}>
              <button
                type="button"
                aria-current={active ? 'page' : undefined}
                onClick={() => {
                  // Le lieu se déduit de l'adresse ouverte ; ce clic est l'exception
                  // qu'on s'accorde, et elle ne survit pas à la navigation suivante.
                  setSidebarPlace(place.id)
                  if (place.page) navigate(place.page)
                  onNavigate()
                }}
                className={cx(
                  'group/place flex h-11 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-sm transition-colors md:h-9 pointer-coarse:h-11',
                  active ? 'bg-accent-wash font-medium text-ink' : 'text-ink-soft hover:bg-surface-high hover:text-ink',
                )}
              >
                <Icon size={16} className="shrink-0" />
                <span className="min-w-0 flex-1 truncate">{t(place.label)}</span>
                {/* Au survol, le « ↗ » prend la place du compteur : il dit que la ligne
                    mène à une page, et non qu'elle n'a fait que régler la colonne. Un
                    ornement et non un second bouton — la ligne ouvre déjà cette page,
                    et deux cibles pour une destination ne feraient qu'un piège. */}
                <span aria-hidden className={cx(
                  'shrink-0 text-meta tabular-nums text-ink-faint',
                  place.page && 'group-hover/place:hidden',
                )}>
                  {place.count !== null
                    ? place.count
                    : place.dot ? <span className="block size-1.5 rounded-full bg-accent" /> : null}
                </span>
                {place.page ? (
                  <ArrowUpRight size={14} className="hidden shrink-0 text-ink-faint group-hover/place:block" />
                ) : null}
              </button>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
