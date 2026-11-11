/* PROTOTYPE — jetable (branche proto/page-projet). Ne pas fusionner dans main. */
import {
  ArrowDown,
  ArrowUp,
  ChevronRight,
  ExternalLink,
  FileDiff,
  GitBranch,
  GitMerge,
  GitPullRequest,
  HardDrive,
  MessageCircleQuestion,
  MoreHorizontal,
  Play,
  RefreshCw,
  Trash2,
  TriangleAlert,
} from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import type { PullRequestBadgeState } from '@solera/protocol'
import { Badge, Button, ConfirmDialog, EmptyState, IconButton, Menu, MenuItem, MenuSeparator, SegmentedControl, cx } from '@solera/ui'
import { AgentIcon } from '../../components/AgentIcon'
import { PrototypeSwitcher, usePrototypeVariant, type PrototypeVariant } from '../../components/PrototypeSwitcher'
import { PrototypeVerdict } from '../../components/PrototypeVerdict'
import { elapsed } from '../../lib/dates'
import { openPanelOnArrival } from '../../lib/panel'
import { useProjects } from '../../lib/projects'
import { GitPanelHost } from '../../components/prototype/GitPanelHost'
import { CardDrawerHost } from '../prototype-milestones/CardDrawer'
import { useProtoHref } from '../prototype-milestones/model'
import {
  HEAVY_BYTES,
  formatBytes,
  isCleanable,
  useCodeData,
  type BranchRow,
  type CodeData,
  type TreeRow,
  type TreeVerdict,
} from './data'

/**
 * L'onglet **Code** d'un projet : tous ses worktrees, ce qu'ils pèsent, pourquoi ils sont
 * encore là, et les branches qu'aucun arbre n'a extraites.
 *
 * Deux variantes, pour la seule question que Tim a laissée ouverte : les branches dans le
 * même onglet (`ensemble`), ou derrière un lien (`worktrees`).
 */
const VARIANTS: PrototypeVariant[] = [
  { key: 'ensemble', name: 'Worktrees + branches' },
  { key: 'worktrees', name: 'Worktrees seuls' },
]

type Filter = 'all' | 'active' | 'cleanable' | 'heavy'
type Sort = 'urgency' | 'size' | 'recent'

export const VERDICT_TONE: Record<TreeVerdict, { dot: string; text: string; label: string }> = {
  root: { dot: 'bg-ink-faint', text: 'text-ink-soft', label: 'Branche par défaut' },
  waiting: { dot: 'bg-caution', text: 'text-caution', label: 'T’attend' },
  active: { dot: 'bg-accent animate-pulse', text: 'text-ink-soft', label: 'En cours' },
  review: { dot: 'bg-accent', text: 'text-ink-soft', label: 'À relire' },
  'merged-dirty': { dot: 'bg-critical', text: 'text-critical', label: 'Attention' },
  stale: { dot: 'bg-caution/60', text: 'text-caution', label: 'Abandonné ?' },
  wip: { dot: 'bg-ink-soft', text: 'text-ink-soft', label: 'En suspens' },
  empty: { dot: 'border border-ink-faint', text: 'text-ink-faint', label: 'Vide' },
  clean: { dot: 'bg-positive', text: 'text-ink-soft', label: 'À nettoyer' },
  missing: { dot: 'border border-critical', text: 'text-critical', label: 'Introuvable' },
}

export const PR_LABEL: Record<PullRequestBadgeState, { label: string; tone: 'neutral' | 'accent' | 'positive' | 'caution' | 'critical' }> = {
  draft: { label: 'brouillon', tone: 'neutral' },
  checks: { label: 'CI en cours', tone: 'accent' },
  failing: { label: 'CI rouge', tone: 'critical' },
  ready: { label: 'prête', tone: 'positive' },
  merged: { label: 'fusionnée', tone: 'neutral' },
}

/** Les colonnes du tableau, partagées par l'en-tête et les lignes : l'alignement au pixel. */
export const GRID = 'md:grid md:grid-cols-[minmax(0,1fr)_9rem_8rem_5.5rem_5rem_5.5rem_2.5rem] md:items-center md:gap-x-4'

export function ProjectCodePage() {
  const { projectId } = useParams()
  const { data: projects, isPending } = useProjects()
  const project = projects?.find((entry) => entry.id === projectId)
  const variant = usePrototypeVariant(VARIANTS)
  const data = useCodeData(projectId, project)

  if (isPending) return null
  if (!projectId || !project) return <EmptyState title="Projet introuvable" />

  return (
    <div className="h-full overflow-y-auto">
      <div className="flex flex-col gap-8 p-4 pb-28 md:p-6 md:pb-28">
        {!project.git && !data.demo ? (
          <EmptyState title="Ce projet n’est pas un dépôt git" />
        ) : (
          <>
            <Trees projectId={projectId} data={data} />
            {variant === 'ensemble' ? <Branches data={data} /> : <BranchesLink data={data} />}
          </>
        )}
      </div>
      <CardDrawerHost />
      {projectId ? <GitPanelHost projectId={projectId} /> : null}
      <PrototypeSwitcher variants={VARIANTS} />
      <PrototypeVerdict scope="code" variant={variant} />
    </div>
  )
}

/* ------------------------------------------------------------------ worktrees */

/**
 * `detail`, pour l'onglet Travail (proto) : ce qu'un arbre montre une fois déplié — ses
 * sessions et son historique. Sans lui, les lignes ne se déplient pas, comme dans Code.
 */
export function Trees({ projectId, data, detail }: { projectId: string; data: CodeData; detail?: (tree: TreeRow) => ReactNode }) {
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set())
  const [filter, setFilter] = useState<Filter>('all')
  const [sort, setSort] = useState<Sort>('urgency')
  const [cleaning, setCleaning] = useState<TreeRow[] | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [params, setParams] = useSearchParams()

  const trees = data.trees
  const cleanable = trees.filter(isCleanable)
  const total = trees.reduce((sum, tree) => sum + tree.sizeBytes, 0)
  const cleanableSize = cleanable.reduce((sum, tree) => sum + tree.sizeBytes, 0)
  const worktreeCount = trees.filter((tree) => !tree.root).length

  const shown = useMemo(() => {
    const kept = trees.filter((tree) => {
      if (filter === 'active') return ['waiting', 'active', 'review'].includes(tree.verdict)
      if (filter === 'cleanable') return isCleanable(tree) || tree.verdict === 'merged-dirty' || tree.verdict === 'stale' || tree.verdict === 'missing'
      if (filter === 'heavy') return tree.sizeBytes >= HEAVY_BYTES
      return true
    })
    if (sort === 'size') return [...kept].sort((a, b) => b.sizeBytes - a.sizeBytes)
    if (sort === 'recent') return [...kept].sort((a, b) => (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0))
    return kept
  }, [trees, filter, sort])

  const simulate = (message: string) => {
    setNotice(`Simulé : ${message}`)
    window.setTimeout(() => setNotice((current) => (current === `Simulé : ${message}` ? null : current)), 4_000)
  }

  return (
    <section aria-labelledby="code-trees" className="flex flex-col gap-4">
      {/* Le bilan : ce qu'on vient chercher en ouvrant l'onglet, en une ligne. */}
      <header className="flex flex-wrap items-end gap-x-6 gap-y-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 id="code-trees" className="text-base font-semibold text-ink">Worktrees</h2>
          <p className="flex flex-wrap items-center gap-x-2 text-sm text-ink-soft">
            <span className="tabular-nums">{worktreeCount} arbre{worktreeCount > 1 ? 's' : ''}</span>
            <span aria-hidden className="text-ink-faint">·</span>
            <span className="inline-flex items-center gap-1 tabular-nums">
              <HardDrive size={13} className="text-ink-faint" />
              {formatBytes(total)}
              <SimTag />
            </span>
            {cleanable.length > 0 ? (
              <>
                <span aria-hidden className="text-ink-faint">·</span>
                <span className="text-positive tabular-nums">
                  {cleanable.length} à nettoyer ({formatBytes(cleanableSize)})
                </span>
              </>
            ) : null}
          </p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {data.demo ? <span className="rounded-full bg-fuchsia-500/15 px-2 py-0.5 text-xs text-fuchsia-700 dark:text-fuchsia-300">Données de démo</span> : null}
          <Link
            to={{ search: toggled(params, 'demo') }}
            className="rounded-md px-2 py-1 text-xs text-ink-faint hover:bg-surface-high hover:text-ink"
            onClick={(event) => {
              event.preventDefault()
              setParams((current) => {
                if (current.get('demo') === '1') current.delete('demo')
                else current.set('demo', '1')
                return current
              })
            }}
          >
            {data.demo ? 'Vraies données' : 'Données de démo'}
          </Link>
          <Button
            size="sm"
            variant={cleanable.length > 0 ? 'primary' : 'secondary'}
            icon={<Trash2 size={14} />}
            disabled={cleanable.length === 0}
            onClick={() => setCleaning(cleanable)}
          >
            Nettoyer les fusionnés
          </Button>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <SegmentedControl<Filter>
          label="Filtrer les arbres"
          value={filter}
          onChange={setFilter}
          segments={[
            { value: 'all', label: `Tous ${trees.length}` },
            { value: 'active', label: 'Actifs' },
            { value: 'cleanable', label: 'À nettoyer' },
            { value: 'heavy', label: 'Lourds' },
          ]}
        />
        <label className="ml-auto flex items-center gap-2 text-xs text-ink-faint">
          Trier par
          <select
            value={sort}
            onChange={(event) => setSort(event.target.value as Sort)}
            className="rounded-md border border-line bg-canvas px-2 py-1 text-xs text-ink"
          >
            <option value="urgency">ce qui demande un geste</option>
            <option value="size">taille</option>
            <option value="recent">dernier usage</option>
          </select>
        </label>
      </div>

      {notice ? (
        <p role="status" className="rounded-lg bg-fuchsia-500/10 px-3 py-2 text-xs text-fuchsia-700 dark:text-fuchsia-300">{notice}</p>
      ) : null}

      {data.pending ? (
        <p className="text-sm text-ink-faint">Lecture des arbres…</p>
      ) : shown.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-sm text-ink-faint">Aucun arbre dans ce filtre.</p>
      ) : (
        <div className="flex flex-col">
          <div className={cx('hidden border-b border-line pb-2 text-meta font-medium tracking-wide text-ink-faint uppercase', GRID)}>
            <span>Branche · pourquoi elle est là</span>
            <span>Sessions</span>
            <span>PR</span>
            <span className="text-right">Base</span>
            <span className="text-right">Disque</span>
            <span className="text-right">Vu</span>
            <span />
          </div>
          <ul className="flex flex-col gap-2 md:gap-0 md:divide-y md:divide-line">
            {shown.map((tree) => (
              <TreeLine
                key={tree.key}
                projectId={projectId}
                tree={tree}
                demo={data.demo}
                onSimulate={simulate}
                onClean={() => setCleaning([tree])}
                expanded={detail ? open.has(tree.key) : undefined}
                onToggle={() =>
                  setOpen((current) => {
                    const next = new Set(current)
                    if (next.has(tree.key)) next.delete(tree.key)
                    else next.add(tree.key)
                    return next
                  })
                }
                detail={detail && open.has(tree.key) ? detail(tree) : null}
              />
            ))}
          </ul>
        </div>
      )}

      <CleanDialog
        trees={cleaning}
        onClose={() => setCleaning(null)}
        onConfirm={(trees) => {
          setCleaning(null)
          simulate(`${trees.length} arbre${trees.length > 1 ? 's' : ''} nettoyé${trees.length > 1 ? 's' : ''}, ${formatBytes(trees.reduce((sum, tree) => sum + tree.sizeBytes, 0))} libérés. Rien n’a été supprimé.`)
        }}
      />
    </section>
  )
}

function toggled(params: URLSearchParams, key: string): string {
  const next = new URLSearchParams(params)
  if (next.get(key) === '1') next.delete(key)
  else next.set(key, '1')
  return `?${next.toString()}`
}

export function SimTag() {
  return (
    <span title="L’API ne mesure pas encore la taille d’un arbre : valeur inventée" className="rounded bg-fuchsia-500/15 px-1 text-[10px] font-medium tracking-wide text-fuchsia-700 uppercase dark:text-fuchsia-300">
      simulé
    </span>
  )
}

export function TreeLine({
  projectId,
  tree,
  demo,
  onSimulate,
  onClean,
  expanded,
  onToggle,
  detail,
  onOpen,
}: {
  projectId: string
  tree: TreeRow
  demo: boolean
  onSimulate: (message: string) => void
  onClean: () => void
  /** Défini : la ligne se déplie (onglet Travail). */
  expanded?: boolean
  onToggle?: () => void
  detail?: ReactNode
  /** Défini : toute la ligne s'ouvre au clic (le tiroir de l'arbre, Travail `une-ligne`). */
  onOpen?: () => void
}) {
  const navigate = useNavigate()
  const href = useProtoHref()
  const tone = VERDICT_TONE[tree.verdict]
  const waiting = tree.sessions.find((session) => session.status === 'awaiting_input' || session.status === 'error')
  const sessionId = waiting?.id ?? tree.sessions[0]?.id ?? tree.anySessionId

  const openSession = (id: string | null) => {
    if (!id) return navigate(href(`/p/${projectId}/c/new${tree.id ? `?worktree=${tree.id}` : ''}`))
    if (demo) return onSimulate('la session s’ouvrirait ici (la démo n’a pas de vraie session)')
    navigate(`/p/${projectId}/c/${id}`)
  }
  const openDiff = () => {
    if (demo) return onSimulate('le panneau git s’ouvrirait sur le diff de cet arbre')
    const path = sessionId ? `/p/${projectId}/c/${sessionId}` : `/p/${projectId}/code`
    openPanelOnArrival(path, 'git')
    navigate(path)
  }

  /* Le geste principal, celui que le verdict appelle : un seul bouton visible par ligne. */
  const primary: { label: string; icon: ReactNode; run: () => void } | null =
    tree.verdict === 'waiting'
      ? { label: 'Répondre', icon: <MessageCircleQuestion size={13} />, run: () => openSession(waiting?.id ?? null) }
      : tree.verdict === 'clean'
        ? { label: 'Nettoyer', icon: <Trash2 size={13} />, run: onClean }
        : tree.verdict === 'review' && tree.pr?.url
          ? { label: 'Relire', icon: <GitPullRequest size={13} />, run: () => window.open(tree.pr!.url, '_blank', 'noopener') }
          : null

  return (
    <li
      className={cx(
        'rounded-xl border border-line px-3 py-3 md:rounded-none md:border-0 md:px-0 md:py-2.5',
        GRID,
        tree.root && 'md:bg-surface/40',
        onOpen && 'cursor-pointer transition-colors hover:bg-surface-high/60',
      )}
      onClick={
        onOpen
          ? (event) => {
              // Un lien, un bouton ou le menu de la ligne gardent leur propre geste.
              if ((event.target as HTMLElement).closest('a, button, [role="menu"], [role="menuitem"], [role="dialog"]')) return
              onOpen()
            }
          : undefined
      }
    >
      {/* Branche, verdict, carte : la colonne qui se lit. */}
      <div className="flex min-w-0 items-start gap-2.5">
        {expanded !== undefined ? (
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={expanded}
            aria-label={expanded ? 'Replier' : 'Déplier ses sessions et son historique'}
            className="-ml-1 flex size-5 shrink-0 items-center justify-center rounded text-ink-faint hover:bg-surface-high hover:text-ink"
          >
            <ChevronRight size={14} className={cx('transition-transform', expanded && 'rotate-90')} />
          </button>
        ) : null}
        <span aria-hidden className={cx('mt-1.5 size-2 shrink-0 rounded-full', tone.dot)} />
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="flex min-w-0 items-center gap-2">
            <GitBranch size={13} className="shrink-0 text-ink-faint" />
            <span className={cx('min-w-0 truncate font-mono text-[13px]', tree.root ? 'font-semibold text-ink' : 'text-ink')}>{tree.branch ?? tree.name}</span>
            {tree.external ? <Badge>hors Solera</Badge> : null}
            {tree.conflicts ? <Badge tone="critical" icon={<TriangleAlert size={11} />}>conflit</Badge> : null}
          </div>
          <p className={cx('text-xs', tone.text)}>{tree.reason}</p>
          {tree.card ? (
            <p className="flex min-w-0 items-center gap-1.5 text-xs text-ink-faint">
              <Link to={href(`?fiche=${tree.card.number}`)} className="min-w-0 truncate underline-offset-2 hover:text-ink hover:underline">
                <span className="tabular-nums">#{tree.card.number}</span> {tree.card.title}
              </Link>
              {tree.card.milestone ? (
                <Link to={href(`/p/${projectId}/timeline/${tree.card.milestone.number}`)} className="shrink-0 rounded bg-surface-high px-1.5 py-px underline-offset-2 hover:text-ink hover:underline">
                  Jalon #{tree.card.milestone.number}
                </Link>
              ) : null}
            </p>
          ) : null}
        </div>
      </div>

      {/* Au téléphone, les colonnes suivantes deviennent une rangée de faits sous le titre. */}
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 pl-[18px] text-xs md:contents">
        <div className="flex min-w-0 items-center gap-1.5">
          {tree.sessions.length === 0 ? (
            <span className="text-ink-faint">—</span>
          ) : (
            tree.sessions.slice(0, 3).map((session) => (
              <button
                key={session.id}
                type="button"
                title={`${session.title} — ${session.status === 'running' ? 'travaille' : 't’attend'}`}
                onClick={() => openSession(session.id)}
                className={cx(
                  'relative flex size-6 items-center justify-center rounded-md border transition-colors hover:border-line-strong',
                  session.status === 'running' ? 'border-accent/40' : 'border-caution/60 bg-caution/10',
                )}
              >
                <AgentIcon agent={session.agent} size={13} />
                <span className={cx('absolute -top-0.5 -right-0.5 size-1.5 rounded-full', session.status === 'running' ? 'bg-accent' : 'bg-caution')} />
              </button>
            ))
          )}
        </div>

        <div className="flex min-w-0 items-center">
          {tree.pr ? (
            tree.pr.url ? (
              <a href={tree.pr.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 underline-offset-2 hover:underline">
                <span className="tabular-nums text-ink-faint">#{tree.pr.number}</span>
                <Badge tone={PR_LABEL[tree.pr.state].tone}>{PR_LABEL[tree.pr.state].label}</Badge>
              </a>
            ) : (
              <span className="inline-flex items-center gap-1.5">
                <span className="tabular-nums text-ink-faint">#{tree.pr.number}</span>
                <Badge>{PR_LABEL[tree.pr.state].label}</Badge>
              </span>
            )
          ) : (
            <span className="text-ink-faint">{tree.root ? '' : 'pas de PR'}</span>
          )}
        </div>

        {/* La base : avance, retard, et ce qui n'est pas commité. */}
        <div className="flex items-center gap-2 tabular-nums md:justify-end">
          {tree.root ? null : (
            <>
              <span title="Commits propres à la branche" className={cx('inline-flex items-center', tree.ahead ? 'text-ink-soft' : 'text-ink-faint/60')}>
                <ArrowUp size={11} />{tree.ahead}
              </span>
              <span title="Commits de la base qu'elle n'a pas" className={cx('inline-flex items-center', tree.behind > 20 ? 'text-caution' : tree.behind ? 'text-ink-soft' : 'text-ink-faint/60')}>
                <ArrowDown size={11} />{tree.behind}
              </span>
            </>
          )}
          {tree.uncommitted > 0 ? (
            <span title="Fichiers non commités" className="inline-flex items-center gap-0.5 text-caution">
              ●{tree.uncommitted}
            </span>
          ) : null}
        </div>

        <span className={cx('tabular-nums md:text-right', tree.sizeBytes >= HEAVY_BYTES ? 'text-ink' : 'text-ink-soft')}>
          {tree.sizeBytes ? formatBytes(tree.sizeBytes) : '—'}
        </span>

        <span className="tabular-nums text-ink-faint md:text-right">{tree.lastUsedAt ? elapsed(tree.lastUsedAt) : '—'}</span>

        <div className="ml-auto flex items-center justify-end gap-1 md:ml-0">
          {primary ? (
            <Button size="sm" variant="ghost" icon={primary.icon} onClick={primary.run} className="md:hidden">
              {primary.label}
            </Button>
          ) : null}
          <Menu
            trigger={
              <IconButton label={`Gestes sur ${tree.branch ?? tree.name}`} size="sm">
                <MoreHorizontal size={15} />
              </IconButton>
            }
          >
            {primary ? <MenuItem icon={primary.icon} onSelect={primary.run}>{primary.label}</MenuItem> : null}
            {primary ? <MenuSeparator /> : null}
            <MenuItem icon={<Play size={14} />} onSelect={() => openSession(sessionId)}>
              {sessionId ? 'Ouvrir la session' : 'Lancer une session ici'}
            </MenuItem>
            <MenuItem icon={<FileDiff size={14} />} onSelect={openDiff}>Voir le diff</MenuItem>
            {tree.pr?.url ? (
              <MenuItem icon={<ExternalLink size={14} />} onSelect={() => window.open(tree.pr!.url, '_blank', 'noopener')}>
                Ouvrir la PR #{tree.pr.number}
              </MenuItem>
            ) : null}
            {tree.root ? null : (
              <>
                <MenuItem icon={<RefreshCw size={14} />} onSelect={() => onSimulate(`${tree.branch} rebasée sur la base`)}>
                  Rebaser sur la base
                </MenuItem>
                {tree.pr?.state === 'ready' ? (
                  <MenuItem icon={<GitMerge size={14} />} onSelect={() => onSimulate(`PR #${tree.pr!.number} fusionnée`)}>Fusionner la PR</MenuItem>
                ) : null}
                <MenuSeparator />
                <MenuItem icon={<Trash2 size={14} />} tone="critical" onSelect={onClean} disabled={tree.external}>
                  Nettoyer l’arbre
                </MenuItem>
              </>
            )}
          </Menu>
        </div>
      </div>
      {detail ? <div className="mt-3 md:col-span-7 md:mt-1 md:mb-2">{detail}</div> : null}
    </li>
  )
}

/** La confirmation du nettoyage : ce qui part, ce qui se perdrait, ce qu'on libère. */
export function CleanDialog({ trees, onClose, onConfirm }: { trees: TreeRow[] | null; onClose: () => void; onConfirm: (trees: TreeRow[]) => void }) {
  const list = trees ?? []
  const losing = list.filter((tree) => tree.uncommitted > 0 || tree.unmergedCommits)
  const size = list.reduce((sum, tree) => sum + tree.sizeBytes, 0)
  return (
    <ConfirmDialog
      open={trees !== null}
      onOpenChange={(open) => (open ? null : onClose())}
      title={list.length > 1 ? `Nettoyer ${list.length} arbres ?` : 'Nettoyer cet arbre ?'}
      confirmLabel={`Nettoyer — libère ${formatBytes(size)}`}
      tone={losing.length ? 'critical' : 'accent'}
      onConfirm={() => onConfirm(list)}
    >
      <div className="flex flex-col gap-3 text-sm">
        <p className="rounded-md bg-fuchsia-500/10 px-2.5 py-1.5 text-xs text-fuchsia-700 dark:text-fuchsia-300">
          Simulé : rien ne sera supprimé depuis le prototype.
        </p>
        <ul className="flex max-h-56 flex-col gap-1.5 overflow-y-auto">
          {list.map((tree) => (
            <li key={tree.key} className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate font-mono text-xs">{tree.branch ?? tree.name}</span>
              <span className="shrink-0 text-xs tabular-nums text-ink-faint">{formatBytes(tree.sizeBytes)}</span>
            </li>
          ))}
        </ul>
        {losing.length ? (
          <p className="flex items-start gap-2 text-xs text-critical">
            <TriangleAlert size={13} className="mt-px shrink-0" />
            {losing.map((tree) => tree.branch ?? tree.name).join(', ')} : du travail non fusionné ou non commité serait perdu.
          </p>
        ) : (
          <p className="text-xs text-ink-soft">Tout est déjà dans la base : rien ne se perd. Les branches sont supprimées avec leurs arbres, les sessions archivées.</p>
        )}
      </div>
    </ConfirmDialog>
  )
}

/* ------------------------------------------------------------------ branches */

export function Branches({ data }: { data: CodeData }) {
  const [notice, setNotice] = useState<string | null>(null)
  const merged = data.branches.filter((branch) => branch.merged)
  const ordered = [...data.branches].sort((a, b) => Number(a.merged) - Number(b.merged) || a.name.localeCompare(b.name))

  return (
    <section id="branches" aria-labelledby="code-branches" className="flex scroll-mt-4 flex-col gap-4">
      <header className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <h2 id="code-branches" className="text-base font-semibold text-ink">Branches sans arbre</h2>
          <p className="text-sm text-ink-soft">
            Les branches locales qu’aucun worktree n’a extraites{data.base ? `, ${data.base} exceptée` : ''}.
          </p>
        </div>
        <Button
          size="sm"
          variant="secondary"
          className="ml-auto"
          icon={<Trash2 size={14} />}
          disabled={merged.length === 0}
          onClick={() => {
            if (window.confirm(`Simulé : supprimer ${merged.length} branche(s) fusionnée(s) ? Rien ne sera supprimé.`)) {
              setNotice(`Simulé : ${merged.length} branche(s) fusionnée(s) supprimée(s).`)
            }
          }}
        >
          Supprimer les fusionnées {merged.length ? `(${merged.length})` : ''}
        </Button>
      </header>
      {notice ? <p role="status" className="rounded-lg bg-fuchsia-500/10 px-3 py-2 text-xs text-fuchsia-700 dark:text-fuchsia-300">{notice}</p> : null}
      {ordered.length === 0 ? (
        <p className="text-sm text-ink-faint">Aucune : chaque branche locale a son arbre.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line border-y border-line">
          {ordered.map((branch) => (
            <BranchLine key={branch.name} branch={branch} onSimulate={setNotice} />
          ))}
        </ul>
      )}
    </section>
  )
}

function BranchLine({ branch, onSimulate }: { branch: BranchRow; onSimulate: (message: string) => void }) {
  return (
    <li className="flex min-h-11 items-center gap-3 px-1 py-2">
      <span aria-hidden className={cx('size-2 shrink-0 rounded-full', branch.merged ? 'bg-positive' : 'bg-ink-soft')} />
      <GitBranch size={13} className="shrink-0 text-ink-faint" />
      <span className="min-w-0 flex-1 truncate font-mono text-[13px]">{branch.name}</span>
      <span className={cx('hidden text-xs sm:block', branch.merged ? 'text-positive' : 'text-ink-soft')}>
        {branch.merged ? 'fusionnée — supprimable' : 'non fusionnée — du travail dessus'}
      </span>
      <span className="w-16 shrink-0 text-right text-xs tabular-nums text-ink-faint">{branch.lastCommitAt ? elapsed(branch.lastCommitAt) : '—'}</span>
      <Menu
        trigger={
          <IconButton label={`Gestes sur ${branch.name}`} size="sm">
            <MoreHorizontal size={15} />
          </IconButton>
        }
      >
        <MenuItem icon={<Play size={14} />} onSelect={() => onSimulate(`Simulé : un worktree serait créé sur ${branch.name}, avec une session.`)}>
          Ouvrir dans un worktree
        </MenuItem>
        <MenuSeparator />
        <MenuItem icon={<Trash2 size={14} />} tone="critical" onSelect={() => onSimulate(`Simulé : ${branch.name} supprimée${branch.merged ? '' : ' (ses commits non fusionnés seraient perdus)'}.`)}>
          Supprimer la branche
        </MenuItem>
      </Menu>
    </li>
  )
}

/** Variante `worktrees` : les branches derrière un lien discret, dépliées sur demande. */
function BranchesLink({ data }: { data: CodeData }) {
  const [open, setOpen] = useState(false)
  if (data.branches.length === 0) return null
  if (open) return <Branches data={data} />
  const merged = data.branches.filter((branch) => branch.merged).length
  return (
    <button type="button" onClick={() => setOpen(true)} className="self-start text-sm text-ink-faint hover:text-ink">
      {data.branches.length} branche{data.branches.length > 1 ? 's' : ''} sans arbre
      {merged ? `, dont ${merged} fusionnée${merged > 1 ? 's' : ''}` : ''} →
    </button>
  )
}
