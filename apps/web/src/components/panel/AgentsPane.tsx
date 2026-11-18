import { AGENT_CAPABILITIES, type AgentKind } from '@solera/protocol'
import {
  Button,
  IconButton,
  PanelEmpty,
  PanelGroup,
  PanelNotice,
  PanelStatusIcon,
  StackHeader,
  cx,
  panelGestureClass,
  panelRowClass,
  type StatusTone,
} from '@solera/ui'
import { Bot, ChevronRight, Copy, CornerUpLeft, FileDiff, GitBranch, MessageSquare, Send, Square, Users, Wand2 } from 'lucide-react'
import { memo, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  agentGroups,
  agentMeta,
  filesOf,
  modelLabel,
  resultOf,
  sessionFiles,
  toolCount,
  treeRows,
  workPort,
  workSeed,
  type AgentNode,
  type SessionFile,
} from '../../lib/agent-files'
import { formatDuration } from '../../lib/automations'
import type { BackgroundWork } from '../../lib/background'
import type { EditTurn } from '../../lib/chat-fold'
import { copyText } from '../../lib/clipboard'
import { interruptConversation, sendMessage, stopBackgroundTask } from '../../lib/conversations'
import { useLiveStatus } from '../../lib/conversation-status'
import { conversationPath } from '../../lib/conversation-route'
import { useEscapeLayer } from '../../lib/escape-layers'
import { useTranslate } from '../../lib/i18n'
import { useNow } from '../../lib/now'
import { clearSubAgent, requestActionEdit, setPanelOpen, setPanelTab, showSubAgent } from '../../lib/panel'
import { familyOf, familyWord } from '../../lib/session-works'
import { subAgentLabel, type SubAgent } from '../../lib/subagents'
import { teammateTone, type Teammate } from '../../lib/teammates'
import { formatTokens } from '../../lib/tokens'
import { buildRows } from '../../lib/tool-rows'
import { useMediaQuery } from '../../lib/viewport'
import { FamilyIcon, PortLink } from '../automations/session-works/parts'
import { ChatThread } from '../chat/ChatThread'

/**
 * L'onglet **Agent** du panneau (PAG-1 à PAG-7) : qu'est-ce qui tourne sous ce fil ?
 *
 * Pas de ligne d'outils ni de vues : **En cours** (sous-agents qui travaillent et travaux
 * de fond, mêlés), puis les terminés repliés en une ligne. Une ligne par élément, une
 * seule hauteur, au plus un geste au survol ; un clic ouvre le détail **en pile**
 * (« ‹ Agent ») — le fil d'un sous-agent, ou ce qu'on sait d'un travail de fond.
 *
 * Comme le panneau de Claude Code, un sous-agent lancé par un autre se range sous lui, et
 * une ligne qui en porte d'autres dit combien, `(+N)`, et se replie. Chaque ligne nomme le
 * modèle et l'effort que l'appel a demandés. Sous les sous-agents, les **coéquipiers** :
 * les sessions que celle-ci a lancées avec `start_session`.
 *
 * Les écritures sortent de la liste : le pied « Modifié par la session » les nomme avec
 * qui les a faites, et le détail d'un sous-agent montre les siennes. Le diff tour par tour
 * reste dans Git › tour.
 *
 * La couleur ne sert qu'aux points d'état : accent qui bat = travaille, vert = terminé,
 * rouge = arrêté.
 */
export const AgentsPane = memo(function AgentsPane({
  conversationId,
  title,
  agent,
  agents,
  background,
  editTurns,
  teammates = [],
  selectedId,
  hasGit = true,
  onOpenFile,
}: {
  conversationId: string
  /** Le titre de la conversation, que reprend la description d'une action qui en vient. */
  title?: string
  /** CLI de la conversation : c'est lui qui dit si un travail de fond s'arrête. */
  agent: AgentKind
  agents: SubAgent[]
  /** Travaux poursuivis hors du tour, sans fil à ouvrir : le CLI n'en transmet rien. */
  background: BackgroundWork[]
  /** Les tours qui ont écrit, pour le pied « Modifié par la session ». */
  editTurns: EditTurn[]
  /** Les sessions que celle-ci a lancées (`useTeammates`). */
  teammates?: Teammate[]
  selectedId: string | null
  /** Faux hors d'un dépôt : l'onglet Git n'existe pas, et rien n'y mène. */
  hasGit?: boolean
  onOpenFile: (path: string) => void
}) {
  const t = useTranslate()
  const pane = useRef<HTMLDivElement>(null)
  const [openWork, setOpenWork] = useState<string | null>(null)
  const [showDone, setShowDone] = useState(false)
  const [showFiles, setShowFiles] = useState(false)
  const [folded, setFolded] = useState<ReadonlySet<string>>(() => new Set())
  const toggle = (id: string) =>
    setFolded((current) => {
      const next = new Set(current)
      if (!next.delete(id)) next.add(id)
      return next
    })
  const selected = agents.find((entry) => entry.id === selectedId) ?? null
  // Un travail fini ou arrêté disparaît de la liste de niveau : son détail se referme.
  const work = selected ? null : (background.find((entry) => entry.id === openWork) ?? null)
  const { running, done } = useMemo(() => agentGroups(agents, background), [agents, background])
  const doneCount = done.reduce((sum, node) => sum + 1 + node.descendants, 0)
  const written = useMemo(() => sessionFiles(editTurns, agents), [editTurns, agents])
  const now = useNow(running.some((entry) => entry.kind === 'agent'))
  useEscapeLayer(selected !== null, clearSubAgent, pane)
  useEscapeLayer(work !== null, () => setOpenWork(null), pane)

  if (selected) {
    return (
      <div ref={pane} className="flex min-h-0 min-w-0 flex-1 flex-col">
        <SubAgentDetail
          key={selected.id}
          conversationId={conversationId}
          agent={selected}
          canMessage={AGENT_CAPABILITIES[agent].relaySubAgentMessage}
          hasGit={hasGit}
          onOpenFile={onOpenFile}
        />
      </div>
    )
  }
  if (work) {
    return (
      <div ref={pane} className="flex min-h-0 min-w-0 flex-1 flex-col">
        <WorkDetail
          key={work.id}
          conversationId={conversationId}
          conversationTitle={title || t('panel.agent.thisSession')}
          canStop={AGENT_CAPABILITIES[agent].stopBackgroundTask}
          work={work}
          onBack={() => setOpenWork(null)}
        />
      </div>
    )
  }

  return (
    <div ref={pane} className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto py-1.5">
        {running.length === 0 && teammates.length === 0 ? (
          <PanelEmpty>{t('panel.agent.empty')}</PanelEmpty>
        ) : null}
        {running.length > 0 ? (
          <section aria-label={t('panel.agent.group.running')}>
            <PanelGroup title={t('panel.agent.group.running')} />
            <ul>
              {running.map((entry) =>
                entry.kind === 'agent' ? (
                  <AgentTree key={entry.key} nodes={[entry.node]} folded={folded} onToggle={toggle} now={now} />
                ) : (
                  <WorkLine key={entry.key} work={entry.work} onOpen={() => setOpenWork(entry.work.id)} />
                ),
              )}
            </ul>
          </section>
        ) : null}

        {teammates.length > 0 ? (
          <section aria-label={t('panel.agent.group.teammates')} className={cx(running.length > 0 && 'mt-1.5')}>
            <PanelGroup title={t('panel.agent.group.teammates')} count={teammates.length} />
            <ul>
              {teammates.map((teammate) => (
                <TeammateLine key={teammate.id} teammate={teammate} />
              ))}
            </ul>
          </section>
        ) : null}

        {done.length > 0 ? (
          <div className="mt-1.5">
            <button
              type="button"
              aria-expanded={showDone}
              onClick={() => setShowDone((value) => !value)}
              className={cx(panelRowClass, 'gap-1.5 text-xs text-ink-faint hover:text-ink')}
            >
              {t(doneCount > 1 ? 'panel.agent.done.other' : 'panel.agent.done.one', { count: doneCount })}
              <ChevronRight size={13} aria-hidden className={cx('transition-transform', showDone && 'rotate-90')} />
            </button>
            {showDone ? (
              <ul>
                <AgentTree nodes={done} folded={folded} onToggle={toggle} now={now} />
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>

      {written.length > 0 ? (
        <div className="flex max-h-[45%] shrink-0 flex-col border-t border-line pb-safe">
          <button
            type="button"
            aria-expanded={showFiles}
            onClick={() => setShowFiles((value) => !value)}
            className={cx(panelRowClass, 'shrink-0 gap-1.5 text-xs text-ink-faint hover:text-ink')}
          >
            <ChevronRight size={13} aria-hidden className={cx('transition-transform', showFiles && 'rotate-90')} />
            {t(written.length > 1 ? 'panel.agent.files.title.other' : 'panel.agent.files.title.one', { count: written.length })}
          </button>
          {showFiles ? (
            <ul className="min-h-0 overflow-y-auto pb-1.5">
              {written.map((file) => (
                <SessionFileLine key={file.path} file={file} agents={agents} hasGit={hasGit} onOpenFile={onOpenFile} />
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  )
})

function agentTone(agent: SubAgent): StatusTone {
  if (agent.status === 'running') return 'accent'
  return agent.status === 'done' ? 'positive' : 'critical'
}

function AgentIconDot({ agent }: { agent: SubAgent }) {
  return <PanelStatusIcon icon={<Bot size={14} aria-hidden />} dot={agentTone(agent)} pulse={agent.status === 'running'} />
}

/** Un arbre de sous-agents à plat : une ligne par agent montré, en retrait selon sa profondeur. */
function AgentTree({
  nodes,
  folded,
  onToggle,
  now,
}: {
  nodes: AgentNode[]
  folded: ReadonlySet<string>
  onToggle: (id: string) => void
  now: number
}) {
  return (
    <>
      {treeRows(nodes, folded).map(({ node, depth }) => (
        <AgentLine
          key={node.agent.id}
          node={node}
          depth={depth}
          folded={folded.has(node.agent.id)}
          onToggle={() => onToggle(node.agent.id)}
          now={now}
        />
      ))}
    </>
  )
}

/** Le retrait d'un niveau de l'arbre, en pixels : celui de l'icône et de son écart. */
const TREE_INDENT = 16

/**
 * Une ligne de sous-agent : son état, son nom, le modèle et l'effort demandés, sa durée.
 * Une ligne qui en porte d'autres a un second geste, à part, pour les replier : `(+N)`.
 */
function AgentLine({
  node,
  depth,
  folded,
  onToggle,
  now,
}: {
  node: AgentNode
  depth: number
  folded: boolean
  onToggle: () => void
  now: number
}) {
  const t = useTranslate()
  const { agent, descendants } = node
  const label = subAgentLabel(agent)
  const model = modelLabel(agent)
  return (
    <li className="flex min-w-0 items-center">
      <button
        type="button"
        onClick={() => showSubAgent(agent.id)}
        className={cx(panelRowClass, 'min-w-0 flex-1')}
        style={depth > 0 ? { paddingLeft: 12 + depth * TREE_INDENT } : undefined}
      >
        <AgentIconDot agent={agent} />
        <span className="min-w-0 flex-1 truncate text-sm text-ink">{label}</span>
        {model ? <span className="min-w-0 max-w-[40%] truncate text-xs text-ink-faint">{model}</span> : null}
        <span className="shrink-0 text-xs tabular-nums text-ink-faint">{agentMeta(agent, now, t)}</span>
      </button>
      {descendants > 0 ? (
        <button
          type="button"
          aria-expanded={!folded}
          aria-label={t(folded ? 'panel.agent.tree.unfold' : 'panel.agent.tree.fold', { count: descendants, name: label })}
          onClick={onToggle}
          className={cx(panelGestureClass, 'shrink-0 gap-0.5 px-1.5 tabular-nums text-ink-faint')}
        >
          (+{descendants})
          <ChevronRight size={12} aria-hidden className={cx('transition-transform', !folded && 'rotate-90')} />
        </button>
      ) : null}
    </li>
  )
}

/** Une session lancée par celle-ci : son état en direct, sa carte, son worktree. Un clic l'ouvre. */
function TeammateLine({ teammate }: { teammate: Teammate }) {
  const t = useTranslate()
  const status = useLiveStatus(teammate.id) ?? teammate.status
  return (
    <li>
      <Link
        to={conversationPath(teammate)}
        title={teammate.card ? `#${teammate.card.number} ${teammate.card.title}` : undefined}
        className={panelRowClass}
      >
        <PanelStatusIcon icon={<Users size={14} aria-hidden />} dot={teammateTone(status)} pulse={status === 'running'} />
        <span className="min-w-0 flex-1 truncate text-sm text-ink">{teammate.title}</span>
        {teammate.card ? <span className="shrink-0 text-xs tabular-nums text-ink-faint">#{teammate.card.number}</span> : null}
        {teammate.worktree ? (
          <span className="flex min-w-0 max-w-[35%] items-center gap-1 text-xs text-ink-faint">
            <GitBranch size={11} aria-hidden className="shrink-0" />
            <span className="truncate">{teammate.worktree}</span>
          </span>
        ) : null}
        <span className="shrink-0 text-xs text-ink-faint">{t(`panel.agent.teammate.${status}`)}</span>
      </Link>
    </li>
  )
}

function WorkLine({ work, onOpen }: { work: BackgroundWork; onOpen: () => void }) {
  const t = useTranslate()
  const family = familyOf(work.kind)
  const port = workPort(work)
  const open = (event: KeyboardEvent) => {
    if (event.target !== event.currentTarget) return
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onOpen()
    }
  }
  return (
    <li>
      {/* Une ligne qui porte un lien : un `div` à rôle de bouton, pour ne pas imbriquer
          un lien dans un bouton. */}
      <div role="button" tabIndex={0} onClick={onOpen} onKeyDown={open} className={cx(panelRowClass, 'cursor-pointer')}>
        <PanelStatusIcon icon={<FamilyIcon family={family} size={14} />} dot="accent" pulse />
        <span className="min-w-0 flex-1 truncate text-sm text-ink">{work.description || work.kind}</span>
        {port !== null ? (
          <span onClick={(event) => event.stopPropagation()} className="hidden shrink-0 group-hover:inline-flex group-focus-within:inline-flex pointer-coarse:inline-flex">
            <PortLink
              port={port}
              label={t('panel.agent.open', { port })}
              className="inline-flex items-center gap-0.5 text-xs text-ink-soft underline-offset-2 hover:text-ink hover:underline"
            />
          </span>
        ) : null}
        <span
          className={cx(
            'shrink-0 text-xs tabular-nums text-ink-faint',
            port !== null && 'group-hover:hidden group-focus-within:hidden pointer-coarse:hidden',
          )}
        >
          {work.toolUses > 0 ? toolCount(work.toolUses, t) : familyWord(family, t)}
        </span>
      </div>
    </li>
  )
}

/** Le +/− d'un fichier, ou le nombre de passes quand les entrées ne le disent pas. */
function Delta({ added, removed, passes }: { added: number | null; removed: number | null; passes: number }) {
  const t = useTranslate()
  if (added === null || removed === null) {
    return (
      <span className="shrink-0 text-xs tabular-nums text-ink-faint">
        {t(passes > 1 ? 'panel.agent.files.passes.other' : 'panel.agent.files.passes.one', { count: passes })}
      </span>
    )
  }
  return (
    <span className="shrink-0 text-xs tabular-nums">
      <span className="text-positive">+{added}</span> <span className="text-critical">−{removed}</span>
    </span>
  )
}

function fileName(path: string) {
  return path.split('/').pop() || path
}

/**
 * Une ligne de fichier : le nom ouvre le fichier, l'icône de diff mène à Git. Deux gestes,
 * donc deux boutons, plutôt qu'une ligne qui ferait l'un ou l'autre selon l'endroit.
 */
function FileLine({ path, meta, delta, hasGit, onOpenFile }: { path: string; meta?: string; delta: ReactNode; hasGit: boolean; onOpenFile: (path: string) => void }) {
  const t = useTranslate()
  const name = fileName(path)
  return (
    <li className="group flex h-11 items-center gap-2 px-3 md:h-9 pointer-coarse:h-11">
      <button type="button" onClick={() => onOpenFile(path)} title={path} className="flex min-w-0 flex-1 items-baseline gap-2 text-left">
        <span className="min-w-0 truncate text-sm text-ink underline-offset-2 hover:underline">{name}</span>
        {meta ? <span className="min-w-0 truncate text-xs text-ink-faint">{meta}</span> : null}
      </button>
      {delta}
      {hasGit ? (
        <IconButton
          size="sm"
          label={t('panel.agent.files.diff', { name })}
          title={t('panel.agent.files.diffTitle')}
          onClick={() => setPanelTab('git')}
          className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100"
        >
          <FileDiff size={13} aria-hidden />
        </IconButton>
      ) : null}
    </li>
  )
}

function SessionFileLine({ file, agents, hasGit, onOpenFile }: { file: SessionFile; agents: SubAgent[]; hasGit: boolean; onOpenFile: (path: string) => void }) {
  const t = useTranslate()
  const by = [
    ...(file.byMain ? [t('panel.agent.files.main')] : []),
    ...file.agents.flatMap((id) => {
      const writer = agents.find((entry) => entry.id === id)
      return writer ? [subAgentLabel(writer)] : []
    }),
  ]
  return <FileLine path={file.path} meta={by.join(', ')} delta={<Delta added={file.added} removed={file.removed} passes={file.passes} />} hasGit={hasGit} onOpenFile={onOpenFile} />
}

/**
 * Un bloc d'un détail en pile, nommé pour les lecteurs d'écran par son titre. `meta` suit
 * le titre en bas de casse : « Son fil · 14 outils ».
 */
function Block({ title, count, meta, children }: { title: string; count?: number; meta?: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col pt-1.5">
      <PanelGroup
        title={
          meta ? (
            <>
              {title} <span className="ml-1 tracking-normal tabular-nums normal-case">{meta}</span>
            </>
          ) : (
            title
          )
        }
        count={count}
      />
      {children}
    </section>
  )
}

/** Fait défiler le fil principal jusqu'à un appel d'outil et le fait clignoter, s'il est rendu. */
function revealToolCall(id: string): boolean {
  const node = document.querySelector<HTMLElement>(`[data-tool-id="${CSS.escape(id)}"]`)
  if (!node) return false
  const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  node.scrollIntoView({ behavior: still ? 'auto' : 'smooth', block: 'center' })
  // L'anneau de `sg-flash-turn`, celui d'un saut vers un tour ; l'API d'animation
  // échappe à la règle CSS du mouvement réduit, d'où la garde.
  if (!still) node.animate?.([{ boxShadow: '0 0 0 2px var(--sg-accent)' }, { boxShadow: '0 0 0 2px transparent' }], { duration: 1400, easing: 'ease-out' })
  return true
}

type Notice = { tone: 'neutral' | 'critical'; text: string }

/** Le détail d'un sous-agent, dans le panneau même : ce qu'il a écrit, ce qu'il a rendu, son fil. */
function SubAgentDetail({
  conversationId,
  agent,
  canMessage,
  hasGit,
  onOpenFile,
}: {
  conversationId: string
  agent: SubAgent
  /** Le CLI de la session sait faire relayer un message à son sous-agent. */
  canMessage: boolean
  hasGit: boolean
  onOpenFile: (path: string) => void
}) {
  const t = useTranslate()
  const running = agent.status === 'running'
  const now = useNow(running)
  const wide = useMediaQuery('(min-width: 48rem)')
  const rows = useMemo(() => buildRows(agent.items, agent.id, running), [agent.items, agent.id, running])
  const files = useMemo(() => filesOf(agent), [agent])
  const result = useMemo(() => resultOf(agent), [agent])
  const [showResult, setShowResult] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [interrupting, setInterrupting] = useState(false)
  const [writing, setWriting] = useState(false)

  const model = modelLabel(agent)
  const state = running
    ? t('panel.agent.detail.running', { duration: formatDuration(Math.max(0, now - agent.startedAt), t) })
    : agent.status === 'done'
      ? agent.durationMs
        ? t('panel.agent.detail.doneIn', { duration: formatDuration(agent.durationMs, t) })
        : t('panel.agent.detail.done')
      : t('panel.agent.state.stopped')
  const meta = [
    agent.type,
    model,
    state,
    agent.toolCount > 0 ? toolCount(agent.toolCount, t) : null,
    // Les tokens d'un sous-agent n'apparaissent nulle part ailleurs : ils ne comptent pas
    // dans l'usage du tour, que seul l'agent principal alimente.
    agent.totalTokens > 0 ? t('panel.agent.tokens', { count: formatTokens(agent.totalTokens) }) : null,
  ]
    .filter(Boolean)
    .join(' · ')

  const copy = async () => {
    if (!result) return
    const ok = await copyText(result)
    setNotice({ tone: ok ? 'neutral' : 'critical', text: t(ok ? 'panel.agent.copied' : 'panel.agent.copyFailed') })
  }
  const reveal = () => {
    if (!revealToolCall(agent.id)) {
      setNotice({ tone: 'neutral', text: t('panel.agent.revealMissing') })
      return
    }
    // En feuille, le panneau couvre le fil : il s'écarte pour qu'on voie l'appel.
    if (!wide) setPanelOpen(false)
  }
  // Le CLI n'arrête pas un sous-agent seul : un appel bloquant ne se coupe qu'avec son tour.
  // Interrompre la session est le seul geste réel, et il arrête tout.
  const interrupt = () => {
    setInterrupting(true)
    interruptConversation(conversationId).catch((error: Error) => {
      setInterrupting(false)
      setNotice({ tone: 'critical', text: error.message })
    })
  }

  return (
    <>
      <StackHeader
        back={t('panel.tab.agents')}
        onBack={clearSubAgent}
        title={
          <span className="flex min-w-0 items-center gap-2">
            <AgentIconDot agent={agent} />
            <span className="truncate">{subAgentLabel(agent)}</span>
          </span>
        }
        meta={meta}
      />
      {notice ? (
        <PanelNotice tone={notice.tone} onClose={() => setNotice(null)}>
          {notice.text}
        </PanelNotice>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto pb-3">
        <Block title={t('panel.agent.block.files')} count={files.length > 0 ? files.length : undefined}>
          {files.length === 0 ? (
            <p className="px-3 text-xs text-ink-faint">{t(running ? 'panel.agent.files.noneYet' : 'panel.agent.files.none')}</p>
          ) : (
            <ul>
              {files.map((file) => (
                <FileLine
                  key={file.path}
                  path={file.path}
                  delta={<Delta added={file.added} removed={file.removed} passes={file.passes} />}
                  hasGit={hasGit}
                  onOpenFile={onOpenFile}
                />
              ))}
            </ul>
          )}
        </Block>

        <Block title={t('panel.agent.block.result')}>
          {result ? (
            <div className="px-3">
              <p className={cx('text-sm whitespace-pre-wrap text-ink-soft', !showResult && 'line-clamp-3')}>{result}</p>
              <button
                type="button"
                aria-expanded={showResult}
                onClick={() => setShowResult((value) => !value)}
                className={cx(panelGestureClass, '-ml-2.5 text-ink-faint')}
              >
                {t(showResult ? 'panel.agent.result.fold' : 'panel.agent.result.readAll')}
              </button>
            </div>
          ) : (
            <p className="px-3 text-xs text-ink-faint">{t(running ? 'panel.agent.result.noneYet' : 'panel.agent.result.none')}</p>
          )}
        </Block>

        <Block title={t('panel.agent.block.thread')} meta={agent.toolCount > 0 ? toolCount(agent.toolCount, t) : undefined}>
          <div className="flex min-w-0 flex-col gap-3 px-3">
            {rows.length === 0 ? (
              <p className="text-xs text-ink-faint">{t(running ? 'panel.agent.thread.starting' : 'panel.agent.thread.silent')}</p>
            ) : (
              <ChatThread rows={rows} conversationId={conversationId} />
            )}
          </div>
        </Block>
      </div>

      {writing ? (
        <SubAgentMessage
          conversationId={conversationId}
          agent={agent}
          onSent={() => {
            setWriting(false)
            setNotice({ tone: 'neutral', text: t('panel.agent.message.sent') })
          }}
          onCancel={() => setWriting(false)}
        />
      ) : null}
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-t border-line px-2 py-1.5 pb-safe">
        <button type="button" onClick={() => void copy()} disabled={!result} className={panelGestureClass}>
          <Copy size={12} aria-hidden /> {t('panel.agent.copy')}
        </button>
        <button type="button" onClick={reveal} className={panelGestureClass}>
          <CornerUpLeft size={12} aria-hidden /> {t('panel.agent.reveal')}
        </button>
        {/* Sans nom ni `agentId`, l'agent principal n'aurait aucune cible à donner à
            `SendMessage` : un sous-agent au premier plan n'en annonce qu'en rendant son appel. */}
        {canMessage && agent.address ? (
          <button type="button" aria-expanded={writing} onClick={() => setWriting((value) => !value)} className={panelGestureClass}>
            <MessageSquare size={12} aria-hidden /> {t('panel.agent.message.open')}
          </button>
        ) : null}
        <span className="flex-1" />
        {running ? (
          <button
            type="button"
            onClick={interrupt}
            disabled={interrupting}
            title={t('panel.agent.interruptHint')}
            className={cx(panelGestureClass, 'hover:text-critical')}
          >
            <Square size={11} fill="currentColor" aria-hidden /> {t('panel.agent.interrupt')}
          </button>
        ) : null}
      </div>
    </>
  )
}

/**
 * Écrire à un sous-agent. Aucun CLI n'accepte, depuis son flux, un message adressé à un
 * sous-agent : c'est l'agent principal qui le lui transmet avec `SendMessage`, par le nom
 * que l'appel lui a donné ou l'`agentId` que son résultat annonce. Le message se lit donc
 * dans le fil principal tel qu'il part, consigne de relais comprise. Le message part comme
 * n'importe quel message du fil : en file d'attente si un tour tourne, et l'agent principal
 * ne le relaie qu'une fois libre — un sous-agent qu'il attend le lira donc à son retour.
 */
function SubAgentMessage({
  conversationId,
  agent,
  onSent,
  onCancel,
}: {
  conversationId: string
  agent: SubAgent
  onSent: () => void
  onCancel: () => void
}) {
  const t = useTranslate()
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const label = subAgentLabel(agent)
  const form = useRef<HTMLFormElement>(null)
  // Sa propre couche : Échap ferme le formulaire et garde le détail, au lieu de remonter
  // à la liste en perdant le brouillon.
  useEscapeLayer(true, onCancel, form)

  const send = (event?: FormEvent) => {
    event?.preventDefault()
    const body = text.trim()
    if (!body || sending) return
    setSending(true)
    setError(null)
    sendMessage(conversationId, t('panel.agent.message.relay', { label, address: agent.address ?? '', body }))
      .then(onSent)
      .catch((cause: Error) => {
        setSending(false)
        setError(cause.message)
      })
  }
  const keys = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) send()
  }

  return (
    <form ref={form} onSubmit={send} className="flex shrink-0 flex-col gap-1.5 border-t border-line px-3 py-2">
      <label htmlFor={`relay-${agent.id}`} className="text-xs text-ink-faint">
        {t('panel.agent.message.hint', { name: label })}
      </label>
      <textarea
        id={`relay-${agent.id}`}
        autoFocus
        rows={3}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={keys}
        placeholder={t('panel.agent.message.placeholder')}
        className="min-h-16 w-full resize-y rounded-md border border-line bg-sunken px-2.5 py-1.5 text-sm text-ink outline-none placeholder:text-ink-faint hover:border-line-strong focus:border-accent"
      />
      {error ? <p className="text-xs text-critical">{error}</p> : null}
      <div className="flex items-center justify-end gap-1">
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          {t('panel.agent.message.cancel')}
        </Button>
        <Button type="submit" size="sm" variant="secondary" icon={<Send size={12} />} disabled={!text.trim() || sending}>
          {t('panel.agent.message.send')}
        </Button>
      </div>
    </form>
  )
}

/** Un travail de fond : ce qu'on en sait, et ses gestes. Sa sortie ne remonte pas. */
function WorkDetail({
  conversationId,
  conversationTitle,
  canStop,
  work,
  onBack,
}: {
  conversationId: string
  conversationTitle: string
  canStop: boolean
  work: BackgroundWork
  onBack: () => void
}) {
  const t = useTranslate()
  const family = familyOf(work.kind)
  const port = workPort(work)
  const label = work.description || work.kind
  const [notice, setNotice] = useState<string | null>(null)
  /**
   * L'arrêt n'est pas confirmé par la réponse : le travail disparaît au prochain
   * `background.updated`, et son détail avec lui. Entre les deux, le bouton reste
   * désactivé, sans quoi il inviterait à redemander un arrêt déjà demandé.
   */
  const [stopping, setStopping] = useState(false)

  const stop = () => {
    setStopping(true)
    stopBackgroundTask(conversationId, work.id).catch((error: Error) => {
      setStopping(false)
      setNotice(error.message)
    })
  }
  const facts: [string, string][] = [
    [t('panel.agent.work.nature'), familyWord(family, t)],
    [t('panel.agent.work.now'), work.activity ?? t('panel.agent.work.nothing')],
    ...(work.command ? [[t('panel.agent.work.command'), work.command] as [string, string]] : []),
    ...(work.toolUses > 0 ? [[t('panel.agent.work.tools'), String(work.toolUses)] as [string, string]] : []),
    ...(work.totalTokens > 0 ? [[t('panel.agent.work.tokens'), formatTokens(work.totalTokens)] as [string, string]] : []),
    ...(port !== null ? [[t('panel.agent.work.port'), `:${port}`] as [string, string]] : []),
  ]

  return (
    <>
      <StackHeader
        back={t('panel.tab.agents')}
        onBack={onBack}
        title={
          <span className="flex min-w-0 items-center gap-2">
            <PanelStatusIcon icon={<FamilyIcon family={family} size={14} />} dot="accent" pulse />
            <span className="truncate">{label}</span>
          </span>
        }
        meta={t('panel.agent.work.meta')}
      />
      {notice ? (
        <PanelNotice tone="critical" onClose={() => setNotice(null)}>
          {notice}
        </PanelNotice>
      ) : null}
      <div className="min-h-0 flex-1 overflow-y-auto py-1.5">
        <dl>
          {facts.map(([term, value]) => (
            <div key={term} className="flex h-11 items-center gap-3 px-3 text-sm md:h-9 pointer-coarse:h-11">
              <dt className="w-24 shrink-0 text-xs text-ink-faint">{term}</dt>
              <dd className="min-w-0 flex-1 truncate text-ink" title={value}>
                {value}
              </dd>
            </div>
          ))}
        </dl>
        <p className="px-3 pt-2 text-xs text-ink-faint">{t('panel.agent.work.noOutput')}</p>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-t border-line px-2 py-1.5 pb-safe">
        {/* Le CLI qui ne sait pas arrêter un travail de fond n'a pas de bouton : un geste
            qui ne ferait rien mentirait. */}
        {canStop ? (
          <button type="button" onClick={stop} disabled={stopping} className={cx(panelGestureClass, 'hover:text-critical')}>
            <Square size={11} fill="currentColor" aria-hidden /> {t('panel.agent.work.stop')}
          </button>
        ) : null}
        <span className="flex-1" />
        {port !== null ? <PortLink port={port} label={t('panel.agent.open', { port })} className={panelGestureClass} /> : null}
        <button
          type="button"
          onClick={() => requestActionEdit(workSeed(work, conversationTitle, t))}
          className={cx(panelGestureClass, 'border border-line text-ink hover:border-line-strong')}
        >
          <Wand2 size={12} aria-hidden /> {t('panel.agent.work.makeAction')}
        </button>
      </div>
    </>
  )
}
