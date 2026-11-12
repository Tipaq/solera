import { useMemo } from 'react'
import type { ConversationDto, ProjectDto } from '@solera/protocol'
import { useOpenConversationId } from '../../lib/conversation-route'
import { useTranslate, type MessageKey } from '../../lib/i18n'
import { cutToBudget } from '../../lib/sidebar-budget'
import { AllSessionsLine } from './AllSessionsLine'
import { ConversationLine } from './ConversationLine'
import { useSessionBudget } from './fit-budget'

/** Au plus, quel que soit le réglage : la colonne liste le récent, `/sessions` le tout. */
const SHOWN = 40

const DAY = 86_400_000

/**
 * Les tranches de l'historique, de la plus récente à la plus ancienne. `since` est le
 * nombre de jours avant minuit à partir duquel la tranche commence.
 *
 * Des jours et non des projets : le lieu *Fils* répond à « qu'est-ce que je faisais ? »,
 * et la réponse est datée. Grouper par projet redirait le lieu *Projets* juste à côté.
 */
const BUCKETS: { key: MessageKey; since: number }[] = [
  { key: 'shell.threads.today', since: 0 },
  { key: 'shell.threads.yesterday', since: 1 },
  { key: 'shell.threads.week', since: 7 },
  { key: 'shell.threads.older', since: Infinity },
]

function startOfToday(): number {
  const date = new Date()
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

/**
 * Le lieu *Fils* : l'historique daté de toutes les conversations, projet ou non.
 *
 * Pas de groupes par projet — ce serait redire le lieu *Projets* juste à côté, et un
 * fil aurait deux domiciles. Ici il n'en a qu'un : sa date.
 */
export function PlaceThreads({ conversations, projects, onNavigate }: {
  conversations: ConversationDto[]
  projects: ProjectDto[]
  onNavigate: () => void
}) {
  const t = useTranslate()
  // Le réglage « Sessions dans la sidebar » coupe l'historique ; l'ouverte et celles qui
  // t'attendent restent.
  const budget = Math.min(SHOWN, useSessionBudget())
  const openId = useOpenConversationId()
  const groups = useMemo(() => {
    const midnight = startOfToday()
    const sorted = cutToBudget([...conversations].sort((a, b) => b.updatedAt - a.updatedAt), budget, openId)
    /*
      Les épinglées sortent des tranches et prennent la tête, comme la section *Pinned*
      de ChatGPT et les *Favoris* de Claude : une conversation qu'on épingle doit se
      retrouver au même endroit quel que soit le jour où on l'a touchée — sans quoi
      l'épingle ne voudrait pas la même chose ici et dans un projet.
    */
    const pinned = sorted.filter((entry) => entry.pinned)
    const dated = sorted.filter((entry) => !entry.pinned)
    const buckets = BUCKETS.map((bucket, index) => {
      // La tranche va de son début (inclus) à celui de la précédente (exclu).
      const start = bucket.since === Infinity ? -Infinity : midnight - bucket.since * DAY
      const end = index === 0 ? Infinity : midnight - BUCKETS[index - 1]!.since * DAY
      return {
        key: bucket.key,
        entries: dated.filter((entry) => entry.updatedAt >= start && entry.updatedAt < end),
      }
    })
    return [{ key: 'shell.threads.pinned' as MessageKey, entries: pinned }, ...buckets]
      .filter((group) => group.entries.length > 0)
  }, [conversations, budget, openId])
  const shown = groups.reduce((sum, group) => sum + group.entries.length, 0)
  const cut = shown < conversations.length

  return (
    <div className="px-2 pb-4">
      {groups.map((group, index) => (
        <section key={group.key}>
          <h2 className="px-2.5 pt-2 pb-1 text-meta font-semibold uppercase tracking-wider text-ink-faint">
            {t(group.key)}
          </h2>
          {/* Une seule coupe pour toutes les tranches, portée par la dernière : la mesure
              partage la place entre les listes coupées, et l'historique n'en est qu'une. */}
          <ul data-session-list data-cut={cut && index === groups.length - 1}>
            {group.entries.map((conversation) => (
              <ConversationLine
                key={conversation.id}
                conversation={conversation}
                project={projects.find((project) => project.id === conversation.projectId)}
                onNavigate={onNavigate}
                // L'ordre de l'historique est celui du temps : rien à y glisser.
              />
            ))}
          </ul>
        </section>
      ))}

      {conversations.length === 0 ? (
        <p className="px-2.5 py-2 text-sm text-ink-faint">{t('shell.conversations.empty')}</p>
      ) : null}

      {/* Ce qui déborde a sa page : toutes les sessions, filtrables et cherchables. Le
          total ne se dit que s'il y a une coupe. */}
      <AllSessionsLine
        to="/sessions"
        label={cut ? t('shell.sessions.all.count', { count: conversations.length }) : t('shell.sessions.all')}
        onNavigate={onNavigate}
      />
    </div>
  )
}
