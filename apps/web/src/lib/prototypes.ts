import { useEffect, useRef } from 'react'
import type { ChatItem, ToolItem } from './chat-fold'
import { outputText } from './tool-payload'
import { openWebPage } from './web-pane'

/**
 * Les prototypes du design system lié (carte #63) : l'outil `show_prototype` rend
 * l'adresse d'une story sous le relais de Solera, et la vue *Web* l'ouvre.
 *
 * Le nom de l'outil diffère d'un CLI à l'autre (`mcp__solera__show_prototype`,
 * `solera/show_prototype`…) : seule la fin compte.
 */
const PROTOTYPE_TOOL = /(?:^|__|\/|_)show_prototype$/

/** Le chemin du relais : un jeton, puis la page de Storybook. */
const RELAY_URL = /^URL: (\/ds\/[0-9a-f]{32}\/\S+)$/m

export function isPrototypeTool(name: string): boolean {
  return PROTOTYPE_TOOL.test(name)
}

/** L'adresse de l'aperçu qu'un appel réussi a rendue, sur l'origine de Solera. */
export function prototypeUrl(tool: ToolItem): string | null {
  if (!isPrototypeTool(tool.name) || tool.status !== 'done') return null
  const output = outputText(tool.output)
  const path = output?.match(RELAY_URL)?.[1]
  return path ? new URL(path, window.location.origin).href : null
}

/**
 * Ouvre dans la vue *Web* l'aperçu qu'un agent vient de montrer.
 *
 * Seulement ceux qui aboutissent pendant qu'on regarde : un fil rouvert ne rouvre pas
 * chacun de ses aperçus. Ce qui a déjà abouti quand le fil a fini de charger est
 * compté comme vu.
 */
export function useAutoOpenPrototypes(scope: string | undefined, items: ChatItem[], loading: boolean): void {
  const seen = useRef<Set<string> | null>(null)

  useEffect(() => {
    seen.current = null
  }, [scope])

  useEffect(() => {
    if (loading || !scope) return
    const shown = items.filter((item): item is ToolItem => item.kind === 'tool' && prototypeUrl(item) !== null)
    if (seen.current === null) {
      seen.current = new Set(shown.map((tool) => tool.id))
      return
    }
    for (const tool of shown) {
      if (seen.current.has(tool.id)) continue
      seen.current.add(tool.id)
      const url = prototypeUrl(tool)
      if (url) openWebPage(scope, url)
    }
  }, [scope, items, loading])
}
