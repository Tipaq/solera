#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/**
 * Génère le CSS des échelles statiques du design system depuis leur source TypeScript.
 *
 *   node scripts/ui-tokens.mjs          écrit packages/ui/src/styles/scales.generated.css
 *   node scripts/ui-tokens.mjs --check  échoue si le fichier commité a dérivé
 *
 * Même rôle que `codex:types:check` : une valeur changée dans `tokens.ts` sans
 * régénération devient un échec visible et non une table de catalogue qui annonce
 * 1.5rem là où le navigateur applique 1rem.
 *
 * Volontairement un fichier à part, et non `index.css` régénéré en entier : `index.css`
 * est écrit à la main et ses commentaires portent des règles — pourquoi il n'importe pas
 * Tailwind lui-même, pourquoi la clé Tailwind et le jeton source ne portent jamais le
 * même nom.
 */

const root = join(fileURLToPath(import.meta.url), '../..')
const source = join(root, 'packages/ui/src/tokens.ts')
const target = join(root, 'packages/ui/src/styles/scales.generated.css')
const check = process.argv.includes('--check')

const { CSS_SCALES } = await import(pathToFileURL(source).href)

const header = `/*
 * Fichier généré depuis \`${relative(root, source)}\` par \`pnpm ui:tokens\`.
 * Ne pas éditer à la main : \`pnpm ui:tokens:check\` compare les deux en CI.
 *
 * Importé par \`index.css\`, qui reste écrit à la main. Les valeurs sont littérales : ni
 * thémables ni sujettes à l'auto-référence, contrairement aux couleurs.
 */`

/** Un commentaire de bloc indenté, à partir de lignes de prose déjà coupées. */
function comment(lines, indent) {
  return [`${indent}/*`, ...lines.map((line) => `${indent} * ${line}`), `${indent} */`].join('\n')
}

function render() {
  const groups = []
  for (const { note, steps } of CSS_SCALES) {
    const body = []
    if (note) body.push(comment(note, '  '))
    for (const step of steps) {
      // Un pas sans jeton vient de l'échelle intégrée de Tailwind : rien à déclarer.
      if (!step.token) continue
      if (step.note) body.push(`  /* ${step.note} */`)
      body.push(`  ${step.token}: ${step.value};`)
    }
    if (body.length > 0) groups.push(body.join('\n'))
  }
  return `${header}\n\n@theme {\n${groups.join('\n\n')}\n}\n`
}

const generated = render()
const current = (() => {
  try {
    return readFileSync(target, 'utf8')
  } catch {
    return null
  }
})()

if (check) {
  if (current === generated) {
    console.log(`Échelles à jour (${relative(root, target)}).`)
    process.exit(0)
  }
  console.error(
    current === null
      ? `${relative(root, target)} est absent.`
      : `${relative(root, target)} a dérivé de ${relative(root, source)}.`,
  )
  console.error('\nLancer `pnpm ui:tokens` puis relire le diff avant de commiter.')
  process.exit(1)
}

if (current === generated) {
  console.log(`Échelles déjà à jour (${relative(root, target)}).`)
  process.exit(0)
}

writeFileSync(target, generated)
console.log(`Échelles régénérées dans ${relative(root, target)}.`)
