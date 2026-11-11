import type { SplitMode } from '@solera/protocol'

/**
 * Le premier message d'une session d'affinage (#184) : il invoque le skill
 * `affiner-un-jalon` sur le jalon, `--decouper` pour un découpage direct, puis le brief et
 * ses pièces jointes — les cartes citées, à inclure dans le jalon ou en référence, et les
 * liens. Les fichiers partent à part, en pièces jointes du message.
 *
 * Écrit pour l'agent et non traduit : c'est la ligne d'appel du skill, que l'utilisateur
 * voit et peut retoucher avant l'envoi.
 */
export function refinePrompt({
  number,
  mode,
  brief,
  cards = [],
  links = [],
}: {
  number: number
  mode: SplitMode
  brief: string
  cards?: { number: number; include: boolean }[]
  links?: string[]
}): string {
  const parts = [`/affiner-un-jalon #${number}${mode === 'direct' ? ' --decouper' : ''}`]
  if (brief.trim()) parts.push(brief.trim())
  if (cards.length > 0) {
    parts.push(
      `Cartes jointes : ${cards.map((card) => `#${card.number}${card.include ? ' (à inclure dans le jalon)' : ' (référence)'}`).join(', ')}`,
    )
  }
  if (links.length > 0) parts.push(`Liens :\n${links.map((link) => `- ${link}`).join('\n')}`)
  return parts.join('\n\n')
}
