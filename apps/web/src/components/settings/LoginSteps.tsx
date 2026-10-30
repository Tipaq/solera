import { ExternalLink } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import type { ClaudeLoginStatusDto } from '@solera/protocol'
import { Banner, Button, Field } from '@solera/ui'
import { ApiRequestError } from '../../lib/api'
import { useSubmitClaudeLoginCode } from '../../lib/claude-accounts'
import { useTranslate, type MessageKey } from '../../lib/i18n'

/**
 * Les étapes d'une connexion menée par un CLI côté serveur, telles que l'écran les
 * montre. Les mêmes pour un compte supplémentaire et pour la connexion du CLI lui-même :
 * seul ce qui les lance et ce qui suit leur fin change.
 */

/**
 * Claude : la page d'autorisation à ouvrir, puis le code qu'elle affiche à coller. Un
 * code refusé se ressaisit sans tout recommencer, tant que le CLI vit.
 */
export function ClaudeCodeSteps({
  status,
  onCancel,
}: {
  /** Ce que le serveur dit du dialogue ; jamais `done`, que l'appelant montre à sa façon. */
  status: ClaudeLoginStatusDto
  onCancel: () => void
}) {
  const t = useTranslate()
  const submit = useSubmitClaudeLoginCode(status.loginId)
  const [code, setCode] = useState('')
  const failure = submit.error instanceof ApiRequestError ? submit.error.message : null

  const send = (event: FormEvent) => {
    event.preventDefault()
    submit.mutate({ code: code.trim() })
  }

  return (
    <form onSubmit={send} className="flex flex-col gap-4">
      <ol className="flex list-decimal flex-col gap-2 pl-5 text-sm text-ink-soft">
        <li>
          {t('claudeAccounts.guided.step.open')}{' '}
          {status.authUrl ? (
            <a
              href={status.authUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-accent underline-offset-2 hover:underline"
            >
              {t('claudeAccounts.guided.openLink')}
              <ExternalLink size={14} />
            </a>
          ) : (
            <span className="text-ink-faint">{t('claudeAccounts.guided.starting')}</span>
          )}
        </li>
        <li>{t('claudeAccounts.guided.step.authorize')}</li>
        <li>{t('claudeAccounts.guided.step.paste')}</li>
      </ol>
      <Field
        label={t('claudeAccounts.guided.code.label')}
        hint={t('claudeAccounts.guided.code.hint')}
        value={code}
        onChange={(event) => setCode(event.target.value)}
        autoComplete="off"
        autoCapitalize="none"
        autoCorrect="off"
        disabled={status.state === 'starting' || status.state === 'checking'}
        required
      />
      {status.state === 'failed' && status.error ? <Banner>{status.error}</Banner> : null}
      {failure ? <Banner>{failure}</Banner> : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={submit.isPending || status.state === 'checking' || status.state === 'starting'}>
          {submit.isPending || status.state === 'checking'
            ? t('claudeAccounts.guided.checking')
            : t('claudeAccounts.guided.submit')}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          {t('common.cancel')}
        </Button>
      </div>
    </form>
  )
}

const DEVICE_TEXTS: Record<'codex' | 'grok', { instructions: MessageKey; open: MessageKey; waiting: MessageKey }> = {
  codex: { instructions: 'codexAccounts.device.instructions', open: 'codexAccounts.device.open', waiting: 'codexAccounts.device.waiting' },
  grok: { instructions: 'grokAccounts.device.instructions', open: 'grokAccounts.device.open', waiting: 'grokAccounts.device.waiting' },
}

/**
 * Codex et Grok : le code d'appareil à saisir sur la page du fournisseur. La fin
 * s'apprend côté serveur, l'écran n'a qu'à attendre.
 */
export function DeviceCodeSteps({
  agent,
  userCode,
  verificationUrl,
  cancelling = false,
  onCancel,
}: {
  agent: 'codex' | 'grok'
  userCode: string | null
  verificationUrl: string | null
  cancelling?: boolean
  onCancel: () => void
}) {
  const t = useTranslate()
  const texts = DEVICE_TEXTS[agent]
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-ink-soft">{t(texts.instructions)}</p>
      <div className="flex flex-wrap items-center gap-3">
        <code className="rounded-md bg-sunken px-3 py-2 font-mono text-lg tracking-widest text-ink">{userCode}</code>
        <a
          href={verificationUrl ?? '#'}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-sm text-accent underline-offset-2 hover:underline"
        >
          {t(texts.open)}
          <ExternalLink size={14} />
        </a>
      </div>
      <p className="text-meta text-ink-faint">{t(texts.waiting)}</p>
      <div>
        <Button size="sm" variant="ghost" disabled={cancelling} onClick={onCancel}>
          {t('common.cancel')}
        </Button>
      </div>
    </div>
  )
}
