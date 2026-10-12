import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { cx } from '@solera/ui'

export type DemandTone = 'caution' | 'accent' | 'neutral'

const TONES: Record<DemandTone, { box: string; head: string }> = {
  caution: { box: 'border-caution/35 bg-caution/10', head: 'text-caution' },
  accent: { box: 'border-accent/35 bg-accent-wash', head: 'text-accent' },
  neutral: { box: 'border-line bg-transparent', head: 'text-ink-faint' },
}

/**
 * Une tuile du bandeau d'un lieu : ce qui réclame, et le lien qui y mène.
 *
 * Elle ne se rend qu'avec un compte non nul — c'est l'appelant qui l'omet, parce
 * qu'une tuile à zéro est un inventaire et que le bandeau n'en porte pas. L'intitulé
 * est au-dessus et le chiffre dessous, en grand : on lit d'abord *quoi*, puis
 * *combien*, et les quatre intitulés restent alignés quelle que soit la largeur du
 * nombre.
 */
export function DemandTile({
  to,
  tone,
  icon,
  label,
  count,
  detail,
  onClick,
}: {
  to: string
  tone: DemandTone
  icon: ReactNode
  label: string
  count: number
  /** Ce qui qualifie le chiffre : « depuis 1 h », « carte #5 », « sur main ». */
  detail: ReactNode
  /** Ce qu'il faut préparer avant d'arriver — ouvrir le panneau sur le bon onglet. */
  onClick?: () => void
}) {
  const skin = TONES[tone]
  return (
    <Link
      to={to}
      onClick={onClick}
      className={cx(
        'flex min-w-0 flex-col gap-2 rounded-xl border px-3.5 py-3 transition-colors',
        'hover:border-line-strong focus-visible:outline-2 focus-visible:outline-accent',
        skin.box,
      )}
    >
      <span className={cx('flex min-w-0 items-center gap-1.5 text-xs', skin.head)}>
        <span className="shrink-0">{icon}</span>
        <span className="truncate">{label}</span>
      </span>
      <span className="flex min-w-0 items-baseline gap-1.5">
        <span className="text-xl font-semibold tabular-nums text-ink">{count}</span>
        <span className="min-w-0 truncate text-xs text-ink-faint">{detail}</span>
      </span>
    </Link>
  )
}
