import * as Dialog from '@radix-ui/react-dialog'
import { FilePlus2, FileText, FolderPlus, Search, SquareLibrary } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import type { ConversationDto, ProjectDto } from '@solera/protocol'
import { Button, MenuItem, MenuSeparator, MenuSub, cx, useUiLabels } from '@solera/ui'
import { AGENT_LABELS } from './AgentIcon'
import { ProjectAvatar } from './ProjectAvatar'
import { ApiRequestError } from '../lib/api'
import { conversationPath } from '../lib/conversation-route'
import { interruptConversation, useMoveConversation } from '../lib/conversations'
import { useTranslate } from '../lib/i18n'
import { useProjects } from '../lib/projects'
import { notePath, useKeepConversationAsNote, useVaultState } from '../lib/vault'

/** Au-delà, la liste cesse d'être « les récents » et redevient une liste de projets. */
const RECENT_LIMIT = 5

/** Le temps laissé à un tour interrompu pour se terminer avant de renoncer. */
const STOP_TIMEOUT_MS = 15_000
const STOP_POLL_MS = 400

/** Pourquoi le rangement n'a pas eu lieu, tel que le dialogue le dit. */
export type ArrangeRefusal =
  | { kind: 'busy'; projectId: string | null }
  | { kind: 'stuck'; projectId: string | null }
  | { kind: 'other'; message: string }

const isBusy = (err: unknown) => err instanceof ApiRequestError && err.code === 'conversation_busy'

/**
 * Le geste de rangement d'un fil, et les dialogues qui le suivent.
 *
 * Tenu hors du menu `⋯`, qui démonte son contenu en se refermant : un refus arrivé
 * après la fermeture n'aurait plus personne pour s'afficher, et c'est ainsi qu'un clic
 * pendant un tour ne faisait rien (carte #118). L'appelant rend `dialogs` à côté de
 * son menu, pas dedans.
 *
 * Pendant un tour, le serveur refuse : le CLI tourne dans le dossier que le rangement
 * changerait. Le refus le dit et propose d'arrêter le tour. Pas de rangement différé
 * qui s'appliquerait tout seul à la fin du tour : une action qui se fait au bout d'un
 * temps indéfini se lit mal. Arrêter puis ranger est un geste immédiat, qui attend
 * seulement que le tour interrompu se termine.
 */
export function useArrangeConversation(conversation: ConversationDto) {
  const t = useTranslate()
  const navigate = useNavigate()
  const move = useMoveConversation()
  const keep = useKeepConversationAsNote()
  const { data: vault } = useVaultState()
  const candidates = useCandidates(conversation)
  const [refusal, setRefusal] = useState<ArrangeRefusal | null>(null)
  const [stopping, setStopping] = useState(false)
  const [searching, setSearching] = useState(false)
  const [arranging, setArranging] = useState(false)

  // Le fil change d'adresse : rester sur l'ancienne afficherait une page introuvable à
  // qui vient précisément de le ranger.
  const arrived = (moved: ConversationDto) => {
    setRefusal(null)
    navigate(conversationPath(moved), { replace: true })
  }

  const toProject = (projectId: string | null) => {
    move.mutate(
      { id: conversation.id, projectId },
      {
        onSuccess: arrived,
        onError: (err) =>
          setRefusal(isBusy(err) ? { kind: 'busy', projectId } : { kind: 'other', message: err.message }),
      },
    )
  }

  const stopAndMove = async (projectId: string | null) => {
    setStopping(true)
    try {
      await interruptConversation(conversation.id)
      const deadline = Date.now() + STOP_TIMEOUT_MS
      for (;;) {
        try {
          arrived(await move.mutateAsync({ id: conversation.id, projectId }))
          return
        } catch (err) {
          if (!isBusy(err)) {
            setRefusal({ kind: 'other', message: err instanceof Error ? err.message : String(err) })
            return
          }
          if (Date.now() > deadline) {
            setRefusal({ kind: 'stuck', projectId })
            return
          }
          await new Promise((resolve) => setTimeout(resolve, STOP_POLL_MS))
        }
      }
    } catch (err) {
      setRefusal({ kind: 'other', message: err instanceof Error ? err.message : String(err) })
    } finally {
      setStopping(false)
    }
  }

  const keepAsNote = () => {
    keep.mutate(
      {
        conversationId: conversation.id,
        roles: { user: t('arrange.note.user'), assistant: AGENT_LABELS[conversation.agent] },
      },
      {
        onSuccess: (note) => navigate(notePath(note)),
        onError: (err) => setRefusal({ kind: 'other', message: err.message }),
      },
    )
  }

  return {
    toProject,
    keepAsNote,
    canKeepAsNote: vault?.configured === true && !keep.isPending,
    openSearch: () => setSearching(true),
    /** La modale du fil libre, ouverte depuis l'en-tête de la conversation. */
    openFreeThread: () => setArranging(true),
    pending: move.isPending || keep.isPending,
    dialogs: (
      <>
        <ProjectSearchDialog
          conversation={conversation}
          open={searching}
          onOpenChange={setSearching}
          onPick={(projectId) => {
            setSearching(false)
            toProject(projectId)
          }}
        />
        <ArrangeFreeThreadDialog
          projects={candidates}
          open={arranging}
          onOpenChange={setArranging}
          canKeepAsNote={vault?.configured === true && !keep.isPending}
          onPick={(projectId) => {
            setArranging(false)
            toProject(projectId)
          }}
          onKeepAsNote={() => {
            setArranging(false)
            keepAsNote()
          }}
          onNewProject={() => {
            setArranging(false)
            navigate(`/projects/new?adopt=${conversation.id}`)
          }}
        />
        <ArrangeRefusalDialog
          refusal={refusal}
          stopping={stopping}
          onClose={() => setRefusal(null)}
          onStopAndMove={(projectId) => void stopAndMove(projectId)}
        />
      </>
    ),
  }
}

export type ArrangeConversation = ReturnType<typeof useArrangeConversation>

/** Les projets où ce fil peut aller. */
function useCandidates(conversation: ConversationDto): ProjectDto[] {
  const { data: projects } = useProjects()
  // Hors de ce fil, et hors des rangés : proposer le projet où l'on est déjà n'offre
  // rien, et un projet archivé n'est pas un endroit où poser du travail en cours.
  return useMemo(
    () =>
      (projects ?? []).filter(
        (project) => project.archivedAt === null && project.id !== conversation.projectId,
      ),
    [projects, conversation.projectId],
  )
}

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
 * note* copie le fil en ébauche du Savoir et l'y ouvre ; l'entrée reste visible et
 * désactivée quand aucun vault n'est réglé, pour dire que le geste existe.
 *
 * Rendu comme un sous-menu à insérer dans le `⋯` d'un fil, et non comme un menu à lui :
 * c'est la ligne de la conversation qui porte ses actions, ici comme ailleurs. Le geste
 * et ses dialogues viennent de `useArrangeConversation`, tenu par la ligne.
 */
export function ArrangeConversationMenu({
  conversation,
  arrange,
}: {
  conversation: ConversationDto
  arrange: ArrangeConversation
}) {
  const t = useTranslate()
  const navigate = useNavigate()
  const candidates = useCandidates(conversation)

  return (
    <MenuSub icon={<SquareLibrary size={14} />} label={t('arrange.label')}>
      {candidates.slice(0, RECENT_LIMIT).map((project) => (
        <MenuItem
          key={project.id}
          icon={<ProjectAvatar project={project} className="size-3.5" />}
          onSelect={() => arrange.toProject(project.id)}
        >
          {t('arrange.into', { name: project.name })}
        </MenuItem>
      ))}

      {candidates.length > RECENT_LIMIT ? (
        <MenuItem icon={<Search size={14} />} onSelect={arrange.openSearch}>
          {t('arrange.search')}
        </MenuItem>
      ) : null}

      {/* Rendre un fil à la boîte de réception : le pendant exact du rangement, et la
          seule façon de revenir sur un geste qui emporte worktree et carte. */}
      {conversation.projectId !== null ? (
        <MenuItem icon={<FilePlus2 size={14} />} onSelect={() => arrange.toProject(null)}>
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
      <MenuItem icon={<FileText size={14} />} disabled={!arrange.canKeepAsNote} onSelect={arrange.keepAsNote}>
        {t('arrange.vault')}
      </MenuItem>
    </MenuSub>
  )
}

/**
 * La ligne « Sans projet » de l'en-tête d'un fil libre, qui ouvre sa modale de
 * rangement. Le reste de l'en-tête ne change pas.
 */
export function ArrangeFreeThreadButton({ conversation }: { conversation: ConversationDto }) {
  const t = useTranslate()
  const arrange = useArrangeConversation(conversation)
  return (
    <>
      <button
        type="button"
        onClick={arrange.openFreeThread}
        disabled={arrange.pending}
        title={t('arrange.free.title')}
        className="block w-fit max-w-full truncate rounded-sm text-xs text-ink-faint hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"
      >
        {t('arrange.free.trigger')}
      </button>
      {arrange.dialogs}
    </>
  )
}

/**
 * Le refus d'un rangement, dit en clair.
 *
 * Pendant un tour, il explique pourquoi le fil ne bouge pas et propose d'arrêter le
 * tour pour ranger tout de suite. Un tour qui ne s'arrête pas dans le délai est dit
 * aussi, plutôt que d'attendre sans fin.
 */
export function ArrangeRefusalDialog({
  refusal,
  stopping,
  onClose,
  onStopAndMove,
}: {
  refusal: ArrangeRefusal | null
  stopping: boolean
  onClose: () => void
  onStopAndMove: (projectId: string | null) => void
}) {
  const t = useTranslate()
  const labels = useUiLabels()
  const retryable = refusal && refusal.kind !== 'other' ? refusal : null

  return (
    <Dialog.Root open={refusal !== null} onOpenChange={(open) => !open && !stopping && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="scrim z-40" />
        <Dialog.Content
          className={cx(
            'surface fixed top-1/2 left-1/2 z-50 w-[min(26rem,92vw)] -translate-x-1/2 -translate-y-1/2',
            'flex flex-col gap-3 rounded-lg border border-line p-4 shadow-pop',
          )}
        >
          <Dialog.Title className="text-heading font-semibold tracking-tight">
            {refusal?.kind === 'other' ? t('arrange.refused.title') : t('arrange.busy.title')}
          </Dialog.Title>
          <Dialog.Description className="text-sm text-ink-soft">
            {refusal?.kind === 'busy'
              ? t('arrange.busy.body')
              : refusal?.kind === 'stuck'
                ? t('arrange.busy.stuck')
                : refusal?.message}
          </Dialog.Description>

          <div className="mt-1 flex flex-wrap justify-end gap-2">
            <Dialog.Close asChild>
              <Button variant="ghost" disabled={stopping}>
                {retryable ? labels.cancel : t('arrange.refused.close')}
              </Button>
            </Dialog.Close>
            {retryable ? (
              <Button
                variant="primary"
                disabled={stopping}
                onClick={() => onStopAndMove(retryable.projectId)}
              >
                {stopping ? t('arrange.busy.stopping') : t('arrange.busy.stop')}
              </Button>
            ) : null}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

/**
 * Chercher un projet quand les récents ne suffisent pas.
 *
 * Un champ et une liste, rien d'autre : ce n'est pas la palette, qui cherche partout,
 * mais la suite d'un geste déjà engagé — on sait ce qu'on range, il ne reste qu'à dire où.
 */
function ProjectSearchDialog({
  conversation,
  open,
  onOpenChange,
  onPick,
}: {
  conversation: ConversationDto
  open: boolean
  onOpenChange: (open: boolean) => void
  onPick: (projectId: string) => void
}) {
  const t = useTranslate()
  return (
    <ProjectPickerDialog
      title={t('arrange.search.title')}
      projects={useCandidates(conversation)}
      open={open}
      onOpenChange={onOpenChange}
      onPick={onPick}
    />
  )
}

/**
 * Ranger un fil libre, depuis son en-tête (carte #118).
 *
 * L'en-tête d'un fil rangé garde le nom de son projet en lien : seul le fil libre, qui
 * n'a pas de projet à nommer, ouvre cette modale. Elle reprend la recherche et y ajoute
 * les deux autres destinations : garder le fil en note dans le Savoir, ou en faire un
 * projet.
 */
export function ArrangeFreeThreadDialog({
  projects,
  open,
  onOpenChange,
  canKeepAsNote,
  onPick,
  onKeepAsNote,
  onNewProject,
}: {
  projects: ProjectDto[]
  open: boolean
  onOpenChange: (open: boolean) => void
  canKeepAsNote: boolean
  onPick: (projectId: string) => void
  onKeepAsNote: () => void
  onNewProject: () => void
}) {
  const t = useTranslate()
  return (
    <ProjectPickerDialog
      title={t('arrange.free.title')}
      projects={projects}
      open={open}
      onOpenChange={onOpenChange}
      onPick={onPick}
      footer={
        <>
          <PickerRow icon={<FileText size={16} />} disabled={!canKeepAsNote} onClick={onKeepAsNote}>
            {t('arrange.vault')}
          </PickerRow>
          <PickerRow icon={<FolderPlus size={16} />} onClick={onNewProject}>
            {t('arrange.newProject')}
          </PickerRow>
        </>
      }
    />
  )
}

function PickerRow({
  icon,
  disabled = false,
  onClick,
  children,
}: {
  icon: ReactNode
  disabled?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex min-h-11 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-sm text-ink-soft hover:bg-surface-high hover:text-ink disabled:pointer-events-none disabled:opacity-50"
    >
      <span className="flex size-4 shrink-0 items-center justify-center">{icon}</span>
      <span className="min-w-0 truncate">{children}</span>
    </button>
  )
}

/** Un champ, la liste des projets qui y répondent, et ce que l'appelant ajoute dessous. */
export function ProjectPickerDialog({
  title,
  projects,
  open,
  onOpenChange,
  onPick,
  footer,
}: {
  title: string
  projects: ProjectDto[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onPick: (projectId: string) => void
  footer?: ReactNode
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
          aria-describedby={undefined}
          className={cx(
            'surface fixed z-50 flex flex-col overflow-hidden border-line shadow-pop',
            'inset-0 border-0',
            'sm:inset-auto sm:top-24 sm:left-1/2 sm:max-h-[70dvh] sm:w-[min(28rem,92vw)]',
            'sm:-translate-x-1/2 sm:rounded-xl sm:border',
          )}
        >
          <Dialog.Title className="border-b border-line px-4 py-3 text-sm font-medium pt-safe">
            {title}
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

          <div className={cx('min-h-0 flex-1 overflow-y-auto p-1', !footer && 'pb-safe')}>
            {matches.map((project) => (
              <PickerRow
                key={project.id}
                icon={<ProjectAvatar project={project} className="size-4" />}
                onClick={() => onPick(project.id)}
              >
                {project.name}
              </PickerRow>
            ))}
            {matches.length === 0 ? (
              <p className="px-2.5 py-6 text-center text-sm text-ink-faint">
                {t('arrange.search.empty')}
              </p>
            ) : null}
          </div>

          {footer ? <div className="shrink-0 border-t border-line p-1 pb-safe">{footer}</div> : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
