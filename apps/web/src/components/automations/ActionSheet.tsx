import { ChevronLeft, SquareTerminal, X } from 'lucide-react'
import { createContext, useContext, type ReactNode } from 'react'
import { IconButton, cx } from '@solera/ui'
import { natureWord, type Nature } from '../../lib/automations'
import { useTranslate } from '../../lib/i18n'
import { NatureIcon } from './ActionMarks'

/*
 * Les pièces communes à tous les tiroirs d'une action — détail, éditeur, « Planifier une
 * action existante… », relecture — pour qu'ils se ressemblent : même en-tête (icône de
 * nature, libellé, puces Quoi · Quand, ✕), mêmes blocs titrés, même pied collant (les
 * gestes secondaires à gauche, le principal à droite).
 */

/**
 * Où ces pièces sont rendues. Par défaut, dans un tiroir : marges larges, ✕ en tête. En
 * `inline`, dans le panneau d'une conversation, à la place de la liste : marges serrées,
 * et « ‹ Actions » à la place du ✕ — on remonte d'un niveau, on ne ferme pas une seconde
 * surface.
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

/** Une puce d'en-tête : encadrée, ou ambre pour ce qui attend (« à relire »). */
export function Chip({ children, tone }: { children: ReactNode; tone?: 'caution' }) {
  return (
    <span
      className={cx(
        'inline-flex h-5 items-center rounded px-1.5 text-meta whitespace-nowrap',
        tone === 'caution' ? 'bg-caution/15 text-caution' : 'border border-line text-ink-soft',
      )}
    >
      {children}
    </span>
  )
}

/**
 * L'en-tête de tous les tiroirs d'action : l'icône de nature (36 px en tiroir, 32 dans le
 * panneau), le libellé tronqué, les puces Quoi puis Quand (`whenWords`), puis `extra`.
 * `nature` vaut null tant qu'une nouvelle action n'en a pas.
 */
export function ActionHeader({
  nature,
  title,
  when,
  extra,
  onClose,
}: {
  nature: Nature | null
  title: string
  when: readonly string[]
  extra?: ReactNode
  onClose: () => void
}) {
  const t = useTranslate()
  const chrome = useActionChrome()
  const icon = chrome.inline ? 15 : 16
  const chips = (
    <span className="flex flex-wrap items-center gap-1.5">
      {nature ? <Chip>{natureWord(nature, t)}</Chip> : null}
      {when.map((word) => (
        <Chip key={word}>{word}</Chip>
      ))}
      {extra}
    </span>
  )
  const mark = (
    <span className={cx('grid shrink-0 place-items-center rounded-md bg-surface-high/70', chrome.inline ? 'size-8' : 'size-9')}>
      {nature ? <NatureIcon nature={nature} size={icon} /> : <SquareTerminal size={icon} className="text-ink-faint" aria-hidden />}
    </span>
  )
  if (chrome.inline) {
    return (
      <header className="flex shrink-0 flex-col gap-2 border-b border-line px-3 pt-2 pb-3">
        <button
          type="button"
          onClick={chrome.onBack ?? onClose}
          className="-ml-1 inline-flex h-8 w-fit items-center gap-0.5 rounded-md px-1 text-xs text-ink-soft transition-colors hover:bg-surface-high hover:text-ink focus-visible:outline-2 focus-visible:outline-accent pointer-coarse:h-11"
        >
          <ChevronLeft size={14} aria-hidden /> {chrome.backLabel ?? t('actionDrawer.back')}
        </button>
        <div className="flex min-w-0 items-start gap-2.5">
          {mark}
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <h2 className="min-w-0 truncate text-sm leading-snug font-semibold text-ink">{title}</h2>
            {chips}
          </div>
        </div>
      </header>
    )
  }
  return (
    <header className="flex shrink-0 items-start gap-3 border-b border-line px-5 py-4">
      {mark}
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <h2 className="min-w-0 truncate text-base leading-snug font-semibold text-ink">{title}</h2>
        {chips}
      </div>
      <IconButton label={t('actionDrawer.close')} size="sm" onClick={onClose}>
        <X size={15} />
      </IconButton>
    </header>
  )
}

/** Le corps qui défile, mêmes marges partout : 28 px entre les blocs en tiroir, 24 dans le panneau. */
export function ActionBody({ children }: { children: ReactNode }) {
  const inline = useActionChrome().inline
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className={cx('flex flex-col', inline ? 'gap-6 px-3 py-4' : 'gap-7 px-5 py-5')}>{children}</div>
    </div>
  )
}

/** Un bloc titré du corps : « Quoi », « Quand », « Passages », « Origine »… et son geste à droite. */
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

/** Le pied collant : les gestes secondaires à gauche, le principal à droite. */
export function ActionFooter({ left, right }: { left?: ReactNode; right?: ReactNode }) {
  const pad = useActionPad()
  return (
    <footer className={cx('flex shrink-0 flex-wrap items-center gap-2 border-t border-line bg-canvas py-3', pad)}>
      <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">{left}</span>
      <span className="flex shrink-0 items-center gap-2">{right}</span>
    </footer>
  )
}
