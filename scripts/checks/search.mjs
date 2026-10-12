import assert from 'node:assert/strict'
import { closePanelButton } from './panel.mjs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * La vue *Recherche* du panneau : par nom et par contenu, avec ses drapeaux, ses
 * filtres de chemin, le saut à la ligne, et le remplacement en masse.
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
  await page.goto(`${base}/p/${project.id}/board`)
  await page.getByRole('button', { name: 'Ouvrir le panneau', exact: true }).click()
  const panel = page.locator('[data-panel="workspace"]')
  await panel.getByRole('button', { name: 'Recherche', exact: true }).click()

  const query = panel.getByRole('searchbox', { name: 'Chercher dans le répertoire de travail', exact: true })
  const exclude = panel.getByRole('textbox', { name: 'Exclure : node_modules', exact: true })
  const content = panel.locator('[data-search-content]')
  const names = panel.locator('[data-search-results]')

  await query.fill(TOKEN)
  await content.waitFor()

  // Six occurrences dans quatre fichiers — alpha en porte trois — et un nom de fichier.
  await panel.getByText(/6 résultats dans 4 fichiers · 1 nom de fichier/).waitFor()
  assert.equal(await names.getByText(`${TOKEN}-nomme.txt`, { exact: true }).count(), 1)
  assert.equal(await content.getByRole('button', { expanded: true }).count(), 4, 'Les fichiers sont dépliés')

  // Le filtre d'exclusion écarte un dossier entier, sans le traverser.
  await exclude.fill('ignore-moi')
  await panel.getByText(/5 résultats dans 3 fichiers/).waitFor()
  await exclude.fill('')
  await panel.getByText(/6 résultats dans 4 fichiers/).waitFor()

  // Mot entier : le terme collé à une lettre ne compte plus.
  await panel.getByRole('button', { name: 'Mot entier', exact: true }).click()
  await panel.getByText(/5 résultats dans 3 fichiers/).waitFor()
  await panel.getByRole('button', { name: 'Mot entier', exact: true }).click()

  // Une expression régulière fautive se lit comme une faute de frappe, pas une panne.
  await panel.getByRole('button', { name: 'Expression régulière', exact: true }).click()
  await query.fill('Solera(')
  await panel.getByRole('alert').waitFor()
  assert.equal(await panel.isVisible(), true, 'Une regex invalide ne casse pas la vue')
  await panel.getByRole('button', { name: 'Expression régulière', exact: true }).click()

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
  await panel.getByRole('button', { name: 'Afficher le remplacement', exact: true }).click()
  await panel.getByRole('textbox', { name: 'Remplacer par…', exact: true }).fill('REMPLACE')
  await panel.getByRole('textbox', { name: 'Inclure : apps/**', exact: true }).fill('search-check/beta.txt')
  await panel.getByText(/1 résultat dans 1 fichier/).waitFor()
  await panel.getByRole('button', { name: 'Tout remplacer', exact: true }).click()
  await page.getByRole('dialog', { name: 'Remplacer dans tous ces fichiers ?', exact: true })
    .getByRole('button', { name: 'Tout remplacer', exact: true }).click()
  await page.getByRole('dialog', { name: 'Remplacer dans tous ces fichiers ?', exact: true }).waitFor({ state: 'hidden' })
  await panel.getByText(/1 occurrences remplacées dans 1 fichiers/).waitFor()

  assert.equal(await readFile(join(dir, 'beta.txt'), 'utf8'), 'seulement REMPLACE sur une ligne\n')
  assert.match(await readFile(join(dir, 'alpha.txt'), 'utf8'), new RegExp(TOKEN), 'Le filtre borne le remplacement')

  // Le contrôle suivant repart du board seul.
  await (await closePanelButton(page)).click()
  await panel.waitFor({ state: 'hidden' })
  console.log('OK : recherche par nom et contenu, drapeaux, filtres, saut à la ligne et remplacement borné.')
}
