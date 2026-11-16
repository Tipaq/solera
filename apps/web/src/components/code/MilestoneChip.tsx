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

/**
 * « ⚑ Jalon #n titre » : le jalon d'une ligne du fil, en accent, son titre à l'encre
 * pâle. Un lien vers sa page ; il vit à côté du lien de sa ligne, jamais dedans.
 */
export function MilestoneTag({ milestone, to }: { milestone: { number: number; title: string }; to: string }) {
  const t = useTranslate()
  return (
    <Link
      to={to}
      title={milestone.title}
      className="inline-flex max-w-full min-w-0 items-center gap-1 rounded px-1.5 py-0.5 text-micro text-accent hover:bg-accent-wash/50"
    >
      <Flag size={11} aria-hidden className="shrink-0" />
      <span className="shrink-0 tabular-nums">{t('code.milestone', { number: milestone.number })}</span>
      <span className="min-w-0 truncate text-ink-faint">{milestone.title}</span>
    </Link>
  )
}
