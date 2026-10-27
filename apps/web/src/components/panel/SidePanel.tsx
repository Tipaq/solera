import { TooltipButton } from '@solera/ui'
import { Bot, ChevronLeft, FileCode, GitCompare, Globe, Search, SquareKanban, SquareTerminal, X, Zap } from 'lucide-react'
import { memo, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { AgentKind } from '@solera/protocol'
import type { BackgroundWork } from '../../lib/background'
import type { EditTurn, TurnCheckpoint } from '../../lib/chat-fold'
import { openTab, useEditorTabs } from '../../lib/editor-tabs'
import { useTranslate } from '../../lib/i18n'
import {
  restorePanelWidth,
  setDockedPanelWidth,
  setPanelExpanded,
  setPanelOpen,
  setPanelTab,
  setPanelTree,
  setPanelWidth,
  usePanelTab,
  usePanelTree,
  useSelectedSubAgent,
  type PanelTab,
} from '../../lib/panel'
import { projectScope } from '../../lib/workspace-scope'
import { resizeHandle } from '../../lib/resize-handle'
import { useMediaQuery } from '../../lib/viewport'
import { PanelFocus } from '../PanelFocus'
import type { SubAgent } from '../../lib/subagents'
import { useRefreshTree } from '../../lib/tree'
import { useProjects } from '../../lib/projects'
import { useActions } from '../../lib/actions'
import { useCards } from '../../lib/cards'
import { toReviewCount } from '../../lib/project-pane'
import { IconButton, cx } from '@solera/ui'
import { ActionsPane } from './ActionsPane'
import { AgentsPane } from './AgentsPane'
import { FilesPane } from './FilesPane'
import { GitPane } from './GitPane'
import { SearchPane } from './SearchPane'
import { TerminalsPane } from './TerminalsPane'
import { ProjectPane, type ProjectPaneSession } from './ProjectPane'
import { WebPane } from './WebPane'
import { useWebPane } from '../../lib/web-pane'
import { QuickOpen } from './QuickOpen'
import { HeaderBand } from '../HeaderBand'

/** Instances uniques : une liste vide recréée à chaque rendu ferait rendre les vues. */
const NO_EDIT_TURNS: EditTurn[] = []
const NO_CHECKPOINTS: TurnCheckpoint[] = []
const NO_SUB_AGENTS: SubAgent[] = []
const NO_BACKGROUND: BackgroundWork[] = []

/**
 * Panneau latéral droit.
 *
 * À côté du fil lorsque la largeur le permet, avec une vue agrandie pour l'éditeur.
 * Sur téléphone et depuis le board, le panneau recouvre le contenu.
 *
 * Ni voile ni fermeture au clic extérieur : ce n'est pas une boîte de dialogue, il
 * tient des terminaux vivants et un contenu en cours d'édition, et un clic mal placé
 * ne doit pas les emporter.
 *
 * En vue conversation, il suit le répertoire de travail du fil, worktree compris :
 * c'est là que l'agent écrit. En vue projet (Board, brouillon), aucune conversation
 * n'existe : Fichiers, Git et Terminaux opèrent sur le workspace du projet, et les
 * onglets propres à une session (Historique, Agents, MCP) ne sont pas proposés.
 *
 * Sur un fil libre, il ne reste qu'*Agent*. Non parce qu'on cache les autres vues, mais
 * parce qu'elles n'ont pas d'objet : un fil sans projet n'a pas de répertoire de
 * travail, donc rien à parcourir, rien à comparer, nulle part où ouvrir un shell.
 */
export const SidePanel = memo(function SidePanel({
  projectId,
  conversationId,
  agent,
  editTurns = NO_EDIT_TURNS,
  history,
  checkpoints = NO_CHECKPOINTS,
  canRestore = false,
  turnRunning = false,
  subAgents = NO_SUB_AGENTS,
  background = NO_BACKGROUND,
  open,
  docked = false,
  canDock = false,
  workspaceName,
  session,
}: {
  /** Null sur un fil libre : il n'y a alors pas de répertoire de travail du tout. */
  projectId: string | null
  /** Absente en vue projet : le panneau se réduit alors aux onglets de répertoire. */
  conversationId?: string
  /** CLI de la conversation, pour les gestes que seuls certains CLI savent faire. */
  agent?: AgentKind
  editTurns?: EditTurn[]
  /**
   * L'historique du fil, quand des tours plus anciens restent au serveur : les vues
   * filtrées sur un tour n'ont que les tours chargés.
   */
  history?: { hasMore: boolean; loading: boolean; load: () => Promise<void> }
  /** Points de reprise des tours, pour l'onglet Git filtré sur un tour. */
  checkpoints?: TurnCheckpoint[]
  /** Vrai pour le propriétaire du fil : lui seul peut ramener le workspace en arrière. */
  canRestore?: boolean
  turnRunning?: boolean
  subAgents?: SubAgent[]
  background?: BackgroundWork[]
  /** Faux pendant la sortie : le panneau est encore monté, mais s'en va. */
  open: boolean
  docked?: boolean
  canDock?: boolean
  workspaceName?: string
  /** Ce que la vue *Projet* lit de la session : sa carte, son fil, son activité. */
  session?: ProjectPaneSession
}) {
  // L'onglet vit hors du panneau : le fil le pilote, en ouvrant un fichier depuis un
  // diff comme en désignant un sous-agent depuis le bandeau.
  const t = useTranslate()
  // Un fil libre n'a pas de dossier : les cinq vues de répertoire n'ont pas d'objet.
  const hasWorkspace = projectId !== null
  const scope = conversationId ?? projectScope(projectId ?? '')
  const { data: projects } = useProjects()
  const projectName = projects?.find((project) => project.id === projectId)?.name
  const workspaceLabel = hasWorkspace
    ? [projectName, workspaceName ?? t('terminal.dir.workspace')].filter(Boolean).join(' · ')
    : t('panel.noWorkspace')
  const chosenTab = usePanelTab()
  // La vue *Web* n'existe que tant qu'une page y est ouverte. Elle ne dépend d'aucun
  // dossier : un fil libre qui cherche sur le web en a autant besoin qu'un autre.
  const hasWeb = useWebPane(scope) !== null
  // L'onglet choisi survit d'une vue à l'autre ; en vue projet, un onglet de session
  // retombe sur les fichiers plutôt que d'afficher un panneau vide. Sans dossier, c'est
  // l'inverse : seul *Agent* existe, et c'est lui qu'on retrouve en revenant.
  const sessionTab = chosenTab === 'agents' || chosenTab === 'project'
  const tab: PanelTab = chosenTab === 'web'
    ? hasWeb ? 'web' : hasWorkspace ? 'files' : 'agents'
    : !hasWorkspace
      ? 'agents'
      : conversationId || !sessionTab
        ? chosenTab
        : 'files'
  // Le badge de *Projet* compte ce qui attend une relecture : c'est la seule chose du
  // board qui réclame quelqu'un, et le reste se lit en ouvrant l'onglet.
  const { data: cards } = useCards(conversationId && projectId ? projectId : undefined)
  const reviewCount = toReviewCount(cards)
  // Le badge d'*Actions* ne compte que celles à relire : elles seules attendent quelqu'un.
  const { data: actions } = useActions()
  const proposedActions = (actions ?? []).filter(
    (action) => action.projectId === projectId && action.status === 'proposed',
  ).length
  const selectedSubAgent = useSelectedSubAgent()
  /**
   * Le premier rendu se fait volontairement hors écran, l'entrée n'étant lancée qu'au
   * rendu suivant : un élément qui naît déjà en place n'a aucune transition à jouer,
   * et le panneau apparaîtrait d'un coup.
   */
  const [entered, setEntered] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const [quickOpen, setQuickOpen] = useState(false)
  const aside = useRef<HTMLElement>(null)
  const refresh = useRefreshTree(scope)
  const wasRunning = useRef(turnRunning)
  const wide = useMediaQuery('(min-width: 48rem)')
  const modal = !wide || fullscreen
  const treeOpen = usePanelTree()
  const { active: openFile } = useEditorTabs(scope)

  /**
   * Ce que la bande du panneau annonce quand il recouvre l'écran.
   *
   * Le répertoire de travail tant qu'on parcourt, le fichier dès qu'on en lit un : au
   * téléphone, l'arbre et l'éditeur ne tiennent pas côte à côte, et la bande est le
   * seul endroit qui dise lequel des deux on regarde. Le retour ramène à l'arbre,
   * comme on remonte d'un dossier.
   */
  // Seulement là où l'arbre et l'éditeur ne tiennent pas ensemble. Sur un panneau
  // large, même sorti de la coque, le répertoire reste le bon titre : le nom du
  // fichier est déjà sur son onglet, deux lignes plus bas.
  const readingFile = !wide && tab === 'files' && !treeOpen && Boolean(openFile)
  const bandTitle = readingFile && openFile ? (openFile.split('/').pop() ?? openFile) : workspaceLabel

  /**
   * Ouvrir un fichier depuis un diff : l'onglet naît sous les yeux de qui l'a demandé.
   * Stable : les vues qui le reçoivent sont mémoïsées.
   */
  const openInFiles = useCallback((path: string) => {
    openTab(scope, path)
    setPanelTab('files')
    // Ouvrir depuis une palette ou un diff doit montrer le fichier sur téléphone.
    if ((aside.current?.clientWidth ?? 0) < 560) setPanelTree(false, false)
  }, [scope])

  useEffect(restorePanelWidth, [])

  useEffect(() => {
    const frame = requestAnimationFrame(() => setEntered(true))
    return () => cancelAnimationFrame(frame)
  }, [])

  /**
   * Rafraîchi à la **fin** d'un tour, moment où l'arborescence a réellement bougé,
   * plutôt qu'en boucle. Pendant le tour, les fichiers changent à chaque écriture et
   * relire à chaque événement ferait clignoter la liste sans rien apprendre.
   */
  useEffect(() => {
    if (wasRunning.current && !turnRunning) refresh()
    wasRunning.current = turnRunning
  }, [turnRunning, refresh])

  /**
   * Le panneau est collé au bord droit de la fenêtre : sa largeur vaut donc la
   * distance du pointeur à ce bord, sans décalage à mémoriser au début du geste.
   */
  /**
   * Les trois géométries, dans l'ordre où on les veut : accolé au fil, posé en
   * feuille par-dessus, puis sorti de la coque.
   *
   * Elles se réglaient à trois boutons de l'en-tête du panneau, qui n'existe plus. Le
   * bord est leur place : c'est déjà lui qui règle la largeur, et passer d'une
   * géométrie à l'autre, c'est la même question. Le nom de la poignée annonce où le
   * prochain geste mène, faute de quoi un double-clic serait une surprise.
   */
  const geometries: ('docked' | 'sheet' | 'fullscreen')[] = [
    ...(canDock ? (['docked'] as const) : []),
    'sheet',
    'fullscreen',
  ]
  const geometry = fullscreen ? 'fullscreen' : docked ? 'docked' : 'sheet'
  const nextGeometry = geometries[(geometries.indexOf(geometry) + 1) % geometries.length] ?? 'sheet'
  const goTo = (next: 'docked' | 'sheet' | 'fullscreen') => {
    setFullscreen(next === 'fullscreen')
    if (next !== 'fullscreen') setPanelExpanded(next === 'sheet')
  }
  /**
   * Le double-clic ne fait que la bascule du milieu — accoler ou poser par-dessus.
   *
   * Le plein écran est laissé au clavier, qui parcourt les trois : en plein écran la
   * poignée n'existe plus, puisqu'il n'y a plus de largeur à régler, et un double-clic
   * qui y mène serait un geste sans retour par le même chemin. On en sort par le
   * retour de la bande, qui est là pour ça.
   */
  const toggleGeometry = () => {
    if (fullscreen) return setFullscreen(false)
    if (canDock) setPanelExpanded(docked)
  }

  const handle = resizeHandle({
    widthAt: (clientX) => window.innerWidth - clientX,
    current: () => aside.current?.getBoundingClientRect().width ?? null,
    apply: docked ? setDockedPanelWidth : setPanelWidth,
  })

  return (
    <PanelFocus open={open} modal={modal} onClose={() => fullscreen ? setFullscreen(false) : setPanelOpen(false)} protectEditor>
    <aside
      ref={aside}
      inert={!open}
      aria-hidden={!open}
      aria-label={t('panel.aria')}
      role={modal ? 'dialog' : undefined}
      aria-modal={modal && open ? true : undefined}
      // Repère stable pour le raccourci de recherche du fil, qui doit savoir si
      // l'événement vient d'ici : l'`aria-label` ci-dessus, lui, change de langue.
      data-panel="workspace"
      data-fullscreen={fullscreen || undefined}
      onKeyDownCapture={(event) => {
        if (!open || quickOpen || tab !== 'files' || event.defaultPrevented || event.altKey || event.shiftKey) return
        if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'p') return
        if (!aside.current?.contains(event.target as Node)) return
        event.preventDefault()
        event.stopPropagation()
        setQuickOpen(true)
      }}
      className={cx(
        // Pas d'`overflow-hidden` ici : il rognerait la poignée, posée en débord sur
        // le bord gauche. C'est la zone de défilement interne qui borne le contenu.
        // L'ombre porte le décollement : sans elle, un panneau posé sur le fil se lit
        // comme une colonne de plus, et on cherche pourquoi le fil est coupé.
        'surface flex flex-col border-l border-line shadow-pop',
        // Plein écran au doigt, largeur réglable au-delà. `absolute` et non `fixed` :
        // le repère est le calque de la coque, donc le panneau suit le viewport visuel.
        // La largeur est bornée en CSS et pas seulement à l'enregistrement : une
        // fenêtre rétrécie après coup laisserait sinon un panneau plus large qu'elle.
        fullscreen ? 'app-layer z-40 pt-safe' : docked
          ? 'relative z-20 h-full w-[clamp(20rem,var(--panel-docked-width,48%),calc(100%-26rem))] shrink-0'
          : 'absolute inset-0 z-20 md:left-auto md:w-[min(var(--panel-width,45rem),calc(100vw-10rem))]',
        // `translate` et non `transform` : Tailwind v4 pose les utilitaires de
        // translation sur cette propriété CSS, distincte de `transform`.
        'transition-[translate] duration-200 ease-out',
        entered && open ? 'translate-x-0' : 'translate-x-full',
      )}
    >
      {/*
        Le panneau n'a plus d'en-tête : il n'est que son contenu, et ses vues vivent
        dans la bande du haut, sur le segment qui le surplombe. Six icônes y étaient
        posées en dur — fermeture, recherche, arborescence, relire, accoler, plein
        écran : la fermeture est au bouton du fil, juste à côté ; la recherche et
        l'arborescence sont rendues à la vue *Fichiers*, les seules qu'elles
        concernent ; la géométrie se règle à la poignée du bord.
      */}
      {modal ? (
        /* Quand le panneau recouvre l'écran, c'est lui qui porte le segment de la vue :
           il n'y a plus de fil derrière lui pour dire où l'on est, ni par où sortir. */
        <HeaderBand zone="panel">
          {/* Le retour ne s'affiche que s'il y a où revenir : à l'arbre quand on lit
              un fichier, à la fenêtre quand on est sorti de la coque. Ailleurs il
              ferait la même chose que la croix, et deux boutons pour un geste se
              lisent comme deux gestes. */}
          {fullscreen ? (
            <IconButton label={t('panel.fullscreen.exit')} onClick={() => setFullscreen(false)}>
              <ChevronLeft size={18} />
            </IconButton>
          ) : readingFile ? (
            <IconButton label={t('panel.tree.show')} onClick={() => setPanelTree(true)}>
              <ChevronLeft size={18} />
            </IconButton>
          ) : null}
          <span className="min-w-0 flex-1 truncate text-sm font-medium" title={readingFile && openFile ? openFile : workspaceLabel}>
            {bandTitle}
          </span>
          <IconButton data-panel-initial-focus label={t('panel.close')} onClick={() => setPanelOpen(false)}>
            <X size={16} />
          </IconButton>
        </HeaderBand>
      ) : null}

      {/* `@container` : les noms des vues tombent selon la largeur du panneau, et non
          celle de la fenêtre, puisqu'il se redimensionne. */}
      <ViewBar
        band={!modal}
        /*
         * « Fermer » a quitté le panneau parce que le bouton du fil est juste à côté —
         * ce qui n'est vrai que lorsque le panneau est accolé. Posé en feuille, il
         * recouvre le bout de la bande du fil, et donc le bouton qui le referme : il
         * garde alors le sien, au même endroit, contre le même bord.
         */
        closable={!modal && !docked}
        tab={tab}
        hasWorkspace={hasWorkspace}
        hasConversation={Boolean(conversationId)}
        hasWeb={hasWeb}
        agentBadge={subAgents.filter((entry) => entry.status === 'running').length + background.length}
        projectBadge={reviewCount}
        actionsBadge={proposedActions}
      />

      {/* Monté même quand un autre onglet est devant : revenir aux fichiers ne doit
          replier ni l'arborescence, ni perdre sa position de défilement, ni faire
          relire son fichier à l'éditeur. */}
      {hasWorkspace ? (
        <div
          className={cx(
            'min-h-0 min-w-0 flex-1 overflow-hidden pb-safe',
            tab === 'files' ? 'flex' : 'hidden',
          )}
        >
          <FilesPane scope={scope} label={workspaceLabel} />
        </div>
      ) : null}

      {history?.hasMore && (tab === 'agents' || tab === 'git') ? (
        <button
          type="button"
          disabled={history.loading}
          onClick={() => void history.load()}
          className="shrink-0 border-b border-line p-2 text-xs text-ink-soft hover:text-ink"
        >
          {t(history.loading ? 'journal.history.loading' : 'journal.history.earlier')}
        </button>
      ) : null}

      {/* Deux vues montées seulement quand on les regarde : leur contenu vient du
          journal ou d'une lecture git relancée à l'affichage, rien ne s'y perd. */}
      {hasWorkspace && tab === 'git' ? (
        <GitPane
          scope={scope}
          projectId={projectId}
          conversationId={conversationId}
          checkpoints={checkpoints}
          canRestore={canRestore}
          turnRunning={turnRunning}
          onOpenFile={openInFiles}
        />
      ) : null}

      {/* Montée même derrière une autre vue, comme les fichiers : cliquer un résultat
          bascule sur l'éditeur, et revenir à la recherche doit retrouver la frappe,
          les drapeaux, les filtres et les résultats — pas un champ vide. */}
      {hasWorkspace ? (
        <div
          className={cx(
            'min-h-0 min-w-0 flex-1 overflow-hidden',
            tab === 'search' ? 'flex' : 'hidden',
          )}
        >
          <div className="min-h-0 min-w-0 flex-1">
            <SearchPane scope={scope} onOpenFile={openInFiles} />
          </div>
        </div>
      ) : null}

      {/* Monté dès que le panneau existe, et non seulement quand l'onglet est actif :
          un shell qui compile ne doit pas être coupé parce qu'on regarde le diff. */}
      {hasWorkspace ? (
        <div
          className={cx(
            'min-h-0 min-w-0 flex-1 overflow-hidden',
            tab === 'terminals' ? 'flex' : 'hidden',
          )}
        >
          <div className="min-h-0 min-w-0 flex-1">
            <TerminalsPane
              projectId={projectId}
              conversationId={conversationId}
              visible={tab === 'terminals'}
            />
          </div>
        </div>
      ) : null}

      {/* Monté seulement quand on le regarde : la liste vient du cache des actions, et
          les terminaux qu'elle ouvre vivent dans leur propre vue. */}
      {tab === 'actions' && projectId ? (
        <ActionsPane projectId={projectId} conversationId={conversationId} />
      ) : null}

      {/* Monté seulement quand on le regarde, contrairement aux autres : il ne tient
          rien de vivant, tout son contenu vient du journal, et ses chronomètres n'ont
          rien à compter derrière un onglet fermé. */}
      {tab === 'agents' && conversationId && agent ? (
        <AgentsPane
          conversationId={conversationId}
          scope={scope}
          agent={agent}
          agents={subAgents}
          background={background}
          editTurns={editTurns}
          selectedId={selectedSubAgent}
          onOpenFile={openInFiles}
        />
      ) : null}

      {/* Monté seulement quand on le regarde : tout vient du board, déjà en cache, et
          du fil, que la page tient. Rien ne s'y perd à le démonter. Remonté à chaque
          conversation : la page ne l'est pas, et la carte empilée, le segment ou la carte
          créée mais pas rattachée d'une session n'ont rien à faire dans la suivante. */}
      {tab === 'project' && conversationId && projectId && session ? (
        <ProjectPane key={conversationId} projectId={projectId} conversationId={conversationId} session={session} />
      ) : null}

      {/* Montée tant qu'une page est ouverte, comme les terminaux : la page en direct
          est un document vivant, et la recharger à chaque passage par une autre vue
          perdrait où l'on en était dedans. */}
      {hasWeb ? (
        <div className={cx('min-h-0 min-w-0 flex-1 overflow-hidden', tab === 'web' ? 'flex' : 'hidden')}>
          <WebPane scope={scope} />
        </div>
      ) : null}

      {/* Poignée de largeur sur le bord gauche, grand écran seulement : au doigt le
          panneau occupe tout l'écran, il n'y a rien à ajuster. */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={t('panel.resize.aria', { next: t(`panel.geometry.${nextGeometry}`) })}
        tabIndex={0}
        onPointerDown={handle.onPointerDown}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            goTo(nextGeometry)
            return
          }
          handle.onKeyDown(event)
        }}
        onDoubleClick={toggleGeometry}
        className={cx(
          'absolute inset-y-0 -left-1 hidden w-2 cursor-col-resize',
          !fullscreen && 'md:block',
          'after:absolute after:inset-y-0 after:left-1/2 after:w-0.5 after:-translate-x-1/2',
          'after:transition-colors hover:after:bg-accent focus-visible:after:bg-accent',
          'outline-none',
        )}
      />
      <QuickOpen scope={scope} workspaceLabel={workspaceLabel} open={open && quickOpen} onOpenChange={setQuickOpen} onSelect={openInFiles} />
    </aside>
    </PanelFocus>
  )
})

/**
 * Les vues, dans la bande.
 *
 * Elles sont nommées tant qu'il y a la place, et les noms tombent **tous ensemble**
 * sous 38 rem : une rangée où seul l'onglet actif garde son nom change de largeur à
 * chaque choix, et les quatre autres deviennent des devinettes. Le seuil suit le nombre
 * de vues : 30 rem tenaient six noms, *Actions* en a fait sept. Quand le panneau
 * recouvre l'écran, l'actif garde le sien — la bande au-dessus dit déjà où l'on est,
 * mais c'est le seul repère écrit qui reste de la vue elle-même.
 *
 * Le trait sépare les cinq vues du répertoire des deux qui regardent la session,
 * *Agent* et *Projet*. Sur un fil libre il ne reste qu'*Agent* — sans board, *Projet*
 * n'a rien à montrer — et le trait n'a donc rien à séparer.
 */
function ViewBar({ band, closable, tab, hasWorkspace, hasConversation, hasWeb, agentBadge, projectBadge, actionsBadge }: {
  /** Vrai quand cette rangée *est* le segment de bande du panneau, à sa hauteur. */
  band: boolean
  /** Le panneau recouvre le bouton du fil : il porte alors sa propre fermeture. */
  closable: boolean
  tab: PanelTab
  /** Faux sur un fil libre : les cinq vues de répertoire n'ont rien à montrer. */
  hasWorkspace: boolean
  hasConversation: boolean
  /** Une page est ouverte dans la vue *Web* : son onglet n'existe qu'alors. */
  hasWeb: boolean
  agentBadge: number
  /** Cartes du projet en attente de relecture. */
  projectBadge: number
  /** Actions du projet proposées par un agent, en attente de relecture. */
  actionsBadge: number
}) {
  const t = useTranslate()
  const views = (
    <>
      {hasWorkspace ? (
        <>
          <Tab icon={<FileCode size={15} />} label={t('panel.tab.files')} keepLabel={!band}
            active={tab === 'files'} onSelect={() => setPanelTab('files')} />
          <Tab icon={<Search size={15} />} label={t('panel.tab.search')} keepLabel={!band}
            active={tab === 'search'} onSelect={() => setPanelTab('search')} />
          <Tab icon={<GitCompare size={15} />} label={t('panel.tab.git')} keepLabel={!band}
            active={tab === 'git'} onSelect={() => setPanelTab('git')} />
          <Tab icon={<SquareTerminal size={15} />} label={t('panel.tab.terminals')} keepLabel={!band}
            active={tab === 'terminals'} onSelect={() => setPanelTab('terminals')} />
          <Tab icon={<Zap size={15} />} label={t('panel.tab.actions')} keepLabel={!band}
            badge={actionsBadge} badgeLabel={(label, count) => t('panel.tab.actions.badge', { label, count })}
            badgeTone="caution" active={tab === 'actions'} onSelect={() => setPanelTab('actions')} />
        </>
      ) : null}
      {hasConversation ? (
        <>
          {hasWorkspace ? <span aria-hidden className="mx-1 h-5 w-px shrink-0 bg-line" /> : null}
          <Tab icon={<Bot size={15} />} label={t('panel.tab.agents')} keepLabel={!band}
            badge={agentBadge} active={tab === 'agents'} onSelect={() => setPanelTab('agents')} />
          {hasWorkspace ? (
            <Tab icon={<SquareKanban size={15} />} label={t('panel.tab.project')} keepLabel={!band}
              badge={projectBadge} badgeLabel={(label, count) => t('panel.tab.project.badge', { label, count })}
              badgeTone="caution" active={tab === 'project'} onSelect={() => setPanelTab('project')} />
          ) : null}
        </>
      ) : null}
      {hasWeb ? (
        <>
          {hasWorkspace || hasConversation ? <span aria-hidden className="mx-1 h-5 w-px shrink-0 bg-line" /> : null}
          <Tab icon={<Globe size={15} />} label={t('panel.tab.web')} keepLabel={!band}
            active={tab === 'web'} onSelect={() => setPanelTab('web')} />
        </>
      ) : null}
    </>
  )

  // La liste défile plutôt que de pousser les vues hors du cadre : sous 38 rem elles
  // sont réduites à leurs icônes, mais un panneau de 20 rem n'en tient toujours que
  // quatre.
  const inner = 'flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto'

  const close = closable ? (
    <IconButton data-panel-initial-focus size="sm" label={t('panel.close')} onClick={() => setPanelOpen(false)}>
      <X size={16} />
    </IconButton>
  ) : null

  return band ? (
    <HeaderBand zone="panel" className="@container">
      <div className={inner}>{views}</div>
      {close}
    </HeaderBand>
  ) : (
    <div className="@container flex h-[var(--header-height)] shrink-0 items-center border-b border-line px-2">
      <div className={inner}>{views}</div>
      {close}
    </div>
  )
}

function Tab({
  icon,
  label,
  active,
  badge = 0,
  badgeLabel,
  badgeTone = 'accent',
  keepLabel = false,
  onSelect,
}: {
  icon: ReactNode
  label: string
  active: boolean
  /** Décompte affiché sur l'onglet. Zéro n'affiche rien. */
  badge?: number
  /** Ce que le décompte compte, dit au lecteur d'écran. Par défaut, ce qui tourne. */
  badgeLabel?: (label: string, count: number) => string
  /** En `caution`, le décompte dit que quelqu'un attend, et non que quelque chose tourne. */
  badgeTone?: 'accent' | 'caution'
  /** Garde son nom à l'étroit quand il est actif : le cas du panneau qui recouvre. */
  keepLabel?: boolean
  onSelect: () => void
}) {
  const t = useTranslate()
  return (
    <TooltipButton
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      // Le nom reste porté par le bouton même quand il n'est plus écrit : une icône
      // seule ne dit pas ce qu'elle ouvre, ni à l'œil ni à un lecteur d'écran.
      aria-label={badge > 0 ? (badgeLabel ? badgeLabel(label, badge) : t('panel.tab.badge', { label, count: badge })) : label}
      title={label}
      className={cx(
        'flex h-11 min-w-11 shrink-0 items-center justify-center gap-1.5 rounded-md px-2 text-xs font-medium transition-colors md:h-8 md:min-w-0 pointer-coarse:h-11 pointer-coarse:min-w-11',
        active ? 'bg-accent-wash text-ink' : 'text-ink-faint hover:text-ink',
      )}
    >
      <span className="shrink-0">{icon}</span>
      {/* Jamais cachés par principe : ils tombent quand la place manque, et tous à la
          fois, pour que la rangée ne change pas de forme à chaque choix. */}
      <span className={cx(keepLabel && active ? null : '@max-[38rem]:hidden')}>{label}</span>
      {/* Le décompte, lui, ne se replie jamais : c'est ce qui signale une activité
          dont on ne verrait sinon aucune trace, l'onglet étant fermé. */}
      {badge > 0 ? (
        <span className={cx(
          'flex size-4 shrink-0 items-center justify-center rounded-full text-micro font-semibold',
          badgeTone === 'caution' ? 'bg-caution/12 text-caution' : 'bg-accent text-accent-ink',
        )}>
          {badge}
        </span>
      ) : null}
    </TooltipButton>
  )
}
