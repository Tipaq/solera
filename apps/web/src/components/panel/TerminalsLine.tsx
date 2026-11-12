import { Button, PanelToolbar, TooltipButton, cx, panelToolClass, type StatusTone } from '@solera/ui'
import { Loader, Plus, SquareTerminal, X } from 'lucide-react'
import { MAX_TERMINALS_PER_PROJECT, type TerminalDto } from '@solera/protocol'
import { useTranslate } from '../../lib/i18n'
import { terminalDir, terminalTone } from '../../lib/terminal-tabs'

const DOTS: Record<StatusTone, string> = {
  positive: 'bg-positive',
  caution: 'bg-caution',
  critical: 'bg-critical',
  accent: 'bg-accent',
  neutral: 'bg-line-strong',
}

/**
 * La ligne d'outils de l'onglet Terminaux, sur le cadre commun (`PanelToolbar`) :
 * « Terminaux » et leur compte, les shells en pastilles, « + » au bout.
 *
 * Des pastilles plutôt qu'une liste en pile : on passe d'un shell à l'autre sans cesse,
 * et une pile coûterait un clic à chaque fois en cachant le terminal. Elles défilent
 * quand elles ne tiennent plus : la ligne ne passe jamais à la ligne.
 */
export function TerminalsLine({
  terminals,
  active,
  workspacePath,
  opening,
  onSelect,
  onClose,
  onNew,
}: {
  terminals: TerminalDto[]
  active: string | null
  /** Le workspace du projet : un shell qui y tourne le dit en toutes lettres. */
  workspacePath: string | undefined
  /** Un shell est en train de s'ouvrir : « + » tourne et attend. */
  opening: boolean
  onSelect: (id: string) => void
  onClose: (id: string) => void
  onNew: () => void
}) {
  const t = useTranslate()
  const full = terminals.length >= MAX_TERMINALS_PER_PROJECT
  const blocked = full || opening
  const stateLabel = (terminal: TerminalDto) =>
    terminal.alive
      ? t('terminal.tab.shellAlive')
      : terminal.exitCode
        ? t('terminal.tab.shellFailed', { code: terminal.exitCode })
        : t('terminal.tab.shellDone')

  return (
    // Le repère sert aux suites : la ligne doit tenir sur 48 px sans déborder.
    <div data-terminals-line className="shrink-0">
      <PanelToolbar title={t('panel.tab.terminals')} meta={terminals.length > 0 ? terminals.length : undefined}>
        {/* Les pastilles cèdent avant le titre et son compte : elles défilent, alors
            qu'un « Terminaux 6 » tronqué ne se lit plus. */}
        <span className="flex min-w-0 shrink-[999] items-center gap-1 overflow-x-auto">
          {terminals.map((terminal) => {
            const selected = terminal.id === active
            const dir = terminalDir(terminal, workspacePath)
            return (
              <span
                key={terminal.id}
                data-terminal-pill
                className={cx(panelToolClass(selected), 'group/term gap-1.5 pr-1 pl-2')}
              >
                <span aria-hidden className={cx('size-1.5 shrink-0 rounded-full', DOTS[terminalTone(terminal)])} />
                <button
                  type="button"
                  aria-pressed={selected}
                  onClick={() => onSelect(terminal.id)}
                  title={terminal.cwd}
                  className="flex items-baseline gap-1.5 rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                >
                  <span className="max-w-[8rem] truncate">{terminal.title}</span>
                  <span className="text-micro text-ink-faint">{dir ?? t('terminal.dir.workspace')}</span>
                  {/* Le point est muet : l'état se dit aussi en toutes lettres. */}
                  <span className="sr-only">{stateLabel(terminal)}</span>
                </button>
                <TooltipButton
                  type="button"
                  onClick={() => onClose(terminal.id)}
                  aria-label={t('terminal.tab.close', { title: terminal.title })}
                  // Au doigt, toujours là, et toute la hauteur de la pastille pour cible.
                  className="rounded p-0.5 text-ink-faint opacity-0 group-hover/term:opacity-100 hover:text-ink focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-accent pointer-coarse:self-stretch pointer-coarse:px-2.5 pointer-coarse:opacity-100"
                >
                  <X size={13} />
                </TooltipButton>
              </span>
            )
          })}
        </span>
        <TooltipButton
          type="button"
          // Désarmé plutôt que `disabled` : un bouton désactivé ne reçoit pas le pointeur,
          // et l'infobulle qui dit pourquoi « + » ne répond plus ne paraîtrait jamais.
          onClick={blocked ? undefined : onNew}
          aria-disabled={blocked}
          aria-label={t('terminal.new')}
          title={full ? t('terminal.max', { max: MAX_TERMINALS_PER_PROJECT }) : t('terminal.new')}
          className={cx(panelToolClass(), 'aria-disabled:cursor-default aria-disabled:opacity-40')}
        >
          {opening ? <Loader size={14} className="animate-spin" /> : <Plus size={14} />}
        </TooltipButton>
      </PanelToolbar>
    </div>
  )
}

/**
 * Aucun terminal : un état centré dans l'onglet, une phrase qui dit où le shell
 * s'ouvrira, et le geste — plutôt qu'une ligne serrée contre la barre. C'est
 * l'exception du cadre commun, dont l'état vide tient sur une ligne : ici l'onglet
 * n'a rien d'autre à montrer.
 */
export function TerminalsEmpty({
  inWorktree,
  opening,
  onNew,
}: {
  /** Le fil a son worktree : c'est là que le shell s'ouvrira, pas à la racine. */
  inWorktree: boolean
  opening: boolean
  onNew: () => void
}) {
  const t = useTranslate()
  return (
    <div
      data-terminals-empty
      className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6 pb-12 text-center"
    >
      <span className="grid size-10 place-items-center rounded-full bg-surface-high/70 text-ink-faint">
        <SquareTerminal size={18} aria-hidden />
      </span>
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium text-ink">{t('terminal.empty.title')}</p>
        <p className="text-xs text-ink-faint">
          {inWorktree ? t('terminal.empty.inWorktree') : t('terminal.empty.atRoot')}
        </p>
      </div>
      <Button
        size="sm"
        icon={opening ? <Loader size={14} className="animate-spin" /> : <Plus size={14} />}
        disabled={opening}
        onClick={onNew}
      >
        {t('terminal.new')}
      </Button>
    </div>
  )
}
