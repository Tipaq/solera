import { ExternalLink, KeyRound, Trash2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import {
  GITHUB_HOST,
  GITLAB_HOST,
  tokenCreationUrl,
  type GitCredential,
  type PutGitCredentialBody,
} from '@solera/protocol'
import { Banner, Button, Card, CardBody, ChoiceList, ConfirmDialog, Field, type Choice } from '@solera/ui'
import { ApiRequestError } from '../../lib/api'
import { normalizeHost, useDeleteGitCredential, usePutGitCredential } from '../../lib/git-credentials'
import { locale, useTranslate, type MessageKey } from '../../lib/i18n'

/**
 * Le formulaire d'un accès git et la ligne d'un accès enregistré.
 *
 * Qui connecte GitHub ou GitLab n'a ni hôte ni nom d'utilisateur à connaître : il choisit
 * sa forge, ouvre la page qui crée le jeton déjà réglé, et le colle. Le serveur le
 * vérifie avant de l'enregistrer. Seule une forge inconnue garde les trois champs.
 *
 * Le choix est fait pour qu'un bouton « Se connecter avec … » (OAuth) se pose plus tard
 * à côté des étapes du jeton, forge par forge, sans changer le reste.
 */

/**
 * Ce que l'écran propose, plus fin que la forge du serveur : GitLab.com et une GitLab
 * d'entreprise ne se distinguent que par l'hôte, mais la seconde demande de le saisir.
 */
export type ForgeChoice = 'github' | 'gitlab-com' | 'gitlab-self' | 'other'

const CHOICE_KEYS: Record<ForgeChoice, { label: MessageKey; hint: MessageKey }> = {
  github: { label: 'gitCredentials.forge.github', hint: 'gitCredentials.forge.github.hint' },
  'gitlab-com': { label: 'gitCredentials.forge.gitlabCom', hint: 'gitCredentials.forge.gitlabCom.hint' },
  'gitlab-self': { label: 'gitCredentials.forge.gitlabSelf', hint: 'gitCredentials.forge.gitlabSelf.hint' },
  other: { label: 'gitCredentials.forge.other', hint: 'gitCredentials.forge.other.hint' },
}

/** Le corps de la requête sans le jeton, forge par forge. */
type Target = PutGitCredentialBody extends infer Body
  ? Body extends unknown
    ? Omit<Body, 'token'>
    : never
  : never

const errorOf = (error: unknown): string | null =>
  error instanceof ApiRequestError ? error.message : null

export function GitAccessForm({ initialChoice = 'github' }: { initialChoice?: ForgeChoice }) {
  const t = useTranslate()
  const putCredential = usePutGitCredential()

  const [choice, setChoice] = useState<ForgeChoice>(initialChoice)
  const [gitlabHost, setGitlabHost] = useState('')
  const [host, setHost] = useState('')
  const [username, setUsername] = useState('x-access-token')
  const [token, setToken] = useState('')

  const choices: Choice<ForgeChoice>[] = (Object.keys(CHOICE_KEYS) as ForgeChoice[]).map((value) => ({
    value,
    label: t(CHOICE_KEYS[value].label),
    hint: t(CHOICE_KEYS[value].hint),
  }))

  /** Ce qui partira au serveur, hors jeton ; l'hôte de la GitLab tel qu'on l'a collé, nettoyé. */
  const target: Target =
    choice === 'github'
      ? { forge: 'github' }
      : choice === 'gitlab-com'
        ? { forge: 'gitlab', host: GITLAB_HOST }
        : choice === 'gitlab-self'
          ? { forge: 'gitlab', host: normalizeHost(gitlabHost) }
          : { forge: 'other', host: normalizeHost(host), username: username.trim() }

  const forgeName = choice === 'github' ? t('gitCredentials.forge.github') : t('gitCredentials.forge.gitlab')
  const creationUrl =
    target.forge === 'github'
      ? tokenCreationUrl('github', GITHUB_HOST)
      : target.forge === 'gitlab' && target.host
        ? tokenCreationUrl('gitlab', target.host)
        : null

  const submit = (event: FormEvent) => {
    event.preventDefault()
    putCredential.mutate({ ...target, token }, { onSuccess: () => setToken('') })
  }

  const pick = (next: ForgeChoice) => {
    setChoice(next)
    // L'erreur du choix précédent (un jeton GitHub refusé) ne dit rien du nouveau.
    putCredential.reset()
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <ChoiceList label={t('gitCredentials.forge.label')} value={choice} options={choices} onChange={pick} />

      {choice === 'gitlab-self' ? (
        <Field
          label={t('gitCredentials.gitlabHost.label')}
          hint={t('gitCredentials.gitlabHost.hint')}
          value={gitlabHost}
          onChange={(event) => setGitlabHost(event.target.value)}
          placeholder="gitlab.monentreprise.fr"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          required
        />
      ) : null}

      {choice === 'other' ? (
        <>
          <Field
            label={t('gitCredentials.host.label')}
            hint={t('gitCredentials.host.hint')}
            value={host}
            onChange={(event) => setHost(event.target.value)}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            required
          />
          <Field
            label={t('gitCredentials.username.label')}
            hint={t('gitCredentials.username.hint')}
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoCapitalize="none"
            autoCorrect="off"
            required
          />
        </>
      ) : (
        <ol className="flex list-decimal flex-col gap-2 pl-5 text-sm text-ink-soft">
          <li>
            {t('gitCredentials.step.create')}{' '}
            {creationUrl ? (
              <a
                href={creationUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-accent underline-offset-2 hover:underline"
              >
                {t('gitCredentials.step.createLink', { forge: forgeName })}
                <ExternalLink size={14} />
              </a>
            ) : (
              <span className="text-ink-faint">{t('gitCredentials.step.needHost')}</span>
            )}
          </li>
          <li>{t('gitCredentials.step.generate')}</li>
          <li>{t('gitCredentials.step.paste')}</li>
        </ol>
      )}

      <Field
        label={t('gitCredentials.token.label')}
        hint={
          choice === 'other'
            ? t('gitCredentials.token.hint')
            : t('gitCredentials.token.hint.verified', { forge: forgeName })
        }
        type="password"
        value={token}
        onChange={(event) => setToken(event.target.value)}
        // Le gestionnaire de mots de passe du navigateur n'a rien à retenir ici.
        autoComplete="off"
        required
      />
      {errorOf(putCredential.error) ? <Banner>{errorOf(putCredential.error)}</Banner> : null}
      <Button type="submit" disabled={putCredential.isPending} className="self-start">
        {putCredential.isPending
          ? t(choice === 'other' ? 'gitCredentials.create.pending' : 'gitCredentials.create.checking')
          : t('gitCredentials.create.action')}
      </Button>
    </form>
  )
}

/**
 * Le nom de la forge, et l'hôte quand il apprend quelque chose : il est déjà dans le
 * nom pour GitHub et GitLab.com, et il est tout ce qu'on sait d'une autre forge.
 */
function forgeLabel(credential: GitCredential): { label: MessageKey | null; showHost: boolean } {
  if (credential.forge === 'github' && credential.host === GITHUB_HOST) {
    return { label: 'gitCredentials.forge.github', showHost: false }
  }
  if (credential.forge === 'gitlab' && credential.host === GITLAB_HOST) {
    return { label: 'gitCredentials.forge.gitlabCom', showHost: false }
  }
  if (credential.forge === 'gitlab') return { label: 'gitCredentials.forge.gitlab', showHost: true }
  return { label: null, showHost: true }
}

export function GitAccessRow({ credential }: { credential: GitCredential }) {
  const t = useTranslate()
  const deleteCredential = useDeleteGitCredential()
  const [confirming, setConfirming] = useState(false)
  const { label, showHost } = forgeLabel(credential)

  return (
    <Card>
      <CardBody className="flex items-start gap-3">
        <KeyRound size={16} className="mt-0.5 shrink-0 text-ink-faint" />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
            {label ? <span className="font-medium">{t(label)}</span> : null}
            {showHost ? <span className="truncate font-mono text-sm">{credential.host}</span> : null}
          </span>
          {credential.login ? (
            <p className="text-sm text-ink-soft">{t('gitCredentials.connectedAs', { login: credential.login })}</p>
          ) : credential.forge === 'other' ? (
            <p className="text-xs text-ink-faint">
              {t('gitCredentials.username.value', { username: credential.username })}
            </p>
          ) : (
            <p className="text-xs text-ink-faint">{t('gitCredentials.unverified')}</p>
          )}
          <p className="text-xs text-ink-faint">
            {t('gitCredentials.updatedAt', {
              date: new Date(credential.updatedAt).toLocaleString(locale()),
            })}
          </p>
        </div>

        <Button
          size="sm"
          variant="danger"
          icon={<Trash2 size={14} />}
          onClick={() => setConfirming(true)}
        >
          {t('gitCredentials.action.delete')}
        </Button>

        <ConfirmDialog
          open={confirming}
          onOpenChange={setConfirming}
          title={t('gitCredentials.delete.title', { host: credential.host })}
          confirmLabel={t('gitCredentials.delete.confirm')}
          tone="critical"
          busy={deleteCredential.isPending}
          onConfirm={() => deleteCredential.mutate(credential.host)}
        >
          {t('gitCredentials.delete.body')}
        </ConfirmDialog>
      </CardBody>
    </Card>
  )
}
