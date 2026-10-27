import { ArrowRight, ClipboardCheck, FormInput, MessageCircleQuestion, ShieldQuestion } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { AgentQuestion } from '@solera/protocol'
import { Button, cx } from '@solera/ui'
import { HighlightedCode } from '../chat/HighlightedCode'
import { answerQuestion, decidePermission } from '../../lib/conversations'
import { openDecision } from '../../lib/decisions'
import { shortAge } from '../../lib/dates'
import { useTranslate, type MessageKey } from '../../lib/i18n'
import { permissionTarget, permissionTitle, type SessionRequest } from '../../lib/session-requests'

const KIND_LABEL: Record<SessionRequest['kind'], MessageKey> = {
  question: 'projectActivity.preview.question',
  permission: 'projectActivity.preview.permission',
  plan: 'projectActivity.preview.plan',
  elicitation: 'projectActivity.preview.elicitation',
  decision: 'projectActivity.preview.decision',
}

const KIND_ICON: Record<SessionRequest['kind'], ReactNode> = {
  question: <MessageCircleQuestion size={15} aria-hidden />,
  permission: <ShieldQuestion size={15} aria-hidden />,
  plan: <ClipboardCheck size={15} aria-hidden />,
  elicitation: <FormInput size={15} aria-hidden />,
  decision: <MessageCircleQuestion size={15} aria-hidden />,
}

/**
 * Ce qu'une session te demande, déplié sous sa ligne de l'Activité (#112, planche B2) :
 * de quoi trancher sans ouvrir le fil.
 *
 * **Les mêmes chemins que le fil.** Une question part par la route des questions, une
 * permission par celle des permissions, avec les trois mêmes boutons ; une décision
 * ouvre le dialogue de la colonne. Rien n'est anticipé : la demande disparaît quand le
 * journal dit qu'elle est tranchée, comme dans le fil.
 *
 * Une question se répond d'un clic sur un choix — ou de son chiffre au clavier —, ou par
 * le champ libre. Quand l'envoi en porte plusieurs, ou des choix multiples, les choix se
 * cochent et partent ensemble. Un plan et une saisie MCP demandent à lire plus que ce que
 * la liste peut montrer : ils renvoient au fil.
 */
export function SessionRequestPreview({
  conversationPath,
  conversationId,
  request,
  canDecide,
}: {
  conversationPath: string
  conversationId: string
  request: SessionRequest
  canDecide: boolean
}) {
  const t = useTranslate()

  return (
    <div className="border-t border-line bg-sunken/60 px-4 py-3 md:pl-[3.375rem]">
      <div className="flex items-center gap-2 text-sm">
        <span className="shrink-0 text-caution">{KIND_ICON[request.kind]}</span>
        <span className="text-caution">{t(KIND_LABEL[request.kind])}</span>
        <span className="text-ink-faint">
          · {t('projectActivity.preview.since', { age: shortAge(request.requestedAt) })}
        </span>
        <Link
          to={conversationPath}
          className="ml-auto inline-flex shrink-0 items-center gap-1 text-ink-soft hover:text-ink"
        >
          {t('projectActivity.preview.open')}
          <ArrowRight size={14} aria-hidden />
        </Link>
      </div>
      <div className="mt-2">
        <SessionRequestBody conversationId={conversationId} request={request} canDecide={canDecide} />
      </div>
    </div>
  )
}

/**
 * Le corps seul, sans l'en-tête : la modale d'Activité (#121) le reprend sous sa propre
 * ligne, pour trancher une permission ou une question par les mêmes routes.
 */
export function SessionRequestBody({
  conversationId,
  request,
  canDecide,
}: {
  conversationId: string
  request: SessionRequest
  canDecide: boolean
}) {
  const t = useTranslate()
  switch (request.kind) {
    case 'question':
      return <QuestionBody conversationId={conversationId} request={request} canDecide={canDecide} />
    case 'permission':
      return <PermissionBody conversationId={conversationId} request={request} canDecide={canDecide} />
    case 'decision':
      return (
        <div className="flex flex-wrap items-center gap-3">
          <p className="min-w-0 flex-1 text-base text-ink">{request.question}</p>
          {canDecide ? (
            <Button size="sm" onClick={() => openDecision(request.requestId)}>
              {t('decision.thread.answer')}
            </Button>
          ) : null}
        </div>
      )
    case 'plan':
    case 'elicitation':
      return (
        <>
          <p className="text-base text-ink">
            {request.kind === 'plan'
              ? t('projectActivity.request.plan')
              : `${request.event.serverName} : ${request.event.message}`}
          </p>
          <p className="mt-1 text-xs text-ink-faint">{t('projectActivity.preview.inThread')}</p>
        </>
      )
  }
}

function PermissionBody({
  conversationId,
  request,
  canDecide,
}: {
  conversationId: string
  request: Extract<SessionRequest, { kind: 'permission' }>
  canDecide: boolean
}) {
  const t = useTranslate()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const target = permissionTarget(request.event.input)

  const decide = async (decision: 'allowed' | 'denied', scope: 'once' | 'session') => {
    setBusy(true)
    setError(null)
    try {
      await decidePermission(conversationId, request.requestId, decision, scope)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('permission.error.generic'))
      setBusy(false)
    }
  }

  return (
    <>
      <p className="text-base text-ink">{permissionTitle(request.event, t)}</p>
      <div className="mt-2 flex flex-wrap items-end gap-3">
        {target ? (
          <HighlightedCode
            code={target.content}
            language={target.language}
            wrap
            className="max-h-32 min-w-0 flex-1 overflow-auto rounded-md bg-surface px-2.5 py-1.5 font-mono text-sm"
          />
        ) : (
          <span className="flex-1" />
        )}
        {canDecide ? (
          <div className="ml-auto flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => void decide('denied', 'once')}>
              {t('permission.deny')}
            </Button>
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => void decide('allowed', 'session')}>
              {t('permission.allowSession')}
            </Button>
            <Button size="sm" disabled={busy} onClick={() => void decide('allowed', 'once')}>
              {t('permission.allow')}
            </Button>
          </div>
        ) : null}
      </div>
      {canDecide ? null : <p className="mt-2 text-xs text-ink-faint">{t('permission.ownerOnly')}</p>}
      {error ? <p className="mt-2 text-xs text-critical">{error}</p> : null}
    </>
  )
}

function QuestionBody({
  conversationId,
  request,
  canDecide,
}: {
  conversationId: string
  request: Extract<SessionRequest, { kind: 'question' }>
  canDecide: boolean
}) {
  const t = useTranslate()
  const [choices, setChoices] = useState<Record<string, string[]>>({})
  const [other, setOther] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const questions = request.event.questions
  // Une seule question à choix unique : un choix suffit à répondre.
  const direct = questions.length === 1 && !questions[0]!.multiSelect

  const submit = async (answers: Record<string, string[]>) => {
    setBusy(true)
    setError(null)
    try {
      await answerQuestion(conversationId, request.requestId, 'answered', answers)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('question.error.generic'))
      setBusy(false)
    }
  }

  /** Les réponses telles qu'elles partiront : les choix, plus la saisie libre non vide. */
  const collected = () => {
    const answers: Record<string, string[]> = {}
    for (const question of questions) {
      const selected = [...(choices[question.id] ?? [])]
      const free = other[question.id]?.trim()
      if (free) selected.push(free)
      if (selected.length > 0) answers[question.id] = selected
    }
    return answers
  }
  const answers = collected()
  const complete = questions.every((question) => (answers[question.id]?.length ?? 0) > 0)
  // Le chiffre choisit dans la première question encore sans réponse.
  const keyed = questions.find((question) => (answers[question.id]?.length ?? 0) === 0) ?? questions[0]

  const choose = (question: AgentQuestion, label: string) => {
    if (direct) {
      void submit({ [question.id]: [label] })
      return
    }
    setChoices((current) => {
      const selected = current[question.id] ?? []
      const next = question.multiSelect
        ? selected.includes(label)
          ? selected.filter((entry) => entry !== label)
          : [...selected, label]
        : selected.includes(label)
          ? []
          : [label]
      return { ...current, [question.id]: next }
    })
  }

  const send = () => {
    if (direct) {
      const question = questions[0]!
      const free = other[question.id]?.trim()
      if (free) void submit({ [question.id]: [free] })
      return
    }
    if (complete) void submit(answers)
  }

  return (
    <div className="flex flex-col gap-3">
      {questions.map((question) => (
        <div key={question.id} className="min-w-0">
          <p className="text-base text-ink">{question.question}</p>
          {question.options.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-2">
              {question.options.map((option, index) => {
                const selected = (choices[question.id] ?? []).includes(option.label)
                return (
                  // `<button>` nu, comme les options du fil : un choix numéroté que la
                  // touche de son chiffre déclenche, ce qu'aucune primitive ne porte.
                  <button
                    key={option.label}
                    type="button"
                    title={option.description || undefined}
                    data-choice={question === keyed && index < 9 ? index + 1 : undefined}
                    aria-pressed={direct ? undefined : selected}
                    disabled={!canDecide || busy}
                    onClick={() => choose(question, option.label)}
                    className={cx(
                      'inline-flex items-baseline gap-2 rounded-md border px-3 py-1.5 text-left text-sm transition-colors',
                      selected
                        ? 'border-accent bg-accent-wash/60 text-ink'
                        : 'border-line bg-surface text-ink hover:border-line-strong',
                      'disabled:cursor-default disabled:opacity-60',
                    )}
                  >
                    {index < 9 ? (
                      <span className="font-mono text-xs text-ink-faint tabular-nums">{index + 1}</span>
                    ) : null}
                    {option.label}
                  </button>
                )
              })}
            </div>
          ) : null}
          {question.allowOther && canDecide ? (
            <label className="mt-2 flex items-center gap-3 rounded-md border border-line bg-surface px-3 focus-within:border-accent">
              <input
                type={question.secret ? 'password' : 'text'}
                value={other[question.id] ?? ''}
                aria-label={question.question}
                disabled={busy}
                placeholder={t('projectActivity.preview.reply')}
                onChange={(event) => setOther((current) => ({ ...current, [question.id]: event.target.value }))}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
                  event.preventDefault()
                  send()
                }}
                className="h-9 min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-faint"
              />
              <span className="hidden shrink-0 text-xs text-ink-faint sm:inline">{t('projectActivity.preview.enter')}</span>
            </label>
          ) : null}
        </div>
      ))}
      {!direct && canDecide ? (
        <div>
          <Button size="sm" disabled={busy || !complete} onClick={send}>
            {t('question.submit')}
          </Button>
        </div>
      ) : null}
      {canDecide ? null : <p className="text-xs text-ink-faint">{t('question.ownerOnly')}</p>}
      {error ? <p className="text-xs text-critical">{error}</p> : null}
    </div>
  )
}
