/* PROTOTYPE — jetable (branche proto/page-projet). Ne pas fusionner dans main.
 *
 * Le haut du tiroir d'un commit, dans le Graphe de Travail : **les sessions qui s'y
 * rattachent**, et de quoi y aller ; puis la carte, le jalon, la PR et le worktree.
 *
 * Ce que Solera sait vraiment du lien commit ↔ session (vérifié dans le code) :
 * - `node.thread` (serveur, `apps/server/src/git-threads.ts`) : le fil qui a écrit le
 *   commit. **Sûr** (`sure: true`) quand le commit n'est atteint que par une branche
 *   sortie dans un worktree occupé par ce fil ; **déduit** (`sure: false`) par
 *   recoupement de dates dans le même répertoire, et seulement s'il n'y a qu'un
 *   candidat. Le serveur se tait plutôt que de choisir.
 * - Les sessions du worktree qui porte la branche (`conversations.worktreeId`) : sûres
 *   pour « a travaillé sur cette branche », pas pour « a écrit ce commit-là ».
 * - Les sessions de la carte (`card.conversations`), la carte étant **devinée** du nom
 *   de la branche (`feat/153-…` → #153) quand aucune session ne la porte.
 * - Le tour précis : les points de reprise (`refs/solera/checkpoints/<fil>/<tour>/…`)
 *   gardent HEAD avant et après chaque tour, donc le serveur pourrait dire « produit
 *   par le tour N » ; aucune route ne l'expose aujourd'hui.
 */
import { ArrowUpRight, FolderGit2, GitPullRequest } from 'lucide-react'
import { useMemo, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import type { AgentKind, ConversationStatus, GraphNodeDto } from '@solera/protocol'
import { cx } from '@solera/ui'
import { AgentIcon } from '../../components/AgentIcon'
import { AskInbox, type InboxItem } from '../../components/prototype/AskInbox'
import { useCommitDetail } from '../../components/panel/git/queries'
import { useLiveConversations } from '../../lib/activity'
import { useCards } from '../../lib/cards'
import { useAllConversations } from '../../lib/conversations'
import { relativeDate } from '../../lib/dates'
import { projectScope } from '../../lib/workspace-scope'
import { DRAWER_PARAM } from '../prototype-milestones/CardDrawer'
import type { TreeRow } from '../prototype-code/data'
import type { BranchInfo } from './branches'

type Provenance = 'producer-sure' | 'producer-dates' | 'branch' | 'card' | 'demo'

const PROVENANCE: Record<Provenance, string> = {
  'producer-sure': 'a écrit ce commit · d’après sa branche',
  'producer-dates': 'a écrit ce commit · déduit des dates',
  branch: 'a travaillé sur la branche',
  card: 'session de la carte',
  demo: 'simulé',
}

interface Linked {
  id: string
  title: string
  agent: AgentKind | null
  status: ConversationStatus | null
  at: number | null
  provenance: Provenance
}

const bare = (name: string) => name.replace(/^origin\//, '')

export function CommitSessions({
  projectId,
  node,
  runName,
  trees,
  branches,
  inbox,
  demo,
  onOpenTree,
}: {
  projectId: string
  node: GraphNodeDto
  /** La branche du couloir du commit, quand le serveur la nomme. */
  runName: string | null
  trees: TreeRow[]
  branches: BranchInfo[]
  /** La liste unique des demandes : on y prend la réponse d'une session qui attend. */
  inbox: InboxItem[]
  demo: boolean
  onOpenTree: (key: string) => void
}) {
  const [, setParams] = useSearchParams()
  const detail = useCommitDetail(projectScope(projectId), demo ? null : node.hash)
  const { data: cards } = useCards(projectId)
  const { data: conversations } = useAllConversations()
  const mine = useMemo(() => (conversations ?? []).filter((entry) => entry.projectId === projectId), [conversations, projectId])
  const live = useLiveConversations(mine)
  const byId = useMemo(() => new Map(live.map((entry) => [entry.conversation.id, entry])), [live])

  /** Les branches qui contiennent le commit : celle du couloir d'abord, puis `containedIn`. */
  const branchNames = useMemo(() => {
    const names = [runName, ...(detail.data?.containedIn ?? [])].filter((name): name is string => Boolean(name)).map(bare)
    return [...new Set(names)]
  }, [runName, detail.data])

  const tree = useMemo(() => {
    for (const name of branchNames) {
      const found = trees.find((entry) => entry.branch === name)
      if (found) return found
    }
    return null
  }, [branchNames, trees])
  const branch = tree ? null : branches.find((entry) => branchNames.includes(entry.name)) ?? null

  const cardRef = tree?.card ?? branch?.card ?? null
  const card = cardRef ? (cards ?? []).find((entry) => entry.number === cardRef.number) ?? null : null
  const pr = tree?.pr ?? branch?.pr ?? null

  const sessions = useMemo<Linked[]>(() => {
    const out: Linked[] = []
    const seen = new Set<string>()
    const push = (id: string, fallback: Partial<Linked>, provenance: Provenance) => {
      if (seen.has(id)) return
      seen.add(id)
      const found = byId.get(id)
      out.push({
        id,
        title: found?.conversation.title ?? fallback.title ?? 'Session',
        agent: found?.conversation.agent ?? fallback.agent ?? null,
        status: found?.status ?? fallback.status ?? null,
        at: found?.conversation.updatedAt ?? fallback.at ?? null,
        provenance,
      })
    }
    if (node.thread) push(node.thread.id, { title: node.thread.title }, node.thread.sure ? 'producer-sure' : 'producer-dates')
    for (const session of tree?.sessions ?? []) push(session.id, { ...session }, demo ? 'demo' : 'branch')
    if (tree?.anySessionId) push(tree.anySessionId, {}, demo ? 'demo' : 'branch')
    for (const session of card?.conversations ?? []) {
      if (session.archivedAt !== null && seen.size > 3) continue
      push(session.id, { title: session.title, agent: session.agent, status: session.status, at: session.createdAt }, 'card')
    }
    return out
  }, [node.thread, tree, card, byId, demo])

  const replies = (id: string) => inbox.filter((item) => item.kind === 'session' && item.open.includes(id))
  const openCard = (number: number) =>
    setParams((current) => {
      current.set(DRAWER_PARAM, String(number))
      return current
    })

  return (
    <div className="flex flex-col gap-4 border-b border-line px-4 py-4">
      <section className="flex flex-col gap-2">
        <h3 className="text-micro font-semibold tracking-wide text-ink-faint uppercase">Sessions</h3>
        {sessions.length === 0 ? (
          <p className="text-sm text-ink-faint">
            Aucune session connue pour ce commit : il n’est porté par aucun worktree de Solera, et plusieurs fils travaillaient
            peut-être au même endroit à cette heure-là.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-line/60 rounded-lg border border-line">
            {sessions.map((session) => {
              const waiting = session.status === 'awaiting_input'
              const pending = replies(session.id)
              return (
                <li key={session.id} className="flex flex-col gap-2 px-3 py-2.5">
                  <div className="flex min-w-0 items-center gap-2.5">
                    {session.agent ? <AgentIcon agent={session.agent} size={15} /> : <span className="size-[15px]" />}
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-sm text-ink">{session.title}</span>
                      <span className="truncate text-xs text-ink-faint">
                        <Status status={session.status} /> · {PROVENANCE[session.provenance]}
                        {session.at ? ` · ${relativeDate(session.at)}` : ''}
                      </span>
                    </div>
                    <Link
                      to={`/p/${projectId}/c/${session.id}`}
                      className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs text-ink-soft transition-colors hover:bg-surface-high hover:text-ink"
                    >
                      Ouvrir la session <ArrowUpRight size={12} />
                    </Link>
                  </div>
                  {waiting && pending.length > 0 ? <AskInbox items={pending} bare /> : null}
                </li>
              )
            })}
          </ul>
        )}
        {!demo ? (
          <p className="text-xs text-ink-faint">
            Le tour précis qui a produit le commit n’est pas encore exposé : les points de reprise le savent, aucune route ne le
            rend.
          </p>
        ) : null}
      </section>

      {cardRef || pr || tree ? (
        <section className="flex flex-wrap items-center gap-2">
          {cardRef ? (
            <Chip onClick={() => openCard(cardRef.number)} title={card ? undefined : 'Carte déduite du nom de la branche'}>
              <span className="tabular-nums text-ink-faint">#{cardRef.number}</span> <span className="truncate">{cardRef.title}</span>
            </Chip>
          ) : null}
          {cardRef?.milestone ? (
            <Chip onClick={() => openCard(cardRef.milestone!.number)}>
              Jalon <span className="tabular-nums">#{cardRef.milestone.number}</span>
            </Chip>
          ) : null}
          {pr ? (
            <a href={pr.url} target="_blank" rel="noreferrer" className={chipClass}>
              <GitPullRequest size={12} /> PR #{pr.number}
            </a>
          ) : null}
          {tree ? (
            <Chip onClick={() => onOpenTree(tree.key)}>
              <FolderGit2 size={12} /> <span className="truncate font-mono">{tree.branch ?? tree.name}</span>
            </Chip>
          ) : null}
        </section>
      ) : null}
    </div>
  )
}

const chipClass =
  'inline-flex max-w-full items-center gap-1.5 rounded-md border border-line px-2 py-1 text-xs text-ink-soft transition-colors hover:border-line-strong hover:text-ink'

function Chip({ onClick, title, children }: { onClick: () => void; title?: string; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} title={title} className={chipClass}>
      {children}
    </button>
  )
}

function Status({ status }: { status: ConversationStatus | null }) {
  if (status === 'awaiting_input') return <span className="text-caution">t’attend</span>
  if (status === 'error') return <span className="text-critical">en erreur</span>
  if (status === 'running') return <span className={cx('text-ink-soft')}>travaille</span>
  if (status === null) return <span>état inconnu</span>
  return <span>terminée</span>
}
