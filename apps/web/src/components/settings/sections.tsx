import {
  Bell,
  BookOpen,
  Bot,
  Cpu,
  FileText,
  Info,
  KeyRound,
  Library,
  LockKeyhole,
  Mic,
  Palette,
  Plug,
  ShieldCheck,
  UserRound,
  Users,
} from 'lucide-react'
import type { ReactNode } from 'react'
import type { InstanceCapabilities } from '@solera/protocol'
import type { MessageKey } from '../../lib/i18n'
import { useInstance } from '../../lib/instance'
import { useCurrentUser } from '../../lib/session'
import type { SettingsSectionId } from '../../lib/settings-dialog'

/**
 * Les sections des réglages, et les trois groupes qui les rangent.
 *
 * Seize sections à plat formaient une liste qu'on relisait en entier pour en retrouver
 * une. Trois groupes suffisent à savoir où chercher, et ils répondent chacun à une
 * question différente : *Toi* ce qui ne vaut que pour ce compte, *Les agents* ce avec
 * quoi les CLI travaillent, *Le serveur* ce qui vaut pour la machine et tous ses
 * comptes. Le critère est « pour qui ça vaut », plus « qui a le droit » : l'accès git et
 * les jetons d'API sont personnels et vont sous Toi, même rangés jadis avec
 * l'administration (#130).
 *
 * La liste vit ici plutôt que dans la modale : la palette cherche aussi dedans, et
 * deux listes de sections finiraient par ne plus dire la même chose.
 */
export type SettingsGroup = 'you' | 'agents' | 'server'

export const SETTINGS_GROUPS = ['you', 'agents', 'server'] as const

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
    id: 'profil',
    group: 'you',
    labelKey: 'settings.section.profile',
    descriptionKey: 'settings.section.profile.description',
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
    id: 'notifications',
    group: 'you',
    labelKey: 'settings.section.notifications',
    descriptionKey: 'settings.section.notifications.description',
    icon: <Bell size={16} />,
    requires: 'webPush',
  },
  {
    id: 'acces',
    group: 'you',
    labelKey: 'settings.section.access',
    descriptionKey: 'settings.section.access.description',
    icon: <KeyRound size={16} />,
  },
  {
    id: 'agents',
    group: 'agents',
    labelKey: 'settings.section.agents',
    descriptionKey: 'settings.section.agents.description',
    icon: <Bot size={16} />,
  },
  {
    id: 'permissions',
    group: 'agents',
    labelKey: 'settings.section.permissions',
    descriptionKey: 'settings.section.permissions.description',
    icon: <ShieldCheck size={16} />,
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
    id: 'sessions',
    group: 'server',
    labelKey: 'settings.section.activity',
    descriptionKey: 'settings.section.activity.description',
    icon: <Cpu size={16} />,
    adminOnly: true,
  },
  {
    id: 'dictee',
    group: 'server',
    labelKey: 'settings.section.stt',
    descriptionKey: 'settings.section.stt.description',
    icon: <Mic size={16} />,
    adminOnly: true,
  },
  {
    id: 'secrets',
    group: 'server',
    labelKey: 'settings.section.secrets',
    descriptionKey: 'settings.section.secrets.description',
    icon: <LockKeyhole size={16} />,
    adminOnly: true,
  },
  {
    id: 'savoir',
    group: 'server',
    labelKey: 'settings.section.vault',
    descriptionKey: 'settings.section.vault.description',
    icon: <Library size={16} />,
    adminOnly: true,
  },
  {
    id: 'utilisateurs',
    group: 'server',
    labelKey: 'settings.section.users',
    descriptionKey: 'settings.section.users.description',
    icon: <Users size={16} />,
    adminOnly: true,
    requires: 'passwordAuth',
  },
  {
    id: 'a-propos',
    group: 'server',
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

/**
 * Si ce compte peut ouvrir cette section. Pour le lien posé hors des réglages — le
 * composer vers la dictée, le Savoir vers son vault — qui ne doit pas ouvrir la modale
 * sur une page qu'elle cache.
 */
export function useCanOpenSection(id: SettingsSectionId): boolean {
  const { data: user } = useCurrentUser()
  const { data: instance } = useInstance()
  return visibleSections(user?.isAdmin, instance?.capabilities).some((section) => section.id === id)
}
