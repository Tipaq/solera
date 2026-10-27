import { SquareKanban } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { CardDto, ProjectDto } from '@solera/protocol'
import { cx } from '@solera/ui'
import { ProjectAvatar } from '../ProjectAvatar'
import { shortAge } from '../../lib/dates'
import { useTranslate } from '../../lib/i18n'
import {
  Marker,
  ProjectCell,
  SESSION_ROW_COLUMNS_WITH_PROJECT,
  SUMMARY_TONE,
  type SessionMarker,
  type SessionSummary,
} from './SessionRow'

/**
 * Une carte qui réclame quelqu'un sans qu'aucune session ne la porte, dans l'Activité
 * du portefeuille (planche D1) : la même ligne qu'une session, aux mêmes colonnes,
 * avec l'icône du board à la place de l'agent et « aucune session » à la place de la
 * branche. Elle mène à la carte, ouverte sur le board de son projet.
 */
export function CardActivityRow({
  card,
  project,
  marker,
  summary,
  since,
}: {
  card: Pick<CardDto, 'projectId' | 'number' | 'title'>
  project: Pick<ProjectDto, 'name' | 'image' | 'color'>
  marker: SessionMarker
  summary: SessionSummary
  /** Depuis quand elle réclame, pour la colonne de l'âge. */
  since: number
}) {
  const t = useTranslate()
  const age = shortAge(since)
  return (
    <li>
      <Link
        to={`/p/${card.projectId}/board?carte=${card.number}`}
        data-session-row
        className={cx(
          'grid w-full grid-cols-[0.375rem_minmax(0,1fr)] gap-x-3 gap-y-1 px-4 py-2.5 text-left md:items-center md:py-2',
          SESSION_ROW_COLUMNS_WITH_PROJECT,
          'hover:bg-sunken/60 focus-visible:bg-sunken/60 focus-visible:outline-none',
        )}
      >
        <span className="mt-[0.45rem] self-start md:mt-0 md:self-center">
          <Marker marker={marker} />
        </span>

        <span className="hidden text-ink-faint md:inline-flex">
          <SquareKanban size={14} aria-label={t('portfolioActivity.card.icon')} />
        </span>

        <ProjectCell project={project} />

        <span className="flex min-w-0 items-baseline gap-2 md:contents">
          <ProjectAvatar project={project} className="size-3 self-center md:hidden" />
          <span className="min-w-0 flex-1 truncate text-sm text-ink md:flex-none">{card.title}</span>
          <span className="shrink-0 text-xs text-ink-faint tabular-nums md:hidden">{age}</span>
        </span>

        <span className={cx('col-start-2 min-w-0 truncate text-sm md:col-start-auto', SUMMARY_TONE[summary.tone])}>
          {summary.text}
        </span>

        <span className="hidden md:block">
          <span className="rounded-md bg-sunken px-1.5 py-0.5 font-mono text-xs text-ink-soft">#{card.number}</span>
        </span>

        <span className="col-start-2 min-w-0 truncate text-sm text-ink-faint md:col-start-auto">
          {t('portfolioActivity.card.noSession')}
        </span>

        <span aria-hidden className="hidden md:block" />

        <span className="hidden text-right text-xs text-ink-faint tabular-nums md:block">{age}</span>
      </Link>
    </li>
  )
}
