import assert from 'node:assert/strict'
import { deflateSync } from 'node:zlib'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { closePanelButton } from './panel.mjs'

/**
 * La visionneuse d'images : les trois repères, le zoom, le glissement, le plein écran
 * hors de la coque, et le repli de l'arborescence à l'ouverture d'une image large.
 *
 * La fixture est un PNG fabriqué ici plutôt qu'un fichier commité : il faut une taille
 * connue (plus large que le seuil de repli) et un poids réel pour la ligne de pied, et
 * un binaire dans le dépôt pour quarante octets utiles n'en vaut pas la peine.
 */
const WIDTH = 2000
const HEIGHT = 1600

export async function checkImage({ page, base, project }) {
  const dir = join(project.workspacePath, 'image-check')
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'large.png'), png(WIDTH, HEIGHT))

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(`${base}/p/${project.id}/board`)
  await page.evaluate(() => localStorage.setItem('solera.panelTree', '1'))
  await page.reload()
  await page.getByRole('button', { name: 'Ouvrir le panneau', exact: true }).click()
  const panel = page.locator('[data-panel="workspace"]')
  const showTree = panel.getByRole('button', { name: "Afficher l'arborescence", exact: true })
  if (await showTree.count()) await showTree.click()

  // L'arborescence nomme ses entrées par leur nom court, suivi de la lettre d'état
  // git (`?` pour une fixture non suivie).
  await panel.getByRole('button', { name: /^image-check/ }).first().click()
  await panel.getByRole('button', { name: /^large\.png/ }).first().click()
  const viewer = panel.locator('[data-image-viewer]')
  await viewer.waitFor()

  // Une image large replie l'arborescence d'elle-même : c'est la place qu'elle réclame.
  await showTree.waitFor()

  // Le pied dit ce qu'on regarde : dimensions, poids réel, format.
  await viewer.getByText(new RegExp(`${WIDTH} × ${HEIGHT} · \\d`)).waitFor()
  await viewer.getByText(/PNG/).waitFor()

  const zoom = viewer.getByRole('status')
  const at = async () => Number((await zoom.textContent()).replace(/[^\d]/g, ''))

  // « Ajuster » tient l'image dans le cadre : bien moins de 100 % pour 2000 px.
  await viewer.getByRole('button', { name: 'Ajuster', exact: true }).click()
  const fitted = await at()
  assert.ok(fitted > 0 && fitted < 100, `Ajuster doit réduire, vu ${fitted} %`)

  const actual = viewer.getByRole('button', { name: '100 %', exact: true })
  await actual.click()
  assert.equal(await at(), 100)
  // Le repère reste marqué : c'est lui qui dit à quelle règle l'image obéit, et un
  // pourcentage seul ne distingue pas « 100 % demandé » de « 100 % par hasard ».
  assert.equal(await actual.getAttribute('aria-pressed'), 'true', 'Le repère 100 % reste marqué')
  assert.equal(
    await viewer.getByRole('button', { name: 'Ajuster', exact: true }).getAttribute('aria-pressed'),
    'false',
    'Un seul repère à la fois',
  )

  await viewer.getByRole('button', { name: 'Agrandir', exact: true }).click()
  assert.ok((await at()) > 100, 'Le bouton + agrandit')

  // Double-clic : retour à « ajuster » quand on est à 100 %, et inversement.
  await viewer.getByRole('button', { name: '100 %', exact: true }).click()
  await viewer.locator('img').dblclick()
  assert.equal(await at(), fitted, 'Le double-clic ramène à la taille ajustée')
  await viewer.locator('img').dblclick()
  assert.equal(await at(), 100, 'Le double-clic repart à 100 %')

  // Le plein écran sort de la coque : il ne peut donc pas être dans le panneau.
  await viewer.getByRole('button', { name: "Afficher l'image en plein écran", exact: true }).click()
  const full = page.getByRole('dialog', { name: /image-check\/large\.png en plein écran/ })
  await full.waitFor()
  assert.equal(await panel.locator('[data-image-viewer]').count(), 0, 'Le plein écran quitte le panneau')
  const bounds = await full.boundingBox()
  assert.equal(Math.round(bounds.width), 1440, 'Le plein écran prend toute la largeur')
  assert.equal(Math.round(bounds.height), 900, 'Le plein écran prend toute la hauteur')
  await full.getByText(/Échap pour revenir/).waitFor()

  // Les trois touches de la maquette, et elles n'existent qu'ici.
  await page.keyboard.press('0')
  assert.equal(Number((await full.getByRole('status').textContent()).replace(/[^\d]/g, '')), 100)
  // Ajuster en plein écran n'est pas la même échelle que dans le panneau : c'est une
  // règle appliquée au cadre du moment, pas une valeur retenue.
  await page.keyboard.press('f')
  const full100 = Number((await full.getByRole('status').textContent()).replace(/[^\d]/g, ''))
  assert.ok(full100 > fitted && full100 < 100, `Ajuster en plein écran, vu ${full100} %`)
  await page.keyboard.press('Escape')
  await full.waitFor({ state: 'hidden' })
  await viewer.waitFor()

  // Au téléphone : le panneau recouvre déjà l'écran, donc la visionneuse y est en
  // plein écran sans l'avoir demandé, et les gestes ne sont plus les mêmes.
  await page.setViewportSize({ width: 390, height: 844 })
  const band = panel.locator('header').first()
  await band.getByText('large.png', { exact: true }).waitFor()
  assert.equal(
    await viewer.getByRole('button', { name: "Afficher l'image en plein écran", exact: true }).count(),
    0,
    'Pas de plein écran là où la visionneuse prend déjà l’écran',
  )
  assert.equal(await viewer.getByRole('button', { name: 'Largeur', exact: true }).count(), 0)
  // Le libellé suit le pointeur et non la largeur : « molette » à qui en a une,
  // « pincer » à qui touche l'écran. Le navigateur du contrôle a une souris.
  await viewer.getByText(/zoom/i).waitFor()

  // Le retour de la bande ramène à l'arbre, comme on remonte d'un dossier.
  await band.getByRole('button', { name: "Afficher l'arborescence", exact: true }).click()
  await panel.getByRole('button', { name: /^large\.png/ }).first().waitFor()
  assert.equal(await band.getByText('large.png', { exact: true }).count(), 0, 'La bande redit le répertoire')

  await page.setViewportSize({ width: 1440, height: 900 })
  await (await closePanelButton(page)).click()
  await panel.waitFor({ state: 'hidden' })
  console.log('OK : visionneuse d’images — repères, zoom, double-clic, plein écran hors coque et repli de l’arbre.')
}

/** PNG en niveaux de gris, une bande dégradée : la largeur seule compte pour le test. */
function png(width, height) {
  const raw = Buffer.alloc((width + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (width + 1)] = 0
    for (let x = 0; x < width; x++) raw[y * (width + 1) + 1 + x] = (x * 255) / width
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 0

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

function chunk(type, data) {
  const head = Buffer.alloc(4)
  head.writeUInt32BE(data.length, 0)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const tail = Buffer.alloc(4)
  tail.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([head, body, tail])
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function crc32(buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}
