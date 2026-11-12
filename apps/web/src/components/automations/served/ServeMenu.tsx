import { Repeat } from 'lucide-react'
import type { ReactNode } from 'react'
import { Menu, MenuItem, MenuLabel } from '@solera/ui'
import { useTranslate } from '../../../lib/i18n'
import { servedName, type ServedTree } from '../../../lib/served'

/** Le nom d'un arbre où basculer : « la racine (main) », sinon sa branche, sinon son nom. */
export function useTargetName(): (tree: Pick<ServedTree, 'root' | 'branch' | 'name'>) => string {
  const t = useTranslate()
  return (tree) => (tree.root ? servedName(t, tree) : (tree.branch ?? tree.name))
}

/**
 * « Basculer sur » (SRV-3, SRV-5) : les arbres où servir ce service à la place, à poser
 * dans un menu. Le choix ne bascule rien : il ouvre le dialogue qui dit ce que la bascule
 * redémarre.
 */
export function ServeItems<T extends ServedTree>({ targets, onSwitch }: { targets: T[]; onSwitch: (tree: T) => void }) {
  const t = useTranslate()
  const nameOf = useTargetName()
  return (
    <>
      <MenuLabel>{t('served.switchTo')}</MenuLabel>
      {targets.map((tree) => (
        <MenuItem key={tree.key} icon={<Repeat size={15} />} onSelect={() => onSwitch(tree)}>
          <span className="block truncate font-mono text-xs">{nameOf(tree)}</span>
        </MenuItem>
      ))}
    </>
  )
}

/** « Servir… » : un menu à lui seul, sur la tuile et dans le détail. Rien sans cible. */
export function ServeMenu<T extends ServedTree>({
  trigger,
  targets,
  onSwitch,
}: {
  trigger: ReactNode
  /** `switchTargets`. */
  targets: T[]
  onSwitch: (tree: T) => void
}) {
  if (targets.length === 0) return null
  return (
    <Menu trigger={trigger}>
      <ServeItems targets={targets} onSwitch={onSwitch} />
    </Menu>
  )
}

/** L'icône du geste « Servir… », pour les déclencheurs. */
export const ServeIcon = () => <Repeat size={12} aria-hidden />
