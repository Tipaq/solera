import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { CalendarDays, CheckSquare, Clock, GitBranch, GripVertical, Link2, ListTree, MessageSquare, Paperclip } from 'lucide-react'
import { parseSubtasks, type CardDto, type ProjectDto } from '@solera/protocol'
import type { KeyboardEventHandler, MouseEventHandler, TouchEventHandler } from 'react'
import { Link } from 'react-router-dom'
import { clarifyingThread } from '../../lib/cards'
import { daysUntil, formatDay, relativeDate, shortAge } from '../../lib/dates'
import { useTranslate } from '../../lib/i18n'
import { AgentIcon } from '../AgentIcon'
import { ProjectAvatar } from '../ProjectAvatar'
import { Badge, cx } from '@solera/ui'

/** Ce qui tient sous le titre sans transformer la tuile en fiche. */
const EXCERPT_MAX = 120

interface CardTileProps {
  card: CardDto
  /**
   * Le projet d'où la carte sort, sur un board qui en mêle plusieurs.
   *
   * Seul ajout du board global : la pastille devant le numéro et le nom sous le titre.
   * La tuile reste celle de l'application — un résumé qui redessine ses propres tuiles
   * finit par mentir sur le board qu'on ouvre en cliquant dessus — et sur un board de
   * projet, où toutes les cartes viennent du même endroit, le nom serait du bruit.
   */
  project?: ProjectDto
  selected?: boolean
  /** Rendu dans le calque de glissement : ni tri, ni clic, seulement l'apparence. */
  disabled?: boolean
  overlay?: boolean
  /** Le board est trié par arrivée : la tuile dit depuis quand elle est dans la colonne. */
  showArrival?: boolean
  onOpen?: () => void
}

/**
 * Une carte du board.
 *
 * Au pointeur, la carte entière se saisit : viser la petite poignée était la gêne, et le
 * seuil de déplacement des capteurs (6 px à la souris, un appui long au doigt) suffit à
 * distinguer le clic du geste. Au clavier non, la barre d'espace servant aux deux : le
 * corps reste un bouton qui ouvre la carte, et seule la poignée prend le glissement au
 * clavier. Une carte qu'on ne pourrait plus ouvrir sans souris serait un recul.
 */
export function CardTile({ card, project, selected = false, overlay = false, disabled = false, showArrival = false, onOpen }: CardTileProps) {
  const t = useTranslate()
  const { setNodeRef, setActivatorNodeRef, attributes, listeners, transform, transition, isDragging } =
    useSortable({ id: card.id, disabled: overlay || disabled })
  // dnd-kit type ses écouteurs en `Function` ; ce sont ceux de ses trois capteurs.
  const gesture = listeners as
    | { onMouseDown?: MouseEventHandler; onTouchStart?: TouchEventHandler; onKeyDown?: KeyboardEventHandler }
    | undefined

  const excerpt = card.description.trim().replace(/\s+/g, ' ')
  const sessions = card.conversations.length
  const links = card.references.length + card.referencedBy.length
  // Le worktree de la dernière session dit dans quelle branche le chantier vit, ce qui
  // est le repère qu'on cherche avant d'en ouvrir une de plus.
  const branch = card.conversations.findLast((session) => session.worktreeName)?.worktreeName
  const agents = [...new Set(card.conversations.map((session) => session.agent))]
  const subtasks = parseSubtasks(card.description)
  const done = subtasks.filter((task) => task.checked).length
  // Une échéance ne colore la tuile que quand il est trop tard ou presque : une date
  // posée pour dans trois semaines est une information, pas une alerte.
  const days = card.dueAt === null ? null : daysUntil(card.dueAt)
  const thread = clarifyingThread(card)

  const body = (
    <>
      <div className="flex items-baseline gap-1.5 pr-9 md:pr-5">
        {project ? <ProjectAvatar project={project} className="size-3 shrink-0 self-center" /> : null}
        <span className="shrink-0 text-meta font-medium text-ink-faint">#{card.number}</span>
        <p className="min-w-0 flex-1 text-sm font-semibold leading-relaxed text-ink">{card.title}</p>
      </div>

      {/* Les deux états de « à faire », qui ne sont pas des colonnes : une carte venue
          de l'extérieur attend qu'on la trie, une carte à préciser attend des réponses. */}
      {card.column === 'todo' && card.acceptedAt === null ? (
        <div className="mt-1.5"><Badge tone="accent">{t('board.card.new.badge')}</Badge></div>
      ) : card.column === 'todo' && card.toClarifySince !== null ? (
        <div className="mt-1.5"><Badge tone="caution">{t('board.card.toClarify')}</Badge></div>
      ) : null}

      {/* Le nom du projet **remplace** l'extrait : sur un board qui en mêle cinq, savoir
          d'où sort la carte prime sur ses deux premières lignes, et empiler les deux
          doublerait la hauteur de chaque tuile. */}
      {project ? (
        <p className="mt-2 truncate text-xs text-ink-faint">{project.name}</p>
      ) : excerpt ? (
        <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-ink-faint">
          {excerpt.length > EXCERPT_MAX ? `${excerpt.slice(0, EXCERPT_MAX)}...` : excerpt}
        </p>
      ) : null}

      {card.dueAt !== null || card.parent || subtasks.length > 0 ? (
        <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-meta text-ink-faint">
          {card.dueAt !== null && days !== null ? (
            <span
              className={cx(
                'inline-flex items-center gap-1',
                days < 0 && 'text-critical',
                days >= 0 && days <= 2 && 'text-caution',
              )}
              title={t('board.card.due')}
            >
              <CalendarDays size={11} />
              {formatDay(card.dueAt)}
            </span>
          ) : null}
          {card.parent ? (
            <span className="inline-flex min-w-0 items-center gap-1" title={card.parent.title}>
              <ListTree size={11} className="shrink-0" />
              <span className="max-w-28 truncate">{card.parent.title}</span>
            </span>
          ) : null}
          {subtasks.length > 0 ? (
            <span className="inline-flex items-center gap-1" title={t('board.card.subtasks')}>
              <CheckSquare size={11} />
              {t('board.card.subtasks.count', { done, total: subtasks.length })}
            </span>
          ) : null}
        </div>
      ) : null}

      {sessions > 0 || links > 0 || branch || card.attachmentCount > 0 || showArrival ? (
        <div className="mt-3 flex flex-wrap border-t border-line/60 pt-2.5 items-center gap-x-2.5 gap-y-1 text-meta text-ink-faint">
          {showArrival ? (
            <span className="inline-flex items-center gap-1" title={t('board.card.arrived', { when: relativeDate(card.columnSince) })}>
              <Clock size={11} />
              {shortAge(card.columnSince)}
            </span>
          ) : null}
          {agents.map((agent) => (
            <AgentIcon key={agent} agent={agent} size={11} />
          ))}
          {sessions > 0 ? (
            <span
              className="inline-flex items-center gap-1"
              title={t('board.card.sessions', { count: sessions })}
            >
              <MessageSquare size={11} />
              {sessions}
            </span>
          ) : null}
          {card.attachmentCount > 0 ? <span className="inline-flex items-center gap-1" title={t('board.files.title')}><Paperclip size={11} />{card.attachmentCount}</span> : null}
          {links > 0 ? (
            <span
              className="inline-flex items-center gap-1"
              title={t('board.card.links', { count: links })}
            >
              <Link2 size={11} />
              {links}
            </span>
          ) : null}
          {branch ? (
            <span className="inline-flex min-w-0 items-center gap-1" title={branch}>
              <GitBranch size={11} className="shrink-0" />
              <span className="max-w-28 truncate font-mono">{branch}</span>
            </span>
          ) : null}
        </div>
      ) : null}
    </>
  )

  const skin = cx(
    'surface relative rounded-xl border shadow-sm',
    selected ? 'border-accent' : 'border-line',
  )

  if (overlay) {
    return <div className={cx(skin, 'shadow-float rotate-2 p-2.5')}>{body}</div>
  }

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      // Souris et doigt seulement : le clavier passe par la poignée, voir plus haut.
      onMouseDown={gesture?.onMouseDown}
      onTouchStart={gesture?.onTouchStart}
      data-card-tile={card.number}
      className={cx(
        skin,
        'group/card transition-colors',
        // Le trou laissé par la carte tenue, le calque en portant l'apparence.
        isDragging ? 'opacity-40' : 'hover:border-line-strong',
      )}
    >
      <button data-card-open={card.id} type="button" onClick={onOpen} className="w-full p-3.5 text-left">
        {body}
      </button>

      {/* Hors du bouton de la carte, un lien ne pouvant pas vivre dans un bouton : une
          carte « à préciser » attend une réponse dans un fil, et y aller est le seul
          geste utile à faire depuis le board (#67). Le pointeur arrêté ici ne saisit pas
          la carte. */}
      {thread ? (
        <Link
          to={`/p/${card.projectId}/c/${thread.id}`}
          data-card-thread={card.number}
          onMouseDown={(event) => event.stopPropagation()}
          onTouchStart={(event) => event.stopPropagation()}
          className="mx-3.5 mb-3 -mt-1.5 inline-flex items-center gap-1 rounded text-meta font-medium text-caution hover:underline"
        >
          <MessageSquare size={11} />
          {t('board.card.toClarify.openThread')}
        </Link>
      ) : null}

      {!disabled ? <button
        type="button"
        ref={setActivatorNodeRef}
        {...attributes}
        onKeyDown={gesture?.onKeyDown}
        aria-label={t('board.card.drag', { number: card.number })}
        className={cx(
          'absolute top-0 right-0 flex size-11 items-center justify-center cursor-grab touch-none rounded text-ink-faint md:top-1.5 md:right-1 md:size-6',
          'opacity-0 transition-opacity group-hover/card:opacity-100 focus-visible:opacity-100',
          // Sans survol au doigt, la poignée doit rester visible ou elle n'existe pas.
          '[@media(hover:none)]:opacity-60',
        )}
      >
        <GripVertical size={14} />
      </button> : null}
    </div>
  )
}
