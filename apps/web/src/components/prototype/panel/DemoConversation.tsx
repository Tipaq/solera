/* PROTOTYPE — jetable (branche proto/page-projet). Ne pas fusionner dans main.
 *
 * Les jeux de démo du proto citent des sessions qui n'existent pas (`demo-…`). Plutôt
 * qu'une page « conversation introuvable », on ouvre la conversation réelle la plus
 * récente du projet, et on le dit : `?depuis=<id de démo>` porte la trace, et un repère
 * fuchsia la rappelle tant qu'on reste dessus.
 */
import { useEffect } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useAllConversations } from '../../../lib/conversations'

export const isDemoConversation = (id: string | undefined): boolean => Boolean(id?.startsWith('demo'))

export function DemoConversationRedirect() {
  const { projectId, conversationId } = useParams()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { data: conversations, isPending } = useAllConversations()
  const target = (conversations ?? [])
    .filter((entry) => entry.projectId === projectId && entry.archivedAt === null)
    .sort((a, b) => b.updatedAt - a.updatedAt)[0]

  useEffect(() => {
    if (isPending || !target || !projectId) return
    const next = new URLSearchParams(params)
    next.set('depuis', conversationId ?? 'demo')
    navigate(`/p/${projectId}/c/${target.id}?${next.toString()}`, { replace: true })
  }, [isPending, target, projectId, conversationId, params, navigate])

  if (!isPending && !target) {
    return <p className="p-6 text-sm text-ink-faint">Session de démo : ce projet n’a aucune conversation réelle à ouvrir à la place.</p>
  }
  return null
}

/** Le repère, sur la conversation réelle ouverte à la place d'une session de démo. */
export function DemoConversationNotice() {
  const [params, setParams] = useSearchParams()
  const from = params.get('depuis')
  if (!from) return null
  return (
    <div className="pointer-events-auto fixed top-14 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-full border border-dashed border-fuchsia-500/60 bg-canvas px-3 py-1 text-xs text-fuchsia-700 shadow-lg dark:text-fuchsia-300">
      Session de démo « {from} » inexistante : voici la conversation réelle la plus récente du projet.
      <button
        type="button"
        aria-label="Fermer"
        onClick={() => setParams((current) => { current.delete('depuis'); return current }, { replace: true })}
        className="text-ink-faint hover:text-ink"
      >
        ✕
      </button>
    </div>
  )
}
