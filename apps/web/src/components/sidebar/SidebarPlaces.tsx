import { ArrowUpRight, BookOpen, CalendarClock, MessagesSquare, SquareKanban, type LucideIcon } from 'lucide-react'
import { NavLink, useNavigate } from 'react-router-dom'
import type { MessageKey } from '../../lib/i18n'
import { useTranslate } from '../../lib/i18n'
import { setSidebarPlace, type Place } from '../../lib/sidebar'
import { cx, Tooltip } from '@solera/ui'

/**
 * Le raccourci de création qu'un lieu peut porter, à droite de sa ligne.
 *
 * Il entre dans le `PlaceSpec` plutôt que d'être câblé sur l'identifiant : `SidebarPlaces`
 * rend tous les lieux de la même façon, et un `if (place.id === 'projects')` au milieu
 * du rendu aurait fait du générique un cas particulier déguisé.
 *
 * Une icône qui **nomme l'objet créé**, et jamais un `Plus` nu : la zone basse pose déjà
 * des « + » de création de *conversation*, un par ligne de projet, à quelques pixels
 * d'ici. Deux gestes identiques pour deux objets différents seraient le piège.
 */
export interface PlaceAction {
  /** La page du formulaire de création. Un lien : il s'ouvre dans un onglet, se copie. */
  page: string
  icon: LucideIcon
  /** L'intitulé, lu par l'infobulle *et* par le lecteur d'écran : il dit l'action. */
  label: MessageKey
}

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
  /** Le raccourci de création, pour les lieux qui en ont un. */
  action?: PlaceAction
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
          const ActionIcon = place.action?.icon
          const active = place.id === current
          return (
            <li key={place.id}>
              {/*
                La ligne est une `div` qui contient le lieu et, le cas échéant, son
                raccourci — et non un `<button>` enveloppant, comme c'était le cas tant
                qu'elle n'avait qu'une cible : un bouton dans un bouton n'est pas du HTML
                valide. Même motif que les lignes de la zone basse.
              */}
              <div className={cx(
                'group/place flex h-11 items-center rounded-md transition-colors md:h-9 pointer-coarse:h-11',
                active ? 'bg-accent-wash font-medium text-ink' : 'text-ink-soft hover:bg-surface-high hover:text-ink',
              )}>
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
                  className="flex h-full min-w-0 flex-1 items-center gap-2.5 rounded-md px-2.5 text-left text-sm"
                >
                  <Icon size={16} className="shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{t(place.label)}</span>
                  {/* Au survol, le « ↗ » prend la place du compteur : il dit que la ligne
                      mène à une page, et non qu'elle n'a fait que régler la colonne. Il
                      reste un ornement et non une seconde cible — la ligne ouvre déjà
                      cette page. Le raccourci de création qui le suit, lui, est un vrai
                      bouton : il ne mène pas au même endroit, et c'est précisément ce
                      qui l'autorise à occuper ce bord. */}
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

                {place.action && ActionIcon ? (
                  <Tooltip label={t(place.action.label)}>
                    <NavLink
                      to={place.action.page}
                      onClick={onNavigate}
                      aria-label={t(place.action.label)}
                      /*
                        Effacé et non retiré : `hidden` le sortirait de l'ordre de
                        tabulation, et le raccourci ne s'atteindrait plus au clavier —
                        or c'est au clavier qu'un raccourci sert le plus.

                        Au doigt il disparaît pour de bon, lui et sa cible invisible : il
                        n'y a pas de survol pour l'annoncer, et la zone basse porte déjà
                        sa ligne « Nouveau projet… », permanente et nommée.
                      */
                      className="mr-1 inline-flex size-7 shrink-0 items-center justify-center rounded-md text-ink-faint opacity-0 transition hover:bg-surface-high hover:text-ink focus-visible:opacity-100 group-hover/place:opacity-100 group-focus-within/place:opacity-100 pointer-coarse:hidden"
                    >
                      <ActionIcon size={14} />
                    </NavLink>
                  </Tooltip>
                ) : null}
              </div>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
