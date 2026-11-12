import { ArrowUpRight, FolderGit2, GitPullRequest, Loader } from 'lucide-react'
import { useMemo, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import type { AgentKind, CardDto, ConversationDto, ConversationStatus } from '@solera/protocol'
import { cx } from '@solera/ui'
import { AgentIcon } from '../AgentIcon'
import { AskInbox } from '../inbox/AskInbox'
import { useCommitDetail, useCommitTurn } from '../panel/git/queries'
import type { LiveConversation } from '../../lib/activity'
import { withSheet } from '../../lib/card-sheet'
import type { TreeScope } from '../../lib/code-model'
import { relativeDate } from '../../lib/dates'
import { commitHome, knownCard, knownName, knownPr, linkedSessions, sessionStateOf, type GraphKnown, type LinkedSession, type SessionState } from '../../lib/graph-model'
import { useTranslate, type MessageKey } from '../../lib/i18n'
import type { InboxItem } from '../../lib/inbox'
import type { WorkspaceScope } from '../../lib/workspace-scope'

/** Ce que Solera sait des sessions du projet, pour dire lesquelles touchent un commit. */
export interface CommitSessionSources {
  conversations: ConversationDto[]
  /** Leur état vivant, quand le socket le connaît. */
  live: LiveConversation[]
  /** Les sessions de chaque arbre, par clé d'arbre. */
  scopes: Map<string, TreeScope>
  cards: CardDto[]
  /** La liste unique des demandes : on y prend la réponse d'une session qui t'attend. */
  inbox: InboxItem[]
}

const STATE_TONE: Record<SessionState, string> = {
  waiting: 'text-caution',
  error: 'text-critical',
  working: 'text-ink-soft',
  done: '',
  unknown: '',
}

/**
 * Le haut du tiroir d'un commit (T-7.7, T-7.8) : **les sessions qui s'y rattachent** —
 * celle qui l'a écrit, au tour près quand les points de reprise le savent, puis celles
 * de l'arbre, puis celles de la carte —, chacune avec sa provenance et de quoi y aller ;
 * une session qui t'attend porte sa réponse sur place. Dessous, la carte, le jalon, la PR
 * et l'arbre.
 *
 * Le fil, les candidats et les branches qui le contiennent viennent du détail du commit
 * (#171), que `CommitDetail` lit aussi : React Query ne le demande qu'une fois.
 */
export function CommitSessions({
  projectId,
  scope,
  hash,
  runName,
  known,
  sources,
  onOpenTree,
}: {
  projectId: string
  scope: WorkspaceScope
  hash: string
  /** La branche du couloir du commit, quand le serveur la nomme. */
  runName: string | null
  known: Map<string, GraphKnown>
  sources: CommitSessionSources
  onOpenTree: (key: string) => void
}) {
  const t = useTranslate()
  const [, setParams] = useSearchParams()
  const { data: detail, isPending } = useCommitDetail(scope, hash)
  const { data: turn, isPending: turnPending } = useCommitTurn(scope, hash)

  const home = useMemo(() => commitHome([runName, ...(detail?.containedIn ?? [])], known), [runName, detail, known])
  const tree = home?.kind === 'tree' ? home.tree : null
  const codeCard = home ? knownCard(home) : null
  const card = codeCard ? sources.cards.find((entry) => entry.number === codeCard.number) : undefined
  const pr = home ? knownPr(home) : null

  const byId = useMemo(() => new Map(sources.conversations.map((entry) => [entry.id, entry])), [sources.conversations])
  const statusOf = useMemo(() => new Map(sources.live.map((entry) => [entry.conversation.id, entry.status])), [sources.live])

  const sessions = useMemo(() => {
    const ids = tree ? [...(sources.scopes.get(tree.key)?.sessionIds ?? [])] : []
    return linkedSessions({
      turn: turn ?? null,
      thread: detail?.thread ?? null,
      candidates: detail?.threadCandidates ?? [],
      tree: ids.map((id) => ({ id, at: byId.get(id)?.updatedAt ?? 0 })),
      // Comme la fiche : les sessions archivées d'une carte n'y sont pas.
      card: (card?.conversations ?? []).filter((entry) => entry.archivedAt === null).map((entry) => ({ id: entry.id, at: entry.createdAt })),
    })
  }, [turn, detail, tree, sources.scopes, card, byId])

  const openSheet = (number: number) => setParams((current) => withSheet(current, number))

  return (
    <div className="flex flex-col gap-4 border-b border-line px-4 py-4">
      <section className="flex flex-col gap-2">
        <h3 className="text-micro font-semibold tracking-wide text-ink-faint uppercase">{t('travail.commit.sessions')}</h3>
        {/* Attendre le détail et le tour : ils disent qui a écrit le commit, et la liste ne se réordonne pas sous les yeux. */}
        {isPending || turnPending ? (
          <p className="flex items-center gap-1.5 text-sm text-ink-faint">
            <Loader size={13} className="animate-spin" /> {t('travail.commit.loading')}
          </p>
        ) : sessions.length === 0 ? (
          <p className="text-sm text-ink-faint">{t('travail.commit.none')}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line/60 rounded-lg border border-line">
            {sessions.map((session) => {
              const conversation = byId.get(session.id)
              const status = statusOf.get(session.id) ?? conversation?.status ?? null
              const replies = sources.inbox.filter((item) => item.kind === 'session' && item.conversationId === session.id)
              return (
                <SessionLine
                  key={session.id}
                  session={session}
                  title={conversation?.title ?? session.title ?? t('travail.commit.untitled')}
                  agent={conversation?.agent ?? null}
                  status={status}
                  at={conversation?.updatedAt ?? null}
                  href={`/p/${projectId}/c/${session.id}`}
                >
                  {status === 'awaiting_input' && replies.length > 0 ? <AskInbox items={replies} bare /> : null}
                </SessionLine>
              )
            })}
          </ul>
        )}
      </section>

      {codeCard || pr || tree ? (
        <section className="flex flex-wrap items-center gap-2">
          {codeCard ? (
            <Chip onClick={() => openSheet(codeCard.number)} title={codeCard.source === 'name' ? t('travail.commit.cardDeduced') : codeCard.title}>
              <span className="tabular-nums text-ink-faint">#{codeCard.number}</span> <span className="truncate">{codeCard.title}</span>
            </Chip>
          ) : null}
          {codeCard?.milestone ? (
            <Chip onClick={() => openSheet(codeCard.milestone!.number)} title={codeCard.milestone.title}>
              {t('code.milestone', { number: codeCard.milestone.number })}
            </Chip>
          ) : null}
          {pr?.url ? (
            <a href={pr.url} target="_blank" rel="noreferrer" className={CHIP}>
              <GitPullRequest size={12} /> {t('travail.commit.pr', { number: pr.number })} <ArrowUpRight size={11} />
            </a>
          ) : null}
          {tree ? (
            <Chip onClick={() => onOpenTree(tree.key)} title={t('travail.graph.openTree')}>
              <FolderGit2 size={12} /> <span className="truncate font-mono">{knownName(home!)}</span>
            </Chip>
          ) : null}
        </section>
      ) : null}
    </div>
  )
}

const PROVENANCE: Record<Exclude<LinkedSession['provenance'], 'turn'>, MessageKey> = {
  sure: 'travail.commit.sure',
  dates: 'travail.commit.dates',
  branch: 'travail.commit.branch',
  card: 'travail.commit.card',
}

function SessionLine({
  session,
  title,
  agent,
  status,
  at,
  href,
  children,
}: {
  session: LinkedSession
  title: string
  agent: AgentKind | null
  status: ConversationStatus | null
  at: number | null
  href: string
  children: ReactNode
}) {
  const t = useTranslate()
  const state = sessionStateOf(status)
  const provenance =
    session.provenance === 'turn'
      ? session.turn?.number != null
        ? t('travail.commit.turn', { turn: session.turn.number })
        : t('travail.commit.turnUnknown')
      : t(PROVENANCE[session.provenance])
  return (
    <li className="flex flex-col gap-2 px-3 py-2.5" data-session={session.id} data-provenance={session.provenance}>
      <div className="flex min-w-0 items-center gap-2.5">
        {agent ? <AgentIcon agent={agent} size={15} /> : <span className="size-[15px] shrink-0" />}
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm text-ink">{title}</span>
          <span className="truncate text-xs text-ink-faint">
            <span className={STATE_TONE[state]}>{t(`travail.commit.state.${state}`)}</span>{' '}
            {at ? t('travail.commit.meta', { provenance, age: relativeDate(at) }) : t('travail.commit.metaNoDate', { provenance })}
          </span>
          {session.turn?.message ? <span className="truncate text-xs text-ink-soft">{t('travail.commit.message', { message: session.turn.message })}</span> : null}
        </div>
        <Link
          to={href}
          className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs text-ink-soft transition-colors hover:bg-surface-high hover:text-ink pointer-coarse:min-h-11"
        >
          {t('travail.commit.open')} <ArrowUpRight size={12} />
        </Link>
      </div>
      {children}
    </li>
  )
}

const CHIP =
  'inline-flex max-w-full items-center gap-1.5 rounded-md border border-line px-2 py-1 text-xs text-ink-soft transition-colors hover:border-line-strong hover:text-ink pointer-coarse:min-h-11'

function Chip({ onClick, title, children }: { onClick: () => void; title?: string; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} title={title} className={cx(CHIP, 'min-w-0')}>
      {children}
    </button>
  )
}
