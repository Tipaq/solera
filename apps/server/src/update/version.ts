/**
 * La version installée. En build de release, tsup remplace l'expression
 * `process.env.SOLERA_VERSION` par le littéral dérivé du tag git, donc la
 * valeur est figée dans le bundle. En dev (tsx, pas de bundling), la variable
 * n'existe pas et on retombe sur `dev`.
 */
export const CURRENT_VERSION: string = process.env.SOLERA_VERSION ?? 'dev'

/**
 * Comparaison de versions maison plutôt qu'une dépendance semver : on ne
 * compare que nos propres tags `vX.Y.Z`. Un describe git (`0.18.0-113-g29f39cc4`,
 * ce que porte une version construite hors tag) vaut sa version de base : une
 * release plus récente le dépasse, la même ne le dépasse pas. Toute version non
 * parsable (`dev`) est traitée comme plus ancienne que n'importe quelle version
 * parsable ; c'est au checker de ne jamais proposer de mise à jour quand la
 * version installée n'est pas parsable.
 */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a)
  const pb = parseVersion(b)
  if (!pa && !pb) return 0
  if (!pa) return -1
  if (!pb) return 1
  if (pa[0] !== pb[0]) return pa[0] - pb[0]
  if (pa[1] !== pb[1]) return pa[1] - pb[1]
  return pa[2] - pb[2]
}

export function parseVersion(version: string): [number, number, number] | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-\d+-g[0-9a-f]+)?(?:-dirty)?$/.exec(version.trim())
  if (!match) return null
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}
