import assert from 'node:assert/strict'

/**
 * L'URL sous laquelle le serveur de dev de Vite sert une dépendance pré-empaquetée,
 * telle que l'importe un module de l'application.
 *
 * Une suite qui monte un composant seul doit prendre ses fournisseurs (React Query, le
 * routeur, les aides de `@solera/ui`) dans **le même module** que lui : importé sans le
 * `?v=` de Vite, le paquet serait chargé une seconde fois et son contexte serait un autre.
 * L'URL versionnée se lit donc dans la source transformée d'un module qui l'importe.
 *
 * Le chemin ne dépend que du nom du paquet : `@solera/ui` est servi comme
 * `/node_modules/.vite/deps/@solera_ui.js`, d'où qu'il vienne (depuis la PR #22, du dépôt
 * `Tipaq/solera-ds` et non plus de `packages/ui`).
 */
export async function viteDependency(origin, name, importer) {
  const source = await (await fetch(new URL(importer, origin))).text()
  const file = name.replaceAll('/', '_').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = new RegExp(`from "(/node_modules/\\.vite/deps/${file}\\.js\\?v=[^"]+)"`).exec(source)
  assert.ok(match, `${importer} n'importe pas ${name} depuis les dépendances pré-empaquetées de Vite`)
  return match[1]
}
