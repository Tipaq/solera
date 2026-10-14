import { Search } from 'lucide-react'
import { useMemo } from 'react'
import type { ConversationDto, ProjectDto } from '@solera/protocol'
import { useTranslate, type MessageKey } from '../../lib/i18n'
import { ConversationLine } from './ConversationLine'

/** Au-delà, c'est la palette qui cherche : la colonne liste le récent, pas le tout. */
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
export function PlaceThreads({ conversations, projects, onNavigate, onSearch }: {
  conversations: ConversationDto[]
  projects: ProjectDto[]
  onNavigate: () => void
  onSearch: () => void
}) {
  const t = useTranslate()
  const groups = useMemo(() => {
    const midnight = startOfToday()
    const sorted = [...conversations].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, SHOWN)
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
  }, [conversations])

  return (
    <div className="px-2 pb-4">
      {groups.map((group) => (
        <section key={group.key}>
          <h2 className="px-2.5 pt-2 pb-1 text-meta font-semibold uppercase tracking-wider text-ink-faint">
            {t(group.key)}
          </h2>
          <ul>
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

      {/* Ce qui déborde ne se compte pas ici : la recherche le retrouve mieux qu'une
          liste de plus. */}
      <button
        type="button"
        onClick={onSearch}
        className="flex h-11 w-full items-center gap-2 rounded-md px-2.5 text-left text-sm text-ink-faint transition-colors hover:bg-surface-high hover:text-ink md:h-8 pointer-coarse:h-11"
      >
        <Search size={14} className="shrink-0" />
        {t('shell.threads.all')}
      </button>
    </div>
  )
}
