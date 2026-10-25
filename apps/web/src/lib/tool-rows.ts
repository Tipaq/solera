import { isSpawnTool } from '@solera/protocol'
import { hasVisibleContent, type ChatItem, type ToolItem } from './chat-fold'
import { isSoleraTool } from './solera-tools'

/**
 * Mise en forme d'un fil avant rendu.
 *
 * Deux choses s'y jouent :
 *
 *   - un fil ne montre que ce que son auteur a produit. Ce qu'un sous-agent écrit et
 *     appelle porte l'identifiant de l'appel qui l'a lancé, et n'a rien à faire dans
 *     le fil principal : mêlé aux réponses de l'agent, il s'y lit comme si c'était
 *     lui qui parlait, et deux sous-agents en parallèle deviennent indémêlables. Le
 *     fil principal ne garde donc que l'appel de spawn ; le reste se lit dans le
 *     panneau, découpé par ce même module ;
 *   - une suite d'appels se replie en une ligne une fois que l'agent a repris la
 *     parole, parce qu'elle n'apporte plus rien ligne par ligne et éloigne la réponse.
 *     Tant qu'il travaille, chaque appel garde sa ligne : c'est ce qu'on regarde.
 */

export type ChatRow =
  | { kind: 'item'; key: string; item: ChatItem }
  | { kind: 'tool'; key: string; tool: ToolItem }
  /** `complete` : la suite est close (texte repris, tour fini) et aucun appel n'y tourne. */
  | { kind: 'tool-group'; key: string; tools: ToolItem[]; complete: boolean }

/**
 * Découpe un fil en lignes affichables.
 *
 * `thread` désigne l'auteur du fil : `null` pour l'agent principal, l'identifiant de
 * l'appel de spawn pour un sous-agent. Tout ce qui n'est ni message ni appel d'outil
 * (permission, plan, question, erreur, repère) n'a pas d'auteur et reste dans le fil
 * principal : c'est le seul endroit d'où l'on peut répondre à une sollicitation, et le
 * seul où une erreur de session a un sens.
 *
 * `turnRunning` dit si le tour est encore en cours : la dernière suite n'est close
 * qu'avec lui, ou quand du texte la suit.
 */
export function buildRows(items: ChatItem[], thread: string | null = null, turnRunning = false): ChatRow[] {
  const rows: ChatRow[] = []
  let run: ToolItem[] = []

  /**
   * Vide la suite courante, en une seule ligne quoi qu'elle contienne.
   *
   * Sa clé est celle de son premier appel dès qu'il démarre : la suite qui grandit, puis
   * se clôt, reste le même composant, et un groupe ouvert à la main ne se referme pas
   * parce qu'un appel de plus est arrivé. C'est `ToolCallGroup` qui décide de replier,
   * d'après `complete`.
   */
  const flush = (closed = false) => {
    const first = run[0]
    if (!first) return
    rows.push({ kind: 'tool-group', key: `tools-${first.id}`, tools: run, complete: closed && run.every((tool) => tool.status !== 'running') })
    run = []
  }

  for (const item of items) {
    if (item.kind === 'tool') {
      if (item.parentToolCallId !== thread) continue

      // Le lancement d'un sous-agent garde sa ligne : c'est le seul repère qui dise
      // qu'un pan entier du travail s'est fait ailleurs, et noyé dans « 5 outils » il
      // ne se distingue plus d'un `Read`.
      //
      // De même pour une tâche planifiée qui porte un script de vérification : sa ligne
      // porte la validation que l'agent vient de demander, qu'un repli cacherait.
      if (isSpawnTool(item.name) || proposesCheck(item)) {
        flush()
        rows.push({ kind: 'tool', key: item.id, tool: item })
      } else {
        run.push(item)
      }
      continue
    }

    if (item.kind === 'message') {
      if (item.parentToolCallId !== thread) continue
    } else if (thread !== null) {
      continue
    }

    // Un élément qui n'affiche rien ne doit pas interrompre la suite d'outils.
    if (!hasVisibleContent(item)) continue

    flush(speaks(item))
    rows.push({ kind: 'item', key: item.id, item })
  }
  flush(!turnRunning)

  // Une réflexion ou un repère peut séparer une suite du texte qui la clôt : c'est le
  // texte suivant, où qu'il soit, ou la fin du tour, qui ferme les suites d'avant.
  let spoken = !turnRunning
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index]!
    if (row.kind === 'item' && speaks(row.item)) spoken = true
    if (row.kind === 'tool-group' && spoken && row.tools.every((tool) => tool.status !== 'running')) row.complete = true
  }
  return rows
}

/** L'agent a repris la parole : un message qui porte du texte, en flux ou complet. */
function speaks(item: ChatItem): boolean {
  return item.kind === 'message' && (item.streamingText.trim().length > 0 ||
    item.blocks.some((block) => block.type === 'text' && block.text.trim().length > 0))
}

function proposesCheck(tool: ToolItem): boolean {
  if (!isSoleraTool(tool.name, 'schedule_task')) return false
  const input = tool.input as { check_script?: unknown } | null
  return typeof input?.check_script === 'string' && input.check_script.trim() !== ''
}
