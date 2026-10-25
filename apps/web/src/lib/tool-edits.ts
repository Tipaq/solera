import { countTextChanges } from '@solera/protocol'
import type { ToolItem } from './chat-fold'
import { parseUnifiedDiff } from './diff'
import { fields, list, text } from './tool-payload'

/**
 * Ce qu'un appel d'édition change, quel que soit le CLI qui l'a fait.
 *
 * `scope` dit ce que le compteur mesure, parce que les quatre adaptateurs ne disent pas
 * la même chose : un patch (Codex, `apply_patch` d'OpenCode) donne le vrai diff du
 * fichier ; un fragment remplacé (`Edit` de Claude, d'OpenCode, `search_replace` de
 * Grok) ne donne que l'extrait, sans savoir combien de fois il se trouve dans le
 * fichier sauf `replace_all` ; un `Write` donne les lignes écrites, pas l'écart avec ce
 * que le fichier contenait.
 */
export interface EditPresentation {
  paths: string[]
  counts: { added: number; removed: number } | null
  scope: 'patch' | 'fragment' | 'replacement' | 'written'
  /** Les changements par fichier de Codex, quand chacun se lit. */
  changes?: unknown[]
  /** Un patch natif d'un seul tenant, à rendre comme un diff. */
  patch?: string
}

/** Au-delà, compter coûterait plus qu'il n'apprend : le compteur disparaît. */
const MAX_PATCH_CHARS = 1_000_000

/**
 * Les changements d'un appel Codex. Un journal antérieur au rafraîchissement de
 * l'entrée à la complétion n'a les changements définitifs que dans la sortie.
 */
function changesOf(tool: ToolItem): unknown[] | null {
  const output = tool.output
  if (tool.status === 'done' && Array.isArray(output) && output.length > 0 &&
    output.every((change) => text(change, 'path') !== null && text(fields(change)?.kind, 'type') !== null)) return output
  return list(tool.input, 'changes')
}

function codexCounts(changes: unknown[]): EditPresentation['counts'] {
  const counts = { added: 0, removed: 0 }
  let chars = 0
  for (const change of changes) {
    const diff = fields(change)?.diff
    const kind = text(fields(change)?.kind, 'type')
    if (typeof diff !== 'string') return null
    chars += diff.length
    if (chars > MAX_PATCH_CHARS) return null
    // Un ajout ou une suppression porte le contenu entier ; une mise à jour, des sections de diff.
    let next: EditPresentation['counts'] = null
    if (kind === 'add') next = countTextChanges('', diff)
    else if (kind === 'delete') next = countTextChanges(diff, '')
    else if (kind === 'update' && (diff === '' || /^@@ /m.test(diff))) {
      const file = parseUnifiedDiff(`diff --git a/file b/file\n${diff}`)[0]
      next = file ? { added: file.added, removed: file.removed } : { added: 0, removed: 0 }
    }
    if (!next) return null
    counts.added += next.added
    counts.removed += next.removed
  }
  return counts
}

/** Le format `*** Begin Patch` d'`apply_patch` : chemins et lignes, sans le contexte. */
function nativePatch(patch: string): EditPresentation {
  const paths: string[] = []
  let added = 0
  let removed = 0
  let counting = false
  let known = true
  for (const line of patch.split(/\r?\n/)) {
    const file = /^\*\*\* (Add|Update|Delete) File: (.+)$/.exec(line)
    if (file) {
      paths.push(file[2]!)
      counting = file[1] !== 'Delete'
      // Une suppression ne porte pas l'ancien contenu : le total ne se reconstitue pas.
      if (file[1] === 'Delete') known = false
    } else if (line.startsWith('*** Move to: ')) paths[paths.length - 1] = line.slice(13)
    else if (counting && line.startsWith('+')) added += 1
    else if (counting && line.startsWith('-')) removed += 1
  }
  return { paths: [...new Set(paths)], counts: paths.length && known ? { added, removed } : null, scope: 'patch', patch }
}

/**
 * Chemins et lignes changées d'un appel d'édition, pour le résumé, le compteur et la
 * vue dépliée. Un payload mal formé rend `null` ou un compteur nul, jamais une erreur :
 * la vue brute reste là.
 */
export function toolEdits(tool: ToolItem): EditPresentation | null {
  if (tool.name === 'Write') {
    const path = text(tool.input, 'file_path') ?? text(tool.input, 'path')
    const content = fields(tool.input)?.content
    return { paths: path ? [path] : [], counts: typeof content === 'string' ? countTextChanges('', content) : null, scope: 'written' }
  }
  if (tool.name !== 'Edit' && tool.name !== 'ApplyPatch') return null

  const changes = changesOf(tool)
  if (changes?.length) {
    const paths = [...new Set(changes.flatMap((change) => text(change, 'path') ?? []))]
    const readable = changes.every((change) => text(change, 'path') !== null && typeof fields(change)?.diff === 'string' &&
      ['add', 'delete', 'update'].includes(text(fields(change)?.kind, 'type') ?? ''))
    return { paths, counts: codexCounts(changes), scope: 'patch', ...(readable ? { changes } : {}) }
  }

  const input = fields(tool.input)
  const path = text(input, 'file_path') ?? text(input, 'path')
  const before = input?.old_string
  const after = input?.new_string
  if (tool.name === 'Edit' && typeof before === 'string' && typeof after === 'string') {
    return { paths: path ? [path] : [], counts: countTextChanges(before, after), scope: input?.replace_all === true ? 'replacement' : 'fragment' }
  }

  const patch = text(input, 'patch') ?? text(input, 'diff')
  if (!patch || patch.length > MAX_PATCH_CHARS) return path ? { paths: [path], counts: null, scope: 'patch' } : null
  if (patch.startsWith('*** Begin Patch')) return nativePatch(patch)
  const files = parseUnifiedDiff(patch.startsWith('diff --git ') ? patch : `diff --git a/${path ?? 'file'} b/${path ?? 'file'}\n${patch}`)
  const counts = files.some((file) => file.hunks.length > 0)
    ? files.reduce((sum, file) => ({ added: sum.added + file.added, removed: sum.removed + file.removed }), { added: 0, removed: 0 })
    : null
  return { paths: path ? [path] : files.map((file) => file.path).filter((file) => file !== 'file'), counts, scope: 'patch', patch }
}
