import assert from 'node:assert/strict'
import { join } from 'node:path'

/**
 * La vue **Graphe** de Travail (carte #178, `projet.md` T-7) sur le dépôt de démo Nimbus :
 * le graphe de tout le projet, la colonne « Dans Solera » (l'arbre qui tourne, son verdict
 * et sa PR), la racine non commitée, les fusionnées sans étiquette sauf sous « Fusionné »,
 * l'arbre choisi qui estompe le reste, les menus qui écrivent éteints, et le tiroir d'un
 * commit : la session qui l'a écrit, d'après sa branche, puis le détail du panneau.
 *
 * `runningBranch` porte la session qui tourne et la PR #18 simulée par la suite ;
 * `feat/city-search` est fusionnée dans `main` sans worktree.
 */
export async function checkTravailGraph({ page, base, project, running, runningTree, runningBranch, shots }) {
  const toolbar = page.locator('[data-toolbar]')
  await page.goto(`${base}/p/${project.id}/travail?vue=graphe`)
  const graph = page.locator('[data-project-graph]')
  await graph.waitFor()
  await graph.getByText('Dans Solera', { exact: true }).waitFor()

  // T-7.1 : tout le dépôt — les commits de l'arbre qui tourne comme ceux de la base.
  const rowOf = (subject) => graph.locator(':scope > div').filter({ has: page.locator('[data-hash]', { hasText: subject }) })
  const head = rowOf('Cache the last forecast per city')
  await head.waitFor()
  await rowOf('Bootstrap Nimbus weather app').waitFor()

  // T-7.2 : la tête de l'arbre qui tourne — pastille du verdict, sa session, sa PR.
  const pill = head.getByRole('button', { name: 'En cours', exact: true })
  await pill.waitFor()
  assert.equal(await pill.getAttribute('title'), 'Ouvrir l’arbre')
  await head.getByRole('link', { name: /#18 CI en cours/ }).waitFor()
  // Le nœud « en cours » de la racine, s'il y a du non commité.
  if ((await graph.locator('[data-hash]').first().getAttribute('data-hash')) === null) {
    await graph.getByText('racine du projet · non commité', { exact: true }).waitFor()
  }
  await page.screenshot({ animations: 'disabled', path: join(shots, 't6-travail-graphe.png') })

  // T-7.4 : la branche fusionnée perd son étiquette, pas ses commits…
  await rowOf('Cover city search').waitFor()
  assert.equal(await graph.getByText('feat/city-search', { exact: true }).count(), 0, 'Les fusionnées perdent leurs étiquettes')
  // … et la retrouve sous le filtre « Fusionné ».
  const filterButton = toolbar.getByRole('button', { name: /^Filtrer/ })
  await filterButton.click()
  const filterPanel = page.getByRole('dialog', { name: 'Filtrer', exact: true })
  await filterPanel.getByRole('checkbox', { name: 'Fusionné', exact: true }).click()
  await page.keyboard.press('Escape')
  await graph.getByText('feat/city-search', { exact: true }).first().waitFor()
  await toolbar.locator('[data-filter-chip]').filter({ hasText: 'Fusionné' }).getByRole('button', { name: 'Retirer ce filtre' }).click()
  await graph.getByText('feat/city-search', { exact: true }).waitFor({ state: 'detached' })

  // T-7.3 : l'arbre choisi reste net, le reste s'estompe.
  await page.goto(`${base}/p/${project.id}/travail?vue=graphe&arbre=${encodeURIComponent(runningTree.path)}`)
  await head.waitFor()
  assert.equal(await head.getAttribute('data-dimmed'), null, 'La tête de l’arbre choisi reste nette')
  assert.equal(await rowOf('Bootstrap Nimbus weather app').getAttribute('data-dimmed'), 'true', 'La base s’estompe')
  await page.screenshot({ animations: 'disabled', path: join(shots, 't7-travail-graphe-arbre-choisi.png') })
  await page.goto(`${base}/p/${project.id}/travail?vue=graphe`)
  await head.waitFor()

  // T-7.5 : les menus qui écrivent sont éteints ; copier le SHA reste.
  await head.locator('[data-hash]').click({ button: 'right' })
  await page.getByRole('menuitem', { name: /^Copier le sha/ }).waitFor()
  assert.equal(await page.getByRole('menuitem', { name: /^Copier le sha/ }).getAttribute('aria-disabled'), null)
  const writing = page.getByRole('menuitem', { name: /^(Basculer sur ce commit|Créer une branche ici|Picorer ce commit|Réinitialiser)/ })
  assert.ok((await writing.count()) >= 3)
  for (const item of await writing.all()) assert.equal(await item.getAttribute('aria-disabled'), 'true', 'Un geste qui écrit est éteint')
  await page.keyboard.press('Escape')

  // T-7.6, T-7.7 : le tiroir du commit — la session qui l'a écrit, puis le détail.
  await head.locator('[data-hash] button[aria-pressed]').click()
  const drawer = page.getByRole('dialog', { name: 'Détail du commit', exact: true })
  await drawer.waitFor()
  await drawer.getByRole('heading', { name: 'Sessions', exact: true }).waitFor()
  const writer = drawer.locator(`[data-session="${running.id}"]`)
  await writer.waitFor()
  // Le détail du commit arrive après les sessions de l'arbre : on attend qu'il dise qui l'a écrit.
  await writer.getByText(/a écrit ce commit/).waitFor()
  assert.ok(['turn', 'sure'].includes(await writer.getAttribute('data-provenance')), 'La session qui tourne a écrit le commit de sa branche')
  assert.equal(await writer.getByRole('link', { name: 'Ouvrir la session' }).getAttribute('href'), `/p/${project.id}/c/${running.id}`)
  // Le détail du panneau, dessous : le message et ses fichiers.
  await drawer.getByText('Cache the last forecast per city').first().waitFor()
  await drawer.getByText(/forecast-cache\.ts/).first().waitFor()
  // T-7.8 : la puce de l'arbre ferme le tiroir du commit.
  await drawer.getByRole('button', { name: new RegExp(runningBranch.replace(/[/.]/g, '\\$&')) }).waitFor()
  await page.waitForTimeout(300)
  await page.screenshot({ animations: 'disabled', path: join(shots, 't8-tiroir-d-un-commit.png') })
  await page.keyboard.press('Escape')
  await drawer.waitFor({ state: 'detached' })

  // Au téléphone : la colonne se replie, rien ne déborde.
  await page.setViewportSize({ width: 390, height: 844 })
  await head.waitFor()
  assert.equal(await graph.getByText('Dans Solera', { exact: true }).isVisible(), false, 'La colonne « Dans Solera » se replie au téléphone')
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'Rien ne déborde à 390 px')
  await page.screenshot({ animations: 'disabled', path: join(shots, 't9-travail-graphe-telephone.png') })
  await head.locator('[data-hash] button[aria-pressed]').click()
  await drawer.waitFor()
  await writer.waitFor()
  await page.waitForTimeout(300)
  await page.screenshot({ animations: 'disabled', path: join(shots, 't10-tiroir-d-un-commit-telephone.png') })
  await page.keyboard.press('Escape')
  await page.setViewportSize({ width: 1440, height: 900 })
}
