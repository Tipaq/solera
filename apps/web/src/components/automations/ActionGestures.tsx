import { ArrowUpRight, ChevronDown, Play, ShieldQuestion, SquareTerminal } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Menu, MenuItem, MenuLabel, Switch, cx } from '@solera/ui'
import { launchTrees, picksTree, primaryGestureOf, type Automation } from '../../lib/automations'
import { conversationPath } from '../../lib/conversation-route'
import { useTranslate } from '../../lib/i18n'
import { useWorktrees } from '../../lib/worktrees'
import { WebLink } from '../WebLink'

/*
 * Les gestes d'une action, communs aux tuiles de l'onglet Actions, aux lignes du panneau
 * d'une conversation et au pied du détail : « Lancer ▾ », l'interrupteur d'un service,
 * « Relire », et les gestes secondaires de même forme.
 */

/**
 * `tile` : la hauteur de `Button size="sm"`, 44 px au doigt et 36 à partir de `md`.
 * `row` : les petits gestes d'une ligne de panneau, 32 px (44 au doigt).
 */
export type GestureSize = 'tile' | 'row'

const HEIGHT: Record<GestureSize, string> = {
  tile: 'h-11 md:h-9 pointer-coarse:h-11',
  row: 'h-8 pointer-coarse:h-11',
}

const FOCUS = 'focus-visible:outline-2 focus-visible:outline-accent'

/** Un geste secondaire de même forme que « Lancer » : Terminal, Session ↗, Ouvrir ↗. */
export const quietGestureClass = (size: GestureSize = 'tile') =>
  cx(
    'inline-flex shrink-0 items-center gap-1 rounded-md px-2 text-xs text-ink-soft transition-colors hover:bg-surface-high hover:text-ink',
    FOCUS,
    HEIGHT[size],
  )

/** Un geste principal à bordure, de la forme de « Lancer » : Reprendre, Lancer maintenant. */
export const outlineGestureClass = (size: GestureSize = 'tile') =>
  cx(
    'inline-flex shrink-0 items-center gap-1.5 rounded-md border border-line px-2.5 text-xs font-medium text-ink transition-colors hover:bg-surface-high',
    FOCUS,
    HEIGHT[size],
  )

/** Où part le lancement direct, quand ce n'est pas la racine : l'arbre de la conversation. */
export interface LaunchHere {
  worktreeId: string
  name: string
}

/**
 * « Lancer ▾ » : un bouton scindé (LAN-9). La partie gauche lance à la racine du projet,
 * ou dans `here` ; le chevron propose la racine puis les arbres du projet. Une tâche
 * d'agent part dans une nouvelle session et n'a pas de chevron (Q6).
 */
export function LaunchButton({
  item,
  onLaunch,
  here = null,
  size = 'tile',
  disabled = false,
}: {
  item: Automation
  /** `null` : la racine du projet. */
  onLaunch: (worktreeId: string | null) => void
  here?: LaunchHere | null
  size?: GestureSize
  disabled?: boolean
}) {
  const t = useTranslate()
  const choose = picksTree(item)
  const { data: trees } = useWorktrees(choose ? (item.projectId ?? undefined) : undefined)
  const where = !choose
    ? t('launcher.launch.newSession')
    : here
      ? t('launcher.launch.inTree', { tree: here.name })
      : t('launcher.launch.atRoot')
  const part = 'inline-flex items-center border border-line transition-colors hover:bg-surface-high disabled:pointer-events-none disabled:opacity-45'
  return (
    <span className="inline-flex shrink-0">
      <button
        type="button"
        aria-label={t('launcher.launch.named', { label: item.label })}
        title={where}
        disabled={disabled}
        onClick={() => onLaunch(choose ? (here?.worktreeId ?? null) : null)}
        className={cx(part, 'gap-1.5 px-2.5 text-xs font-medium text-ink', choose ? 'rounded-l-md' : 'rounded-md', FOCUS, HEIGHT[size])}
      >
        <Play size={12} aria-hidden /> {t('launcher.launch.button')}
      </button>
      {choose ? (
        <Menu
          trigger={
            <button
              type="button"
              aria-label={t('launcher.launch.chooseNamed', { label: item.label })}
              title={t('launcher.launch.choose')}
              disabled={disabled}
              className={cx(part, 'rounded-r-md border-l-0 px-1.5 text-ink-faint hover:text-ink', FOCUS, HEIGHT[size])}
            >
              <ChevronDown size={12} aria-hidden />
            </button>
          }
        >
          <MenuLabel>{t('launcher.launch.in')}</MenuLabel>
          <MenuItem onSelect={() => onLaunch(null)}>{t('launcher.launch.root')}</MenuItem>
          {launchTrees(trees).map((tree) => (
            <MenuItem key={tree.id} onSelect={() => onLaunch(tree.id)}>
              <span className="block truncate">{tree.name}</span>
            </MenuItem>
          ))}
        </Menu>
      ) : null}
    </span>
  )
}

/**
 * L'interrupteur d'un service : allumé, il tourne. Son nom dit ce qu'un clic fera
 * (« Arrêter « X » »), son texte ce qui est (« En marche ») quand il y a la place.
 */
export function ServiceSwitch({
  on,
  label,
  onToggle,
  withText = true,
  disabled = false,
  name: named,
}: {
  on: boolean
  /** Le libellé de l'action, pour le nom accessible. */
  label: string
  onToggle: (on: boolean) => void
  withText?: boolean
  disabled?: boolean
  /** Le nom accessible, quand il dit aussi où il démarrera. */
  name?: string
}) {
  const t = useTranslate()
  const name = named ?? t(on ? 'launcher.switch.stop' : 'launcher.switch.start', { label })
  return (
    <Switch
      checked={on}
      onCheckedChange={onToggle}
      label={name}
      tone="positive"
      size={withText ? 'tile' : 'row'}
      text={withText ? t(on ? 'launcher.switch.on' : 'launcher.switch.off') : undefined}
      disabled={disabled}
    />
  )
}

/** « Relire » : le geste d'une action écrite par un agent, avant qu'elle parte d'un clic. */
export function ReviewButton({ label, onReview, size = 'tile' }: { label: string; onReview: () => void; size?: GestureSize }) {
  const t = useTranslate()
  return (
    <button
      type="button"
      aria-label={t('launcher.review.named', { label })}
      onClick={onReview}
      className={cx(
        'inline-flex shrink-0 items-center gap-1.5 rounded-md border border-caution/50 px-2.5 text-xs font-medium text-caution transition-colors hover:bg-caution/10',
        FOCUS,
        HEIGHT[size],
      )}
    >
      <ShieldQuestion size={12} aria-hidden /> {t('launcher.review.button')}
    </button>
  )
}

/**
 * Le geste principal d'une action, toujours au même endroit (LAN-7) : « Relire », sinon
 * l'interrupteur d'un service (puis `serve`, « Servir… », quand il tourne, et « Ouvrir ↗ »
 * à droite quand on sait où), « Terminal » d'une commande qui tourne, « Session ↗ » d'un
 * passage d'agent, sinon « Lancer ▾ ».
 */
export function ActionGesture({
  item,
  size = 'tile',
  here,
  onReview,
  onToggleService,
  onTerminal,
  onLaunch,
  serve,
}: {
  item: Automation
  size?: GestureSize
  here?: LaunchHere | null
  /** « Servir… » d'un service en marche (`ServeMenu`), posé après l'interrupteur. */
  serve?: ReactNode
  onReview: () => void
  onToggleService: (on: boolean) => void
  onTerminal: () => void
  onLaunch: (worktreeId: string | null) => void
}) {
  const t = useTranslate()
  const { live } = item
  switch (primaryGestureOf(item)) {
    case 'review':
      return <ReviewButton label={item.label} onReview={onReview} size={size} />
    case 'switch': {
      const on = live?.kind === 'service'
      return (
        <>
          <ServiceSwitch on={on} label={item.label} onToggle={onToggleService} withText={size === 'tile'} />
          {on ? serve : null}
          {live?.kind === 'service' && live.href ? (
            <WebLink href={live.href} className={cx(quietGestureClass(size), 'ml-auto')}>
              {t('launcher.gesture.open')} <ArrowUpRight size={12} aria-hidden />
            </WebLink>
          ) : null}
        </>
      )
    }
    case 'terminal':
      return (
        <button type="button" onClick={onTerminal} className={quietGestureClass(size)}>
          <SquareTerminal size={12} aria-hidden /> {t('launcher.gesture.terminal')}
        </button>
      )
    case 'session':
      return live?.kind === 'run' && live.conversationId ? (
        <Link to={conversationPath({ id: live.conversationId, projectId: item.projectId })} className={quietGestureClass(size)}>
          {t('launcher.gesture.session')} <ArrowUpRight size={12} aria-hidden />
        </Link>
      ) : null
    case 'launch':
      return <LaunchButton item={item} onLaunch={onLaunch} here={here} size={size} />
  }
}
