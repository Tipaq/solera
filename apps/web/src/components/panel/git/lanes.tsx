import { useState, useSyncExternalStore } from 'react'
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

/** Les huit teintes des couloirs, déclarées dans les jetons. */
const COLORS = 8

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

/**
 * La couleur d'une course : celle de sa branche quand elle en a une.
 *
 * Tirée du nom et non du rang du couloir : `main` garde sa teinte quel que soit le
 * couloir qu'il occupe dans la fenêtre, et d'un rechargement à l'autre. Une course sans
 * nom prend celle de son numéro.
 */
export function runColor(run: number, names: (string | null)[]): string {
  const name = names[run]
  let index = run
  if (name) {
    let hash = 0
    for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) | 0
    index = Math.abs(hash)
  }
  return `var(--sg-lane-${index % COLORS})`
}

/**
 * La course survolée, tenue hors de l'état de la liste.
 *
 * Survoler ne doit redessiner aucune des centaines de rangées : seuls l'en-tête et la
 * règle de surlignage s'abonnent. Les rangées n'en reçoivent que `set`, qui ne change
 * jamais.
 */
export interface RunHover {
  get: () => number | null
  set: (run: number | null) => void
  subscribe: (listener: () => void) => () => void
}

export function useRunHover(): RunHover {
  const [store] = useState<RunHover>(() => {
    let current: number | null = null
    const listeners = new Set<() => void>()
    return {
      get: () => current,
      set: (run) => {
        if (run === current) return
        current = run
        for (const listener of listeners) listener()
      },
      subscribe: (listener) => {
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      },
    }
  })
  return store
}

export const useHoveredRun = (hover: RunHover): number | null =>
  useSyncExternalStore(hover.subscribe, hover.get)

/**
 * Le surlignage d'une course au survol, posé en une règle de style plutôt que par un
 * état de chaque rangée : seul le sélecteur change.
 */
export function RunHighlight({ scope, hover }: { scope: string; hover: RunHover }) {
  const run = useHoveredRun(hover)
  if (run === null) return null
  return (
    <style>
      {`[data-graph="${scope}"] [data-run] { opacity: 0.25; }`}
      {`[data-graph="${scope}"] [data-run="${run}"] { opacity: 1; stroke-width: 2.5; }`}
    </style>
  )
}

/** Les quatre natures de nœud : commit, fusion, en cours, remise. */
function Node({ node, x, stroke }: { node: GraphNodeDto; x: number; stroke: string }) {
  const y = ROW_HEIGHT / 2

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

export function Lanes({ node, lanes, runs, onHoverRun }: {
  node: GraphNodeDto
  lanes: number
  /** Le nom de chaque course, pour la couleur. */
  runs: (string | null)[]
  /** Un trait survolé désigne sa course ; null quand le pointeur le quitte. */
  onHoverRun: (run: number | null) => void
}) {
  const step = laneStep(lanes)
  const width = laneWidth(lanes)
  const middle = ROW_HEIGHT / 2
  const x = laneX(node.lane, step)
  const own = runColor(node.run, runs)

  /**
   * Un trait de 1,5 px ne se vise pas : chacun reçoit une zone de survol invisible de
   * 8 px, posée sous le dessin, qui désigne sa course.
   */
  const hit = (key: string, run: number, shape: { d: string } | { x1: number; y1: number; x2: number; y2: number }) => {
    const common = {
      key: `hit-${key}`,
      stroke: 'transparent',
      strokeWidth: 8,
      fill: 'none',
      pointerEvents: 'stroke' as const,
      onPointerEnter: () => onHoverRun(run),
      onPointerLeave: () => onHoverRun(null),
    }
    return 'd' in shape ? <path {...common} d={shape.d} /> : <line {...common} {...shape} />
  }

  const throughs = node.through.map((lane, index) => ({ lane, run: node.throughRuns[index] ?? lane }))
  const joins = node.joins.map((lane, index) => ({ lane, run: node.joinRuns[index] ?? lane }))
  const collapses = node.collapses.map((lane, index) => ({ lane, run: node.collapseRuns[index] ?? lane }))
  const curve = (lane: number, from: number) =>
    `M ${laneX(lane, step)} ${from} C ${laneX(lane, step)} ${middle}, ${x} ${middle}, ${x} ${middle}`
  const ownLine = { x1: x, y1: node.tip ? middle : 0, x2: x, y2: node.root ? middle : ROW_HEIGHT }

  return (
    <svg width={width} height={ROW_HEIGHT} className="shrink-0">
      {throughs.map(({ lane, run }) => hit(`through-${lane}`, run, {
        x1: laneX(lane, step), y1: 0, x2: laneX(lane, step), y2: ROW_HEIGHT,
      }))}
      {joins.map(({ lane, run }) => hit(`join-${lane}`, run, { d: curve(lane, ROW_HEIGHT) }))}
      {collapses.map(({ lane, run }) => hit(`collapse-${lane}`, run, { d: curve(lane, 0) }))}
      {hit('own', node.run, ownLine)}

      {throughs.map(({ lane, run }) => (
        <line
          key={lane}
          data-run={run}
          x1={laneX(lane, step)}
          y1={0}
          x2={laneX(lane, step)}
          y2={ROW_HEIGHT}
          stroke={runColor(run, runs)}
          strokeWidth={1.5}
          opacity={0.7}
          pointerEvents="none"
        />
      ))}

      {/* Le couloir du nœud : d'en haut sauf s'il commence ici, jusqu'en bas sauf s'il
          s'arrête ici. C'est ce qui distingue une tête de branche d'un commit du milieu. */}
      <line
        data-run={node.run}
        {...ownLine}
        stroke={own}
        strokeWidth={1.5}
        opacity={0.7}
        pointerEvents="none"
      />

      {joins.map(({ lane, run }) => (
        <path
          key={`join-${lane}`}
          data-run={run}
          d={curve(lane, ROW_HEIGHT)}
          fill="none"
          stroke={runColor(run, runs)}
          strokeWidth={1.5}
          opacity={0.7}
          pointerEvents="none"
        />
      ))}

      {collapses.map(({ lane, run }) => (
        <path
          key={`collapse-${lane}`}
          data-run={run}
          d={curve(lane, 0)}
          fill="none"
          stroke={runColor(run, runs)}
          strokeWidth={1.5}
          opacity={0.7}
          pointerEvents="none"
        />
      ))}

      <g data-run={node.run} pointerEvents="none">
        <Node node={node} x={x} stroke={own} />
      </g>
    </svg>
  )
}
