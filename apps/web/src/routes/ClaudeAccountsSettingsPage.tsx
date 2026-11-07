import { Gauge, IdCard, KeyRound, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { ClaudeAccount, ClaudeLoginStatusDto } from '@solera/protocol'
import {
  Badge,
  Banner,
  Button,
  Card,
  CardBody,
  CardHeader,
  ChoiceList,
  ConfirmDialog,
  EmptyState,
  Field,
} from '@solera/ui'
import { ClaudeCodeSteps } from '../components/settings/LoginSteps'
import { ListHeading, SectionHeader } from '../components/settings/SectionHeader'
import { ApiRequestError } from '../lib/api'
import { locale, useTranslate } from '../lib/i18n'
import {
  useCancelClaudeLogin,
  useClaudeAccounts,
  useClaudeLoginStatus,
  useCreateClaudeAccount,
  useDeleteClaudeAccount,
  useReconnectClaudeAccount,
  useStartClaudeGauge,
  useStartClaudeLogin,
  useUpdateClaudeAccount,
} from '../lib/claude-accounts'

/**
 * Comptes Claude supplémentaires du compte Solera.
 *
 * Un compte est une adresse Claude : la connexion guidée pilote `claude setup-token`, le
 * jeton obtenu dit son adresse, et c'est elle qui nomme le compte, un alias facultatif
 * en plus. Puis elle enchaîne `claude auth login` pour la jauge de consommation, qui doit
 * mener à la même adresse. On peut aussi coller un jeton obtenu ailleurs, ou une clé API
 * Console facturée à l'usage, que son alias seul nomme.
 *
 * Comme pour les accès git, l'écran n'affiche jamais un secret : l'API n'en rend
 * aucun. Ce qui reste et qui compte, c'est l'adresse, sa nature, et la date du dernier
 * secret, parce qu'un jeton expire au bout d'un an.
 */

const errorOf = (error: unknown): string | null =>
  error instanceof ApiRequestError ? error.message : null

type AddMode = 'guided' | 'paste'

/** `bare` : rendue dans l'onglet du CLI de la section Agents, qui porte déjà l'en-tête. */
export function ClaudeAccountsSettingsPage({ bare = false }: { bare?: boolean } = {}) {
  const t = useTranslate()
  const { data } = useClaudeAccounts()

  const [adding, setAdding] = useState(false)

  const accounts = data?.accounts ?? []
  const addButton = (
    <Button size="sm" icon={<Plus size={14} />} disabled={adding} onClick={() => setAdding(true)}>
      {t(accounts.length > 0 ? 'claudeAccounts.create.another' : 'claudeAccounts.create.open')}
    </Button>
  )

  return (
    <div className="flex flex-col gap-4">
      {bare ? null : (
        <SectionHeader
          description={t('claudeAccounts.section.description')}
        />
      )}

      <Banner tone="info">{t('claudeAccounts.banner')}</Banner>

      <section className="flex flex-col gap-2">
        <ListHeading
          title={t('claudeAccounts.existing.title')}
          count={accounts.length}
          action={accounts.length > 0 ? addButton : null}
        />

        {adding ? <AddAccountCard onClose={() => setAdding(false)} /> : null}

        {accounts.length === 0 ? (
          adding ? null : (
            <EmptyState
              icon={<IdCard size={22} />}
              title={t('claudeAccounts.empty.title')}
              description={t('claudeAccounts.empty.description')}
              action={addButton}
            />
          )
        ) : (
          accounts.map((account) => <AccountCard key={account.id} account={account} />)
        )}
      </section>
    </div>
  )
}

/**
 * Le formulaire d'ajout : un alias facultatif, puis la voie. Guidée, le CLI est piloté
 * par le serveur et l'écran suit ses étapes ; collée, le secret part tel quel.
 */
function AddAccountCard({ onClose }: { onClose: () => void }) {
  const t = useTranslate()
  const create = useCreateClaudeAccount()
  const start = useStartClaudeLogin()
  const [mode, setMode] = useState<AddMode>('guided')
  const [alias, setAlias] = useState('')
  const [token, setToken] = useState('')
  /** La connexion guidée en cours, une fois lancée. */
  const [login, setLogin] = useState<ClaudeLoginStatusDto | null>(null)

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const named = alias.trim() ? { alias: alias.trim() } : {}
    if (mode === 'paste') {
      create.mutate({ ...named, token: token.trim() }, { onSuccess: onClose })
    } else {
      start.mutate(named, { onSuccess: setLogin })
    }
  }

  if (login) return <GuidedLogin initial={login} onClose={onClose} />

  const modes = [
    { value: 'guided' as const, label: t('claudeAccounts.mode.guided'), hint: t('claudeAccounts.mode.guided.hint') },
    { value: 'paste' as const, label: t('claudeAccounts.mode.paste'), hint: t('claudeAccounts.mode.paste.hint') },
  ]
  const pending = create.isPending || start.isPending
  const failure = errorOf(create.error) ?? errorOf(start.error)

  return (
    <Card>
      <CardHeader title={t('claudeAccounts.create.title')} icon={<IdCard size={16} />} />
      <CardBody>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <ChoiceList label={t('claudeAccounts.mode.label')} value={mode} options={modes} onChange={setMode} />
          <Field
            label={t('claudeAccounts.alias.label')}
            hint={t(mode === 'paste' ? 'claudeAccounts.alias.hintPaste' : 'claudeAccounts.alias.hint')}
            value={alias}
            onChange={(event) => setAlias(event.target.value)}
            maxLength={60}
          />
          {mode === 'paste' ? (
            <div className="flex flex-col gap-2">
              <Field
                label={t('claudeAccounts.token.label')}
                hint={t('claudeAccounts.token.hint')}
                type="password"
                value={token}
                onChange={(event) => setToken(event.target.value)}
                // Le gestionnaire de mots de passe du navigateur n'a rien à retenir ici.
                autoComplete="off"
                autoCapitalize="none"
                autoCorrect="off"
                required
              />
              <p className="text-meta text-ink-faint">
                {t('claudeAccounts.token.howto')}{' '}
                <code className="rounded bg-sunken px-1 py-0.5 font-mono text-[0.8125rem] text-ink">claude setup-token</code>
              </p>
            </div>
          ) : (
            <p className="text-meta text-ink-faint">{t('claudeAccounts.guided.explain')}</p>
          )}
          {failure ? <Banner>{failure}</Banner> : null}
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" disabled={pending}>
              {pending
                ? t('claudeAccounts.create.pending')
                : mode === 'paste'
                  ? t('claudeAccounts.create.action')
                  : t('claudeAccounts.guided.start')}
            </Button>
            <Button type="button" variant="ghost" onClick={onClose}>
              {t('common.cancel')}
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  )
}

/**
 * Les étapes du CLI, suivies à l'écran : le compte d'abord (`setup-token`), puis sa
 * consommation (`auth login`), enchaînée d'office quand le compte n'en a pas encore, et
 * toujours à la reconnexion.
 * Un code refusé se ressaisit sans tout recommencer, tant que le CLI vit.
 */
function GuidedLogin({
  initial: first,
  onClose,
  renewGauge = false,
}: {
  initial: ClaudeLoginStatusDto
  onClose: () => void
  /** Reconnexion : la jauge se refait aussi, elle peut être morte ou d'une autre adresse. */
  renewGauge?: boolean
}) {
  const t = useTranslate()
  /**
   * La connexion suivie : celle du jeton, puis celle de la jauge. Les deux passent par
   * les mêmes routes de suivi, seul l'identifiant change.
   */
  const [initial, setInitial] = useState(first)
  const { data: polled } = useClaudeLoginStatus(initial.loginId)
  const cancel = useCancelClaudeLogin()
  const startGauge = useStartClaudeGauge()
  // L'envoi d'un code pose sa réponse dans la même relecture : c'est elle qui fait foi.
  const status = polled ?? initial
  const gauge = status.purpose === 'gauge'
  const account = status.account
  /** Le compte est là, il lui manque sa jauge : c'est la seconde étape, sans demander. */
  const chain = !gauge && status.state === 'done' && account !== null && account.kind === 'oauth' && (renewGauge || !account.gauge)
  const chained = useRef(false)
  /** Le compte connecté à la première étape, quand la jauge en est la seconde. */
  const [stepOne, setStepOne] = useState<ClaudeAccount | null>(null)

  useEffect(() => {
    if (!chain || chained.current || !account) return
    chained.current = true
    startGauge.mutate(account.id, {
      onSuccess: (next) => {
        setStepOne(account)
        // Le formulaire du code repart vide : il est lié à l'identifiant de la connexion.
        setInitial(next)
      },
    })
  }, [chain, account, startGauge])

  const close = () => {
    if (status.state !== 'done') cancel.mutate(initial.loginId)
    onClose()
  }

  return (
    <Card>
      <CardHeader
        title={gauge ? t('claudeAccounts.gauge.title') : t('claudeAccounts.guided.title')}
        icon={gauge ? <Gauge size={16} /> : <IdCard size={16} />}
      />
      <CardBody className="flex flex-col gap-4">
        {gauge && status.state !== 'done' ? (
          <>
            {stepOne ? <Banner tone="positive">{t('claudeAccounts.guided.stepOneDone', { label: stepOne.label })}</Banner> : null}
            <p className="text-sm text-ink-soft">
              {account?.email
                ? t('claudeAccounts.gauge.explainWithEmail', { email: account.email })
                : t('claudeAccounts.gauge.explain')}
            </p>
          </>
        ) : null}
        {chain ? (
          // Entre les deux étapes : la jauge se prépare, ou n'a pas pu.
          errorOf(startGauge.error) ? (
            <>
              <Banner tone="positive">{t('claudeAccounts.guided.done', { label: account?.label ?? '' })}</Banner>
              <Banner>{errorOf(startGauge.error)}</Banner>
              <div>
                <Button type="button" onClick={onClose}>
                  {t('common.close')}
                </Button>
              </div>
            </>
          ) : (
            <p className="text-sm text-ink-faint">{t('claudeAccounts.guided.starting')}</p>
          )
        ) : status.state === 'done' ? (
          <>
            <Banner tone="positive">
              {gauge
                ? t('claudeAccounts.gauge.done', { label: account?.label ?? '' })
                : t('claudeAccounts.guided.done', { label: account?.label ?? '' })}
            </Banner>
            <div>
              <Button type="button" onClick={onClose}>
                {t('common.close')}
              </Button>
            </div>
          </>
        ) : (
          <ClaudeCodeSteps key={initial.loginId} status={status} onCancel={close} />
        )}
      </CardBody>
    </Card>
  )
}

function AccountCard({ account }: { account: ClaudeAccount }) {
  const t = useTranslate()
  const update = useUpdateClaudeAccount()
  const remove = useDeleteClaudeAccount()
  const startGauge = useStartClaudeGauge()
  const reconnect = useReconnectClaudeAccount()
  /** La connexion en cours pour ce compte (reconnexion ou jauge), une fois lancée. */
  const [login, setLogin] = useState<ClaudeLoginStatusDto | null>(null)
  const [renewing, setRenewing] = useState(false)
  const [editing, setEditing] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [alias, setAlias] = useState(account.alias ?? '')
  const [token, setToken] = useState('')

  const subscription = account.kind === 'oauth'
  /** Un abonnement sans adresse : d'avant les adresses, et son jeton ne répond plus. */
  const lost = subscription && account.email === null
  const busy = login !== null || startGauge.isPending || reconnect.isPending

  const openEdit = () => {
    setAlias(account.alias ?? '')
    setToken('')
    update.reset()
    setEditing(true)
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const trimmedAlias = alias.trim()
    const trimmedToken = token.trim()
    update.mutate(
      {
        id: account.id,
        ...(trimmedAlias !== (account.alias ?? '') ? { alias: trimmedAlias || null } : {}),
        ...(trimmedToken ? { token: trimmedToken } : {}),
      },
      { onSuccess: () => setEditing(false) },
    )
  }

  return (
    <Card>
      {editing ? (
        <>
          <CardHeader title={t('claudeAccounts.edit.title', { label: account.label })} icon={<Pencil size={16} />} />
          <CardBody>
            <form onSubmit={submit} className="flex flex-col gap-4">
              <Field
                label={t('claudeAccounts.alias.label')}
                hint={account.email ? t('claudeAccounts.alias.editHint', { email: account.email }) : undefined}
                value={alias}
                onChange={(event) => setAlias(event.target.value)}
                maxLength={60}
                required={!subscription}
              />
              <Field
                label={t('claudeAccounts.token.label')}
                hint={t('claudeAccounts.token.replaceHint')}
                type="password"
                value={token}
                onChange={(event) => setToken(event.target.value)}
                autoComplete="off"
                autoCapitalize="none"
                autoCorrect="off"
              />
              {errorOf(update.error) ? <Banner>{errorOf(update.error)}</Banner> : null}
              <div className="flex flex-wrap items-center gap-2">
                <Button type="submit" disabled={update.isPending || (alias.trim() === (account.alias ?? '') && !token.trim())}>
                  {update.isPending ? t('claudeAccounts.edit.pending') : t('claudeAccounts.edit.action')}
                </Button>
                <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
                  {t('common.cancel')}
                </Button>
              </div>
            </form>
          </CardBody>
        </>
      ) : (
        <CardBody className="flex flex-wrap items-start gap-3">
          <div className="flex min-w-0 flex-1 basis-48 flex-col gap-1">
            <span className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{account.alias ?? account.email}</span>
              {account.alias && account.email ? <span className="text-sm text-ink-soft">{account.email}</span> : null}
              <Badge icon={<KeyRound size={11} />}>
                {subscription ? t('claudeAccounts.kind.oauth') : t('claudeAccounts.kind.apiKey')}
              </Badge>
              {lost ? <Badge tone="caution">{t('claudeAccounts.email.unknown')}</Badge> : null}
            </span>
            <p className="text-meta text-ink-faint">
              {t('claudeAccounts.updatedAt', {
                date: new Date(account.updatedAt).toLocaleString(locale()),
              })}
            </p>
            {/* La consommation d'un abonnement : sans elle, le choix du compte se fait à l'aveugle. */}
            {subscription && !lost ? (
              <div className="mt-1 flex flex-wrap items-center gap-2 text-meta">
                <span className={account.gauge ? 'text-ink-soft' : 'text-ink-faint'}>
                  <Gauge size={12} className="mr-1 inline align-[-2px]" />
                  {account.gauge ? t('claudeAccounts.gauge.on') : t('claudeAccounts.gauge.off')}
                </span>
                {account.gauge ? null : (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() =>
                      startGauge.mutate(account.id, {
                        onSuccess: (next) => {
                          setRenewing(false)
                          setLogin(next)
                        },
                      })
                    }
                  >
                    {t('claudeAccounts.gauge.enable')}
                  </Button>
                )}
              </div>
            ) : null}
            {lost ? <p className="text-meta text-ink-soft">{t('claudeAccounts.email.lostHint')}</p> : null}
            {account.duplicate ? <Banner tone="caution">{t('claudeAccounts.duplicate')}</Banner> : null}
            {errorOf(startGauge.error) ?? errorOf(reconnect.error) ? (
              <Banner>{errorOf(startGauge.error) ?? errorOf(reconnect.error)}</Banner>
            ) : null}
          </div>

          {subscription ? (
            <Button
              size="sm"
              variant={lost ? 'primary' : 'ghost'}
              icon={<RefreshCw size={14} />}
              disabled={busy}
              onClick={() =>
                reconnect.mutate(account.id, {
                  onSuccess: (next) => {
                    setRenewing(true)
                    setLogin(next)
                  },
                })
              }
            >
              {t('claudeAccounts.action.reconnect')}
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" icon={<Pencil size={14} />} onClick={openEdit}>
            {t('claudeAccounts.action.edit')}
          </Button>
          <Button
            size="sm"
            variant="danger"
            icon={<Trash2 size={14} />}
            onClick={() => setConfirming(true)}
          >
            {t('claudeAccounts.action.delete')}
          </Button>
        </CardBody>
      )}

      {login ? (
        <div className="border-t border-line">
          <GuidedLogin initial={login} renewGauge={renewing} onClose={() => setLogin(null)} />
        </div>
      ) : null}

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t('claudeAccounts.delete.title', { label: account.label })}
        confirmLabel={t('claudeAccounts.delete.confirm')}
        tone="critical"
        busy={remove.isPending}
        onConfirm={() => remove.mutate(account.id)}
      >
        {t('claudeAccounts.delete.body')}
      </ConfirmDialog>
    </Card>
  )
}
