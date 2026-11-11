import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { TerminalServerMessage } from '@solera/protocol'

/** Au-delà, on garde la fin : c'est elle qu'on lit sous un essai. */
const MAX_CHARS = 64_000

/**
 * La sortie d'un terminal du projet, lue par sa socket en lecture seule : la relecture
 * qu'il garde, puis ce qui arrive. Brute, ANSI compris : c'est l'appelant qui la nettoie,
 * il sait ce qu'il en montre. `unreadable` quand la socket refuse ou tombe.
 *
 * Rien n'est jamais écrit dans le terminal, et la taille n'est pas imposée : on n'est
 * qu'un lecteur de plus à côté de l'onglet Terminaux. À sa fin, la liste des terminaux
 * est relue : c'est l'`exit` de la socket, et non la réponse d'un arrêt, qui dit qu'il
 * est fini (#201).
 */
export function useTerminalOutput(projectId: string, terminalId: string | null): { text: string | null; exited: boolean; unreadable: boolean } {
  const [state, setState] = useState<{ id: string | null; text: string | null; exited: boolean; unreadable: boolean }>({
    id: null,
    text: null,
    exited: false,
    unreadable: false,
  })

  const queryClient = useQueryClient()
  useEffect(() => {
    if (!terminalId) return
    setState({ id: terminalId, text: '', exited: false, unreadable: false })
    const socket = new WebSocket(
      `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}` +
        `/api/projects/${projectId}/terminal?terminalId=${encodeURIComponent(terminalId)}`,
    )
    const append = (chunk: string) =>
      setState((current) => ({ ...current, text: ((current.text ?? '') + chunk).slice(-MAX_CHARS) }))
    socket.onmessage = (event) => {
      const payload = JSON.parse(String(event.data)) as TerminalServerMessage
      if (payload.t === 'ready') {
        setState((current) => ({ ...current, text: payload.replay.slice(-MAX_CHARS), exited: payload.exited }))
      } else if (payload.t === 'output') append(payload.data)
      else if (payload.t === 'exit') {
        setState((current) => ({ ...current, exited: true }))
        void queryClient.invalidateQueries({ queryKey: ['terminals', projectId] })
      }
      else setState((current) => ({ ...current, unreadable: true }))
    }
    socket.onerror = () => setState((current) => ({ ...current, unreadable: true }))
    return () => socket.close()
  }, [projectId, terminalId, queryClient])

  // Un autre terminal que celui lu : rien encore.
  if (!terminalId || state.id !== terminalId) return { text: null, exited: false, unreadable: false }
  return { text: state.text, exited: state.exited, unreadable: state.unreadable }
}

const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?|\x1b[()][0-9A-Za-z]|\x1b./g

/**
 * Le texte lisible d'une sortie : l'ANSI retiré, chaque ligne réduite à ce qu'un retour
 * chariot y a laissé en dernier (une barre de progression ne garde que son état final).
 */
export function plainOutput(raw: string): string {
  return raw
    .replace(ANSI, '')
    .split('\n')
    .map((line) => {
      const parts = line.replace(/\r$/, '').split('\r')
      return parts[parts.length - 1]!.trimEnd()
    })
    .join('\n')
    .replace(/\n+$/, '')
}
