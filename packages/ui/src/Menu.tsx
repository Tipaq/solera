import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Check, ChevronRight } from 'lucide-react'
import type { ReactNode } from 'react'
import { cx } from './cx'

interface MenuProps {
  trigger: ReactNode
  children: ReactNode
  align?: 'start' | 'end'
  /**
   * Où va le focus à la fermeture, quand le rendre au déclencheur ne convient pas —
   * le composer le remet dans le champ pour qu'une phrase commencée se poursuive.
   */
  onCloseAutoFocus?: (event: Event) => void
}

export function Menu({ trigger, children, align = 'end', onCloseAutoFocus }: MenuProps) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>{trigger}</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align={align}
          sideOffset={4}
          onCloseAutoFocus={onCloseAutoFocus}
          className={cx(
            'z-50 min-w-44 overflow-hidden rounded-lg border border-line p-1',
            'surface shadow-pop',
          )}
        >
          {children}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

interface MenuItemProps {
  icon?: ReactNode
  onSelect: () => void
  tone?: 'neutral' | 'critical'
  /**
   * Une action momentanément impossible reste affichée plutôt que retirée : la voir
   * grisée dit qu'elle existe et qu'elle reviendra, alors que sa disparition laisse
   * croire qu'elle n'existe pas.
   */
  disabled?: boolean
  children: ReactNode
}

export function MenuItem({
  icon,
  onSelect,
  tone = 'neutral',
  disabled = false,
  children,
}: MenuItemProps) {
  return (
    <DropdownMenu.Item
      onSelect={onSelect}
      disabled={disabled}
      className={cx(
        'flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-sm outline-none',
        'data-[disabled]:pointer-events-none data-[disabled]:opacity-45',
        tone === 'critical'
          ? 'text-critical data-[highlighted]:bg-critical/12'
          : 'text-ink-soft data-[highlighted]:bg-accent-wash data-[highlighted]:text-ink',
      )}
    >
      {icon ? <span className="shrink-0">{icon}</span> : null}
      {children}
    </DropdownMenu.Item>
  )
}

/**
 * Entrée à cocher, pour un menu qui règle plusieurs choses à la fois.
 *
 * Le menu reste ouvert à la sélection, contrairement à `MenuItem` : cocher trois
 * serveurs demanderait sinon de le rouvrir trois fois.
 */
export function MenuCheckboxItem({
  checked,
  onCheckedChange,
  disabled = false,
  appearance = 'check',
  children,
}: {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  disabled?: boolean
  /**
   * `switch` pour un réglage qui s'allume, `check` pour une chose qu'on retient dans
   * une liste. Même mécanique, deux lectures : on allume un serveur, on coche un
   * élément. Le rail reprend celui de `SwitchRow`, pour que la même bascule se
   * reconnaisse d'un écran à l'autre.
   */
  appearance?: 'check' | 'switch'
  children: ReactNode
}) {
  return (
    <DropdownMenu.CheckboxItem
      checked={checked}
      onCheckedChange={onCheckedChange}
      onSelect={(event) => event.preventDefault()}
      disabled={disabled}
      className={cx(
        'flex cursor-pointer items-center gap-2.5 rounded-md py-2 text-sm outline-none',
        'relative text-ink-soft data-[disabled]:pointer-events-none data-[disabled]:opacity-45',
        'data-[highlighted]:bg-accent-wash data-[highlighted]:text-ink',
        appearance === 'switch' ? 'px-2.5' : 'pr-2.5 pl-7',
      )}
    >
      {appearance === 'switch' ? null : (
        <DropdownMenu.ItemIndicator className="absolute left-2 flex items-center">
          <Check size={16} />
        </DropdownMenu.ItemIndicator>
      )}
      <span className="min-w-0 flex-1">{children}</span>
      {appearance === 'switch' ? (
        <span
          aria-hidden
          className={cx(
            'flex h-5 w-8 shrink-0 items-center rounded-full p-0.5 transition-colors',
            checked ? 'justify-end bg-accent' : 'bg-line-strong',
          )}
        >
          <span className="size-4 rounded-full bg-surface" />
        </span>
      ) : null}
    </DropdownMenu.CheckboxItem>
  )
}

/**
 * Une entrée qui ouvre un menu à côté d'elle, plutôt qu'une vue qui remplace celle-ci.
 *
 * La valeur en vigueur s'écrit à droite de l'intitulé : un réglage se lit alors sans
 * ouvrir, et l'ouvrir ne sert qu'à en changer. Au doigt, où un menu n'a pas de place
 * pour s'ouvrir à côté, c'est une pile de vues qu'il faut — pas ceci.
 */
export function MenuSub({ icon, label, value, tone, disabled = false, children }: {
  icon?: ReactNode
  label: ReactNode
  value?: string
  /** Ambre quand la valeur en vigueur baisse un garde-fou. */
  tone?: 'caution'
  disabled?: boolean
  children: ReactNode
}) {
  return (
    <DropdownMenu.Sub>
      <DropdownMenu.SubTrigger
        disabled={disabled}
        className={cx(
          'flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-sm outline-none',
          'text-ink-soft data-[disabled]:pointer-events-none data-[disabled]:opacity-45',
          'data-[highlighted]:bg-accent-wash data-[highlighted]:text-ink data-[state=open]:bg-accent-wash',
        )}
      >
        {icon ? <span className="shrink-0">{icon}</span> : null}
        <span className="min-w-0 flex-1">{label}</span>
        {value ? (
          <span className={cx('shrink-0 text-xs', tone === 'caution' ? 'text-caution' : 'text-ink-faint')}>{value}</span>
        ) : null}
        <ChevronRight size={14} aria-hidden className="shrink-0 text-ink-faint" />
      </DropdownMenu.SubTrigger>
      <DropdownMenu.Portal>
        <DropdownMenu.SubContent
          sideOffset={2}
          collisionPadding={12}
          // Borné en largeur : les explications d'un réglage sont des phrases, et un
          // sous-menu qui s'élargit jusqu'à elles n'a plus la place de s'ouvrir à
          // côté de son parent — il sortait de l'écran au troisième niveau.
          className="surface z-50 max-h-[min(70vh,32rem)] w-[min(18rem,var(--radix-dropdown-menu-content-available-width))] overflow-y-auto overscroll-contain rounded-lg border border-line p-1 shadow-pop"
        >
          {children}
        </DropdownMenu.SubContent>
      </DropdownMenu.Portal>
    </DropdownMenu.Sub>
  )
}

/**
 * Choix exclusif dans un menu : les options d'un même réglage, coche sur celle qui
 * s'applique. Sélectionner referme, le réglage étant pris.
 */
export function MenuRadioGroup({ value, onValueChange, children }: {
  value: string
  onValueChange: (value: string) => void
  children: ReactNode
}) {
  return (
    <DropdownMenu.RadioGroup value={value} onValueChange={onValueChange}>
      {children}
    </DropdownMenu.RadioGroup>
  )
}

export function MenuRadioItem({ value, hint, tone, disabled = false, children }: {
  value: string
  /** La phrase qui dit ce que l'option change, sous son intitulé. */
  hint?: string
  tone?: 'caution'
  disabled?: boolean
  children: ReactNode
}) {
  return (
    <DropdownMenu.RadioItem
      value={value}
      disabled={disabled}
      className={cx(
        'relative flex cursor-pointer items-start gap-2.5 rounded-md py-2 pr-2.5 pl-7 text-sm outline-none',
        'data-[disabled]:pointer-events-none data-[disabled]:opacity-45',
        'data-[highlighted]:bg-accent-wash data-[highlighted]:text-ink',
        tone === 'caution' ? 'text-caution' : 'text-ink-soft',
      )}
    >
      <DropdownMenu.ItemIndicator className="absolute top-2.5 left-2 flex items-center">
        <Check size={14} className="text-accent" />
      </DropdownMenu.ItemIndicator>
      <span className="min-w-0 flex-1">
        <span className="block">{children}</span>
        {hint ? <span className="mt-0.5 block text-meta text-ink-faint">{hint}</span> : null}
      </span>
    </DropdownMenu.RadioItem>
  )
}

export function MenuSeparator() {
  return <DropdownMenu.Separator className="my-1 h-px bg-line" />
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return (
    <p className="px-2.5 pt-1.5 pb-1 text-meta font-semibold tracking-wide text-ink-faint uppercase">
      {children}
    </p>
  )
}

/**
 * Pastille de couleur. `DropdownMenu.Item` en `asChild` pour que Radix ferme le menu
 * et gère le focus, tout en gardant un bouton rond plutôt qu'une ligne de menu.
 */
export function MenuSwatch({
  color,
  selected,
  label,
  onSelect,
}: {
  /** null signifie « couleur d'accent du thème ». */
  color: string | null
  selected: boolean
  label: string
  onSelect: () => void
}) {
  return (
    <DropdownMenu.Item asChild onSelect={onSelect}>
      <button
        type="button"
        aria-label={label}
        title={label}
        className={cx(
          'size-5 shrink-0 cursor-pointer rounded-full outline-none transition-transform',
          'hover:scale-110 focus-visible:scale-110',
          selected ? 'ring-2 ring-ink ring-offset-2 ring-offset-[var(--sg-surface)]' : '',
        )}
        style={{ background: color ?? 'var(--sg-accent)' }}
      />
    </DropdownMenu.Item>
  )
}

export function MenuSwatchRow({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-1.5 px-2.5 pt-1 pb-2">{children}</div>
}
