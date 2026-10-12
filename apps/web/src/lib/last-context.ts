import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import type { ConversationDto, ProjectDto } from '@solera/protocol'
import { useCurrentUser } from './session'

const storageKey = (userId: string) => `solera.lastContext:${userId}`
const contextPattern = /^\/p\/([\w-]+)\/(board|c\/([\w-]+))(?:\?[^#]*)?$/
/** Les fils libres, qui n'ont pas de projet dans leur chemin. */
const freePattern = /^\/c\/([\w-]+)(?:\?[^#]*)?$/

/** Un ancien favori ne doit pas renvoyer vers un projet supprimé ou devenu privé. */
function accessible(path: string, projects: ProjectDto[], conversations: ConversationDto[]): boolean {
  const free = freePattern.exec(path)
  if (free) {
    // Rien à vérifier côté projet, il n'y en a pas ; reste que le fil existe encore et
    // qu'il n'a pas été rangé entre-temps, auquel cas son adresse a changé.
    return (
      free[1] === 'new' ||
      conversations.some((conversation) => conversation.id === free[1] && conversation.projectId === null)
    )
  }
  const match = contextPattern.exec(path)
  if (!match || !projects.some((project) => project.id === match[1])) return false
  return match[2] === 'board' || match[3] === 'new' || conversations.some(
    (conversation) => conversation.id === match[3] && conversation.projectId === match[1],
  )
}

export function lastContext(userId: string, projects: ProjectDto[], conversations: ConversationDto[]): string | null {
  try {
    const path = localStorage.getItem(storageKey(userId))
    return path && accessible(path, projects, conversations) ? path : null
  } catch {
    return null
  }
}

/** Les réglages et la page d'accueil ne remplacent jamais le travail à reprendre. */
export function useRememberContext(): void {
  const { pathname, search } = useLocation()
  const { data: user } = useCurrentUser()
  useEffect(() => {
    const path = pathname + search
    // Mémoriser dès la navigation : attendre les listes perd une visite courte.
    // Les droits et l'existence du fil seront vérifiés au moment de la reprise.
    if (!user || !(contextPattern.test(path) || freePattern.test(path))) return
    try {
      localStorage.setItem(storageKey(user.id), path)
    } catch {
      // Un stockage désactivé ne doit pas empêcher de naviguer.
    }
  }, [pathname, search, user])
}
