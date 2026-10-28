import { IdCard } from 'lucide-react'
import type { AgentAuthDto, AgentConfig, UsagePeekDto } from '@solera/protocol'
import { ChoiceList, cx } from '@solera/ui'
import { useTranslate } from '../../lib/i18n'
import { openSettings } from '../../lib/settings-dialog'
import { peekOf, peekSummary } from '../../lib/usage-peek'
import { useAgentSettings } from './agent-settings'

/**
 * Sur quel compte la session va partir, et où il en est.
 *
 * C'est la question qui compte au moment d'ouvrir une session quand un abonnement
 * approche de sa limite. Le modèle et l'effort restent dans la puce du composer : on
 * les change en cours de route, le compte se choisit avant.
 *
 * Toujours montré, même sans compte supplémentaire : la connexion du CLI y dit alors
 * qui elle est (l'identité lue par `GET /api/agents/auth`) et sa consommation, et le
 * lien mène à l'ajout d'un compte. Les options viennent des réglages du composer, qui
 * savent déjà lesquelles sont prêtes ; l'aperçu de consommation est gratuit, aucun CLI
 * n'est lancé pour l'écrire.
 */

/** Valeur de l'option « connexion du CLI » dans les réglages du composer. */
const CLI_CHOICE = 'cli-default'

export function DraftAccount({
  config,
  onChange,
  disabled,
  auth,
  peek,
}: {
  config: AgentConfig
  onChange: (config: AgentConfig) => void
  disabled: boolean
  /** La connexion propre du CLI retenu. */
  auth: AgentAuthDto | undefined
  peek: UsagePeekDto[] | undefined
}) {
  const t = useTranslate()
  const { groups } = useAgentSettings({ config, onConfigChange: onChange, disabled })
  // OpenCode n'emprunte aucun compte : ses fournisseurs se règlent dans son propre CLI.
  if (config.agent === 'opencode') return null

  const group = groups.find((entry) => entry.key === 'account')
  const hintFor = (value: string, fallback?: string) => {
    const account = value === CLI_CHOICE ? null : value
    const parts = account === null
      ? [auth?.status === 'logged_out' ? t('usage.loggedOut') : null, auth?.plan ?? null]
      : [fallback ?? null]
    const summary = peekSummary(peekOf(peek, config.agent, account))
    return [...parts, summary?.text ?? null].filter(Boolean).join(' · ') || undefined
  }
  const cliLabel = auth?.identity ?? t('composer.account.cli')
  const options = (group?.options ?? [{ value: CLI_CHOICE, label: cliLabel }]).map((option) => ({
    value: option.value,
    label: option.value === CLI_CHOICE ? cliLabel : (option.listed ?? option.label),
    hint: hintFor(option.value, option.value === CLI_CHOICE ? undefined : option.hint),
    icon: <IdCard size={14} />,
  }))
  const value = group?.value ?? CLI_CHOICE
  const manage = (
    <button
      type="button"
      className="text-xs text-ink-faint underline hover:text-ink"
      onClick={() => openSettings('agents', config.agent)}
    >
      {t(options.length > 1 ? 'draft.account.manage' : 'draft.account.add')}
    </button>
  )

  if (options.length > 1 && group) {
    return (
      <div className="flex flex-col gap-1">
        <ChoiceList label={t('draft.account.legend')} value={value} options={options} onChange={group.onChange} />
        <div className="flex justify-end">{manage}</div>
      </div>
    )
  }

  // Un seul compte : rien à choisir, la ligne dit seulement qui et où il en est.
  const only = options[0]!
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-ink-soft">{t('draft.account.legend')}</span>
      <div className={cx('flex items-center gap-2.5 rounded-md border border-line px-3 py-2', disabled && 'opacity-60')}>
        <span className="shrink-0 text-ink-faint">{only.icon}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm text-ink">{only.label}</span>
          {only.hint ? <span className="block truncate text-xs text-ink-faint">{only.hint}</span> : null}
        </span>
        {manage}
      </div>
    </div>
  )
}
