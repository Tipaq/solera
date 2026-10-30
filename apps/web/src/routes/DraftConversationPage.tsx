import { History, SquareKanban, X } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  AGENT_CAPABILITIES,
  agentKindSchema,
  cardBranchName,
  type AgentConfig,
  type AgentKind,
} from '@solera/protocol'
import type { AgentSkillDto, McpServerStatus, SlashCommandDto } from '@solera/protocol'
import { AGENT_LABELS, AgentIcon } from '../components/AgentIcon'
import { Composer } from '../components/chat/Composer'
import { HeaderBand } from '../components/HeaderBand'
import { DraftAccount } from '../components/chat/DraftAccount'
import { DraftAgentPicker } from '../components/chat/DraftAgentPicker'
import { AgentLoginDialog } from '../components/settings/AgentLoginDialog'
import { Banner, Button, IconButton, cx } from '@solera/ui'
import { DestinationSelect } from '../components/DestinationSelect'
import { WorktreeSelect } from '../components/WorktreeSelect'
import { useCards } from '../lib/cards'
import { GUIDED_LOGIN } from '../lib/agent-login'
import {
  AGENT_AUTH_KEY,
  useAgentAuth,
  useAgentAvailability,
  useHiddenAgents,
  unavailableReason,
  versionMismatch,
} from '../lib/agents'
import { useClaudeAccounts } from '../lib/claude-accounts'
import { useCodexAccounts } from '../lib/codex-accounts'
import { useGrokAccounts } from '../lib/grok-accounts'
import { usageAccountOf } from '../lib/usage'
import { useUsagePeek } from '../lib/usage-peek'
import { useClaudeSessions, useImportClaudeSession } from '../lib/claude-sessions'
import { useProjectCommands } from '../lib/commands'
import { useFileDrop } from '../lib/file-drop'
import { useAllConversations, useCreateConversation } from '../lib/conversations'
import { useProjects } from '../lib/projects'
import { locale, useTranslate } from '../lib/i18n'
import { openSettings } from '../lib/settings-dialog'
import { useCurrentUser } from '../lib/session'
import { inheritedConfigFor, useUserSettings } from '../lib/user-settings'
import { uuidv4 } from '../lib/uuid'


/** Jour et heure courts : assez pour situer une session, sans manger la ligne. */
function formatDay(ts: number): string {
  return new Date(ts).toLocaleString(locale(), {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/**
 * Conversation pas encore créée.
 *
 * Rien n'est écrit en base tant qu'aucun message n'a été envoyé : cliquer sur « + »
 * ne doit pas laisser un fil vide et sans titre dans la liste. La création et le
 * premier message partent ensemble, et c'est ce premier tour qui donne son titre à la
 * conversation.
 */
const NO_MCP_INVENTORY: McpServerStatus[] = []
const NO_COMMANDS: SlashCommandDto[] = []
const NO_SKILLS: AgentSkillDto[] = []
/** Rien à interrompre avant le premier envoi ; une seule instance, pour le composer mémoïsé. */
const NO_INTERRUPT = () => {}

/**
 * Le nombre de comptes supplémentaires prêts, par CLI : un seul suffit pour qu'un CLI
 * sans connexion propre reste utilisable. Listes déjà en cache pour le composer.
 */
function useExtraAccounts(): Record<AgentKind, number> {
  const { data: claude } = useClaudeAccounts()
  const { data: codex } = useCodexAccounts()
  const { data: grok } = useGrokAccounts()
  return {
    claude: claude?.accounts.length ?? 0,
    codex: codex?.accounts.filter((account) => account.status === 'ready').length ?? 0,
    grok: grok?.accounts.filter((account) => account.status === 'ready').length ?? 0,
    opencode: 0,
  }
}

type GuidedAgent = 'claude' | 'codex' | 'grok'
const isGuided = (kind: AgentKind): kind is GuidedAgent => GUIDED_LOGIN.has(kind)

/**
 * Se connecter depuis le brouillon, sans passer par les réglages : la carte d'un CLI
 * sans connexion ouvre le dialogue guidé, et une installation lancée d'ici enchaîne sur
 * lui quand le CLI arrive sans connexion. Seul l'administrateur mène la connexion du CLI,
 * qui vaut pour toute l'instance ; les autres, et OpenCode, gardent l'onglet des réglages.
 */
function useDraftSignIn(unusable: (kind: AgentKind) => boolean) {
  const queryClient = useQueryClient()
  const { data: me } = useCurrentUser()
  const { data: availability } = useAgentAvailability()
  const [signingIn, setSigningIn] = useState<GuidedAgent | null>(null)
  /** Le CLI installé depuis cette page, dont on attend l'arrivée pour lire sa connexion. */
  const [installed, setInstalled] = useState<AgentKind | null>(null)
  const authAsked = useRef(false)
  /** Vrai une fois la connexion relue après l'installation : `unusable` la voit alors. */
  const [authRead, setAuthRead] = useState(false)

  const guided = (kind: AgentKind): kind is GuidedAgent => isGuided(kind) && me?.isAdmin === true
  const signIn = (kind: AgentKind) => {
    if (guided(kind)) setSigningIn(kind)
    else openSettings('agents', kind)
  }

  const entry = installed ? availability?.agents.find((item) => item.agent === installed) : undefined
  const failed = entry?.install.status === 'failed'
  const arrived = entry?.installed === true
  // Lu au rendu qui suit la relecture de la connexion, avec ce qu'elle a rapporté.
  const chain = installed !== null && guided(installed) && unusable(installed)
  useEffect(() => {
    if (!installed) return
    if (failed) return setInstalled(null)
    if (!arrived) return
    // Le serveur ne lisait pas la connexion d'un CLI absent : on la redemande une fois.
    if (!authAsked.current) {
      authAsked.current = true
      void queryClient.invalidateQueries({ queryKey: AGENT_AUTH_KEY }).then(() => setAuthRead(true))
      return
    }
    if (!authRead) return
    setInstalled(null)
    setAuthRead(false)
    if (chain && isGuided(installed)) setSigningIn(installed)
  }, [installed, failed, arrived, authRead, chain, queryClient])

  return {
    signingIn,
    signIn,
    afterInstall: (kind: AgentKind) => {
      authAsked.current = false
      setInstalled(kind)
    },
    close: () => setSigningIn(null),
  }
}

export function DraftConversationPage() {
  const { projectId } = useParams()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const { data: conversations } = useAllConversations()
  const createConversation = useCreateConversation(projectId ?? null)

  // Valeur de départ seulement : le CLI reste modifiable tant que rien n'est envoyé.
  // Sans ça, le « + » de la sidebar enfermerait sur le CLI du dernier fil.
  const requested = agentKindSchema.safeParse(params.get('agent'))
  const suggested: AgentKind = requested.success
    ? requested.data
    : (conversations?.find((c) => c.projectId === projectId)?.agent ?? 'claude')

  const [chosenAgent, setChosenAgent] = useState<AgentKind | null>(null)
  const { data: availability } = useAgentAvailability()
  const t = useTranslate()
  // Les CLI masqués par le compte ne sont pas proposés à l'installation tant qu'ils
  // manquent : qui n'utilise que Claude Code n'a pas à les enjamber.
  const hiddenAgents = useHiddenAgents()
  const { data: auth } = useAgentAuth()
  const { data: peek } = useUsagePeek()
  const extraAccounts = useExtraAccounts()

  /**
   * Installé mais sans connexion : la pastille se grise, sauf si un compte
   * supplémentaire prêt peut porter la session à la place de la connexion du CLI.
   * Une connexion `unknown` ne grise rien — mieux vaut un échec au premier tour qu'un
   * agent utilisable refusé sur une sonde muette.
   */
  const loggedOut = (kind: AgentKind) =>
    auth?.entries.find((entry) => entry.agent === kind && entry.account === null)?.status === 'logged_out'
  const unusable = (kind: AgentKind) => loggedOut(kind) && extraAccounts[kind] === 0
  const draftSignIn = useDraftSignIn(unusable)

  // La suggestion se replie sur un CLI installé. Sans ça le formulaire s'ouvrirait sur
  // une carte grisée, et l'envoi resterait possible puisque le grisage ne bloque que le
  // clic : le CLI par défaut est « claude » ou celui du dernier fil du projet, deux
  // valeurs qui ne savent rien de ce qui est réellement installé.
  //
  // Un choix explicite n'est jamais réécrit, lui : ni le clic de l'utilisateur, ni le
  // `?agent=` de l'URL. Basculer sous les doigts de quelqu'un qui vient de désigner un
  // CLI serait pire que de le laisser voir qu'il manque.
  const installed = (kind: AgentKind) =>
    availability?.agents.find((a) => a.agent === kind)?.installed !== false && !unusable(kind)
  const fallback = availability?.agents.find((a) => a.installed && !unusable(a.agent))?.agent
  const agent =
    chosenAgent ?? (requested.success || installed(suggested) ? suggested : (fallback ?? suggested))

  const selectedAvailability = availability?.agents.find((a) => a.agent === agent)
  const blocked = unavailableReason(selectedAvailability)
    ?? (unusable(agent) ? t('draft.agent.loggedOut', { label: AGENT_LABELS[agent] }) : null)
  const selectedVersionNotice = versionMismatch(selectedAvailability)

  const [config, setConfig] = useState<AgentConfig | null>(null)
  const { data: projects } = useProjects()
  const project = projects?.find((p) => p.id === projectId)

  // Le board ouvre ce brouillon avec sa carte. Rien n'est rattaché tant que rien n'est
  // envoyé : c'est une valeur de départ, comme le CLI, et la puce se retire.
  const [detached, setDetached] = useState(false)
  const { data: cards } = useCards(projectId)
  // `?split=` ouvre un découpage en cartes (#70) : `new` pour un chantier neuf, ou l'id
  // de la carte à découper. La conversation part alors à la racine, sans arbre, et la
  // carte n'est pas rattachée — elle sera la parente du brouillon, pas un travail engagé.
  const split = params.get('split')
  const splitting = split !== null && Boolean(projectId)
  const requestedCard = splitting ? (split === 'new' ? null : split) : params.get('card')
  const pickedCard = detached ? undefined : cards?.find((entry) => entry.id === requestedCard)
  const card = splitting ? undefined : pickedCard
  const splitCard = splitting ? pickedCard : undefined
  /**
   * Le composer lit son texte initial une seule fois, au montage. Le rendre avant que
   * la carte soit connue le figerait sans sa mention, et la poser après n'y changerait
   * plus rien : on attend donc la réponse plutôt que de remonter le composant, ce qui
   * effacerait ce qui aurait été tapé entre-temps.
   */
  const cardPending = Boolean(requestedCard) && !detached && cards === undefined

  // Le worktree déjà rattaché à la carte, s'il y en a un : reprendre un chantier doit
  // retomber dans le bon arbre sans y penser. Le plus récent l'emporte, une carte ayant
  // pu changer de branche en route.
  const cardWorktree = card?.conversations.findLast((session) => session.worktreeId)?.worktreeId
  // `?worktree=` ouvre le brouillon dans un arbre déjà là : « Reprendre » un arbre sans
  // session, depuis l'Activité groupée par worktree (#111).
  const [worktreeId, setWorktreeId] = useState<string | null>(() => params.get('worktree'))
  const [worktreeTouched, setWorktreeTouched] = useState(false)
  const effectiveWorktreeId = splitting
    ? null
    : worktreeTouched || params.has('worktree')
      ? worktreeId
      : (cardWorktree ?? worktreeId)

  // Ce que le fil héritera, champ par champ : le compte, puis le projet (#120). Les
  // défauts du protocole tant que rien n'est chargé : ils ne sont qu'un point de départ
  // le temps d'un aller-retour, et rien n'est envoyé avant le premier message. Le serveur
  // ne retiendra de la configuration envoyée que ce que le brouillon aura changé.
  const { data: userSettings } = useUserSettings()
  // Mémoïsé : une configuration neuve à chaque rendu changerait celle du composer, et
  // casserait sa mémoïsation.
  const defaults = useMemo(() => inheritedConfigFor(agent, userSettings, project), [agent, userSettings, project])
  // Une configuration Claude n'a aucun sens pour Codex : elle est abandonnée dès que
  // le CLI change, plutôt que conservée et rejetée par le serveur.
  const effective = useMemo(
    () => (config?.agent === agent ? config : defaults),
    [config, agent, defaults],
  )

  // Chargées seulement quand le CLI retenu persiste des sessions locales relisibles.
  // Un worktree écarte la liste : ces sessions vivent dans le dossier racine du projet.
  const { data: cliSessions, error: cliSessionsError } = useClaudeSessions(
    projectId,
    AGENT_CAPABILITIES[agent].cliSessions && !effectiveWorktreeId,
  )
  const cliSessionList = effectiveWorktreeId ? [] : (cliSessions?.sessions ?? [])
  const importSession = useImportClaudeSession(projectId ?? '')

  // Les commandes en `/` du CLI retenu, lues dans le dossier visé : sans elles, taper
  // `/` ici n'ouvrait rien, et il fallait un premier tour pour en voir la liste.
  //
  // Pas avant de savoir que le CLI est installé (`blocked` vaut aussi null tant que la
  // disponibilité n'est pas chargée), ni avant de connaître le dossier : une carte
  // peut désigner un worktree, et sonder la racine en attendant serait un CLI lancé
  // pour rien. Le composer, de toute façon, n'est pas encore rendu à ce moment-là.
  const { data: projectCommands, error: commandsError } = useProjectCommands(
    projectId,
    agent,
    effectiveWorktreeId,
    AGENT_CAPABILITIES[agent].draftCommands &&
      availability !== undefined &&
      blocked === null &&
      !cardPending,
  )

  const importAndOpen = async (sessionId: string) => {
    const created = await importSession.mutateAsync(sessionId)
    navigate(`/p/${projectId}/c/${created.id}`, { replace: true })
  }

  // Le dépôt suit l'état du composer : sans lui (carte en chargement) ou sans CLI,
  // les fichiers n'auraient nulle part où aller.
  const drop = useFileDrop(!cardPending && blocked === null)

  // Stable tant que ce qu'il envoie ne change pas : le composer est mémoïsé.
  const createAsync = createConversation.mutateAsync
  const send = useCallback(async (
    text: string,
    attachmentIds: string[],
    mentions: string[],
    skills: string[],
  ) => {
    const created = await createAsync({
      agent,
      config: effective,
      worktreeId: effectiveWorktreeId,
      cardId: card?.id ?? null,
      ...(splitting ? { purpose: 'split' as const, splitCardId: splitCard?.id ?? null } : {}),
      // Le titre de la carte plutôt que l'extrait du message : la conversation traite
      // un travail nommé, et le CLI n'a plus à en proposer un.
      title: card?.title ?? (splitCard ? t('split.sessionTitle', { title: splitCard.title }) : undefined),
      firstMessage: { clientMessageId: uuidv4(), text, attachmentIds, mentions, skills },
    })

    // `replace` : revenir en arrière ne doit pas ramener sur un brouillon qui n'a
    // plus lieu d'être.
    navigate(projectId ? `/p/${projectId}/c/${created.id}` : `/c/${created.id}`, {
      replace: true,
    })
  }, [createAsync, agent, effective, effectiveWorktreeId, card, splitting, splitCard, t, navigate, projectId])

  return (
    // `relative` : c'est ce conteneur qui ancre le panneau latéral, posé en absolu.
    <div className="relative flex h-full flex-col overflow-clip pb-safe" {...drop.handlers}>
      {/* Même voile que sur une conversation : le composer écoute déjà les dépôts, il
          manquait seulement une zone qui les lui transmette. */}
      {drop.dragging ? (
        <div
          className={cx(
            'pointer-events-none absolute inset-2 z-30 flex items-center justify-center',
            'rounded-xl border-2 border-dashed border-accent bg-canvas/80 text-sm text-accent',
          )}
        >
          {t('conversation.drop.attach')}
        </div>
      ) : null}
      <HeaderBand>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-xs text-ink-faint">
            <AgentIcon agent={agent} size={11} />
            <span className="truncate">{project?.name ?? t('destination.none')}</span>
          </div>
          <p className="truncate text-sm font-medium">{t(splitting ? 'split.draft.title' : 'draft.title')}</p>
        </div>
        {/* Le board depuis le brouillon : c'est ici qu'on se demande sur quoi partir,
            et la liste des cartes est la réponse. Le lien manque à cet endroit précis
            quand on ouvre une conversation avant d'avoir choisi son chantier. */}
        {projectId ? (
          <Button
            variant="ghost"
            size="sm"
            icon={<SquareKanban size={14} />}
            onClick={() => navigate(`/p/${projectId}/board`)}
          >
            {t('draft.board')}
          </Button>
        ) : null}
        {/* Pas de panneau tant que rien n'a été envoyé. Il ouvrait le workspace du
            projet avant même qu'une session existe — mais cette page ne pose qu'une
            question, « sur quoi part-on ? », et un explorateur de fichiers n'y répond
            pas. Le bouton est retiré plutôt que désactivé : une cible morte dans une
            bande qui n'en compte que trois se remarque plus que son absence. */}
      </HeaderBand>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex sg-conversation-width flex-col gap-4 px-4 py-6 md:py-10">
          {/* Le titre est déjà dans la bande : la page n'en répète que ce qui explique
              un découpage, qui ne se devine pas. */}
          {splitting ? <p className="text-sm text-ink-faint">{t('split.draft.subtitle')}</p> : null}

          {/* Premier contrôle de la page : c'est lui qui fait apparaître ou disparaître
              le reste. Changer de destination change d'URL plutôt que d'état local —
              tout ce qui suit est lu par projet (worktrees, cartes, sessions du dossier,
              préréglages), et une page qui reste sur `/p/<ancien>` pendant que le
              formulaire parle d'un autre projet finit par en mélanger deux.

              La branche à côté, et non en dessous : les deux disent le même chose — où
              l'on travaille — et l'une n'existe que si l'autre est remplie. */}
          <div className="grid gap-3 sm:grid-cols-2">
            <DestinationSelect
              value={projectId ?? null}
              disabled={createConversation.isPending}
              onChange={(next) => {
                const search = params.get('agent') ? `?agent=${params.get('agent')}` : ''
                navigate(next ? `/p/${next}/c/new${search}` : `/c/new${search}`, { replace: true })
              }}
            />
            {projectId && !splitting ? (
              <WorktreeSelect
                projectId={projectId}
                value={effectiveWorktreeId}
                onChange={(next) => {
                  setWorktreeTouched(true)
                  setWorktreeId(next)
                }}
                isRepository={project?.git !== null && project !== undefined}
                suggestedName={card ? cardBranchName(card.number, card.title) : undefined}
                cardId={card?.id}
              />
            ) : null}
          </div>

          <DraftAgentPicker
            value={agent}
            onChange={setChosenAgent}
            availability={availability?.agents}
            stateOf={(kind) =>
              availability?.agents.find((a) => a.agent === kind)?.installed === false
                ? 'missing'
                : unusable(kind) ? 'loggedOut' : 'ready'}
            accountOf={(kind) => (kind === agent ? usageAccountOf(effective) : null)}
            peek={peek}
            hidden={hiddenAgents.hidden}
            onHide={hiddenAgents.hide}
            onSignIn={draftSignIn.signIn}
            onInstall={draftSignIn.afterInstall}
          />
          {draftSignIn.signingIn ? (
            <AgentLoginDialog
              agent={draftSignIn.signingIn}
              entry={availability?.agents.find((a) => a.agent === draftSignIn.signingIn)}
              open
              onClose={draftSignIn.close}
              // Connecté, il devient le CLI de la conversation : on peut écrire aussitôt.
              onDone={() => setChosenAgent(draftSignIn.signingIn)}
            />
          ) : null}
          {selectedVersionNotice ? <p className="-mt-2 text-xs text-caution">{selectedVersionNotice}</p> : null}
          {/* Le cas où aucun CLI n'est prêt, et celui d'un `?agent=` qui en désigne un
              absent ou sans connexion : les cartes seules laisseraient l'écran sans
              explication de ce que la barre de saisie refuse. */}
          {blocked ? <Banner>{blocked}</Banner> : null}

          {/* Juste sous le CLI : c'est la même question, avec quoi la session part. */}
          {blocked === null ? (
            <DraftAccount
              config={effective}
              onChange={setConfig}
              disabled={createConversation.isPending}
              auth={auth?.entries.find((entry) => entry.agent === agent && entry.account === null)}
              peek={peek}
            />
          ) : null}

          {/* Le 502 de la sonde dit que le CLI n'a pas répondu ; le taire laisserait
              croire qu'il n'y a simplement aucune commande dans ce dossier. */}
          {commandsError ? (
            <p className="text-xs text-ink-faint">{t('draft.commands.unavailable')}</p>
          ) : null}

          {splitCard ? (
            <div className="flex items-center gap-2 rounded-md border border-line bg-sunken px-3 py-2">
              <span className="shrink-0 text-xs text-ink-faint">{t('split.draft.from')}</span>
              <span className="text-xs font-medium text-ink-faint">#{splitCard.number}</span>
              <span className="min-w-0 flex-1 truncate text-sm text-ink-soft">{splitCard.title}</span>
              <IconButton label={t('split.draft.detach')} onClick={() => setDetached(true)}>
                <X size={14} />
              </IconButton>
            </div>
          ) : null}

          {card ? (
            <div className="flex items-center gap-2 rounded-md border border-line bg-sunken px-3 py-2">
              <span className="text-xs font-medium text-ink-faint">#{card.number}</span>
              <span className="min-w-0 flex-1 truncate text-sm text-ink-soft">{card.title}</span>
              <IconButton label={t('draft.card.detach')} onClick={() => setDetached(true)}>
                <X size={14} />
              </IconButton>
            </div>
          ) : null}

          {cardPending ? null : (
            <Composer
              variant="draft"
              // Le brouillon d'une conversation pas encore créée appartient à son projet :
              // c'est le seul fil qu'on puisse en désigner avant qu'il existe. Un brouillon
              // par carte, sinon celui de la création libre écraserait la mention posée ici.
              draftKey={
                card
                  ? `new:${projectId ?? ''}:card:${card.id}`
                  : splitting
                    ? `new:${projectId ?? ''}:split:${splitCard?.id ?? 'new'}`
                    : `new:${projectId ?? ''}`
              }
              // Une phrase et pas le seul numéro : « #5 » tout seul a déjà été lu comme le
              // cinquième élément d'une liste par un CLI qui ne connaissait pas la carte.
              initialText={card ? `${t('draft.card.prompt', { number: card.number })} ` : ''}
              config={effective}
              // Rien n'est encore lancé : aucun CLI n'a d'inventaire MCP ni de compétences à
              // rapporter ; ils arriveront au premier tour. Les commandes en `/`, elles, se
              // lisent sans session là où le CLI le permet (`draftCommands`). Le composer
              // écarte lui-même celles que Solera exécute (`/compact`) : sans fil, pas de
              // plomberie pour les porter.
              mcpInventory={NO_MCP_INVENTORY}
              commands={projectCommands?.commands ?? NO_COMMANDS}
              skills={NO_SKILLS}
              status="idle"
              // Un CLI absent ne se rattrape pas côté serveur : le tour échouerait après
              // création de la conversation, laissant un fil vide et un message perdu.
              disabled={createConversation.isPending || blocked !== null}
              onSend={send}
              onInterrupt={NO_INTERRUPT}
              onConfigChange={setConfig}
              projectId={projectId}
              worktreeId={effectiveWorktreeId}
            />
          )}

          {/* Sessions commencées au CLI dans ce dossier : plutôt qu'une nouvelle
              conversation, on peut adopter l'une d'elles. Importer ne copie rien,
              c'est la même session, qui reste reprenable avec `claude --resume`. */}
          {/* Une liste qui n'arrive pas se dit : sans ça, l'erreur ressemblait à
              « aucune session », et rien ne permettait de la distinguer. */}
          {AGENT_CAPABILITIES[agent].cliSessions && !effectiveWorktreeId && cliSessionsError ? (
            <Banner>
              {cliSessionsError instanceof Error
                ? cliSessionsError.message
                : t('draft.cliSessions.error')}
            </Banner>
          ) : null}
          {AGENT_CAPABILITIES[agent].cliSessions && cliSessionList.length > 0 ? (
            <details className="rounded-lg border border-line px-3 pb-2">
              <summary className="cursor-pointer py-3 text-xs font-medium text-ink-soft">
                {t('draft.cliSessions.title', { label: AGENT_LABELS[agent] })}
              </summary>
              <p className="mb-2 text-xs leading-snug text-ink-faint">
                {t('draft.cliSessions.description')}
              </p>
              <div className="flex max-h-72 flex-col gap-1.5 overflow-y-auto">
                {cliSessionList.map((session) => (
                  <button
                    key={session.sessionId}
                    type="button"
                    disabled={importSession.isPending}
                    onClick={() => void importAndOpen(session.sessionId)}
                    className="flex items-center gap-2.5 rounded-md border border-line px-3 py-2 text-left transition-colors hover:border-line-strong hover:bg-surface-high disabled:opacity-60"
                  >
                    <History size={16} className="shrink-0 text-ink-faint" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-ink">{session.title}</span>
                      {session.firstPrompt && session.firstPrompt !== session.title ? (
                        <span className="block truncate text-xs text-ink-faint">
                          {session.firstPrompt}
                        </span>
                      ) : null}
                    </span>
                    <span className="shrink-0 text-right text-meta leading-tight text-ink-faint">
                      <time dateTime={new Date(session.lastModified).toISOString()}>
                        {formatDay(session.lastModified)}
                      </time>
                      {session.gitBranch ? (
                        <span className="block max-w-32 truncate">{session.gitBranch}</span>
                      ) : null}
                    </span>
                  </button>
                ))}
              </div>
              {importSession.isError ? (
                <Banner>
                  {importSession.error instanceof Error
                    ? importSession.error.message
                    : t('draft.import.error')}
                </Banner>
              ) : null}
            </details>
          ) : null}
        </div>
      </div>
    </div>
  )
}
