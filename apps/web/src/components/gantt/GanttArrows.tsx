import { arrowPoints, elbow, type Anchor } from './scale'

/**
 * Les flèches « bloque », en coudes arrondis : de la fin de la bloquante au début de la
 * bloquée (`arrowPoints`). Discrètes au repos ; au survol d'une barre, sa chaîne
 * s'éclaire en accent, plus épaisse, et les autres s'effacent à 12 %.
 */
export function GanttArrows({
  anchors,
  width,
  height,
  chain = null,
}: {
  anchors: readonly Anchor[]
  width: number
  height: number
  /** Les cartes de la chaîne survolée (`chainOf`), ou `null` au repos. */
  chain?: ReadonlySet<string> | null
}) {
  return (
    <svg aria-hidden className="pointer-events-none absolute top-0 left-0 overflow-visible" width={width} height={height}>
      <defs>
        <marker id="gantt-arrow-rest" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto">
          <path d="M0,0.5 L8,4 L0,7.5 z" fill="var(--color-ink-faint)" />
        </marker>
        <marker id="gantt-arrow-lit" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto">
          <path d="M0,0.5 L8,4 L0,7.5 z" fill="var(--color-accent)" />
        </marker>
      </defs>
      {anchors.map((anchor) => {
        const lit = chain ? chain.has(anchor.from) && chain.has(anchor.to) : false
        const faded = chain ? !lit : false
        return (
          <path
            key={`${anchor.from}-${anchor.to}`}
            d={elbow(arrowPoints(anchor))}
            fill="none"
            stroke={lit ? 'var(--color-accent)' : 'var(--color-ink-faint)'}
            strokeWidth={lit ? 1.75 : 1.1}
            strokeOpacity={lit ? 1 : faded ? 0.12 : 0.45}
            markerEnd={lit ? 'url(#gantt-arrow-lit)' : 'url(#gantt-arrow-rest)'}
            className="transition-[stroke-opacity] duration-150"
          />
        )
      })}
    </svg>
  )
}
