import * as Dialog from '@radix-ui/react-dialog'
import * as Popover from '@radix-ui/react-popover'
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import type { MessageKey, MessageParams } from '../../lib/i18n'
import { useMediaQuery } from '../../lib/viewport'
import { cx } from '@solera/ui'

/**
 * Marque une valeur qui retire un garde-fou. Absente quand il n'y a rien à signaler :
 * un ton « neutre » explicite ne servirait qu'à nommer l'absence de signal.
 */
export type SettingTone = 'caution'

export interface SettingOption {
  value: string
  label: string
  hint?: string
  icon?: ReactNode
  disabled?: boolean
  tone?: SettingTone
}

/** Option dont la valeur reste dans son union d'origine, avant l'élargissement. */
export type SettingChoice<V extends string> = Omit<SettingOption, 'value'> & { value: V }

/** Les choix viennent du CLI ; leur disposition appartient au composer. */
export interface SettingGroup {
  key: string
  label: string
  icon?: ReactNode
  options: SettingOption[]
  value: string
  onChange: (value: string) => void
  /**
   * Ce qui sépare la valeur choisie de celle qui s'applique, quand le CLI ne sait pas
   * la changer sans repartir. Absent le reste du temps, c'est-à-dire presque toujours.
   */
  notice?: string
}

/**
 * Fabrique une catégorie sans perdre le type de la valeur.
 *
 * Le tableau des catégories est hétérogène, donc large sur `string`, et un
 * `SettingGroup<'a'|'b'>` ne s'y assigne pas puisque `onChange` est contravariant.
 * Cette fonction est l'unique point où l'on redescend vers l'union du protocole, et
 * elle vérifie que la valeur vient bien de la liste avant de le faire.
 */
export function setting<V extends string>(group: {
  key: string
  label: string
  icon?: ReactNode
  options: SettingChoice<V>[]
  value: V
  onChange: (value: V) => void
  notice?: string
}): SettingGroup {
  return {
    ...group,
    onChange: (value) => {
      if (group.options.some((option) => option.value === value && !option.disabled)) group.onChange(value as V)
    },
  }
}

export interface SummarySegment {
  key: string
  label: string
  tone?: SettingTone
}

/**
 * Ce qu'un coup d'œil doit dire des réglages sans ouvrir le menu.
 *
 * Calculé ici et non dans le composer : la règle — ce qui sort du défaut mérite une
 * pastille, un garde-fou baissé la met à l'ambre — appartient aux réglages, et le
 * bouton qui la porte a changé de place une fois déjà.
 */
export interface SettingsStatus {
  /** Les réglages hors défaut, en toutes lettres. Vide : rien à signaler. */
  labels: string[]
  /** Un garde-fou est baissé, par opposition à un simple mode non standard. */
  caution: boolean
  /**
   * Le mode Plan, nommé, ou null.
   *
   * Il garde une étiquette en toutes lettres dans la rangée, là où les autres se
   * contentent de la pastille : il change ce que l'agent a le droit de faire pendant
   * qu'on écrit, et ça ne se découvre pas en ouvrant un menu.
   */
  plan: string | null
  /** Tous les réglages en vigueur, pour l'intitulé accessible du bouton. */
  summary: string
}

export function settingsStatus(
  groups: SettingGroup[],
  summary: SummarySegment[],
  t: (key: MessageKey, params?: MessageParams) => string,
): SettingsStatus {
  const warnings = summary.filter((segment) => segment.tone === 'caution')
  const plan = groups.find(
    (group) => (group.key === 'mode' || group.key === 'permission') && group.value === 'plan',
  )
  const planLabel = plan
    ? (plan.options.find((option) => option.value === plan.value)?.label ?? plan.value)
    : null
  const labels = [
    ...(planLabel ? [planLabel] : []),
    ...warnings.map((segment) => {
      const group = groups.find((group) => group.key === segment.key)
      return group ? t('composer.settings.quick', { setting: group.label, value: segment.label }) : segment.label
    }),
  ]
  return {
    labels,
    caution: warnings.length > 0,
    plan: planLabel,
    summary: [
      ...summary
        .filter((segment) => segment.tone !== 'caution' && segment.key !== plan?.key)
        .map((segment) => segment.label),
      ...labels,
    ].join(' · '),
  }
}

/** Même contenu, ancré sur ordinateur et dans une feuille sur écran tactile. */
export function SettingsSurface({ label, trigger, children, inputRef, disabled, quick = false, spacious = false, align, onOpenChange }: {
  label: string
  trigger: ReactNode
  children: (close: (resumeTyping?: boolean) => void) => ReactNode
  inputRef: RefObject<HTMLTextAreaElement | null>
  disabled: boolean
  quick?: boolean
  spacious?: boolean
  /** Côté par lequel le panneau s'aligne sur son déclencheur, à défaut du sien. */
  align?: 'start' | 'end'
  /**
   * Ouverture et fermeture, pour un contenu qui a sa propre navigation : une surface
   * refermée doit rouvrir sur sa première vue, et elle se ferme aussi par Échap ou par
   * un clic au-dehors, que `close` ne voit pas passer.
   */
  onOpenChange?: (open: boolean) => void
}) {
  const [open, setOpen] = useState(false)
  const sheet = useMediaQuery('(max-width: 34rem), (pointer: coarse)')
  const content = useRef<HTMLDivElement>(null)
  const wasTyping = useRef(false)
  const resumeTyping = useRef(false)

  useEffect(() => { if (disabled) setOpen(false) }, [disabled])

  const changeOpen = (next: boolean) => {
    if (next) resumeTyping.current = false
    setOpen(next)
    onOpenChange?.(next)
  }
  const close = (resume = false) => {
    resumeTyping.current = resume && wasTyping.current
    setOpen(false)
    onOpenChange?.(false)
  }
  const triggerEvents = {
    onPointerDown: () => { wasTyping.current = document.activeElement === inputRef.current },
    onKeyDown: () => { wasTyping.current = false },
  }
  const onOpenAutoFocus = (event: Event) => {
    event.preventDefault()
    // Le panneau est lu sur la cible de l'événement, que Radix émet dessus, et non sur
    // la ref : celle-ci n'est pas toujours posée quand l'événement part, et le panneau
    // s'ouvrait alors sans que rien ne prenne le focus — les flèches ne faisaient plus
    // rien, par intermittence.
    const panel = (event.target as HTMLElement | null) ?? content.current
    // Ne pas focaliser la recherche sur téléphone : cela ferait monter le clavier.
    const target = quick
      ? panel?.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]:not(:disabled), [role="radio"][tabindex="0"]')
      : null
    const focus = target ?? panel?.querySelector<HTMLElement>('[data-settings-heading]')
    focus?.focus({ preventScroll: true })
  }
  const onCloseAutoFocus = (event: Event) => {
    // Sur téléphone et au clavier, Radix rend le focus au bouton d'ouverture.
    if (!sheet && resumeTyping.current && inputRef.current) {
      event.preventDefault()
      inputRef.current.focus({ preventScroll: true })
    }
  }

  return sheet || spacious ? (
    <Dialog.Root open={open} onOpenChange={changeOpen}>
      <Dialog.Trigger asChild {...triggerEvents}>{trigger}</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="scrim z-40" />
        <Dialog.Content ref={content} aria-describedby={undefined} onOpenAutoFocus={onOpenAutoFocus} onCloseAutoFocus={onCloseAutoFocus}
          className={cx('surface fixed z-50 flex flex-col overflow-hidden border-line shadow-pop',
            spacious && !sheet
              ? 'left-1/2 top-1/2 w-[min(860px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-xl border'
              : 'inset-x-0 rounded-t-xl border-t')}
          style={{
            bottom: spacious && !sheet ? 'auto' : 'max(0px, calc(100dvh - var(--sg-app-height, 100dvh) - var(--sg-viewport-top, 0px)))',
            height: spacious ? 'min(78dvh, 680px)' : undefined,
            maxHeight: 'min(85dvh, calc(var(--sg-app-height, 100dvh) - 1rem))',
          }}
        >
          {sheet ? <div aria-hidden className="mx-auto mt-2 h-1 w-8 shrink-0 rounded-full bg-line-strong" /> : null}
          <Dialog.Title className="sr-only">{label}</Dialog.Title>
          {children(close)}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  ) : (
    <Popover.Root open={open} onOpenChange={changeOpen}>
      <Popover.Trigger asChild {...triggerEvents}>{trigger}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content ref={content} side="top" align={align ?? (quick ? 'start' : 'end')} sideOffset={8} collisionPadding={12}
          aria-label={label} onOpenAutoFocus={onOpenAutoFocus} onCloseAutoFocus={onCloseAutoFocus}
          className={cx('surface z-50 flex flex-col overflow-hidden rounded-xl border border-line shadow-pop outline-none', quick ? 'w-[min(23rem,var(--radix-popover-content-available-width))]' : 'w-[min(28rem,var(--radix-popover-content-available-width))]')}
          style={{ maxHeight: 'var(--radix-popover-content-available-height)' }}
        >
          {children(close)}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
