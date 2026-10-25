import { TooltipButton } from '@solera/ui'
import { AGENT_CAPABILITIES, type AgentKind } from '@solera/protocol'
import { ArrowLeft, Bot, Radio, Square, SquareTerminal, Waves } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import type { BackgroundWork } from '../../lib/background'
import { stopBackgroundTask } from '../../lib/conversations'
import { useTranslate, type MessageKey } from '../../lib/i18n'
import { clearSubAgent, showSubAgent } from '../../lib/panel'
import { subAgentLabel, type SubAgent } from '../../lib/subagents'
import { formatTokens } from '../../lib/tokens'
import { buildRows } from '../../lib/tool-rows'
import type { EditTurn } from '../../lib/chat-fold'
import { AgentWritings } from './AgentWritings'
import { ChatThread } from '../chat/ChatThread'
import { SubAgentRow } from '../chat/SubAgentRow'
import { EmptyState, cx } from '@solera/ui'

/**
 * Tout ce que l'agent fait faire : ses sous-agents, ses travaux de fond, ses écritures.
 *
 * Les trois répondent à la même question — qu'est-ce qui tourne, ou a tourné, sous ce
 * fil — et c'est pourquoi l'onglet *Historique* a été dissous ici le 2026-10-11 : il
 * n'avait sa propre place que parce que personne n'avait remarqué qu'il la partageait.
 *
 * Le fil d'un sous-agent est rendu par le même composant que le fil principal. Un
 * sous-agent est une conversation comme une autre, avec ses messages, sa réflexion et
 * ses appels : lui donner un rendu à part obligerait à tenir deux vues en accord pour
 * un seul contenu.
 */
export function AgentsPane({
  conversationId,
  scope,
  agent,
  agents,
  background,
  editTurns,
  selectedId,
  onOpenFile,
}: {
  conversationId: string
  /** Répertoire de travail du fil, pour les reprises à la main de ses écritures. */
  scope: string
  /** CLI de la conversation : c'est lui qui dit si un travail de fond s'arrête. */
  agent: AgentKind
  agents: SubAgent[]
  /** Travaux poursuivis hors du tour, sans fil à ouvrir : le CLI n'en transmet rien. */
  background: BackgroundWork[]
  /** Les tours qui ont écrit, regroupés par fichier dans « Ses écritures ». */
  editTurns: EditTurn[]
  selectedId: string | null
  onOpenFile: (path: string) => void
}) {
  const t = useTranslate()
  const selected = agents.find((agent) => agent.id === selectedId) ?? null

  if (selected) {
    return (
      <SubAgentThread conversationId={conversationId} agent={selected} onBack={clearSubAgent} />
    )
  }

  if (agents.length === 0 && background.length === 0 && editTurns.length === 0) {
    return (
      /* Centré comme celui des terminaux : deux vues voisines du même panneau n'ont
         aucune raison de poser leur message vide à deux endroits différents. */
      <div className="flex min-h-0 flex-1 items-center justify-center p-4">
        <EmptyState
          icon={<Bot size={22} />}
          title={t('subagent.pane.empty.title')}
          description={t('subagent.pane.empty.description')}
        />
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto pb-safe">
      {agents.length > 0 ? (
        <section className="p-2 pb-1">
          <h3 className="px-0.5 pb-1 text-micro font-semibold tracking-wide text-ink-faint uppercase">
            {t('subagent.pane.title', { count: agents.length })}
          </h3>
          <div className="flex flex-col gap-1">
            {agents.map((agent) => (
              <div key={agent.id} className={cx(agent.parentId && 'pl-3')}>
                <SubAgentRow agent={agent} onSelect={() => showSubAgent(agent.id)} />
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <BackgroundList conversationId={conversationId} agent={agent} tasks={background} />

      <AgentWritings
        conversationId={conversationId}
        scope={scope}
        turns={editTurns}
        onOpenFile={onOpenFile}
      />
    </div>
  )
}

type BackgroundFamily = 'workflow' | 'shell' | 'subagent' | 'monitor'

/**
 * Les noms sous lesquels le CLI annonce chaque famille de travaux.
 *
 * Deux orthographes par famille parce que le CLI les mélange : le SDK documente des
 * libellés lisibles (`shell`, `subagent`), et la version 2.1 émet ses discriminants
 * bruts (`local_bash`, `local_agent`). Le préfixe `local_` est retiré avant la
 * recherche, ce qui rattrape les deux d'un coup.
 */
const KIND_ALIASES: Record<string, BackgroundFamily | undefined> = {
  workflow: 'workflow',
  bash: 'shell',
  shell: 'shell',
  agent: 'subagent',
  subagent: 'subagent',
  mcp_task: 'monitor',
  monitor: 'monitor',
}

const KIND_ICONS: Record<BackgroundFamily, ReactNode> = {
  workflow: <Waves size={14} />,
  shell: <SquareTerminal size={14} />,
  subagent: <Bot size={14} />,
  monitor: <Radio size={14} />,
}

const KIND_LABELS: Record<BackgroundFamily, MessageKey> = {
  workflow: 'panel.background.kind.workflow',
  shell: 'panel.background.kind.shell',
  subagent: 'panel.background.kind.subagent',
  monitor: 'panel.background.kind.monitor',
}

/**
 * Les travaux de fond, au-dessus des sous-agents et non mêlés à eux.
 *
 * Ils n'ont pas de fil à ouvrir : le CLI en donne l'activité du moment, jamais ce
 * qu'ils écrivent. Une ligne sans clic est donc honnête, là où une ligne cliquable
 * promettrait un détail qui n'existe pas.
 */
function BackgroundList({
  conversationId,
  agent,
  tasks,
}: {
  conversationId: string
  agent: AgentKind
  tasks: BackgroundWork[]
}) {
  const t = useTranslate()
  const canStop = AGENT_CAPABILITIES[agent].stopBackgroundTask
  /**
   * L'arrêt n'est pas confirmé par la réponse : la tâche disparaît au prochain
   * `background.updated`. Entre les deux, le bouton reste marqué, sans quoi il
   * inviterait à recliquer sur un arrêt déjà demandé.
   */
  const [stopping, setStopping] = useState<ReadonlySet<string>>(new Set())
  if (tasks.length === 0) return null

  const stop = async (taskId: string) => {
    setStopping((prev) => new Set(prev).add(taskId))
    try {
      await stopBackgroundTask(conversationId, taskId)
    } catch {
      // Refus du serveur (session arrêtée entre-temps, tâche déjà close) : le bouton
      // redevient cliquable, et la liste, elle, dit toujours vrai via le journal.
      setStopping((prev) => {
        const next = new Set(prev)
        next.delete(taskId)
        return next
      })
    }
  }

  return (
    <section className="flex flex-col gap-1 p-2 pt-1 pb-1">
      <h3 className="px-0.5 text-micro font-semibold tracking-wide text-ink-faint uppercase">
        {t('panel.background.title', { count: tasks.length })}
      </h3>
      {tasks.map((task) => {
        // Un type inconnu s'affiche tel qu'il est venu plutôt que d'être rangé de
        // force dans une famille : le CLI en ajoute au fil des versions.
        const family = KIND_ALIASES[task.kind.replace(/^local_/, '')]
        return (
          <div
            key={task.id}
            className="flex items-center gap-2 rounded-md border border-line bg-surface-high px-2 py-1.5"
          >
            <span className="shrink-0 text-accent">
              {family ? KIND_ICONS[family] : <Waves size={14} />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs text-ink">{task.description}</span>
              <span className="block truncate text-meta text-ink-faint">
                {/* La famille dit quelle sorte de travail tourne, l'activité ce qu'il
                    fait à l'instant : les deux tiennent sur la ligne. */}
                {task.activity
                  ? `${family ? t(KIND_LABELS[family]) : task.kind} · ${task.activity}`
                  : family
                    ? t(KIND_LABELS[family])
                    : task.kind}
              </span>
            </span>

            {task.toolUses > 0 ? (
              <span className="shrink-0 text-meta tabular-nums text-ink-faint">
                {t(task.toolUses > 1 ? 'panel.background.tools.many' : 'panel.background.tools.one', {
                  count: task.toolUses,
                })}
              </span>
            ) : null}

            {canStop ? (
              <TooltipButton
                type="button"
                onClick={() => void stop(task.id)}
                disabled={stopping.has(task.id)}
                title={t('panel.background.stop')}
                aria-label={t('panel.background.stop')}
                className="shrink-0 rounded p-1 text-ink-faint transition-colors hover:bg-surface hover:text-critical disabled:cursor-default disabled:opacity-40"
              >
                <Square size={11} fill="currentColor" />
              </TooltipButton>
            ) : null}
          </div>
        )
      })}
    </section>
  )
}

function SubAgentThread({
  conversationId,
  agent,
  onBack,
}: {
  conversationId: string
  agent: SubAgent
  onBack: () => void
}) {
  const t = useTranslate()
  const running = agent.status === 'running'
  const rows = useMemo(() => buildRows(agent.items, agent.id, running), [agent.items, agent.id, running])

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-line px-2 py-1.5">
        <TooltipButton
          type="button"
          onClick={onBack}
          aria-label={t('subagent.pane.back')}
          className="flex size-7 shrink-0 items-center justify-center rounded-md text-ink-faint hover:text-ink"
        >
          <ArrowLeft size={14} />
        </TooltipButton>
        <Bot size={14} className={cx('shrink-0', agent.status === 'running' ? 'text-accent' : 'text-ink-faint')} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-medium text-ink">{subAgentLabel(agent)}</span>
          <span className="block truncate text-meta text-ink-faint">
            {agent.activity ? `${agent.type} · ${agent.activity}` : agent.type}
          </span>
        </span>

        {/* Les tokens d'un sous-agent n'apparaissent nulle part ailleurs : ils ne
            comptent pas dans l'usage du tour, que seul l'agent principal alimente. */}
        {agent.totalTokens > 0 ? (
          <span className="shrink-0 text-meta tabular-nums text-ink-faint">
            {t('subagent.tokens', { count: formatTokens(agent.totalTokens) })}
          </span>
        ) : null}
      </div>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
        {rows.length === 0 ? (
          <p className="text-xs text-ink-faint">
            {/* Le CLI transmet le travail du sous-agent au fil de l'eau : entre le
                lancement et son premier mot, il n'y a rien à montrer. */}
            {agent.status === 'running'
              ? t('subagent.pane.starting')
              : t('subagent.pane.silent')}
          </p>
        ) : (
          <ChatThread rows={rows} conversationId={conversationId} />
        )}
      </div>
    </div>
  )
}
