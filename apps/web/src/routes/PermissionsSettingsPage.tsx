import { PermissionsSettings } from '../components/settings/LayeredSettings'
import { SectionHeader } from '../components/settings/SectionHeader'
import { useTranslate } from '../lib/i18n'

/**
 * Permissions (#120, Q32) : ce que l'agent demande à Solera, le réflexe de chaque CLI, et
 * ce que Solera lui prête. Au compte ; le projet reprend les mêmes blocs dans ses réglages.
 */
export function PermissionsSettingsPage() {
  const t = useTranslate()
  return (
    <div className="flex flex-col gap-4">
      <SectionHeader title={t('settings.permissions.title')} description={t('settings.permissions.description')} />
      <PermissionsSettings level={{ kind: 'account' }} />
    </div>
  )
}
