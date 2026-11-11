/* PROTOTYPE — jetable (branche proto/page-projet). Ne pas fusionner dans main.
 *
 * L'onglet **Agent** du panneau, épuré (Tim, 2026-11-11 : « fouillis »). Il répond à
 * une seule question : qu'est-ce qui tourne sous ce fil ?
 *
 * - Pas de ligne d'outils ni de vues : deux groupes, **En cours** (sous-agents qui
 *   travaillent et travaux de fond, mêlés, du plus ancien au plus récent) puis
 *   **Terminés**, replié en une ligne.
 * - Une ligne par élément, une seule hauteur, rien de déplié dans la liste : l'icône de
 *   nature portant le point d'état, le libellé, une méta courte, au plus un geste au
 *   survol (« Ouvrir :port »). Un clic ouvre le détail **en pile**, « ‹ Agent » pour
 *   remonter : le fil d'un sous-agent, ou ce qu'on sait d'un travail de fond.
 * - Les écritures sortent de la liste : une ligne de pied dépliable « Modifié par la
 *   session » les nomme, avec qui les a faites ; le détail d'un sous-agent montre les
 *   siennes, son résultat et ses gestes (Tim : « on ne voit plus ce qu'ils ont modifié »).
 * La couleur ne sert qu'aux points d'état : accent qui pulse = travaille, vert =
 * terminé, rouge = arrêté.
 */
import { ArrowLeft, Bot, ChevronRight, Copy, CornerUpLeft, FileDiff, Square, Wand2 } from 'lucide-react'
import { memo, useEffect, useMemo, useState, type KeyboardEvent, type ReactNode } from 'react'
import type { AgentKind } from '@solera/protocol'
import { cx } from '@solera/ui'
import type { BackgroundWork } from '../../../lib/background'
import type { EditTurn } from '../../../lib/chat-fold'
import { clearSubAgent, setPanelTab, showSubAgent } from '../../../lib/panel'
import { subAgentLabel, type SubAgent } from '../../../lib/subagents'
import { formatTokens } from '../../../lib/tokens'
import { buildRows } from '../../../lib/tool-rows'
import { ChatThread } from '../../chat/ChatThread'
import { FAMILY_WORD, FamilyIcon, familyOf, portIn, seedFromWork } from '../../../routes/prototype-automations/SessionWorks'
import { requestActionEdit } from './actionBridge'
import { filesOf, resultOf, revealToolCall, sessionFiles, type SessionFile, type TouchedFile } from './agentFiles'

function duration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s} s`
  const m = Math.floor(s / 60)
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`
}

const DOT: Record<string, string> = {
  running: 'animate-pulse bg-accent',
  done: 'bg-positive',
  error: 'bg-critical',
  interrupted: 'bg-critical',
}

const tools = (count: number) => `${count} outil${count > 1 ? 's' : ''}`

type Entry =
  | { kind: 'agent'; key: string; agent: SubAgent }
  | { kind: 'work'; key: string; work: BackgroundWork }

export const ProtoAgentPane = memo(function ProtoAgentPane({ conversationId, scope: _scope, agent: _agent, agents, background, editTurns, selectedId, onOpenFile }: {
  conversationId: string
  scope: string
  agent: AgentKind
  agents: SubAgent[]
  background: BackgroundWork[]
  editTurns: EditTurn[]
  selectedId: string | null
  onOpenFile: (path: string) => void
}) {
  const [openWork, setOpenWork] = useState<string | null>(null)
  const [showDone, setShowDone] = useState(false)
  const selected = agents.find((entry) => entry.id === selectedId) ?? null
  const work = background.find((entry) => entry.id === openWork) ?? null

  const running = useMemo<Entry[]>(
    () => [
      ...agents
        .filter((entry) => entry.status === 'running')
        .sort((a, b) => a.startedAt - b.startedAt)
        .map((entry) => ({ kind: 'agent' as const, key: entry.id, agent: entry })),
      // Le journal ne date pas un travail de fond : ils gardent l'ordre où ils sont apparus.
      ...background.map((entry) => ({ kind: 'work' as const, key: entry.id, work: entry })),
    ],
    [agents, background],
  )
  const done = useMemo(
    () => agents.filter((entry) => entry.status !== 'running').sort((a, b) => b.startedAt - a.startedAt),
    [agents],
  )
  const written = useMemo(() => sessionFiles(editTurns, agents), [editTurns, agents])
  const [showFiles, setShowFiles] = useState(false)

  if (selected) return <SubAgentStack conversationId={conversationId} agent={selected} onOpenFile={onOpenFile} />
  if (work) return <WorkStack work={work} onBack={() => setOpenWork(null)} />

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto py-1.5">
        {running.length === 0 ? (
          <p className="flex h-11 items-center px-3 text-sm text-ink-faint md:h-9">Rien ne tourne.</p>
        ) : (
          <Group title="En cours">
            {running.map((entry) =>
              entry.kind === 'agent'
                ? <AgentLine key={entry.key} agent={entry.agent} />
                : <WorkLine key={entry.key} work={entry.work} onOpen={() => setOpenWork(entry.work.id)} />,
            )}
          </Group>
        )}

        {done.length > 0 ? (
          <div className="mt-1.5">
            <button
              type="button"
              aria-expanded={showDone}
              onClick={() => setShowDone((value) => !value)}
              className="flex h-11 w-full items-center gap-1.5 px-3 text-left text-xs text-ink-faint hover:text-ink md:h-9"
            >
              {done.length} terminé{done.length > 1 ? 's' : ''}
              <ChevronRight size={13} className={cx('transition-transform', showDone && 'rotate-90')} />
            </button>
            {showDone ? <ul>{done.map((entry) => <AgentLine key={entry.id} agent={entry} />)}</ul> : null}
          </div>
        ) : null}
      </div>

      {written.length > 0 ? (
        <div className="flex max-h-[45%] shrink-0 flex-col border-t border-line">
          <button
            type="button"
            aria-expanded={showFiles}
            onClick={() => setShowFiles((value) => !value)}
            className="flex h-11 shrink-0 items-center gap-1.5 px-3 text-left text-xs text-ink-faint hover:text-ink md:h-9"
          >
            <ChevronRight size={13} className={cx('transition-transform', showFiles && 'rotate-90')} />
            Modifié par la session · {written.length} fichier{written.length > 1 ? 's' : ''}
          </button>
          {showFiles ? (
            <ul className="min-h-0 overflow-y-auto pb-1.5">
              {written.map((file) => <SessionFileLine key={file.path} file={file} onOpenFile={onOpenFile} />)}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  )
})

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="px-3 pt-1.5 pb-1 text-meta font-medium tracking-wide text-ink-faint uppercase">{title}</h3>
      <ul>{children}</ul>
    </section>
  )
}

/** L'icône de nature, portant le point d'état. */
function Nature({ icon, dot }: { icon: ReactNode; dot: string }) {
  return (
    <span className="relative grid size-5 shrink-0 place-items-center text-ink-faint">
      {icon}
      <span aria-hidden className={cx('absolute -top-0.5 -right-0.5 size-1.5 rounded-full ring-2 ring-canvas', dot)} />
    </span>
  )
}

const ROW = 'group flex h-11 w-full items-center gap-2.5 px-3 text-left transition-colors hover:bg-surface-high/50 md:h-9'

function AgentLine({ agent }: { agent: SubAgent }) {
  const meta = agent.status === 'running'
    ? [duration(Date.now() - agent.startedAt), agent.toolCount > 0 ? tools(agent.toolCount) : null]
    : agent.status === 'done'
      ? [agent.durationMs ? duration(agent.durationMs) : null, agent.toolCount > 0 ? tools(agent.toolCount) : null]
      : ['arrêté']
  return (
    <li>
      <button type="button" onClick={() => showSubAgent(agent.id)} className={ROW}>
        <Nature icon={<Bot size={14} />} dot={DOT[agent.status] ?? 'bg-line-strong'} />
        <span className="min-w-0 flex-1 truncate text-sm text-ink">{subAgentLabel(agent)}</span>
        <span className="shrink-0 text-xs tabular-nums text-ink-faint">{meta.filter(Boolean).join(' · ')}</span>
      </button>
    </li>
  )
}

function WorkLine({ work, onOpen }: { work: BackgroundWork; onOpen: () => void }) {
  const family = familyOf(work.kind)
  const port = portIn(work.description)
  const open = (event: KeyboardEvent) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onOpen()
    }
  }
  return (
    <li>
      {/* Une ligne-bouton qui porte un lien : un `div` à rôle de bouton, pour ne pas
          imbriquer un lien dans un bouton. */}
      <div role="button" tabIndex={0} onClick={onOpen} onKeyDown={open} className={cx(ROW, 'cursor-pointer')}>
        <Nature icon={<FamilyIcon family={family} size={14} />} dot={DOT.running!} />
        <span className="min-w-0 flex-1 truncate text-sm text-ink">{work.description || work.kind}</span>
        {port ? (
          <a
            href={`http://localhost:${port}`}
            target="_blank"
            rel="noreferrer"
            onClick={(event) => event.stopPropagation()}
            className="hidden shrink-0 text-xs text-ink-soft underline-offset-2 group-hover:inline group-focus-within:inline hover:text-ink hover:underline"
          >
            Ouvrir :{port}
          </a>
        ) : null}
        <span className={cx('shrink-0 text-xs tabular-nums text-ink-faint', port !== null && 'group-hover:hidden group-focus-within:hidden')}>
          {work.toolUses > 0 ? tools(work.toolUses) : FAMILY_WORD[family]}
        </span>
      </div>
    </li>
  )
}

/** Header commun aux deux détails en pile : « ‹ Agent », puis ce qu'on regarde. */
function StackHeader({ onBack, dot, icon, title, meta }: { onBack: () => void; dot: string; icon: ReactNode; title: string; meta: string }) {
  return (
    <div className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-2">
      <button type="button" onClick={onBack} className="inline-flex h-9 shrink-0 items-center gap-1 rounded-md px-2 text-xs text-ink-soft hover:bg-surface-high hover:text-ink">
        <ArrowLeft size={13} /> Agent
      </button>
      <Nature icon={icon} dot={dot} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium text-ink">{title}</span>
        <span className="truncate text-xs text-ink-faint">{meta}</span>
      </span>
    </div>
  )
}

function useEscape(onBack: () => void) {
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape' || (event.target as HTMLElement | null)?.closest('input, textarea, [contenteditable="true"]')) return
      onBack()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onBack])
}

/** Le +/− d'un fichier, ou le nombre de passes quand l'entrée ne le dit pas. */
function Delta({ added, removed, passes }: { added: number | null; removed: number | null; passes: number }) {
  if (added === null || removed === null) {
    return <span className="shrink-0 text-xs tabular-nums text-ink-faint">{passes} passe{passes > 1 ? 's' : ''}</span>
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
 * Une ligne de fichier : le nom ouvre le fichier, l'icône de diff bascule sur Git. Deux
 * gestes, donc deux boutons, plutôt qu'une ligne qui ferait l'un ou l'autre au hasard.
 */
function FileLine({ path, meta, delta, onOpenFile }: { path: string; meta?: string; delta: ReactNode; onOpenFile: (path: string) => void }) {
  return (
    <li className="group flex h-11 items-center gap-2 px-3 md:h-9">
      <button type="button" onClick={() => onOpenFile(path)} title={path} className="flex min-w-0 flex-1 items-baseline gap-2 text-left">
        <span className="min-w-0 truncate text-sm text-ink underline-offset-2 hover:underline">{fileName(path)}</span>
        {meta ? <span className="min-w-0 truncate text-xs text-ink-faint">{meta}</span> : null}
      </button>
      {delta}
      <button
        type="button"
        onClick={() => setPanelTab('git')}
        aria-label={`Diff de ${fileName(path)} dans Git`}
        title="Voir le diff dans Git"
        className="grid size-8 shrink-0 place-items-center rounded-md text-ink-faint opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:bg-surface-high hover:text-ink pointer-coarse:opacity-100"
      >
        <FileDiff size={13} />
      </button>
    </li>
  )
}

function SessionFileLine({ file, onOpenFile }: { file: SessionFile; onOpenFile: (path: string) => void }) {
  return (
    <FileLine
      path={file.path}
      meta={file.by.join(', ')}
      delta={<Delta added={file.added} removed={file.removed} passes={file.passes} />}
      onOpenFile={onOpenFile}
    />
  )
}

/** Un titre de bloc dans un détail en pile. */
function Block({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col">
      <div className="flex items-baseline gap-2 px-3 pt-3 pb-1">
        <h4 className="text-meta font-medium tracking-wide text-ink-faint uppercase">{title}</h4>
        {aside}
      </div>
      {children}
    </section>
  )
}

const GESTURE = 'inline-flex h-11 items-center gap-1.5 rounded-md px-2.5 text-xs text-ink-soft hover:bg-surface-high hover:text-ink md:h-9'

/** Le détail d'un sous-agent, dans le panneau même : ce qu'il a fait, ce qu'il a rendu, son fil. */
function SubAgentStack({ conversationId, agent, onOpenFile }: { conversationId: string; agent: SubAgent; onOpenFile: (path: string) => void }) {
  const running = agent.status === 'running'
  const rows = useMemo(() => buildRows(agent.items, agent.id, running), [agent.items, agent.id, running])
  const files = useMemo<TouchedFile[]>(() => filesOf(agent), [agent])
  const result = useMemo(() => resultOf(agent), [agent])
  const [showResult, setShowResult] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  useEscape(clearSubAgent)
  const meta = [
    running ? `travaille depuis ${duration(Date.now() - agent.startedAt)}` : agent.status === 'done' ? (agent.durationMs ? `terminé en ${duration(agent.durationMs)}` : 'terminé') : 'arrêté',
    agent.toolCount > 0 ? tools(agent.toolCount) : null,
    agent.totalTokens > 0 ? `${formatTokens(agent.totalTokens)} tokens` : null,
  ].filter(Boolean).join(' · ')

  const copy = async () => {
    if (!result) return
    try {
      await navigator.clipboard.writeText(result)
      setNotice('Résultat copié.')
    } catch {
      setNotice('Le navigateur refuse le presse-papiers ici : déplie le résultat et sélectionne-le.')
    }
  }
  const reveal = () => {
    if (!revealToolCall(agent.id)) setNotice('L’appel n’est pas rendu dans le fil : remonte jusqu’à son lancement, ou déplie le groupe d’outils qui le contient.')
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <StackHeader onBack={clearSubAgent} dot={DOT[agent.status] ?? 'bg-line-strong'} icon={<Bot size={14} />} title={subAgentLabel(agent)} meta={`${agent.type} · ${meta}`} />
      {notice ? (
        <p role="status" className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2 text-xs text-ink-soft">
          <span className="min-w-0 flex-1">{notice}</span>
          <button type="button" onClick={() => setNotice(null)} className="text-ink-faint hover:text-ink">✕</button>
        </p>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto pb-3">
        <Block title="Fichiers modifiés" aside={files.length > 0 ? <span className="text-xs tabular-nums text-ink-faint">{files.length}</span> : null}>
          {files.length === 0 ? (
            <p className="px-3 text-xs text-ink-faint">{running ? 'Rien d’écrit pour l’instant.' : 'Il n’a rien écrit.'}</p>
          ) : (
            <ul>
              {files.map((file) => (
                <FileLine
                  key={file.path}
                  path={file.path}
                  delta={<Delta added={file.added} removed={file.removed} passes={file.passes} />}
                  onOpenFile={onOpenFile}
                />
              ))}
            </ul>
          )}
        </Block>

        <Block title="Résultat">
          {result ? (
            <div className="px-3">
              <p className={cx('text-sm whitespace-pre-wrap text-ink-soft', !showResult && 'line-clamp-3')}>{result}</p>
              <button type="button" onClick={() => setShowResult((value) => !value)} className="mt-1 text-xs text-ink-faint hover:text-ink">
                {showResult ? 'Replier' : 'Tout lire'}
              </button>
            </div>
          ) : (
            <p className="px-3 text-xs text-ink-faint">{running ? 'Il n’a pas encore rendu son résultat.' : 'Aucun texte rendu à l’agent principal.'}</p>
          )}
        </Block>

        <Block title="Son fil" aside={agent.toolCount > 0 ? <span className="text-xs tabular-nums text-ink-faint">{tools(agent.toolCount)}</span> : null}>
          <div className="px-3">
            {rows.length === 0 ? (
              <p className="text-xs text-ink-faint">{running ? 'Il démarre : rien encore à montrer.' : 'Il n’a rien transmis.'}</p>
            ) : (
              <ChatThread rows={rows} conversationId={conversationId} />
            )}
          </div>
        </Block>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-1 border-t border-line px-2 py-1.5">
        <button type="button" onClick={copy} disabled={!result} className={cx(GESTURE, 'disabled:opacity-40 disabled:hover:bg-transparent')}>
          <Copy size={12} /> Copier le résultat
        </button>
        <button type="button" onClick={reveal} className={GESTURE}>
          <CornerUpLeft size={12} /> Dans le fil principal
        </button>
        <span className="flex-1" />
        {running ? (
          /* Le CLI n'arrête pas un sous-agent seul : un appel bloquant ne se coupe qu'avec
             son tour. Interrompre la session est le seul geste réel, et il arrête tout. */
          <button
            type="button"
            onClick={() => setNotice('Simulé : interrompre la session. Le CLI n’arrête pas un sous-agent seul : l’agent principal et ses autres sous-agents s’arrêteraient aussi.')}
            title="Le CLI n’arrête pas un sous-agent seul : c’est toute la session qui s’interrompt"
            className={cx(GESTURE, 'hover:text-critical')}
          >
            <Square size={11} fill="currentColor" /> Interrompre la session
          </button>
        ) : null}
      </div>
    </div>
  )
}

/** Un travail de fond : ce qu'on en sait, et ses gestes. */
function WorkStack({ work, onBack }: { work: BackgroundWork; onBack: () => void }) {
  const [notice, setNotice] = useState<string | null>(null)
  useEscape(onBack)
  const family = familyOf(work.kind)
  const port = portIn(work.description)
  const label = work.description || work.kind
  const makeAction = () => {
    requestActionEdit(seedFromWork({
      id: work.id,
      conversationId: '',
      conversationTitle: 'cette session',
      agent: null,
      family,
      label,
      command: null,
      startedAt: null,
      port,
      output: null,
      countOnly: null,
      simulated: false,
    }))
    setPanelTab('actions')
  }
  const facts: [string, string][] = [
    ['Nature', FAMILY_WORD[family]],
    ['À l’instant', work.activity ?? 'rien d’annoncé'],
    ...(work.toolUses > 0 ? [['Outils', String(work.toolUses)] as [string, string]] : []),
    ...(work.totalTokens > 0 ? [['Tokens', formatTokens(work.totalTokens)] as [string, string]] : []),
    ...(port ? [['Port', `:${port}`] as [string, string]] : []),
  ]
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <StackHeader onBack={onBack} dot={DOT.running!} icon={<FamilyIcon family={family} size={14} />} title={label} meta="travail de fond · en cours" />
      {notice ? (
        <p role="status" className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2 text-xs text-ink-soft">
          <span className="min-w-0 flex-1">{notice}</span>
          <button type="button" onClick={() => setNotice(null)} className="text-ink-faint hover:text-ink">✕</button>
        </p>
      ) : null}
      <div className="min-h-0 flex-1 overflow-y-auto py-1.5">
        <dl>
          {facts.map(([term, value]) => (
            <div key={term} className="flex h-11 items-center gap-3 px-3 text-sm md:h-9">
              <dt className="w-24 shrink-0 text-xs text-ink-faint">{term}</dt>
              <dd className="min-w-0 flex-1 truncate text-ink">{value}</dd>
            </div>
          ))}
        </dl>
        <p className="px-3 pt-2 text-xs text-ink-faint">Sa sortie ne remonte pas jusqu’à Solera.</p>
      </div>
      <div className="flex shrink-0 items-center gap-1.5 border-t border-line px-3 py-2">
        <button
          type="button"
          onClick={() => setNotice(`Simulé : arrêter « ${label} ».`)}
          className="inline-flex h-11 items-center gap-1.5 rounded-md px-2.5 text-xs text-ink-soft hover:bg-surface-high hover:text-critical md:h-9"
        >
          <Square size={11} fill="currentColor" /> Arrêter
        </button>
        <span className="flex-1" />
        {port ? (
          <a href={`http://localhost:${port}`} target="_blank" rel="noreferrer" className="inline-flex h-11 items-center rounded-md px-2.5 text-xs text-ink-soft hover:bg-surface-high hover:text-ink md:h-9">
            Ouvrir :{port}
          </a>
        ) : null}
        <button
          type="button"
          onClick={makeAction}
          className="inline-flex h-11 items-center gap-1.5 rounded-md border border-line px-2.5 text-xs text-ink hover:border-line-strong md:h-9"
        >
          <Wand2 size={12} /> En faire une action
        </button>
      </div>
    </div>
  )
}
