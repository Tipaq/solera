/* PROTOTYPE — jetable (branche proto/page-projet). Ne pas fusionner dans main.
 *
 * Le code en cours en graphe de branches (retenu de `visuel` le 2026-11-11), commun aux
 * trois variantes : la branche par défaut en tronc, chaque worktree qui en part, son
 * état d'un coup d'œil. Un clic (ou un tap) sur une branche ouvre ses gestes : la
 * session, le diff, la PR, le rebase, le nettoyage.
 */
import { ArrowUpRight, FileDiff, Flag, GitBranchPlus, GitPullRequest, MessageSquare, MoreHorizontal, RefreshCw, Trash2 } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { cx } from '@solera/ui'
import { elapsed } from '../../../lib/dates'
import { openPanelOnArrival } from '../../../lib/panel'
import { useProtoHref } from '../../prototype-milestones/model'
import type { V2Code, V2Data } from './data'
import { Drift, PR_LABEL, PR_TEXT, SessionStack } from './parts'

const ROW_H = 56

/*
  Les colonnes d'une branche, de taille fixe : le graphe, le nom et ce qu'elle sert, puis
  les sessions, la dérive, la PR et le geste, serrés contre le texte. Étirées sur toute la
  largeur, elles rejetaient sessions et PR à l'autre bout de l'écran (retour de Tim sur
  `combo`, 2026-11-11).
*/
const COLUMNS = 'grid-cols-[44px_minmax(0,1fr)_auto] sm:grid-cols-[44px_minmax(0,1fr)_4.5rem_5.5rem_4rem_1.25rem]'

/** Le point d'une branche : ce qui demande le plus d'attention l'emporte. */
function statusOf(line: V2Code): { fill: string; label: string; text: string; pulse: boolean } {
  const tones = line.sessions.map((session) => session.tone)
  if (tones.includes('broken')) return { fill: 'fill-critical', label: 'session en erreur', text: 'text-critical', pulse: false }
  if (tones.includes('awaiting') || line.awaiting) return { fill: 'fill-caution', label: 't’attend', text: 'text-caution', pulse: false }
  if (line.conflicts) return { fill: 'fill-critical', label: 'conflit', text: 'text-critical', pulse: false }
  if (tones.includes('running')) return { fill: 'fill-accent', label: 'tourne', text: 'text-accent', pulse: true }
  if (line.pr?.state === 'failing') return { fill: 'fill-critical', label: 'CI rouge', text: 'text-critical', pulse: false }
  if (line.pr?.state === 'ready') return { fill: 'fill-positive', label: 'prête à fusionner', text: 'text-positive', pulse: false }
  if (line.pr?.state === 'merged') return { fill: 'fill-line-strong', label: 'à nettoyer', text: 'text-ink-faint', pulse: false }
  return { fill: 'fill-line-strong', label: line.root ? 'branche par défaut' : 'au repos', text: 'text-ink-faint', pulse: false }
}

export function CodeGraph({ data }: { data: V2Data }) {
  const href = useProtoHref()
  const [open, setOpen] = useState<string | null>(null)
  const root = data.code.find((line) => line.root)
  const trees = data.code.filter((line) => !line.root)

  if (data.code.length === 0) return <p className="text-sm text-ink-faint">Pas de dépôt git, ou rien en cours.</p>

  const toggle = (key: string) => setOpen((current) => (current === key ? null : key))
  return (
    <div className="flex flex-col">
      <ol className="flex flex-col">
        {root ? <Branch line={root} first last={trees.length === 0} open={open === root.key} onToggle={() => toggle(root.key)} projectId={data.projectId} /> : null}
        {trees.map((line, index) => (
          <Branch
            key={line.key}
            line={line}
            first={!root && index === 0}
            last={index === trees.length - 1}
            open={open === line.key}
            onToggle={() => toggle(line.key)}
            projectId={data.projectId}
          />
        ))}
      </ol>
      {data.settledTrees ? (
        <Link to={href(`/p/${data.projectId}/activity?groupe=worktree`)} className="mt-2 ml-11 self-start text-xs text-ink-faint hover:text-ink">
          + {data.settledTrees} arbre{data.settledTrees > 1 ? 's' : ''} fusionné{data.settledTrees > 1 ? 's' : ''} à nettoyer
        </Link>
      ) : null}
    </div>
  )
}

function Branch({
  line,
  first,
  last,
  open,
  onToggle,
  projectId,
}: {
  line: V2Code
  first: boolean
  last: boolean
  open: boolean
  onToggle: () => void
  projectId: string
}) {
  const status = statusOf(line)
  const mid = ROW_H / 2
  return (
    <li className="relative">
      {/* Le tronc continue sous une branche dépliée : il descend jusqu'au bas de la ligne. */}
      {!last && open ? <span aria-hidden className="absolute top-0 bottom-0 left-[11px] w-0.5 bg-line-strong" /> : null}
      <div
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={onToggle}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            onToggle()
          }
        }}
        className={cx(
          'group relative grid cursor-pointer items-center gap-x-3 rounded-lg pr-2 transition-colors focus-visible:outline-2 focus-visible:outline-accent',
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
              <circle cx={36} cy={mid} r={5.5} className={cx(status.fill, status.pulse && 'animate-pulse')} />
            </>
          )}
        </svg>
        <span className="flex min-w-0 flex-col gap-1">
          <span className="flex min-w-0 items-center gap-2">
            <span className={cx('truncate font-mono text-code', line.root ? 'text-ink' : 'text-ink-soft')}>{line.branch}</span>
            <span className={cx('shrink-0 text-xs', status.text)}>{status.label}</span>
          </span>
          {/* À quoi sert l'arbre : sa carte, et le jalon de la carte. */}
          <span className="flex min-w-0 items-center gap-1.5 text-xs text-ink-faint">
            {line.card ? (
              <>
                <Link to={line.card.to} onClick={(event) => event.stopPropagation()} title={line.card.title} className="min-w-0 truncate hover:text-ink">
                  <span className="tabular-nums">#{line.card.number}</span> {line.card.title}
                </Link>
                {line.card.milestone ? (
                  <Link
                    to={line.card.milestone.to}
                    onClick={(event) => event.stopPropagation()}
                    title={line.card.milestone.title}
                    className="inline-flex shrink-0 items-center gap-1 rounded-full bg-surface-high px-1.5 py-0.5 text-meta text-ink-soft hover:bg-line hover:text-ink"
                  >
                    <Flag size={10} />
                    Jalon #{line.card.milestone.number}
                  </Link>
                ) : null}
              </>
            ) : (
              <span className="truncate">{line.root ? 'branche par défaut' : 'sans carte'}</span>
            )}
          </span>
        </span>
        <span className="hidden sm:flex">
          <SessionStack sessions={line.sessions} />
        </span>
        <span className="hidden text-xs text-ink-faint sm:block">
          <Drift ahead={line.ahead} behind={line.behind} dirty={line.dirty} conflicts={line.conflicts} />
        </span>
        {line.pr ? (
          <span className={cx('hidden items-center gap-1 text-xs sm:flex', PR_TEXT[line.pr.state])} title={PR_LABEL[line.pr.state]}>
            <GitPullRequest size={12} className="shrink-0" />
            <span className="tabular-nums">#{line.pr.number}</span>
          </span>
        ) : (
          <span className="hidden text-xs text-ink-faint sm:block">—</span>
        )}
        <MoreHorizontal size={15} className={cx('justify-self-end text-ink-faint transition-opacity', open ? 'opacity-100' : 'opacity-40 group-hover:opacity-100')} />
      </div>
      {open ? <Actions line={line} projectId={projectId} /> : null}
    </li>
  )
}

/* ------------------------------------------------------------------ les gestes */

function Actions({ line, projectId }: { line: V2Code; projectId: string }) {
  const navigate = useNavigate()
  const href = useProtoHref()
  const [notice, setNotice] = useState<string | null>(null)
  const lead = line.sessions.find((session) => session.tone !== 'quiet') ?? line.sessions[0]
  const settled = line.pr?.state === 'merged'

  /** Le panneau git s'ouvre à l'arrivée sur la page qui montre l'arbre : sa session, ou le board pour la racine. */
  const diff = () => {
    const to = line.root
      ? href(`/p/${projectId}/travail`)
      : lead
        ? lead.to
        : href(`/p/${projectId}/c/new?worktree=${line.treeId ?? ''}`)
    openPanelOnArrival(to.split('?')[0]!, 'git')
    navigate(to)
  }
  const stub = (message: string) => setNotice(`Simulé : ${message}`)

  return (
    <div className="mb-2 ml-11 flex flex-col gap-2 rounded-b-lg bg-surface px-3 pt-1 pb-3">
      <div className="flex flex-wrap items-center gap-1.5">
        {lead ? (
          <Action icon={<MessageSquare size={13} />} label={lead.tone === 'awaiting' ? 'Répondre à la session' : 'Ouvrir la session'} primary={lead.tone === 'awaiting'} onClick={() => navigate(lead.to)} />
        ) : line.root ? null : (
          <Action icon={<GitBranchPlus size={13} />} label="Lancer une session ici" onClick={() => navigate(href(`/p/${projectId}/c/new?worktree=${line.treeId ?? ''}`))} />
        )}
        <Action icon={<FileDiff size={13} />} label={line.dirty ? `Voir le diff (${line.dirty})` : 'Voir le diff'} onClick={diff} />
        {line.pr ? (
          <Action
            icon={<GitPullRequest size={13} />}
            label={line.pr.state === 'ready' ? `Fusionner la PR #${line.pr.number}` : line.pr.state === 'failing' ? `Voir la CI #${line.pr.number}` : `Ouvrir la PR #${line.pr.number}`}
            trailing={<ArrowUpRight size={12} />}
            onClick={() => window.open(line.pr!.url, '_blank', 'noreferrer')}
          />
        ) : null}
        {!line.root && line.behind > 0 ? (
          <Action icon={<RefreshCw size={13} />} label={`Rebaser sur main (↓${line.behind})`} onClick={() => stub(`rebase de ${line.branch} sur main demandé à sa session`)} />
        ) : null}
        {!line.root && (settled || line.sessions.length === 0) ? (
          <Action
            icon={<Trash2 size={13} />}
            label="Nettoyer l’arbre"
            danger
            onClick={() => {
              if (window.confirm(`Supprimer le worktree ${line.branch} ? (simulé, rien n’est supprimé)`)) stub(`${line.branch} supprimé`)
            }}
          />
        ) : null}
      </div>
      <p className="text-xs text-ink-faint">
        {line.pr ? <span className={PR_TEXT[line.pr.state]}>PR #{line.pr.number} · {PR_LABEL[line.pr.state]}</span> : line.root ? null : 'Pas de PR'}
        {line.at ? <span>{line.pr || !line.root ? ' · ' : ''}dernière activité {elapsed(line.at)}</span> : null}
        <span className="md:hidden">
          {' · '}
          <Drift ahead={line.ahead} behind={line.behind} dirty={line.dirty} conflicts={line.conflicts} />
        </span>
      </p>
      {notice ? <p className="text-xs text-fuchsia-600 dark:text-fuchsia-300">{notice}</p> : null}
    </div>
  )
}

function Action({
  icon,
  label,
  onClick,
  trailing,
  primary = false,
  danger = false,
}: {
  icon: ReactNode
  label: string
  onClick: () => void
  trailing?: ReactNode
  primary?: boolean
  danger?: boolean
}) {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation()
        onClick()
      }}
      className={cx(
        'inline-flex min-h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium transition-colors',
        primary
          ? 'bg-accent text-accent-ink hover:bg-accent-hover'
          : danger
            ? 'border border-line text-critical hover:bg-critical/10'
            : 'border border-line bg-canvas text-ink-soft hover:border-line-strong hover:text-ink',
      )}
    >
      {icon}
      {label}
      {trailing}
    </button>
  )
}
