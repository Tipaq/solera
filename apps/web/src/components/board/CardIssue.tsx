import { ExternalLink } from 'lucide-react'
import type { CardDto, CardIssueDto } from '@solera/protocol'
import { useCardIssueComments } from '../../lib/issues'
import { locale, useTranslate } from '../../lib/i18n'
import { Markdown } from '../chat/Markdown'
import { Badge } from '@solera/ui'

/** `propriétaire/nom#12`, tel que GitHub l'écrit, lu dans l'adresse de l'issue. */
export function issueLabel(issue: CardIssueDto): string {
  const repository = /github\.com\/([^/]+\/[^/]+)\/issues\//.exec(issue.url)?.[1]
  return repository ? `${repository}#${issue.number}` : `#${issue.number}`
}

/**
 * L'issue dont la carte vient (#84) : son lien, son état, et ce que Solera n'a pas encore
 * pu y écrire. L'état suit la carte ; le reste se fait dans l'outil.
 */
export function CardIssueLink({ issue }: { issue: CardIssueDto }) {
  const t = useTranslate()
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex min-w-0 items-center gap-2">
        <a href={issue.url} target="_blank" rel="noreferrer"
          className="flex min-w-0 items-center gap-1 text-sm text-ink-soft hover:text-accent hover:underline">
          <span className="min-w-0 truncate">{issueLabel(issue)}</span>
          <ExternalLink size={12} className="shrink-0" aria-hidden />
        </a>
        <Badge tone={issue.state === 'open' ? 'positive' : 'neutral'}>
          {t(issue.state === 'open' ? 'board.card.issue.open' : 'board.card.issue.closed')}
        </Badge>
      </div>
      {issue.pushError ? (
        <p role="alert" className="text-meta text-critical">{t('board.card.issue.pushError', { error: issue.pushError })}</p>
      ) : issue.pending ? (
        <p className="text-meta text-ink-faint">{t('board.card.issue.pending')}</p>
      ) : null}
    </div>
  )
}

/**
 * La discussion de l'issue, lue en direct à l'ouverture de la carte : rien n'est stocké,
 * donc rien ne vieillit. Un outil injoignable laisse la carte lisible, sans ses commentaires.
 */
export function CardIssueComments({ card }: { card: CardDto }) {
  const t = useTranslate()
  const { data, isPending } = useCardIssueComments(card.id, card.issue !== null)
  if (!card.issue) return null

  return (
    <section className="flex flex-col gap-2" aria-label={t('board.card.issue.comments')}>
      <h3 className="text-micro font-semibold tracking-wide text-ink-faint uppercase">{t('board.card.issue.comments')}</h3>
      {isPending ? (
        <p className="text-sm text-ink-faint">{t('board.card.issue.loading')}</p>
      ) : data?.error ? (
        <p role="alert" className="text-sm text-critical">{t('board.card.issue.commentsError', { error: data.error })}</p>
      ) : !data || data.comments.length === 0 ? (
        <p className="text-sm text-ink-faint">{t('board.card.issue.noComments')}</p>
      ) : (
        <ol className="flex flex-col gap-3">
          {data.comments.map((comment) => (
            <li key={comment.id} className="flex min-w-0 flex-col gap-1 rounded-md border border-line px-3 py-2">
              <p className="flex items-center gap-2 text-meta text-ink-faint">
                <span className="font-medium text-ink-soft">@{comment.author}</span>
                <a href={comment.url} target="_blank" rel="noreferrer" className="hover:text-accent hover:underline">
                  {new Date(comment.createdAt).toLocaleDateString(locale(), { day: 'numeric', month: 'short' })}
                </a>
              </p>
              <div className="min-w-0 break-words text-sm leading-relaxed text-ink-soft">
                <Markdown text={comment.body} />
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
