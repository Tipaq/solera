import { ArrowUpRight, ChevronDown, GitMerge, GitPullRequest, GitPullRequestClosed, Pause, Play, Plus, Square } from 'lucide-react'
import { useState, type FormEvent, type ReactNode } from 'react'
import { MAX_MILESTONE_CONCURRENCY, type MilestoneRunDto, type MilestoneRunMode } from '@solera/protocol'
import { Button, ConfirmDialog, Field, Menu, MenuRadioGroup, MenuRadioItem, SegmentedControl, Tooltip, cx } from '@solera/ui'
import { CardInfoButton } from '../cards/CardInfoButton'
import { MilestoneCardLink } from './MilestoneCardLink'
import { loadedStatus, type StatusOf } from '../../lib/card-state'
import { useCreateCard } from '../../lib/cards'
import { elapsed } from '../../lib/dates'
import { useTranslate, type MessageKey, type MessageParams } from '../../lib/i18n'
import type { MilestoneEntry } from '../../lib/milestone-model'
import {
  canConfine,
  prStage,
  runConfined,
  runMergeLabel,
  runRowsOf,
  runTitle,
  type RunCardStatus,
  type RunRow,
} from '../../lib/milestone-run'
import { useLaunchMilestoneCard, useUpdateMilestone } from '../../lib/milestones'
import { useProjectEnvironments } from '../../lib/projects'
import type { useMergeBranchPullRequest } from '../../lib/pull-requests'

/**
 * Le **suivi d'un jalon lancé** (#198, spec jalons RUN-1..12) : où en est chaque carte,
 * la bascule à la main ↔ autonome, les places, le confinement des prochaines sessions,
 * une carte à ajouter, la pause et l'arrêt ; puis la PR finale, à fusionner d'ici.
 *
 * Le pilotage est celui que la page a déjà lu (`entry.run`, relu toutes les trois
 * secondes) ; la fusion est celle de la page, que son bouton de prochaine action partage.
 */
export function RunPanel({
  projectId,
  entry,
  merge,
  statusOf = loadedStatus,
}: {
  projectId: string
  entry: MilestoneEntry
  merge: ReturnType<typeof useMergeBranchPullRequest>
  statusOf?: StatusOf
}) {
  return (
    <div className="flex flex-col gap-4">
      {/* Les deux ne vont ensemble que si une carte entre au jalon après l'ouverture de sa PR. */}
      {entry.pr ? <FinalPr entry={entry} merge={merge} /> : null}
      {entry.run ? <Run projectId={projectId} entry={entry} run={entry.run} statusOf={statusOf} /> : null}
    </div>
  )
}

/* ------------------------------------------------------------------ PR finale */

/** La PR du jalon (RUN-9, RUN-12) : fusionner dans la branche par défaut, ou la rouvrir. */
function FinalPr({ entry, merge }: { entry: MilestoneEntry; merge: ReturnType<typeof useMergeBranchPullRequest> }) {
  const t = useTranslate()
  const pr = entry.pr!
  const branch = entry.card.branch ?? ''
  const closed = prStage(entry) === 'closed'
  const base = pr.base ?? t('milestone.run.defaultBase')
  return (
    <aside
      aria-label={t(closed ? 'milestone.run.prClosed' : 'milestone.run.prOpen')}
      className={cx(
        'flex flex-col gap-3 rounded-xl border p-4',
        closed ? 'border-caution/50 bg-caution/5' : 'border-positive/50 bg-positive/5',
      )}
    >
      <div className="flex items-center gap-2">
        <h3 className="flex min-w-0 items-center gap-2 text-sm font-semibold text-ink">
          {closed ? (
            <GitPullRequestClosed size={15} aria-hidden className="shrink-0 text-caution" />
          ) : (
            <GitPullRequest size={15} aria-hidden className="shrink-0 text-positive" />
          )}
          {t(closed ? 'milestone.run.prClosed' : 'milestone.run.prOpen')}
        </h3>
        {/* Relire avant de fusionner (spec §2.6-4) : la PR sur la forge. */}
        <a
          href={pr.url}
          target="_blank"
          rel="noreferrer"
          className={cx(
            'ml-auto inline-flex shrink-0 items-center gap-0.5 rounded text-xs text-ink-soft hover:text-accent',
            'focus-visible:outline-2 focus-visible:outline-accent pointer-coarse:min-h-11',
          )}
        >
          {t('milestone.run.openPr')}
          <ArrowUpRight size={13} aria-hidden />
        </a>
      </div>
      <p className="text-sm text-ink-soft">
        {closed
          ? withCode(t, 'milestone.run.prClosedText', { number: pr.number, branch }, ['branch'])
          : withCode(t, 'milestone.run.prText', { number: pr.number, branch, base }, pr.base ? ['branch', 'base'] : ['branch'])}
      </p>
      {closed ? null : (
        <Button icon={<GitMerge size={14} />} disabled={merge.isPending} onClick={() => merge.mutate()}>
          {runMergeLabel(pr, t)}
        </Button>
      )}
      {merge.isError ? (
        <p role="alert" className="text-sm text-critical">
          {t('milestone.run.mergeFailed', { error: merge.error.message })}
        </p>
      ) : null}
    </aside>
  )
}

/* ------------------------------------------------------------------ le pilotage */

/** La pastille d'une carte (RUN-5) : au travail pulse, ce qui t'attend est ambre. */
const STATUS_DOT: Record<RunCardStatus, string> = {
  waiting: 'bg-surface-high',
  queued: 'bg-ink-faint/50',
  working: 'bg-accent animate-pulse',
  review: 'bg-positive/50',
  merged: 'bg-positive',
  blocked: 'bg-caution',
  abandoned: 'bg-line-strong',
  failed: 'bg-critical',
}

function Run({
  projectId,
  entry,
  run,
  statusOf,
}: {
  projectId: string
  entry: MilestoneEntry
  run: MilestoneRunDto
  statusOf: StatusOf
}) {
  const t = useTranslate()
  const { data: environments } = useProjectEnvironments(projectId)
  const update = useUpdateMilestone(entry.card.id)
  const launchCard = useLaunchMilestoneCard(projectId, entry.card.id)
  const create = useCreateCard(projectId)
  const [title, setTitle] = useState('')
  const [stopping, setStopping] = useState(false)

  const rows = runRowsOf(entry, run, statusOf)
  const heading = runTitle(run)
  const confined = runConfined(run, environments)
  const confinable = environments ? canConfine(environments) || confined === true : false
  const error = update.error ?? launchCard.error ?? create.error

  const add = (event: FormEvent) => {
    event.preventDefault()
    const name = title.trim()
    if (!name) return
    // Elle entre dans la file au prochain tour du pilotage (RUN-11).
    create.mutate({ title: name, parentId: entry.card.id }, { onSuccess: () => setTitle('') })
  }

  return (
    <section
      aria-label={t('milestone.run.aria')}
      className="flex flex-col gap-3.5 rounded-xl border border-accent/50 bg-accent-wash/20 p-4"
    >
      <div className="flex items-center gap-2">
        <span aria-hidden className={cx('size-2 shrink-0 rounded-full', heading === 'paused' ? 'bg-caution' : 'animate-pulse bg-accent')} />
        <h3 className="text-sm font-semibold text-ink">{t(`milestone.run.title.${heading}`)}</h3>
        <span className="ml-auto text-xs text-ink-faint">{t('milestone.run.since', { duration: elapsed(run.createdAt) })}</span>
      </div>

      <SegmentedControl<MilestoneRunMode>
        label={t('milestone.run.modeAria')}
        value={run.mode}
        onChange={(mode) => update.mutate({ mode })}
        className="self-start"
        segments={[
          { value: 'manual', label: t('milestone.run.manual') },
          { value: 'auto', label: t('milestone.run.auto') },
        ]}
      />

      <p className="flex flex-wrap items-center gap-x-1 text-xs text-ink-soft">
        {run.mode === 'auto' ? (
          <Places run={run} disabled={update.isPending} onChange={(concurrency) => update.mutate({ concurrency })} />
        ) : (
          <span>{t('milestone.run.manualLine')}</span>
        )}
        <span aria-hidden>·</span>
        <span className="min-w-0 break-all">{withCode(t, 'milestone.run.branch', { branch: run.branch }, ['branch'])}</span>
      </p>

      {confinable ? (
        <label className="flex cursor-pointer items-start gap-2 text-xs text-ink-soft pointer-coarse:min-h-11 pointer-coarse:items-center">
          <input
            type="checkbox"
            className="mt-px size-4 shrink-0 accent-[var(--color-accent)] pointer-coarse:mt-0"
            checked={confined === true}
            disabled={confined === null || update.isPending}
            onChange={(event) => update.mutate({ confined: event.target.checked })}
          />
          {t('milestone.run.confined')}
        </label>
      ) : null}

      <ul aria-label={t('milestone.run.cards')} className="flex flex-col divide-y divide-line overflow-hidden rounded-lg border border-line bg-canvas">
        {rows.map((row) => (
          <li
            key={row.card.id}
            className={cx('flex min-w-0 items-center gap-2 px-2.5 py-1.5 text-sm', row.status === 'blocked' && 'bg-caution/10')}
          >
            <span aria-hidden className={cx('size-2 shrink-0 rounded-full', STATUS_DOT[row.status])} />
            <div className="flex min-w-0 flex-1 flex-col">
              <MilestoneCardLink projectId={projectId} card={row.card} statusOf={statusOf} />
              {/* Au doigt, pas d'infobulle : la raison s'écrit sous la carte. */}
              {why(row, t) ? <span className="hidden text-xs text-ink-faint pointer-coarse:block">{why(row, t)}</span> : null}
            </div>
            <CardInfoButton card={row.card} />
            {row.launch ? (
              <Button
                size="sm"
                variant="ghost"
                icon={<Play size={12} />}
                aria-label={t('milestone.launch.launchCardAria', { number: row.card.number })}
                disabled={launchCard.isPending}
                // Le pilotage vivant garde son confinement : le corps ne le change pas.
                onClick={() => launchCard.mutate({ childId: row.card.id, confined: null })}
              >
                {t('milestone.launch.launchCard')}
              </Button>
            ) : (
              <StatusLabel row={row} />
            )}
          </li>
        ))}
      </ul>

      <form className="flex flex-col gap-1" onSubmit={add}>
        <div className="flex items-end gap-1.5">
          <div className="min-w-0 flex-1">
            <Field
              label={t('milestone.run.addPlaceholder')}
              hideLabel
              placeholder={t('milestone.run.addPlaceholder')}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>
          <Button size="sm" variant="secondary" type="submit" icon={<Plus size={13} />} disabled={!title.trim() || create.isPending}>
            {t('milestone.run.add')}
          </Button>
        </div>
        {entry.addedSinceLaunch.length ? (
          <span className="text-xs text-caution">{t('milestone.page.sinceLaunch', { count: entry.addedSinceLaunch.length })}</span>
        ) : null}
      </form>

      <div className="flex flex-wrap gap-1.5">
        {run.state === 'paused' ? (
          <Button size="sm" variant="secondary" icon={<Play size={14} />} disabled={update.isPending} onClick={() => update.mutate({ state: 'running' })}>
            {t('milestone.run.resume')}
          </Button>
        ) : (
          <Button size="sm" variant="secondary" icon={<Pause size={14} />} disabled={update.isPending} onClick={() => update.mutate({ state: 'paused' })}>
            {t('milestone.run.pause')}
          </Button>
        )}
        <Button size="sm" variant="ghost" icon={<Square size={14} />} disabled={update.isPending} onClick={() => setStopping(true)}>
          {t('milestone.run.stop')}
        </Button>
      </div>

      {error ? (
        <p role="alert" className="text-sm text-critical">
          {t('milestone.run.failed', { error: error.message })}
        </p>
      ) : null}
      <p className="text-xs text-ink-faint">{t('milestone.run.footnote')}</p>

      <ConfirmDialog
        open={stopping}
        onOpenChange={setStopping}
        title={t('milestone.run.stopTitle')}
        confirmLabel={t('milestone.run.stop')}
        tone="critical"
        busy={update.isPending}
        onConfirm={() => update.mutate({ state: 'stopped' }, { onSettled: () => setStopping(false) })}
      >
        <p>{t('milestone.run.stopText')}</p>
      </ConfirmDialog>
    </section>
  )
}

/** « 2/3 places occupées », qui ouvre le choix des places (spec §2.9 : la concurrence en cours). */
function Places({ run, disabled, onChange }: { run: MilestoneRunDto; disabled: boolean; onChange: (value: number) => void }) {
  const t = useTranslate()
  return (
    <Menu
      align="start"
      trigger={
        <button
          type="button"
          disabled={disabled}
          aria-label={`${t('milestone.run.places', { busy: run.busy, count: run.concurrency })} — ${t('milestone.run.placesAria')}`}
          className={cx(
            '-mx-1 inline-flex items-center gap-0.5 rounded px-1 tabular-nums hover:bg-surface-high hover:text-ink',
            'focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-45 pointer-coarse:min-h-11',
          )}
        >
          {t('milestone.run.places', { busy: run.busy, count: run.concurrency })}
          <ChevronDown size={12} aria-hidden />
        </button>
      }
    >
      <MenuRadioGroup value={String(run.concurrency)} onValueChange={(value) => onChange(Number(value))}>
        {Array.from({ length: MAX_MILESTONE_CONCURRENCY }, (_, index) => String(index + 1)).map((value) => (
          <MenuRadioItem key={value} value={value}>
            {value}
          </MenuRadioItem>
        ))}
      </MenuRadioGroup>
    </Menu>
  )
}

/** Pourquoi une carte t'attend, ou pourquoi son lancement a échoué. */
function why(row: RunRow, t: (key: MessageKey, params?: MessageParams) => string): string | null {
  if (row.status === 'blocked' && row.blockReason) return t(`milestone.block.${row.blockReason}`)
  return row.status === 'failed' ? row.error : null
}

/** Le statut d'une carte ; ce qui t'attend, et pourquoi, en infobulle (spec §2.9). */
function StatusLabel({ row }: { row: RunRow }) {
  const t = useTranslate()
  const label = t(`milestone.run.status.${row.status}`)
  const reason = why(row, t)
  const text = (
    <span
      tabIndex={reason ? 0 : undefined}
      className={cx(
        'shrink-0 text-xs',
        row.status === 'blocked' ? 'font-medium text-caution' : row.status === 'failed' ? 'text-critical' : 'text-ink-faint',
      )}
    >
      {label}
    </span>
  )
  return reason ? <Tooltip label={reason}>{text}</Tooltip> : text
}

/**
 * Une phrase traduite dont certaines valeurs se lisent en code (une branche) : la
 * traduction les place, le composant les habille. Des marques invisibles tiennent leur
 * place le temps de couper la phrase.
 */
function withCode(
  t: (key: MessageKey, params?: MessageParams) => string,
  key: MessageKey,
  params: MessageParams,
  coded: readonly string[],
): ReactNode[] {
  const marks = Object.fromEntries(coded.map((name, index) => [name, `\u0000${index}\u0000`]))
  return t(key, { ...params, ...marks })
    .split('\u0000')
    .map((part, index) =>
      index % 2 ? (
        <code key={index} className="text-xs">
          {params[coded[Number(part)]!]}
        </code>
      ) : (
        part
      ),
    )
}
