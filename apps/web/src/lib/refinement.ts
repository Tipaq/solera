import type { SplitMode } from '@solera/protocol'

/**
 * Le premier message d'une session d'affinage (#184) : il invoque le skill
 * `affiner-un-jalon` sur le jalon, `--decouper` pour un découpage direct, puis le brief.
 * Écrit pour l'agent et non traduit : c'est la ligne d'appel du skill, que l'utilisateur
 * voit et peut retoucher avant l'envoi.
 */
export function refinePrompt({ number, mode, brief }: { number: number; mode: SplitMode; brief: string }): string {
  const head = `/affiner-un-jalon #${number}${mode === 'direct' ? ' --decouper' : ''}`
  const text = brief.trim()
  return text ? `${head}\n\n${text}` : head
}
