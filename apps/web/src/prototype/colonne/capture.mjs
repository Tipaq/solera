// PROTOTYPE JETABLE — une image par variante, par état et par mode, dans /tmp/proto-demandes.
// node apps/web/src/prototype/colonne/capture.mjs (le serveur du prototype doit tourner sur 5433)
import { mkdirSync, writeFileSync } from 'node:fs'
import { launchBrowser } from '../../../../../scripts/checks/browser.mjs'

const OUT = '/tmp/proto-demandes'
const BASE = 'http://127.0.0.1:5433/prototype-colonne.html'
const browser = await launchBrowser()
const index = []

async function shot({ dir, file, query, phone }) {
  mkdirSync(`${OUT}/${dir}`, { recursive: true })
  const context = await browser.newContext(phone
    ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
    : { viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 })
  const page = await context.newPage()
  await page.goto(`${BASE}?${query}&bar=off`)
  await page.waitForSelector(phone ? '[data-shot=telephone]' : '[data-shot=colonne]')
  await page.waitForTimeout(250)
  // Le haut de la colonne seulement, jusqu'au bas de la zone basse : c'est ce qui se juge.
  await page.locator(phone ? '[data-shot=telephone]' : '[data-shot=colonne]').screenshot({ path: `${OUT}/${dir}/${file}.png`, animations: 'disabled' })
  index.push(`${dir}/${file}.png`)
  await context.close()
}

const STATES = ['one', 'mixed', 'many']
for (const mode of ['tree', 'project']) {
  await shot({ dir: 'ordinateur', file: `${mode === 'tree' ? '1-arbre' : '2-projet'}-0-vide`, query: `state=empty&mode=${mode}` })
  for (const variant of ['A', 'B', 'C']) {
    for (const [i, state] of STATES.entries()) {
      await shot({ dir: 'ordinateur', file: `${mode === 'tree' ? '1-arbre' : '2-projet'}-${variant}-${i + 1}-${state}`, query: `variant=${variant}&state=${state}&mode=${mode}` })
    }
  }
}
for (const variant of ['A', 'B', 'C']) {
  await shot({ dir: 'telephone', file: `${variant}-melange-projet`, query: `variant=${variant}&state=mixed&mode=project`, phone: true })
  await shot({ dir: 'telephone', file: `${variant}-plus-de-5-arbre`, query: `variant=${variant}&state=many&mode=tree`, phone: true })
}
await shot({ dir: 'telephone', file: '0-vide-projet', query: 'state=empty&mode=project', phone: true })
await browser.close()
writeFileSync(`${OUT}/index.txt`, index.join('\n') + '\n')
console.log(index.length, 'captures')
