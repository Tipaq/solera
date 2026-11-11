import { Flag } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useTranslate } from '../../lib/i18n'

const SHAPE = 'inline-flex shrink-0 items-center gap-1 rounded-full bg-surface-high px-1.5 py-0.5 text-meta text-ink-soft'

/**
 * « ⚑ Jalon #n » : le jalon d'une carte, à côté d'elle. Un lien quand on sait où mener ;
 * sinon une étiquette, qui n'a pas l'air cliquable.
 */
export function MilestoneChip({ milestone, to }: { milestone: { number: number; title: string }; to?: string }) {
  const t = useTranslate()
  const body = (
    <>
      <Flag size={10} />
      {t('code.milestone', { number: milestone.number })}
    </>
  )
  if (!to) {
    return (
      <span title={milestone.title} className={SHAPE}>
        {body}
      </span>
    )
  }
  return (
    <Link to={to} title={milestone.title} onClick={(event) => event.stopPropagation()} className={`${SHAPE} hover:bg-line hover:text-ink`}>
      {body}
    </Link>
  )
}
