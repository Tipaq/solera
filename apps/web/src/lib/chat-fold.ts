export * from '@solera/protocol/chat-state'
import {
  isAwaitingUser,
  type ChatItem,
  type ChatState,
  type NoticeItem,
} from '@solera/protocol/chat-state'
import { locale, translate } from './i18n'

/**
 * Le fold du journal vit dans `@solera/protocol/chat-state`, partagé avec la
 * projection du serveur. Reste ici ce qui se dit dans la langue de l'interface.
 */

/** Tokens en milliers, la maille sous laquelle le chiffre n'apprend plus rien. */
function thousands(tokens: number): string {
  return `${Math.round(tokens / 1000)} k`
}

/**
 * Tokens au token près, groupés selon la langue.
 *
 * Distinct de `thousands` : celui-ci mesure une taille qu'on lit d'un coup d'œil, alors
 * qu'un compteur qui avance est lu deux fois de suite, et c'est l'écart entre les deux
 * lectures qui l'anime. Arrondi au millier, il affiche « 0 k » un long moment puis saute
 * à « 1 k » : le chiffre est juste, mais il ne bouge plus, donc il ne prouve plus rien.
 */
function exactTokens(tokens: number): string {
  return tokens.toLocaleString(locale())
}

/**
 * Ce que la compaction a réellement libéré, dans la limite de ce que le CLI en dit :
 * Claude donne les deux tailles, Codex n'en donne aucune.
 */
function describeCompaction(preTokens: number | null, postTokens: number | null): string {
  if (preTokens === null) return translate('activity.compaction.done')
  if (postTokens === null) {
    return translate('activity.compaction.doneWithPre', { tokens: thousands(preTokens) })
  }
  return translate('activity.compaction.doneWithBoth', {
    pre: thousands(preTokens),
    post: thousands(postTokens),
  })
}

/**
 * Ce que l'agent est en train de faire, ou null quand il n'y a rien à signaler.
 *
 * Dérivé du seul journal, comme tout le reste de l'affichage : c'est ce qui permet à
 * l'indicateur de rester juste après un rechargement, sans état parallèle à tenir.
 * Une demande de permission en attente ne renvoie rien, la demande elle-même étant
 * déjà l'information.
 */
export function describeActivity(state: ChatState): string | null {
  // Avant le tour : la compaction déclenchée depuis le menu n'ouvre pas toujours un
  // tour, et c'est de toute façon elle qu'il faut nommer quand les deux coexistent.
  // La taille annoncée est celle d'avant, la seule connue tant qu'elle n'est pas finie.
  if (state.compacting) {
    return state.context
      ? translate('activity.compacting.tokens', { tokens: thousands(state.context.usedTokens) })
      : translate('activity.compacting')
  }
  if (!state.turnRunning) return null

  // Le compteur prime sur le dernier élément du fil : il n'est renseigné que pendant
  // une réflexion en cours, et il en dit plus que le « Réflexion » nu déduit d'un outil
  // déjà rendu. C'est aussi le seul signe de vie quand le modèle cache son texte.
  if (state.thinkingTokens !== null) {
    return translate('activity.thinking.tokens', { tokens: exactTokens(state.thinkingTokens) })
  }

  return activityOf(state.items, null)
}

/**
 * Ce que fait l'auteur d'un fil, d'après son dernier élément.
 *
 * `thread` désigne l'auteur : `null` pour l'agent principal, l'appel de spawn pour un
 * sous-agent. Sans ce filtre, un sous-agent occupé fait dire au fil principal qu'il
 * cherche dans les fichiers alors qu'il attend son rapport.
 */
export function activityOf(items: ChatItem[], thread: string | null): string | null {
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const item = items[i]
    if (!item) continue
    if ((item.kind === 'tool' || item.kind === 'message') && item.parentToolCallId !== thread) {
      continue
    }

    if (isAwaitingUser(item)) return null
    if (
      item.kind === 'permission' ||
      item.kind === 'question' ||
      item.kind === 'elicitation' ||
      item.kind === 'plan'
    ) {
      return translate('message.thinking.label')
    }
    if (item.kind === 'tool') {
      return item.status === 'running'
        ? translate('activity.toolRunning', { name: item.name })
        : translate('message.thinking.label')
    }
    if (item.kind === 'message') {
      if (item.role === 'user') return translate('message.thinking.label')
      if (item.streamingText) return translate('activity.writing')
      return translate('message.thinking.label')
    }
  }

  return translate('message.thinking.label')
}

/** Le texte d'un repère, traduit au rendu quand le fold n'en a gardé que la clé. */
export function noticeText(item: NoticeItem): string {
  const value = item.translation
  if (!value) return item.text
  if (value.key === 'compaction') return describeCompaction(value.pre, value.post)
  return translate(value.key, value)
}
