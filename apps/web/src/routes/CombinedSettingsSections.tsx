import { SettingsPart } from '../components/settings/SectionHeader'
import { useTranslate } from '../lib/i18n'
import { ApiTokensSettingsPage } from './ApiTokensSettingsPage'
import { AppearanceSection } from './AppearanceSection'
import { ArchivingSettingsPage } from './ArchivingSettingsPage'
import { DisplaySection } from './DisplaySection'
import { GitCredentialsSettingsPage } from './GitCredentialsSettingsPage'
import { SessionsSettingsPage } from './SessionsSettingsPage'

/**
 * Les sections qui en réunissent deux (#130). Une section d'un ou deux réglages
 * allongeait la liste sans rien dire de plus qu'une partie d'une voisine : Affichage
 * séparé d'Apparence, Archivage à côté de Sessions, Accès git loin de l'API. Chaque
 * page garde son code et ses états ; seule leur place change.
 */

export function AppearanceAndDisplaySection() {
  const t = useTranslate()
  return (
    <div className="flex flex-col gap-8">
      <AppearanceSection />
      <SettingsPart title={t('settings.part.sidebar')}>
        <DisplaySection />
      </SettingsPart>
    </div>
  )
}

export function AccessSection() {
  const t = useTranslate()
  return (
    <div className="flex flex-col gap-8">
      <SettingsPart title={t('settings.section.git')}>
        <GitCredentialsSettingsPage />
      </SettingsPart>
      <SettingsPart title={t('settings.section.api')}>
        <ApiTokensSettingsPage />
      </SettingsPart>
    </div>
  )
}

export function SessionsAndArchivingSection() {
  const t = useTranslate()
  return (
    <div className="flex flex-col gap-8">
      <SettingsPart title={t('settings.section.sessions')}>
        <SessionsSettingsPage />
      </SettingsPart>
      <SettingsPart title={t('settings.section.archiving')}>
        <ArchivingSettingsPage />
      </SettingsPart>
    </div>
  )
}
