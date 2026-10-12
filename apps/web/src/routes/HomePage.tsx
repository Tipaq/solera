import { FolderOpen } from 'lucide-react'
import { Link, Navigate } from 'react-router-dom'
import { conversationPath } from '../lib/conversation-route'
import { useProjects } from '../lib/projects'
import { useAllConversations } from '../lib/conversations'
import { useCurrentUser } from '../lib/session'
import { lastContext } from '../lib/last-context'
import { Button, EmptyState } from '@solera/ui'
import { useTranslate } from '../lib/i18n'

export function HomePage() {
  const t = useTranslate()
  const { data: projects, isPending } = useProjects()
  const { data: conversations, isPending: conversationsPending } = useAllConversations()
  const { data: user } = useCurrentUser()

  if (isPending || conversationsPending) return null

  const remembered = user && projects && conversations
    ? lastContext(user.id, projects, conversations)
    : null
  if (remembered) return <Navigate to={remembered} replace />

  // Les fils libres comptent comme les autres : un projet supprimé laissait des fils
  // orphelins, un fil sans projet n'en a jamais eu, et ni l'un ni l'autre n'est une
  // raison de renvoyer quelqu'un sur un écran vide.
  const recent = conversations?.filter(
    (entry) =>
      !entry.archivedAt &&
      (entry.projectId === null || projects?.some((project) => project.id === entry.projectId)),
  )
    .sort((a, b) => b.updatedAt - a.updatedAt)[0]
  if (recent) return <Navigate to={conversationPath(recent)} replace />

  const first = projects?.[0]
  if (first) return <Navigate to={`/p/${first.id}/c/new`} replace />

  // Sans projet et sans fil : on ouvre quand même une conversation, parce que c'est ce
  // dont on a besoin pour poser une question. Créer un projet reste proposé, mais ce
  // n'est plus le péage — un projet est un répertoire de travail, et savoir qu'on en
  // veut un vient après avoir commencé à travailler.
  return (
    <EmptyState
      icon={<FolderOpen size={22} />}
      title={t('home.empty.title')}
      description={t('home.empty.description')}
      action={
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Link to="/c/new">
            <Button>{t('home.newConversation')}</Button>
          </Link>
          <Link to="/projects/new">
            <Button variant="secondary">{t('home.createProject')}</Button>
          </Link>
        </div>
      }
    />
  )
}
