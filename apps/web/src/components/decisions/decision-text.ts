import type { DecisionDto } from '@solera/protocol'
import type { translate } from '../../lib/i18n'

/**
 * Les mots d'une décision, dans la langue du lecteur.
 *
 * Une demande d'agent s'affiche telle qu'il l'a écrite. Une proposition de nettoyage
 * d'arbre vient de Solera, qui ne connaît pas la langue du lecteur : le serveur garde
 * des clés de choix (`clean`, `keep`) et la branche, et c'est ici qu'on les rédige.
 */
type Translate = typeof translate

/**
 * La question, recomposée pour une proposition de nettoyage. `branch` : celle de
 * l'arbre visé, null pour une demande d'agent. La sidebar et le toast n'ont qu'elle.
 */
export function decisionQuestion(question: string, branch: string | null | undefined, t: Translate): string {
  return branch ? t('decision.worktree.question', { branch }) : question
}

export function decisionContext(decision: Pick<DecisionDto, 'context' | 'worktree'>, t: Translate): string {
  return decision.worktree ? t('decision.worktree.context', { path: decision.worktree.path }) : decision.context
}

export function decisionOption(decision: Pick<DecisionDto, 'worktree'>, option: string, t: Translate): string {
  if (!decision.worktree) return option
  if (option === 'clean') return t('decision.worktree.option.clean')
  if (option === 'keep') return t('decision.worktree.option.keep')
  return option
}
