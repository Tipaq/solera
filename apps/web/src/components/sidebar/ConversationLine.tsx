import { Archive, ArchiveRestore, MoreHorizontal, Pencil, Pin, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import type { ConversationDto } from '@solera/protocol'
import { ArrangeConversationMenu } from '../ArrangeConversation'
import {
  useArchiveConversation,
  useDeleteConversation,
  usePinConversation,
  useRenameConversation,
} from '../../lib/conversations'
import { useLiveBackground, useLiveLoops, useLiveSeq, useLiveStatus } from '../../lib/conversation-status'
import { conversationPath, useOpenConversationId } from '../../lib/conversation-route'
import { useDisplaySettings } from '../../lib/display-settings'
import { useTranslate } from '../../lib/i18n'
import { projectViewPath, useProjectView } from '../../lib/project-view'
import { isUnreadSettled } from '../../lib/reads'
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
}: {
  conversation: ConversationDto
  /** Montré en puce quand la ligne vit hors de son projet — dans le lieu *Fils*. */
  project?: Parameters<typeof ProjectAvatar>[0]['project']
  onNavigate: () => void
}) {
  const t = useTranslate()
  const display = useDisplaySettings()
  const rename = useRenameConversation()
  const remove = useDeleteConversation()
  const setArchived = useArchiveConversation()
  const setPinned = usePinConversation()
  const isArchived = conversation.archivedAt !== null
  const navigate = useNavigate()
  const openId = useOpenConversationId()
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
  const commit = (draft: string) => {
    setEditing(false)
    const value = draft.trim()
    if (value && value !== conversation.title) {
      rename.mutate({ id: conversation.id, title: value })
    }
  }

  if (editing) {
    return (
      <li>
        <RenameInput
          value={conversation.title}
          onCommit={commit}
          onCancel={() => setEditing(false)}
          className="h-8 w-full rounded-md border border-accent bg-sunken px-2 text-sm text-ink outline-none"
        />
      </li>
    )
  }

  const isActive = openId === conversation.id
  const unread = !isActive && isUnreadSettled(conversation, pushedSeq, status === 'running' || background > 0)

  return (
    <li
      className={cx(
        'group/row flex h-11 items-center rounded-md pr-0.5 transition-colors md:h-8 pointer-coarse:h-11',
        isActive ? 'bg-accent-wash' : 'hover:bg-surface-high hover:text-ink',
        isActive || unread ? 'text-ink' : 'text-ink-soft',
      )}
    >
      <NavLink
        to={conversationPath(conversation)}
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
      </NavLink>

      {/* L'épingle a son propre emplacement, à gauche du menu : marque quand elle est
          posée, bouton dès qu'on survole la ligne. Même case pour les deux, parce que
          c'est la même chose — voir qu'un fil est épinglé et le dépingler ne demandent
          pas deux endroits, et épingler ne vaut pas d'ouvrir un menu.

          Hors du groupe des points d'état : ceux-là disent le moment et changent sous
          les yeux, l'épingle est une propriété qui ne bouge que si on la retire. Les
          mêler faisait disparaître la seconde dès que le premier avait quelque chose à
          dire — c'est-à-dire sur les fils qu'on suit, ceux qu'on épingle. */}
      {conversation.isOwner || conversation.pinned ? (
        <span className="flex size-11 shrink-0 items-center justify-center md:size-7 pointer-coarse:size-11">
          <IconButton
            label={t(conversation.pinned ? 'shell.conversation.unpin' : 'shell.conversation.pin')}
            size="sm"
            disabled={!conversation.isOwner}
            onClick={() => setPinned.mutate({ id: conversation.id, pinned: !conversation.pinned })}
            className={cx(
              'transition-opacity',
              conversation.pinned
                ? 'text-ink-soft'
                : 'opacity-0 focus-visible:opacity-100 group-hover/row:opacity-100 pointer-coarse:opacity-100',
            )}
          >
            <Pin size={13} className={cx(conversation.pinned && 'fill-current')} />
          </IconButton>
        </span>
      ) : null}

      {/* Les points et le « ⋯ » partagent un seul emplacement, à l'aplomb du « + » de
          *Sessions* et du chevron du projet : une colonne d'icônes et non trois
          alignements voisins. Au survol les points s'effacent et le menu prend leur
          place — le même échange que le compteur d'un lieu et sa flèche. La boîte a la
          taille du bouton pour que le remplacement ne décale rien.

          Opacité et non `hidden` : l'état reste annoncé aux lecteurs d'écran pendant
          que la souris passe, et `pointer-events-none` laisse le clic au bouton. */}
      <span className="relative flex size-11 shrink-0 items-center justify-center md:size-7 pointer-coarse:size-11">
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center gap-1 transition-opacity group-hover/row:opacity-0 group-focus-within/row:opacity-0">
          {/* Deux points au plus : l'état présent, et la boucle. */}
          {present ? <SignalDot signal={present} /> : null}
          {loop ? <SignalDot signal={loop} /> : null}
          {!present && unread ? <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-ink" /> : null}
        </span>

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
          {/* Carte #14 : le rangement vit ici, entre renommer et archiver, parce que
              c'est le même registre — ce qu'on fait d'un fil sans y entrer. Un tir de
              tâche planifiée reste où sa tâche l'a mis. */}
          {conversation.isOwner && conversation.scheduleId === null ? (
            <ArrangeConversationMenu conversation={conversation} />
          ) : null}
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
              const wasOpen = openId === conversation.id
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
      </span>
    </li>
  )
}
