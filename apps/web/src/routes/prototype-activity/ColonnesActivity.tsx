/* PROTOTYPE — jetable (branche proto/page-projet). Ne pas fusionner dans main. */
import { ChevronDown, GitBranch } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { JournalEntryDto } from '@solera/protocol'
import { EmptyState, cx } from '@solera/ui'
import { AgentIcon } from '../../components/AgentIcon'
import { JOURNAL_KIND_ICONS, journalIconTone } from '../../components/journal/JournalView'
import { MilestoneBanner } from '../../components/project/MilestoneBanner'
import { PrBadge } from '../../components/project/PrBadge'
import { Marker, SUMMARY_TONE } from '../../components/project/SessionRow'
import { SessionRequestPreview } from '../../components/project/SessionRequestPreview'
import { conversationPath } from '../../lib/conversation-route'
import { shortAge } from '../../lib/dates'
import { useTranslate } from '../../lib/i18n'
import { JOURNAL_KIND_LABELS } from '../../lib/journal'
import { CardDrawerHost } from '../prototype-milestones/CardDrawer'
import { useProtoHref } from '../prototype-milestones/model'
import {
  KindFilter,
  LIVE_GROUPS,
  MilestoneTag,
  Quiet,
  SearchField,
  dayLabel,
  timeOf,
  useActivityModel,
  type ActivityModel,
  type ActivityRow,
} from './shared'

type Pane = 'live' | 'history'

/**
 * `colonnes` — le vivant et l'historique côte à côte. À gauche une colonne étroite,
 * collée pendant qu'on fait défiler l'historique : ce qui tourne reste sous l'œil. À
 * droite l'historique, avec les natures du Journal. Au téléphone, deux onglets.
 */
export function ColonnesActivity() {
  const model = useActivityModel()
  const t = useTranslate()
  const [pane, setPane] = useState<Pane>('live')
  if (model.isPending) return null
  if (!model.projectId || !model.project) return <EmptyState title={t('project.notFound')} />
  const projectId = model.projectId
  const asking = model.liveByGroup('asking').length

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 flex-col gap-2 border-b border-line px-4 py-3 md:flex-row md:items-center md:px-6">
        <SearchField model={model} className="md:w-80" />
        {/* Au téléphone : un onglet par colonne. */}
        <div role="tablist" className="flex gap-1 lg:hidden">
          {(['live', 'history'] as const).map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={pane === key}
              onClick={() => setPane(key)}
              className={cx(
                'flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md text-sm',
                pane === key ? 'bg-surface-high font-medium text-ink' : 'text-ink-faint',
              )}
            >
              {key === 'live' ? 'En direct' : 'Historique'}
              {key === 'live' && model.live.length > 0 ? (
                <span className={cx('text-xs tabular-nums', asking > 0 ? 'text-caution' : 'opacity-60')}>{model.live.length}</span>
              ) : null}
            </button>
          ))}
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* ------------------------------------------------------------ en direct */}
        <aside
          className={cx(
            'min-h-0 w-full shrink-0 overflow-y-auto border-line pb-28 lg:block lg:w-[22rem] lg:border-r',
            pane === 'live' ? 'block' : 'hidden',
          )}
        >
          <div className="flex flex-col gap-5 px-4 py-4">
            <h2 className="hidden text-xs font-medium tracking-wide text-ink-faint uppercase lg:block">En direct</h2>
            {model.runs.map((run) => (
              <MilestoneBanner key={run.id} projectId={projectId} run={run} />
            ))}
            {model.live.length === 0 ? (
              <Quiet>{model.searching ? 'Aucune session vivante ne correspond.' : 'Rien ne tourne. Tout ce qui s’est passé est à côté.'}</Quiet>
            ) : (
              LIVE_GROUPS.map(({ group, label }) => {
                const members = model.liveByGroup(group)
                if (members.length === 0) return null
                return (
                  <section key={group} className="flex flex-col gap-1">
                    <h3 className={cx('px-2 text-xs font-medium', group === 'asking' ? 'text-caution' : 'text-ink-soft')}>
                      {label} <span className="tabular-nums opacity-60">{members.length}</span>
                    </h3>
                    <ul className="flex flex-col">
                      {members.map((row) => (
                        <LiveLine key={row.entry.conversation.id} row={row} model={model} projectId={projectId} />
                      ))}
                    </ul>
                  </section>
                )
              })
            )}
          </div>
        </aside>

        {/* ----------------------------------------------------------- historique */}
        <main
          className={cx('min-h-0 min-w-0 flex-1 overflow-y-auto pb-28 lg:block', pane === 'history' ? 'block' : 'hidden')}
        >
          <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-line bg-canvas/95 px-4 py-2 backdrop-blur md:px-6">
            <h2 className="hidden shrink-0 text-xs font-medium tracking-wide text-ink-faint uppercase lg:block">Historique</h2>
            <KindFilter model={model} className="lg:ml-auto" />
          </div>
          {model.days.length === 0 ? (
            <Quiet className="px-4 py-6 md:px-6">
              {model.searching || model.kind !== 'all' ? 'Rien dans l’historique ne correspond.' : `Rien ne s’est passé ces ${model.journalDays} derniers jours.`}
            </Quiet>
          ) : (
            <div className="flex flex-col gap-6 px-4 py-4 md:px-6">
              {model.days.map((day) => (
                <section key={day.at} className="flex flex-col">
                  <h3 className="pb-1 text-sm font-medium text-ink first-letter:uppercase">{dayLabel(day.at)}</h3>
                  <ul className="flex flex-col">
                    {day.entries.map((entry) => (
                      <HistoryLine key={entry.id} entry={entry} model={model} projectId={projectId} />
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </main>
      </div>
      <CardDrawerHost />
    </div>
  )
}

/**
 * Une session vivante, taillée pour une colonne étroite : point, titre, âge, puis une
 * seconde ligne (résumé, branche, PR). Une demande se déplie sur place pour y répondre.
 */
function LiveLine({ row, model, projectId }: { row: ActivityRow; model: ActivityModel; projectId: string }) {
  const href = useProtoHref()
  const { conversation } = row.entry
  const milestone = model.milestoneOfRow(row)
  const foldable = row.request !== null
  const open = foldable && model.isExpanded(conversation.id)
  const path = conversationPath(conversation)

  const body = (
    <>
      <span className="flex items-center gap-2">
        <Marker marker={row.marker} />
        <span className="min-w-0 flex-1 truncate text-sm text-ink">{conversation.title}</span>
        <span className="shrink-0 text-xs text-ink-faint tabular-nums">{shortAge(conversation.updatedAt)}</span>
        {foldable ? <ChevronDown size={14} className={cx('shrink-0 text-ink-faint transition-transform', open && 'rotate-180')} /> : null}
      </span>
      <span className="flex min-w-0 items-center gap-2 pl-3.5 text-xs text-ink-faint">
        <AgentIcon agent={conversation.agent} size={12} decorative />
        {row.summary ? (
          <span className={cx('min-w-0 truncate', SUMMARY_TONE[row.summary.tone])}>{row.summary.text}</span>
        ) : row.place.branch && !row.place.root ? (
          <span className="flex min-w-0 items-center gap-1 truncate font-mono">
            <GitBranch size={11} className="shrink-0" />
            {row.place.branch}
          </span>
        ) : null}
        {row.pr ? <PrBadge pr={row.pr} className="ml-auto shrink-0" /> : null}
      </span>
    </>
  )
  const shape = cx('flex w-full flex-col gap-1 rounded-lg px-2 py-2 text-left transition-colors hover:bg-sunken/60', open && 'bg-sunken/60')

  return (
    <li className="flex flex-col">
      {milestone ? <MilestoneTag milestone={milestone} projectId={projectId} className="mt-1 ml-1 self-start" /> : null}
      {foldable ? (
        <button type="button" aria-expanded={open} onClick={() => model.toggle(conversation.id)} className={shape}>
          {body}
        </button>
      ) : (
        <Link to={href(path)} className={shape}>
          {body}
        </Link>
      )}
      {open && row.request ? (
        <div className="mb-2 overflow-hidden rounded-lg ring-1 ring-caution/30">
          <SessionRequestPreview
            conversationPath={path}
            conversationId={conversation.id}
            request={row.request}
            canDecide={conversation.isOwner}
          />
        </div>
      ) : null}
    </li>
  )
}

/** Une ligne d'historique : heure, pastille de nature, titre, provenance, jalon. */
function HistoryLine({ entry, model, projectId }: { entry: JournalEntryDto; model: ActivityModel; projectId: string }) {
  const t = useTranslate()
  const to = model.entryHref(entry)
  const milestone = model.milestoneOfEntry(entry)
  const conversation = model.conversationOf(entry)
  const body = (
    <>
      <span className="w-11 shrink-0 text-xs text-ink-faint tabular-nums">{timeOf(entry.at)}</span>
      <span aria-hidden className={cx('flex w-4 shrink-0 justify-center', journalIconTone(entry))}>
        {conversation ? <AgentIcon agent={conversation.agent} size={13} decorative /> : JOURNAL_KIND_ICONS[entry.kind]}
      </span>
      <span className="min-w-0 flex-1 truncate text-sm text-ink">{entry.title}</span>
      <span className="hidden shrink-0 items-center gap-2 text-xs text-ink-faint md:flex">
        {milestone ? <MilestoneTag milestone={milestone} projectId={projectId} className="max-w-56" /> : null}
        {entry.cardNumber !== null ? <span className="tabular-nums">#{entry.cardNumber}</span> : null}
        <span className="w-20 text-right">{t(JOURNAL_KIND_LABELS[entry.kind])}</span>
      </span>
    </>
  )
  const shape = 'flex min-h-9 items-center gap-3 rounded-md px-2 -mx-2'
  return (
    <li>
      {to ? (
        <Link to={to} className={cx(shape, 'transition-colors hover:bg-sunken/60')}>
          {body}
        </Link>
      ) : (
        <div className={shape}>{body}</div>
      )}
    </li>
  )
}
