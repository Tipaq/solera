import {
  ArrowUpRight,
  CalendarClock,
  GitBranch,
  MessageCircleQuestion,
  Pencil,
  Plus,
  SquareKanban,
} from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { CARD_COLUMNS, type CardColumn, type CardDto, type ScheduledTaskDto } from '@solera/protocol'
import { AgentIcon } from '../components/AgentIcon'
import { CardTile } from '../components/board/CardTile'
import { COLUMN_DOTS, columnLabel } from '../components/board/columns'
import { NewCardDialog } from '../components/board/NewCardDialog'
import { DemandTile } from '../components/places/DemandTile'
import { ScheduleDialog } from '../components/schedule/ScheduleDialog'
import { Badge, Button, EmptyState, IconButton, cx } from '@solera/ui'
import { demandsOf, oldest, useLiveConversations } from '../lib/activity'
import { useCards } from '../lib/cards'
import { useAllConversations } from '../lib/conversations'
import { cronToHuman } from '../lib/cron'
import { elapsed } from '../lib/dates'
import { locale, useTranslate } from '../lib/i18n'
import { openPanelOnArrival } from '../lib/panel'
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
 * Colonnes du résumé : les ouvertes et « Fait ». L'abandon est un classement, pas un
 * état d'avancement — il a sa place sur le board plein, pas sur quatre colonnes qui
 * doivent dire où en est le chantier.
 */
const SUMMARY_COLUMNS = CARD_COLUMNS.filter((column) => column !== 'abandoned')

/** Cartes montrées par colonne : au-delà, le résumé redevient le board. */
const TILES_PER_COLUMN = 3

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
  const navigate = useNavigate()
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

  const [creatingCard, setCreatingCard] = useState<CardColumn | null>(null)
  const [creatingTask, setCreatingTask] = useState(false)

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

        <section aria-label={t('project.board.title')} className="flex min-w-0 flex-col gap-2">
          <SectionHeading icon={<SquareKanban size={14} />} title={t('project.board.title')}>
            <Link
              to={`/p/${projectId}/board`}
              className="flex items-center gap-1 rounded px-1 text-xs text-ink-faint hover:text-ink"
            >
              {t('place.seeAll')}
              <ArrowUpRight size={13} />
            </Link>
          </SectionHeading>
          {/* Défilement horizontal au doigt, quatre colonnes au large : une colonne
              et demie visible dit qu'il y en a d'autres, sans légende. */}
          <div className="flex gap-3 overflow-x-auto pb-1">
            {SUMMARY_COLUMNS.map((column) => (
              <SummaryColumn
                key={column}
                column={column}
                projectId={projectId}
                cards={(cards ?? [])
                  .filter((card) => card.column === column)
                  .sort((a, b) => a.position - b.position)}
                onAdd={() => setCreatingCard(column)}
              />
            ))}
          </div>
        </section>

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

      <NewCardDialog
        projectId={projectId}
        column={creatingCard ?? 'todo'}
        open={creatingCard !== null}
        onClose={() => setCreatingCard(null)}
        onCreated={(card) => {
          setCreatingCard(null)
          navigate(`/p/${projectId}/board?carte=${card.number}`)
        }}
      />
      {creatingTask ? <ScheduleDialog project={project} onClose={() => setCreatingTask(false)} /> : null}
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
 * Une colonne du board, en résumé.
 *
 * Le fond creusé, la pastille de teinte et le compte en pilule sont ceux de
 * `BoardPage`, et les tuiles sont les `CardTile` de l'application : seule la densité
 * change. Un board qui se redessine ici finirait par mentir sur celui qu'on ouvre.
 *
 * Pas de glissement, en revanche : réordonner se fait sur le board plein, où l'on voit
 * les colonnes entières. Les tuiles sont donc rendues `disabled`, ce qui leur retire
 * leur poignée.
 */
function SummaryColumn({
  column,
  cards,
  projectId,
  onAdd,
}: {
  column: CardColumn
  cards: CardDto[]
  projectId: string
  onAdd: () => void
}) {
  const t = useTranslate()
  const navigate = useNavigate()
  const hidden = cards.length - TILES_PER_COLUMN

  return (
    <section
      className="flex w-60 shrink-0 flex-col rounded-xl border border-line/60 bg-sunken/60 md:w-auto md:flex-1"
      aria-label={columnLabel(column)}
    >
      <header className="flex shrink-0 items-center gap-2 px-3 pt-2.5 pb-2">
        <span className={cx('size-2 shrink-0 rounded-full', COLUMN_DOTS[column])} />
        <h4 className="min-w-0 flex-1 truncate text-xs font-semibold text-ink-soft">{columnLabel(column)}</h4>
        <span className="rounded-md bg-surface-high px-1.5 py-0.5 text-meta text-ink-faint">{cards.length}</span>
        <IconButton label={t('board.card.new')} size="sm" onClick={onAdd}>
          <Plus size={13} />
        </IconButton>
      </header>
      {/* Une hauteur minimale : à zéro carte, les quatre colonnes se réduisaient à
          leurs en-têtes et le board n'avait plus l'air d'un board. C'est aussi la
          cible où l'on déposera une carte quand le glissement arrivera ici. */}
      <div className="flex min-h-36 flex-col gap-1.5 px-2 pb-2">
        {cards.slice(0, TILES_PER_COLUMN).map((card) => (
          <CardTile
            key={card.id}
            card={card}
            disabled
            onOpen={() => navigate(`/p/${projectId}/board?carte=${card.number}`)}
          />
        ))}
        {hidden > 0 ? (
          <Link
            to={`/p/${projectId}/board`}
            className="rounded-md px-2 py-1.5 text-meta text-ink-faint hover:text-ink"
          >
            {t('place.board.more', { count: hidden })}
          </Link>
        ) : null}
      </div>
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
