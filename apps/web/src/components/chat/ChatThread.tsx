import { Fragment, type RefObject } from 'react'
import { noticeText, type MessageItem, type TurnCheckpoint } from '../../lib/chat-fold'
import type { ChatRow } from '../../lib/tool-rows'
import { translate, translateError, useTranslate } from '../../lib/i18n'
import { Banner, cx } from '@solera/ui'
import { ElicitationPrompt } from './ElicitationPrompt'
import { CardFilingPrompt } from './CardFilingPrompt'
import { DiffCard } from './DiffCard'
import { DecisionPrompt } from './DecisionPrompt'
import { FilingPrompt } from './FilingPrompt'
import { MessageBubble } from './MessageBubble'
import { PermissionPrompt } from './PermissionPrompt'
import { PlanReview } from './PlanReview'
import { PlanProgress } from './PlanProgress'
import { QuestionPrompt } from './QuestionPrompt'
import { TaskResult } from './TaskResult'
import { ToolCall, ToolCallGroup } from './ToolCall'
import { TurnChanges } from './TurnChanges'

/**
 * Ce qui reste à montrer sous le titre traduit d'une erreur écrite par Solera. Son
 * message, complet pour les lecteurs du journal sans catalogue (planificateur, webhooks),
 * redirait le titre ; et les journaux d'avant le portent en français.
 */
const ERROR_DETAILS: Record<string, (message: string) => string> = {
  daemon_restarted: () => '',
  // Seule la raison, entre parenthèses en fin de phrase, apprend quelque chose. Celle
  // que Solera rédige se traduit ; une erreur du CLI reste telle qu'il l'a écrite.
  config_applied_by_restart: (message) => {
    const reason = /\(([^]*)\)\.?$/.exec(message)?.[1] ?? message
    return LIVE_CHANGE_REFUSED.has(reason) ? translate('error.config_applied_by_restart.live') : reason
  },
}
/** La raison de `restartForConfig`, en anglais et telle que l'écrivaient les journaux d'avant. */
const LIVE_CHANGE_REFUSED = new Set(['the CLI cannot apply this change live', 'le CLI ne gère pas ce changement à chaud'])

/**
 * Rendu d'un fil de conversation.
 *
 * Le même composant sert au fil principal et à celui d'un sous-agent : ce sont les
 * mêmes événements, et les rendre différemment ferait de la vue d'un sous-agent une
 * seconde implémentation à tenir en accord avec la première.
 *
 * Ce que la page apporte en plus (ancres de tours, mise en évidence, fork) est
 * optionnel : le panneau n'a ni réglette ni bouton de fork à proposer.
 */
export function ChatThread({
  rows,
  conversationId,
  canDecide = false,
  canFileCards = false,
  mayCollapseTools = true,
  onFork,
  flashedId = null,
  anchors,
  checkpoints,
  onShowChanges,
  onRestoreCheckpoint,
}: {
  rows: ChatRow[]
  conversationId: string
  /**
   * Autorise à répondre aux sollicitations. Faux par défaut, et par défaut sur une
   * conversation partagée en lecture : les prompts s'affichent alors sans agir.
   */
  canDecide?: boolean
  /**
   * L'utilisateur possède-t-il le projet, et peut-il donc ranger son board.
   *
   * Séparé de `canDecide`, qui dit « propriétaire de la conversation » : une proposition
   * de déplacement de carte se tranche par le propriétaire du projet. Sur une instance à
   * un seul compte les deux coïncident toujours, ce qui est exactement la raison pour
   * laquelle il faut deux noms plutôt qu'un.
   */
  canFileCards?: boolean
  /**
   * Faux tant qu'on lit plus haut dans le fil : une série qui se replierait alors
   * déplacerait ce qu'on est en train de lire. Elle se replie quand on revient au bas.
   */
  mayCollapseTools?: boolean
  /** Absent quand le fil n'est pas forkable, un sous-agent n'ayant pas d'existence propre. */
  onFork?: (message: MessageItem) => void
  /** Message que l'on vient d'atteindre, signalé le temps qu'on le repère. */
  flashedId?: string | null
  /** Position des messages utilisateur, tenue à jour pour la réglette des tours. */
  anchors?: RefObject<Map<string, HTMLElement>>
  /** Points de reprise des tours, absents sur le fil d'un sous-agent. */
  checkpoints?: TurnCheckpoint[]
  onShowChanges?: (checkpoint: TurnCheckpoint) => void
  onRestoreCheckpoint?: (checkpoint: TurnCheckpoint) => void
}) {
  const t = useTranslate()

  // Le repère d'un tour se pose à sa fin : juste avant le message utilisateur suivant,
  // ou sous le dernier élément du fil. Le tour est reconnu par le message qui l'ouvre.
  const byOpener = new Map<string, TurnCheckpoint>()
  for (const checkpoint of checkpoints ?? []) {
    if (checkpoint.openerId) byOpener.set(checkpoint.openerId, checkpoint)
  }
  let current: TurnCheckpoint | null = null
  const strip = (checkpoint: TurnCheckpoint | null) =>
    checkpoint && onShowChanges ? (
      <TurnChanges
        key={`checkpoint-${checkpoint.key}`}
        checkpoint={checkpoint}
        onShow={onShowChanges}
        onRestore={onRestoreCheckpoint}
      />
    ) : null

  return (
    <>
      {rows.map((row) => {
        if (row.kind === 'item' && row.item.kind === 'message' && row.item.role === 'user' && !row.item.parentToolCallId) {
          const closing = strip(current)
          current = byOpener.get(row.item.id) ?? null
          if (closing) {
            return (
              <Fragment key={`turn-${row.item.id}`}>
                {closing}
                {renderRow(row)}
              </Fragment>
            )
          }
        }
        return renderRow(row)
      })}
      {strip(current)}
    </>
  )

  function renderRow(row: ChatRow) {
        if (row.kind === 'tool-group') {
          return <ToolCallGroup key={row.key} tools={row.tools} complete={row.complete} mayCollapse={mayCollapseTools} conversationId={conversationId} />
        }
        if (row.kind === 'tool') {
          return <ToolCall key={row.key} tool={row.tool} conversationId={conversationId} />
        }

        const item = row.item
        switch (item.kind) {
          case 'message':
            // `data-seq` sur les deux rôles : un résultat de recherche peut viser une
            // réponse de l'agent. L'ancre de tour, elle, ne concerne que les messages
            // utilisateur, qui délimitent les tours dans la réglette.
            return (
              <div
                key={item.id}
                data-seq={item.seq}
                className={cx(flashedId === item.id && 'sg-flash-turn')}
                ref={
                  anchors && item.role === 'user'
                    ? (node) => {
                        if (!node) return
                        anchors.current.set(item.id, node)
                        // Corps en bloc : `Map.delete` renvoie un booléen, or React
                        // attend une fonction de nettoyage sans valeur de retour.
                        return () => {
                          anchors.current.delete(item.id)
                        }
                      }
                    : undefined
                }
              >
                <MessageBubble
                  message={item}
                  onFork={item.role === 'user' ? onFork : undefined}
                />
              </div>
            )
          case 'permission':
            return (
              <PermissionPrompt
                key={item.id}
                conversationId={conversationId}
                permission={item}
                canDecide={canDecide}
              />
            )
          case 'filing':
            return (
              <FilingPrompt
                key={item.id}
                conversationId={conversationId}
                filing={item}
                canDecide={canDecide}
              />
            )
          case 'cardFiling':
            return (
              <CardFilingPrompt
                key={item.id}
                conversationId={conversationId}
                filing={item}
                // Le propriétaire du projet, et non celui du fil : c'est le board qu'on
                // range. Les deux ne se confondent que sur une instance à un seul compte.
                canDecide={canFileCards}
              />
            )
          case 'decision':
            return <DecisionPrompt key={item.id} item={item} canDecide={canDecide} />
          case 'question':
            return (
              <QuestionPrompt
                key={item.id}
                conversationId={conversationId}
                item={item}
                canDecide={canDecide}
              />
            )
          case 'elicitation':
            return (
              <ElicitationPrompt
                key={item.id}
                conversationId={conversationId}
                item={item}
                canDecide={canDecide}
              />
            )
          case 'plan':
            return (
              <PlanReview
                key={item.id}
                conversationId={conversationId}
                item={item}
                canDecide={canDecide}
              />
            )
          case 'error': {
            // Le code seul est traduit : le message du CLI porte le détail que le
            // catalogue ne peut pas connaître, comme l'heure de retour d'un quota.
            // Un code sans clé n'a pas de titre, et le message se suffit.
            const title = translateError(item.code, '')
            const detail = ERROR_DETAILS[item.code]
            const message = title && detail ? detail(item.message) : item.message
            return (
              <Banner key={item.id} tone={item.recoverable ? 'caution' : 'critical'}>
                {title ? <span className="font-medium">{title}</span> : null}
                {title && message ? <br /> : null}
                {message ? <span className="whitespace-pre-wrap break-words">{message}</span> : null}
              </Banner>
            )
          }
          case 'task':
            return <TaskResult key={item.id} item={item} />
          case 'plan_progress':
            return <PlanProgress key={item.id} item={item} />
          case 'diff':
            return <DiffCard key={item.id} item={item} conversationId={conversationId} />
          case 'notice':
            if (item.level) {
              return (
                <Banner key={item.id} tone={item.level === 'warning' ? 'caution' : 'info'}>
                  <span className="whitespace-pre-wrap break-words">{noticeText(item)}</span>
                  {item.details != null ? (
                    <details className="mt-1">
                      <summary className="cursor-pointer">{t('notice.details')}</summary>
                      <pre className="mt-2 max-h-80 overflow-auto text-xs whitespace-pre-wrap break-words">
                        {typeof item.details === 'string' ? item.details : JSON.stringify(item.details, null, 2)}
                      </pre>
                    </details>
                  ) : null}
                </Banner>
              )
            }
            return (
              <div key={item.id} className="flex items-center gap-3 py-1">
                <span className="h-px flex-1 bg-line" />
                <span className="text-meta text-ink-faint">{noticeText(item)}</span>
                <span className="h-px flex-1 bg-line" />
              </div>
            )
        }
  }
}
