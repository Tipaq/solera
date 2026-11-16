import { Bot, Server, SquareTerminal } from 'lucide-react'
import type { ReactNode } from 'react'
import { launcherGroupsOf } from '../../lib/actions-tab'
import type { Automation, LauncherGroup as Group } from '../../lib/automations'
import { useTranslate, type MessageKey } from '../../lib/i18n'
import type { ServedVersion } from '../../lib/served'
import { ActionTile } from './ActionTile'
import { LauncherGroup } from './LauncherGroup'
import type { ActionHandlers, ActionServing } from './useActionGestures'

const GROUPS: { key: Group; icon: ReactNode; title: MessageKey; add: MessageKey; kind: 'service' | 'command' | 'agent' }[] = [
  { key: 'services', icon: <Server size={14} />, title: 'actionsTab.group.services', add: 'actionsTab.group.addService', kind: 'service' },
  { key: 'commands', icon: <SquareTerminal size={14} />, title: 'actionsTab.group.commands', add: 'actionsTab.group.addCommand', kind: 'command' },
  { key: 'agents', icon: <Bot size={14} />, title: 'actionsTab.group.agents', add: 'actionsTab.group.addAgent', kind: 'agent' },
]

/**
 * Le Lanceur (LAN-1) : Services, Commandes, Agents, chacun avec sa tuile d'ajout, même
 * vide. Celui d'un projet, et celui de chaque projet au portefeuille (PF-34) : les gestes
 * viennent de `useActionGestures`, ce qu'ouvrent les tuiles est l'affaire de l'hôte.
 */
export function LauncherView({
  items,
  handlers,
  servedOf,
  serving,
  onNew,
}: {
  items: Automation[]
  handlers: ActionHandlers
  servedOf: (item: Automation) => ServedVersion | null
  serving: (item: Automation) => ActionServing | null
  onNew: (kind: 'service' | 'command' | 'agent') => void
}) {
  const t = useTranslate()
  const groups = launcherGroupsOf(items)
  return (
    <>
      {GROUPS.map((group) => (
        <LauncherGroup
          key={group.key}
          icon={group.icon}
          title={t(group.title)}
          count={groups[group.key].length}
          add={{ label: t(group.add), onClick: () => onNew(group.kind) }}
        >
          {groups[group.key].map((item) => (
            <ActionTile key={item.id} item={item} served={servedOf(item)} serving={serving(item)} handlers={handlers} />
          ))}
        </LauncherGroup>
      ))}
    </>
  )
}
