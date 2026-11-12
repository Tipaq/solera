import { CircleAlert } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import type { CardDto } from '@solera/protocol'
import { Button } from '@solera/ui'
import { pluralOf } from '../../lib/code-model'
import { elapsed } from '../../lib/dates'
import { useTranslate } from '../../lib/i18n'
import type { MilestoneEntry } from '../../lib/milestone-model'
import { useSettleMilestone } from '../../lib/milestones'
import { useCurrentUser } from '../../lib/session'
import { cycleLinks, settleCount } from '../../lib/settle'

/**
 * **À régler avant de partir** (#196, spec jalons RGL) : ce qui retient un jalon en
 * dehors de sa session d'affinage, réglé sur place — préciser une carte, l'accepter,
 * rompre un cycle. Absent quand il n'y a rien : les questions et le brouillon sont dans
 * le résumé d'affinage, au-dessus.
 *
 * Une seule liste, et sans la demande d'une session bloquée (spec §2.6-1) : la carte
 * qu'elle attend passe en ambre dans les vagues, et « Ce qui t'attend » la porte.
 */
export function SettleList({ projectId, entry }: { projectId: string; entry: MilestoneEntry }) {
  const t = useTranslate()
  const settle = useSettleMilestone(projectId)
  const count = settleCount(entry)
  if (count === 0) return null
  const links = cycleLinks(entry.cycle)

  return (
    <section aria-label={t('milestone.settle.title')} className="flex flex-col gap-2">
      <div className="flex items-baseline gap-2">
        <h3 className="text-sm font-semibold text-ink">{t('milestone.settle.title')}</h3>
        <span className="text-xs text-ink-faint">{t(`milestone.settle.count.${pluralOf(count)}`, { count })}</span>
      </div>
      <ul className="flex flex-col divide-y divide-line overflow-hidden rounded-xl border border-line">
        {entry.toClarify.map((card) => (
          <ClarifyLine key={card.id} card={card} clarify={settle.clarify} />
        ))}
        {entry.notAccepted.map((card) => (
          <li key={card.id} className="flex items-center gap-2 px-3 py-2.5 text-sm">
            <CircleAlert size={14} aria-hidden className="shrink-0 text-ink-faint" />
            <span className="min-w-0 flex-1 truncate text-ink">
              #{card.number} {card.title}
            </span>
            <span className="text-xs text-ink-faint">{t('milestone.settle.notAccepted')}</span>
            <Button
              size="sm"
              variant="secondary"
              disabled={settle.accept.isPending && settle.accept.variables === card.id}
              onClick={() => settle.accept.mutate(card.id)}
            >
              {t('milestone.settle.accept')}
            </Button>
          </li>
        ))}
        {links.length > 0 ? (
          <li className="flex flex-col gap-1.5 px-3 py-2.5 text-sm">
            <span className="flex items-center gap-2 text-ink">
              <CircleAlert size={14} aria-hidden className="shrink-0 text-critical" />
              {t('milestone.settle.cycle')}
            </span>
            {links.map(({ card, blocker }) => (
              <span key={`${blocker.id}-${card.id}`} className="flex items-center gap-2 pl-6 text-xs text-ink-soft">
                {t('milestone.settle.blocks', { blocker: blocker.number, blocked: card.number })}
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={settle.unblock.isPending}
                  onClick={() => settle.unblock.mutate({ blockerId: blocker.id, blockedId: card.id })}
                >
                  {t('milestone.settle.unblock')}
                </Button>
              </span>
            ))}
          </li>
        ) : null}
        {settle.accept.isError || settle.unblock.isError ? (
          <li role="alert" className="px-3 py-2 text-xs text-critical">
            {t('milestone.settle.failed', { error: (settle.accept.error ?? settle.unblock.error)?.message ?? '' })}
          </li>
        ) : null}
      </ul>
    </section>
  )
}

/**
 * Une carte à préciser (RGL-3) : la précision se tape sur place. Partie, la ligne dit où
 * (RGL-6), puis s'en va quand la carte n'est plus à préciser.
 */
function ClarifyLine({ card, clarify }: { card: CardDto; clarify: ReturnType<typeof useSettleMilestone>['clarify'] }) {
  const t = useTranslate()
  const { data: me } = useCurrentUser()
  const [sent, setSent] = useState<{ text: string; where: 'session' | 'description' } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const busy = clarify.isPending && clarify.variables?.card.id === card.id
  return (
    <Answerable
      icon={<CircleAlert size={14} aria-hidden className="text-caution" />}
      title={`#${card.number} ${card.title}`}
      meta={card.toClarifySince === null ? '' : t('milestone.settle.toClarifySince', { duration: elapsed(card.toClarifySince) })}
      placeholder={t('milestone.settle.clarifyPlaceholder')}
      cta={t('milestone.settle.clarify')}
      busy={busy}
      error={error}
      done={
        sent
          ? t(sent.where === 'session' ? 'milestone.settle.sentSession' : 'milestone.settle.sentDescription', { text: sent.text })
          : null
      }
      onSubmit={(text) => {
        setError(null)
        clarify.mutate(
          { card, text, author: me?.displayName ?? me?.username ?? '' },
          {
            onSuccess: (where) => setSent({ text, where }),
            onError: (failure) => setError(t('milestone.settle.failed', { error: failure.message })),
          },
        )
      }}
    />
  )
}

/** Une ligne qui se règle par un mot : son titre, sa durée, puis le champ et son bouton. */
function Answerable({
  icon,
  title,
  meta,
  placeholder,
  cta,
  busy,
  error,
  done,
  onSubmit,
}: {
  icon: ReactNode
  title: string
  meta: string
  placeholder: string
  cta: string
  busy: boolean
  error: string | null
  /** Ce qui est parti, une fois parti. */
  done: string | null
  onSubmit: (text: string) => void
}) {
  const [text, setText] = useState('')
  return (
    <li className="flex flex-col gap-2 px-3 py-2.5">
      <div className="flex flex-wrap items-start gap-x-2 gap-y-0.5 text-sm">
        <span className="mt-0.5 shrink-0">{icon}</span>
        <span className="min-w-0 flex-1 basis-48 text-ink">{title}</span>
        <span className="shrink-0 pl-6 text-xs text-ink-faint sm:pl-0">{meta}</span>
      </div>
      {done ? (
        <p className="pl-6 text-xs text-positive">{done}</p>
      ) : (
        <form
          className="flex gap-2 pl-6"
          onSubmit={(event) => {
            event.preventDefault()
            if (text.trim() && !busy) onSubmit(text.trim())
          }}
        >
          <input
            value={text}
            aria-label={`${placeholder} · ${title}`}
            placeholder={placeholder}
            onChange={(event) => setText(event.target.value)}
            className="min-w-0 flex-1 rounded-lg border border-line bg-canvas px-2.5 py-1.5 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-accent"
          />
          <Button size="sm" variant="secondary" type="submit" disabled={!text.trim() || busy}>
            {cta}
          </Button>
        </form>
      )}
      {error ? (
        <p role="alert" className="pl-6 text-xs text-critical">
          {error}
        </p>
      ) : null}
    </li>
  )
}
