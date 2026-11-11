/* PROTOTYPE — jetable (branche proto/page-projet). Ne pas fusionner dans main.
 *
 * Les pièces communes du Lanceur, partagées par les tuiles de l'onglet Actions et les
 * lignes du panneau d'une conversation : **un seul vocabulaire d'état** (mêmes mots,
 * mêmes points), l'icône de nature avec son point, et les gestes principaux — le bouton
 * « Lancer ▾ » (un bouton scindé : lancer à la racine, ou choisir où), l'interrupteur d'un
 * service, « Relire ». Aucune écriture : chaque geste dit « Simulé ».
 */
import { Bot, ChevronDown, Play, Server, ShieldQuestion, SquareTerminal } from 'lucide-react'
import { Menu, MenuItem, MenuLabel, cx } from '@solera/ui'
import { AgentIcon } from '../../components/AgentIcon'
import { cronToHuman } from '../../lib/cron'
import { elapsed } from '../../lib/dates'
import { locale } from '../../lib/i18n'
import { describeCadence } from '../../lib/schedules'
import { useWorktrees } from '../../lib/worktrees'
import type { Automation } from './model'

export type StateTone = 'live' | 'idle' | 'fail' | 'review'

/** Le point d'état : vert qui tourne, gris au repos, rouge en échec, ambre à relire. */
export const TONE_DOT: Record<StateTone, string> = {
  live: 'bg-positive',
  idle: 'bg-line-strong',
  fail: 'bg-critical',
  review: 'bg-caution',
}

const capital = (text: string) => text.charAt(0).toLocaleUpperCase() + text.slice(1)

/**
 * L'état d'une action en une phrase, le même partout : « En marche · :5173 · depuis 2 h »,
 * « Arrêté », « En cours · … », « Réussie · il y a 3 min », « 2 échecs d'affilée »,
 * « Jamais lancée », « À relire — … ».
 */
export function actionState(item: Automation): { tone: StateTone; text: string } {
  if (item.review) return { tone: 'review', text: `À relire — ${item.review}` }
  if (item.live?.kind === 'service') return { tone: 'live', text: `En marche${item.live.text.replace(/^service/, '')}` }
  if (item.live) return { tone: 'live', text: capital(item.live.text) }
  if (item.what === 'command' && item.commandKind === 'service') return { tone: 'idle', text: 'Arrêté' }
  if (item.failStreak >= 2) return { tone: 'fail', text: `${item.failStreak} échecs d’affilée` }
  const run = item.runs[0]
  if (!run) return { tone: 'idle', text: 'Jamais lancée' }
  const fail = run.status === 'failed' || run.status === 'timed_out' || (run.exitCode != null && run.exitCode !== 0)
  const word = run.status === 'timed_out' ? 'Trop longue' : fail ? 'Échec' : run.status === 'skipped' ? 'Sautée' : 'Réussie'
  return { tone: fail ? 'fail' : 'idle', text: `${word}${run.exitCode != null && fail ? ` (code ${run.exitCode})` : ''} · il y a ${elapsed(run.startedAt)}` }
}

/** La cadence en clair, ou null pour une action seulement à la demande. */
export function cadenceText(item: Automation): string | null {
  if (!item.schedule) return null
  const text = describeCadence(item.schedule.cadence, (expression) => cronToHuman(expression, locale()))
  return item.schedule.enabled ? text : `${text} (en pause)`
}

/** L'icône de nature, avec le point d'état posé dans son coin. */
export function StateIcon({ item, tone, size = 'md' }: { item: Automation; tone: StateTone; size?: 'md' | 'sm' }) {
  const icon = size === 'md' ? 15 : 14
  return (
    <span className={cx('relative grid shrink-0 place-items-center rounded-md text-ink-soft', size === 'md' ? 'size-8 bg-surface-high/70' : 'size-6')}>
      {item.what === 'agent' ? <AgentIcon agent={item.agent ?? 'claude'} size={icon} />
        : item.commandKind === 'service' ? <Server size={icon} />
          : item.what === 'command' ? <SquareTerminal size={icon} /> : <Bot size={icon} />}
      <span
        aria-hidden
        className={cx(
          'absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full ring-2 ring-canvas',
          TONE_DOT[tone],
          tone === 'live' && 'animate-pulse',
        )}
      />
    </span>
  )
}

/** La hauteur commune des gestes d'une tuile : celle de `Button size="sm"`. */
const TILE_H = 'h-11 md:h-9 pointer-coarse:h-11'
/** Les gestes d'une ligne de panneau : petits, à droite. */
const ROW_H = 'h-8'

/**
 * « Lancer ▾ » : un bouton scindé. La partie gauche lance à la racine du projet (ou là où
 * l'appelant le dit), le chevron propose de choisir un worktree.
 */
export function LaunchButton({ projectId, item, simulate, where = 'à la racine du projet', size = 'tile' }: {
  projectId: string
  item: Automation
  simulate: (text: string) => void
  /** Où part le lancement direct : la racine, ou le worktree de la conversation. */
  where?: string
  size?: 'tile' | 'row'
}) {
  const { data: trees } = useWorktrees(projectId)
  const height = size === 'tile' ? TILE_H : ROW_H
  const what = item.what === 'agent' ? 'une nouvelle session' : where
  return (
    <span className="inline-flex shrink-0">
      <button
        type="button"
        title={`Lancer ${what}`}
        onClick={() => simulate(`lancer « ${item.label} » ${item.what === 'agent' ? 'dans une nouvelle session' : where}`)}
        className={cx('inline-flex items-center gap-1.5 rounded-l-md border border-line px-2.5 text-xs font-medium text-ink transition-colors hover:bg-surface-high', height)}
      >
        <Play size={12} /> Lancer
      </button>
      <Menu
        trigger={
          <button type="button" aria-label="Lancer dans…" title="Lancer dans…" className={cx('inline-flex items-center rounded-r-md border border-l-0 border-line px-1.5 text-ink-faint transition-colors hover:bg-surface-high hover:text-ink', height)}>
            <ChevronDown size={12} />
          </button>
        }
      >
        <MenuLabel>Lancer dans</MenuLabel>
        {[{ id: 'root', name: 'la racine du projet' }, ...(trees ?? []).slice(0, 6)].map((tree) => (
          <MenuItem key={tree.id} onSelect={() => simulate(`lancer « ${item.label} » dans ${tree.name}`)}>
            <span className="truncate">{tree.name}</span>
          </MenuItem>
        ))}
      </Menu>
    </span>
  )
}

/** L'interrupteur d'un service, avec son mot quand il y a la place. */
export function ServiceSwitch({ on, label, onToggle, withText = true }: { on: boolean; label: string; onToggle: () => void; withText?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      title={label}
      onClick={onToggle}
      className={cx('inline-flex shrink-0 items-center gap-2 rounded-md text-xs text-ink-soft transition-colors hover:text-ink', withText ? cx(TILE_H, 'px-1.5 hover:bg-surface-high') : ROW_H)}
    >
      <span className={cx('relative h-5 w-9 rounded-full transition-colors', on ? 'bg-positive' : 'bg-line-strong')}>
        <span className={cx('absolute top-0.5 size-4 rounded-full bg-canvas shadow transition-[left]', on ? 'left-[1.125rem]' : 'left-0.5')} />
      </span>
      {withText ? (on ? 'En marche' : 'Arrêté') : null}
    </button>
  )
}

/** « Relire » : le geste d'une action proposée par un agent. */
export function ReviewButton({ onReview, size = 'tile' }: { onReview: () => void; size?: 'tile' | 'row' }) {
  return (
    <button
      type="button"
      onClick={onReview}
      className={cx('inline-flex shrink-0 items-center gap-1.5 rounded-md border border-caution/50 px-2.5 text-xs font-medium text-caution transition-colors hover:bg-caution/10', size === 'tile' ? TILE_H : ROW_H)}
    >
      <ShieldQuestion size={12} /> Relire
    </button>
  )
}

/** Un geste secondaire de même forme que « Lancer » : Terminal, Session ↗, Ouvrir ↗. */
export const quietGestureClass = (size: 'tile' | 'row' = 'tile') =>
  cx('inline-flex shrink-0 items-center gap-1 rounded-md px-2 text-xs text-ink-soft transition-colors hover:bg-surface-high hover:text-ink', size === 'tile' ? TILE_H : ROW_H)
