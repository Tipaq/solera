/* PROTOTYPE — jetable (branche proto/page-projet). Ne pas fusionner dans main. */
import { ChevronRight, CornerDownLeft } from 'lucide-react'
import { Fragment, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import type { JournalEntryDto } from '@solera/protocol'
import { EmptyState, cx } from '@solera/ui'
import { AgentIcon } from '../../components/AgentIcon'
import { JOURNAL_KIND_ICONS, journalIconTone } from '../../components/journal/JournalView'
import { MilestoneBanner } from '../../components/project/MilestoneBanner'
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

/** Les colonnes, partagées par l'en-tête et chaque ligne : c'est ce qui les aligne. */
const COLUMNS =
  'grid grid-cols-[3rem_minmax(0,1fr)_4.5rem] md:grid-cols-[3.5rem_7rem_minmax(0,1fr)_14rem_1.75rem_6.5rem] items-center gap-x-3'

const STATE_LABEL: Record<string, string> = { asking: 'À toi', review: 'À relire', running: 'En cours' }

type Line =
  | { key: string; kind: 'live'; row: ActivityRow; to: string; foldable: boolean }
  | { key: string; kind: 'entry'; entry: JournalEntryDto; to: string | null }

/**
 * `compact` — un tableau dense, façon Linear. Six colonnes alignées de haut en bas,
 * des en-têtes de groupe fins, et le clavier : ↑ ↓ pour se déplacer, Entrée pour ouvrir
 * (ou déplier une demande, pour y répondre sans quitter la liste).
 */
export function CompactActivity() {
  const model = useActivityModel()
  const t = useTranslate()
  const navigate = useNavigate()
  const href = useProtoHref()
  const [selected, setSelected] = useState(0)
  const list = useRef<HTMLDivElement>(null)

  // L'ordre de lecture, aplati : c'est lui que les flèches parcourent.
  const lines: Line[] = (() => {
    const live: Line[] = LIVE_GROUPS.flatMap(({ group }) =>
      model.liveByGroup(group).map((row) => ({
        key: `l-${row.entry.conversation.id}`,
        kind: 'live' as const,
        row,
        to: href(conversationPath(row.entry.conversation)),
        foldable: row.request !== null,
      })),
    )
    const history: Line[] = model.days.flatMap((day) =>
      day.entries.map((entry) => ({ key: `e-${entry.id}`, kind: 'entry' as const, entry, to: model.entryHref(entry) })),
    )
    return [...live, ...history]
  })()
  const indexOf = new Map(lines.map((line, index) => [line.key, index]))

  useEffect(() => {
    if (selected >= lines.length) setSelected(Math.max(0, lines.length - 1))
  }, [lines.length, selected])
  useEffect(() => {
    list.current?.querySelector(`[data-row="${selected}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  if (model.isPending) return null
  if (!model.projectId || !model.project) return <EmptyState title={t('project.notFound')} />
  const projectId = model.projectId

  const open = (line: Line | undefined) => {
    if (!line) return
    if (line.kind === 'live' && line.foldable) model.toggle(line.row.entry.conversation.id)
    else if (line.to) navigate(line.to)
  }
  const onKeyDown = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement
    if (target.closest('input, textarea, [contenteditable="true"]')) return
    if (event.key === 'ArrowDown' || event.key === 'j') {
      event.preventDefault()
      setSelected((current) => Math.min(lines.length - 1, current + 1))
    } else if (event.key === 'ArrowUp' || event.key === 'k') {
      event.preventDefault()
      setSelected((current) => Math.max(0, current - 1))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      open(lines[selected])
    }
  }

  const liveCount = model.live.length

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 flex-wrap items-center gap-3 px-4 py-3 md:px-6">
        <SearchField model={model} className="w-full sm:w-72" />
        <KindFilter model={model} />
        <span className="ml-auto hidden items-center gap-1.5 text-xs text-ink-faint lg:flex">
          <Kbd>↑</Kbd>
          <Kbd>↓</Kbd> se déplacer
          <Kbd>
            <CornerDownLeft size={10} />
          </Kbd>{' '}
          ouvrir
        </span>
      </header>

      <div
        ref={list}
        tabIndex={0}
        onKeyDown={onKeyDown}
        aria-label="Activité"
        className="min-h-0 flex-1 overflow-y-auto pb-28 outline-none"
      >
        {/* L'en-tête des colonnes, collé. */}
        <div className={cx(COLUMNS, 'sticky top-0 z-20 border-y border-line bg-canvas px-4 py-1.5 text-[11px] font-medium tracking-wide text-ink-faint uppercase md:px-6')}>
          <span>Heure</span>
          <span className="hidden md:block">Nature</span>
          <span>Titre</span>
          <span className="hidden md:block">Carte · jalon</span>
          <span className="hidden md:block" aria-label="Agent" />
          <span className="text-right">État</span>
        </div>

        {model.runs.length > 0 ? (
          <div className="flex flex-col gap-2 px-4 py-3 md:px-6">
            {model.runs.map((run) => (
              <MilestoneBanner key={run.id} projectId={projectId} run={run} />
            ))}
          </div>
        ) : null}

        {/* ---------------------------------------------------------- en direct */}
        <GroupHead label="En direct" count={liveCount} tone={model.liveByGroup('asking').length > 0 ? 'caution' : undefined} />
        {liveCount === 0 ? (
          <Quiet className="px-4 py-2.5 md:px-6">{model.searching ? 'Aucune session vivante ne correspond.' : 'Rien ne tourne.'}</Quiet>
        ) : (
          LIVE_GROUPS.map(({ group }) =>
            model.liveByGroup(group).map((row) => {
              const index = indexOf.get(`l-${row.entry.conversation.id}`) ?? -1
              return (
                <LiveRow
                  key={row.entry.conversation.id}
                  row={row}
                  model={model}
                  projectId={projectId}
                  index={index}
                  selected={index === selected}
                  onPick={() => {
                    setSelected(index)
                    open(lines[index])
                  }}
                />
              )
            }),
          )
        )}

        {/* --------------------------------------------------------- historique */}
        {model.days.length === 0 ? (
          <>
            <GroupHead label="Historique" />
            <Quiet className="px-4 py-2.5 md:px-6">
              {model.searching || model.kind !== 'all' ? 'Rien dans l’historique ne correspond.' : `Rien ces ${model.journalDays} derniers jours.`}
            </Quiet>
          </>
        ) : (
          model.days.map((day) => (
            <Fragment key={day.at}>
              <GroupHead label={dayLabel(day.at)} count={day.entries.length} />
              {day.entries.map((entry) => {
                const index = indexOf.get(`e-${entry.id}`) ?? -1
                return (
                  <EntryRow
                    key={entry.id}
                    entry={entry}
                    model={model}
                    projectId={projectId}
                    index={index}
                    selected={index === selected}
                    onPick={() => {
                      setSelected(index)
                      open(lines[index])
                    }}
                  />
                )
              })}
            </Fragment>
          ))
        )}
      </div>
      <CardDrawerHost />
    </div>
  )
}

function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-4 min-w-4 items-center justify-center rounded border border-line px-1 font-sans text-[10px] text-ink-soft">
      {children}
    </kbd>
  )
}

/** Un en-tête de groupe fin : le libellé, le compte, et rien d'autre. */
function GroupHead({ label, count, tone }: { label: string; count?: number; tone?: 'caution' }) {
  return (
    <div className="sticky top-[1.875rem] z-10 flex items-baseline gap-2 border-b border-line bg-sunken/80 px-4 py-1 backdrop-blur md:px-6">
      <span className={cx('text-xs font-medium first-letter:uppercase', tone === 'caution' ? 'text-caution' : 'text-ink-soft')}>{label}</span>
      {count !== undefined ? <span className="text-xs text-ink-faint tabular-nums">{count}</span> : null}
    </div>
  )
}

const rowShape = (selected: boolean) =>
  cx(
    COLUMNS,
    'relative min-h-9 w-full cursor-default border-b border-line/60 px-4 py-1.5 text-left text-sm md:px-6',
    selected ? 'bg-accent-wash/40' : 'hover:bg-sunken/50',
  )

/** Le liseré de la ligne choisie au clavier. */
function Cursor({ on }: { on: boolean }) {
  return on ? <span aria-hidden className="absolute inset-y-0 left-0 w-0.5 bg-accent" /> : null
}

function LiveRow({
  row,
  model,
  projectId,
  index,
  selected,
  onPick,
}: {
  row: ActivityRow
  model: ActivityModel
  projectId: string
  index: number
  selected: boolean
  onPick: () => void
}) {
  const { conversation } = row.entry
  const milestone = model.milestoneOfRow(row)
  const expanded = row.request !== null && model.isExpanded(conversation.id)
  return (
    <div data-row={index}>
      <div role="button" tabIndex={-1} onClick={onPick} className={rowShape(selected)}>
        <Cursor on={selected} />
        <span className="text-xs text-ink-faint tabular-nums">{shortAge(conversation.updatedAt)}</span>
        <span className="hidden items-center gap-2 text-xs text-ink-soft md:flex">
          <Marker marker={row.marker} decorative />
          Session
        </span>
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="min-w-0 truncate text-ink">{conversation.title}</span>
          {row.summary ? (
            <span className={cx('hidden min-w-0 truncate text-xs lg:block', SUMMARY_TONE[row.summary.tone])}>{row.summary.text}</span>
          ) : null}
        </span>
        <span className="hidden min-w-0 items-center gap-1 text-xs text-ink-faint md:flex">
          {conversation.card ? <span className="shrink-0 tabular-nums">#{conversation.card.number}</span> : null}
          {milestone ? <MilestoneTag milestone={milestone} projectId={projectId} /> : null}
        </span>
        <span className="hidden justify-center md:flex">
          <AgentIcon agent={conversation.agent} size={13} />
        </span>
        <span
          className={cx(
            'flex items-center justify-end gap-1 text-xs',
            row.group === 'asking' ? 'font-medium text-caution' : 'text-ink-soft',
          )}
        >
          {STATE_LABEL[row.group]}
          {row.request ? <ChevronRight size={12} className={cx('transition-transform', expanded && 'rotate-90')} /> : null}
        </span>
      </div>
      {expanded && row.request ? (
        <div className="border-b border-line bg-caution/5 px-4 py-2 md:pl-[11.75rem]">
          <SessionRequestPreview
            conversationPath={conversationPath(conversation)}
            conversationId={conversation.id}
            request={row.request}
            canDecide={conversation.isOwner}
          />
        </div>
      ) : null}
    </div>
  )
}

function EntryRow({
  entry,
  model,
  projectId,
  index,
  selected,
  onPick,
}: {
  entry: JournalEntryDto
  model: ActivityModel
  projectId: string
  index: number
  selected: boolean
  onPick: () => void
}) {
  const t = useTranslate()
  const milestone = model.milestoneOfEntry(entry)
  const conversation = model.conversationOf(entry)
  const linked = model.entryHref(entry) !== null
  return (
    <div data-row={index} role={linked ? 'button' : undefined} tabIndex={-1} onClick={onPick} className={rowShape(selected)}>
      <Cursor on={selected} />
      <span className="text-xs text-ink-faint tabular-nums">{timeOf(entry.at)}</span>
      <span className={cx('hidden items-center gap-2 text-xs md:flex', journalIconTone(entry))}>
        <span className="flex w-3.5 shrink-0 justify-center [&>svg]:size-3.5">{JOURNAL_KIND_ICONS[entry.kind]}</span>
        <span className="truncate text-ink-soft">{t(JOURNAL_KIND_LABELS[entry.kind])}</span>
      </span>
      <span className="min-w-0 truncate text-ink">{entry.title}</span>
      <span className="hidden min-w-0 items-center gap-1 text-xs text-ink-faint md:flex">
        {entry.cardNumber !== null ? <span className="shrink-0 tabular-nums">#{entry.cardNumber}</span> : null}
        {milestone ? <MilestoneTag milestone={milestone} projectId={projectId} /> : null}
      </span>
      <span className="hidden justify-center md:flex">{conversation ? <AgentIcon agent={conversation.agent} size={13} /> : null}</span>
      <span className="truncate text-right text-xs text-ink-faint">{entry.source ?? (linked ? '' : '—')}</span>
    </div>
  )
}
