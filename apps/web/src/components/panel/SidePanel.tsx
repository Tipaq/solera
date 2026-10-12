import { TooltipButton } from '@solera/ui'
import { Bot, ChevronLeft, FileCode, GitCompare, Search, SquareTerminal, X } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { AgentKind } from '@solera/protocol'
import type { BackgroundWork } from '../../lib/background'
import type { EditTurn } from '../../lib/chat-fold'
import { openTab } from '../../lib/editor-tabs'
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
import { IconButton, cx } from '@solera/ui'
import { AgentsPane } from './AgentsPane'
import { FilesPane } from './FilesPane'
import { GitPane } from './GitPane'
import { SearchPane } from './SearchPane'
import { TerminalsPane } from './TerminalsPane'
import { QuickOpen } from './QuickOpen'
import { HeaderBand } from '../HeaderBand'

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
 */
export function SidePanel({
  projectId,
  conversationId,
  agent,
  editTurns = [],
  turnRunning = false,
  subAgents = [],
  background = [],
  open,
  docked = false,
  canDock = false,
  workspaceName,
}: {
  projectId: string
  /** Absente en vue projet : le panneau se réduit alors aux onglets de répertoire. */
  conversationId?: string
  /** CLI de la conversation, pour les gestes que seuls certains CLI savent faire. */
  agent?: AgentKind
  editTurns?: EditTurn[]
  turnRunning?: boolean
  subAgents?: SubAgent[]
  background?: BackgroundWork[]
  /** Faux pendant la sortie : le panneau est encore monté, mais s'en va. */
  open: boolean
  docked?: boolean
  canDock?: boolean
  workspaceName?: string
}) {
  // L'onglet vit hors du panneau : le fil le pilote, en ouvrant un fichier depuis un
  // diff comme en désignant un sous-agent depuis le bandeau.
  const t = useTranslate()
  const scope = conversationId ?? projectScope(projectId)
  const { data: projects } = useProjects()
  const projectName = projects?.find((project) => project.id === projectId)?.name
  const workspaceLabel = [projectName, workspaceName ?? t('terminal.dir.workspace')].filter(Boolean).join(' · ')
  const chosenTab = usePanelTab()
  // L'onglet choisi survit d'une vue à l'autre ; en vue projet, un onglet de session
  // retombe sur les fichiers plutôt que d'afficher un panneau vide.
  const tab: PanelTab = conversationId || chosenTab !== 'agents' ? chosenTab : 'files'
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

  /** Ouvrir un fichier depuis un diff : l'onglet naît sous les yeux de qui l'a demandé. */
  const openInFiles = (path: string) => {
    openTab(scope, path)
    setPanelTab('files')
    // Ouvrir depuis une palette ou un diff doit montrer le fichier sur téléphone.
    if ((aside.current?.clientWidth ?? 0) < 560) setPanelTree(false, false)
  }

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
          {/* La maquette du téléphone montre un retour *et* une croix. Les deux
              feraient la même chose hors plein écran — revenir au fil, c'est fermer le
              panneau — et deux boutons pour un geste se lisent comme deux gestes. Le
              retour ne sert donc qu'à sortir du plein écran, qui a bien un état
              intermédiaire où revenir. */}
          {fullscreen ? (
            <IconButton label={t('panel.fullscreen.exit')} onClick={() => setFullscreen(false)}>
              <ChevronLeft size={18} />
            </IconButton>
          ) : null}
          <span className="min-w-0 flex-1 truncate text-sm font-medium" title={workspaceLabel}>
            {workspaceLabel}
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
        hasConversation={Boolean(conversationId)}
        agentBadge={subAgents.filter((entry) => entry.status === 'running').length + background.length}
      />

      {/* Monté même quand un autre onglet est devant : revenir aux fichiers ne doit
          replier ni l'arborescence, ni perdre sa position de défilement, ni faire
          relire son fichier à l'éditeur. */}
      <div
        className={cx(
          'min-h-0 min-w-0 flex-1 overflow-hidden pb-safe',
          tab === 'files' ? 'flex' : 'hidden',
        )}
      >
        <FilesPane scope={scope} label={workspaceLabel} />
      </div>

      {/* Deux vues montées seulement quand on les regarde : leur contenu vient du
          journal ou d'une lecture git relancée à l'affichage, rien ne s'y perd. */}
      {tab === 'git' ? (
        <GitPane scope={scope} turnRunning={turnRunning} onOpenFile={openInFiles} />
      ) : null}

      {/* Montée même derrière une autre vue, comme les fichiers : cliquer un résultat
          bascule sur l'éditeur, et revenir à la recherche doit retrouver la frappe,
          les drapeaux, les filtres et les résultats — pas un champ vide. */}
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

      {/* Monté dès que le panneau existe, et non seulement quand l'onglet est actif :
          un shell qui compile ne doit pas être coupé parce qu'on regarde le diff. */}
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
}

/**
 * Les cinq vues, dans la bande.
 *
 * Elles sont nommées tant qu'il y a la place, et les noms tombent **tous ensemble**
 * sous 30 rem : une rangée où seul l'onglet actif garde son nom change de largeur à
 * chaque choix, et les quatre autres deviennent des devinettes. Quand le panneau
 * recouvre l'écran, l'actif garde le sien — la bande au-dessus dit déjà où l'on est,
 * mais c'est le seul repère écrit qui reste de la vue elle-même.
 *
 * Le trait sépare les quatre vues du répertoire de la seule qui regarde la session.
 */
function ViewBar({ band, closable, tab, hasConversation, agentBadge }: {
  /** Vrai quand cette rangée *est* le segment de bande du panneau, à sa hauteur. */
  band: boolean
  /** Le panneau recouvre le bouton du fil : il porte alors sa propre fermeture. */
  closable: boolean
  tab: PanelTab
  hasConversation: boolean
  agentBadge: number
}) {
  const t = useTranslate()
  const views = (
    <>
      <Tab icon={<FileCode size={15} />} label={t('panel.tab.files')} keepLabel={!band}
        active={tab === 'files'} onSelect={() => setPanelTab('files')} />
      <Tab icon={<Search size={15} />} label={t('panel.tab.search')} keepLabel={!band}
        active={tab === 'search'} onSelect={() => setPanelTab('search')} />
      <Tab icon={<GitCompare size={15} />} label={t('panel.tab.git')} keepLabel={!band}
        active={tab === 'git'} onSelect={() => setPanelTab('git')} />
      <Tab icon={<SquareTerminal size={15} />} label={t('panel.tab.terminals')} keepLabel={!band}
        active={tab === 'terminals'} onSelect={() => setPanelTab('terminals')} />
      {hasConversation ? (
        <>
          <span aria-hidden className="mx-1 h-5 w-px shrink-0 bg-line" />
          <Tab icon={<Bot size={15} />} label={t('panel.tab.agents')} keepLabel={!band}
            badge={agentBadge} active={tab === 'agents'} onSelect={() => setPanelTab('agents')} />
        </>
      ) : null}
    </>
  )

  // La liste défile plutôt que de pousser les vues hors du cadre : sous 30 rem elles
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
  keepLabel = false,
  onSelect,
}: {
  icon: ReactNode
  label: string
  active: boolean
  /** Décompte affiché sur l'onglet. Zéro n'affiche rien. */
  badge?: number
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
      aria-label={badge > 0 ? t('panel.tab.badge', { label, count: badge }) : label}
      title={label}
      className={cx(
        'flex h-11 min-w-11 shrink-0 items-center justify-center gap-1.5 rounded-md px-2 text-xs font-medium transition-colors md:h-8 md:min-w-0 pointer-coarse:h-11 pointer-coarse:min-w-11',
        active ? 'bg-accent-wash text-ink' : 'text-ink-faint hover:text-ink',
      )}
    >
      <span className="shrink-0">{icon}</span>
      {/* Jamais cachés par principe : ils tombent quand la place manque, et tous à la
          fois, pour que la rangée ne change pas de forme à chaque choix. */}
      <span className={cx(keepLabel && active ? null : '@max-[30rem]:hidden')}>{label}</span>
      {/* Le décompte, lui, ne se replie jamais : c'est ce qui signale une activité
          dont on ne verrait sinon aucune trace, l'onglet étant fermé. */}
      {badge > 0 ? (
        <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-accent text-micro font-semibold text-accent-ink">
          {badge}
        </span>
      ) : null}
    </TooltipButton>
  )
}
