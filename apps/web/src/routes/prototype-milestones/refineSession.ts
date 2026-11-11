/* PROTOTYPE — jetable (branche proto/page-projet). Ne pas fusionner dans main.
 *
 * L'affinage d'un jalon se fait **dans une session** : « Affiner avec un agent » ouvre une
 * conversation du projet, rattachée à la carte du jalon, dont le premier message invoque
 * le skill `/affiner-un-jalon` avec le brief et ce qu'on y a joint. `--decouper` demande
 * un découpage direct (le brief suffit). La session finit par `propose_cards`, dont le
 * brouillon s'affiche dans la session et sur la page du jalon.
 */
import type { CardDto } from '@solera/protocol'

export type RefineIntent = 'refine' | 'split'

/** Le premier message de la session d'affinage. */
export function refinePrompt({
  number,
  intent,
  brief,
  cards = [],
  links = [],
}: {
  /** Le numéro de la carte-jalon ; `null` tant qu'elle n'existe pas. */
  number: number | null
  intent: RefineIntent
  brief?: string
  cards?: { number: number; include: boolean }[]
  links?: string[]
}): string {
  const head = `/affiner-un-jalon${number !== null ? ` #${number}` : ''}${intent === 'split' ? ' --decouper' : ''}`
  const parts = [head]
  if (brief?.trim()) parts.push(brief.trim())
  if (cards.length) {
    parts.push(
      `Cartes jointes : ${cards.map((card) => `#${card.number}${card.include ? ' (à inclure dans le jalon)' : ' (référence)'}`).join(', ')}`,
    )
  }
  if (links.length) parts.push(`Liens :\n${links.map((link) => `- ${link}`).join('\n')}`)
  return parts.join('\n\n')
}

/**
 * Où mène « Affiner » : la session d'affinage déjà ouverte sur la carte s'il y en a une,
 * sinon un brouillon de conversation rattaché à la carte, message pré-rempli. Une carte
 * de démo n'existe pas : le brouillon part sans `card=`, avec un repère qui le dit.
 */
export function refineSessionPath(
  projectId: string,
  card: Pick<CardDto, 'id' | 'number' | 'conversations'>,
  prompt: string,
): string {
  const live = card.conversations.find((conversation) => conversation.archivedAt === null)
  if (live && !card.id.startsWith('demo-')) return `/p/${projectId}/c/${live.id}`
  const params = new URLSearchParams({ prompt })
  if (card.id.startsWith('demo-')) params.set('proto-carte', String(card.number))
  else params.set('card', card.id)
  return `/p/${projectId}/c/new?${params.toString()}`
}

/** Un jalon pas encore créé (hors démo, rien n'est écrit) : le brouillon le dit. */
export function newMilestoneSessionPath(projectId: string, prompt: string): string {
  return `/p/${projectId}/c/new?${new URLSearchParams({ prompt, 'proto-carte': 'nouvelle' }).toString()}`
}
