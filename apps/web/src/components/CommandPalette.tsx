import * as Dialog from '@radix-ui/react-dialog'
import {
  BookOpen,
  CalendarClock,
  CalendarPlus,
  ExternalLink,
  File,
  FolderOpen,
  Loader,
  MessageSquare,
  Play,
  Plug,
  Plus,
  RotateCw,
  Search,
  Settings,
  ShieldQuestion,
  Square,
  SquareKanban,
  SquareTerminal,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { SEARCH_MIN_QUERY, type ConversationDto, type FuzzyField, type ProjectActionDto } from '@solera/protocol'
import { actionView, describeActionState, useActions, useRunAction } from '../lib/actions'
import { useCardSearch } from '../lib/cards'
import { conversationPath } from '../lib/conversation-route'
import { useAllConversations } from '../lib/conversations'
import { useTranslate, type MessageKey } from '../lib/i18n'
import { useInstance } from '../lib/instance'
import { useProjects } from '../lib/projects'
import { describeTransport, useMcpServers } from '../lib/mcp'
import { fileFields, rankByFields, usePaletteCatalog, usePaletteFiles } from '../lib/palette'
import { splitExcerpt, useMessageSearch } from '../lib/search'
import { useSchedules } from '../lib/schedules'
import { useCurrentUser } from '../lib/session'
import { openSettings } from '../lib/settings-dialog'
import { openTab } from '../lib/editor-tabs'
import { openPanelOnArrival, setPanelOpen, setPanelTab, showTerminal } from '../lib/panel'
import { projectScope } from '../lib/workspace-scope'
import { visibleSections } from './settings/sections'
import { AgentIcon } from './AgentIcon'
import { IconButton, cx } from '@solera/ui'

/**
 * La palette : chercher, et lancer ce qui ne tient nulle part ailleurs.
 *
 * Elle ne cherchait que les conversations et les messages. C'est ce qui enfermait des
 * fonctions dès qu'on a posé « un domicile par chose » : une carte, une tâche
 * planifiée, un réglage n'étaient atteignables que par le chemin qui y mène. Douze
 * familles désormais, groupées, chacune repliée à trois lignes — une liste à plat de
 * quarante résultats ne se lit pas, et le groupe dit déjà de quelle nature est ce
 * qu'on regarde. Une famille de plus s'ajoute à `FamilyId`, à `GROUP_LABELS` et à la
 * liste de la recherche générale, et nulle part ailleurs.
 *
 * Le classement est la correspondance floue du serveur (`@solera/protocol`), et les
 * fichiers viennent de tous les projets visibles : chercher un fichier ne demande plus
 * d'ouvrir d'abord son projet.
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
  | 'projectActions'
  | 'notes'
  | 'conversations'
  | 'messages'
  | 'projects'
  | 'cards'
  | 'schedules'
  | 'settings'
  | 'commands'
  | 'files'
  | 'skills'
  | 'mcp'

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
  const route = /^\/p\/([^/]+)(?:\/(c\/([^/]+)|board))?/.exec(pathname)
  const projectId = route?.[1] ?? null
  const conversationId = route?.[3] && route[3] !== 'new' ? route[3] : null
  /**
   * Les vues qui montent le panneau, où un fichier s'ouvre sans quitter la page : la
   * conversation et le board. Le brouillon n'en a pas, et un panneau « ouvert » qu'il
   * ne monte pas resterait sans bouton pour le refermer.
   */
  const panelHere = conversationId !== null || route?.[2] === 'board'

  // Un fichier se cherche dès la première lettre derrière `/` : le préfixe dit déjà ce
  // qu'on veut, et un nom de fichier se tape court.
  const fileTerm = prefix?.family === 'files' ? term : searching ? term : ''
  const { data: messages, isFetching } = useMessageSearch(open && !prefix ? term : '')
  const { data: cards } = useCardSearch(term, open && (!prefix || prefix.family === 'cards'))
  const { data: files, isFetching: filesFetching } = usePaletteFiles(
    open && (!prefix || prefix.family === 'files') ? fileTerm : '',
    conversationId,
  )
  const { data: catalog } = usePaletteCatalog(open)
  const { data: mcp } = useMcpServers()
  const { data: projectActions } = useActions()
  // `mutate` est stable, pas l'objet de la mutation : les résultats ne se refont pas à
  // chaque rendu.
  const { mutate: startAction } = useRunAction()

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

  const { data: instance } = useInstance()
  const sections = useMemo(
    () => visibleSections(user?.isAdmin, instance?.capabilities),
    [user?.isAdmin, instance?.capabilities],
  )

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

  /**
   * Ouvrir un fichier dans le panneau de son projet. Celui d'un autre projet, ou vu
   * depuis une page sans panneau, fait d'abord aller au board de ce projet : c'est la
   * vue de projet qui monte le panneau sans qu'il faille choisir une conversation.
   */
  const openFile = useCallback(
    (fileProject: string, path: string) => {
      close()
      const here = fileProject === projectId && panelHere
      openTab(here && conversationId ? conversationId : projectScope(fileProject), path)
      if (here) {
        setPanelTab('files')
        setPanelOpen(true)
        return
      }
      // L'arrivée rend au panneau l'état de sa nouvelle page : c'est celui-là qu'on écrit.
      const board = `/p/${fileProject}/board`
      openPanelOnArrival(board, 'files')
      navigate(board)
    },
    [close, conversationId, navigate, panelHere, projectId],
  )

  /**
   * Le geste d'une action de projet. Dans le projet sous les yeux et sur une vue qui
   * monte le panneau, elle se joue là où l'on est, worktree de la conversation compris ;
   * ailleurs, on rejoint d'abord le board de son projet, et elle se joue à sa racine.
   * Relire ouvre l'onglet *Actions*, où la commande se lit avant de partir.
   */
  const runProjectAction = useCallback(
    (action: ProjectActionDto, op: ProjectActionOp) => {
      close()
      if (op === 'open') {
        const href = actionView(action).href
        if (href) window.open(href, '_blank', 'noreferrer')
        return
      }
      const here = action.projectId === projectId && panelHere
      if (!here) {
        const board = `/p/${action.projectId}/board`
        openPanelOnArrival(board, op === 'output' ? 'terminals' : 'actions')
        navigate(board)
      }
      if (op === 'review') {
        setPanelTab('actions')
        setPanelOpen(true)
      } else if (op === 'output') {
        if (action.lastRun) showTerminal(action.lastRun.terminalId)
      } else {
        startAction({ action, op, conversationId: here ? (conversationId ?? undefined) : undefined })
      }
    },
    [close, conversationId, navigate, panelHere, projectId, startAction],
  )

  const groups = useMemo((): Group[] => {
    const limit = (id: FamilyId, items: Item[]): Group => ({
      id,
      label: t(GROUP_LABELS[id]),
      items: items.slice(0, expanded === id ? EXPANDED : PER_FAMILY),
      total: items.length,
    })

    /** Une phrase se cherche par morceaux et initiales, pas en lettres éparses. */
    const sentence = (text: string): FuzzyField => ({ text, weight: 1, mode: 'words' })
    /** Le contexte d'une ligne, son projet surtout, ne fait que restreindre. */
    const context = (text: string | undefined): FuzzyField[] =>
      text ? [{ text, weight: 0.35, mode: 'strict' }] : []
    const byScore = <T,>(source: T[], text: (entry: T) => string): T[] =>
      rankByFields(source, term, (entry) => [sentence(text(entry))])

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

    /**
     * Les actions de projet, une ligne par geste que leur état permet : un service en
     * marche s'ouvre, s'arrête et se relance, il ne se « lance » pas une seconde fois.
     */
    const projectActionItems = (source: ProjectActionDto[]): Item[] =>
      source.flatMap((action) => {
        const project = projectNames.get(action.projectId)
        if (project === undefined) return []
        const view = actionView(action)
        const ops: ProjectActionOp[] =
          view.primary === 'review' ? ['review']
            : view.primary === 'stop' ? [...(view.href ? ['open' as const] : []), 'stop', 'restart']
              : view.primary === 'output' ? ['output']
                : ['run']
        const state = describeActionState(action, t)
        return ops.map((op) => ({
          key: `pa-${action.id}-${op}`,
          icon: ACTION_OPS[op].icon,
          label: t(ACTION_OPS[op].label, { label: action.label }),
          meta: action.projectId === projectId ? state : `${project} · ${state}`,
          run: () => runProjectAction(action, op),
        }))
      })
    const visibleActions = (projectActions ?? []).filter((action) => projectNames.has(action.projectId))

    const projectItems = (source = projects ?? []): Item[] =>
      source.map((project) => ({
        key: `p-${project.id}`,
        icon: <FolderOpen size={14} />,
        label: project.name,
        meta: project.git?.branch,
        run: () => go(`/p/${project.id}`),
      }))

    /**
     * Les fichiers de tous les projets, reclassés ensemble avec les poids du serveur.
     * Le projet sous les yeux passe devant à pertinence égale : c'est le plus souvent
     * là qu'on cherche.
     */
    const fileItems = (): Item[] => {
      const found = (files?.projects ?? []).flatMap((group) => {
        const name = projectNames.get(group.projectId)
        return name === undefined ? [] : group.paths.map((path) => ({ projectId: group.projectId, name, path }))
      })
      return rankByFields(
        found,
        term,
        (file) => fileFields(file.path, file.name),
        (file) => (file.projectId === projectId ? 0.5 : 0),
      ).map((file) => {
        const slash = file.path.lastIndexOf('/')
        return {
          key: `f-${file.projectId}-${file.path}`,
          icon: <File size={14} />,
          label: file.path.slice(slash + 1),
          meta: slash > 0 ? `${file.name} · ${file.path.slice(0, slash)}` : file.name,
          run: () => openFile(file.projectId, file.path),
        }
      })
    }

    // Un préfixe ne veut qu'une famille, et toute la famille : le repli à trois lignes
    // n'a de sens que quand plusieurs familles se partagent la hauteur.
    if (prefix) {
      const only: Record<string, Item[]> = {
        commands: byScore(commands, (item) => item.label),
        cards: cardItems(),
        projects: term
          ? rankByFields(projectItems(), term, (item) => [{ text: item.label, weight: 1 }])
          : projectItems(),
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
      // Les actions du projet sous les yeux, entre ce qu'on reprend et les gestes :
      // à l'ouverture, la palette est aussi le chemin le plus court vers un bouton.
      const here = projectActionItems(visibleActions.filter((action) => action.projectId === projectId))
      const rest: Group[] = [
        { id: 'resume', label: t(GROUP_LABELS.resume), items: resume, total: resume.length },
        limit('projectActions', here),
        { id: 'actions', label: t(GROUP_LABELS.actions), items: commands, total: commands.length },
      ]
      return rest.filter((group) => group.id !== 'projectActions' || group.items.length > 0)
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

    // La description compte aussi : « thème » doit trouver *Apparence*.
    const settingsItems: Item[] = rankByFields(sections, term, (section) => [
      sentence(t(section.labelKey)),
      { text: t(section.descriptionKey), weight: 0.5, mode: 'strict' },
    ]).map(
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

    const scheduleItems: Item[] = rankByFields(schedules ?? [], term, (task) => [
      sentence(task.name),
      ...context(task.projectId ? projectNames.get(task.projectId) : undefined),
    ]).map((task) => ({
      key: `t-${task.id}`,
      icon: <CalendarClock size={14} />,
      label: task.name,
      // Une tâche sans projet ne se lit que sur la page Planifiées, qui les porte toutes.
      meta: task.projectId ? projectNames.get(task.projectId) : t('destination.none'),
      run: () => go(task.projectId ? `/p/${task.projectId}/schedules` : '/schedules'),
    }))

    // Un skill global n'a pas de projet ; celui d'un projet qu'on ne voit plus (archivé
    // depuis l'ouverture) est écarté plutôt que montré sans contexte.
    const skills = (catalog?.skills ?? []).filter(
      (skill) => skill.projectId === null || projectNames.has(skill.projectId),
    )
    const skillItems: Item[] = rankByFields(
      skills,
      term,
      (skill) => [
        { text: skill.name, weight: 1 },
        { text: skill.description, weight: 0.5, mode: 'strict' },
        ...context(skill.projectId ? projectNames.get(skill.projectId) : undefined),
      ],
      // Éteint, il reste trouvable, mais derrière ceux qui servent.
      (skill) => (skill.enabled ? 0 : -1),
    ).map((skill) => ({
      key: `sk-${skill.id}`,
      icon: <BookOpen size={14} />,
      label: skill.name,
      meta: [
        skill.projectId ? projectNames.get(skill.projectId) : t('palette.skill.global'),
        skill.enabled ? null : t('palette.disabled'),
      ]
        .filter(Boolean)
        .join(' · '),
      run: () => go(`/skills/${skill.id}`),
    }))

    const mcpItems: Item[] = rankByFields(
      mcp?.servers ?? [],
      term,
      (server) => [
        { text: server.name, weight: 1 },
        { text: describeTransport(server.transport), weight: 0.5, mode: 'strict' },
      ],
      (server) => (server.enabled ? 0 : -1),
    ).map((server) => ({
      key: `mcp-${server.id}`,
      icon: <Plug size={14} />,
      label: server.name,
      meta: server.enabled ? describeTransport(server.transport) : t('palette.disabled'),
      run: () => {
        close()
        openSettings('mcp')
      },
    }))

    return [
      limit('notes', []),
      limit(
        'conversations',
        conversationItems(
          rankByFields(conversations ?? [], term, (conversation) => [
            sentence(conversation.title),
            ...context(groupName(conversation)),
          ]),
        ),
      ),
      limit('messages', messageItems),
      limit(
        'projects',
        rankByFields(projectItems(), term, (item) => [{ text: item.label, weight: 1 }]),
      ),
      limit('cards', cardItems()),
      limit(
        'projectActions',
        projectActionItems(
          // Celles du projet sous les yeux passent devant à pertinence égale.
          rankByFields(
            visibleActions,
            term,
            (action) => [
              sentence(action.label),
              { text: action.command, weight: 0.4, mode: 'strict' },
              ...context(projectNames.get(action.projectId)),
            ],
            (action) => (action.projectId === projectId ? 0.5 : 0),
          ),
        ),
      ),
      limit('files', fileItems()),
      limit('skills', skillItems),
      limit('mcp', mcpItems),
      limit('schedules', scheduleItems),
      limit('settings', settingsItems),
      limit('commands', byScore(commands, (item) => item.label)),
    ].filter((group) => group.items.length > 0)
  }, [
    cards,
    catalog,
    close,
    commands,
    conversations,
    expanded,
    files,
    go,
    groupName,
    mcp,
    messages,
    openFile,
    prefix,
    projectId,
    projectActions,
    projectNames,
    projects,
    runProjectAction,
    schedules,
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
            {(searching && isFetching) || (fileTerm && filesFetching) ? (
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
                {term.length > 0 && !searching && prefix?.family !== 'files'
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

/** Ce qu'une ligne de la palette fait d'une action de projet. */
type ProjectActionOp = 'run' | 'stop' | 'restart' | 'open' | 'output' | 'review'

const ACTION_OPS: Record<ProjectActionOp, { label: MessageKey; icon: ReactNode }> = {
  run: { label: 'palette.projectAction.run', icon: <Play size={14} /> },
  stop: { label: 'palette.projectAction.stop', icon: <Square size={14} /> },
  restart: { label: 'palette.projectAction.restart', icon: <RotateCw size={14} /> },
  open: { label: 'palette.projectAction.open', icon: <ExternalLink size={14} /> },
  output: { label: 'palette.projectAction.output', icon: <SquareTerminal size={14} /> },
  review: { label: 'palette.projectAction.review', icon: <ShieldQuestion size={14} /> },
}

const GROUP_LABELS: Record<FamilyId, MessageKey> = {
  resume: 'palette.group.resume',
  actions: 'palette.group.actions',
  projectActions: 'palette.group.projectActions',
  notes: 'palette.group.notes',
  conversations: 'search.section.conversations',
  messages: 'palette.group.messages',
  projects: 'palette.group.projects',
  cards: 'palette.group.cards',
  schedules: 'palette.group.schedules',
  settings: 'palette.group.settings',
  commands: 'palette.group.commands',
  files: 'palette.group.files',
  skills: 'palette.group.skills',
  mcp: 'palette.group.mcp',
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
