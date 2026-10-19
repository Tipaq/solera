import {
  AlertTriangle,
  Bot,
  Hand,
  Hourglass,
  Layers,
  Pause,
  Repeat,
  Waves,
  WifiOff,
  type LucideIcon,
} from 'lucide-react'
import { useTranslate } from '../../lib/i18n'
import type { Signal, SignalFamily, SignalKind, ThreadState } from '../../lib/signals'
import { cx } from '@solera/ui'

/**
 * Le rendu commun des signaux d'une conversation.
 *
 * Une seule table d'icônes et de couleurs pour toutes les surfaces : c'est ce qui rend
 * la cohérence structurelle plutôt que conventionnelle. Ajouter un signal se fait ici
 * et dans `buildSignals`, et il apparaît partout du même coup.
 */

const ICONS: Record<SignalKind, LucideIcon> = {
  running: Bot,
  subagents: Bot,
  background: Waves,
  loop: Repeat,
  queued: Layers,
  awaiting: Hand,
  interrupted: Pause,
  pending: Hourglass,
  offline: WifiOff,
  error: AlertTriangle,
}

/** La couleur appartient à la famille, jamais au signal : c'est la règle de la palette. */
const TEXT: Record<SignalFamily, string> = {
  working: 'text-accent',
  scheduled: 'text-loop',
  awaiting: 'text-caution',
  broken: 'text-critical',
}

const DOT: Record<SignalFamily, string> = {
  working: 'bg-accent',
  scheduled: 'bg-loop',
  awaiting: 'bg-caution',
  broken: 'bg-critical',
}

/**
 * Seul ce qui tourne vraiment clignote. Une boucle armée attend, une erreur ne bouge
 * plus, et une attente de réponse ne gagne rien à s'agiter.
 */
function pulses(signal: Signal): boolean {
  return signal.family === 'working'
}

export function SignalChip({ signal, onClick, labelClassName }: {
  signal: Signal
  onClick?: () => void
  /**
   * Replie l'intitulé là où la place manque — la barre du haut sur un téléphone.
   *
   * Posé par l'appelant et non ici : c'est lui qui connaît le conteneur dont la
   * largeur décide, et le signal ne sait pas où il est rendu. Le nom reste porté par
   * le `title` et par l'infobulle, l'icône et la couleur disent le reste.
   */
  labelClassName?: string
}) {
  const Icon = ICONS[signal.kind]
  const content = (
    <>
      <Icon size={11} className={cx('shrink-0', pulses(signal) && 'animate-pulse')} />
      <span className={cx('truncate', labelClassName)}>{signal.label}</span>
    </>
  )
  const className = cx(
    'flex min-w-0 shrink items-center gap-1.5 text-meta font-medium',
    TEXT[signal.family],
  )
  const title = signal.detail || signal.label

  if (!onClick) {
    return (
      <span className={className} title={title}>
        {content}
      </span>
    )
  }

  return (
    <button type="button" onClick={onClick} title={title} className={cx(className, 'hover:underline')}>
      {content}
    </button>
  )
}

/**
 * Les signaux dont le détail existe ailleurs. Le panneau latéral, onglet Agents, tient
 * déjà la liste des sous-agents avec leur fil et celle des travaux de fond. Les autres
 * n'ont rien de plus à montrer qu'une infobulle.
 */
const OPENS_PANEL = new Set<SignalKind>(['subagents', 'background'])

/** Rangée de signaux. Ne rend rien quand il n'y en a aucun, plutôt qu'une ligne vide. */
export function SignalRow({
  signals,
  onSelect,
  className,
  labelClassName,
}: {
  signals: Signal[]
  /** Appelé pour les signaux qui mènent quelque part. Les autres restent inertes. */
  onSelect?: (kind: SignalKind) => void
  className?: string
  /** Voir `SignalChip` : replie les intitulés là où la place manque. */
  labelClassName?: string
}) {
  if (signals.length === 0) return null

  return (
    <div className={cx('flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1', className)}>
      {signals.map((signal) => (
        <SignalChip
          key={signal.kind}
          signal={signal}
          labelClassName={labelClassName}
          onClick={onSelect && OPENS_PANEL.has(signal.kind) ? () => onSelect(signal.kind) : undefined}
        />
      ))}
    </div>
  )
}

/** Le même vocabulaire réduit à un point, là où il n'y a de place que pour ça. */
export function SignalDot({ signal }: { signal: Signal }) {
  return (
    <span
      aria-label={signal.label}
      title={signal.detail || signal.label}
      className={cx('size-1.5 rounded-full', DOT[signal.family], pulses(signal) && 'animate-pulse')}
    />
  )
}

const STATE_DOT: Record<ThreadState, string> = {
  working: 'bg-accent animate-pulse',
  awaiting: 'bg-caution',
  broken: 'bg-critical',
  unread: 'bg-ink',
}

const STATE_LABEL = {
  working: 'signal.running',
  awaiting: 'signal.awaiting',
  broken: 'signal.error',
  unread: 'signal.unread',
} as const satisfies Record<ThreadState, string>

/**
 * L'état d'un fil en un point, selon la charte de `threadState` : le seul rendu de la
 * colonne pour *en cours*, *attend*, *erreur* et *non lu*. Mêmes couleurs que les
 * familles de `SignalDot` — le non-lu, qui n'est pas un signal, prend l'encre.
 *
 * `labelled` à faux quand la ligne annonce déjà l'état autrement, pour qu'un lecteur
 * d'écran ne l'entende pas deux fois.
 */
export function StateDot({ state, labelled = true }: { state: ThreadState; labelled?: boolean }) {
  const t = useTranslate()
  const label = t(STATE_LABEL[state])
  return (
    <span
      aria-hidden={labelled ? undefined : true}
      aria-label={labelled ? label : undefined}
      role={labelled ? 'img' : undefined}
      title={label}
      className={cx('block size-1.5 shrink-0 rounded-full', STATE_DOT[state])}
    />
  )
}
