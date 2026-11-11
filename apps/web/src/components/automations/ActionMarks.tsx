import { Bot, Server, SquareTerminal } from 'lucide-react'
import { cx } from '@solera/ui'
import { natureOf, natureWord, whenKind, type Automation, type Nature, type StateTone } from '../../lib/automations'
import { useTranslate } from '../../lib/i18n'
import { AgentIcon } from '../AgentIcon'

/*
 * Les repères d'une action, les mêmes sur chaque tuile, chaque ligne et chaque en-tête :
 * l'icône de sa nature, le point de son état, la puce qui dit ce qu'elle est.
 */

/** Le point d'état : vert qui tourne, gris au repos, rouge en échec, ambre à relire. */
export const STATE_DOT: Record<StateTone, string> = {
  live: 'bg-positive',
  idle: 'bg-line-strong',
  fail: 'bg-critical',
  review: 'bg-caution',
}

/** La couleur de la phrase d'état (`actionState`) : grise, sauf à relire ou en échec. */
export const STATE_TEXT: Record<StateTone, string> = {
  live: 'text-ink-faint',
  idle: 'text-ink-faint',
  fail: 'text-critical',
  review: 'text-caution',
}

/** Le CLI d'un agent, un serveur pour un service, un terminal pour une commande. */
export function NatureIcon({ nature, size = 15 }: { nature: Nature; size?: number }) {
  if (nature.what === 'agent') {
    return nature.agent ? <AgentIcon agent={nature.agent} size={size} /> : <Bot size={size} className="text-ink-soft" aria-hidden />
  }
  const Icon = nature.kind === 'service' ? Server : SquareTerminal
  return <Icon size={size} className="text-ink-soft" aria-hidden />
}

/**
 * L'icône de nature, avec le point d'état posé dans son coin. `md` sur fond, pour l'en-tête
 * d'une tuile (32 px) ; `sm` nu, pour une ligne de panneau (24 px). Le point est muet :
 * la phrase d'état est écrite à côté.
 */
export function StateIcon({ nature, tone, size = 'md' }: { nature: Nature; tone: StateTone; size?: 'md' | 'sm' }) {
  return (
    <span
      className={cx(
        'relative grid shrink-0 place-items-center rounded-md text-ink-soft',
        size === 'md' ? 'size-8 bg-surface-high/70' : 'size-6',
      )}
    >
      <NatureIcon nature={nature} size={size === 'md' ? 15 : 14} />
      <span
        aria-hidden
        className={cx(
          'absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full ring-2 ring-canvas',
          STATE_DOT[tone],
          tone === 'live' && 'motion-safe:animate-pulse',
        )}
      />
    </span>
  )
}

/** « Commande · service » encadré, puis « à la demande + planifiée » : ce qu'elle est, quand elle part. */
export function KindChip({ item }: { item: Automation }) {
  const t = useTranslate()
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <span className="shrink-0 rounded border border-line px-1.5 py-px text-meta whitespace-nowrap text-ink-soft">
        {natureWord(natureOf(item), t)}
      </span>
      <span className="truncate text-meta text-ink-faint">{t(`automation.kindChip.${whenKind(item)}`)}</span>
    </span>
  )
}
