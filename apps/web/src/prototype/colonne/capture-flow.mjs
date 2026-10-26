// PROTOTYPE JETABLE — le parcours « j'ai une demande → Activité → je clique la demande »,
// une image par étape, dans /tmp/proto-demandes/parcours-{ordinateur,telephone}.
import { mkdirSync } from 'node:fs'
import { launchBrowser } from '../../../../../scripts/checks/browser.mjs'

const BASE = 'http://127.0.0.1:5433/prototype-colonne.html?variant=D&state=mixed&mode=project&bar=off'
const browser = await launchBrowser()

for (const phone of [false, true]) {
  const dir = `/tmp/proto-demandes/parcours-${phone ? 'telephone' : 'ordinateur'}`
  mkdirSync(dir, { recursive: true })
  const context = await browser.newContext(phone
    ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
    : { viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 })
  const page = await context.newPage()
  await page.goto(BASE)
  await page.waitForTimeout(300)
  const full = (name) => page.screenshot({ path: `${dir}/${name}.png`, animations: 'disabled' })
  const modal = (name) => page.locator('[data-shot=modale]').screenshot({ path: `${dir}/${name}.png`, animations: 'disabled' })

  await full('1-une-demande-attend')
  await page.locator('[data-shot=activite] button').first().click()
  await page.waitForTimeout(300)
  await (phone ? full : modal)('2-la-modale-s-ouvre-sur-pour-toi')
  await page.locator('[data-shot=modale]').getByText('Lancer pnpm test:places-ui').click()
  await page.waitForTimeout(200)
  await (phone ? full : modal)('3-clic-sur-la-permission-depliee')
  await page.locator('[data-shot=modale]').getByRole('button', { name: 'Autoriser', exact: true }).click()
  await page.waitForTimeout(200)
  await (phone ? full : modal)('4-autorise')
  await page.waitForTimeout(1300)
  await (phone ? full : modal)('5-la-demande-est-partie')
  await page.locator('[data-shot=modale]').getByText('Garder la barre d’onglets en haut ?').click()
  await page.waitForTimeout(200)
  await (phone ? full : modal)('6-une-question-depliee')
  await page.locator('[data-shot=modale]').getByText('Fusionner #69 avant ou après la revue ?').click()
  await page.waitForTimeout(200)
  await (phone ? full : modal)('7-une-decision-depliee')
  await page.locator('[data-shot=modale]').getByText('3 cartes à ranger').click()
  await page.waitForTimeout(200)
  await (phone ? full : modal)('8-un-accord-deplie')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  await full('9-la-colonne-apres')
  await context.close()
}
await browser.close()
console.log('ok')
