import type { HandoffItem } from './handoff.js'

/**
 * Le fil rendu en note du vault : les messages, en entier et dans l'ordre.
 *
 * Pas de budget, contrairement au transfert : une note se relit à loisir, et ce qu'on
 * range doit y être en entier. Les appels d'outils restent dehors — la note garde ce
 * qui a été dit, pas la mécanique qui l'a produit — comme les fins de tour.
 */
export function renderConversationNote(
  title: string,
  items: HandoffItem[],
  roles: { user: string; assistant: string },
): string {
  const parts = [`# ${title.trim()}`]
  for (const item of items) {
    if (item.kind !== 'user' && item.kind !== 'assistant') continue
    const text = item.text.trim()
    if (!text) continue
    parts.push(`## ${item.kind === 'user' ? roles.user : roles.assistant}`, text)
  }
  return `${parts.join('\n\n')}\n`
}
