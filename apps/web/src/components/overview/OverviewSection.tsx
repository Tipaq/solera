import { ArrowUpRight } from 'lucide-react'
import { useId, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { cx } from '@solera/ui'

/** Le lien d'un titre de bloc vers l'onglet qui en dit tout : petit, gris, ↗. */
export function MoreLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link
      to={to}
      className="inline-flex items-center gap-1 rounded text-xs text-ink-faint hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"
    >
      {children}
      <ArrowUpRight size={12} aria-hidden />
    </Link>
  )
}

/**
 * Un bloc de l'Aperçu : un intitulé petit et gris, un lien à droite quand un onglet en
 * dit plus, puis des lignes. Pas de cadre : c'est l'écart entre les blocs qui sépare, et
 * la seule surface teintée de la page est le phare des jalons (`projet.md` A-1.3).
 *
 * `caps` : l'intitulé en capitales (« ACTIONS », A-5.1).
 */
export function OverviewSection({
  title,
  more,
  caps = false,
  children,
}: {
  title: string
  more?: ReactNode
  caps?: boolean
  children: ReactNode
}) {
  const id = useId()
  return (
    <section aria-labelledby={id} className="flex min-w-0 flex-col">
      <div className="mb-2 flex h-6 items-center gap-3">
        <h2 id={id} className={cx('text-xs font-medium text-ink-faint', caps && 'tracking-wide uppercase')}>
          {title}
        </h2>
        {more ? <span className="ml-auto">{more}</span> : null}
      </div>
      {children}
    </section>
  )
}
