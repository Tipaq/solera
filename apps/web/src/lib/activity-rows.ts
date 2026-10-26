import { useMemo } from 'react'
import type { ProjectDto, ProjectPullRequestDto } from '@solera/protocol'
import type { SessionMarker, SessionSummary } from '../components/project/SessionRow'
import { useLiveConversations, type LiveConversation } from './activity'
import { activityGroupOf, sessionPlaceOf, type ActivityGroup, type SessionPlace } from './activity-groups'
import { useCards } from './cards'
import { useAllConversations } from './conversations'
import { shortAge } from './dates'
import { useTranslate } from './i18n'
import { isOpenPullRequest, pullRequestFor, usePullRequests } from './pull-requests'
import { requestLine, useSessionRequests, type SessionRequest } from './session-requests'
import { threadState } from './signals'
import { useWorktreeStatuses } from './worktrees'

/** Une session telle que la montre une ligne de l'Activité. */
export interface ActivityRow {
  entry: LiveConversation
  group: ActivityGroup
  marker: SessionMarker
  summary: SessionSummary | null
  place: SessionPlace
  /** La PR de la branche de la session (#115) ; jamais pour la racine. */
  pr: ProjectPullRequestDto | null
  /** Ce que la session te demande, à déplier sous sa ligne (#112). */
  request: SessionRequest | null
}

/**
 * Les lignes de l'Activité d'un projet, la plus récente d'abord : l'onglet les groupe,
 * le bloc « En ce moment » de l'Aperçu en garde les vivantes. Les deux lisent donc les
 * mêmes requêtes, et une session n'y change pas de point ni de résumé d'une vue à
 * l'autre.
 *
 * Rien n'est lu par fil. Les sessions viennent de la liste partagée avec la colonne, leur
 * état du socket, leur branche de **la** liste d'état des worktrees du projet (#78), la
 * colonne de leur carte du board, et la PR de leur branche de **la** liste des PR du
 * projet (#115). Leurs demandes ouvertes viennent d'une requête pour tout le projet, et
 * des décisions de la section « À décider » (#112).
 */
export function useActivityRows(projectId: string | undefined, project: ProjectDto | undefined): ActivityRow[] {
  const t = useTranslate()
  const { data: conversations } = useAllConversations()
  const { data: cards } = useCards(projectId)
  const { data: trees } = useWorktreeStatuses(project?.git ? projectId : undefined)
  const { data: pullRequests } = usePullRequests(project?.git ? projectId : undefined)

  const mine = useMemo(
    () => (conversations ?? []).filter((entry) => entry.projectId === projectId),
    [conversations, projectId],
  )
  const live = useLiveConversations(mine)
  const requests = useSessionRequests(projectId, live)

  return useMemo(() => {
    // La colonne du board plutôt que celle figée dans la conversation : le board se
    // relit à chaque déplacement de carte, la liste des conversations non.
    const columns = new Map((cards ?? []).map((card) => [card.id, card.column]))
    const rootBranch = project?.git?.branch ?? null
    return live
      .map((entry): ActivityRow => {
        const card = entry.conversation.card
        const place = sessionPlaceOf(entry.conversation, trees, rootBranch)
        // La branche par défaut ne porte pas de PR : c'est elle que les PR visent.
        const pr = place.root ? null : pullRequestFor(pullRequests, place.branch)
        const request = requests.get(entry.conversation.id) ?? null
        const group = activityGroupOf(entry, card ? (columns.get(card.id) ?? card.column) : null, {
          openPr: isOpenPullRequest(pr),
          requested: request !== null,
        })
        const state = threadState({ status: entry.status, busy: entry.running, unread: entry.unread })
        return {
          entry,
          group,
          marker: markerOf(group, state),
          summary: summaryOf(entry, state, request, t),
          place,
          pr,
          request,
        }
      })
      .sort((a, b) => b.entry.conversation.updatedAt - a.entry.conversation.updatedAt)
  }, [live, requests, cards, trees, pullRequests, project, t])
}

function markerOf(group: ActivityGroup, state: ReturnType<typeof threadState>): SessionMarker {
  if (group === 'asking') return state === 'broken' ? 'broken' : 'awaiting'
  if (group === 'running') return 'working'
  if (group === 'review') return 'review'
  return state === 'unread' ? 'unread' : 'quiet'
}

/**
 * La quatrième colonne, en attendant le résumé d'une ligne (#113) : ce que la session te
 * demande et depuis quand, « Attend 3 min · » puis la question (planche B2), ou qu'elle
 * est tombée. Rien sinon, plutôt qu'un texte qui ferait croire à un résumé.
 */
function summaryOf(
  entry: LiveConversation,
  state: ReturnType<typeof threadState>,
  request: SessionRequest | null,
  t: ReturnType<typeof useTranslate>,
): SessionSummary | null {
  if (request) {
    return {
      text: t('projectActivity.row.asking', { age: shortAge(request.requestedAt), request: requestLine(request, t) }),
      tone: 'caution',
    }
  }
  if (state === 'awaiting') return { text: t('projectActivity.row.waiting', { age: shortAge(entry.since) }), tone: 'caution' }
  if (state === 'broken') {
    return {
      text: t(entry.status === 'interrupted' ? 'projectActivity.row.interrupted' : 'projectActivity.row.error'),
      tone: 'critical',
    }
  }
  return null
}
