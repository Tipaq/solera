import { FolderGit2, GitBranch } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { ConversationDto } from '@solera/protocol'
import { cx } from '@solera/ui'
import { AgentIcon } from '../AgentIcon'
import { StateDot } from '../chat/Signals'
import { conversationPath } from '../../lib/conversation-route'
import { shortAge } from '../../lib/dates'
import { useTranslate } from '../../lib/i18n'
import type { SessionPlace } from '../../lib/activity-groups'

/**
 * Le point d'une ligne : la charte de la colonne (`threadState`), plus un vert pour
 * « prête à relire », et un gris pour une session finie et déjà lue.
 */
export type SessionMarker = 'working' | 'awaiting' | 'broken' | 'unread' | 'review' | 'quiet'

/** Ce que dit la quatrième colonne, et dans quel ton. */
export interface SessionSummary {
  text: string
  tone: 'caution' | 'critical' | 'soft'
}

const SUMMARY_TONE: Record<SessionSummary['tone'], string> = {
  caution: 'text-caution',
  critical: 'text-critical',
  soft: 'text-ink-soft',
}

/**
 * Les colonnes, les mêmes pour toutes les lignes d'une liste : des largeurs fixes et
 * non mesurées sur le contenu, sinon chaque ligne aurait les siennes et l'œil ne
 * descendrait plus. Exportées pour que l'en-tête d'une liste, s'il en vient un, les
 * reprenne.
 */
export const SESSION_ROW_COLUMNS =
  'md:grid md:grid-cols-[0.375rem_1rem_12rem_minmax(0,1fr)_3.5rem_10rem_4rem] xl:grid-cols-[0.375rem_1rem_18rem_minmax(0,1fr)_3.5rem_15rem_4rem]'

/**
 * Les mêmes, sous l'en-tête d'un worktree (planche B3) : la colonne de la branche tombe,
 * puisque l'en-tête la porte.
 */
export const SESSION_ROW_COLUMNS_IN_TREE =
  'md:grid md:grid-cols-[0.375rem_1rem_12rem_minmax(0,1fr)_3.5rem_4rem] xl:grid-cols-[0.375rem_1rem_18rem_minmax(0,1fr)_3.5rem_4rem]'

/**
 * Une session sur une ligne, dans l'onglet Activité d'un projet.
 *
 * **Huit colonnes, toujours à la même place** (planche B4) : point d'état, agent, nom,
 * résumé d'une ligne, carte, worktree et branche, PR, âge. La PR n'a pas encore de
 * colonne : son badge arrive avec #115, qui l'insérera avant l'âge. Le résumé d'une
 * ligne n'existe pas encore non plus (#113) : en attendant, la colonne dit l'attente ou
 * l'erreur, et rien sinon.
 *
 * **Au téléphone** (planche E1), la ligne passe sur deux étages — le nom et l'âge, puis
 * le résumé et la branche — et la carte tombe : elle est le plus souvent dans le nom de
 * la branche.
 *
 * **Sous l'en-tête d'un worktree** (`inTree`, planche B3), la ligne perd sa colonne
 * worktree et branche : l'en-tête la dit pour toutes ses lignes.
 *
 * Toute la ligne mène au fil. La carte n'est donc pas un lien à part : un lien dans un
 * lien n'est pas du HTML valide, et son titre reste au survol.
 */
export function SessionRow({
  conversation,
  marker,
  summary,
  place,
  inTree = false,
}: {
  conversation: Pick<ConversationDto, 'id' | 'projectId' | 'title' | 'agent' | 'card' | 'updatedAt'>
  marker: SessionMarker
  summary: SessionSummary | null
  place: SessionPlace
  inTree?: boolean
}) {
  const t = useTranslate()
  const age = shortAge(conversation.updatedAt)
  const where = place.root ? (
    <>
      <GitBranch size={13} aria-hidden className="shrink-0 text-ink-faint" />
      <span className="truncate font-mono text-xs text-ink-soft">
        {place.branch ? t('projectActivity.row.rootBranch', { branch: place.branch }) : t('projectActivity.row.root')}
      </span>
    </>
  ) : (
    <>
      <FolderGit2 size={13} aria-hidden className="shrink-0 text-ink-faint" />
      <span className="truncate font-mono text-xs text-ink-soft">{place.branch ?? t('projectActivity.row.worktree')}</span>
    </>
  )

  return (
    <li>
      <Link
        to={conversationPath(conversation)}
        className={cx(
          'grid grid-cols-[0.375rem_minmax(0,1fr)] gap-x-3 gap-y-1 px-4 py-2.5 md:items-center md:py-2',
          inTree ? SESSION_ROW_COLUMNS_IN_TREE : SESSION_ROW_COLUMNS,
          'hover:bg-sunken/60 focus-visible:bg-sunken/60 focus-visible:outline-none',
        )}
      >
        <span className="mt-[0.45rem] self-start md:mt-0 md:self-center">
          <Marker marker={marker} />
        </span>

        <span className="hidden text-ink-faint md:inline-flex">
          <AgentIcon agent={conversation.agent} size={14} />
        </span>

        {/* Au téléphone, le nom et l'âge partagent le premier étage. */}
        <span className="flex min-w-0 items-baseline gap-2 md:contents">
          <span className="min-w-0 flex-1 truncate text-sm text-ink md:flex-none">{conversation.title}</span>
          <span className="shrink-0 text-xs text-ink-faint tabular-nums md:hidden">{age}</span>
        </span>

        <span
          className={cx(
            'col-start-2 min-w-0 truncate text-sm md:col-start-auto',
            summary ? SUMMARY_TONE[summary.tone] : 'hidden md:block',
          )}
        >
          {summary?.text}
        </span>

        <span className="hidden md:block">
          {conversation.card ? (
            <span
              title={conversation.card.title}
              className="rounded-md bg-sunken px-1.5 py-0.5 font-mono text-xs text-ink-soft"
            >
              #{conversation.card.number}
            </span>
          ) : null}
        </span>

        {inTree ? null : (
          <span className="col-start-2 flex min-w-0 items-center gap-1.5 md:col-start-auto">{where}</span>
        )}

        <span className="hidden text-right text-xs text-ink-faint tabular-nums md:block">{age}</span>
      </Link>
    </li>
  )
}

/**
 * Le point, nommé pour un lecteur d'écran : la ligne ne dit son état nulle part ailleurs.
 * `decorative` quand le libellé d'à côté le dit déjà, comme l'en-tête d'un groupe.
 */
export function Marker({ marker, decorative = false }: { marker: SessionMarker; decorative?: boolean }) {
  const t = useTranslate()
  if (marker === 'review' || marker === 'quiet') {
    const label = t(marker === 'review' ? 'projectActivity.group.review' : 'projectActivity.group.done')
    return (
      <span
        role={decorative ? undefined : 'img'}
        aria-hidden={decorative ? true : undefined}
        aria-label={decorative ? undefined : label}
        title={label}
        className={cx('block size-1.5 shrink-0 rounded-full', marker === 'review' ? 'bg-positive' : 'bg-ink-faint')}
      />
    )
  }
  return <StateDot state={marker} labelled={!decorative} />
}
