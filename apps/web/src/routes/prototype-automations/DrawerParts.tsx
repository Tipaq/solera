/* PROTOTYPE — jetable (branche proto/page-projet). Ne pas fusionner dans main.
 *
 * Les pièces communes à **tous** les tiroirs d'une action — détail, éditeur, « Planifier
 * une action existante… », relecture — pour qu'ils se ressemblent : même en-tête (icône
 * de nature, libellé, puces Quoi · Quand, ✕), mêmes blocs titrés, même pied collant (les
 * gestes secondaires à gauche, le principal à droite).
 */
import { Bot, ChevronLeft, Server, SquareTerminal, X } from 'lucide-react'
import { createContext, useContext, type ReactNode } from 'react'
import type { AgentKind, ScheduleCadence } from '@solera/protocol'
import { IconButton, cx } from '@solera/ui'
import { AgentIcon } from '../../components/AgentIcon'
import { cronToHuman } from '../../lib/cron'
import { locale } from '../../lib/i18n'
import { describeCadence } from '../../lib/schedules'
import type { Automation, What } from './model'

/**
 * Où ces pièces sont rendues. Par défaut, dans un tiroir (marges larges, ✕ en tête). En
 * `inline`, dans le panneau de droite d'une conversation, à la place de la liste : marges
 * serrées, et un retour « ‹ Actions » à la place du ✕ — on remonte d'un niveau, on ne
 * ferme pas une seconde surface.
 */
export interface ActionChrome {
  inline: boolean
  backLabel?: string
  onBack?: () => void
}
const ActionChromeContext = createContext<ActionChrome>({ inline: false })
export const ActionChromeProvider = ActionChromeContext.Provider
export const useActionChrome = (): ActionChrome => useContext(ActionChromeContext)
/** Les marges horizontales des pièces : `px-5` en tiroir, `px-3` dans le panneau. */
export const useActionPad = (): string => (useActionChrome().inline ? 'px-3' : 'px-5')

export interface Nature {
  what: What
  kind?: 'task' | 'service'
  agent?: AgentKind
}

export const natureOf = (item: Automation): Nature => ({ what: item.what, kind: item.commandKind, agent: item.agent })

export function NatureIcon({ nature, size = 15 }: { nature: Nature; size?: number }) {
  if (nature.what === 'agent') return nature.agent ? <AgentIcon agent={nature.agent} size={size} /> : <Bot size={size} className="text-ink-soft" />
  return nature.kind === 'service' ? <Server size={size} className="text-ink-soft" /> : <SquareTerminal size={size} className="text-ink-soft" />
}

export function natureWord(nature: Nature): string {
  if (nature.what === 'agent') return 'Agent'
  return nature.kind === 'service' ? 'Commande · service' : 'Commande · tâche'
}

export function cadenceWord(cadence: ScheduleCadence): string {
  try {
    return describeCadence(cadence, (expression) => cronToHuman(expression, locale()))
  } catch {
    return 'planifiée'
  }
}

/** « À la demande », la cadence, ou les deux ; « en pause » quand elle l'est. */
export function whenWords(onDemand: boolean, cadence: ScheduleCadence | null, paused = false): string[] {
  return [onDemand ? 'À la demande' : null, cadence ? `${cadenceWord(cadence)}${paused ? ' (en pause)' : ''}` : null].filter((word): word is string => Boolean(word))
}

export function Chip({ children, tone }: { children: ReactNode; tone?: 'caution' | 'sim' }) {
  return (
    <span
      className={cx(
        'inline-flex h-5 items-center rounded px-1.5 text-meta',
        tone === 'caution' ? 'bg-caution/15 text-caution' : tone === 'sim' ? 'bg-fuchsia-500/15 text-fuchsia-700 dark:text-fuchsia-300' : 'border border-line text-ink-soft',
      )}
    >
      {children}
    </span>
  )
}

/** L'en-tête de tous les tiroirs d'action. */
export function ActionHeader({
  nature,
  title,
  when,
  extra,
  onClose,
}: {
  nature: Nature | null
  title: string
  when: string[]
  extra?: ReactNode
  onClose: () => void
}) {
  const chrome = useActionChrome()
  if (chrome.inline) {
    return (
      <header className="flex shrink-0 flex-col gap-2 border-b border-line px-3 pt-2 pb-3">
        <button
          type="button"
          onClick={chrome.onBack ?? onClose}
          className="-ml-1 inline-flex h-8 w-fit items-center gap-0.5 rounded-md px-1 text-xs text-ink-soft hover:bg-surface-high hover:text-ink"
        >
          <ChevronLeft size={14} /> {chrome.backLabel ?? 'Retour'}
        </button>
        <div className="flex min-w-0 items-start gap-2.5">
          <span className="grid size-8 shrink-0 place-items-center rounded-md bg-surface-high/70">
            {nature ? <NatureIcon nature={nature} size={15} /> : <SquareTerminal size={15} className="text-ink-faint" />}
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <h2 className="min-w-0 truncate text-sm leading-snug font-semibold text-ink">{title}</h2>
            <span className="flex flex-wrap items-center gap-1.5">
              {nature ? <Chip>{natureWord(nature)}</Chip> : null}
              {when.map((word) => <Chip key={word}>{word}</Chip>)}
              {extra}
            </span>
          </div>
        </div>
      </header>
    )
  }
  return (
    <header className="flex shrink-0 items-start gap-3 border-b border-line px-5 py-4">
      <span className="grid size-9 shrink-0 place-items-center rounded-md bg-surface-high/70">
        {nature ? <NatureIcon nature={nature} size={16} /> : <SquareTerminal size={16} className="text-ink-faint" />}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <h2 className="min-w-0 truncate text-base leading-snug font-semibold text-ink">{title}</h2>
        <span className="flex flex-wrap items-center gap-1.5">
          {nature ? <Chip>{natureWord(nature)}</Chip> : null}
          {when.map((word) => <Chip key={word}>{word}</Chip>)}
          {extra}
        </span>
      </div>
      <IconButton label="Fermer" size="sm" onClick={onClose}>
        <X size={15} />
      </IconButton>
    </header>
  )
}

/** Le corps qui défile, mêmes marges partout. */
export function ActionBody({ children }: { children: ReactNode }) {
  const inline = useActionChrome().inline
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className={cx('flex flex-col', inline ? 'gap-6 px-3 py-4' : 'gap-7 px-5 py-5')}>{children}</div>
    </div>
  )
}

/** Un bloc titré du corps : « Quoi », « Quand », « Passages », « Origine »… */
export function ActionBlock({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5">
      <header className="flex items-center gap-2">
        <h3 className="text-xs font-medium tracking-wide text-ink-faint uppercase">{title}</h3>
        {aside ? <span className="ml-auto flex items-center gap-1">{aside}</span> : null}
      </header>
      {children}
    </section>
  )
}

/** Le pied collant : secondaires à gauche, principal à droite. */
export function ActionFooter({ left, right }: { left?: ReactNode; right?: ReactNode }) {
  const pad = useActionPad()
  return (
    <footer className={cx('flex shrink-0 flex-wrap items-center gap-2 border-t border-line bg-canvas py-3', pad)}>
      <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">{left}</span>
      <span className="flex shrink-0 items-center gap-2">{right}</span>
    </footer>
  )
}
