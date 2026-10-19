import { ArrowUpRight, BookOpen, CalendarClock, MessagesSquare, SquareKanban, type LucideIcon } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import type { MessageKey } from '../../lib/i18n'
import { useTranslate } from '../../lib/i18n'
import { setSidebarPlace, type Place } from '../../lib/sidebar'
import { StateDot } from '../chat/Signals'
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
                La ligne est une `div` qui tient le lieu, son raccourci et le créneau de
                droite — et non un `<button>` enveloppant, comme c'était le cas tant
                qu'elle n'avait qu'une cible : un bouton dans un bouton n'est pas du HTML
                valide. Même motif que les lignes de la zone basse.
              */}
              <div className={cx(
                'group/place relative flex h-11 items-center gap-1 rounded-md pr-2.5 transition-colors md:h-9 pointer-coarse:h-11',
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
                  /*
                    Le bouton ne mesure que son texte, mais son `::after` couvre la ligne
                    entière : toute la largeur ouvre le lieu, y compris sous le créneau de
                    droite, qui n'a rien d'une cible. Sorti du flux, il n'a pas de largeur
                    à disputer au compteur — un `w-full` l'aurait repoussé ou tronqué.

                    Un clic sur un pseudo-élément est un clic sur son élément : le compteur
                    et le « ↗ », qui ne se positionnent pas, passent dessous et laissent
                    passer. Seul le raccourci remonte au-dessus, par son `relative z-10`.
                  */
                  className="flex h-full min-w-0 flex-1 items-center gap-2.5 rounded-md pl-2.5 text-left text-sm after:absolute after:inset-0 after:rounded-md"
                >
                  <Icon size={16} className="shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{t(place.label)}</span>
                </button>

                {place.action && ActionIcon ? (
                  <Tooltip label={t(place.action.label)}>
                    {/*
                      Un `Link` et non un `NavLink` : aucun style actif n'est consommé ici,
                      et le `aria-current` que `NavLink` pose tout seul aurait donné, sur la
                      page de création, deux éléments courants dans la même navigation —
                      la ligne *Projets* et son raccourci. Un lecteur d'écran en annonce
                      deux pour une seule position.
                    */}
                    <Link
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
                      className="relative z-10 inline-flex size-7 shrink-0 items-center justify-center rounded-md text-ink-faint opacity-0 transition hover:bg-surface-high hover:text-ink focus-visible:opacity-100 group-hover/place:opacity-100 group-focus-within/place:opacity-100 pointer-coarse:hidden"
                    >
                      <ActionIcon size={14} />
                    </Link>
                  </Tooltip>
                ) : null}

                {/*
                  Le créneau de droite : le compteur au repos, le « ↗ » au survol. Il dit
                  que la ligne mène à une page, et non qu'elle n'a fait que régler la
                  colonne. Un ornement et non une seconde cible — la ligne ouvre déjà
                  cette page, et deux cibles pour une destination ne feraient qu'un piège.

                  Il est **au bord**, après le raccourci, et donc hors du bouton : c'est ce
                  qui garde la pastille de ce lieu dans la même colonne que les compteurs
                  des lieux sans raccourci. Il ne coûte pourtant pas un pixel de zone
                  cliquable — le `::after` du bouton passe dessous.
                */}
                <span aria-hidden className={cx(
                  'shrink-0 text-meta tabular-nums text-ink-faint',
                  place.page && 'group-hover/place:hidden',
                )}>
                  {place.count !== null
                    ? place.count
                    : place.dot ? <StateDot state="unread" labelled={false} /> : null}
                </span>
                {place.page ? (
                  <ArrowUpRight size={14} className="hidden shrink-0 text-ink-faint group-hover/place:block" />
                ) : null}
              </div>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
