import { Archive, ArchiveRestore, FolderX, MoreHorizontal, Pencil, Pin, Trash2 } from 'lucide-react'
import { memo, useMemo, useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useGuardedArchive } from '../ArchiveRequestsDialog'
import type { ConversationDto } from '@solera/protocol'
import { ArrangeConversationMenu, useArrangeConversation } from '../ArrangeConversation'
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
import { isUnreadSettled } from '../../lib/reads'
import { buildSidebarSignals, threadState } from '../../lib/signals'
import { AgentIcon } from '../AgentIcon'
import { ProjectAvatar } from '../ProjectAvatar'
import { SignalDot, StateDot } from '../chat/Signals'
import { RenameInput } from './RenameInput'
import { openRowMenu } from './row-menu'
import { cx, IconButton, Menu, MenuItem, MenuSeparator } from '@solera/ui'

/**
 * Un fil en une ligne, 32 px : agent, titre tronqué, puce du projet, signaux.
 *
 * Elle en prenait deux — titre replié et relevé de volume dessous. Le relevé passe au
 * réglage *Affichage*, et le titre se tronque : la colonne liste, elle ne détaille pas.
 *
 * Plus de signet : la section *Signets* a disparu de la colonne, et avec elle le bouton
 * et l'entrée de menu qui la remplissaient.
 *
 * Mémoïsée : la liste est réécrite à chaque curseur de lecture, et seule la ligne dont
 * l'objet a changé doit rendre. Le reste de son état vient de ses propres abonnements
 * (statut vivant, route ouverte, réglages), qui la rendent d'eux-mêmes.
 */
export const ConversationLine = memo(function ConversationLine({
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
  // Archiver retire les demandes en attente du fil : une fenêtre le dit d'abord (#119).
  const guarded = useGuardedArchive()
  const setPinned = usePinConversation()
  const isArchived = conversation.archivedAt !== null
  const navigate = useNavigate()
  const openId = useOpenConversationId()
  const [editing, setEditing] = useState(false)
  // Tenu ici et non dans le menu, qui démonte son contenu en se refermant.
  const arrange = useArrangeConversation(conversation)
  // Le statut du socket prime sur celui de la liste, qui date de son chargement.
  const status = useLiveStatus(conversation.id) ?? conversation.status
  const background = useLiveBackground(conversation.id)
  const loops = useLiveLoops(conversation.id)
  const pushedSeq = useLiveSeq(conversation.id)
  const signals = useMemo(
    () => buildSidebarSignals({ status, background, loops }),
    [status, background, loops],
  )
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
  const state = threadState({ status, busy: background > 0, unread })

  return (
    <li
      onContextMenu={openRowMenu}
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
        /* Un pas sous le projet : l'arbre doit se lire comme un arbre, et deux lignes de
           même taille ne disent pas laquelle porte l'autre. `text-xs` et non les 13 px
           de la maquette — l'échelle de texte est fermée à six pas dans `tokens.ts`, et
           13 px n'en est pas un. */
        className="flex h-full min-w-0 flex-1 items-center gap-2 px-2 text-xs"
      >
        <span className="shrink-0 text-ink-faint"><AgentIcon agent={conversation.agent} size={14} /></span>
        <span className={cx('min-w-0 flex-1 truncate', unread && 'font-medium')}>{conversation.title}</span>
        {/* Une propriété durable du fil, pas un moment : avec le titre plutôt que parmi
            les points d'état, qui s'effacent au survol. */}
        {conversation.worktreeGone ? (
          <span
            role="img"
            className="shrink-0 text-caution"
            title={t('conversation.worktreeGone.marker')}
            aria-label={t('conversation.worktreeGone.marker')}
            data-worktree-gone-marker
          >
            <FolderX size={12} />
          </span>
        ) : null}
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
          {/* Deux points au plus : l'état, selon la charte de la colonne, et la boucle. */}
          {state ? <StateDot state={state} /> : null}
          {loop ? <SignalDot signal={loop} /> : null}
        </span>

        <Menu
          trigger={
            <IconButton
              label={t('shell.conversation.actions')}
              size="sm"
              data-row-menu
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
            <ArrangeConversationMenu conversation={conversation} arrange={arrange} />
          ) : null}
          <MenuItem
            icon={isArchived ? <ArchiveRestore size={14} /> : <Archive size={14} />}
            disabled={!conversation.isOwner}
            onSelect={() =>
              isArchived ? setArchived.mutate({ id: conversation.id, archived: false }) : guarded.archive([conversation.id])
            }
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
                  // Supprimer le fil ouvert renvoie à la porte de son projet, ou au
                  // brouillon libre quand il n'en avait pas.
                  if (wasOpen) {
                    navigate(conversation.projectId ? `/p/${conversation.projectId}` : '/c/new')
                  }
                },
              })
            }}
          >
            {t('shell.delete')}
          </MenuItem>
        </Menu>
      </span>
      {arrange.dialogs}
      {guarded.dialog}
    </li>
  )
})
