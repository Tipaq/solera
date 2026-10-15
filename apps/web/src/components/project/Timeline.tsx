import type { ReactNode } from 'react'
import { cx } from '@solera/ui'
import { formatDay } from '../../lib/dates'
import { spanOf, ticksOf } from '../../lib/timeline'

/** Une barre posée sur l'axe. */
export interface TimelineBar {
  key: string
  start: number
  end: number
  label: string
  /** Ce que la barre porte à gauche de son intitulé — un numéro, une icône. */
  prefix?: ReactNode
  /** Sans date promise : la barre constate au lieu de promettre, donc elle pointille. */
  loose?: boolean
  /** En retard, ou livré : les deux seules teintes de la vue. */
  tone?: 'neutral' | 'late' | 'done'
  title?: string
  onOpen?: () => void
}

/** Une ligne de la chronologie : un jalon (F4) ou un projet (F10). */
export interface TimelineRow {
  key: string
  /** L'étiquette de gauche, rendue par l'appelant : elle diffère d'une vue à l'autre. */
  head: ReactNode
  bars: TimelineBar[]
  /** Dit pourquoi la ligne est vide, plutôt que de la laisser muette. */
  empty?: string
}

/** Largeur de la colonne des étiquettes, en rem. Tenue ici pour que l'axe s'y aligne. */
const HEAD = 'w-52'

const TONES = {
  neutral: 'bg-accent-wash text-accent',
  late: 'bg-critical/12 text-critical',
  done: 'bg-positive/12 text-positive',
} as const

/**
 * Une chronologie : des lignes, des barres, et le trait d'aujourd'hui.
 *
 * Un seul composant pour les deux vues de l'audit du 2026-10-14, qui ne diffèrent que
 * par ce qu'une ligne et une barre désignent : chez un projet (F4) les lignes sont ses
 * jalons et les barres ses cartes ; au portefeuille (F10) les lignes sont les projets et
 * les barres leurs jalons. La mécanique — la fenêtre, les graduations, le placement —
 * est la même, et elle est dans `lib/timeline.ts`.
 *
 * **Pas de couloir centré** et pas de largeur fixe : l'axe prend la place disponible et
 * les barres sont placées en pourcentage. C'est la décision 3 de l'audit, et c'est ici
 * qu'elle se paie — un couloir coûtait une semaine entière d'axe.
 *
 * Les dates ne sont pas écrites sur les barres : elles se lisent sur les graduations, en
 * haut, qui sont le seul endroit où une date est écrite. Une barre qui porterait sa date
 * la redirait à côté de sa position, qui la dit déjà.
 */
export function Timeline({ from, to, rows, now = Date.now() }: {
  from: number
  to: number
  rows: TimelineRow[]
  now?: number
}) {
  const ticks = ticksOf(from, to)
  const today = ((now - from) / (to - from)) * 100

  return (
    <div className="min-w-0">
      {/* L'axe. `sticky` : sur un projet qui a douze jalons, la ligne des dates doit
          rester lisible quand on descend, sinon une barre au bas de la vue ne se situe
          plus. */}
      <div className="sticky top-0 z-10 flex bg-canvas pb-1">
        <div className={cx('shrink-0', HEAD)} />
        <div className="relative min-w-0 flex-1">
          {ticks.map((tick) => (
            <span
              key={tick}
              className="absolute top-0 -translate-x-1/2 text-xs whitespace-nowrap text-ink-faint"
              style={{ left: `${((tick - from) / (to - from)) * 100}%` }}
            >
              {formatDay(tick)}
            </span>
          ))}
          <div className="h-5" />
        </div>
      </div>

      <div className="relative min-w-0">
        {/* Le trait d'aujourd'hui traverse toutes les lignes, posé **une seule fois** par
            un calque qui recopie la gouttière des étiquettes : un trait par ligne se
            serait décalé d'un pixel à chaque bordure, et aurait sauté sur une ligne
            vide, dont la hauteur n'est pas celle d'une barre. */}
        {today >= 0 && today <= 100 ? (
          <div aria-hidden className="pointer-events-none absolute inset-0 z-0 flex">
            <div className={cx('shrink-0', HEAD)} />
            <div className="relative min-w-0 flex-1">
              <div
                className="absolute inset-y-0 border-l border-accent/50"
                style={{ left: `${today}%` }}
              >
                <span className="-ml-px block w-max rounded-sm bg-accent px-1 text-micro text-on-accent">
                  {formatDay(now)}
                </span>
              </div>
            </div>
          </div>
        ) : null}

        {rows.map((row) => (
          <div key={row.key} className="flex min-w-0 items-stretch border-b border-line/60 last:border-b-0">
            <div className={cx('shrink-0 py-3 pr-3', HEAD)}>{row.head}</div>
            <div className="relative z-[1] min-w-0 flex-1 py-2">
              {row.bars.length === 0 ? (
                <p className="py-1.5 text-xs text-ink-faint">{row.empty}</p>
              ) : (
                row.bars.map((bar) => {
                  const span = spanOf(from, to, bar.start, bar.end)
                  const tone = bar.tone ?? 'neutral'
                  return (
                    <div key={bar.key} className="relative my-1 h-7">
                      <button
                        type="button"
                        onClick={bar.onOpen}
                        title={bar.title ?? bar.label}
                        className={cx(
                          'absolute inset-y-0 flex min-w-0 items-center gap-1.5 overflow-hidden rounded-md px-2 text-left text-xs',
                          'transition-[filter] hover:brightness-105 focus-visible:outline-2 focus-visible:outline-accent',
                          TONES[tone],
                          // Le pointillé dit « pas de date promise ». Une teinte de plus
                          // l'aurait dit aussi, mais la teinte est déjà prise par le
                          // retard et la livraison, qui sont des états, pas des manques.
                          bar.loose && 'border border-dashed border-current bg-transparent',
                        )}
                        style={{ left: `${span.left}%`, width: `${span.width}%`, minWidth: '6rem' }}
                      >
                        {bar.prefix}
                        <span className="min-w-0 truncate">{bar.label}</span>
                      </button>
                    </div>
                  )
                })
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
