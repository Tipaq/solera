/* PROTOTYPE — jetable (branche proto/page-projet). Ne pas fusionner dans main. */
import { ArrowDown, ArrowUp, FileDiff, GitBranch, GitPullRequest, HardDrive, Play, RefreshCw, Trash2, X } from 'lucide-react'
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import type { ConversationDto, JournalEntryDto, JournalKind, ProjectDto } from '@solera/protocol'
import { Badge, Button, cx } from '@solera/ui'
import { AgentIcon } from '../../components/AgentIcon'
import type { InboxItem } from '../../components/prototype/AskInbox'
import { useAllConversations } from '../../lib/conversations'
import { elapsed } from '../../lib/dates'
import { useTranslate } from '../../lib/i18n'
import { JOURNAL_KIND_LABELS, countByFilter, useJournalDays } from '../../lib/journal'
import { openPanelOnArrival } from '../../lib/panel'
import type { ActivityRow } from '../../lib/activity-rows'
import { timeOf, useActivityModel, type ActivityModel } from '../prototype-activity/shared'
import { PR_LABEL, VERDICT_TONE } from '../prototype-code/ProjectCodePage'
import { formatBytes, useCodeData, type CodeData, type TreeRow } from '../prototype-code/data'
import { useProtoHref } from '../prototype-milestones/model'
import { useV2Data } from '../prototype-overview/v2/data'

/* ------------------------------------------------------------------ ce qui relie un arbre à son travail */

export interface TreeScope {
  sessionIds: Set<string>
  cardNumbers: Set<number>
}

/**
 * Le travail d'un arbre : ses sessions (vivantes ou passées, par `worktreeId` ; la racine
 * prend les sessions sans arbre), les cartes de ces sessions, et sa branche dans le
 * texte du journal.
 */
export function scopeOf(tree: TreeRow, conversations: ConversationDto[]): TreeScope {
  const mine = conversations.filter((entry) => (tree.root ? entry.worktreeId === null : entry.worktreeId !== null && entry.worktreeId === tree.id))
  const sessionIds = new Set<string>(mine.map((entry) => entry.id))
  for (const session of tree.sessions) sessionIds.add(session.id)
  if (tree.anySessionId) sessionIds.add(tree.anySessionId)
  const cardNumbers = new Set<number>()
  for (const entry of mine) if (entry.card) cardNumbers.add(entry.card.number)
  if (tree.card) cardNumbers.add(tree.card.number)
  return { sessionIds, cardNumbers }
}

export function rowInTree(row: ActivityRow, tree: TreeRow, scope: TreeScope): boolean {
  if (scope.sessionIds.has(row.entry.conversation.id)) return true
  if (tree.root) return row.place.root
  return row.place.path === tree.path || (tree.branch !== null && row.place.branch === tree.branch)
}

export function entryInTree(entry: JournalEntryDto, tree: TreeRow, scope: TreeScope): boolean {
  if (entry.conversationId && scope.sessionIds.has(entry.conversationId)) return true
  if (entry.cardNumber !== null && scope.cardNumbers.has(entry.cardNumber)) return true
  // La racine ne se cherche pas par son nom : « main » figure dans presque toute fusion.
  return !tree.root && tree.branch !== null && entry.title.includes(tree.branch)
}

export function inboxInTree(item: InboxItem, scope: TreeScope): boolean {
  // Les demandes d'un jalon (affinage, brouillon, PR finale) ne vivent dans aucun arbre.
  if (item.kind !== 'session') return false
  if (item.cardNumber !== null && scope.cardNumbers.has(item.cardNumber)) return true
  return [...scope.sessionIds].some((id) => item.open.includes(id))
}

export function useConversationsOf(projectId: string): ConversationDto[] {
  const { data } = useAllConversations()
  return useMemo(() => (data ?? []).filter((entry) => entry.projectId === projectId), [data, projectId])
}

/* ------------------------------------------------------------------ l'historique de démo */

/**
 * SIMULÉ : en démo, les arbres de Code sont inventés et ne retrouvent rien du vrai
 * journal. On leur écrit un petit historique cohérent (carte ouverte, session, poussées,
 * fusion), et un peu d'historique « Projet » lié à aucun arbre, pour que les variantes se
 * jugent sur un fil plein. Les vraies sessions vivantes sont retirées : elles parleraient
 * d'autres arbres que ceux de la démo.
 */
function demoHistory(projectId: string, code: CodeData): JournalEntryDto[] {
  const now = Date.now()
  const hour = 3_600_000
  const day = 24 * hour
  const out: JournalEntryDto[] = []
  const push = (id: string, kind: JournalKind, at: number, title: string, extra: Partial<JournalEntryDto> = {}) =>
    out.push({ id, kind, at, title, projectId, cardNumber: null, source: null, count: null, status: null, conversationId: null, ...extra })

  for (const tree of code.trees) {
    if (tree.root || tree.verdict === 'missing') continue
    const branch = tree.branch ?? tree.name
    const last = tree.lastUsedAt ?? now - day
    const card = tree.card?.number ?? null
    const agent = tree.sessions[0]?.agent ?? 'claude'
    if (card !== null) push(`demo-j-${tree.key}-open`, 'cardOpened', last - 2 * day, tree.card!.title, { cardNumber: card })
    push(`demo-j-${tree.key}-session`, 'session', last - 1.5 * day, `Session lancée dans ${branch}`, { cardNumber: card, source: agent })
    if (tree.ahead > 0 || tree.state === 'merged') {
      push(`demo-j-${tree.key}-push`, 'branch', last - 4 * hour, `${branch} : commits poussés`, { cardNumber: card, count: Math.max(tree.ahead, 2) })
    }
    if (tree.pr && tree.pr.state !== 'merged') {
      push(`demo-j-${tree.key}-pr`, 'branch', last - 1 * hour, `PR #${tree.pr.number} ouverte depuis ${branch}`, { cardNumber: card })
    }
    if (tree.state === 'merged' || tree.pr?.state === 'merged') {
      push(`demo-j-${tree.key}-merge`, 'branch', last, `${branch} fusionnée dans main`, { cardNumber: card })
      if (card !== null) push(`demo-j-${tree.key}-close`, 'cardClosed', last + 0.2 * hour, tree.card!.title, { cardNumber: card, count: 1 })
    }
    if (tree.verdict === 'waiting') {
      push(`demo-j-${tree.key}-note`, 'note', last - 0.3 * hour, `Question posée sur ${branch} : compatibilité de l’ancien format`, { cardNumber: card, source: agent })
    }
  }

  // Ce qui ne vit dans aucun arbre : le couloir « Projet ».
  push('demo-j-p-note', 'note', now - 3 * hour, 'Décision : les worktrees fusionnés se nettoient depuis l’onglet Travail', { source: 'Tim' })
  push('demo-j-p-audit', 'audit', now - 1.2 * day, 'Audit de la page projet versé dans docs/audits')
  push('demo-j-p-close', 'cardClosed', now - 2.5 * day, 'Jalon « Accès distant » livré', { count: 4 })
  push('demo-j-p-open', 'cardOpened', now - 4 * day, 'Idée : mode hors ligne complet')
  return out.sort((a, b) => b.at - a.at)
}

/* ------------------------------------------------------------------ le modèle de l'onglet */

/** Le modèle du fil avec d'autres lignes (démo, ou un arbre) : les jours et totaux suivent. */
export function useModelWith(model: ActivityModel, live: ActivityRow[], entries: JournalEntryDto[], same: boolean, keepRuns: boolean): ActivityModel {
  const days = useJournalDays(entries, model.kind)
  if (same) return model
  return {
    ...model,
    runs: keepRuns ? model.runs : [],
    live,
    liveByGroup: (group) => live.filter((row) => row.group === group),
    entries,
    days,
    totals: countByFilter(entries),
  }
}

/**
 * Tout ce que les variantes de Travail lisent : le fil (démo comprise), les arbres, les
 * demandes, et pour chaque ligne l'arbre qui la porte.
 */
export function useTravail(projectId: string, project: ProjectDto) {
  const raw = useActivityModel()
  const code = useCodeData(projectId, project)
  const overview = useV2Data(projectId, project)
  const conversations = useConversationsOf(projectId)

  const demoEntries = useMemo(() => (code.demo ? demoHistory(projectId, code) : null), [code, projectId])
  // La recherche du fil s'applique aussi à l'historique simulé.
  const query = raw.query.trim().toLowerCase()
  const demoFiltered = useMemo(
    () => (demoEntries && query ? demoEntries.filter((entry) => `${entry.title} #${entry.cardNumber ?? ''}`.toLowerCase().includes(query)) : demoEntries),
    [demoEntries, query],
  )
  const noLive = useMemo<ActivityRow[]>(() => [], [])
  const model = useModelWith(raw, code.demo ? noLive : raw.live, demoFiltered ?? raw.entries, !code.demo, !code.demo)

  const scopes = useMemo(() => new Map(code.trees.map((tree) => [tree.key, scopeOf(tree, conversations)])), [code.trees, conversations])

  /** L'arbre d'une ligne : un arbre de travail d'abord, la racine seulement à défaut. */
  const treeOfEntry = (entry: JournalEntryDto): TreeRow | null => {
    const ordered = [...code.trees.filter((tree) => !tree.root), ...code.trees.filter((tree) => tree.root)]
    return ordered.find((tree) => entryInTree(entry, tree, scopes.get(tree.key)!)) ?? null
  }
  const treeOfRow = (row: ActivityRow): TreeRow | null => {
    const ordered = [...code.trees.filter((tree) => !tree.root), ...code.trees.filter((tree) => tree.root)]
    return ordered.find((tree) => rowInTree(row, tree, scopes.get(tree.key)!)) ?? null
  }

  return { model, code, overview, conversations, scopes, treeOfEntry, treeOfRow }
}

export type Travail = ReturnType<typeof useTravail>

/** Le fil restreint à un arbre ; tel quel sans arbre. */
export function useScopedModel(model: ActivityModel, tree: TreeRow | null, scope: TreeScope | null): ActivityModel {
  const live = useMemo(() => (tree && scope ? model.live.filter((row) => rowInTree(row, tree, scope)) : model.live), [model.live, tree, scope])
  const entries = useMemo(() => (tree && scope ? model.entries.filter((entry) => entryInTree(entry, tree, scope)) : model.entries), [model.entries, tree, scope])
  // Le bandeau d'un jalon lancé parle de tout le projet, pas d'un arbre.
  return useModelWith(model, live, entries, !tree, false)
}

/** L'arbre choisi, porté par l'adresse (`?arbre=`), pour qu'un rechargement le garde. */
export function useTreeSelection(code: CodeData) {
  const [params, setParams] = useSearchParams()
  const key = params.get('arbre')
  const tree = code.trees.find((entry) => entry.key === key) ?? null
  const select = (next: string | null) =>
    setParams((current) => {
      if (next && next !== key) current.set('arbre', next)
      else current.delete('arbre')
      return current
    })
  return { tree, select }
}

/* ------------------------------------------------------------------ petites pièces */

/** Le nom court d'une branche : le préfixe `feat/` ne dit rien qu'on ne voie déjà. */
export function shortBranch(tree: TreeRow): string {
  const name = tree.branch ?? tree.name
  return name.replace(/^(feat|fix|spike|chore)\//, '')
}

/**
 * La puce d'arbre d'une ligne du fil : son point de verdict et sa branche. Un clic filtre
 * le fil sur l'arbre. Un `span` qui agit, et non un bouton : elle vit souvent dans une
 * ligne qui est déjà un lien.
 */
export function TreeChip({ tree, active, onSelect }: { tree: TreeRow; active?: boolean; onSelect: (key: string) => void }) {
  const tone = VERDICT_TONE[tree.verdict]
  const run = (event: { preventDefault: () => void; stopPropagation: () => void }) => {
    event.preventDefault()
    event.stopPropagation()
    onSelect(tree.key)
  }
  return (
    <span
      role="button"
      tabIndex={0}
      title={`Filtrer le fil sur ${tree.branch ?? tree.name}`}
      onClick={run}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') run(event)
      }}
      className={cx(
        'inline-flex h-5 max-w-[11rem] shrink items-center gap-1 rounded px-1.5 font-mono text-[11px] transition-colors',
        active ? 'bg-accent-wash text-ink' : 'bg-sunken text-ink-soft hover:bg-surface-high hover:text-ink',
      )}
    >
      <span aria-hidden className={cx('size-1.5 shrink-0 rounded-full', tone.dot)} />
      <span className="min-w-0 truncate">{shortBranch(tree)}</span>
    </span>
  )
}

/** La pastille du filtre en place : « Arbre : feat/… ✕ ». */
export function TreeFilterPill({ tree, onClear }: { tree: TreeRow; onClear: () => void }) {
  const tone = VERDICT_TONE[tree.verdict]
  return (
    <button
      type="button"
      onClick={onClear}
      title="Revenir à tout le fil"
      className="inline-flex h-7 min-w-0 shrink items-center gap-1.5 rounded-md bg-accent-wash px-2 text-xs text-ink hover:bg-accent-wash/70"
    >
      <span aria-hidden className={cx('size-1.5 shrink-0 rounded-full', tone.dot)} />
      <span className="hidden text-ink-soft sm:inline">Arbre :</span>
      <span className="min-w-0 truncate font-mono">{tree.branch ?? tree.name}</span>
      <X size={12} className="shrink-0 text-ink-faint" />
    </button>
  )
}

/** Les sessions vivantes d'un arbre, en icônes : ambre quand elles attendent. */
export function SessionDots({ tree, max = 3 }: { tree: TreeRow; max?: number }) {
  if (tree.sessions.length === 0) return null
  return (
    <span className="flex shrink-0 gap-0.5">
      {tree.sessions.slice(0, max).map((session) => (
        <span
          key={session.id}
          title={`${session.title} — ${session.status === 'running' ? 'travaille' : 't’attend'}`}
          className={cx('flex size-5 items-center justify-center rounded', session.status === 'running' ? 'text-accent' : 'bg-caution/15 text-caution')}
        >
          <AgentIcon agent={session.agent} size={12} />
        </span>
      ))}
    </span>
  )
}

/** Les faits d'un arbre en une ligne : base, non commités, PR, taille. */
export function TreeFacts({ tree, className }: { tree: TreeRow; className?: string }) {
  return (
    <span className={cx('flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs tabular-nums text-ink-faint', className)}>
      {tree.pr ? (
        <Badge tone={PR_LABEL[tree.pr.state].tone}>
          #{tree.pr.number} {PR_LABEL[tree.pr.state].label}
        </Badge>
      ) : null}
      {tree.root ? null : (
        <span className="inline-flex items-center gap-1">
          <span className="inline-flex items-center"><ArrowUp size={11} />{tree.ahead}</span>
          <span className={cx('inline-flex items-center', tree.behind > 20 && 'text-caution')}><ArrowDown size={11} />{tree.behind}</span>
        </span>
      )}
      {tree.uncommitted > 0 ? <span className="text-caution">●{tree.uncommitted}</span> : null}
      {tree.sizeBytes ? (
        <span className="inline-flex items-center gap-1">
          <HardDrive size={11} />
          {formatBytes(tree.sizeBytes)}
        </span>
      ) : null}
    </span>
  )
}

/** Le bilan des arbres, en une phrase : ce qu'on vient chercher. */
export function TreeSummary({ code, className }: { code: CodeData; className?: string }) {
  const count = code.trees.filter((tree) => !tree.root).length
  const total = code.trees.reduce((sum, tree) => sum + tree.sizeBytes, 0)
  const cleanable = code.trees.filter((tree) => tree.verdict === 'clean' && !tree.root)
  const cleanableSize = cleanable.reduce((sum, tree) => sum + tree.sizeBytes, 0)
  return (
    <p className={cx('flex flex-wrap items-center gap-x-1.5 text-xs text-ink-soft', className)}>
      <span className="tabular-nums">{count} arbre{count > 1 ? 's' : ''}</span>
      <span aria-hidden className="text-ink-faint">·</span>
      <span className="inline-flex items-center gap-1 tabular-nums">
        <HardDrive size={12} className="text-ink-faint" />
        {formatBytes(total)}
        <span title="L’API ne mesure pas encore la taille d’un arbre : valeur inventée" className="text-[10px] font-medium tracking-wide text-fuchsia-700 uppercase dark:text-fuchsia-300">
          sim.
        </span>
      </span>
      {cleanable.length > 0 ? (
        <>
          <span aria-hidden className="text-ink-faint">·</span>
          <span className="tabular-nums">
            {cleanable.length} à nettoyer ({formatBytes(cleanableSize)})
          </span>
        </>
      ) : null}
    </p>
  )
}

/**
 * Les gestes de Travail `une-ligne`, tenus par la page : un seul retour pour tout ce qui
 * est simulé (au même endroit, de la même façon), un seul dialogue de nettoyage, et
 * l'ouverture du tiroir d'un arbre. Hors de cette page, chaque composant garde son
 * comportement d'avant (retour local, confirmation du navigateur).
 */
export interface TravailActions {
  simulate: (message: string) => void
  cleanTrees: (trees: TreeRow[]) => void
  cleanBranches: (names: string[]) => void
  openTree: (key: string) => void
}
export const TravailActionsContext = createContext<TravailActions | null>(null)
export const useTravailActions = () => useContext(TravailActionsContext)

/** Les gestes d'un arbre. Rebaser et nettoyer restent simulés, comme dans Code. */
export function useTreeActions(projectId: string, tree: TreeRow, demo: boolean) {
  const navigate = useNavigate()
  const href = useProtoHref()
  const page = useTravailActions()
  const [notice, setNotice] = useState<string | null>(null)
  const sessionId = tree.sessions.find((session) => session.status !== 'running')?.id ?? tree.sessions[0]?.id ?? tree.anySessionId
  const simulate = (message: string) => {
    if (page) return page.simulate(message)
    setNotice(`Simulé : ${message}`)
    window.setTimeout(() => setNotice((current) => (current === `Simulé : ${message}` ? null : current)), 4_000)
  }

  const actions: { key: string; label: string; icon: ReactNode; run: () => void; tone?: 'critical' }[] = [
    {
      key: 'session',
      label: sessionId ? 'Session' : 'Lancer une session',
      icon: <Play size={13} />,
      run: () =>
        demo
          ? simulate('la session s’ouvrirait ici')
          : navigate(sessionId ? `/p/${projectId}/c/${sessionId}` : href(`/p/${projectId}/c/new${tree.id ? `?worktree=${tree.id}` : ''}`)),
    },
    {
      key: 'diff',
      label: 'Diff',
      icon: <FileDiff size={13} />,
      run: () => {
        if (demo) return simulate('le panneau git s’ouvrirait sur le diff de cet arbre')
        const path = sessionId ? `/p/${projectId}/c/${sessionId}` : `/p/${projectId}/travail`
        openPanelOnArrival(path, 'git')
        navigate(path)
      },
    },
    ...(tree.pr?.url ? [{ key: 'pr', label: `PR #${tree.pr.number}`, icon: <GitPullRequest size={13} />, run: () => window.open(tree.pr!.url, '_blank', 'noopener') }] : []),
    ...(tree.root
      ? []
      : [
          { key: 'rebase', label: 'Rebaser', icon: <RefreshCw size={13} />, run: () => simulate(`${tree.branch} rebasée sur la base`) },
          {
            key: 'clean',
            label: 'Nettoyer',
            icon: <Trash2 size={13} />,
            tone: 'critical' as const,
            run: () => {
              if (page) return page.cleanTrees([tree])
              if (window.confirm(`Nettoyer ${tree.branch ?? tree.name} ? (simulé, rien ne sera supprimé)`)) simulate(`${tree.branch} nettoyé, ${formatBytes(tree.sizeBytes)} libérés`)
            },
          },
        ]),
  ]
  return { actions, notice }
}

export function Notice({ text }: { text: string | null }) {
  if (!text) return null
  return <p role="status" className="rounded-md bg-fuchsia-500/10 px-2.5 py-1.5 text-xs text-fuchsia-700 dark:text-fuchsia-300">{text}</p>
}

/** Les gestes en boutons, pour une carte d'arbre dépliée. */
export function TreeActionButtons({ projectId, tree, demo }: { projectId: string; tree: TreeRow; demo: boolean }) {
  const { actions, notice } = useTreeActions(projectId, tree, demo)
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1.5">
        {actions.map((action) => (
          <Button key={action.key} size="sm" variant="secondary" icon={action.icon} onClick={action.run} className={action.tone === 'critical' ? 'text-critical' : undefined}>
            {action.label}
          </Button>
        ))}
      </div>
      <Notice text={notice} />
    </div>
  )
}

/** Un arbre déplié : ses sessions, vivantes puis passées, et ses dernières lignes de journal. */
export function TreeDetail({
  projectId,
  tree,
  model,
  conversations,
  demo,
  limit = 6,
}: {
  projectId: string
  tree: TreeRow
  model: ActivityModel
  conversations: ConversationDto[]
  demo: boolean
  limit?: number
}) {
  const t = useTranslate()
  const href = useProtoHref()
  const scope = useMemo(() => scopeOf(tree, conversations), [tree, conversations])
  const live = new Set(tree.sessions.map((session) => session.id))
  const sessions = conversations
    .filter((entry) => scope.sessionIds.has(entry.id))
    .sort((a, b) => Number(live.has(b.id)) - Number(live.has(a.id)) || b.updatedAt - a.updatedAt)
    .slice(0, limit)
  const entries = model.entries.filter((entry) => entryInTree(entry, tree, scope)).slice(0, limit)

  return (
    <div className="grid gap-4 rounded-lg bg-surface/60 p-3 md:grid-cols-2">
      <section className="flex min-w-0 flex-col gap-1.5">
        <h4 className="text-meta font-medium tracking-wide text-ink-faint uppercase">Sessions</h4>
        {sessions.length === 0 && tree.sessions.length === 0 ? (
          <p className="text-xs text-ink-faint">Aucune session vivante dans cet arbre.</p>
        ) : (
          <ul className="flex flex-col">
            {(sessions.length > 0 ? sessions.map((entry) => ({ id: entry.id, title: entry.title, agent: entry.agent, at: entry.updatedAt })) : tree.sessions.map((entry) => ({ id: entry.id, title: entry.title, agent: entry.agent, at: null as number | null }))).map((session) => {
              const alive = tree.sessions.find((entry) => entry.id === session.id)
              return (
                <li key={session.id}>
                  <Link
                    to={demo ? '#' : href(`/p/${projectId}/c/${session.id}`)}
                    className="flex min-h-8 min-w-0 items-center gap-2 rounded-md px-1.5 text-sm hover:bg-surface-high"
                  >
                    <AgentIcon agent={session.agent} size={13} />
                    <span className="min-w-0 flex-1 truncate">{session.title}</span>
                    {alive ? (
                      <span className={cx('shrink-0 text-xs', alive.status === 'running' ? 'text-ink-soft' : 'text-caution')}>
                        {alive.status === 'running' ? 'tourne' : 't’attend'}
                      </span>
                    ) : (
                      <span className="shrink-0 text-xs tabular-nums text-ink-faint">{session.at ? elapsed(session.at) : ''}</span>
                    )}
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </section>
      <section className="flex min-w-0 flex-col gap-1.5">
        <h4 className="text-meta font-medium tracking-wide text-ink-faint uppercase">Historique</h4>
        {entries.length === 0 ? (
          <p className="text-xs text-ink-faint">Rien ces {model.journalDays || 30} derniers jours.</p>
        ) : (
          <ul className="flex flex-col">
            {entries.map((entry) => {
              const to = model.entryHref(entry)
              const body = (
                <>
                  <span className="w-12 shrink-0 text-xs tabular-nums text-ink-faint">{elapsed(entry.at)}</span>
                  <span className="shrink-0 text-meta font-medium tracking-wide text-ink-faint uppercase">{t(JOURNAL_KIND_LABELS[entry.kind])}</span>
                  <span className="min-w-0 flex-1 truncate">{entry.title}</span>
                </>
              )
              const shape = 'flex min-h-8 min-w-0 items-center gap-2 rounded-md px-1.5 text-sm'
              return (
                <li key={entry.id}>
                  {to ? <Link to={to} className={cx(shape, 'hover:bg-surface-high')}>{body}</Link> : <div className={shape}>{body}</div>}
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}

/** L'arbre choisi, en tête du fil : son verdict, sa base, sa PR, ses gestes. */
export function TreeCard({ projectId, tree, demo, onClose }: { projectId: string; tree: TreeRow; demo: boolean; onClose: () => void }) {
  const href = useProtoHref()
  const tone = VERDICT_TONE[tree.verdict]
  return (
    <section className="flex flex-col gap-3 rounded-lg p-3 ring-1 ring-line">
      <div className="flex min-w-0 items-start gap-2.5">
        <span aria-hidden className={cx('mt-1.5 size-2 shrink-0 rounded-full', tone.dot)} />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <GitBranch size={13} className="shrink-0 text-ink-faint" />
            <span className="min-w-0 truncate font-mono text-sm font-medium">{tree.branch ?? tree.name}</span>
            <span className={cx('text-xs font-medium', tone.text)}>{tone.label}</span>
          </div>
          <p className={cx('text-xs', tone.text)}>{tree.reason}</p>
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
            <TreeFacts tree={tree} />
            {tree.card ? (
              <Link to={href(`?fiche=${tree.card.number}`)} className="min-w-0 truncate text-xs text-ink-faint hover:text-ink">
                #{tree.card.number} {tree.card.title}
              </Link>
            ) : null}
          </div>
        </div>
        <button type="button" onClick={onClose} className="flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-xs text-ink-faint hover:bg-surface-high hover:text-ink">
          Tout le fil <X size={12} />
        </button>
      </div>
      <TreeActionButtons projectId={projectId} tree={tree} demo={demo} />
    </section>
  )
}

export { timeOf }
