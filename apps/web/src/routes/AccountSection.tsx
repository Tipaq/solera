import { ShieldCheck } from 'lucide-react'
import { AccountForm } from '../components/AccountForm'
import { useCurrentUser } from '../lib/session'
import { Badge, Card, CardBody } from '@solera/ui'
import { SectionHeader } from '../components/settings/SectionHeader'
import { useTranslate } from '../lib/i18n'

export function AccountSection() {
  const t = useTranslate()
  const { data: user } = useCurrentUser()

  return (
    <div className="flex flex-col gap-4">
      <SectionHeader title={t('settings.section.account')} description={t('account.description')} />

      {user?.isAdmin ? (
        <Badge tone="accent" icon={<ShieldCheck size={11} />}>
          {t('account.admin')}
        </Badge>
      ) : null}

      <Card>
        <CardBody>
          {user ? (
            <AccountForm
              userId={user.id}
              username={user.username}
              displayName={user.displayName}
              isSelf
            />
          ) : null}
        </CardBody>
      </Card>
    </div>
  )
}
