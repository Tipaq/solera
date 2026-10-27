import {
  AlarmClock,
  ArrowUpRight,
  CalendarClock,
  CircleDot,
  Flag,
  GitBranch,
  History,
  MessageCircleQuestion,
  Pencil,
  Plus,
  TriangleAlert,
} from 'lucide-react'
import { Suspense, lazy, useMemo, useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import type { CardDto, ScheduledTaskDto } from '@solera/protocol'
import { AgentIcon } from '../components/AgentIcon'
import { DemandTile } from '../components/places/DemandTile'
import { SessionRow } from '../components/project/SessionRow'
import { MilestoneBanner } from '../components/project/MilestoneBanner'
import {
  JOURNAL_KIND_ICONS,
  journalDestination,
  journalIconTone,
} from '../components/journal/JournalView'
import { Badge, Button, EmptyState, cx } from '@solera/ui'
import { demandsOf, oldest, useLiveConversations } from '../lib/activity'
import { ACTIVITY_GROUPS } from '../lib/activity-groups'
import { useActivityRows, type ActivityRow } from '../lib/activity-rows'
import { useActiveMilestones } from '../lib/milestones'
import { useCards } from '../lib/cards'
import { milestoneIdsOf, milestonesOf, type Milestone } from '../lib/timeline'
import { useAllConversations } from '../lib/conversations'
import { cronToHuman } from '../lib/cron'
import { daysUntil, elapsed, relativeDate } from '../lib/dates'
import { locale, useTranslate } from '../lib/i18n'
import { openPanelOnArrival } from '../lib/panel'
import { JOURNAL_KIND_LABELS, useJournal } from '../lib/journal'
import { useProjects } from '../lib/projects'
import {
  RUN_LABELS,
  RUN_TONES,
  describeCadence,
  formatDateTime,
  lastRun,
  useSchedules,
} from '../lib/schedules'

/**
 * La création d'une tâche planifiée, chargée à son ouverture (#128) : elle porte le
 * calcul des prochains passages cron et la section de vérification, qui n'ont rien à
 * faire dans le paquet d'entrée pour un bouton qu'on presse rarement.
 */
const ScheduleDialog = lazy(() =>
  import('../components/schedule/ScheduleDialog').then((m) => ({ default: m.ScheduleDialog })),
)

/** Échéances montrées : au-delà, la tuile redirait la chronologie, qui est à un onglet. */
const DUE_SHOWN = 4

/** Lignes de journal montrées : même borne que les échéances, pour que les trois
    colonnes de la grille gardent la même hauteur quand elles sont pleines. */
const JOURNAL_SHOWN = 4

/** Sessions montrées dans « En ce moment » : au-delà, l'onglet Activité est à un lien. */
const NOW_SHOWN = 8

/**
 * L'**Aperçu** d'un projet : la vue d'arrivée, et la seule sans action propre — elle ne
 * crée rien, elle envoie.
 *
 * Elle remplace le formulaire de réglages qui occupait `/p/:projectId` : arriver dans un
 * projet doit montrer où il en est, pas demander de le configurer. Les réglages sont
 * passés dans le `⋯`, à `/p/:projectId/settings`.
 *
 * Elle s'appelait « Tableau de bord » jusqu'au 2026-10-15 : deux mots pour la même chose
 * dans deux langues, et c'est le premier qui a cédé — « board » est partout dans le code
 * et dans les URL, « tableau de bord » nulle part (décision 4 de
 * `docs/audits/2026-10-14-gestion-de-projet/`).
 *
 * Trois étages, et c'est l'ordre qui les justifie : ce qui **réclame**, ce qui est
 * **en cours**, ce qui **reviendra tout seul**. Le bandeau du haut ne compte donc pas
 * l'inventaire — « 7 cartes » n'y figure pas, parce que ça ne demande rien à personne.
 *
 * La bande et la rangée d'onglets appartiennent à `ProjectLayout` : cette page commence
 * à son contenu, et c'est ce qui fait que passer d'un onglet à l'autre ne redessine que
 * le contenu.
 */
export function ProjectOverviewPage() {
  const { projectId } = useParams()
  const t = useTranslate()

  const { data: projects, isPending } = useProjects()
  const { data: conversations } = useAllConversations()
  const { data: cards } = useCards(projectId)
  const { data: schedules } = useSchedules()

  const project = projects?.find((entry) => entry.id === projectId)

  const mine = useMemo(
    () => (conversations ?? []).filter((entry) => entry.projectId === projectId),
    [conversations, projectId],
  )
  const live = useLiveConversations(mine)
  const demands = demandsOf(live, cards ?? [], project)
  const tasks = useMemo(
    () => (schedules ?? []).filter((task) => task.projectId === projectId),
    [schedules, projectId],
  )

  const [creatingTask, setCreatingTask] = useState(false)

  /*
    Les sessions vivantes, dans l'ordre des groupes de l'Activité : ce qui te demande
    quelque chose d'abord, puis ce qui est prêt à relire, puis ce qui travaille. Les
    terminées n'en sont pas, l'onglet les garde.
  */
  const rows = useActivityRows(projectId, project)
  const { data: runs } = useActiveMilestones(projectId)
  const now = useMemo(
    () =>
      ACTIVITY_GROUPS.filter((group) => group !== 'done')
        .flatMap((group) => rows.filter((row) => row.group === group))
        .slice(0, NOW_SHOWN),
    [rows],
  )

  /*
    Le jalon courant : le premier qui n'est pas livré, dans l'ordre de sa date. Un seul,
    et non la liste — l'Aperçu dit où en est le chantier, et « trois jalons ouverts »
    est un inventaire. La chronologie les montre tous, elle est à un onglet d'ici.
  */
  const milestones = useMemo(() => milestonesOf(cards ?? []), [cards])
  const current = useMemo(
    () => milestones.find((entry) => entry.done < entry.cards.length) ?? milestones[0] ?? null,
    [milestones],
  )

  const milestoneIds = useMemo(() => milestoneIdsOf(cards ?? []), [cards])

  /*
    Les échéances qui approchent : les cartes ouvertes qui ont une date, la plus proche
    d'abord, **les dépassées comprises** — une échéance en retard est précisément celle
    qu'il faut voir, et la ranger plus loin que celle de demain serait absurde.
  */
  const due = useMemo(
    () =>
      (cards ?? [])
        .filter(
          (card) =>
            card.dueAt !== null &&
            card.column !== 'done' &&
            card.column !== 'abandoned' &&
            // La date d'une carte-jalon est celle du jalon, que la tuile d'à côté porte
            // déjà : l'écrire ici la dirait deux fois sur la même ligne de l'écran.
            !milestoneIds.has(card.id),
        )
        .sort((a, b) => (a.dueAt ?? 0) - (b.dueAt ?? 0))
        .slice(0, DUE_SHOWN),
    [cards, milestoneIds],
  )

  if (isPending) return null
  if (!projectId || !project) return <EmptyState title={t('project.notFound')} />

  const awaitingSince = oldest(demands.awaiting)
  const runningSince = oldest(demands.running)
  const reviewCard = demands.review[0]
  const quiet =
    demands.awaiting.length === 0 &&
    demands.running.length === 0 &&
    demands.review.length === 0 &&
    demands.uncommitted === 0

  return (
    /* Pleine largeur, marge de 1 rem : pas de couloir centré. C'est la **grille** qui
       tient la lecture, pas une gouttière — un couloir faisait sauter le bord gauche
       de la rangée d'onglets de plusieurs centimètres entre une vue de lecture et le
       board (décision 3 de l'audit). */
    <div className="h-full overflow-y-auto p-4 md:p-6">
      <div className="flex flex-col gap-5">
        {quiet ? (
          /* Une ligne nue, et non une tuile vide : le silence n'a pas à prendre la
             hauteur de ce qu'il remplace. La maquette ne montrait cette zone qu'avec
             ses trois demandes, et l'encadré pleine largeur donnait à « rien » le même
             poids qu'à « une session attend depuis une heure ». */
          <p className="-mt-1 text-sm text-ink-faint">{t('place.quiet')}</p>
        ) : (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {awaitingSince !== null ? (
              <DemandTile
                to={`/p/${projectId}/c/${demands.awaiting[0]!.conversation.id}`}
                tone="caution"
                icon={<MessageCircleQuestion size={14} />}
                label={t('place.demand.awaiting')}
                count={demands.awaiting.length}
                detail={t('place.demand.since', { age: elapsed(awaitingSince) })}
              />
            ) : null}
            {reviewCard ? (
              <DemandTile
                to={`/p/${projectId}/board?carte=${reviewCard.number}`}
                tone="caution"
                icon={<Pencil size={14} />}
                label={t('place.demand.review')}
                count={demands.review.length}
                detail={t('place.demand.card', { number: reviewCard.number })}
              />
            ) : null}
            {demands.uncommitted > 0 && project.git ? (
              <DemandTile
                to={`/p/${projectId}/board`}
                // Le diff vit dans le panneau du board : la tuile l'y ouvre, sinon
                // elle mènerait aux cartes et non aux fichiers qu'elle compte.
                onClick={() => openPanelOnArrival(`/p/${projectId}/board`, 'git')}
                tone="neutral"
                icon={<GitBranch size={14} />}
                label={t('place.demand.uncommitted')}
                count={demands.uncommitted}
                detail={t('place.demand.onBranch', { branch: project.git.branch })}
              />
            ) : null}
            {runningSince !== null ? (
              <DemandTile
                to={`/p/${projectId}/c/${demands.running[0]!.conversation.id}`}
                tone="accent"
                icon={<span aria-hidden className="block size-1.5 rounded-full bg-accent" />}
                label={t('place.demand.running')}
                count={demands.running.length}
                detail={t('place.demand.since', { age: elapsed(runningSince) })}
              />
            ) : null}
          </div>
        )}

        {/* Le bandeau du jalon lancé (#116), entre les tuiles et « En ce moment » : le
            même que celui de l'Activité. */}
        {(runs ?? []).map((run) => (
          <MilestoneBanner key={run.id} projectId={projectId} run={run} />
        ))}
        <NowBlock projectId={projectId} rows={now} />

        {/* Le **jalon courant** et les **échéances proches**, à la place du résumé du
            board. L'audit du 2026-10-14 écarte explicitement ce résumé — « il redit le
            board au rabais ; avec l'onglet à portée d'œil, il n'a plus d'objet » — et
            c'est devenu vrai le jour où la rangée a mis le board à un clic. Il a tenu
            jusqu'au 2026-10-16 faute de quoi le remplacer : l'échéance et le jalon
            n'existaient pas (carte #32, portée par #36).

            La troisième colonne est le Journal en miniature. La maquette F1 l'intitule
            « Dernières décisions » et ce titre n'est **pas** repris : rien dans la
            matière ne distingue une décision du reste, la carte #32 ayant refusé de
            typer les notes le 2026-10-15. C'est la même raison qui a fait nommer
            *Notes* — et non *Décisions* — la pilule du Journal ; le titre d'ici suit, et
            la colonne porte le nom de l'onglet où elle mène. */}
        <div className="grid items-start gap-3 lg:grid-cols-3">
          <MilestoneTile projectId={projectId} milestone={current} />
          <DueTile projectId={projectId} cards={due} />
          <JournalTile projectId={projectId} />
        </div>

        <section aria-label={t('schedule.title')} className="flex min-w-0 flex-col gap-2">
          <SectionHeading icon={<CalendarClock size={14} />} title={t('schedule.title')}>
            <Button variant="ghost" size="sm" icon={<Plus size={14} />} onClick={() => setCreatingTask(true)}>
              {t('place.schedule.add')}
            </Button>
          </SectionHeading>
          {tasks.length === 0 ? (
            <p className="rounded-xl border border-dashed border-line px-3.5 py-4 text-xs text-ink-faint">
              {t('schedule.empty')}
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {tasks.map((task) => (
                <TaskLine key={task.id} task={task} />
              ))}
            </ul>
          )}
        </section>
      </div>

      {creatingTask ? (
        <Suspense fallback={null}>
          <ScheduleDialog project={project} onClose={() => setCreatingTask(false)} />
        </Suspense>
      ) : null}
    </div>
  )
}

function SectionHeading({
  icon,
  title,
  children,
}: {
  icon: ReactNode
  title: string
  children: ReactNode
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="shrink-0 text-ink-faint">{icon}</span>
      <h3 className="min-w-0 flex-1 truncate text-sm font-medium text-ink-soft">{title}</h3>
      {children}
    </div>
  )
}

/**
 * **En ce moment** : les sessions vivantes en lignes, celles de l'onglet Activité
 * (planche A1 de `docs/audits/2026-10-21-page-projet/final/`).
 *
 * Les tuiles du dessus comptent, cette liste nomme : la redite est voulue, et c'est
 * pourquoi la liste ne remplace pas les tuiles (la variante A2 a été écartée). La ligne
 * est celle de l'Activité, avec ses colonnes, pour qu'une session se reconnaisse d'une
 * vue à l'autre.
 *
 * Aucune session vivante : le bloc n'est pas rendu, comme les tuiles à zéro.
 */
function NowBlock({ projectId, rows }: { projectId: string; rows: ActivityRow[] }) {
  const t = useTranslate()
  if (rows.length === 0) return null

  return (
    <section aria-label={t('project.overview.now')} className="flex min-w-0 flex-col gap-2">
      <SectionHeading icon={<CircleDot size={14} />} title={t('project.overview.now')}>
        <Link
          to={`/p/${projectId}/activity`}
          className="flex items-center gap-1 rounded px-1 text-xs text-ink-faint hover:text-ink"
        >
          {t('project.overview.allActivity')}
          <ArrowUpRight size={13} />
        </Link>
      </SectionHeading>
      <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line">
        {rows.map((row) => (
          <SessionRow
            key={row.entry.conversation.id}
            conversation={row.entry.conversation}
            marker={row.marker}
            summary={row.summary}
            place={row.place}
            pr={row.pr}
          />
        ))}
      </ul>
    </section>
  )
}

/**
 * Le jalon courant : un seul, celui qu'on est en train de livrer.
 *
 * Avec sa barre d'avancement, son compte et un lien vers la chronologie — pas vers le
 * board : c'est la chronologie qui dit ce qu'un jalon recouvre, le board n'en sait rien.
 *
 * À zéro jalon la tuile ne se grise pas, elle **n'est pas rendue** : c'est la règle du
 * gabarit, une tuile à zéro disparaît et le bandeau rétrécit.
 */
function MilestoneTile({ projectId, milestone }: { projectId: string; milestone: Milestone | null }) {
  const t = useTranslate()
  if (!milestone) return null
  const { card, cards, done } = milestone
  const share = cards.length === 0 ? 0 : Math.round((done / cards.length) * 100)

  return (
    <section className="flex min-w-0 flex-col gap-2 rounded-xl border border-line px-3.5 py-3">
      <SectionHeading icon={<Flag size={14} />} title={t('project.overview.milestone')}>
        <Link
          to={`/p/${projectId}/timeline`}
          className="flex items-center gap-1 rounded px-1 text-xs text-ink-faint hover:text-ink"
        >
          {t('project.view.timeline')}
          <ArrowUpRight size={13} />
        </Link>
      </SectionHeading>

      <Link
        to={`/p/${projectId}/board?carte=${card.number}`}
        className="min-w-0 truncate rounded text-base font-medium hover:text-accent focus-visible:outline-2 focus-visible:outline-accent"
      >
        {card.title}
      </Link>

      {/* La barre est en `div` et non en `progress` : l'élément natif porte sa propre
          apparence par plateforme, que le thème ne peut pas suivre. Le compte et la date
          la doublent en texte, qui est ce qu'un lecteur d'écran annoncera. */}
      <div
        role="img"
        aria-label={t('timeline.progress', { done, total: cards.length })}
        className="h-1.5 overflow-hidden rounded-full bg-surface-high"
      >
        <div className="h-full rounded-full bg-accent" style={{ width: `${share}%` }} />
      </div>

      <p className="flex min-w-0 items-center gap-2 text-xs text-ink-faint">
        <span className="tabular-nums">{t('timeline.progress', { done, total: cards.length })}</span>
        <span className="min-w-0 truncate">
          {card.dueAt === null ? t('timeline.noDate') : relativeDate(card.dueAt)}
        </span>
      </p>
    </section>
  )
}

/**
 * Les échéances qui approchent, **les dépassées comprises et en tête**.
 *
 * Une seule ligne est teintée, celle qui est en retard : si tout était coloré, plus rien
 * ne ressortirait, et c'est le retard qu'on cherche en ouvrant cette tuile.
 */
function DueTile({ projectId, cards }: { projectId: string; cards: CardDto[] }) {
  const t = useTranslate()
  if (cards.length === 0) return null

  return (
    <section className="flex min-w-0 flex-col gap-2 rounded-xl border border-line px-3.5 py-3">
      <SectionHeading icon={<AlarmClock size={14} />} title={t('project.overview.due')}>
        <Link
          to={`/p/${projectId}/timeline`}
          className="flex items-center gap-1 rounded px-1 text-xs text-ink-faint hover:text-ink"
        >
          {t('place.seeAll')}
          <ArrowUpRight size={13} />
        </Link>
      </SectionHeading>

      <ul className="flex min-w-0 flex-col">
        {cards.map((card) => {
          const late = card.dueAt !== null && daysUntil(card.dueAt) < 0
          return (
            <li key={card.id}>
              <Link
                to={`/p/${projectId}/board?carte=${card.number}`}
                className={cx(
                  'flex min-h-9 min-w-0 items-center gap-2 rounded-md px-2 text-sm transition-colors',
                  late ? 'bg-critical/10 text-critical' : 'hover:bg-surface-high',
                )}
              >
                {late ? <TriangleAlert size={13} className="shrink-0" /> : null}
                <span className="shrink-0 text-xs tabular-nums opacity-70">#{card.number}</span>
                <span className="min-w-0 flex-1 truncate">{card.title}</span>
                <span className="shrink-0 text-xs opacity-80">
                  {card.dueAt === null ? null : relativeDate(card.dueAt)}
                </span>
              </Link>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/**
 * Une tâche planifiée en une ligne : agent, nom, cadence, prochaine, dernier verdict.
 *
 * `SchedulePage` montre la même chose en carte dépliée, avec le prompt et l'historique.
 * Ici la hauteur est comptée — trois cartes de cette taille chasseraient le board de
 * l'écran — donc on resserre, sans rien retirer de ce qui se lit d'un coup d'œil.
 */
/**
 * Le Journal en miniature : ses dernières lignes, toutes natures mêlées.
 *
 * Elle partage la requête de l'onglet *Journal* — même `useJournal(projectId)`, donc
 * même clé react-query — et ne coûte donc rien de plus à qui ouvre ensuite l'onglet.
 * C'est aussi pourquoi elle ne demande pas une fenêtre plus courte : une seconde fenêtre
 * ferait une seconde requête, et un `git log` par projet se paie à chaque relecture.
 *
 * Les natures ne sont pas filtrées. Montrer les seules notes aurait reconstitué par la
 * bande le tri que la carte #32 a refusé, et une note n'est pas plus une décision qu'une
 * carte fermée ou une branche fusionnée.
 */
function JournalTile({ projectId }: { projectId: string }) {
  const t = useTranslate()
  const { data } = useJournal(projectId)
  const entries = (data?.entries ?? []).slice(0, JOURNAL_SHOWN)
  // Rien à dire plutôt qu'un cadre vide : les deux autres colonnes disparaissent aussi
  // à zéro, et une grille à trois trous décrirait un projet neuf comme une panne.
  if (entries.length === 0) return null

  return (
    <section className="flex min-w-0 flex-col gap-2 rounded-xl border border-line px-3.5 py-3">
      <SectionHeading icon={<History size={14} />} title={t('project.view.journal')}>
        <Link
          to={`/p/${projectId}/journal`}
          className="flex items-center gap-1 rounded px-1 text-xs text-ink-faint hover:text-ink"
        >
          {t('place.seeAll')}
          <ArrowUpRight size={13} />
        </Link>
      </SectionHeading>

      <ul className="flex min-w-0 flex-col">
        {entries.map((entry) => {
          const to = journalDestination(entry)
          const body = (
            <>
              <span aria-hidden className={cx('shrink-0', journalIconTone(entry))}>
                {JOURNAL_KIND_ICONS[entry.kind]}
              </span>
              {/* Le libellé de nature, en petites capitales comme au Journal : c'est lui
                  qui dit « NOTE » là où la maquette promettait « DÉCISION ». */}
              <span className="shrink-0 text-meta font-medium tracking-wide text-ink-faint uppercase">
                {t(JOURNAL_KIND_LABELS[entry.kind])}
              </span>
              <span className="min-w-0 flex-1 truncate">{entry.title}</span>
              {/* L'âge abrégé, et non l'heure : sans en-tête de journée au-dessus,
                  « 14:32 » ne dit pas de quel jour il parle. Et non `relativeDate` non
                  plus — « il y a 18 secondes » mange la moitié d'une colonne sur trois,
                  là où la tuile d'à côté a toute la largeur pour « dans 9 jours ».
                  C'est l'abréviation du bandeau juste au-dessus. */}
              <span className="shrink-0 text-xs tabular-nums text-ink-faint">{elapsed(entry.at)}</span>
            </>
          )
          const shape = 'flex min-h-9 min-w-0 items-center gap-2 rounded-md px-2 text-sm'
          return (
            <li key={entry.id}>
              {to ? (
                <Link to={to} className={cx(shape, 'transition-colors hover:bg-surface-high')}>
                  {body}
                </Link>
              ) : (
                /* Une fusion faite au terminal, un audit versé sur le disque : Solera n'a
                   pas de page pour eux, et une ligne morte qui a l'air cliquable est pire
                   qu'une ligne qui ne l'a pas. Même règle qu'au Journal. */
                <div className={shape}>{body}</div>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function TaskLine({ task }: { task: ScheduledTaskDto }) {
  const t = useTranslate()
  const run = lastRun(task)
  return (
    <li>
      <Link
        to={`/p/${task.projectId}/schedules`}
        className={cx(
          'flex min-h-11 min-w-0 items-center gap-2.5 rounded-xl border border-line px-3 py-2',
          'transition-colors hover:border-line-strong focus-visible:outline-2 focus-visible:outline-accent',
        )}
      >
        <AgentIcon agent={task.agent} size={14} />
        <span className="min-w-0 flex-1 truncate text-sm">{task.name}</span>
        <span className="hidden min-w-0 truncate text-xs text-ink-faint sm:block">
          {describeCadence(task.cadence, (expression) => cronToHuman(expression, locale()))}
        </span>
        <span className="shrink-0 text-xs tabular-nums text-ink-faint">
          {task.nextRunAt ? formatDateTime(task.nextRunAt) : t('schedule.fact.none')}
        </span>
        {run ? <Badge tone={RUN_TONES[run.status]}>{t(RUN_LABELS[run.status])}</Badge> : null}
      </Link>
    </li>
  )
}
