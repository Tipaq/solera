import type { GraphNodeDto } from '@solera/protocol'

/**
 * Le couloir d'une rangée du graphe.
 *
 * Dessiné rangée par rangée plutôt qu'en un SVG d'ensemble : chaque ligne reste une
 * ligne HTML, donc rien ne se décale si un message passe sur deux lignes, et une
 * rangée ajoutée en tête ne redessine pas le reste.
 *
 * Les couloirs et leurs liens sont calculés par le serveur (`git-graph.ts`) : le
 * client n'a pas les parents des commits qu'il n'a pas reçus.
 */

/** Cinq teintes, reprises ensuite : au-delà, la couleur ne distingue plus rien. */
const COLORS = [
  'var(--sg-accent)',
  'var(--sg-positive)',
  'var(--sg-caution)',
  'var(--sg-loop)',
  'var(--sg-critical)',
]

export const ROW_HEIGHT = 30

/**
 * L'écart entre deux couloirs se resserre quand il y en a beaucoup.
 *
 * Un dépôt à douze worktrees vivants — le nôtre — occuperait sinon 180 px avant le
 * premier caractère du message, sur un panneau qui peut n'en faire que 320.
 */
export function laneStep(lanes: number): number {
  if (lanes > 8) return 8
  if (lanes > 5) return 11
  return 14
}

export const laneX = (lane: number, step: number): number => 9 + lane * step
export const laneWidth = (lanes: number): number => laneX(lanes - 1, laneStep(lanes)) + 9

const color = (lane: number): string => COLORS[lane % COLORS.length] as string

/** Les quatre natures de nœud : commit, fusion, en cours, remise. */
function Node({ node, x }: { node: GraphNodeDto; x: number }) {
  const y = ROW_HEIGHT / 2
  const stroke = color(node.lane)

  if (node.kind === 'stash') {
    return (
      <rect
        x={x - 4}
        y={y - 4}
        width={8}
        height={8}
        transform={`rotate(45 ${x} ${y})`}
        fill="var(--sg-surface)"
        stroke={stroke}
        strokeWidth={1.8}
      />
    )
  }
  if (node.kind === 'merge') {
    return <circle cx={x} cy={y} r={4.5} fill="var(--sg-surface)" stroke={stroke} strokeWidth={2.5} />
  }
  if (node.kind === 'working') {
    return (
      <circle
        cx={x}
        cy={y}
        r={4.5}
        fill="var(--sg-surface)"
        stroke={stroke}
        strokeWidth={1.5}
        strokeDasharray="2 2"
      />
    )
  }
  return <circle cx={x} cy={y} r={4.5} fill={stroke} />
}

export function Lanes({ node, lanes }: { node: GraphNodeDto; lanes: number }) {
  const step = laneStep(lanes)
  const width = laneWidth(lanes)
  const middle = ROW_HEIGHT / 2
  const x = laneX(node.lane, step)

  return (
    <svg width={width} height={ROW_HEIGHT} className="shrink-0" aria-hidden>
      {node.through.map((lane) => (
        <line
          key={lane}
          x1={laneX(lane, step)}
          y1={0}
          x2={laneX(lane, step)}
          y2={ROW_HEIGHT}
          stroke={color(lane)}
          strokeWidth={1.5}
          opacity={0.7}
        />
      ))}

      {/* Le couloir du nœud : d'en haut sauf s'il commence ici, jusqu'en bas sauf s'il
          s'arrête ici. C'est ce qui distingue une tête de branche d'un commit du milieu. */}
      <line
        x1={x}
        y1={node.tip ? middle : 0}
        x2={x}
        y2={node.root ? middle : ROW_HEIGHT}
        stroke={color(node.lane)}
        strokeWidth={1.5}
        opacity={0.7}
      />

      {node.joins.map((lane) => (
        <path
          key={`join-${lane}`}
          d={`M ${laneX(lane, step)} ${ROW_HEIGHT} C ${laneX(lane, step)} ${middle}, ${x} ${middle}, ${x} ${middle}`}
          fill="none"
          stroke={color(lane)}
          strokeWidth={1.5}
          opacity={0.7}
        />
      ))}

      {node.collapses.map((lane) => (
        <path
          key={`collapse-${lane}`}
          d={`M ${laneX(lane, step)} 0 C ${laneX(lane, step)} ${middle}, ${x} ${middle}, ${x} ${middle}`}
          fill="none"
          stroke={color(lane)}
          strokeWidth={1.5}
          opacity={0.7}
        />
      ))}

      <Node node={node} x={x} />
    </svg>
  )
}
