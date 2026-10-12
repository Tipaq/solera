import * as Dialog from '@radix-ui/react-dialog'
import { FilePlus2, FileText, FolderPlus, Search, SquareLibrary } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { ConversationDto, ProjectDto } from '@solera/protocol'
import { MenuItem, MenuSeparator, MenuSub, cx } from '@solera/ui'
import { ProjectAvatar } from './ProjectAvatar'
import { conversationPath } from '../lib/conversation-route'
import { useMoveConversation } from '../lib/conversations'
import { useTranslate } from '../lib/i18n'
import { useProjects } from '../lib/projects'

/** Au-delà, la liste cesse d'être « les récents » et redevient une liste de projets. */
const RECENT_LIMIT = 5

/**
 * *Ranger…* — où va cette conversation, décidé après coup.
 *
 * Le rangement est un geste **séparé et tardif**, et c'est tout le propos : on ouvre un
 * fil parce qu'on a une question, savoir de quel projet elle relève vient ensuite,
 * parfois jamais. **Ne rien faire reste une réponse valable** — il n'y a donc ici ni
 * rappel, ni badge, ni projet proposé d'office.
 *
 * Quatre destinations. *En faire un projet* demande un répertoire de travail, ce qui est
 * exactement ce qui manquait au fil, et passe donc par la page de création. *Garder en
 * note* attend le vault (carte #15) : l'entrée est là, désactivée, plutôt qu'absente —
 * elle dit ce que le geste comportera, sans faire semblant de le faire.
 *
 * Rendu comme un sous-menu à insérer dans le `⋯` d'un fil, et non comme un menu à lui :
 * c'est la ligne de la conversation qui porte ses actions, ici comme ailleurs.
 */
export function ArrangeConversationMenu({ conversation }: { conversation: ConversationDto }) {
  const t = useTranslate()
  const navigate = useNavigate()
  const move = useMoveConversation()
  const { data: projects } = useProjects()
  const [searching, setSearching] = useState(false)

  // Hors de ce fil, et hors des rangés : proposer le projet où l'on est déjà n'offre
  // rien, et un projet archivé n'est pas un endroit où poser du travail en cours.
  const candidates = useMemo(
    () =>
      (projects ?? []).filter(
        (project) => project.archivedAt === null && project.id !== conversation.projectId,
      ),
    [projects, conversation.projectId],
  )

  const toProject = (projectId: string | null) => {
    move.mutate(
      { id: conversation.id, projectId },
      // Le fil change d'adresse : rester sur l'ancienne afficherait une page introuvable
      // à qui vient précisément de le ranger.
      { onSuccess: (moved) => navigate(conversationPath(moved), { replace: true }) },
    )
  }

  return (
    <>
      <MenuSub icon={<SquareLibrary size={14} />} label={t('arrange.label')}>
        {candidates.slice(0, RECENT_LIMIT).map((project) => (
          <MenuItem
            key={project.id}
            icon={<ProjectAvatar project={project} className="size-3.5" />}
            onSelect={() => toProject(project.id)}
          >
            {t('arrange.into', { name: project.name })}
          </MenuItem>
        ))}

        {candidates.length > RECENT_LIMIT ? (
          <MenuItem icon={<Search size={14} />} onSelect={() => setSearching(true)}>
            {t('arrange.search')}
          </MenuItem>
        ) : null}

        {/* Rendre un fil à la boîte de réception : le pendant exact du rangement, et la
            seule façon de revenir sur un geste qui emporte worktree, carte et session. */}
        {conversation.projectId !== null ? (
          <MenuItem icon={<FilePlus2 size={14} />} onSelect={() => toProject(null)}>
            {t('arrange.none')}
          </MenuItem>
        ) : null}

        <MenuSeparator />

        <MenuItem
          icon={<FolderPlus size={14} />}
          onSelect={() => navigate(`/projects/new?adopt=${conversation.id}`)}
        >
          {t('arrange.newProject')}
        </MenuItem>
        {/* Désactivée tant que le vault n'existe pas : annoncer une destination qui ne
            range rien serait pire que de la montrer hors d'atteinte. */}
        <MenuItem icon={<FileText size={14} />} disabled onSelect={() => {}}>
          {t('arrange.vault')}
        </MenuItem>
      </MenuSub>

      <ProjectSearchDialog
        open={searching}
        onOpenChange={setSearching}
        projects={candidates}
        onPick={(projectId) => {
          setSearching(false)
          toProject(projectId)
        }}
      />
    </>
  )
}

/**
 * Chercher un projet quand les récents ne suffisent pas.
 *
 * Un champ et une liste, rien d'autre : ce n'est pas la palette, qui cherche partout,
 * mais la suite d'un geste déjà engagé — on sait ce qu'on range, il ne reste qu'à dire où.
 */
function ProjectSearchDialog({
  open,
  onOpenChange,
  projects,
  onPick,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  projects: ProjectDto[]
  onPick: (projectId: string) => void
}) {
  const t = useTranslate()
  const [query, setQuery] = useState('')
  const needle = query.trim().toLocaleLowerCase()
  const matches = needle
    ? projects.filter((project) => project.name.toLocaleLowerCase().includes(needle))
    : projects

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) setQuery('')
        onOpenChange(next)
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="scrim z-40" />
        <Dialog.Content
          className={cx(
            'surface fixed z-50 flex flex-col overflow-hidden border-line shadow-pop',
            'inset-0 border-0',
            'sm:inset-auto sm:top-24 sm:left-1/2 sm:max-h-[70dvh] sm:w-[min(28rem,92vw)]',
            'sm:-translate-x-1/2 sm:rounded-xl sm:border',
          )}
        >
          <Dialog.Title className="border-b border-line px-4 py-3 text-sm font-medium pt-safe">
            {t('arrange.search.title')}
          </Dialog.Title>

          <div className="flex shrink-0 items-center gap-2 border-b border-line px-3">
            <Search size={16} className="shrink-0 text-ink-faint" />
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('arrange.search.placeholder')}
              className="min-w-0 flex-1 bg-transparent py-3 text-sm outline-none placeholder:text-ink-faint"
            />
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-1 pb-safe">
            {matches.map((project) => (
              <button
                key={project.id}
                type="button"
                onClick={() => onPick(project.id)}
                className="flex min-h-11 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-sm text-ink-soft hover:bg-surface-high hover:text-ink"
              >
                <ProjectAvatar project={project} className="size-4" />
                <span className="min-w-0 truncate">{project.name}</span>
              </button>
            ))}
            {matches.length === 0 ? (
              <p className="px-2.5 py-6 text-center text-sm text-ink-faint">
                {t('arrange.search.empty')}
              </p>
            ) : null}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
