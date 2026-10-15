import { useEffect, useMemo, useState } from 'react'
import {
  Bot,
  Check,
  FileCode2,
  GitCommitHorizontal,
  Loader,
  Minus,
  MoreHorizontal,
  Plus,
  RefreshCw,
} from 'lucide-react'
import type { DiffFileDto, GitStateDto } from '@solera/protocol'
import { parseUnifiedDiff } from '../../../lib/diff'
import { useTranslate } from '../../../lib/i18n'
import type { WorkspaceScope } from '../../../lib/workspace-scope'
import { Banner, Menu, MenuItem, MenuSeparator, cx } from '@solera/ui'
import { DiffHunks } from '../../DiffHunks'
import { useGitActions } from './actions'
import { useGitState } from './queries'

/**
 * La destination *En cours* : ce qui n'est pas commité, et ce qu'on en fait.
 *
 * Le panneau de commit de GitKraken devenu destination (planche T2) : non indexés,
 * indexés, un résumé et une description séparés, *Amender*, et le **co-auteur**, qui
 * chez nous désigne l'agent du fil — chose que GitKraken n'a pas à gérer, et qui est
 * ce qui fait que la colonne *Auteur* du graphe saura dire « Claude ».
 *
 * Deux décisions de la carte #10 vivent ici, et ne sont pas des détails :
 *
 * - **pendant qu'un tour tourne, les gestes s'éteignent** et un bandeau dit *pourquoi*
 *   et *quoi attendre*, pas « indisponible » (`tour-1/clair/04`). La lecture, elle,
 *   continue ;
 * - **un tour qui finit propose la relecture, il ne l'impose pas** (`tour-1/clair/05`).
 *   Une liste qui se vide sous le curseur pendant qu'on coche des fichiers est pire
 *   que périmée. Et le message déjà écrit survit à la relecture : c'est le seul état
 *   que l'utilisateur a produit.
 *
 * L'indexation par bloc et par ligne est le lot 3 : ici on coche des fichiers entiers.
 */
export function WorkingView({
  scope,
  pendingReview,
  onReviewed,
  onOpenFile,
}: {
  scope: WorkspaceScope
  /** Un tour vient de finir : la vue est peut-être périmée, et le dit. */
  pendingReview: boolean
  onReviewed: () => void
  onOpenFile: (path: string) => void
}) {
  const t = useTranslate()
  const { run, lock, pending } = useGitActions()
  const { data: live, error, isPending } = useGitState(scope)

  /**
   * Ce qui est à l'écran pendant qu'on relit.
   *
   * Un tour qui finit a pu commiter, donc `live` n'est plus ce qu'on regardait. La
   * liste **ne change pas sous le curseur** : on garde celle d'avant, le bandeau dit
   * ce qui a bougé, et c'est le clic sur *Relire* qui rend la main aux données
   * fraîches (planche `tour-1/clair/05`).
   */
  const [held, setHeld] = useState<GitStateDto | null>(null)
  useEffect(() => {
    if (pendingReview) setHeld((current) => current ?? live ?? null)
    else setHeld(null)
    // `live` n'est pas une dépendance : on veut l'état du moment où le tour s'est
    // terminé, pas celui d'après.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingReview])
  const data = held ?? live

  const [summary, setSummary] = useState('')
  const [description, setDescription] = useState('')
  const [amend, setAmend] = useState(false)
  const [withCoAuthor, setWithCoAuthor] = useState(true)
  const [opened, setOpened] = useState<string | null>(null)

  const frozen = !!lock || pending
  const staged = data?.staged ?? []
  const unstaged = data?.unstaged ?? []

  const diffs = useMemo(
    () => ({
      staged: parseUnifiedDiff(data?.stagedPatch ?? ''),
      unstaged: parseUnifiedDiff(data?.unstagedPatch ?? ''),
    }),
    [data?.stagedPatch, data?.unstagedPatch],
  )

  const commit = (push: boolean): void => {
    run({
      kind: 'commit',
      summary: summary.trim(),
      description: description.trim(),
      amend,
      coAuthor: withCoAuthor ? data?.coAuthor ?? null : null,
      push,
    })
    // Le message est vidé parce qu'il est parti dans le commit — c'est le seul endroit
    // où on le vide, et surtout pas à la relecture d'un tour d'agent.
    setSummary('')
    setDescription('')
    setAmend(false)
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col pb-safe">
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {pendingReview && held ? (
          <Review held={held} live={live} onReread={onReviewed} />
        ) : null}

        {isPending ? (
          <p className="flex items-center gap-1.5 px-2.5 py-2 text-xs text-ink-faint">
            <Loader size={11} className="animate-spin" />
            {t('changes.diff.loading')}
          </p>
        ) : null}

        {error ? (
          <div className="p-2">
            <Banner>{error instanceof Error ? error.message : t('changes.diff.error')}</Banner>
          </div>
        ) : null}

        {data && data.branch === null && data.head === null ? (
          <p className="px-2.5 py-2 text-xs text-ink-faint">{t('changes.diff.notGitRepo')}</p>
        ) : null}

        <Section
          title={t('git.working.unstaged', { count: unstaged.length })}
          action={t('git.working.stageAll')}
          onAction={
            unstaged.length > 0
              ? () => run({ kind: 'stage', paths: unstaged.map((file) => file.path) })
              : undefined
          }
          files={unstaged}
          staged={false}
          frozen={frozen}
          opened={opened}
          onOpen={(path) => setOpened(opened === path ? null : path)}
          onOpenFile={onOpenFile}
          diffs={diffs.unstaged}
        />

        <Section
          title={t('git.working.staged', { count: staged.length })}
          action={t('git.working.unstageAll')}
          onAction={
            staged.length > 0
              ? () => run({ kind: 'unstage', paths: staged.map((file) => file.path) })
              : undefined
          }
          files={staged}
          staged
          frozen={frozen}
          opened={opened}
          onOpen={(path) => setOpened(opened === path ? null : path)}
          onOpenFile={onOpenFile}
          diffs={diffs.staged}
        />

        {data && staged.length === 0 && unstaged.length === 0 ? (
          <p className="px-2.5 py-3 text-xs text-ink-faint">{t('changes.diff.none')}</p>
        ) : null}

        {data?.truncated ? (
          <p className="px-2.5 py-2 text-meta text-caution">{t('changes.diff.truncated')}</p>
        ) : null}
      </div>

      {/* Le message et le commit restent au bas de la vue, hors du défilement : on
          écrit un message en regardant la liste, pas après l'avoir quittée. */}
      <div className="shrink-0 border-t border-line p-2">
        <div className="overflow-hidden rounded-md border border-line focus-within:border-accent">
          <input
            value={summary}
            onChange={(event) => setSummary(event.target.value)}
            disabled={frozen}
            placeholder={t('git.commit.summaryPlaceholder')}
            aria-label={t('git.commit.summary')}
            className="w-full bg-transparent px-2.5 py-2 text-sm text-ink outline-none placeholder:text-ink-faint disabled:opacity-50"
          />
          {/* Résumé et description séparés, comme git les sépare : la première ligne
              est ce que le graphe affiche, le reste est ce qu'on lit après. */}
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            disabled={frozen}
            rows={2}
            placeholder={t('git.commit.descriptionPlaceholder')}
            aria-label={t('git.commit.description')}
            className="w-full resize-none border-t border-line/60 bg-transparent px-2.5 py-1.5 text-meta text-ink-soft outline-none placeholder:text-ink-faint disabled:opacity-50"
          />
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={frozen || summary.trim().length === 0 || (staged.length === 0 && !amend)}
            onClick={() => commit(false)}
            className={cx(
              'flex items-center gap-1.5 rounded-md bg-accent px-2.5 py-1.5 text-xs font-medium text-on-accent',
              'disabled:opacity-45',
            )}
          >
            <GitCommitHorizontal size={14} />
            {t(staged.length === 1 ? 'git.commit.doOne' : 'git.commit.do', { count: staged.length })}
          </button>

          <button
            type="button"
            disabled={frozen || summary.trim().length === 0 || (staged.length === 0 && !amend)}
            onClick={() => commit(true)}
            className="rounded-md border border-line px-2.5 py-1.5 text-xs font-medium text-ink-soft hover:bg-surface-high disabled:opacity-45"
          >
            {t('git.commit.andPush')}
          </button>

          <span className="flex-1" />

          <Toggle
            on={amend}
            disabled={frozen || data?.head === null}
            onClick={() => {
              const next = !amend
              setAmend(next)
              // Amender part du message qu'on amende : le retaper serait absurde, et
              // c'est là que les messages se perdent.
              if (next && summary.trim().length === 0 && data?.head) setSummary(data.head.subject)
            }}
            label={t('git.commit.amend')}
          />

          {data?.coAuthor ? (
            <Toggle
              on={withCoAuthor}
              disabled={frozen}
              onClick={() => setWithCoAuthor(!withCoAuthor)}
              label={t('git.commit.coAuthor')}
              title={data.coAuthor}
              icon={<Bot size={12} />}
            />
          ) : null}
        </div>
      </div>
    </div>
  )
}

function Toggle({
  on,
  disabled,
  onClick,
  label,
  title,
  icon,
}: {
  on: boolean
  disabled: boolean
  onClick: () => void
  label: string
  title?: string
  icon?: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={on}
      title={title ?? label}
      className={cx(
        'flex items-center gap-1.5 rounded-md px-1.5 py-1 text-micro font-medium disabled:opacity-45',
        on ? 'bg-accent-wash text-accent' : 'text-ink-faint hover:bg-surface-high',
      )}
    >
      <span
        className={cx(
          'flex size-3.5 items-center justify-center rounded-full border',
          on ? 'border-accent bg-accent text-on-accent' : 'border-line',
        )}
      >
        {on ? <Check size={9} /> : null}
      </span>
      {icon}
      {label}
    </button>
  )
}

function Section({
  title,
  action,
  onAction,
  files,
  staged,
  frozen,
  opened,
  onOpen,
  onOpenFile,
  diffs,
}: {
  title: string
  action: string
  onAction?: () => void
  files: DiffFileDto[]
  staged: boolean
  frozen: boolean
  opened: string | null
  onOpen: (path: string) => void
  onOpenFile: (path: string) => void
  diffs: ReturnType<typeof parseUnifiedDiff>
}) {
  const t = useTranslate()
  const { run } = useGitActions()
  if (files.length === 0) return null

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-2 px-2.5 pt-2 pb-1">
        <span className="text-micro font-semibold tracking-wide text-ink-soft uppercase">{title}</span>
        <span className="h-px flex-1 bg-line" />
        {onAction ? (
          <button
            type="button"
            onClick={onAction}
            disabled={frozen}
            className="text-micro text-ink-faint hover:text-ink disabled:opacity-45"
          >
            {action}
          </button>
        ) : null}
      </div>

      {files.map((file) => {
        const name = file.path.slice(file.path.lastIndexOf('/') + 1)
        const folder = file.path.slice(0, file.path.lastIndexOf('/') + 1)
        const diff = diffs.find((entry) => entry.path === file.path || entry.path.endsWith(file.path))

        return (
          <div key={file.path} className="flex flex-col">
            <div className="group flex items-center gap-1.5 px-2.5 py-1 hover:bg-surface-high">
              <button
                type="button"
                disabled={frozen}
                aria-label={staged ? t('git.working.unstageOne', { path: file.path }) : t('git.working.stageOne', { path: file.path })}
                onClick={() =>
                  run({ kind: staged ? 'unstage' : 'stage', paths: [file.path] })
                }
                className={cx(
                  'flex size-4 shrink-0 items-center justify-center rounded border disabled:opacity-45',
                  staged ? 'border-accent bg-accent text-on-accent' : 'border-line text-ink-faint hover:border-accent',
                )}
              >
                {staged ? <Check size={10} /> : <Plus size={10} />}
              </button>

              <FileCode2 size={12} className="shrink-0 text-ink-faint" />

              <button
                type="button"
                onClick={() => onOpen(file.path)}
                className="flex min-w-0 flex-1 items-baseline gap-1.5 text-left"
                title={file.path}
              >
                <span className="truncate text-xs text-ink">{name}</span>
                <span className="hidden truncate text-micro text-ink-faint @min-[28rem]:inline">
                  {folder}
                </span>
              </button>

              {file.added > 0 ? (
                <span className="shrink-0 font-mono text-micro text-positive tabular-nums">+{file.added}</span>
              ) : null}
              {file.removed > 0 ? (
                <span className="shrink-0 font-mono text-micro text-critical tabular-nums">−{file.removed}</span>
              ) : null}

              <Menu
                align="end"
                trigger={
                  <button
                    type="button"
                    aria-label={t('git.file.menu', { path: file.path })}
                    className="flex size-5 shrink-0 items-center justify-center rounded text-ink-faint opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                  >
                    <MoreHorizontal size={13} />
                  </button>
                }
              >
                <MenuItem
                  icon={staged ? <Minus size={13} /> : <Plus size={13} />}
                  disabled={frozen}
                  onSelect={() => run({ kind: staged ? 'unstage' : 'stage', paths: [file.path] })}
                >
                  {staged ? t('git.file.unstage') : t('git.file.stage')}
                </MenuItem>
                <MenuItem icon={<FileCode2 size={13} />} onSelect={() => onOpenFile(file.path)}>
                  {t('git.file.open')}
                </MenuItem>
                <MenuSeparator />
                {/* Jeter ne s'annule pas : le garde-fou nomme ce qui part. */}
                <MenuItem
                  tone="critical"
                  disabled={frozen}
                  onSelect={() => run({ kind: 'discard', paths: [file.path] })}
                >
                  {t('git.file.discard')}
                </MenuItem>
              </Menu>
            </div>

            {/* Le diff du fichier se déplie sous sa ligne : la planche T2 montre la
                liste, et on ne quitte pas la liste pour regarder une ligne. */}
            {opened === file.path && diff ? (
              <div className="border-y border-line/60">
                {diff.status === 'binary' ? (
                  <p className="px-2.5 py-2 text-xs text-ink-faint">{t('changes.file.binary')}</p>
                ) : (
                  <DiffHunks hunks={diff.hunks} path={diff.path} />
                )}
              </div>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

/**
 * Ce qu'un tour qui se termine laisse derrière lui.
 *
 * La vue **propose** la relecture : elle sait déjà ce que le dépôt est devenu — la
 * lecture, elle, n'a jamais cessé — mais elle continue d'afficher ce qu'on regardait
 * jusqu'au clic. Une liste qui se vide sous le curseur pendant qu'on coche des
 * fichiers est pire que périmée. Le message écrit, lui, n'est touché ni dans un cas ni
 * dans l'autre : c'est le seul état que l'utilisateur a produit.
 */
function Review({
  held,
  live,
  onReread,
}: {
  held: GitStateDto
  live: GitStateDto | undefined
  onReread: () => void
}) {
  const t = useTranslate()
  const committed = live?.head && live.head.hash !== held.head?.hash ? live.head : null
  const gone = live
    ? held.staged.filter((file) => !live.staged.some((entry) => entry.path === file.path)).length
    : 0

  return (
    <div className="m-2 flex items-center gap-2 rounded-md border border-caution/40 bg-caution/8 px-2.5 py-2">
      <Bot size={14} className="shrink-0 text-caution" />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-ink">{t('git.review.title')}</p>
        <p className="truncate text-micro text-ink-faint">
          {committed
            ? t('git.review.committed', {
                subject: committed.subject,
                gone,
                total: held.staged.length,
              })
            : t('git.review.changed')}
        </p>
      </div>
      <button
        type="button"
        onClick={onReread}
        className="flex shrink-0 items-center gap-1.5 rounded-md bg-accent px-2 py-1 text-micro font-medium text-on-accent"
      >
        <RefreshCw size={12} />
        {t('git.review.reread')}
      </button>
    </div>
  )
}
