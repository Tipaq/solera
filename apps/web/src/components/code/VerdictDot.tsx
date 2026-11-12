import { cx } from '@solera/ui'
import { pluralOf, type BranchKind, type TreeVerdict, type VerdictReason } from '../../lib/code-model'
import type { MessageKey, MessageParams } from '../../lib/i18n'

/**
 * La couleur d'un verdict (T-10.2), dans l'ordre d'affichage : gris, ambre, accent
 * pulsant, accent, rouge, ambre atténué, gris foncé, cerclé gris, vert, cerclé rouge.
 * La couleur ne sert qu'au point : la phrase qui l'accompagne reste à l'encre secondaire.
 */
export const VERDICT_DOT: Record<TreeVerdict, string> = {
  root: 'bg-ink-faint',
  waiting: 'bg-caution',
  active: 'bg-accent animate-pulse',
  review: 'bg-accent',
  'merged-dirty': 'bg-critical',
  stale: 'bg-caution/60',
  wip: 'bg-ink-soft',
  empty: 'border border-ink-faint',
  clean: 'bg-positive',
  missing: 'border border-critical',
}

/** La teinte de la raison d'un arbre : rouge quand le nettoyer perdrait du travail. */
export const REASON_TONE: Record<TreeVerdict, string> = {
  root: 'text-ink-faint',
  waiting: 'text-caution',
  active: 'text-ink-faint',
  review: 'text-ink-faint',
  'merged-dirty': 'text-critical',
  stale: 'text-ink-faint',
  wip: 'text-ink-faint',
  empty: 'text-ink-faint',
  clean: 'text-positive',
  missing: 'text-critical',
}

/** Le genre d'une branche sans arbre (T-10.3). La distante prend le bleu ciel du thème. */
export const BRANCH_DOT: Record<BranchKind, string> = {
  pr: 'bg-accent',
  unmerged: 'bg-ink-soft',
  remote: 'bg-loop',
  merged: 'bg-positive',
}

const VERDICT_KEY: Record<TreeVerdict, MessageKey> = {
  root: 'code.verdict.root',
  waiting: 'code.verdict.waiting',
  active: 'code.verdict.active',
  review: 'code.verdict.review',
  'merged-dirty': 'code.verdict.mergedDirty',
  stale: 'code.verdict.stale',
  wip: 'code.verdict.wip',
  empty: 'code.verdict.empty',
  clean: 'code.verdict.clean',
  missing: 'code.verdict.missing',
}

type Translate = (key: MessageKey, params?: MessageParams) => string

/** Le nom court d'un verdict : « T'attend », « À nettoyer ». */
export function verdictLabel(t: Translate, verdict: TreeVerdict): string {
  return t(VERDICT_KEY[verdict])
}

/** La phrase d'un verdict, qui dit pourquoi l'arbre est encore là. */
export function verdictReason(t: Translate, reason: VerdictReason): string {
  const count = reason.count ?? 0
  if (reason.id === 'rootDirty' || reason.id === 'mergedDirty') {
    return t(`code.reason.${reason.id}.${pluralOf(count)}`, { count })
  }
  return t(`code.reason.${reason.id}`, { count })
}

/** Le point d'un arbre, de la couleur de son verdict. */
export function VerdictDot({ verdict, className }: { verdict: TreeVerdict; className?: string }) {
  return <span aria-hidden className={cx('size-2 shrink-0 rounded-full', VERDICT_DOT[verdict], className)} />
}

/** Le point d'une branche sans arbre, de la couleur de son genre. */
export function BranchDot({ kind, className }: { kind: BranchKind; className?: string }) {
  return <span aria-hidden className={cx('size-2 shrink-0 rounded-full', BRANCH_DOT[kind], className)} />
}
