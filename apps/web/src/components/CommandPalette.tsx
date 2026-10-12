import * as Dialog from '@radix-ui/react-dialog'
import {
  CalendarClock,
  CalendarPlus,
  File,
  FolderOpen,
  Loader,
  MessageSquare,
  Plus,
  Search,
  Settings,
  SquareKanban,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { SEARCH_MIN_QUERY, type ConversationDto } from '@solera/protocol'
import { useCardSearch } from '../lib/cards'
import { conversationPath } from '../lib/conversation-route'
import { useAllConversations } from '../lib/conversations'
import { useTranslate, type MessageKey } from '../lib/i18n'
import { useProjects } from '../lib/projects'
import { scoreMatch, splitExcerpt, useMessageSearch } from '../lib/search'
import { useSchedules } from '../lib/schedules'
import { useCurrentUser } from '../lib/session'
import { openSettings } from '../lib/settings-dialog'
import { useFileSearch } from '../lib/tree'
import { openTab } from '../lib/editor-tabs'
import { setPanelOpen, setPanelTab } from '../lib/panel'
import { projectScope } from '../lib/workspace-scope'
import { visibleSections } from './settings/sections'
import { AgentIcon } from './AgentIcon'
import { IconButton, cx } from '@solera/ui'

/**
 * La palette : chercher, et lancer ce qui ne tient nulle part ailleurs.
 *
 * Elle ne cherchait que les conversations et les messages. C'est ce qui enfermait des
 * fonctions dès qu'on a posé « un domicile par chose » : une carte, une tâche
 * planifiée, un réglage n'étaient atteignables que par le chemin qui y mène. Huit
 * familles désormais, groupées, chacune repliée à trois lignes — une liste à plat de
 * quarante résultats ne se lit pas, et le groupe dit déjà de quelle nature est ce
 * qu'on regarde.
 *
 * C'est aussi le filet du réglage *Affichage* : un lieu décroché de la colonne reste
 * ici, et c'est ce qui autorise à le décrocher.
 *
 * Quatre préfixes vont droit à une famille, et le pied les rappelle — un raccourci
 * qu'on ne lit nulle part n'existe pas.
 */

/** Les notes du vault n'existent pas encore (carte #15) : la famille est prévue, vide. */
type FamilyId =
  | 'resume'
  | 'actions'
  | 'notes'
  | 'conversations'
  | 'messages'
  | 'projects'
  | 'cards'
  | 'schedules'
  | 'settings'
  | 'commands'
  | 'files'

const PREFIXES: { char: string; family: FamilyId; labelKey: MessageKey }[] = [
  { char: '>', family: 'commands', labelKey: 'palette.prefix.commands' },
  { char: '#', family: 'cards', labelKey: 'palette.prefix.cards' },
  { char: '@', family: 'projects', labelKey: 'palette.prefix.projects' },
  { char: '/', family: 'files', labelKey: 'palette.prefix.files' },
]

/** Au-delà, une famille repousse les suivantes sous la ligne de flottaison. */
const PER_FAMILY = 3
/** Dépliée, une famille reste bornée : la palette n'est pas une page de résultats. */
const EXPANDED = 12

interface Item {
  key: string
  icon: ReactNode
  label: string
  /** À droite de la ligne : le projet, le dossier, la section — d'où vient la chose. */
  meta?: string
  /** Le passage trouvé, sous le titre. Les messages seuls en ont un. */
  excerpt?: ReactNode
  run: () => void
}

interface Group {
  id: FamilyId
  label: string
  items: Item[]
  /** Nombre trouvé avant le repli, pour écrire « 4 de plus ». */
  total: number
}

export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const t = useTranslate()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const { data: user } = useCurrentUser()
  const { data: conversations } = useAllConversations()
  const { data: projects } = useProjects()
  const { data: schedules } = useSchedules()
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [expanded, setExpanded] = useState<FamilyId | null>(null)
  const list = useRef<HTMLDivElement>(null)

  const prefix = PREFIXES.find((entry) => query.startsWith(entry.char)) ?? null
  const term = (prefix ? query.slice(1) : query).trim()
  const searching = term.length >= SEARCH_MIN_QUERY

  /**
   * Le projet et la conversation sous les yeux, qui donnent leur destination aux
   * gestes et leur portée aux fichiers. Lus dans l'adresse plutôt que remontés par la
   * coque : la palette s'ouvre depuis n'importe quelle vue, et l'adresse est ce que
   * toutes ont en commun.
   */
  const route = /^\/p\/([^/]+)(?:\/c\/([^/]+))?/.exec(pathname)
  const projectId = route?.[1] ?? null
  const conversationId = route?.[2] && route[2] !== 'new' ? route[2] : null
  const scope = conversationId ?? (projectId ? projectScope(projectId) : '')

  const { data: messages, isFetching } = useMessageSearch(open && !prefix ? term : '')
  const { data: cards } = useCardSearch(term, open && (!prefix || prefix.family === 'cards'))
  // Sans projet sous les yeux, aucune portée : interroger quand même composerait une
  // adresse de workspace vide, et le serveur répondrait 404 à chaque lettre.
  const { data: files } = useFileSearch(
    scope,
    open && scope && prefix?.family === 'files' ? term : '',
  )

  // Rouvrir la palette doit repartir d'une page blanche : la recherche précédente
  // répondait à une intention qui n'est plus celle du moment.
  useEffect(() => {
    if (!open) {
      setQuery('')
      setActive(0)
      setExpanded(null)
    }
  }, [open])

  const close = useCallback(() => onOpenChange(false), [onOpenChange])
  const go = useCallback(
    (to: string) => {
      close()
      navigate(to)
    },
    [close, navigate],
  )

  const projectNames = useMemo(
    () => new Map((projects ?? []).map((project) => [project.id, project.name])),
    [projects],
  )

  const sections = useMemo(() => visibleSections(user?.isAdmin), [user?.isAdmin])

  /**
   * Ce qui se lit à droite de la ligne d'un fil : son projet, ou le fait qu'il n'en a
   * pas. Les fils libres ne sont pas un cas à taire — c'est le premier groupe de la
   * colonne, et la palette doit les y désigner comme les autres.
   */
  const groupName = useCallback(
    (conversation: ConversationDto): string | undefined =>
      conversation.projectId === null
        ? t('destination.none')
        : projectNames.get(conversation.projectId),
    [projectNames, t],
  )

  /** Les gestes, et tout ce qui s'exécute plutôt que de s'ouvrir. */
  const commands = useMemo((): Item[] => {
    const entries: Item[] = [
      {
        key: 'cmd-new-conversation',
        icon: <Plus size={14} />,
        label: t('palette.action.newConversation'),
        // Sans projet sous les yeux, c'est un fil libre : il n'appartient à rien, et
        // c'est le défaut depuis la carte #14. Plus besoin de retomber sur l'accueil.
        run: () => go(projectId ? `/p/${projectId}/c/new` : '/c/new'),
      },
      {
        key: 'cmd-new-project',
        icon: <FolderOpen size={14} />,
        label: t('palette.action.newProject'),
        run: () => go('/projects/new'),
      },
    ]

    // Une tâche se planifie dans un projet : sans projet sous les yeux, le geste n'a
    // pas de destination et proposer une page vide serait un cul-de-sac.
    if (projectId) {
      entries.push({
        key: 'cmd-schedule',
        icon: <CalendarPlus size={14} />,
        label: t('palette.action.schedule'),
        run: () => go(`/p/${projectId}/schedules`),
      })
      entries.push({
        key: 'cmd-board',
        icon: <SquareKanban size={14} />,
        label: t('palette.action.board'),
        run: () => go(`/p/${projectId}/board`),
      })
    }

    entries.push({
      key: 'cmd-settings',
      icon: <Settings size={14} />,
      label: t('palette.action.settings'),
      run: () => {
        close()
        openSettings()
      },
    })

    return entries
  }, [close, go, projectId, t])

  const groups = useMemo((): Group[] => {
    const limit = (id: FamilyId, items: Item[]): Group => ({
      id,
      label: t(GROUP_LABELS[id]),
      items: items.slice(0, expanded === id ? EXPANDED : PER_FAMILY),
      total: items.length,
    })

    const byScore = <T,>(source: T[], text: (entry: T) => string): T[] =>
      source
        .map((entry) => {
          const score = scoreMatch(text(entry), term)
          return score === null ? null : { entry, score }
        })
        .filter((entry) => entry !== null)
        .sort((a, b) => b.score - a.score)
        .map((entry) => entry.entry)

    const conversationItems = (source: NonNullable<typeof conversations>): Item[] =>
      source.map((conversation) => ({
        key: `c-${conversation.id}`,
        icon: <AgentIcon agent={conversation.agent} size={14} />,
        label: conversation.title,
        meta: groupName(conversation),
        run: () => go(conversationPath(conversation)),
      }))

    const cardItems = (): Item[] =>
      (cards?.cards ?? []).map((card) => ({
        key: `card-${card.id}`,
        icon: <SquareKanban size={14} />,
        label: `#${card.number} ${card.title}`,
        meta: projectNames.get(card.projectId),
        run: () => go(`/p/${card.projectId}/board?carte=${card.number}`),
      }))

    const projectItems = (source = projects ?? []): Item[] =>
      source.map((project) => ({
        key: `p-${project.id}`,
        icon: <FolderOpen size={14} />,
        label: project.name,
        meta: project.git?.branch,
        run: () => go(`/p/${project.id}`),
      }))

    const fileItems = (): Item[] =>
      (files?.entries ?? [])
        .filter((entry) => !entry.isDirectory)
        .map((entry) => ({
          key: `f-${entry.path}`,
          icon: <File size={14} />,
          label: entry.path.split('/').pop() ?? entry.path,
          meta: entry.path,
          run: () => {
            close()
            openTab(scope, entry.path)
            setPanelTab('files')
            setPanelOpen(true)
          },
        }))

    // Un préfixe ne veut qu'une famille, et toute la famille : le repli à trois lignes
    // n'a de sens que quand plusieurs familles se partagent la hauteur.
    if (prefix) {
      const only: Record<string, Item[]> = {
        commands: byScore(commands, (item) => item.label),
        cards: cardItems(),
        projects: term ? byScore(projectItems(), (item) => item.label) : projectItems(),
        files: fileItems(),
      }
      const items = only[prefix.family] ?? []
      return [{ id: prefix.family, label: t(GROUP_LABELS[prefix.family]), items, total: items.length }]
    }

    if (!term) {
      /**
       * Au repos : ce qu'on rouvre, tous types confondus, puis les gestes. La palette
       * vide servait de sélecteur de conversations ; elle propose maintenant le
       * dernier travail quelle qu'en soit la nature, parce que c'est ce qu'on y vient
       * chercher le plus souvent.
       */
      const threads = conversations ?? []
      const board = cards?.cards ?? []
      const recent = [
        ...conversationItems(threads).map((item, index) => ({ at: threads[index]!.updatedAt, item })),
        ...cardItems().map((item, index) => ({ at: board[index]!.updatedAt, item })),
      ]
        .sort((a, b) => b.at - a.at)
        .map((entry) => entry.item)

      // Aucun « de plus » ici : *Reprendre* n'est pas une famille repliée mais une
      // courte liste de ce qui est encore chaud. Tout voir, c'est déjà la colonne.
      const resume = recent.slice(0, 5)
      return [
        { id: 'resume', label: t(GROUP_LABELS.resume), items: resume, total: resume.length },
        { id: 'actions', label: t(GROUP_LABELS.actions), items: commands, total: commands.length },
      ]
    }

    const messageItems: Item[] = searching
      ? (messages ?? []).map((message) => {
          const conversation = (conversations ?? []).find(
            (entry) => entry.id === message.conversationId,
          )
          return {
            key: `m-${message.conversationId}-${message.seq}`,
            icon: <MessageSquare size={14} />,
            label: conversation?.title ?? '',
            meta: conversation ? groupName(conversation) : undefined,
            excerpt: (
              <>
                <span className="mr-1.5 text-meta">
                  {message.role === 'user' ? t('search.role.user') : t('search.role.agent')}
                </span>
                {splitExcerpt(message.excerpt).map((part, index) =>
                  part.hit ? (
                    // Fond franc plutôt que le lavis d'accent : la ligne sélectionnée
                    // porte déjà ce lavis, et le passage trouvé s'y confondait.
                    <mark key={index} className="rounded bg-accent/25 px-0.5 font-medium text-ink">
                      {part.text}
                    </mark>
                  ) : (
                    <span key={index}>{part.text}</span>
                  ),
                )}
              </>
            ),
            // Le `seq` ouvre le fil sur le message trouvé plutôt qu'en haut.
            run: () =>
              go(
                `${conversationPath({ id: message.conversationId, projectId: conversation?.projectId ?? null })}?seq=${message.seq}`,
              ),
          }
        })
      : []

    const settingsItems: Item[] = byScore(sections, (section) => t(section.labelKey)).map(
      (section) => ({
        key: `s-${section.id}`,
        icon: section.icon,
        label: t(section.labelKey),
        meta: t('settings.title'),
        run: () => {
          close()
          openSettings(section.id)
        },
      }),
    )

    const scheduleItems: Item[] = byScore(schedules ?? [], (task) => task.name).map((task) => ({
      key: `t-${task.id}`,
      icon: <CalendarClock size={14} />,
      label: task.name,
      // Une tâche sans projet ne se lit que sur la page Planifiées, qui les porte toutes.
      meta: task.projectId ? projectNames.get(task.projectId) : t('destination.none'),
      run: () => go(task.projectId ? `/p/${task.projectId}/schedules` : '/schedules'),
    }))

    return [
      limit('notes', []),
      limit(
        'conversations',
        conversationItems(byScore(conversations ?? [], (conversation) => conversation.title)),
      ),
      limit('messages', messageItems),
      limit('projects', byScore(projectItems(), (item) => item.label)),
      limit('cards', cardItems()),
      limit('schedules', scheduleItems),
      limit('settings', settingsItems),
      limit('commands', byScore(commands, (item) => item.label)),
    ].filter((group) => group.items.length > 0)
  }, [
    cards,
    close,
    commands,
    conversations,
    expanded,
    files,
    go,
    groupName,
    messages,
    prefix,
    projectNames,
    projects,
    schedules,
    scope,
    searching,
    sections,
    t,
    term,
  ])

  const items = useMemo(() => groups.flatMap((group) => group.items), [groups])

  // La liste change à chaque frappe : garder l'ancien indice ferait pointer la
  // sélection sur un résultat qui n'est plus celui qu'on regardait.
  useEffect(() => setActive(0), [query, items.length])

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActive((index) => (items.length ? (index + 1) % items.length : 0))
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((index) => (items.length ? (index - 1 + items.length) % items.length : 0))
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      items[active]?.run()
    }
  }

  // La sélection au clavier doit rester visible quand elle sort de la zone affichée.
  useEffect(() => {
    list.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [active])

  let cursor = -1

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="scrim z-40" />
        <Dialog.Content
          aria-describedby={undefined}
          className={cx(
            'surface fixed z-50 flex flex-col overflow-hidden border-line shadow-pop',
            'inset-0 border-0',
            'sm:inset-auto sm:top-24 sm:left-1/2 sm:max-h-[70dvh] sm:w-[min(38rem,92vw)]',
            'sm:-translate-x-1/2 sm:rounded-xl sm:border',
          )}
          onKeyDown={onKeyDown}
        >
          {/* Le titre nomme le dialogue à lui seul : un `aria-label` en plus ne
              servirait à rien, `aria-labelledby` l'emporte sur lui. */}
          <Dialog.Title className="sr-only">{t('search.title')}</Dialog.Title>

          <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 pt-safe">
            <Search size={16} className="shrink-0 text-ink-faint" />
            <input
              autoFocus
              value={query}
              onChange={(event) => {
                setQuery(event.target.value)
                setExpanded(null)
              }}
              placeholder={t('palette.placeholder')}
              className="h-12 min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-faint"
            />
            {searching && isFetching ? (
              <Loader size={16} className="shrink-0 animate-spin text-ink-faint" />
            ) : null}

            {/* Au doigt la palette occupe tout l'écran : il n'y a ni touche Échap ni
                voile à toucher à côté, donc rien pour en sortir sans ce bouton. Inutile
                au-delà, où les deux gestes existent. */}
            <IconButton label={t('search.close')} className="sm:hidden" onClick={close}>
              <X size={16} />
            </IconButton>
          </div>

          <div ref={list} className="min-h-0 flex-1 overflow-y-auto p-1.5 pb-safe">
            {groups.map((group) => (
              <div key={group.id} className="mb-1">
                <div className="flex items-baseline gap-2 px-2.5 pt-1.5 pb-1">
                  <p className="flex-1 text-meta font-semibold tracking-wide text-ink-faint uppercase">
                    {group.label}
                  </p>
                  {group.total > group.items.length ? (
                    <button
                      type="button"
                      onClick={() => setExpanded(group.id)}
                      className="text-meta text-ink-faint hover:text-ink"
                    >
                      {t('palette.more', { count: group.total - group.items.length })}
                    </button>
                  ) : null}
                </div>
                {group.items.map((item) => {
                  cursor += 1
                  const index = cursor
                  return (
                    <Row
                      key={item.key}
                      item={item}
                      activeRow={active === index}
                      onHover={() => setActive(index)}
                    />
                  )
                })}
              </div>
            ))}

            {items.length === 0 ? (
              <p className="px-2.5 py-6 text-center text-sm text-ink-faint">
                {prefix?.family === 'files' && !scope
                  ? t('palette.files.noProject')
                  : term.length > 0 && !searching
                    ? t('search.empty.moreChars', { count: SEARCH_MIN_QUERY - term.length })
                    : t('search.empty.none')}
              </p>
            ) : null}
          </div>

          {/* Un raccourci qu'on ne lit nulle part n'existe pas : les quatre préfixes
              sont rappelés là où l'œil revient après avoir lu les résultats. */}
          <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-t border-line px-3 py-2 pb-safe">
            {PREFIXES.map((entry) => (
              <button
                key={entry.char}
                type="button"
                onClick={() => setQuery(entry.char)}
                className="flex items-center gap-1.5 text-meta text-ink-faint hover:text-ink"
              >
                <kbd className="rounded border border-line px-1 font-mono">{entry.char}</kbd>
                {t(entry.labelKey)}
              </button>
            ))}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

const GROUP_LABELS: Record<FamilyId, MessageKey> = {
  resume: 'palette.group.resume',
  actions: 'palette.group.actions',
  notes: 'palette.group.notes',
  conversations: 'search.section.conversations',
  messages: 'palette.group.messages',
  projects: 'palette.group.projects',
  cards: 'palette.group.cards',
  schedules: 'palette.group.schedules',
  settings: 'palette.group.settings',
  commands: 'palette.group.commands',
  files: 'palette.group.files',
}

function Row({
  item,
  activeRow,
  onHover,
}: {
  item: Item
  activeRow: boolean
  onHover: () => void
}) {
  return (
    <button
      type="button"
      data-active={activeRow}
      onMouseMove={onHover}
      onClick={item.run}
      className={cx(
        'flex w-full items-start gap-2.5 rounded-md px-2.5 py-2 text-left',
        activeRow ? 'bg-accent-wash text-ink' : 'text-ink-soft',
      )}
    >
      <span className="mt-0.5 shrink-0 text-ink-faint">{item.icon}</span>

      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className="min-w-0 truncate text-sm">{item.label}</span>
          {item.meta ? (
            <span className="ml-auto shrink-0 truncate text-meta text-ink-faint">{item.meta}</span>
          ) : null}
        </span>

        {item.excerpt ? (
          <span className="mt-0.5 block truncate text-xs text-ink-faint">{item.excerpt}</span>
        ) : null}
      </span>
    </button>
  )
}
