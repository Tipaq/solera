import { GitMerge, GitPullRequest, GitPullRequestDraft } from 'lucide-react'
import type { ProjectPullRequestDto, PullRequestBadgeState } from '@solera/protocol'
import { cx } from '@solera/ui'
import { useTranslate, type MessageKey } from '../../lib/i18n'

/**
 * Les tons de l'agent view, et « fusionnée » dans celui de la boucle (`--color-loop`) :
 * pas de jeton de plus (tranché par Tim le 2026-10-25).
 */
const TONE: Record<PullRequestBadgeState, string> = {
  draft: 'bg-sunken text-ink-soft',
  checks: 'bg-caution/12 text-caution',
  failing: 'bg-critical/12 text-critical',
  ready: 'bg-positive/12 text-positive',
  merged: 'bg-loop/12 text-loop',
}

const WORD: Record<PullRequestBadgeState, MessageKey> = {
  draft: 'projectActivity.pr.draft',
  checks: 'projectActivity.pr.checks',
  failing: 'projectActivity.pr.failing',
  ready: 'projectActivity.pr.ready',
  merged: 'projectActivity.pr.merged',
}

const REVIEW: Partial<Record<NonNullable<ProjectPullRequestDto['review']>, MessageKey>> = {
  reviewing: 'projectActivity.pr.review.reviewing',
  changes: 'projectActivity.pr.review.changes',
  approved: 'projectActivity.pr.review.approved',
  to_merge: 'projectActivity.pr.review.approved',
  escalated: 'projectActivity.pr.review.escalated',
  merge_failed: 'projectActivity.pr.review.mergeFailed',
}

/**
 * Le badge d'une PR : `#N` et un mot (planche B4). Sur la ligne d'une session, et dans
 * l'en-tête d'un worktree quand la liste est groupée par worktree (B3).
 *
 * Il ne mène nulle part : sur une ligne, c'est toute la ligne qui mène au fil, et un
 * lien dans un lien n'est pas du HTML valide. Le survol dit ce que le mot résume : le
 * titre, les checks tombés par leur nom, et la revue de Solera s'il y en a une.
 */
export function PrBadge({ pr, className }: { pr: ProjectPullRequestDto; className?: string }) {
  const t = useTranslate()
  const Icon = pr.state === 'merged' ? GitMerge : pr.state === 'draft' ? GitPullRequestDraft : GitPullRequest
  const review = pr.review ? REVIEW[pr.review] : undefined
  const detail = [
    t('projectActivity.pr.title', { number: pr.number, title: pr.title }),
    pr.checks.failed.length > 0
      ? t('projectActivity.pr.failedChecks', { names: pr.checks.failed.join(', ') })
      : pr.checks.pending > 0
        ? t('projectActivity.pr.pendingChecks', { count: pr.checks.pending })
        : null,
    review ? t(review) : null,
  ]
    .filter(Boolean)
    .join('\n')

  return (
    <span
      title={detail}
      className={cx(
        'inline-flex max-w-full items-center gap-1 rounded-md px-1.5 py-0.5 text-xs whitespace-nowrap',
        TONE[pr.state],
        className,
      )}
    >
      <Icon size={12} aria-hidden className="shrink-0" />
      <span className="font-mono tabular-nums">#{pr.number}</span>
      <span className="truncate">{t(WORD[pr.state])}</span>
    </span>
  )
}
