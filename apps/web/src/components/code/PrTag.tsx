import { GitPullRequest } from 'lucide-react'
import type { PullRequestBadgeState } from '@solera/protocol'
import { cx } from '@solera/ui'
import type { CodePr } from '../../lib/code-model'
import { useTranslate } from '../../lib/i18n'

/** La teinte du texte d'un état de PR : la couleur dit l'état, sans pastille pleine. */
export const PR_TEXT: Record<PullRequestBadgeState, string> = {
  draft: 'text-ink-faint',
  checks: 'text-ink-soft',
  failing: 'text-critical',
  ready: 'text-positive',
  merged: 'text-ink-faint',
}

/**
 * Une PR en une ligne : l'icône, le numéro, l'état en toutes lettres. Un lien vers la
 * forge quand on en connaît l'adresse ; sinon du texte, qui n'a pas l'air cliquable.
 */
export function PrTag({ pr }: { pr: CodePr | null }) {
  const t = useTranslate()
  if (!pr) return <span className="text-xs text-ink-faint">{t('code.pr.none')}</span>
  const body = (
    <>
      <GitPullRequest size={12} className="shrink-0" />
      <span className="tabular-nums">#{pr.number}</span>
      <span>{t(`code.pr.${pr.state}`)}</span>
    </>
  )
  const shape = cx('inline-flex items-center gap-1 text-xs', PR_TEXT[pr.state])
  if (!pr.url) return <span className={shape}>{body}</span>
  return (
    <a
      href={pr.url}
      target="_blank"
      rel="noreferrer"
      onClick={(event) => event.stopPropagation()}
      className={cx(shape, 'hover:underline')}
    >
      {body}
    </a>
  )
}
