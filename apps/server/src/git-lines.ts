import type { LineSelection } from '@solera/protocol'
import { GitError } from './git.js'

/**
 * Indexer **par bloc et par ligne** : le patch des seules lignes cochées.
 *
 * C'est la seule fonction du lot 3 qui ne soit pas un appel `git` direct (planche T3
 * de `docs/audits/2026-10-15-git/`). Git ne sait pas indexer une ligne : il sait
 * appliquer un patch à l'index (`git apply --cached`). Tout le travail est donc de
 * fabriquer, à partir du diff qu'on affichait, un patch qui ne contient que ce qui est
 * coché — et qui reste un patch valide, sans quoi `git apply` le refuse en bloc.
 *
 * **Les deux sens ne se construisent pas pareil, et c'est le piège du module.** Un
 * patch décrit une région contiguë : toute ligne présente dans l'image de départ doit
 * y figurer, en contexte à défaut de mieux, et toute ligne absente doit en être
 * retirée. Or l'image de départ n'est pas la même selon qu'on indexe ou qu'on retire :
 *
 * - **indexer** part du diff « arbre contre index » et l'applique à l'index. L'image
 *   de départ est l'index : elle contient le contexte et les lignes `-`. Une ligne `+`
 *   non cochée n'y est pas → on la retire du patch ; une ligne `-` non cochée y est et
 *   doit y rester → elle devient du contexte.
 * - **retirer** part du diff « index contre HEAD » et l'applique **à l'envers**
 *   (`--reverse`). L'image de départ est alors le côté « après » : contexte et lignes
 *   `+`. Les deux règles s'inversent donc exactement.
 *
 * Se tromper de sens ne donne pas un mauvais résultat : `git apply` refuse, parce que
 * le contexte ne correspond plus. C'est la bonne façon d'échouer, et le test la fixe.
 */

interface Hunk {
  header: string
  /** Le corps du bloc, dans l'ordre et marqueurs compris : ` `, `+`, `-`, `\`. */
  lines: string[]
  oldStart: number
  newStart: number
}

interface ParsedFile {
  /** `diff --git`, `index`, `---`, `+++` : tout ce qui précède le premier `@@`. */
  preamble: string[]
  hunks: Hunk[]
}

const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/

/**
 * Le diff d'**un** fichier, découpé en blocs.
 *
 * Le patch reçu est celui d'un seul fichier (`git diff -- <path>`) : si git en rend
 * plusieurs, c'est que le chemin était ambigu, et on refuse plutôt que d'indexer le
 * mauvais.
 */
export function parseFilePatch(patch: string): ParsedFile {
  const preamble: string[] = []
  const hunks: Hunk[] = []
  let current: Hunk | null = null
  let files = 0

  // Le saut de ligne final est retiré avant le découpage : sans ça, la chaîne vide
  // qu'il laisse passerait pour une ligne de contexte et fausserait les comptes.
  for (const line of patch.replace(/\n$/, '').split('\n')) {
    if (line.startsWith('diff --git ')) {
      files += 1
      if (files > 1) throw new GitError('Ce chemin désigne plusieurs fichiers.')
    }
    const bounds = HUNK.exec(line)
    if (bounds) {
      current = {
        header: line,
        lines: [],
        oldStart: Number(bounds[1]),
        newStart: Number(bounds[2]),
      }
      hunks.push(current)
      continue
    }
    if (!current) {
      // La dernière ligne d'un patch est vide : la garder ajouterait une ligne au
      // préambule, et `git apply` compte les lignes.
      if (line.length > 0) preamble.push(line)
      continue
    }
    // Une ligne vide dans le corps d'un bloc est une ligne de contexte vide : certains
    // producteurs de diff laissent tomber l'espace de tête, et la prendre pour la fin
    // du bloc couperait le patch en deux.
    if (line.length === 0) {
      current.lines.push(' ')
      continue
    }
    if (' +-\\'.includes(line[0] as string)) current.lines.push(line)
    else current = null
  }

  return { preamble, hunks }
}

/**
 * Le patch des seules lignes cochées, prêt pour `git apply --cached`.
 *
 * `reverse` dit lequel des deux sens on construit — voir l'en-tête du module, c'est la
 * décision qui porte tout le reste. La fonction ne l'applique pas elle-même : c'est
 * `git apply --cached --reverse` qui le fera, et elle rend un patch avant/après
 * ordinaire.
 *
 * Rend `''` quand rien de cochable n'a été retenu : l'appelant ne doit alors rien
 * appliquer du tout, plutôt que d'envoyer un patch vide que git refuserait.
 */
export function partialPatch(
  patch: string,
  selections: LineSelection[],
  reverse: boolean,
): string {
  const file = parseFilePatch(patch)
  const out: string[] = []
  // Décalage accumulé par les blocs déjà retenus : le second bloc d'un patch partiel
  // ne commence pas là où il commençait dans le patch complet.
  let drift = 0

  for (const selection of selections) {
    const hunk = file.hunks[selection.hunk]
    if (!hunk) throw stale()
    // La vérification qui rend le geste sûr : entre l'affichage et le clic, un agent a
    // pu écrire dans le fichier, et les rangs ne désigneraient plus les mêmes lignes.
    if (hunk.header !== selection.header) throw stale()

    const picked = new Set(selection.lines)
    const body: string[] = []
    let olds = 0
    let news = 0
    let touched = false

    hunk.lines.forEach((line, index) => {
      const marker = line[0] as string
      const text = line.slice(1)

      if (marker === '\\') {
        // « \ No newline at end of file » porte sur la ligne juste avant : elle ne
        // suit que si cette ligne-là a été retenue.
        if (body.length > 0) body.push(line)
        return
      }
      if (marker === ' ') {
        body.push(` ${text}`)
        olds += 1
        news += 1
        return
      }

      const chosen = picked.has(index)
      if (chosen) {
        touched = true
        body.push(line)
        if (marker === '-') olds += 1
        else news += 1
        return
      }

      // Non cochée : elle disparaît du patch ou passe en contexte, selon le sens.
      const keepAsContext = reverse ? marker === '+' : marker === '-'
      if (keepAsContext) {
        body.push(` ${text}`)
        olds += 1
        news += 1
      }
    })

    if (!touched) continue

    // L'image de départ — celle que git doit retrouver sur le disque — est le côté
    // « avant » à l'endroit, et le côté « après » à l'envers. C'est donc le numéro de
    // ce côté-là qui doit être exact, et l'autre qui se déduit du décalage accumulé.
    out.push(
      reverse
        ? `@@ -${hunk.newStart - drift},${olds} +${hunk.newStart},${news} @@`
        : `@@ -${hunk.oldStart},${olds} +${hunk.oldStart + drift},${news} @@`,
    )
    out.push(...body)
    drift += news - olds
  }

  if (out.length === 0) return ''
  return [...file.preamble, ...out, ''].join('\n')
}

/** Le diff a bougé sous le clic : refuser vaut mieux qu'indexer autre chose. */
function stale(): GitError {
  return new GitError(
    'Ce fichier a changé depuis l’affichage : relis la vue avant d’indexer des lignes.',
  )
}
