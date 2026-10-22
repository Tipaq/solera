import { readFile, writeFile, copyFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { Resvg } from '@resvg/resvg-js'

// Le rendu passe par resvg et non par un navigateur : Chromium réclame des
// bibliothèques système (libnspr4, libnss3) qu'on ne peut pas installer sans
// privilèges, alors que resvg est un binaire autonome. Le script tourne donc
// partout, y compris sur une machine de développement verrouillée.

const root = new URL('../', import.meta.url)
const target = (name) => fileURLToPath(new URL(name, root))
const symbol = await readFile(target('docs/brand/symbol.svg'), 'utf8')
const paths = [...symbol.matchAll(/<path d="([^"]+)"/g)].map((match) => `<path d="${match[1]}"/>`).join('')
if (paths.length === 0) throw new Error('Le symbole de référence ne contient aucun tracé.')

async function render(name, width, svg) {
  const png = new Resvg(svg, {
    fitTo: { mode: 'width', value: width },
    // Le fond est porté par le SVG lui-même ; les icônes rondes gardent leurs coins
    // transparents, ce que `background` non défini laisse passer.
    font: { loadSystemFonts: true, defaultFontFamily: 'Arial' },
  }).render().asPng()
  await writeFile(target(name), png)
}

for (const [name, size, rounded] of [
  ['icon-192.png', 192, true],
  ['icon-512.png', 512, true],
  ['icon-maskable-512.png', 512, false],
  ['apple-touch-icon.png', 180, false],
]) {
  // Le cadre central de 64 % tient dans le cercle sûr de 80 %, même aux extrémités.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
    <rect width="100" height="100" rx="${rounded ? 23 : 0}" fill="#2e5e43"/>
    <g transform="translate(18 18) scale(.64)" fill="white">${paths}</g>
  </svg>`
  await render(`apps/web/public/${name}`, size, svg)
}

// L'application de bureau, au gabarit des icônes macOS : la tuile occupe 824 px d'un
// carré de 1024, aux coins de 185 px, et la marge reste transparente pour l'ombre que le
// Dock dessine. Le symbole garde le cadre de 64 % des icônes web. electron-builder en
// tire l'.icns du Mac et les tailles de Linux.
const desktop = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
  <rect x="100" y="100" width="824" height="824" rx="185" fill="#2e5e43"/>
  <g transform="translate(248.3 248.3) scale(5.2736)" fill="white">${paths}</g>
</svg>`
await render('apps/desktop/resources/icon.png', 1024, desktop)

// Un même visuel de partage évite de laisser l’ancienne marque sur le site.
const og = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#10251a"/>
  <g transform="translate(85 145) scale(1.5)" fill="#7fbe98">${paths}</g>
  <g font-family="Arial, sans-serif">
    <text x="278" y="260" fill="#ffffff" font-size="92" font-weight="700" letter-spacing="-3">solera</text>
    <text x="96" y="373" fill="#d6e9dd" font-size="30">Plateforme de développement agentique self-hosted</text>
    <text x="96" y="426" fill="#9dbfa9" font-size="26">Claude Code, Codex et OpenCode dans une seule interface.</text>
    <text x="96" y="552" fill="#9dbfa9" font-size="22">github.com/Tipaq/solera</text>
  </g>
</svg>`
await render('apps/web/public/og.png', 1200, og)
await copyFile(target('apps/web/public/og.png'), target('site/og.png'))
