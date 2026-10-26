import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  VaultNoteContentDto,
  VaultNoteDto,
  VaultNoteFactsDto,
  VaultNoteFilter,
  VaultNoteHistoryDto,
  VaultReindexDto,
  VaultStateDto,
  VaultTreeDto,
  VaultWriteNoteDto,
} from '@solera/protocol'
import { api } from './api'

/**
 * L'index du vault, côté interface.
 *
 * Tout passe par l'index et rien par le disque : c'est ce qui rend les liens entrants,
 * les liens cassés et les compteurs immédiats. Un index en retard rend des faits en
 * retard, et c'est l'état du vault — `indexedCommit` contre `headCommit` — qui le dit,
 * pas un silence.
 *
 * Le chemin d'une note est sa clé de cache, et il part en paramètre de requête : une
 * note vit dans des dossiers, et le routeur réduirait `Dossier/../Note` à `Note`.
 */

const VAULT_KEY = ['vault']

export function useVaultState(enabled = true) {
  return useQuery({
    queryKey: [...VAULT_KEY, 'state'],
    enabled,
    queryFn: () => api.get<VaultStateDto>('/api/vault'),
  })
}

/**
 * Tout réindexer.
 *
 * Invalide tout ce qui vient de l'index, et pas seulement son état : les listes et les
 * faits d'une note en sortent aussi, et les laisser en cache afficherait l'index
 * d'avant sous un compteur d'après.
 */
export function useReindexVault() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => api.post<VaultReindexDto>('/api/vault/reindex', {}),
    onSuccess: (result) => {
      queryClient.setQueryData([...VAULT_KEY, 'state'], result.state)
      queryClient.invalidateQueries({ queryKey: VAULT_KEY })
    },
  })
}

/** Une note en paramètre de requête : son chemin porte des barres obliques. */
const noteQuery = (path: string) => `path=${encodeURIComponent(path)}`

export function useVaultNotes(
  query: { filter?: VaultNoteFilter; folder?: string; limit?: number },
  enabled = true,
) {
  const params = new URLSearchParams()
  if (query.filter) params.set('filter', query.filter)
  if (query.folder) params.set('folder', query.folder)
  if (query.limit) params.set('limit', String(query.limit))

  return useQuery({
    queryKey: [...VAULT_KEY, 'notes', query.filter ?? 'all', query.folder ?? '', query.limit ?? 0],
    enabled,
    queryFn: () => api.get<VaultNoteDto[]>(`/api/vault/notes?${params.toString()}`),
  })
}

export function useVaultTree(enabled = true) {
  return useQuery({
    queryKey: [...VAULT_KEY, 'tree'],
    enabled,
    queryFn: () => api.get<VaultTreeDto>('/api/vault/tree'),
  })
}

/** Les faits du texte d'une note : ses deux bouts de liens, et ses compteurs. */
export function useVaultNoteFacts(path: string | null) {
  return useQuery({
    queryKey: [...VAULT_KEY, 'facts', path],
    enabled: path !== null,
    queryFn: () => api.get<VaultNoteFactsDto>(`/api/vault/note?${noteQuery(path ?? '')}`),
  })
}

/**
 * Le texte d'une note, lu sur le disque.
 *
 * Pas de rafraîchissement automatique : l'éditeur tient le texte une fois ouvert, et
 * une relecture en arrière-plan écraserait ce qui est en train d'être tapé. C'est
 * l'empreinte, à l'enregistrement, qui dit qu'on n'est plus seul sur le fichier.
 */
export function useVaultNoteContent(path: string | null) {
  return useQuery({
    queryKey: [...VAULT_KEY, 'content', path],
    enabled: path !== null,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    queryFn: () => api.get<VaultNoteContentDto>(`/api/vault/note/content?${noteQuery(path ?? '')}`),
  })
}

export function useVaultNoteHistory(path: string | null, enabled = true) {
  return useQuery({
    queryKey: [...VAULT_KEY, 'history', path],
    enabled: enabled && path !== null,
    queryFn: () => api.get<VaultNoteHistoryDto>(`/api/vault/note/history?${noteQuery(path ?? '')}`),
  })
}

/**
 * Enregistrer une note.
 *
 * La réponse porte les faits relus par l'index : poser l'empreinte et invalider le
 * reste suffit, et l'éditeur n'a pas à relire le texte qu'il vient d'écrire.
 */
export function useSaveNote() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { path: string; content: string; fingerprint: string | null }) =>
      api.put<VaultWriteNoteDto>('/api/vault/note/content', input),
    onSuccess: (result, input) => {
      queryClient.setQueryData<VaultNoteContentDto>([...VAULT_KEY, 'content', input.path], (held) =>
        held ? { ...held, content: input.content, fingerprint: result.fingerprint } : held,
      )
      // Les liens, les compteurs et l'état de l'index ont tous pu bouger d'une seule
      // écriture : un `[[lien]]` tapé change les faits de deux notes.
      queryClient.invalidateQueries({ queryKey: [...VAULT_KEY, 'facts'] })
      queryClient.invalidateQueries({ queryKey: [...VAULT_KEY, 'notes'] })
      queryClient.invalidateQueries({ queryKey: [...VAULT_KEY, 'state'] })
      queryClient.invalidateQueries({ queryKey: [...VAULT_KEY, 'history', input.path] })
    },
  })
}

/** Créer une note. Dossier vide : c'est une ébauche, et personne d'autre ne la voit. */
export function useCreateNote() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { folder?: string; title: string }) =>
      api.post<VaultNoteDto>('/api/vault/notes', input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: VAULT_KEY }),
  })
}

/**
 * *Garder en note* : le fil devient une ébauche du vault (carte #118). Les intitulés
 * des deux voix sont ceux de l'interface, dans sa langue.
 */
export function useKeepConversationAsNote() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { conversationId: string; roles: { user: string; assistant: string } }) =>
      api.post<VaultNoteDto>('/api/vault/notes/from-conversation', input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: VAULT_KEY }),
  })
}

/** L'adresse d'une note dans l'interface. */
export function notePath(note: Pick<VaultNoteDto, 'path'>): string {
  return `/vault/note/${note.path.split('/').map(encodeURIComponent).join('/')}`
}
