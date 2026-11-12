import { createContext, useContext, useEffect, useRef, useState } from 'react'
import type { TerminalServerMessage } from '@solera/protocol'
import { useTerminalsReload } from './terminals'

/** Ce que le lecteur utilise d'une socket : de quoi recevoir, et fermer. */
export type TerminalSocket = Pick<WebSocket, 'onmessage' | 'onerror' | 'close'>

/** L'adresse de la socket d'un terminal, pour le lecteur comme pour l'onglet Terminaux. */
export function terminalSocketUrl(projectId: string, terminalId: string): string {
  return (
    `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}` +
    `/api/projects/${projectId}/terminal?terminalId=${encodeURIComponent(terminalId)}`
  )
}

function openSocket(projectId: string, terminalId: string): TerminalSocket {
  return new WebSocket(terminalSocketUrl(projectId, terminalId))
}

/** D'où viennent les sockets : le serveur, ou une sortie rejouée dans les stories. */
const TerminalSockets = createContext<(projectId: string, terminalId: string) => TerminalSocket>(openSocket)
export const TerminalSocketsProvider = TerminalSockets.Provider

/** Ce qu'on garde de la sortie : le tampon de restitution du serveur en fait autant. */
const KEEP_CHARS = 128 * 1024
/** Une sortie rapide arrive par centaines de messages : on la peint par paquets. */
const FLUSH_MS = 150

/**
 * La sortie d'un terminal, **lue sans y écrire** : le tampon à l'attachement, puis le
 * flux. Rien n'est envoyé par la socket, pas même la taille, qui redimensionnerait
 * l'écran de qui le regarde dans l'onglet Terminaux. Le texte est brut (ANSI, `\r\n`) :
 * à l'appelant de le nettoyer (`command-output.ts`). `null` tant qu'on n'a rien reçu ;
 * `unreadable` quand la socket est refusée.
 *
 * L'`exit` recharge la liste des terminaux : c'est lui, et non la réponse d'« Arrêter »,
 * qui dit que la commande est finie.
 */
export function useTerminalOutput(
  projectId: string,
  terminalId: string | null,
  /** La liste la croit en cours : une fin survenue avant l'attachement la recharge aussi. */
  running = false,
): { text: string | null; unreadable: boolean } {
  const [text, setText] = useState<string | null>(null)
  const [unreadable, setUnreadable] = useState(false)
  const reload = useTerminalsReload(projectId)
  const open = useContext(TerminalSockets)
  const runningRef = useRef(running)
  runningRef.current = running
  useEffect(() => {
    setText(null)
    setUnreadable(false)
    if (!terminalId) return
    let buffer: string | null = null
    let timer: number | null = null
    const flush = () => {
      timer = null
      setText(buffer)
    }
    const socket = open(projectId, terminalId)
    socket.onmessage = (event) => {
      const payload = JSON.parse(String(event.data)) as TerminalServerMessage
      if (payload.t === 'ready') {
        buffer = payload.replay
        flush()
        if (payload.exited && runningRef.current) reload()
      } else if (payload.t === 'output') {
        buffer = ((buffer ?? '') + payload.data).slice(-KEEP_CHARS)
        timer ??= window.setTimeout(flush, FLUSH_MS)
      } else if (payload.t === 'exit') {
        if (timer !== null) window.clearTimeout(timer)
        flush()
        reload()
      } else setUnreadable(true)
    }
    socket.onerror = () => setUnreadable(true)
    return () => {
      if (timer !== null) window.clearTimeout(timer)
      // Fermée avant d'être ouverte (un double montage), elle signale une erreur après
      // coup : elle ne parle plus pour le terminal qu'on regarde.
      socket.onmessage = null
      socket.onerror = null
      socket.close()
    }
  }, [projectId, terminalId, reload, open])
  return { text, unreadable }
}
