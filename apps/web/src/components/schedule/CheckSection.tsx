import * as Dialog from '@radix-ui/react-dialog'
import { FlaskConical, Plus, ShieldCheck, Trash2, X } from 'lucide-react'
import {
  CHECK_SKIP_EXIT_CODE,
  MAX_CHECK_TIMEOUT_SECONDS,
  MIN_CHECK_TIMEOUT_SECONDS,
  type ScheduleCheckResultDto,
  type ScheduleCheckVerdict,
  type ScheduledTaskDto,
} from '@solera/protocol'
import { Badge, Banner, Button, Field, IconButton } from '@solera/ui'
import { ScriptEditor } from './ScriptEditor'
import { useTranslate, type MessageKey } from '../../lib/i18n'
import { useApproveScheduleCheck, useTestScheduleCheck } from '../../lib/schedules'

/**
 * La vérification avant le tour, dans le formulaire d'une tâche : le script, son délai,
 * et un essai qui le joue sur le serveur sans rien lancer.
 *
 * L'essai porte sur le texte du formulaire, pas sur celui enregistré : c'est avant de
 * sauver qu'on veut savoir si le script dit ce qu'on croit.
 */
export function CheckSection({
  projectId,
  taskId,
  script,
  timeout,
  onScriptChange,
  onTimeoutChange,
}: {
  projectId: string
  /** La tâche modifiée, pour essayer sur une copie de son état ; absente à la création. */
  taskId?: string
  /** Null : pas de vérification. */
  script: string | null
  timeout: string
  onScriptChange: (script: string | null) => void
  onTimeoutChange: (timeout: string) => void
}) {
  const t = useTranslate()
  const test = useTestScheduleCheck(projectId)
  const seconds = Number(timeout)
  const timeoutValid =
    Number.isInteger(seconds) && seconds >= MIN_CHECK_TIMEOUT_SECONDS && seconds <= MAX_CHECK_TIMEOUT_SECONDS

  return (
    <fieldset className="flex flex-col gap-2" data-check-section>
      <legend className="mb-1.5 flex w-full items-center justify-between gap-2 text-sm font-medium text-ink-soft">
        <span>{t('schedule.check.title')}</span>
        {script === null ? (
          <Button type="button" size="sm" variant="ghost" icon={<Plus size={14} />} onClick={() => onScriptChange(t('schedule.check.starter'))}>
            {t('schedule.check.add')}
          </Button>
        ) : (
          <Button type="button" size="sm" variant="ghost" icon={<Trash2 size={14} />} onClick={() => { onScriptChange(null); test.reset() }}>
            {t('schedule.check.remove')}
          </Button>
        )}
      </legend>
      <p className="text-xs text-ink-faint">{t('schedule.check.description', { skip: CHECK_SKIP_EXIT_CODE })}</p>

      {script === null ? null : (
        <>
          <ScriptEditor value={script} onChange={onScriptChange} label={t('schedule.check.title')} maxHeight="18rem" />
          <p className="text-xs text-ink-faint">{t('schedule.check.contract', { skip: CHECK_SKIP_EXIT_CODE })}</p>
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-40">
              <Field
                label={t('schedule.check.timeout')}
                type="number"
                min={MIN_CHECK_TIMEOUT_SECONDS}
                max={MAX_CHECK_TIMEOUT_SECONDS}
                value={timeout}
                error={timeoutValid ? undefined : t('schedule.check.timeoutInvalid', { min: MIN_CHECK_TIMEOUT_SECONDS, max: MAX_CHECK_TIMEOUT_SECONDS })}
                onChange={(event) => onTimeoutChange(event.target.value)}
              />
            </div>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              icon={<FlaskConical size={14} />}
              disabled={!script.trim() || !timeoutValid || test.isPending}
              onClick={() => test.mutate({ script, timeoutSeconds: seconds, taskId })}
            >
              {t(test.isPending ? 'schedule.check.testing' : 'schedule.check.test')}
            </Button>
          </div>
          <p className="text-xs text-ink-faint">{t('schedule.check.testHint')}</p>
          {test.isError ? <Banner>{test.error.message}</Banner> : null}
          {test.data ? <CheckResult result={test.data} /> : null}
        </>
      )}
    </fieldset>
  )
}

const VERDICT_LABELS: Record<ScheduleCheckVerdict, MessageKey> = {
  launch: 'schedule.check.verdict.launch',
  skip: 'schedule.check.verdict.skip',
  error: 'schedule.check.verdict.error',
}

const VERDICT_TONES: Record<ScheduleCheckVerdict, 'positive' | 'neutral' | 'critical'> = {
  launch: 'positive',
  skip: 'neutral',
  error: 'critical',
}

/** Ce qu'un essai a donné : le verdict, puis les deux sorties, telles quelles. */
export function CheckResult({ result }: { result: ScheduleCheckResultDto }) {
  const t = useTranslate()
  return (
    <div className="flex flex-col gap-2 rounded-md border border-line p-3" data-check-result={result.verdict}>
      <div className="flex flex-wrap items-center gap-2 text-xs text-ink-faint">
        <Badge tone={VERDICT_TONES[result.verdict]}>{t(VERDICT_LABELS[result.verdict])}</Badge>
        <span>
          {result.timedOut
            ? t('schedule.check.timedOut')
            : t('schedule.check.exitCode', { code: result.exitCode ?? '—' })}
        </span>
        <span>· {t('schedule.check.duration', { seconds: (result.durationMs / 1000).toFixed(1) })}</span>
      </div>
      <Output label={t('schedule.check.stdout')} text={result.stdout} empty={t('schedule.check.emptyOutput')} />
      {result.stderr.trim() ? <Output label={t('schedule.check.stderr')} text={result.stderr} /> : null}
    </div>
  )
}

function Output({ label, text, empty }: { label: string; text: string; empty?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-ink-soft">{label}</span>
      <pre className="max-h-48 overflow-auto rounded bg-sunken px-2.5 py-2 font-mono text-code whitespace-pre-wrap text-ink-soft">
        {text.trim() ? text : <span className="text-ink-faint">{empty}</span>}
      </pre>
    </div>
  )
}

/** Le script proposé par un agent, à relire et essayer avant de le valider. */
export function CheckReview({
  projectId,
  taskId,
  script,
  timeoutSeconds,
}: {
  /** Null pour une tâche sans projet : l'essai joue à la racine d'un projet, il n'y en a pas. */
  projectId: string | null
  taskId: string
  script: string
  timeoutSeconds: number
}) {
  const t = useTranslate()
  const test = useTestScheduleCheck(projectId ?? '')
  return (
    <div className="flex flex-col gap-2">
      <pre className="max-h-64 overflow-auto rounded bg-sunken px-2.5 py-2 font-mono text-code whitespace-pre-wrap text-ink">{script}</pre>
      {projectId ? <div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          icon={<FlaskConical size={14} />}
          disabled={test.isPending}
          onClick={() => test.mutate({ script, timeoutSeconds, taskId })}
        >
          {t(test.isPending ? 'schedule.check.testing' : 'schedule.check.test')}
        </Button>
      </div> : null}
      {test.isError ? <Banner>{test.error.message}</Banner> : null}
      {test.data ? <CheckResult result={test.data} /> : null}
      <p className="flex items-start gap-1.5 text-xs text-ink-faint">
        <ShieldCheck size={13} className="mt-0.5 shrink-0" />
        {t('schedule.check.reviewHint')}
      </p>
    </div>
  )
}

/**
 * La validation d'un script proposé par un agent : le texte, un essai, et le bouton qui
 * valide exactement ce texte-là. Ouverte depuis la carte de la tâche ou depuis l'appel
 * `schedule_task` dans la conversation.
 *
 * La coque d'un dialogue qui montre du contenu et non `ConfirmDialog` : un script et sa
 * sortie ne se relisent pas dans 26 rem.
 */
export function CheckApprovalDialog({
  task,
  open,
  onOpenChange,
}: {
  task: ScheduledTaskDto
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const t = useTranslate()
  const approve = useApproveScheduleCheck()
  const check = task.check
  if (!check) return null
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="scrim z-40" />
        <Dialog.Content
          aria-describedby={undefined}
          data-check-approval-dialog
          className="surface fixed inset-x-0 bottom-0 z-50 flex max-h-[90dvh] flex-col rounded-t-xl border border-line shadow-pop sm:inset-x-auto sm:top-1/2 sm:bottom-auto sm:left-1/2 sm:w-[min(960px,calc(100vw-2rem))] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl"
        >
          <header className="flex items-center justify-between border-b border-line px-5 py-4">
            <Dialog.Title className="text-heading font-semibold">
              {t('schedule.check.reviewTitle', { name: task.name })}
            </Dialog.Title>
            <IconButton label={t('common.close')} onClick={() => onOpenChange(false)}>
              <X size={16} />
            </IconButton>
          </header>
          <div className="flex min-h-0 flex-col gap-3 overflow-y-auto p-5 sm:p-6">
            <CheckReview projectId={task.projectId} taskId={task.id} script={check.script} timeoutSeconds={check.timeoutSeconds} />
            {approve.isError ? <Banner>{approve.error.message}</Banner> : null}
          </div>
          <footer className="flex justify-end gap-2 border-t border-line px-5 py-4">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              type="button"
              disabled={approve.isPending}
              onClick={() => approve.mutate({ id: task.id, script: check.script }, { onSuccess: () => onOpenChange(false) })}
            >
              {t('schedule.check.approve')}
            </Button>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
