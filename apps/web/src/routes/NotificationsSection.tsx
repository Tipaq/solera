import { PushControls } from '../components/PushControls'
import { SectionHeader } from '../components/settings/SectionHeader'
import { useTranslate } from '../lib/i18n'

/** Les cartes viennent de `PushControls` : cet appareil, les autres, un essai, les sortes. */
export function NotificationsSection() {
  const t = useTranslate()
  return (
    <div className="flex flex-col gap-4">
      <SectionHeader
        title={t('settings.section.notifications')}
        description={t('settings.notifications.deviceScope')}
      />
      <PushControls />
    </div>
  )
}
