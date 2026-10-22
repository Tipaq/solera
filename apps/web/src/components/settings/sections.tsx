import {
  Archive,
  Bell,
  BookOpen,
  Cpu,
  FileText,
  GitBranch,
  IdCard,
  Info,
  KeyRound,
  Library,
  Mic,
  Palette,
  PanelLeft,
  Plug,
  SlidersHorizontal,
  Terminal,
  UserRound,
  Users,
} from 'lucide-react'
import type { ReactNode } from 'react'
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
}

export const SETTINGS_SECTIONS: SettingsSection[] = [
  {
    id: 'compte',
    group: 'you',
    labelKey: 'settings.section.account',
    descriptionKey: 'settings.section.account.description',
    icon: <UserRound size={16} />,
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
  },
  {
    id: 'dictee',
    group: 'you',
    labelKey: 'settings.section.stt',
    descriptionKey: 'settings.section.stt.description',
    icon: <Mic size={16} />,
    adminOnly: true,
  },
  {
    id: 'cli',
    group: 'agents',
    labelKey: 'settings.section.cli',
    descriptionKey: 'settings.section.cli.description',
    icon: <SlidersHorizontal size={16} />,
  },
  {
    id: 'comptes-claude',
    group: 'agents',
    labelKey: 'settings.section.claudeAccounts',
    descriptionKey: 'settings.section.claudeAccounts.description',
    icon: <IdCard size={16} />,
  },
  {
    id: 'mcp',
    group: 'agents',
    labelKey: 'settings.section.mcp',
    descriptionKey: 'settings.section.mcp.description',
    icon: <Plug size={16} />,
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
    id: 'sessions',
    group: 'agents',
    labelKey: 'settings.section.sessions',
    descriptionKey: 'settings.section.sessions.description',
    icon: <Cpu size={16} />,
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
    id: 'secrets',
    group: 'instance',
    labelKey: 'settings.section.secrets',
    descriptionKey: 'settings.section.secrets.description',
    icon: <KeyRound size={16} />,
    adminOnly: true,
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
    id: 'comptes',
    group: 'instance',
    labelKey: 'settings.section.accounts',
    descriptionKey: 'settings.section.accounts.description',
    icon: <Users size={16} />,
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

/** Les sections qu'un compte voit, l'administration restant à ceux qui l'exercent. */
export function visibleSections(isAdmin: boolean | undefined): SettingsSection[] {
  return SETTINGS_SECTIONS.filter((section) => !section.adminOnly || isAdmin)
}
