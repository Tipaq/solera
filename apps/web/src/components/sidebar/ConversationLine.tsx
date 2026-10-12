import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Archive, ArchiveRestore, MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { NavLink, useMatch, useNavigate } from 'react-router-dom'
import type { ConversationDto } from '@solera/protocol'
import {
  useArchiveConversation,
  useDeleteConversation,
  useRenameConversation,
} from '../../lib/conversations'
import { useLiveBackground, useLiveLoops, useLiveSeq, useLiveStatus } from '../../lib/conversation-status'
import { useDisplaySettings } from '../../lib/display-settings'
import { useTranslate } from '../../lib/i18n'
import { projectViewPath, useProjectView } from '../../lib/project-view'
import { isUnread } from '../../lib/reads'
import { buildSidebarSignals, presentSignal } from '../../lib/signals'
import { AgentIcon } from '../AgentIcon'
import { ProjectAvatar } from '../ProjectAvatar'
import { SignalDot } from '../chat/Signals'
import { RenameInput } from './RenameInput'
import { cx, IconButton, Menu, MenuItem, MenuSeparator } from '@solera/ui'

/**
 * Un fil en une ligne, 32 px : agent, titre tronqué, puce du projet, signaux.
 *
 * Elle en prenait deux — titre replié et relevé de volume dessous. Le relevé passe au
 * réglage *Affichage*, et le titre se tronque : la colonne liste, elle ne détaille pas.
 *
 * Plus de signet : la section *Signets* a disparu de la colonne, et avec elle le bouton
 * et l'entrée de menu qui la remplissaient.
 */
export function ConversationLine({
  conversation,
  project,
  onNavigate,
  draggable = true,
}: {
  conversation: ConversationDto
  /** Montré en puce quand la ligne vit hors de son projet — dans le lieu *Fils*. */
  project?: Parameters<typeof ProjectAvatar>[0]['project']
  onNavigate: () => void
  draggable?: boolean
}) {
  const t = useTranslate()
  const display = useDisplaySettings()
  const rename = useRenameConversation()
  const remove = useDeleteConversation()
  const setArchived = useArchiveConversation()
  const isArchived = conversation.archivedAt !== null
  const navigate = useNavigate()
  const openMatch = useMatch('/p/:projectId/c/:conversationId')
  const projectView = useProjectView(conversation.projectId)
  const [editing, setEditing] = useState(false)
  // Le statut du socket prime sur celui de la liste, qui date de son chargement.
  const status = useLiveStatus(conversation.id) ?? conversation.status
  const background = useLiveBackground(conversation.id)
  const loops = useLiveLoops(conversation.id)
  const pushedSeq = useLiveSeq(conversation.id)
  const signals = useMemo(
    () => buildSidebarSignals({ status, background, loops }),
    [status, background, loops],
  )
  const present = presentSignal(signals)
  const loop = signals.find((signal) => signal.kind === 'loop') ?? null
  const sortable = draggable && !isArchived

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: conversation.id,
    disabled: !sortable || editing,
  })

  const commit = (draft: string) => {
    setEditing(false)
    const value = draft.trim()
    if (value && value !== conversation.title) {
      rename.mutate({ id: conversation.id, title: value })
    }
  }

  const style = { transform: CSS.Transform.toString(transform), transition }

  if (editing) {
    return (
      <li ref={setNodeRef} style={style}>
        <RenameInput
          value={conversation.title}
          onCommit={commit}
          onCancel={() => setEditing(false)}
          className="h-8 w-full rounded-md border border-accent bg-sunken px-2 text-sm text-ink outline-none"
        />
      </li>
    )
  }

  const isActive = openMatch?.params.conversationId === conversation.id
  const unread = !isActive && isUnread(conversation, pushedSeq)

  return (
    <li
      ref={setNodeRef}
      style={style}
      // Une ligne non déplaçable reste navigable : les attributs du hook désactivé
      // porteraient aria-disabled sur tous ses liens et boutons.
      {...(sortable ? attributes : {})}
      {...(sortable ? listeners : {})}
      className={cx(
        'group/row flex h-11 items-center rounded-md pr-0.5 transition-colors md:h-8 pointer-coarse:h-11',
        isDragging ? 'shadow-float z-10 bg-surface-high opacity-90' : '',
        isActive ? 'bg-accent-wash' : 'hover:bg-surface-high hover:text-ink',
        isActive || unread ? 'text-ink' : 'text-ink-soft',
      )}
    >
      <NavLink
        to={`/p/${conversation.projectId}/c/${conversation.id}`}
        title={conversation.title}
        onClick={onNavigate}
        onDoubleClick={(event) => {
          event.preventDefault()
          if (conversation.isOwner) setEditing(true)
        }}
        className="flex h-full min-w-0 flex-1 items-center gap-2 px-2 text-sm"
      >
        <span className="shrink-0 text-ink-faint"><AgentIcon agent={conversation.agent} size={14} /></span>
        <span className={cx('min-w-0 flex-1 truncate', unread && 'font-medium')}>{conversation.title}</span>
        {project && display.projectDot ? <ProjectAvatar project={project} className="size-3" /> : null}
        {/* Deux points au plus : l'état présent, et la boucle. */}
        {present ? <SignalDot signal={present} /> : null}
        {loop ? <SignalDot signal={loop} /> : null}
        {!present && unread ? <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-ink" /> : null}
      </NavLink>

      <Menu
        trigger={
          <IconButton
            label={t('shell.conversation.actions')}
            size="sm"
            className="opacity-0 focus-visible:opacity-100 group-hover/row:opacity-100 data-[state=open]:opacity-100 pointer-coarse:opacity-100"
          >
            <MoreHorizontal size={14} />
          </IconButton>
        }
      >
        <MenuItem icon={<Pencil size={14} />} disabled={!conversation.isOwner} onSelect={() => setEditing(true)}>
          {t('shell.rename')}
        </MenuItem>
        <MenuItem
          icon={isArchived ? <ArchiveRestore size={14} /> : <Archive size={14} />}
          disabled={!conversation.isOwner}
          onSelect={() => setArchived.mutate({ id: conversation.id, archived: !isArchived })}
        >
          {isArchived ? t('shell.conversation.unarchive') : t('shell.conversation.archive')}
        </MenuItem>
        <MenuSeparator />
        <MenuItem
          icon={<Trash2 size={14} />}
          tone="critical"
          disabled={!conversation.isOwner}
          onSelect={() => {
            if (!confirm(t('shell.conversation.deleteConfirm', { title: conversation.title }))) return
            const wasOpen = openMatch?.params.conversationId === conversation.id
            remove.mutate(conversation.id, {
              // Ne quitter la vue que si c'est bien celle qu'on vient de supprimer.
              onSuccess: () => {
                if (wasOpen) navigate(projectViewPath(conversation.projectId, projectView))
              },
            })
          }}
        >
          {t('shell.delete')}
        </MenuItem>
      </Menu>
    </li>
  )
}
