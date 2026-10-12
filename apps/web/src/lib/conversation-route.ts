import { useMatch } from 'react-router-dom'

/**
 * Où vit une conversation dans l'URL : sous son projet, ou à la racine sans projet.
 *
 * Deux formes et non une seule, parce qu'un fil libre n'a pas de projet à mettre dans
 * le chemin : écrire `/p/${projectId}/c/${id}` sans y penser donne `/p/null/c/<id>`,
 * une URL qui a l'air juste, se charge, et ne trouve rien. Un seul endroit où la
 * composer, et un seul où la reconnaître.
 */
export function conversationPath(conversation: { id: string; projectId: string | null }): string {
  return conversation.projectId
    ? `/p/${conversation.projectId}/c/${conversation.id}`
    : `/c/${conversation.id}`
}

/**
 * La conversation ouverte, quelle que soit la forme de son chemin.
 *
 * `/c/new` est écarté : le routeur le donnerait comme identifiant, et une ligne de la
 * liste finirait par se croire ouverte parce qu'on vient de cliquer sur « + ».
 */
export function useOpenConversationId(): string | undefined {
  const inProject = useMatch('/p/:projectId/c/:conversationId')
  const free = useMatch('/c/:conversationId')
  const id = inProject?.params.conversationId ?? free?.params.conversationId
  return id === 'new' ? undefined : id
}
