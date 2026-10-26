import { FolderGit2, GitBranch } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { ConversationDto, ProjectPullRequestDto } from '@solera/protocol'
import { cx } from '@solera/ui'
import { AgentIcon } from '../AgentIcon'
import { StateDot } from '../chat/Signals'
import { PrBadge } from './PrBadge'
import { conversationPath } from '../../lib/conversation-route'
import { shortAge } from '../../lib/dates'
import { useTranslate } from '../../lib/i18n'
import type { SessionPlace } from '../../lib/activity-groups'
import type { SessionRequest } from '../../lib/session-requests'
import { SessionRequestPreview } from './SessionRequestPreview'

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
  'md:grid md:grid-cols-[0.375rem_1rem_12rem_minmax(0,1fr)_3.5rem_10rem_6.5rem_4rem] xl:grid-cols-[0.375rem_1rem_18rem_minmax(0,1fr)_3.5rem_15rem_7.5rem_4rem]'

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
 * résumé d'une ligne, carte, worktree et branche, PR, âge. La PR est celle de la
 * branche, quelle que soit la session qui l'a ouverte : la relecture d'une PR, qui vit
 * dans le même arbre, porte le même badge. Le résumé d'une ligne n'existe pas encore
 * (#113) : en attendant, la colonne dit l'attente ou l'erreur, et rien sinon.
 *
 * **Au téléphone** (planche E1), la ligne passe sur deux étages — le nom et l'âge, puis
 * le résumé, la branche et la PR — et la carte tombe : elle est le plus souvent dans le
 * nom de la branche.
 *
 * **Sous l'en-tête d'un worktree** (`inTree`, planche B3), la ligne perd ses colonnes
 * worktree et branche, et PR : l'en-tête les dit pour toutes ses lignes.
 *
 * Toute la ligne mène au fil. La carte n'est donc pas un lien à part : un lien dans un
 * lien n'est pas du HTML valide, et son titre reste au survol.
 *
 * **Une session qui te demande quelque chose se déplie** (planche B2) quand la liste le
 * permet (`onToggle`) : la ligne devient le bouton qui ouvre l'aperçu en place, et
 * « Ouvrir le fil » passe dans l'aperçu. Pas de tiroir : il cacherait les colonnes
 * worktree et PR. Les chiffres du clavier choisissent parmi les options numérotées.
 * Chaque ligne porte `data-session-row`, pour que la liste la parcoure à ↑ et ↓.
 */
export function SessionRow({
  conversation,
  marker,
  summary,
  place,
  inTree = false,
  pr = null,
  request = null,
  expanded = false,
  onToggle,
}: {
  conversation: Pick<ConversationDto, 'id' | 'projectId' | 'title' | 'agent' | 'card' | 'updatedAt' | 'isOwner'>
  marker: SessionMarker
  summary: SessionSummary | null
  place: SessionPlace
  inTree?: boolean
  /** La PR de la branche de la session, si elle en a une. Jamais montrée sous un en-tête de worktree, qui la porte. */
  pr?: ProjectPullRequestDto | null
  request?: SessionRequest | null
  expanded?: boolean
  onToggle?: () => void
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

  const cells = (
    <>
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
        <>
          <span className="col-start-2 flex min-w-0 items-center gap-1.5 md:col-start-auto">
            {where}
            {pr ? <PrBadge pr={pr} className="ml-1.5 shrink-0 md:hidden" /> : null}
          </span>

          <span className="hidden min-w-0 md:block">{pr ? <PrBadge pr={pr} /> : null}</span>
        </>
      )}

      <span className="hidden text-right text-xs text-ink-faint tabular-nums md:block">{age}</span>
    </>
  )
  const path = conversationPath(conversation)
  const rowClass = cx(
    'grid w-full grid-cols-[0.375rem_minmax(0,1fr)] gap-x-3 gap-y-1 px-4 py-2.5 text-left md:items-center md:py-2',
    inTree ? SESSION_ROW_COLUMNS_IN_TREE : SESSION_ROW_COLUMNS,
    'hover:bg-sunken/60 focus-visible:bg-sunken/60 focus-visible:outline-none',
  )
  const foldable = request !== null && onToggle !== undefined

  return (
    <li
      onKeyDown={
        foldable && expanded
          ? (event) => {
              // Un chiffre choisit l'option numérotée, sauf quand on écrit.
              if (!/^[1-9]$/.test(event.key) || event.metaKey || event.ctrlKey || event.altKey) return
              if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return
              const choice = event.currentTarget.querySelector<HTMLButtonElement>(`[data-choice="${event.key}"]`)
              if (!choice || choice.disabled) return
              event.preventDefault()
              choice.click()
            }
          : undefined
      }
    >
      {foldable ? (
        <button
          type="button"
          data-session-row
          aria-expanded={expanded}
          onClick={onToggle}
          className={cx(rowClass, expanded && 'bg-sunken/60')}
        >
          {cells}
        </button>
      ) : (
        <Link to={path} data-session-row className={rowClass}>
          {cells}
        </Link>
      )}
      {foldable && expanded ? (
        <SessionRequestPreview
          conversationPath={path}
          conversationId={conversation.id}
          request={request}
          canDecide={conversation.isOwner}
        />
      ) : null}
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
