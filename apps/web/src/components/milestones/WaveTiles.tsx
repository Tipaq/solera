import { ArrowRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import { isOpen } from '../../lib/card-state'
import { pluralOf } from '../../lib/code-model'
import { relativeDate } from '../../lib/dates'
import { useTranslate } from '../../lib/i18n'
import { nextAction, nextActionText, type MilestoneEntry } from '../../lib/milestone-model'
import { CardInfoButton } from '../cards/CardInfoButton'
import { MaturityPill } from './MaturityPill'
import { MaturitySteps } from './MaturitySteps'

/**
 * Les jalons sans dates de l'horizon, en tuiles (HOR-11, HOR-12) : « Ensuite » et « Plus
 * tard ». Toute la tuile mène à la page du jalon — une idée aussi, c'est de là qu'on
 * lance son affinage. Le pied dit la prochaine action, de quoi choisir sans ouvrir.
 */
export function WaveTiles({ projectId, entries }: { projectId: string; entries: MilestoneEntry[] }) {
  const t = useTranslate()
  return (
    <ol className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {entries.map((entry, index) => {
        const action = nextActionText(nextAction(entry), t)
        const open = entry.children.filter(isOpen).length
        return (
          <li key={entry.card.id} className="min-w-0">
            <Link
              to={`/p/${projectId}/timeline/${entry.card.number}`}
              className="flex h-full flex-col gap-2 rounded-xl border border-line p-3 transition-colors hover:border-line-strong"
            >
              <div className="flex items-center gap-2">
                <span className="text-xs text-ink-faint tabular-nums">{index + 1}.</span>
                <MaturityPill maturity={entry.maturity} entry={entry} />
                {entry.awaiting.length ? (
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-caution">
                    <span aria-hidden className="size-2 rounded-full bg-caution" />
                    {t('milestones.horizon.awaitingShort')}
                  </span>
                ) : null}
                {entry.card.dueAt !== null ? (
                  <span className="ml-auto text-xs text-ink-faint">{t('milestones.horizon.due', { when: relativeDate(entry.card.dueAt) })}</span>
                ) : null}
              </div>
              <p className="flex min-w-0 items-start gap-1 font-medium">
                <span className="min-w-0 flex-1">
                  <span className="mr-1 text-ink-faint tabular-nums">#{entry.card.number}</span>
                  {entry.card.title}
                </span>
                <CardInfoButton card={entry.card} />
              </p>
              <MaturitySteps maturity={entry.maturity} />
              <p className="text-xs text-ink-faint">
                {entry.children.length ? t(`milestones.horizon.openCards.${pluralOf(open)}`, { count: open }) : t('milestones.horizon.notSplit')}
              </p>
              <p className="mt-auto flex items-center gap-1.5 border-t border-line pt-2 text-xs">
                <span className="shrink-0 font-medium text-accent">{action.label}</span>
                <span className="min-w-0 truncate text-ink-faint">{action.detail}</span>
                <ArrowRight size={12} aria-hidden className="ml-auto shrink-0 text-ink-faint" />
              </p>
            </Link>
          </li>
        )
      })}
    </ol>
  )
}
