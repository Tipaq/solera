import { ModelDefaultsSettings } from '../components/settings/LayeredSettings'
import { SectionHeader } from '../components/settings/SectionHeader'
import { useTranslate } from '../lib/i18n'

/**
 * Modèles par défaut (#120, Q32) : avec quoi les conversations s'ouvrent, CLI par CLI.
 * Ce qui en est sorti — permissions, outils de Solera — a sa section, Permissions.
 */
export function ModelDefaultsSettingsPage() {
  const t = useTranslate()
  return (
    <div className="flex flex-col gap-4">
      <SectionHeader title={t('settings.models.title')} description={t('settings.models.description')} />
      <ModelDefaultsSettings level={{ kind: 'account' }} />
    </div>
  )
}
