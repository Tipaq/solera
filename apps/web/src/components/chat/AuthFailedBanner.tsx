import { Banner, ChoiceList } from '@solera/ui'
import { useClaudeAccounts } from '../../lib/claude-accounts'
import { useConversationConfig } from '../../lib/conversation-config'
import { useConversation } from '../../lib/conversations'
import { useTranslate } from '../../lib/i18n'
import { openSettings } from '../../lib/settings-dialog'

/**
 * Un tour refusé faute d'authentification (`auth_failed`).
 *
 * « Failed to authenticate » ne disait pas quel compte avait été refusé : la connexion
 * du terminal et un compte de Solera échouent avec le même texte, et ne se réparent pas
 * au même endroit. La bannière nomme le compte, puis propose les autres comptes Claude
 * de l'utilisateur : en choisir un change le compte du fil, et le prochain message
 * repart dessus.
 */
export function AuthFailedBanner({
  conversationId,
  account,
  message,
  canDecide,
}: {
  conversationId: string
  account: { id: string | null; label: string | null }
  message: string
  canDecide: boolean
}) {
  const t = useTranslate()
  const { data: conversation } = useConversation(conversationId)
  const { config, change } = useConversationConfig(conversation)
  const { data: accounts } = useClaudeAccounts(canDecide)

  const used = account.id === null
    ? t('authFailed.terminal')
    : t('authFailed.account', { label: account.label ?? '' })
  // Le compte refusé n'est pas une issue : seuls les autres se proposent.
  const current = config?.agent === 'claude' ? config.account : null
  const others = (accounts?.accounts ?? []).filter((entry) => entry.id !== account.id)
  const pick = (id: string) => {
    if (config?.agent !== 'claude') return
    change({ ...config, account: id })
  }

  return (
    <Banner tone="caution">
      <span className="flex flex-col gap-2">
        <span>
          <span className="font-medium">{t('error.auth_failed')}</span>
          <br />
          <span>{used}</span>
          {message ? <span className="block text-xs whitespace-pre-wrap break-words">{message}</span> : null}
        </span>
        {canDecide && others.length > 0 && config?.agent === 'claude' ? (
          <ChoiceList
            label={t('authFailed.pick')}
            value={others.some((entry) => entry.id === current) ? current! : ''}
            options={others.map((entry) => ({ value: entry.id, label: entry.label }))}
            onChange={pick}
          />
        ) : null}
        {canDecide ? (
          <span>
            <button
              type="button"
              className="text-xs underline"
              onClick={() => openSettings('agents', 'claude')}
            >
              {t(others.length > 0 ? 'draft.account.manage' : 'claudeAccounts.connect.first')}
            </button>
          </span>
        ) : null}
      </span>
    </Banner>
  )
}
