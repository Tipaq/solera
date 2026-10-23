import { IdCard, KeyRound, User } from 'lucide-react'
import { useState } from 'react'
import { Field } from '@solera/ui'
import { ApiRequestError } from '../../lib/api'
import { useTranslate } from '../../lib/i18n'
import { useSetupAccount } from '../../lib/session'
import { StepTitle, Why, useCommit, useGate, type StepProps } from './shell'

const USERNAME = /^[a-z0-9._-]+$/i
const PASSWORD_MIN = 8

/**
 * Le premier compte d'une instance hébergée, créé depuis le navigateur parce que la
 * base n'en a aucun. Administrateur d'office : personne d'autre ne pourrait le promouvoir.
 * La session s'ouvre avec lui, et la visite continue sans passer par la connexion.
 */
export function AccountStep({ nav }: StepProps) {
  const t = useTranslate()
  const setup = useSetupAccount()
  const [displayName, setDisplayName] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')

  const usernameValid = USERNAME.test(username)
  const passwordValid = password.length >= PASSWORD_MIN
  useGate(nav, {
    canContinue: displayName.trim() !== '' && usernameValid && passwordValid,
    laterAllowed: false,
    skipAllowed: false,
  })
  useCommit(nav, async () => {
    try {
      await setup.mutateAsync({ displayName: displayName.trim(), username, password })
    } catch (error) {
      // Le message du serveur est déjà traduit par `api` ; une panne réseau ne l'est pas.
      throw new Error(error instanceof ApiRequestError ? error.message : t('login.error.unreachable'))
    }
  })

  return (
    <>
      <StepTitle title={t('onboarding.account.title')} lead={t('onboarding.account.lead')} />
      <Why>{t('onboarding.account.why')}</Why>
      <div className="flex flex-col gap-4">
        <Field
          label={t('onboarding.account.displayName')}
          icon={<IdCard size={16} />}
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
          autoComplete="name"
          autoFocus
        />
        <Field
          label={t('login.username.label')}
          hint={t('onboarding.account.username.hint')}
          error={username !== '' && !usernameValid ? t('onboarding.account.username.invalid') : undefined}
          icon={<User size={16} />}
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          autoComplete="username"
          autoCapitalize="none"
        />
        <Field
          label={t('login.password.label')}
          type="password"
          hint={t('onboarding.account.password.hint', { count: PASSWORD_MIN })}
          error={password !== '' && !passwordValid ? t('onboarding.account.password.short', { count: PASSWORD_MIN }) : undefined}
          icon={<KeyRound size={16} />}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="new-password"
        />
      </div>
    </>
  )
}
