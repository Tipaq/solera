import { KeyRound, ShieldCheck } from 'lucide-react'
import { Card, CardBody, CardHeader, EmptyState } from '@solera/ui'
import { GitAccessForm, GitAccessRow } from '../components/settings/GitAccess'
import { SectionHeader } from '../components/settings/SectionHeader'
import { useTranslate } from '../lib/i18n'
import { useGitCredentials } from '../lib/git-credentials'

/**
 * Accès aux forges git du compte.
 *
 * Comme pour les secrets, l'écran ne peut afficher aucun jeton, parce que l'API n'en
 * rend aucun. Ce qui reste et qui compte : la forge, le compte qu'elle a reconnu, et la
 * date de dernière écriture, qui est ce à quoi on se raccroche quand un jeton expire.
 *
 * Par compte et non par instance, contrairement aux secrets : chacun ne voit que les
 * siens, administrateur compris.
 */
export function GitCredentialsSettingsPage() {
  const t = useTranslate()
  const { data } = useGitCredentials()
  const credentials = data?.credentials ?? []

  return (
    <div className="flex flex-col gap-4">
      <SectionHeader
        title={t('gitCredentials.section.title')}
        description={t('gitCredentials.section.description')}
      />

      <Card>
        <CardHeader title={t('gitCredentials.create.title')} icon={<KeyRound size={16} />} />
        <CardBody>
          <GitAccessForm />
        </CardBody>
      </Card>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-ink-soft">
          {t('gitCredentials.existing.title')}
        </h2>
        {credentials.length === 0 ? (
          <EmptyState
            icon={<KeyRound size={22} />}
            title={t('gitCredentials.empty.title')}
            description={t('gitCredentials.empty.description')}
          />
        ) : (
          credentials.map((credential) => <GitAccessRow key={credential.host} credential={credential} />)
        )}
      </section>

      {/* Le modèle de confiance reste à un clic : il compte pour qui choisit les portées
          d'un jeton, mais il n'a pas à se dresser devant qui veut juste cloner. */}
      <details className="group rounded-md border border-line px-3 py-2 text-sm">
        <summary className="flex cursor-pointer items-center gap-2 text-ink-soft outline-offset-4 focus-visible:outline-accent">
          <ShieldCheck size={16} className="shrink-0 text-ink-faint" />
          {t('gitCredentials.security.summary')}
        </summary>
        <div className="mt-2 flex flex-col gap-2 text-ink-soft">
          <p>{t('gitCredentials.banner')}</p>
          <p>{t('gitCredentials.trustModel')}</p>
        </div>
      </details>
    </div>
  )
}
