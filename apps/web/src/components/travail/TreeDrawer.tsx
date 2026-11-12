import { ArrowDown, ArrowUp } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { JournalEntryDto } from '@solera/protocol'
import { Button, cx } from '@solera/ui'
import { AgentIcon } from '../AgentIcon'
import { CardRef } from '../code/CardRef'
import { PrTag } from '../code/PrTag'
import { ServiceMark } from '../code/ServiceMark'
import { VerdictDot, verdictLabel, verdictReason } from '../code/VerdictDot'
import { Detail } from '../shell/Detail'
import { formatBytes, pluralOf, type TreeRow } from '../../lib/code-model'
import { shortAge } from '../../lib/dates'
import { useLocale, useTranslate } from '../../lib/i18n'
import { JOURNAL_KIND_LABELS } from '../../lib/journal'
import type { ServedMark } from '../../lib/served'
import type { LaneRail } from './Lane'
import { useTreeActions } from './useTreeActions'

/** Sessions et événements montrés dans le tiroir, chacun. */
const DRAWER_ROWS = 8

/** Une session de l'arbre, vivante ou passée. */
export interface DrawerSession {
  id: string
  title: string
  agent: TreeRow['sessions'][number]['agent']
  updatedAt: number
}

/**
 * Le tiroir d'un arbre (`projet.md` T-11), qu'ouvre l'en-tête de son couloir : son
 * verdict et sa raison, ses gestes, ses faits, puis ses sessions et ses derniers
 * événements côte à côte.
 */
export function TreeDrawer({
  projectId,
  tree,
  sessions,
  entries,
  journalDays,
  rail,
  served,
  onClose,
  onClean,
}: {
  projectId: string
  /** Null : fermé. */
  tree: TreeRow | null
  /** Ses sessions, vivantes ou non, la plus récente d'abord. */
  sessions: DrawerSession[]
  /** Son historique, le plus récent d'abord. */
  entries: JournalEntryDto[]
  journalDays: number
  rail: LaneRail
  served?: ServedMark[]
  onClose: () => void
  onClean: (tree: TreeRow) => void
}) {
  const t = useTranslate()
  const name = tree ? (tree.branch ?? tree.name) : ''
  return (
    <Detail
      open={tree !== null}
      onClose={onClose}
      label={t('travail.drawer.label', { branch: name })}
      back={t('project.view.travail')}
      title={<span className="font-mono text-[15px]">{name}</span>}
      subtitle={
        tree ? (
          <span className="inline-flex items-center gap-1.5">
            <VerdictDot verdict={tree.verdict} />
            {tree.root ? t('travail.drawer.root') : verdictLabel(t, tree.verdict)}
            <ServiceMark projectId={projectId} marks={served} />
          </span>
        ) : null
      }
    >
      {tree ? <TreeBody projectId={projectId} tree={tree} sessions={sessions} entries={entries} journalDays={journalDays} rail={rail} onClean={onClean} /> : null}
    </Detail>
  )
}

function TreeBody({
  projectId,
  tree,
  sessions,
  entries,
  journalDays,
  rail,
  onClean,
}: {
  projectId: string
  tree: TreeRow
  sessions: DrawerSession[]
  entries: JournalEntryDto[]
  journalDays: number
  rail: LaneRail
  onClean: (tree: TreeRow) => void
}) {
  const t = useTranslate()
  const locale = useLocale()
  const actions = useTreeActions(projectId, tree, { onClean })
  const alarming = tree.verdict === 'merged-dirty' || tree.verdict === 'missing'
  const live = new Map(tree.sessions.map((session) => [session.id, session]))
  const ordered = [...sessions].sort((a, b) => Number(live.has(b.id)) - Number(live.has(a.id)) || b.updatedAt - a.updatedAt).slice(0, DRAWER_ROWS)

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 py-4">
      <p className={cx('text-sm', alarming ? 'text-critical' : 'text-ink-soft')}>{verdictReason(t, tree.reason)}</p>

      <div className="flex flex-wrap gap-1.5">
        {actions.map((action) => (
          <Button key={action.key} size="sm" variant="secondary" icon={action.icon} onClick={action.run} className={action.tone === 'critical' ? 'text-critical' : undefined}>
            {action.label}
          </Button>
        ))}
      </div>

      <dl className="grid grid-cols-[8rem_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
        {tree.card ? (
          <Fact label={t('travail.drawer.card')}>
            <CardRef projectId={projectId} card={{ ...tree.card, milestone: null }} size="sm" />
          </Fact>
        ) : null}
        {tree.card?.milestone ? (
          <Fact label={t('travail.drawer.milestone')}>
            <Link to={`/p/${projectId}/timeline/${tree.card.milestone.number}`} className="min-w-0 truncate underline-offset-2 hover:underline">
              <span className="tabular-nums text-ink-faint">#{tree.card.milestone.number}</span> {tree.card.milestone.title}
            </Link>
          </Fact>
        ) : null}
        <Fact label={t('travail.drawer.pr')}>{tree.pr ? <PrTag pr={tree.pr} /> : <span className="text-ink-faint">{t('travail.drawer.noPr')}</span>}</Fact>
        {tree.root ? null : (
          <Fact label={t('travail.drawer.base')}>
            <span className="inline-flex items-center gap-3 tabular-nums text-ink-soft">
              <span className="inline-flex items-center gap-0.5">
                <ArrowUp size={12} aria-hidden />
                {t(`travail.drawer.ahead.${pluralOf(tree.ahead)}`, { count: tree.ahead })}
              </span>
              <span className="inline-flex items-center gap-0.5">
                <ArrowDown size={12} aria-hidden />
                {t(`travail.drawer.behind.${pluralOf(tree.behind)}`, { count: tree.behind })}
              </span>
            </span>
          </Fact>
        )}
        <Fact label={t('travail.drawer.uncommitted')}>
          {tree.uncommitted > 0 ? <span className="text-caution">{t(`travail.drawer.files.${pluralOf(tree.uncommitted)}`, { count: tree.uncommitted })}</span> : <span className="text-ink-faint">{t('travail.drawer.noUncommitted')}</span>}
        </Fact>
        <Fact label={t('code.size')}>
          <span className="tabular-nums text-ink-soft">{tree.sizeBytes !== null ? formatBytes(tree.sizeBytes, locale) : t('travail.drawer.measuring')}</span>
        </Fact>
        <Fact label={t('travail.drawer.lastUse')}>
          <span className="text-ink-soft">{tree.lastUsedAt !== null ? t('travail.drawer.ago', { age: shortAge(tree.lastUsedAt) }) : '—'}</span>
        </Fact>
        <Fact label={t('travail.drawer.path')}>
          <code className="min-w-0 truncate font-mono text-xs text-ink-faint" title={tree.path}>
            {tree.path}
          </code>
        </Fact>
      </dl>

      <section className="flex flex-col gap-2">
        <h3 className="text-meta font-medium tracking-wide text-ink-faint uppercase">{t('travail.drawer.sessionsEvents')}</h3>
        <div className="grid gap-4 rounded-lg bg-surface/60 p-3 md:grid-cols-2">
          <section aria-label={t('travail.drawer.sessions')} className="flex min-w-0 flex-col gap-1.5">
            <h4 className="text-meta font-medium tracking-wide text-ink-faint uppercase">{t('travail.drawer.sessions')}</h4>
            {ordered.length === 0 ? (
              <p className="text-xs text-ink-faint">{t('travail.drawer.noSession')}</p>
            ) : (
              <ul className="flex flex-col">
                {ordered.map((session) => {
                  const alive = live.get(session.id)
                  return (
                    <li key={session.id}>
                      <Link to={`/p/${projectId}/c/${session.id}`} className="flex min-h-8 min-w-0 items-center gap-2 rounded-md px-1.5 text-sm hover:bg-surface-high focus-visible:outline-2 focus-visible:outline-accent">
                        <AgentIcon agent={session.agent} size={13} decorative />
                        <span className="min-w-0 flex-1 truncate">{session.title}</span>
                        {alive ? (
                          <span className={cx('shrink-0 text-xs', alive.tone === 'running' ? 'text-ink-soft' : alive.tone === 'awaiting' ? 'text-caution' : 'text-critical')}>
                            {t(`code.session.${alive.tone}`)}
                          </span>
                        ) : (
                          <span className="shrink-0 text-xs tabular-nums text-ink-faint">{shortAge(session.updatedAt)}</span>
                        )}
                      </Link>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
          <section aria-label={t('travail.drawer.history')} className="flex min-w-0 flex-col gap-1.5">
            <h4 className="text-meta font-medium tracking-wide text-ink-faint uppercase">{t('travail.drawer.history')}</h4>
            {entries.length === 0 ? (
              <p className="text-xs text-ink-faint">{t('travail.drawer.noHistory', { count: journalDays })}</p>
            ) : (
              <ul className="flex flex-col">
                {entries.slice(0, DRAWER_ROWS).map((entry) => {
                  const to = rail.entryHref(entry)
                  const body = (
                    <>
                      <span className="w-10 shrink-0 text-xs tabular-nums text-ink-faint">{shortAge(entry.at)}</span>
                      <span className="shrink-0 text-meta font-medium tracking-wide text-ink-faint uppercase">{t(JOURNAL_KIND_LABELS[entry.kind])}</span>
                      <span className="min-w-0 flex-1 truncate">{entry.title}</span>
                    </>
                  )
                  const shape = 'flex min-h-8 min-w-0 items-center gap-2 rounded-md px-1.5 text-sm'
                  return (
                    <li key={entry.id}>
                      {to ? (
                        <Link to={to} className={cx(shape, 'hover:bg-surface-high focus-visible:outline-2 focus-visible:outline-accent')}>
                          {body}
                        </Link>
                      ) : (
                        <div className={shape}>{body}</div>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        </div>
      </section>
    </div>
  )
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-ink-faint">{label}</dt>
      <dd className="flex min-w-0 items-center">{children}</dd>
    </>
  )
}
