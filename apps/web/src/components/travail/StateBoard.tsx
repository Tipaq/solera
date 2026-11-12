import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { cx } from '@solera/ui'
import { AgentIcon } from '../AgentIcon'
import { MilestoneChip } from '../code/MilestoneChip'
import { TreeChip } from '../code/TreeChip'
import { AskInbox } from '../inbox/AskInbox'
import type { ActivityRow } from '../../lib/activity-rows'
import type { TreeRow } from '../../lib/code-model'
import { elapsed } from '../../lib/dates'
import { useTranslate, type MessageKey } from '../../lib/i18n'
import type { InboxItem } from '../../lib/inbox'
import type { MilestoneRef } from '../../lib/travail-model'

type Tone = 'running' | 'review' | 'done'

/** Ce que les colonnes montrent, déjà filtré et rangé par la page (`stateColumns`). */
export interface StateBoardModel {
  projectId: string
  inbox: InboxItem[]
  working: ActivityRow[]
  review: ActivityRow[]
  done: ActivityRow[]
  treeOf: (row: ActivityRow) => TreeRow | null
  milestoneOf: (row: ActivityRow) => MilestoneRef | null
  /** L'arbre choisi : sa puce se montre enfoncée. */
  targetKey: string | null
  onSelectTree: (key: string) => void
}

/**
 * La vue « Par état » de Travail (`projet.md` T-8) : un kanban des sessions.
 *
 * - **T'attend** : la liste des demandes (`AskInbox`), la réponse sur place ;
 * - **Travaille**, **À relire**, **Terminées récemment** (trois jours, douze au plus) :
 *   une carte par session, qui mène à son fil ; dessous, la puce de son arbre (un clic
 *   filtre sur l'arbre), sa carte et son jalon.
 *
 * Quatre colonnes à partir de `md` ; en dessous, elles défilent de côté.
 */
export function StateBoard({ model }: { model: StateBoardModel }) {
  const t = useTranslate()
  const cards = (rows: ActivityRow[], tone: Tone) => rows.map((row) => <SessionCard key={row.entry.conversation.id} row={row} tone={tone} model={model} />)
  return (
    <div className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2 md:mx-0 md:grid md:grid-cols-4 md:overflow-visible md:px-0">
      <Column title={t('travail.state.column.waiting')} count={model.inbox.length} dot="bg-caution">
        {model.inbox.length > 0 ? <AskInbox items={model.inbox} bare /> : <Empty message="travail.state.empty.waiting" />}
      </Column>
      <Column title={t('travail.state.column.working')} count={model.working.length} dot="bg-accent">
        {model.working.length > 0 ? cards(model.working, 'running') : <Empty message="travail.state.empty.working" />}
      </Column>
      <Column title={t('travail.state.column.review')} count={model.review.length} dot="bg-accent/60">
        {model.review.length > 0 ? cards(model.review, 'review') : <Empty message="travail.state.empty.review" />}
      </Column>
      <Column title={t('travail.state.column.done')} count={model.done.length} dot="bg-positive">
        {model.done.length > 0 ? cards(model.done, 'done') : <Empty message="travail.state.empty.done" />}
      </Column>
    </div>
  )
}

function Column({ title, count, dot, children }: { title: string; count: number; dot: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex w-[17rem] shrink-0 snap-start flex-col gap-2 rounded-xl bg-surface/40 p-2 md:w-auto md:min-w-0">
      <header className="flex items-center gap-2 px-1.5 pt-1">
        <span aria-hidden className={cx('size-2 rounded-full', dot)} />
        <h3 className="text-sm font-medium">{title}</h3>
        <span className="text-xs text-ink-faint tabular-nums">{count}</span>
      </header>
      <div className="flex min-w-0 flex-col gap-1.5">{children}</div>
    </section>
  )
}

function Empty({ message }: { message: MessageKey }) {
  const t = useTranslate()
  return <p className="px-1.5 py-2 text-xs text-ink-faint">{t(message)}</p>
}

const ICON_TONE: Record<Tone, string> = {
  running: 'bg-accent/10 text-accent',
  review: 'bg-surface-high text-accent',
  done: 'bg-surface-high text-ink-faint',
}

/** Une session : son agent teinté par sa colonne, son titre, son âge ; dessous, où et pour quoi. */
function SessionCard({ row, tone, model }: { row: ActivityRow; tone: Tone; model: StateBoardModel }) {
  const { conversation } = row.entry
  const tree = model.treeOf(row)
  const milestone = model.milestoneOf(row)
  const card = conversation.card
  return (
    <Link
      to={`/p/${model.projectId}/c/${conversation.id}`}
      className="flex min-w-0 flex-col gap-1 rounded-lg bg-canvas px-2.5 py-2 ring-1 ring-line transition-shadow hover:ring-line-strong focus-visible:outline-2 focus-visible:outline-accent"
    >
      <span className="flex min-w-0 items-center gap-2">
        <span className={cx('flex size-5 shrink-0 items-center justify-center rounded', ICON_TONE[tone])}>
          <AgentIcon agent={conversation.agent} size={12} />
        </span>
        <span className="min-w-0 flex-1 truncate text-sm">{conversation.title}</span>
        <span className="shrink-0 text-xs text-ink-faint tabular-nums">{elapsed(conversation.updatedAt)}</span>
      </span>
      {tree || card || milestone ? (
        <span className="flex min-w-0 flex-wrap items-center gap-1.5 pl-7 text-xs text-ink-faint">
          {tree ? <TreeChip tree={tree} active={tree.key === model.targetKey} onSelect={model.onSelectTree} /> : null}
          {card ? (
            <span className="min-w-0 truncate">
              #{card.number} {card.title}
            </span>
          ) : null}
          {milestone ? <MilestoneChip milestone={milestone} /> : null}
        </span>
      ) : null}
    </Link>
  )
}
