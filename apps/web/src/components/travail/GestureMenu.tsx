import { MoreHorizontal } from 'lucide-react'
import { Fragment, type ReactNode } from 'react'
import { IconButton, Menu, MenuItem, MenuSeparator } from '@solera/ui'

/** Un geste d'un menu `⋯` : sur un arbre ou sur une branche. */
export interface Gesture<Key extends string = string> {
  key: Key
  label: string
  icon: ReactNode
  run: () => void
  /** Le geste qui retire : séparé des autres, en rouge. */
  tone?: 'critical'
  disabled?: boolean
}

/**
 * Le menu `⋯` d'un couloir ou d'une ligne : ses gestes, un filet avant celui qui retire.
 * `lead` : le geste que le verdict appelle, en tête et séparé du reste.
 */
export function GestureMenu({ label, gestures, lead, align }: { label: string; gestures: Gesture[]; lead?: Gesture | null; align?: 'start' | 'end' }) {
  return (
    <Menu
      align={align}
      trigger={
        <IconButton label={label} size="sm">
          <MoreHorizontal size={15} />
        </IconButton>
      }
    >
      {lead ? (
        <>
          <MenuItem icon={lead.icon} onSelect={lead.run}>
            {lead.label}
          </MenuItem>
          <MenuSeparator />
        </>
      ) : null}
      {gestures.map((gesture, index) => (
        <Fragment key={gesture.key}>
          {gesture.tone === 'critical' && index > 0 ? <MenuSeparator /> : null}
          <MenuItem icon={gesture.icon} onSelect={gesture.run} tone={gesture.tone} disabled={gesture.disabled}>
            {gesture.label}
          </MenuItem>
        </Fragment>
      ))}
    </Menu>
  )
}
