import { useMemo } from 'react'
import type { ProjectDto } from '@solera/protocol'
import type { SessionMarker, SessionSummary } from '../components/project/SessionRow'
import { useLiveConversations, type LiveConversation } from './activity'
import { activityGroupOf, sessionPlaceOf, type ActivityGroup, type SessionPlace } from './activity-groups'
import { useCards } from './cards'
import { useAllConversations } from './conversations'
import { shortAge } from './dates'
import { useTranslate } from './i18n'
import { threadState } from './signals'
import { useWorktreeStatuses } from './worktrees'

/** Une session telle que la montre une ligne de l'Activité. */
export interface ActivityRow {
  entry: LiveConversation
  group: ActivityGroup
  marker: SessionMarker
  summary: SessionSummary | null
  place: SessionPlace
}

/**
 * Les lignes de l'Activité d'un projet, la plus récente d'abord : l'onglet les groupe,
 * le bloc « En ce moment » de l'Aperçu en garde les vivantes. Les deux lisent donc les
 * mêmes requêtes, et une session n'y change pas de point ni de résumé d'une vue à
 * l'autre.
 *
 * Rien n'est lu par fil. Les sessions viennent de la liste partagée avec la colonne, leur
 * état du socket, leur branche de **la** liste d'état des worktrees du projet (#78), et
 * la colonne de leur carte du board.
 */
export function useActivityRows(projectId: string | undefined, project: ProjectDto | undefined): ActivityRow[] {
  const t = useTranslate()
  const { data: conversations } = useAllConversations()
  const { data: cards } = useCards(projectId)
  const { data: trees } = useWorktreeStatuses(project?.git ? projectId : undefined)

  const mine = useMemo(
    () => (conversations ?? []).filter((entry) => entry.projectId === projectId),
    [conversations, projectId],
  )
  const live = useLiveConversations(mine)

  return useMemo(() => {
    // La colonne du board plutôt que celle figée dans la conversation : le board se
    // relit à chaque déplacement de carte, la liste des conversations non.
    const columns = new Map((cards ?? []).map((card) => [card.id, card.column]))
    const rootBranch = project?.git?.branch ?? null
    return live
      .map((entry): ActivityRow => {
        const card = entry.conversation.card
        const group = activityGroupOf(entry, card ? (columns.get(card.id) ?? card.column) : null)
        const state = threadState({ status: entry.status, busy: entry.running, unread: entry.unread })
        return {
          entry,
          group,
          marker: markerOf(group, state),
          summary: summaryOf(entry, state, t),
          place: sessionPlaceOf(entry.conversation, trees, rootBranch),
        }
      })
      .sort((a, b) => b.entry.conversation.updatedAt - a.entry.conversation.updatedAt)
  }, [live, cards, trees, project, t])
}

function markerOf(group: ActivityGroup, state: ReturnType<typeof threadState>): SessionMarker {
  if (group === 'asking') return state === 'broken' ? 'broken' : 'awaiting'
  if (group === 'running') return 'working'
  if (group === 'review') return 'review'
  return state === 'unread' ? 'unread' : 'quiet'
}

/**
 * La quatrième colonne, en attendant le résumé d'une ligne (#113) et la question en
 * attente (#112) : depuis quand une session attend, ou qu'elle est tombée. Rien sinon,
 * plutôt qu'un texte qui ferait croire à un résumé.
 */
function summaryOf(
  entry: LiveConversation,
  state: ReturnType<typeof threadState>,
  t: ReturnType<typeof useTranslate>,
): SessionSummary | null {
  if (state === 'awaiting') return { text: t('projectActivity.row.waiting', { age: shortAge(entry.since) }), tone: 'caution' }
  if (state === 'broken') {
    return {
      text: t(entry.status === 'interrupted' ? 'projectActivity.row.interrupted' : 'projectActivity.row.error'),
      tone: 'critical',
    }
  }
  return null
}
