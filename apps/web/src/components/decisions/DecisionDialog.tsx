import * as Dialog from '@radix-ui/react-dialog'
import { ArrowUpRight, X } from 'lucide-react'
import { useEffect, useId, useState } from 'react'
import { Link } from 'react-router-dom'
import type { DecisionDto, DecisionStatus } from '@solera/protocol'
import { conversationPath } from '../../lib/conversation-route'
import { decisionDue, openDecision, useAnswerDecision, useDecision, useOpenDecision } from '../../lib/decisions'
import { useTranslate, type MessageKey } from '../../lib/i18n'
import { Markdown } from '../chat/Markdown'
import { Banner, Button, ChoiceList, IconButton, cx } from '@solera/ui'

export const DECISION_STATUS_LABELS: Record<DecisionStatus, MessageKey> = {
  pending: 'decision.status.pending',
  user: 'decision.status.user',
  default: 'decision.status.default',
  expired: 'decision.status.expired',
  withdrawn: 'decision.status.withdrawn',
}

/**
 * La réponse à une décision, d'où qu'on l'ouvre : la colonne, un toast, le fil de la
 * session, l'historique ou une notification. On tranche ici sans entrer dans la
 * conversation, qui reste à un clic.
 *
 * Coque du gabarit *Dialogue* : feuille au doigt, boîte de 640 px au large.
 */
export function DecisionDialog() {
  const t = useTranslate()
  const id = useOpenDecision()
  const { data: decision, isError } = useDecision(id)

  return (
    <Dialog.Root open={id !== null} onOpenChange={(next) => { if (!next) openDecision(null) }}>
      <Dialog.Portal>
        <Dialog.Overlay className="scrim z-40" />
        <Dialog.Content
          aria-describedby={undefined}
          className="surface fixed inset-x-0 bottom-0 z-50 flex max-h-[90dvh] flex-col rounded-t-xl border border-line shadow-pop sm:inset-x-auto sm:top-1/2 sm:bottom-auto sm:left-1/2 sm:w-[min(640px,calc(100vw-2rem))] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl"
        >
          <header className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-accent">
                {t(decision ? DECISION_STATUS_LABELS[decision.status] : 'decision.status.pending')}
              </p>
              <Dialog.Title className="mt-1 text-heading font-semibold text-ink">
                {decision?.question ?? (isError ? t('decision.dialog.missing') : '…')}
              </Dialog.Title>
              {decision ? (
                <p className="mt-1 truncate text-xs text-ink-faint">
                  {[decision.projectName, decision.conversationTitle].filter(Boolean).join(' · ')}
                </p>
              ) : null}
            </div>
            <IconButton label={t('common.close')} onClick={() => openDecision(null)}>
              <X size={16} />
            </IconButton>
          </header>
          {decision ? <DecisionBody key={decision.id} decision={decision} /> : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function DecisionBody({ decision }: { decision: DecisionDto }) {
  const t = useTranslate()
  const answer = useAnswerDecision()
  const textId = useId()
  const [option, setOption] = useState<string | null>(null)
  const [text, setText] = useState('')
  const pending = decision.status === 'pending'
  // Tranchée ailleurs pendant qu'on hésitait : on montre l'issue plutôt qu'une erreur.
  useEffect(() => {
    if (!pending) answer.reset()
  }, [pending]) // eslint-disable-line react-hooks/exhaustive-deps

  const ready = pending && !answer.isPending && (option !== null || text.trim() !== '')
  const submit = () => {
    if (!ready) return
    answer.mutate({ id: decision.id, option, text: text.trim() })
  }

  return (
    <form
      className="flex min-h-0 flex-col"
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
    >
      <div className="flex min-h-0 flex-col gap-5 overflow-y-auto p-5">
        {decision.context ? (
          <div className="min-w-0 rounded-lg border border-line bg-sunken px-4 py-3 text-sm break-words text-ink-soft">
            <Markdown text={decision.context} />
          </div>
        ) : null}

        {pending ? (
          <>
            {decision.options.length > 0 ? (
              <ChoiceList
                label={t('decision.dialog.options')}
                value={option ?? ''}
                options={decision.options.map((entry) => ({
                  value: entry,
                  label: entry,
                  hint: entry === decision.defaultOption ? t('decision.dialog.default') : undefined,
                }))}
                onChange={(value) => setOption((current) => (current === value ? null : value))}
              />
            ) : null}
            <div className="flex flex-col gap-1.5">
              <label htmlFor={textId} className="text-sm font-medium text-ink-soft">
                {t(decision.options.length > 0 ? 'decision.dialog.note' : 'decision.dialog.free')}
              </label>
              <textarea
                id={textId}
                value={text}
                rows={3}
                maxLength={4000}
                placeholder={t('decision.dialog.notePlaceholder')}
                onChange={(event) => setText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) submit()
                }}
                className="w-full resize-y rounded-md border border-line bg-sunken px-3 py-2 text-sm text-ink outline-none placeholder:text-ink-faint hover:border-line-strong focus:border-accent"
              />
            </div>
            <p className="text-xs text-ink-faint">
              {decisionDue(decision.expiresAt)} ·{' '}
              {decision.defaultOption
                ? t('decision.dialog.fallback', { option: decision.defaultOption })
                : t('decision.dialog.noFallback')}
            </p>
            {answer.isError ? <Banner>{answer.error.message}</Banner> : null}
          </>
        ) : (
          <DecisionOutcome decision={decision} />
        )}
      </div>

      <footer className="flex flex-wrap items-center gap-2 border-t border-line px-5 py-4 pb-safe">
        <Link
          to={conversationPath({ id: decision.conversationId, projectId: decision.projectId || null })}
          onClick={() => openDecision(null)}
          className="inline-flex min-h-11 items-center gap-1 text-sm text-ink-faint hover:text-accent md:min-h-9 pointer-coarse:min-h-11"
        >
          {t('decision.dialog.openSession')}
          <ArrowUpRight size={14} />
        </Link>
        <div className="flex-1" />
        <Button type="button" variant="ghost" onClick={() => openDecision(null)}>
          {t(pending ? 'decision.dialog.later' : 'common.close')}
        </Button>
        {pending ? (
          <Button type="submit" disabled={!ready}>
            {t(answer.isPending ? 'decision.dialog.sending' : 'decision.dialog.send')}
          </Button>
        ) : null}
      </footer>
    </form>
  )
}

/** Ce qu'il est advenu d'une décision close : la réponse, l'échéance ou le retrait. */
export function DecisionOutcome({ decision, className }: { decision: DecisionDto; className?: string }) {
  const t = useTranslate()
  const answer = decision.answer
  if (decision.status === 'withdrawn') {
    return <Banner tone="info">{t('decision.outcome.withdrawn')}</Banner>
  }
  return (
    <div className={cx('flex flex-col gap-1.5 rounded-lg border border-line px-4 py-3 text-sm', className)}>
      <p className="text-xs text-ink-faint">
        {decision.status === 'user'
          ? t('decision.outcome.user', { name: answer?.byName ?? '?' })
          : decision.status === 'default'
            ? t('decision.outcome.default')
            : t('decision.outcome.expired')}
      </p>
      {answer?.option ? <p className="font-medium text-ink">{answer.option}</p> : null}
      {answer?.text ? <p className="whitespace-pre-wrap text-ink-soft">{answer.text}</p> : null}
    </div>
  )
}
