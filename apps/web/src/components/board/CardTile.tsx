import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GitBranch, GripVertical, Link2, MessageSquare, Paperclip } from 'lucide-react'
import type { CardDto, ProjectDto } from '@solera/protocol'
import { useTranslate } from '../../lib/i18n'
import { AgentIcon } from '../AgentIcon'
import { ProjectAvatar } from '../ProjectAvatar'
import { cx } from '@solera/ui'

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
  onOpen?: () => void
}

/**
 * Une carte du board.
 *
 * Le corps est un bouton et le glissement a sa poignée, plutôt qu'une tuile qui serait
 * les deux à la fois. Au pointeur, un seuil de déplacement suffirait à distinguer le
 * clic du geste ; au clavier non, la barre d'espace servant aux deux, et une carte
 * qu'on ne peut plus ouvrir sans souris est un recul que l'ergonomie du glissement ne
 * rachète pas.
 */
export function CardTile({ card, project, selected = false, overlay = false, disabled = false, onOpen }: CardTileProps) {
  const t = useTranslate()
  const { setNodeRef, setActivatorNodeRef, attributes, listeners, transform, transition, isDragging } =
    useSortable({ id: card.id, disabled: overlay || disabled })

  const excerpt = card.description.trim().replace(/\s+/g, ' ')
  const sessions = card.conversations.length
  const links = card.references.length + card.referencedBy.length
  // Le worktree de la dernière session dit dans quelle branche le chantier vit, ce qui
  // est le repère qu'on cherche avant d'en ouvrir une de plus.
  const branch = card.conversations.findLast((session) => session.worktreeName)?.worktreeName
  const agents = [...new Set(card.conversations.map((session) => session.agent))]

  const body = (
    <>
      <div className="flex items-baseline gap-1.5 pr-9 md:pr-5">
        {project ? <ProjectAvatar project={project} className="size-3 shrink-0 self-center" /> : null}
        <span className="shrink-0 text-meta font-medium text-ink-faint">#{card.number}</span>
        <p className="min-w-0 flex-1 text-sm font-semibold leading-relaxed text-ink">{card.title}</p>
      </div>

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

      {sessions > 0 || links > 0 || branch || card.attachmentCount > 0 ? (
        <div className="mt-3 flex flex-wrap border-t border-line/60 pt-2.5 items-center gap-x-2.5 gap-y-1 text-meta text-ink-faint">
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

      {!disabled ? <button
        type="button"
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
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
