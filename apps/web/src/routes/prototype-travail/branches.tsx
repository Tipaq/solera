/* PROTOTYPE — jetable (branche proto/page-projet). Ne pas fusionner dans main.
 *
 * Les branches git dans Travail (Tim, 2026-11-11 : « on voit les worktrees mais pas trop
 * les branches git »). Ce que l'API donne vraiment, et ce qui est simulé :
 *
 * - `WorktreeStatusListDto.branches` : les branches **locales** sans arbre, avec `merged`
 *   (jugé sur le contenu ou sur une PR fusionnée), et `base`, la branche de comparaison ;
 * - `usePullRequests` : la PR d'une branche, par son nom (état, checks, revue) ;
 * - `useBranches` : les noms des branches locales et la branche extraite à la racine,
 *   rien de plus ;
 * - `ProjectDto.git.branch` : la branche extraite dans le dossier du projet.
 *
 * SIMULÉ, faute d'API : la date du dernier commit, l'avance et le retard sur la base, les
 * derniers commits d'une branche sans arbre, et les branches **distantes** seules (démo).
 * Tout ce qui est simulé est déterministe (tiré du nom) et marqué.
 */
import { ArrowUpRight, Check, ChevronRight, FileDiff, FolderPlus, GitBranch, GitCommitHorizontal, GitPullRequest, MessageSquarePlus, Trash2, TriangleAlert, Cloud } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import type { CardDto, ProjectDto, ProjectPullRequestDto, PullRequestBadgeState } from '@solera/protocol'
import { Badge, cx } from '@solera/ui'
import { elapsed } from '../../lib/dates'
import { usePullRequests } from '../../lib/pull-requests'
import { PR_LABEL } from '../prototype-code/ProjectCodePage'
import type { CodeData } from '../prototype-code/data'
import { useProtoData, useProtoHref } from '../prototype-milestones/model'
import { useTravailActions } from './shared'

const DAY = 86_400_000

export type BranchKind = 'pr' | 'unmerged' | 'remote' | 'merged'

export interface BranchInfo {
  key: string
  name: string
  kind: BranchKind
  merged: boolean
  remoteOnly: boolean
  lastCommitAt: number
  /** Vrai quand la date vient de la simulation, pas de l'API. */
  lastCommitSimulated: boolean
  /** SIMULÉ toujours : l'API ne compare pas une branche sans arbre à la base. */
  ahead: number
  behind: number
  commits: { hash: string; title: string; at: number }[]
  pr: { number: number; url: string; state: PullRequestBadgeState; title: string } | null
  card: { number: number; title: string; milestone: { number: number; title: string } | null } | null
}

export const BRANCH_TONE: Record<BranchKind, { dot: string; text: string; label: string }> = {
  pr: { dot: 'bg-accent', text: 'text-ink-soft', label: 'PR ouverte' },
  unmerged: { dot: 'bg-ink-soft', text: 'text-ink-soft', label: 'du travail non fusionné' },
  remote: { dot: 'bg-sky-400', text: 'text-ink-soft', label: 'distante seulement' },
  merged: { dot: 'bg-positive', text: 'text-ink-soft', label: 'fusionnée, supprimable' },
}

/** Un nombre stable tiré du nom : la simulation ne bouge pas d'un rendu à l'autre. */
function seed(name: string, salt = 0): number {
  let hash = 2166136261 ^ salt
  for (let index = 0; index < name.length; index += 1) {
    hash ^= name.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return Math.abs(hash)
}

const COMMIT_WORDS = [
  'Ajoute le modèle',
  'Branche la route',
  'Corrige le cas vide',
  'Renomme les clés',
  'Teste le cas limite',
  'Rend la ligne lisible au téléphone',
  'Retire le code mort',
  'Documente le choix',
]

function simulatedCommits(name: string, count: number, last: number): BranchInfo['commits'] {
  return Array.from({ length: Math.min(count, 3) }, (_, index) => ({
    hash: (seed(name, index + 7) % 0xfffffff).toString(16).padStart(7, '0').slice(0, 7),
    title: `${COMMIT_WORDS[seed(name, index) % COMMIT_WORDS.length]} — ${name.split('/').pop()?.replace(/^\d+-/, '').replace(/-/g, ' ')}`,
    at: last - index * (3 + (seed(name, index + 3) % 20)) * 3_600_000,
  }))
}

/** `feat/153-titre` → 153 : la carte se devine du nom, rien ne la stocke. */
export function cardNumberOf(name: string): number | null {
  const match = name.match(/\/(\d+)-/)
  return match ? Number(match[1]) : null
}

function demoPullRequests(): Map<string, NonNullable<BranchInfo['pr']>> {
  return new Map<string, NonNullable<BranchInfo['pr']>>([
    ['feat/908-actions-hub', { number: 133, url: 'https://github.com/Tipaq/solera/pull/133', state: 'checks', title: 'Actions : un seul foyer, le hub ⚡' }],
    ['fix/931-badge-pr', { number: 135, url: 'https://github.com/Tipaq/solera/pull/135', state: 'draft', title: 'Badge de PR : l’état de la revue' }],
    ['feat/842-palette', { number: 101, url: 'https://github.com/Tipaq/solera/pull/101', state: 'merged', title: 'Palette de commandes' }],
  ])
}

/**
 * Les branches sans arbre, enrichies de leur PR, de leur carte devinée et de ce que
 * l'API ne donne pas encore (simulé). Triées : PR ouverte, travail non fusionné récent,
 * distantes, puis fusionnées.
 */
export function useBranchInfos(projectId: string, project: ProjectDto, code: CodeData): BranchInfo[] {
  const { data: pullRequests } = usePullRequests(project.git && !code.demo ? projectId : undefined)
  const proto = useProtoData(projectId)

  return useMemo(() => {
    const now = Date.now()
    const byNumber = new Map(proto.cards.map((card) => [card.number, card]))
    const cardById = new Map(proto.cards.map((card) => [card.id, card]))
    const demoPrs = code.demo ? demoPullRequests() : null
    const realPr = (name: string): BranchInfo['pr'] => {
      const pr: ProjectPullRequestDto | undefined = pullRequests?.available ? pullRequests.pullRequests.find((entry) => entry.branch === name) : undefined
      return pr ? { number: pr.number, url: pr.url, state: pr.state, title: pr.title } : null
    }

    const cardOf = (name: string): BranchInfo['card'] => {
      const number = cardNumberOf(name)
      const card: CardDto | undefined = number === null ? undefined : byNumber.get(number)
      if (!card) return null
      const parent = card.parent ? cardById.get(card.parent.id) : undefined
      return { number: card.number, title: card.title, milestone: parent ? { number: parent.number, title: parent.title } : card.children.length > 0 ? { number: card.number, title: card.title } : null }
    }

    const infos = code.branches.map<BranchInfo>((branch) => {
      const pr = demoPrs ? (demoPrs.get(branch.name) ?? null) : realPr(branch.name)
      const remoteOnly = Boolean(branch.remoteOnly)
      const openPr = pr !== null && pr.state !== 'merged'
      const kind: BranchKind = branch.merged ? 'merged' : openPr ? 'pr' : remoteOnly ? 'remote' : 'unmerged'
      const lastCommitAt = branch.lastCommitAt ?? now - (1 + (seed(branch.name, 1) % 40)) * DAY
      const ahead = branch.merged ? 0 : 1 + (seed(branch.name, 2) % 9)
      const behind = seed(branch.name, 3) % 30
      return {
        key: `branche:${branch.name}`,
        name: branch.name,
        kind,
        merged: branch.merged,
        remoteOnly,
        lastCommitAt,
        lastCommitSimulated: branch.lastCommitAt === null,
        ahead,
        behind,
        commits: simulatedCommits(branch.name, Math.max(ahead, 1), lastCommitAt),
        pr,
        card: cardOf(branch.name),
      }
    })
    const order: BranchKind[] = ['pr', 'unmerged', 'remote', 'merged']
    return infos.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || b.lastCommitAt - a.lastCommitAt)
  }, [code, pullRequests, proto.cards])
}

/** Une branche « intéressante » a son couloir : du travail dessus, ou une PR ouverte. */
export function isInteresting(branch: BranchInfo): boolean {
  return branch.kind !== 'merged'
}

export function BranchSim({ title }: { title: string }) {
  return (
    <span title={title} className="rounded bg-fuchsia-500/15 px-1 text-[10px] font-medium tracking-wide text-fuchsia-700 uppercase dark:text-fuchsia-300">
      simulé
    </span>
  )
}

/* ------------------------------------------------------------------ la base */

/**
 * La branche par défaut, et la racine du projet si elle n'est pas dessus : c'est là
 * qu'on retrouve ce que la pastille de la bande disait de travers.
 */
export function BaseCard({ code, branches, compact = false }: { code: CodeData; branches: BranchInfo[]; compact?: boolean }) {
  const root = code.trees.find((tree) => tree.root) ?? null
  const base = code.base
  // En démo, la racine est sur `main` : on montre le cas qui compte, celui de Tim.
  const rootBranch = code.demo ? 'feat/repointage' : (root?.branch ?? null)
  const off = base !== null && rootBranch !== null && rootBranch !== base
  const unmerged = branches.filter((branch) => branch.kind !== 'merged').length
  const trees = code.trees.filter((tree) => !tree.root).length

  if (!base) return null
  // Compacte (Travail `une-ligne`) : une ligne, l'alerte seulement quand la racine a quitté la base.
  if (compact) {
    return (
      <p className={cx('flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs', off ? 'text-caution' : 'text-ink-faint')}>
        <GitBranch size={12} className="shrink-0" />
        <span>
          Base <code className="font-mono text-[12px] font-semibold text-ink">{base}</code>
        </span>
        {off ? (
          <>
            <span aria-hidden>·</span>
            <TriangleAlert size={12} className="shrink-0" />
            <span>
              la racine est sur <code className="font-mono text-[12px] font-semibold">{rootBranch}</code>
              {root && root.uncommitted > 0 ? `, ${root.uncommitted} fichier${root.uncommitted > 1 ? 's' : ''} non commité${root.uncommitted > 1 ? 's' : ''}` : ''}
            </span>
            {code.demo ? <BranchSim title="En démo, la racine est déplacée pour montrer ce cas" /> : null}
          </>
        ) : (
          <>
            <span aria-hidden>·</span>
            <Check size={12} className="shrink-0 text-positive" /> la racine y est
          </>
        )}
      </p>
    )
  }
  return (
    <section
      className={cx(
        'flex flex-col gap-2 rounded-xl px-4 py-3 ring-1',
        off ? 'bg-caution/5 ring-caution/40' : 'bg-surface/40 ring-line',
      )}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-xs font-medium tracking-wide text-ink-faint uppercase">Base</span>
        <span className="inline-flex items-center gap-1.5 font-mono text-[13px] font-semibold">
          <GitBranch size={13} className="text-ink-faint" />
          {base}
        </span>
        <span className="text-xs text-ink-faint tabular-nums">
          {trees} arbre{trees > 1 ? 's' : ''} · {branches.length} branche{branches.length > 1 ? 's' : ''} sans arbre, dont {unmerged} avec du travail
        </span>
      </div>
      {off ? (
        <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm text-caution">
          <TriangleAlert size={14} className="shrink-0" />
          <span>
            La racine du projet est sur <code className="font-mono text-[13px] font-semibold">{rootBranch}</code>, pas sur{' '}
            <code className="font-mono text-[13px]">{base}</code>
            {root && root.uncommitted > 0 ? `, avec ${root.uncommitted} fichier${root.uncommitted > 1 ? 's' : ''} non commité${root.uncommitted > 1 ? 's' : ''}` : ''}.
          </span>
          <span className="text-xs text-ink-faint">Les sessions sans worktree y travaillent.</span>
          {code.demo ? <BranchSim title="En démo, la racine est déplacée pour montrer ce cas" /> : null}
        </p>
      ) : (
        <p className="flex items-center gap-1.5 text-xs text-ink-faint">
          <Check size={12} className="text-positive" /> La racine du projet est sur {base}.
        </p>
      )}
    </section>
  )
}

/* ------------------------------------------------------------------ l'index */

export function IndexBranch({ branch, className, onClick }: { branch: BranchInfo; className: string; onClick: () => void }) {
  const tone = BRANCH_TONE[branch.kind]
  return (
    <button type="button" onClick={onClick} className={className} title={branch.name}>
      <span aria-hidden className={cx('mt-1.5 size-2 shrink-0 rounded-full', tone.dot)} />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 items-center gap-1.5">
          {branch.remoteOnly ? <Cloud size={12} className="shrink-0 text-ink-faint" /> : <GitBranch size={12} className="shrink-0 text-ink-faint" />}
          <span className="min-w-0 truncate font-mono text-[13px]">{branch.name}</span>
        </span>
        <span className={cx('min-w-0 truncate text-xs', tone.text)}>
          {branch.pr && branch.kind === 'pr' ? `PR #${branch.pr.number} · ${PR_LABEL[branch.pr.state].label}` : tone.label}
        </span>
        {branch.card ? (
          <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-ink-faint">
            <span className="min-w-0 truncate">#{branch.card.number} {branch.card.title}</span>
            {branch.card.milestone && branch.card.milestone.number !== branch.card.number ? (
              <span className="shrink-0 rounded bg-surface-high px-1.5 py-px">Jalon #{branch.card.milestone.number}</span>
            ) : null}
          </span>
        ) : null}
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1 text-xs tabular-nums text-ink-faint">
        <span>{elapsed(branch.lastCommitAt)}</span>
        {branch.merged ? null : (
          <span>
            ↑{branch.ahead} ↓{branch.behind}
          </span>
        )}
      </span>
    </button>
  )
}

/* ------------------------------------------------------------------ le couloir */

export function BranchLane({
  projectId,
  branch,
  demo,
  anchorId,
  highlight = false,
}: {
  projectId: string
  branch: BranchInfo
  demo: boolean
  anchorId?: string
  highlight?: boolean
}) {
  const tone = BRANCH_TONE[branch.kind]
  const href = useProtoHref()
  const navigate = useNavigate()
  const page = useTravailActions()
  const [notice, setNotice] = useState<string | null>(null)
  const simulate = (text: string) => (page ? page.simulate(text) : setNotice(`Simulé : ${text}`))

  const gestures: { key: string; label: string; icon: ReactNode; run: () => void; tone?: 'critical' }[] = [
    { key: 'tree', label: 'Ouvrir dans un worktree', icon: <FolderPlus size={13} />, run: () => simulate(`un worktree serait créé sur ${branch.name}.`) },
    {
      key: 'session',
      label: 'Lancer une session dessus',
      icon: <MessageSquarePlus size={13} />,
      run: () => (demo ? simulate(`une session partirait sur ${branch.name}, dans un worktree neuf.`) : navigate(`/p/${projectId}/c/new`)),
    },
    { key: 'diff', label: 'Diff avec la base', icon: <FileDiff size={13} />, run: () => simulate(`le diff de ${branch.name} avec la base s'ouvrirait.`) },
    ...(branch.pr ? [{ key: 'pr', label: `PR #${branch.pr.number}`, icon: <GitPullRequest size={13} />, run: () => window.open(branch.pr!.url, '_blank', 'noopener') }] : []),
    ...(branch.merged
      ? [{ key: 'delete', label: 'Supprimer', icon: <Trash2 size={13} />, run: () => (page ? page.cleanBranches([branch.name]) : simulate(`${branch.name} serait supprimée.`)), tone: 'critical' as const }]
      : []),
  ]

  return (
    <section
      id={anchorId}
      data-tree={branch.key}
      className={cx(
        'flex scroll-mt-4 flex-col overflow-hidden rounded-xl ring-1 transition-shadow',
        highlight ? 'ring-2 ring-accent' : branch.kind === 'pr' ? 'ring-accent/30' : 'ring-line',
      )}
    >
      <header className="flex min-w-0 items-start gap-2.5 bg-surface/30 px-3 py-2">
        <span aria-hidden className={cx('mt-1.5 size-2 shrink-0 rounded-full', tone.dot)} />
        <div className="flex max-w-[44rem] min-w-0 flex-initial flex-col gap-1">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
            {branch.remoteOnly ? <Cloud size={13} className="shrink-0 text-ink-faint" /> : <GitBranch size={13} className="shrink-0 text-ink-faint" />}
            <span className="min-w-0 truncate font-mono text-[13px] font-medium">{branch.remoteOnly ? `origin/${branch.name}` : branch.name}</span>
            <span className={cx('text-xs', tone.text)}>{tone.label}</span>
            <span className="text-xs text-ink-faint">sans worktree</span>
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-faint">
            <span className="tabular-nums">
              ↑{branch.ahead} ↓{branch.behind}
            </span>
            <span className="tabular-nums">dernier commit {elapsed(branch.lastCommitAt)}</span>
            <BranchSim title="L’API ne compare pas une branche sans arbre à la base, ni ne date son dernier commit" />
            {branch.pr ? (
              <a href={branch.pr.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-ink">
                <Badge tone={PR_LABEL[branch.pr.state].tone}>PR #{branch.pr.number} · {PR_LABEL[branch.pr.state].label}</Badge>
              </a>
            ) : null}
            {branch.card ? (
              <Link to={href(`?fiche=${branch.card.number}`)} className="min-w-0 truncate hover:text-ink">
                #{branch.card.number} {branch.card.title}
                {branch.card.milestone && branch.card.milestone.number !== branch.card.number ? (
                  <span className="ml-1.5 rounded bg-surface-high px-1.5 py-px">Jalon #{branch.card.milestone.number}</span>
                ) : null}
              </Link>
            ) : null}
          </div>
        </div>
        <span aria-hidden className="flex-1" />
      </header>

      <div className="flex flex-col gap-1 px-3 py-2">
        <ol className="flex flex-col">
          {branch.commits.map((commit) => (
            <li key={commit.hash} className="flex min-h-8 min-w-0 items-center gap-2.5 text-sm">
              <GitCommitHorizontal size={13} className="shrink-0 text-ink-faint" />
              <code className="shrink-0 font-mono text-xs text-ink-faint">{commit.hash}</code>
              <span className="min-w-0 flex-1 truncate">{commit.title}</span>
              <span className="shrink-0 text-xs tabular-nums text-ink-faint">{elapsed(commit.at)}</span>
            </li>
          ))}
        </ol>
        <div className="flex flex-wrap items-center gap-1.5 pt-1">
          {gestures.map((gesture) => (
            <button
              key={gesture.key}
              type="button"
              onClick={gesture.run}
              className={cx(
                'inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs transition-colors',
                gesture.tone === 'critical' ? 'text-critical hover:bg-critical/10' : 'text-ink-soft hover:bg-surface-high hover:text-ink',
              )}
            >
              {gesture.icon}
              {gesture.label}
              {gesture.key === 'pr' ? <ArrowUpRight size={11} /> : null}
            </button>
          ))}
        </div>
        {notice ? <p role="status" className="rounded-md bg-fuchsia-500/10 px-2.5 py-1.5 text-xs text-fuchsia-700 dark:text-fuchsia-300">{notice}</p> : null}
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------ les fusionnées */

export function MergedBranches({ branches, anchorId, forceOpen = false }: { branches: BranchInfo[]; anchorId?: string; forceOpen?: boolean }) {
  const page = useTravailActions()
  const [open, setOpen] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  if (branches.length === 0) return null
  const shown = open || forceOpen

  return (
    <section id={anchorId} data-tree="branches-fusionnees" className="flex scroll-mt-4 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={shown}
          className="flex items-center gap-2 rounded-md px-1 py-1 text-sm text-ink-soft hover:text-ink"
        >
          <ChevronRight size={14} className={cx('transition-transform', shown && 'rotate-90')} />
          <GitBranch size={13} className="text-ink-faint" />
          <span className="font-medium">
            {branches.length} branche{branches.length > 1 ? 's' : ''} fusionnée{branches.length > 1 ? 's' : ''}
          </span>
          <span className="text-xs text-ink-faint">sans arbre, rien à perdre</span>
        </button>
        <button
          type="button"
          onClick={() => {
            if (page) return page.cleanBranches(branches.map((branch) => branch.name))
            if (window.confirm(`Simulé : supprimer ${branches.length} branche(s) fusionnée(s) ? Rien ne sera supprimé.`)) {
              setNotice(`Simulé : ${branches.length} branche(s) supprimée(s).`)
            }
          }}
          className="ml-auto inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs text-ink-soft hover:bg-surface-high hover:text-ink"
        >
          <Trash2 size={13} /> Supprimer
        </button>
      </div>
      {notice ? <p role="status" className="rounded-md bg-fuchsia-500/10 px-2.5 py-1.5 text-xs text-fuchsia-700 dark:text-fuchsia-300">{notice}</p> : null}
      {shown ? (
        <ul className="flex flex-col divide-y divide-line rounded-xl ring-1 ring-line">
          {branches.map((branch) => (
            <li key={branch.name} className="flex min-h-9 min-w-0 items-center gap-2.5 px-3 text-sm">
              <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-positive" />
              <span className="min-w-0 flex-1 truncate font-mono text-[13px]">{branch.name}</span>
              {branch.pr ? <span className="shrink-0 text-xs text-ink-faint">PR #{branch.pr.number}</span> : null}
              <span className="w-16 shrink-0 text-right text-xs tabular-nums text-ink-faint">{elapsed(branch.lastCommitAt)}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}
