import assert from 'node:assert/strict'
import { closePanelButton, openProjectPanel } from './panel.mjs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * La vue *Recherche* du panneau : par nom et par contenu, avec ses drapeaux, ses
 * filtres de chemin, le saut à la ligne, et le remplacement en masse.
 *
 * Elle suit le cadre commun du panneau (#224) : **une seule ligne d'outils** de 48 px —
 * le champ, « Filtrer ▾ » qui porte les drapeaux et les motifs, « Remplacer » qui
 * déplie sa propre ligne —, les erreurs dans la bande commune, des lignes de 36 px.
 *
 * Les fixtures sont écrites sur le disque du workspace temporaire plutôt que par
 * l'API : c'est le disque que la recherche lit, et passer par les routes d'entrées
 * vérifierait autre chose. Un jeton unique (`SOLERA_SEARCH_FIXTURE`) borne tout le
 * contrôle — le remplacement ne peut alors pas déborder sur ce que les autres suites
 * ont laissé dans le même répertoire.
 */
const TOKEN = 'SoleraSearchFixture'

export async function checkSearch({ page, base, project }) {
  const dir = join(project.workspacePath, 'search-check')
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'alpha.txt'), [
    'premiere ligne sans rien',
    `une occurrence de ${TOKEN} ici`,
    'une ligne de separation',
    `et ${TOKEN} une seconde fois, puis ${TOKEN} encore`,
  ].join('\n'))
  await writeFile(join(dir, 'beta.txt'), `seulement ${TOKEN} sur une ligne\n`)
  // Même mot, mais dans un dossier qu'on exclura : c'est ce qui prouve le filtre.
  await mkdir(join(dir, 'ignore-moi'), { recursive: true })
  await writeFile(join(dir, 'ignore-moi', 'gamma.txt'), `${TOKEN} a ne pas trouver\n`)
  // Un nom de fichier qui porte le terme, pour la section « noms de fichier ».
  await writeFile(join(dir, `${TOKEN}-nomme.txt`), 'rien dans le contenu\n')
  // Le terme collé à une lettre : il disparaît quand « mot entier » est armé.
  await writeFile(join(dir, 'delta.txt'), `${TOKEN}X accolé\n`)

  await page.setViewportSize({ width: 1440, height: 900 })
  await openProjectPanel(page, base, project)
  const panel = page.locator('[data-panel="workspace"]')
  await panel.getByRole('button', { name: 'Recherche', exact: true }).click()

  const query = panel.getByRole('searchbox', { name: 'Chercher dans le répertoire de travail', exact: true })
  const content = panel.locator('[data-search-content]')
  const names = panel.locator('[data-search-results]')
  const filterButton = panel.getByRole('button', { name: /^Filtrer/ })
  const filters = page.getByRole('dialog', { name: 'Filtrer', exact: true })
  const exclude = filters.getByRole('textbox', { name: 'Exclure : node_modules', exact: true })
  const include = filters.getByRole('textbox', { name: 'Inclure : apps/**', exact: true })
  const replaceToggle = panel.getByRole('button', { name: 'Afficher le remplacement', exact: true })
  /** « Filtrer ▾ » s'ouvre au besoin : les drapeaux et les motifs y vivent. */
  const openFilters = async () => {
    if (!(await filters.isVisible())) await filterButton.click()
    await filters.waitFor()
  }
  const closeFilters = async () => {
    await page.keyboard.press('Escape')
    await filters.waitFor({ state: 'hidden' })
  }

  // Une seule ligne d'outils, de la hauteur commune : le champ, Filtrer, Remplacer.
  const line = await query.evaluate((input) => {
    const row = input.closest('.h-12')
    return row ? { height: row.getBoundingClientRect().height, text: row.textContent } : null
  })
  assert.ok(line, 'Le champ vit dans la ligne d’outils du cadre')
  assert.equal(line.height, 48, 'La ligne d’outils fait 48 px')
  const middle = async (locator) => {
    const box = await locator.boundingBox()
    return Math.round(box.y + box.height / 2)
  }
  const axis = await middle(query)
  assert.equal(await middle(filterButton), axis, 'Filtrer est sur la ligne du champ')
  assert.equal(await middle(replaceToggle), axis, 'Remplacer est sur la ligne du champ')
  assert.equal(await panel.getByRole('textbox', { name: 'Exclure : node_modules', exact: true }).count(), 0,
    'Les motifs de fichiers ne sont plus sous le champ')

  await query.fill(TOKEN)
  await content.waitFor()

  // Six occurrences dans quatre fichiers — alpha en porte trois — et un nom de fichier.
  await panel.getByText(/6 résultats dans 4 fichiers · 1 nom de fichier/).waitFor()
  assert.equal(await names.getByText(`${TOKEN}-nomme.txt`, { exact: true }).count(), 1)
  assert.equal(await content.getByRole('button', { expanded: true }).count(), 4, 'Les fichiers sont dépliés')
  // Les lignes du cadre : 36 px à la souris, et les titres au format des groupes.
  const nameRow = await names.getByRole('button').first().boundingBox()
  assert.equal(Math.round(nameRow.height), 36, 'Une ligne de résultat fait 36 px')
  // Chaque groupe porte son compte : quatre fichiers au contenu, un nom de fichier.
  assert.equal(await panel.getByRole('heading', { name: /^Contenu\s*4$/ }).count(), 1)
  assert.equal(await panel.getByRole('heading', { name: /^Noms de fichier\s*1$/ }).count(), 1)

  // Le filtre d'exclusion écarte un dossier entier, sans le traverser. Un motif posé
  // compte parmi les filtres actifs, sur le bouton.
  await openFilters()
  await exclude.fill('ignore-moi')
  await panel.getByText(/5 résultats dans 3 fichiers/).waitFor()
  assert.match(await filterButton.textContent(), /1$/, 'Filtrer compte le motif posé')
  await exclude.fill('')
  await panel.getByText(/6 résultats dans 4 fichiers/).waitFor()

  // Mot entier : le terme collé à une lettre ne compte plus.
  await filters.getByRole('checkbox', { name: 'Mot entier', exact: true }).click()
  await panel.getByText(/5 résultats dans 3 fichiers/).waitFor()
  await filters.getByRole('checkbox', { name: 'Mot entier', exact: true }).click()
  await closeFilters()
  assert.doesNotMatch(await filterButton.textContent(), /\d/, 'Sans filtre, Filtrer ne compte rien')

  // Une expression régulière fautive se lit comme une faute de frappe, pas une panne :
  // dans la bande commune, sous la ligne d'outils, et le champ bordé de rouge.
  await openFilters()
  await filters.getByRole('checkbox', { name: 'Expression régulière', exact: true }).click()
  await closeFilters()
  await query.fill('Solera(')
  await panel.getByRole('alert').waitFor()
  assert.equal(await query.getAttribute('aria-invalid'), 'true')
  assert.equal(await panel.isVisible(), true, 'Une regex invalide ne casse pas la vue')
  await openFilters()
  await filters.getByRole('checkbox', { name: 'Expression régulière', exact: true }).click()
  await closeFilters()

  // Le saut à la ligne : la ligne 4 d'alpha.txt porte deux occurrences.
  await query.fill(TOKEN)
  await content.waitFor()
  const alpha = content.locator('li', { has: page.getByText('alpha.txt', { exact: true }) }).first()
  await alpha.getByRole('button').filter({ hasText: /^4/ }).first().click()
  await panel.locator('[data-editor-file="search-check/alpha.txt"]').waitFor()
  await panel.getByRole('button', { name: /^Ligne 4, colonne 1\./ }).waitFor()

  // Revenir à la recherche retrouve la frappe et les résultats : la vue reste montée.
  await panel.getByRole('button', { name: 'Recherche', exact: true }).click()
  assert.equal(await query.inputValue(), TOKEN, 'La recherche survit à un passage par les fichiers')

  // Le remplacement : replié par défaut, confirmé, et borné par le filtre d'inclusion.
  assert.equal(await replaceToggle.getAttribute('aria-expanded'), 'false')
  await replaceToggle.click()
  await panel.getByRole('button', { name: 'Masquer le remplacement', exact: true }).waitFor()
  await panel.getByRole('textbox', { name: 'Remplacer par…', exact: true }).fill('REMPLACE')
  await openFilters()
  await include.fill('search-check/beta.txt')
  await closeFilters()
  await panel.getByText(/1 résultat dans 1 fichier/).waitFor()
  await panel.getByRole('button', { name: 'Tout remplacer', exact: true }).click()
  await page.getByRole('dialog', { name: 'Remplacer dans tous ces fichiers ?', exact: true })
    .getByRole('button', { name: 'Tout remplacer', exact: true }).click()
  await page.getByRole('dialog', { name: 'Remplacer dans tous ces fichiers ?', exact: true }).waitFor({ state: 'hidden' })
  // Le compte rendu dans la bande commune, au même endroit que les erreurs.
  await panel.getByRole('status').filter({ hasText: /1 occurrences remplacées dans 1 fichiers/ }).waitFor()

  assert.equal(await readFile(join(dir, 'beta.txt'), 'utf8'), 'seulement REMPLACE sur une ligne\n')
  assert.match(await readFile(join(dir, 'alpha.txt'), 'utf8'), new RegExp(TOKEN), 'Le filtre borne le remplacement')

  // Le contrôle suivant repart du board seul.
  await (await closePanelButton(page)).click()
  await panel.waitFor({ state: 'hidden' })
  console.log('OK : recherche par nom et contenu, drapeaux, filtres, saut à la ligne et remplacement borné.')
}
