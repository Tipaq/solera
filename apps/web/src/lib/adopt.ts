import { useCallback } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useMoveConversation } from './conversations'
import { conversationPath } from './conversation-route'

/**
 * *En faire un projet*, côté page de création.
 *
 * Le geste part d'un fil libre : ce qui lui manquait est un répertoire de travail, et
 * c'est exactement ce que la page de création demande. Elle est donc réutilisée telle
 * quelle, avec le fil à adopter passé en `?adopt=`, plutôt qu'une seconde page qui
 * reposerait les mêmes questions.
 *
 * Le repli compte autant que le cas nominal : un projet créé dont le déplacement échoue
 * reste un projet créé, et on ouvre alors ce projet plutôt que de laisser l'écran sur
 * un formulaire déjà soumis.
 */
export function useAdoptAfterCreate(): (projectId: string) => void {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const move = useMoveConversation()
  const adopted = params.get('adopt')

  return useCallback(
    (projectId: string) => {
      if (!adopted) {
        navigate(`/p/${projectId}/c/new`)
        return
      }
      move.mutate(
        { id: adopted, projectId },
        {
          onSuccess: () => navigate(conversationPath({ id: adopted, projectId })),
          onError: () => navigate(`/p/${projectId}/c/new`),
        },
      )
    },
    [adopted, move, navigate],
  )
}
