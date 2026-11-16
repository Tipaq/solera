import type { SoleraEvent } from '@solera/protocol'
import type { useTranslate } from './i18n'

/*
 * Ce qu'une demande dit en texte, sans rien lire du serveur : de quoi la résumer en une
 * ligne ou en montrer la cible. À part des crochets de `session-requests`, qui tirent le
 * client WebSocket, pour se tester hors navigateur.
 */

type EventOf<T extends SoleraEvent['type']> = Extract<SoleraEvent, { type: T }>

/**
 * Ce qu'une session te demande, tel que l'onglet Activité le déplie sous sa ligne (#112,
 * planche B2) : une demande du CLI, lue dans le journal, ou une décision (#77), lue dans
 * la section « À décider ».
 *
 * Les demandes du CLI gardent leur événement tel quel : la réponse part par les mêmes
 * routes que depuis le fil, et rien n'est retraduit en chemin.
 */
export type SessionRequest =
  | { kind: 'permission'; requestId: string; requestedAt: number; event: EventOf<'permission.requested'> }
  | { kind: 'question'; requestId: string; requestedAt: number; event: EventOf<'question.requested'> }
  | { kind: 'plan'; requestId: string; requestedAt: number; event: EventOf<'plan.review_requested'> }
  | { kind: 'elicitation'; requestId: string; requestedAt: number; event: EventOf<'elicitation.requested'> }
  | { kind: 'decision'; requestId: string; requestedAt: number; question: string }

/**
 * Ce qui identifie une permission : la commande, le chemin, l'URL, ou rien. Repris par
 * l'aperçu, qui la montre en code, et par la ligne, qui la résume.
 */
export function permissionTarget(input: unknown): { content: string; language: string } | null {
  if (input === null || input === undefined) return null
  if (typeof input === 'string') return { content: input, language: '' }

  const fields = input as Record<string, unknown>
  if (typeof fields.command === 'string' && fields.command.length > 0) {
    return { content: fields.command, language: 'bash' }
  }
  for (const key of ['file_path', 'path', 'url']) {
    const value = fields[key]
    if (typeof value === 'string' && value.length > 0) return { content: value, language: '' }
  }
  return { content: JSON.stringify(input, null, 2), language: 'json' }
}

/** Le titre d'une permission : celui du CLI, ou une phrase faite du nom de l'outil. */
export function permissionTitle(event: EventOf<'permission.requested'>, t: ReturnType<typeof useTranslate>): string {
  return event.title ?? t('permission.title.pending', { tool: event.toolName })
}

/**
 * La demande en une ligne : la question posée, ou ce que la permission ferait. La
 * quatrième colonne de l'Activité, « Pour toi » et l'indice gris d'une ligne de « Ce qui
 * t'attend » (INB-7) la lisent.
 */
export function requestSummary(request: SessionRequest, t: ReturnType<typeof useTranslate>): string {
  switch (request.kind) {
    case 'question':
      return request.event.questions[0]?.question ?? t('question.prompt.title')
    case 'permission': {
      const target = permissionTarget(request.event.input)
      return target && target.language !== 'json'
        ? `${request.event.toolName} : ${target.content}`
        : permissionTitle(request.event, t)
    }
    case 'plan':
      return t('projectActivity.request.plan')
    case 'elicitation':
      return `${request.event.serverName} : ${request.event.message}`
    case 'decision':
      return request.question
  }
}
