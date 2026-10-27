import {
  Archive,
  Bell,
  BookOpen,
  Bot,
  Cpu,
  FileText,
  GitBranch,
  Info,
  KeyRound,
  Library,
  Mic,
  Palette,
  PanelLeft,
  Plug,
  ShieldCheck,
  Terminal,
  UserRound,
  Users,
} from 'lucide-react'
import type { ReactNode } from 'react'
import type { InstanceCapabilities } from '@solera/protocol'
import type { MessageKey } from '../../lib/i18n'
import type { SettingsSectionId } from '../../lib/settings-dialog'

/**
 * Les sections des réglages, et les trois groupes qui les rangent.
 *
 * Seize sections à plat formaient une liste qu'on relisait en entier pour en retrouver
 * une. Trois groupes suffisent à savoir où chercher, et ils répondent chacun à une
 * question différente : *Toi* ce qui ne regarde que ce compte, *Les agents* ce avec
 * quoi les CLI travaillent, *L'instance* ce qui vaut pour la machine et tous ses
 * comptes.
 *
 * La liste vit ici plutôt que dans la modale : la palette cherche aussi dedans, et
 * deux listes de sections finiraient par ne plus dire la même chose.
 */
export type SettingsGroup = 'you' | 'agents' | 'instance'

export const SETTINGS_GROUPS = ['you', 'agents', 'instance'] as const

export interface SettingsSection {
  id: SettingsSectionId
  group: SettingsGroup
  labelKey: MessageKey
  descriptionKey: MessageKey
  icon: ReactNode
  adminOnly?: boolean
  /** Capacité de l'instance sans laquelle la section n'a pas d'objet. */
  requires?: keyof InstanceCapabilities
}

export const SETTINGS_SECTIONS: SettingsSection[] = [
  {
    id: 'compte',
    group: 'you',
    labelKey: 'settings.section.account',
    descriptionKey: 'settings.section.account.description',
    icon: <UserRound size={16} />,
    requires: 'passwordAuth',
  },
  {
    id: 'apparence',
    group: 'you',
    labelKey: 'settings.section.appearance',
    descriptionKey: 'settings.section.appearance.description',
    icon: <Palette size={16} />,
  },
  {
    id: 'affichage',
    group: 'you',
    labelKey: 'settings.section.display',
    descriptionKey: 'settings.section.display.description',
    icon: <PanelLeft size={16} />,
  },
  {
    id: 'notifications',
    group: 'you',
    labelKey: 'settings.section.notifications',
    descriptionKey: 'settings.section.notifications.description',
    icon: <Bell size={16} />,
    requires: 'webPush',
  },
  {
    id: 'permissions',
    group: 'agents',
    labelKey: 'settings.section.permissions',
    descriptionKey: 'settings.section.permissions.description',
    icon: <ShieldCheck size={16} />,
  },
  {
    id: 'agents',
    group: 'agents',
    labelKey: 'settings.section.agents',
    descriptionKey: 'settings.section.agents.description',
    icon: <Bot size={16} />,
  },
  {
    id: 'consignes',
    group: 'agents',
    labelKey: 'settings.section.instructions',
    descriptionKey: 'settings.section.instructions.description',
    icon: <FileText size={16} />,
  },
  {
    id: 'skills',
    group: 'agents',
    labelKey: 'settings.section.skills',
    descriptionKey: 'settings.section.skills.description',
    icon: <BookOpen size={16} />,
  },
  {
    id: 'mcp',
    group: 'agents',
    labelKey: 'settings.section.mcp',
    descriptionKey: 'settings.section.mcp.description',
    icon: <Plug size={16} />,
  },
  {
    id: 'comptes',
    group: 'instance',
    labelKey: 'settings.section.accounts',
    descriptionKey: 'settings.section.accounts.description',
    icon: <Users size={16} />,
    adminOnly: true,
    requires: 'passwordAuth',
  },
  {
    id: 'sessions',
    group: 'instance',
    labelKey: 'settings.section.sessions',
    descriptionKey: 'settings.section.sessions.description',
    icon: <Cpu size={16} />,
    adminOnly: true,
  },
  {
    id: 'dictee',
    group: 'instance',
    labelKey: 'settings.section.stt',
    descriptionKey: 'settings.section.stt.description',
    icon: <Mic size={16} />,
    adminOnly: true,
  },
  {
    id: 'secrets',
    group: 'instance',
    labelKey: 'settings.section.secrets',
    descriptionKey: 'settings.section.secrets.description',
    icon: <KeyRound size={16} />,
    adminOnly: true,
  },
  {
    id: 'git',
    group: 'instance',
    labelKey: 'settings.section.git',
    descriptionKey: 'settings.section.git.description',
    icon: <GitBranch size={16} />,
  },
  {
    id: 'api',
    group: 'instance',
    labelKey: 'settings.section.api',
    descriptionKey: 'settings.section.api.description',
    icon: <Terminal size={16} />,
  },
  {
    id: 'savoir',
    group: 'instance',
    labelKey: 'settings.section.vault',
    descriptionKey: 'settings.section.vault.description',
    icon: <Library size={16} />,
    adminOnly: true,
  },
  {
    id: 'archivage',
    group: 'instance',
    labelKey: 'settings.section.archiving',
    descriptionKey: 'settings.section.archiving.description',
    icon: <Archive size={16} />,
    adminOnly: true,
  },
  {
    id: 'a-propos',
    group: 'instance',
    labelKey: 'settings.section.about',
    descriptionKey: 'settings.section.about.description',
    icon: <Info size={16} />,
  },
]

/**
 * Les sections qu'un compte voit sur cette instance : l'administration reste à ceux qui
 * l'exercent, et une section dont l'instance n'a pas la capacité disparaît. Partagée
 * avec la palette, qui ne doit pas proposer une section que la modale cache.
 */
export function visibleSections(
  isAdmin: boolean | undefined,
  capabilities: InstanceCapabilities | undefined,
): SettingsSection[] {
  return SETTINGS_SECTIONS.filter(
    (section) =>
      (!section.adminOnly || isAdmin) && (!section.requires || (capabilities?.[section.requires] ?? true)),
  )
}
