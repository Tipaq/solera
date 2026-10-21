import type { ReactNode } from 'react'
import type { ToolItem } from '../../lib/chat-fold'
import { isPrototypeTool } from '../../lib/prototypes'
import { VIEWS, genericView, prototypeView } from './views'

/**
 * Le registre des renderers d'outils.
 *
 * Trois niveaux, du plus précis au plus sûr : la vue dédiée à l'outil, la vue
 * générique qui met en forme n'importe quel payload, et la vue brute (le JSON tel
 * qu'il est en base) que `ToolCall` affiche quand les deux premières déclarent forfait
 * ou que l'utilisateur la demande.
 *
 * Le repli est décidé par la vue elle-même, à l'exécution, et non par la seule
 * présence du nom dans la table : rien ne garantit qu'un outil nommé `Edit` porte les
 * champs qu'`Edit` porte d'habitude, et un CLI peut en changer d'une version à
 * l'autre. Une vue qui ne reconnaît pas ce qu'on lui donne rend `null` plutôt que de
 * deviner.
 */
export function readableView(tool: ToolItem): ReactNode {
  // Un outil MCP porte un nom qui change avec le CLI : celui-là se reconnaît à sa fin.
  const view = VIEWS[tool.name] ?? (isPrototypeTool(tool.name) ? prototypeView : undefined)
  return view?.(tool) ?? genericView(tool)
}
