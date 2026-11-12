import { ArrowUpRight, FileDiff, GitBranchPlus, GitPullRequest, MessageSquare, MoreHorizontal, RefreshCw, Trash2 } from 'lucide-react'
import { Fragment, useEffect, useId, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Button, ConfirmDialog, cx } from '@solera/ui'
import { lineGestures, statusOfLine, type LineGesture, type LineStatus, type TreeRow } from '../../lib/code-model'
import { elapsed } from '../../lib/dates'
import { translateError, useTranslate } from '../../lib/i18n'
import { ApiRequestError } from '../../lib/api'
import { useMergePullRequest } from '../../lib/pull-requests'
import { useRebaseTree, useTreeDiff } from '../../lib/tree-gestures'
import { travailStateHref } from '../../lib/travail-model'
import { WorktreeCleanupDialog } from '../WorktreeCleanupDialog'
import { CardRef } from './CardRef'
import { Drift } from './Drift'
import { PrTag } from './PrTag'
import { SessionStack } from './SessionStack'

const ROW_H = 56

/*
  Les colonnes d'une branche, de taille fixe : le graphe, le nom et ce qu'elle sert, puis
  les sessions, la dérive, la PR et le `⋯`, serrés contre le texte (A-4.4). Étirées sur
  toute la largeur, elles rejetaient sessions et PR à l'autre bout de l'écran. Au
  téléphone, le graphe, le texte et le `⋯` seulement.
*/
const COLUMNS = 'grid-cols-[44px_minmax(0,1fr)_auto] sm:grid-cols-[44px_minmax(0,1fr)_4.5rem_5.5rem_4rem_1.25rem]'

/** Ce qui se clique au-dessus du bouton étiré de la ligne. */
const ABOVE = 'relative z-[1]'

/** Le point et le mot d'une ligne (A-4.3) : la couleur dit le plus urgent. */
const STATUS_TONE: Record<LineStatus, { fill: string; text: string; pulse?: boolean }> = {
  broken: { fill: 'fill-critical', text: 'text-critical' },
  awaiting: { fill: 'fill-caution', text: 'text-caution' },
  conflict: { fill: 'fill-critical', text: 'text-critical' },
  running: { fill: 'fill-accent', text: 'text-accent', pulse: true },
  ciRed: { fill: 'fill-critical', text: 'text-critical' },
  ready: { fill: 'fill-positive', text: 'text-positive' },
  toClean: { fill: 'fill-line-strong', text: 'text-ink-faint' },
  default: { fill: 'fill-line-strong', text: 'text-ink-faint' },
  idle: { fill: 'fill-line-strong', text: 'text-ink-faint' },
}

/** Une erreur d'API dans la langue de l'interface, ou son message brut. */
function errorText(error: unknown): string {
  if (error instanceof ApiRequestError) return translateError(error.code, error.message)
  return error instanceof Error ? error.message : String(error)
}

/**
 * Le code en cours en graphe de branches (`projet.md` A-4) : la branche par défaut en
 * tronc, chaque arbre vivant en rameau, son état d'un coup d'œil. Un clic (ou Entrée,
 * Espace) sur une ligne déplie ses gestes, une ligne à la fois : la session, le diff, la
 * PR, le rebase, le nettoyage — tous réels.
 *
 * `lines` : les arbres vivants, déjà dans leur ordre (`liveTrees`, `orderLines`) ;
 * `settled` : ceux qui n'ont plus qu'à être nettoyés, comptés à part.
 */
export function CodeGraph({
  projectId,
  lines,
  settled,
  base,
}: {
  projectId: string
  lines: TreeRow[]
  settled: number
  /** La branche de comparaison, que « Rebaser » vise. */
  base: string | null
}) {
  const t = useTranslate()
  const [open, setOpen] = useState<string | null>(null)
  const [merging, setMerging] = useState<{ tree: TreeRow; number: number } | null>(null)
  const [cleaning, setCleaning] = useState<TreeRow | null>(null)
  const [notice, setNotice] = useState<{ text: string; critical: boolean; at: number } | null>(null)
  const merge = useMergePullRequest(projectId)

  // Un retour chasse le précédent, et s'efface seul.
  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(null), 5_000)
    return () => window.clearTimeout(timer)
  }, [notice])
  const say = (text: string, critical = false) => setNotice({ text, critical, at: Date.now() })

  if (lines.length === 0) return <p className="text-sm text-ink-faint">{t('project.overview.code.empty')}</p>

  const root = lines.find((line) => line.root)
  const trees = lines.filter((line) => !line.root)
  const ordered = root ? [root, ...trees] : trees
  return (
    <div className="flex flex-col">
      <ol className="flex flex-col">
        {ordered.map((line, index) => (
          <Branch
            key={line.key}
            projectId={projectId}
            line={line}
            base={base}
            first={index === 0}
            last={index === ordered.length - 1}
            open={open === line.key}
            onToggle={() => setOpen((current) => (current === line.key ? null : line.key))}
            onMerge={(number) => setMerging({ tree: line, number })}
            onClean={() => setCleaning(line)}
            say={say}
          />
        ))}
      </ol>
      {settled > 0 ? (
        <Link
          to={travailStateHref(projectId, 'cleanup')}
          className="mt-2 ml-11 self-start rounded text-xs text-ink-faint hover:text-ink focus-visible:outline-2 focus-visible:outline-accent pointer-coarse:min-h-11"
        >
          {t(settled === 1 ? 'project.overview.code.settled.one' : 'project.overview.code.settled.other', { count: settled })}
        </Link>
      ) : null}
      <div role="status" aria-live="polite" className="ml-11">
        {notice ? (
          <p key={notice.at} className={cx('mt-2 text-xs', notice.critical ? 'text-critical' : 'text-ink-soft')}>
            {notice.text}
          </p>
        ) : null}
      </div>

      {merging ? (
        <ConfirmDialog
          open
          onOpenChange={(next: boolean) => {
            if (!next && !merge.isPending) setMerging(null)
          }}
          title={t('code.merge.title', { number: merging.number })}
          confirmLabel={t('code.merge.confirm')}
          busy={merge.isPending}
          onConfirm={() => {
            const { number } = merging
            merge.mutate(number, {
              onSuccess: () => say(t('code.notice.merged', { number })),
              onError: (error) => say(t('code.notice.failed', { error: errorText(error) }), true),
              onSettled: () => setMerging(null),
            })
          }}
        >
          <p>{t('code.merge.text', { branch: merging.tree.branch ?? merging.tree.name })}</p>
        </ConfirmDialog>
      ) : null}
      {cleaning ? (
        <WorktreeCleanupDialog
          projectId={projectId}
          tree={{ path: cleaning.path, name: cleaning.name }}
          base={base}
          onClose={() => {
            setCleaning(null)
            setOpen(null)
          }}
        />
      ) : null}
    </div>
  )
}

function Branch({
  projectId,
  line,
  base,
  first,
  last,
  open,
  onToggle,
  onMerge,
  onClean,
  say,
}: {
  projectId: string
  line: TreeRow
  base: string | null
  first: boolean
  last: boolean
  open: boolean
  onToggle: () => void
  onMerge: (number: number) => void
  onClean: () => void
  say: (text: string, critical?: boolean) => void
}) {
  const t = useTranslate()
  const gesturesId = useId()
  const status = statusOfLine(line)
  const tone = STATUS_TONE[status]
  const name = line.branch ?? line.name
  const mid = ROW_H / 2
  return (
    <li className="relative">
      {/* Le tronc continue sous une branche dépliée : il descend jusqu'au bas de la ligne. */}
      {!last && open ? <span aria-hidden className="absolute top-0 bottom-0 left-[11px] w-0.5 bg-line-strong" /> : null}
      <div
        data-line={line.key}
        className={cx(
          'group relative grid items-center gap-x-3 rounded-lg pr-2 transition-colors',
          COLUMNS,
          open ? 'bg-surface' : 'hover:bg-surface',
        )}
        style={{ height: ROW_H }}
      >
        <svg width={44} height={ROW_H} className="shrink-0 overflow-visible" aria-hidden>
          <path d={`M12 ${first ? mid : 0} V${last && !open ? mid : ROW_H}`} className="stroke-line-strong" strokeWidth={2} fill="none" />
          {line.root ? (
            <circle cx={12} cy={mid} r={6} className="fill-ink" />
          ) : (
            <>
              <path d={`M12 ${mid - 16} Q12 ${mid} 28 ${mid} H31`} className="stroke-line-strong" strokeWidth={2} fill="none" />
              <circle cx={36} cy={mid} r={5.5} className={cx(tone.fill, tone.pulse && 'animate-pulse')} />
            </>
          )}
        </svg>
        <span className="flex min-w-0 flex-col gap-1">
          <span className="flex min-w-0 items-center gap-2">
            {/* Le bouton s'étire sur toute la ligne : un clic n'importe où la déplie. */}
            <button
              type="button"
              aria-expanded={open}
              aria-controls={open ? gesturesId : undefined}
              title={t('code.line.gestures', { branch: name })}
              onClick={onToggle}
              className={cx(
                'min-w-0 truncate text-left font-mono text-code outline-none',
                'after:absolute after:inset-0 after:rounded-lg focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-accent',
                line.root ? 'text-ink' : 'text-ink-soft',
              )}
            >
              {name}
            </button>
            <span className={cx('shrink-0 text-xs', tone.text)}>{t(`code.status.${status}`)}</span>
          </span>
          {/* À quoi sert l'arbre : sa carte, et le jalon de la carte. */}
          {line.card ? (
            <CardRef projectId={projectId} card={line.card} />
          ) : (
            <span className="truncate text-xs text-ink-faint">{t(line.root ? 'code.line.defaultBranch' : 'code.line.noCard')}</span>
          )}
        </span>
        <span className={cx(ABOVE, 'hidden sm:flex')}>
          <SessionStack projectId={projectId} sessions={line.sessions} />
        </span>
        <span className="hidden truncate text-xs text-ink-faint sm:block">
          <Drift ahead={line.ahead} behind={line.behind} dirty={line.uncommitted} conflicts={line.conflicts} />
        </span>
        <span className={cx(ABOVE, 'hidden sm:flex')}>
          <PrTag pr={line.pr} compact />
        </span>
        <MoreHorizontal
          size={15}
          aria-hidden
          className={cx('justify-self-end text-ink-faint transition-opacity', open ? 'opacity-100' : 'opacity-40 group-hover:opacity-100')}
        />
      </div>
      {open ? <Gestures id={gesturesId} projectId={projectId} line={line} base={base} onMerge={onMerge} onClean={onClean} say={say} /> : null}
    </li>
  )
}

/* ------------------------------------------------------------------ les gestes */

const GESTURE_ICON: Record<LineGesture['kind'], ReactNode> = {
  session: <MessageSquare size={13} />,
  launch: <GitBranchPlus size={13} />,
  diff: <FileDiff size={13} />,
  pr: <GitPullRequest size={13} />,
  rebase: <RefreshCw size={13} />,
  clean: <Trash2 size={13} />,
}

function Gestures({
  id,
  projectId,
  line,
  base,
  onMerge,
  onClean,
  say,
}: {
  id: string
  projectId: string
  line: TreeRow
  base: string | null
  onMerge: (number: number) => void
  onClean: () => void
  say: (text: string, critical?: boolean) => void
}) {
  const t = useTranslate()
  const navigate = useNavigate()
  const diff = useTreeDiff(projectId)
  const rebase = useRebaseTree(projectId)
  const name = line.branch ?? line.name

  const button = (gesture: LineGesture): ReactNode => {
    const shared = { size: 'sm' as const, icon: GESTURE_ICON[gesture.kind] }
    switch (gesture.kind) {
      case 'session':
        return (
          <Button {...shared} variant={gesture.reply ? 'primary' : 'secondary'} onClick={() => navigate(`/p/${projectId}/c/${gesture.sessionId}`)}>
            {t(gesture.reply ? 'code.action.reply' : 'code.action.openSession')}
          </Button>
        )
      case 'launch':
        return (
          <Button {...shared} variant="secondary" onClick={() => navigate(`/p/${projectId}/c/new?worktree=${gesture.treeId}`)}>
            {t('code.action.launchHere')}
          </Button>
        )
      case 'diff':
        return (
          <Button {...shared} variant="secondary" onClick={() => diff(line)}>
            {gesture.count > 0 ? t('code.action.diffCount', { count: gesture.count }) : t('code.action.diff')}
          </Button>
        )
      case 'pr':
        if (gesture.action === 'merge') {
          return (
            <Button {...shared} variant="secondary" onClick={() => onMerge(gesture.number)}>
              {t('code.action.mergePr', { number: gesture.number })}
            </Button>
          )
        }
        return (
          <Button {...shared} variant="secondary" onClick={() => window.open(gesture.url, '_blank', 'noopener')}>
            {t(gesture.action === 'ci' ? 'code.action.seeCi' : 'code.action.openPr', { number: gesture.number })}
            <ArrowUpRight size={12} aria-hidden />
          </Button>
        )
      case 'rebase':
        if (!base) return null
        return (
          <Button
            {...shared}
            variant="secondary"
            disabled={rebase.isPending}
            onClick={() =>
              rebase.mutate(
                { tree: line, base },
                {
                  onSuccess: (outcome) => say(outcome.kind === 'asked' ? t('code.notice.rebaseAsked') : t('code.notice.rebased', { branch: name, base })),
                  onError: (error) => say(t('code.notice.failed', { error: errorText(error) }), true),
                },
              )
            }
          >
            {t('code.action.rebase', { base, count: gesture.behind })}
          </Button>
        )
      case 'clean':
        return (
          <Button {...shared} variant="danger" onClick={onClean}>
            {t('code.action.clean')}
          </Button>
        )
    }
  }

  // Le pied : la PR et son état, la dernière activité.
  const foot: { key: string; node: ReactNode }[] = []
  if (line.pr) {
    const prTone = line.pr.state === 'failing' ? 'text-critical' : line.pr.state === 'ready' ? 'text-positive' : undefined
    foot.push({ key: 'pr', node: <span className={prTone}>{t('code.foot.pr', { number: line.pr.number, state: t(`code.pr.${line.pr.state}`) })}</span> })
  } else if (!line.root) {
    foot.push({ key: 'pr', node: t('code.foot.noPr') })
  }
  if (line.lastUsedAt !== null) foot.push({ key: 'at', node: t('code.foot.lastActivity', { age: elapsed(line.lastUsedAt) }) })

  return (
    <div id={id} className="mb-2 ml-11 flex flex-col gap-2 rounded-b-lg bg-surface px-3 pt-1 pb-3">
      <div className="flex flex-wrap items-center gap-1.5">
        {lineGestures(line).map((gesture) => (
          <Fragment key={gesture.kind}>{button(gesture)}</Fragment>
        ))}
      </div>
      <p className="text-xs text-ink-faint">
        {foot.map((part, index) => (
          <Fragment key={part.key}>
            {index > 0 ? ' · ' : null}
            {part.node}
          </Fragment>
        ))}
        {/* Au téléphone, la dérive n'a pas de colonne : elle passe au pied. */}
        <span className="sm:hidden">
          {foot.length > 0 ? ' · ' : null}
          <Drift ahead={line.ahead} behind={line.behind} dirty={line.uncommitted} conflicts={line.conflicts} />
        </span>
      </p>
    </div>
  )
}
