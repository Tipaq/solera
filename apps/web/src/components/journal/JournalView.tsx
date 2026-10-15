import {
  BookOpen,
  CalendarDays,
  CircleCheck,
  CircleDot,
  Clock,
  GitBranch,
  History,
  MessagesSquare,
  StickyNote,
} from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { JournalEntryDto, JournalKind, ProjectDto } from '@solera/protocol'
import { Banner, EmptyState, cx } from '@solera/ui'
import { ProjectAvatar } from '../ProjectAvatar'
import { locale, useTranslate } from '../../lib/i18n'
import {
  JOURNAL_FILTERS,
  JOURNAL_FILTER_LABELS,
  JOURNAL_KIND_LABELS,
  countByFilter,
  useJournal,
  useJournalDays,
  type JournalFilter,
} from '../../lib/journal'

/**
 * Ce que la pastille de tête de ligne demande d'un projet, et rien de plus.
 *
 * Un `ProjectDto` entier serait disproportionné : la pastille ne lit que l'image et la
 * couleur, et l'identifiant sert à la retrouver. Restreindre ici est aussi ce qui
 * permet à la story de poser trois champs plutôt que d'inventer un projet complet,
 * donc de montrer la ligne sans serveur.
 */
export type JournalProject = Pick<ProjectDto, 'id' | 'image' | 'color'>

/**
 * Le *Journal* : ce qui s'est décidé et quand, à partir de matière qui existe déjà.
 *
 * Un seul composant pour les deux vues (F5 et F11). Elles ne diffèrent que par la
 * **pastille de projet** en tête de ligne, et recopier trois cents lignes pour cette
 * pastille aurait donné deux pages qui divergent au premier correctif — le genre
 * d'écart que l'audit du 2026-10-14 est précisément venu défaire ailleurs.
 *
 * Deux règles tenues par la maquette, et qu'on casse facilement en y touchant :
 *
 * - **La colonne de droite est fixe** : provenance puis heure, au même endroit sur
 *   chaque ligne. C'est elle qui rend la liste lisible de haut en bas quand les natures
 *   se mélangent. Le libellé et le titre, eux, flottent — mettre le libellé en colonne
 *   fixe ferait une gouttière vide large comme « TIR PLANIFIÉ ».
 * - **Les filtres sont des pilules basses, jamais une seconde rangée d'onglets.** La
 *   rangée du dessus porte les vues ; deux rangées de même forme feraient hésiter sur
 *   laquelle on est en train de régler.
 *
 * Référence : `docs/audits/2026-10-14-gestion-de-projet/final/pages/`, F5 et F11.
 */
export function JournalView({ projectId, projects }: {
  /** Le projet, ou `undefined` pour le portefeuille. */
  projectId?: string
  /** De quoi rendre la pastille, au portefeuille seulement. */
  projects?: JournalProject[]
}) {
  const t = useTranslate()
  const [filter, setFilter] = useState<JournalFilter>('all')
  const { data, isPending } = useJournal(projectId)
  const days = useJournalDays(data?.entries, filter)
  const totals = countByFilter(data?.entries)

  if (isPending && !data) return null

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Les pilules ne défilent pas avec la liste : on change de filtre en cours de
          lecture, et aller les rechercher en haut casserait le geste. */}
      <div className="flex shrink-0 items-center gap-3 px-4 pt-3 pb-1 md:px-6">
        {/* Les pilules défilent plutôt que de passer à la ligne : au doigt, un retour
            à la ligne reléguait la fenêtre (« 14 jours ») seule sur une seconde ligne,
            qui coûtait sa hauteur pour deux mots. */}
        <div
          role="radiogroup"
          aria-label={t('journal.filters')}
          className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto"
        >
          {JOURNAL_FILTERS.map((entry) => (
            <FilterPill
              key={entry}
              label={t(JOURNAL_FILTER_LABELS[entry])}
              selected={entry === filter}
              // Une pilule sans ligne reste cliquable mais s'éteint : la retirer ferait
              // sauter les suivantes d'un cran à chaque rechargement, et c'est une
              // information en soi qu'une famille n'ait rien dit depuis deux semaines.
              empty={totals[entry] === 0}
              onSelect={() => setFilter(entry)}
            />
          ))}
        </div>
        <span className="ml-auto shrink-0 text-xs text-ink-faint">
          {t('journal.window', { days: data?.days ?? 0 })}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6 md:px-6">
        {data?.repoIncomplete ? (
          <div className="pt-2">
            <Banner tone="caution">{t('journal.repoIncomplete')}</Banner>
          </div>
        ) : null}

        {days.length === 0 ? (
          <div className="pt-6">
            <EmptyState
              icon={<History size={22} />}
              title={t(filter === 'all' ? 'journal.empty' : 'journal.emptyFilter')}
              description={t('journal.emptyHint')}
            />
          </div>
        ) : (
          <div className="flex flex-col gap-4 pt-2">
            {days.map((day) => (
              <section key={day.at} className="flex min-w-0 flex-col gap-1.5">
                <h2 className="flex items-center gap-2 px-1 text-sm text-ink-soft">
                  <CalendarDays size={14} className="shrink-0 text-ink-faint" />
                  <span className="shrink-0">{dayLabel(day.at, t)}</span>
                  {/* Un filet qui va jusqu'au bord : il sépare les jours sans peser
                      autant qu'un titre souligné, et il dit où la journée s'arrête. */}
                  <span aria-hidden className="h-px min-w-0 flex-1 bg-line" />
                </h2>
                <ul className="flex flex-col gap-1.5">
                  {day.entries.map((entry) => (
                    <JournalRow key={entry.id} entry={entry} projects={projects} />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function FilterPill({ label, selected, empty, onSelect }: {
  label: string
  selected: boolean
  empty: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cx(
        'flex h-9 shrink-0 items-center rounded-full px-3 text-sm whitespace-nowrap',
        'transition-[background,color] duration-150 pointer-coarse:h-11',
        'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent',
        selected
          ? 'bg-surface-high text-ink'
          : empty
            ? 'text-ink-faint/60 hover:text-ink-soft'
            : 'text-ink-faint hover:text-ink',
      )}
    >
      {label}
    </button>
  )
}

/** L'icône de chaque nature, reprise du libellé qu'elle précède. */
const KIND_ICONS: Record<JournalKind, ReactNode> = {
  note: <StickyNote size={15} />,
  cardOpened: <CircleDot size={15} />,
  cardClosed: <CircleCheck size={15} />,
  session: <MessagesSquare size={15} />,
  run: <Clock size={15} />,
  branch: <GitBranch size={15} />,
  audit: <BookOpen size={15} />,
}

/**
 * Les deux seules teintes de la liste, et elles ne sont pas décoratives : ce qui ferme
 * un chantier et ce qui a échoué. Tout le reste est au gris du texte secondaire — une
 * ligne par source colorée ferait un sapin de Noël où plus rien ne ressort.
 */
function iconTone(entry: JournalEntryDto): string {
  if (entry.kind === 'cardClosed') return 'text-positive'
  if (entry.status === 'failed' || entry.status === 'timed_out') return 'text-caution'
  return 'text-ink-faint'
}

/**
 * Une ligne du journal. Exportée pour sa story, qui montre les sept natures côte à côte
 * sans serveur : c'est leur alignement qu'on vérifie, pas la requête qui les apporte.
 */
export function JournalRow({ entry, projects }: { entry: JournalEntryDto; projects?: JournalProject[] }) {
  const t = useTranslate()
  const project = projects?.find((candidate) => candidate.id === entry.projectId)
  const to = destination(entry)

  const body = (
    <>
      {projects ? (
        project ? (
          <ProjectAvatar project={project} className="size-4 shrink-0" />
        ) : (
          <span aria-hidden className="size-4 shrink-0" />
        )
      ) : null}
      <span aria-hidden className={cx('shrink-0', iconTone(entry))}>{KIND_ICONS[entry.kind]}</span>
      <span className="shrink-0 text-meta font-medium tracking-wide text-ink-faint uppercase">
        {t(JOURNAL_KIND_LABELS[entry.kind])}
      </span>
      <span className="min-w-0 flex-1 truncate text-sm">{entry.title}</span>
      {/* La provenance disparaît au doigt plutôt que de passer à la ligne : l'heure et
          le titre tiennent, et c'est ce qu'on lit en premier. */}
      <span className="hidden max-w-[18rem] shrink-0 truncate text-xs text-ink-faint sm:block">
        {provenance(entry, t)}
      </span>
      <span className="w-11 shrink-0 text-right text-xs tabular-nums text-ink-faint">
        {time(entry.at)}
      </span>
    </>
  )

  const shape =
    'flex min-h-12 min-w-0 items-center gap-3 rounded-xl border border-line px-3.5 py-2'

  return (
    <li>
      {to ? (
        <Link
          to={to}
          className={cx(
            shape,
            'transition-colors hover:border-line-strong focus-visible:outline-2 focus-visible:outline-accent',
          )}
        >
          {body}
        </Link>
      ) : (
        /* Une fusion faite au terminal et un audit versé sur le disque n'ouvrent rien :
           Solera n'a pas de page pour eux. Une ligne morte qui *a l'air* cliquable est
           pire qu'une ligne qui ne l'a pas. */
        <div className={shape}>{body}</div>
      )}
    </li>
  )
}

/**
 * Où mène une ligne, quand elle mène quelque part.
 *
 * La conversation d'abord : c'est ce qu'on veut rouvrir quand on relit une note ou un
 * tir. La carte ensuite, par le board, qui sait déjà ouvrir son panneau sur un numéro.
 */
function destination(entry: JournalEntryDto): string | null {
  if (entry.conversationId) return `/p/${entry.projectId}/c/${entry.conversationId}`
  if (entry.cardNumber !== null) return `/p/${entry.projectId}/board?carte=${entry.cardNumber}`
  return null
}

/**
 * La colonne de droite, composée ici et non par le serveur.
 *
 * Le serveur rend un numéro, un texte déjà écrit ailleurs et un compte ; c'est la
 * langue de l'interface qui décide de leur ordre et de leurs accords. « carte #17 ·
 * 1 session » ne se traduit pas en remplaçant des mots.
 */
function provenance(entry: JournalEntryDto, t: ReturnType<typeof useTranslate>): string {
  const parts: string[] = []
  if (entry.cardNumber !== null) parts.push(t('journal.card', { number: entry.cardNumber }))
  if (entry.kind === 'run') parts.push(t('journal.task'))
  if (entry.source) parts.push(entry.source)
  // Un compte à zéro ne s'écrit pas : « 0 session » décrit une absence, et la colonne
  // de droite ne sert qu'à dire d'où la ligne sort. Même règle que la tuile à zéro du
  // bandeau, qui disparaît au lieu de se griser.
  if (entry.count) {
    parts.push(
      entry.kind === 'branch'
        ? t('journal.commits', { count: entry.count })
        : t('journal.sessions', { count: entry.count }),
    )
  }
  if (entry.status) parts.push(t(`journal.run.${entry.status}`))
  return parts.join(' · ')
}

/** L'heure seule : le jour est déjà dit par l'en-tête au-dessus. */
function time(at: number): string {
  return new Intl.DateTimeFormat(locale(), { hour: '2-digit', minute: '2-digit' }).format(at)
}

/**
 * Le jour, nommé quand il a un nom.
 *
 * « Aujourd'hui » et « Hier » et rien d'autre : au-delà, personne ne compte les jours
 * de tête, et « avant-hier » se dit mal dans les deux langues dès qu'on dépasse trois.
 */
function dayLabel(at: number, t: ReturnType<typeof useTranslate>): string {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const gap = Math.round((today.getTime() - at) / 86_400_000)
  if (gap === 0) return t('journal.today')
  if (gap === 1) return t('journal.yesterday')
  return new Intl.DateTimeFormat(locale(), {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(at)
}
