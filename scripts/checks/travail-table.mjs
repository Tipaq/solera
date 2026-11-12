import assert from 'node:assert/strict'
import { join } from 'node:path'

const escaped = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * La vue **Tableau** de Travail (carte #177, `projet.md` T-6, T-13) sur la démo Nimbus :
 * l'en-tête des colonnes, la ligne d'un arbre qui ouvre son tiroir, son menu `⋯` et ses
 * gestes réels (le diff, le rebase, la fusion d'une PR prête, le nettoyage), la ligne
 * d'une branche sans arbre et ses gestes, et le téléphone, où chaque ligne devient une
 * carte. Le nettoyage de bout en bout se tient dans `worktree-status-ui-check.mjs`, sur
 * une base qu'on peut abîmer.
 *
 * `runningBranch` porte la session qui tourne et la PR #18 « CI en cours » ; `readyBranch`,
 * s'il y en a un, la PR #17 prête, que la suite simule.
 */
export async function checkTravailTable({ page, base, project, runningBranch, readyBranch, shots }) {
  await page.goto(`${base}/p/${project.id}/travail?vue=tableau`)
  const table = page.getByRole('region', { name: 'Les arbres et les branches du projet', exact: true })
  await table.waitFor()
  await table.getByText('Branche · pourquoi elle est là', { exact: true }).waitFor()
  for (const label of ['Sessions', 'PR', 'Base', 'Disque', 'Vu']) await table.getByText(label, { exact: true }).first().waitFor()
  assert.equal(await page.getByRole('region', { name: 'Projet', exact: true }).count(), 0, 'Pas de couloir « Projet » dans le tableau')

  // T-6.2 : la ligne de l'arbre qui tourne — sa session, sa PR, son geste ; tout ouvre le tiroir.
  const line = table.locator(`li[data-tree-line]`).filter({ has: page.getByRole('button', { name: runningBranch, exact: true }) })
  await line.waitFor()
  await line.getByRole('link', { name: /#18/ }).waitFor()
  await line.getByRole('button', { name: runningBranch, exact: true }).click()
  const drawer = page.getByRole('dialog', { name: `Arbre ${runningBranch}`, exact: true })
  await drawer.waitFor()
  // Les gestes du tiroir sont ceux du menu (T-13.1).
  for (const name of ['Session', 'Diff', 'Rebaser', 'Nettoyer']) await drawer.getByRole('button', { name, exact: true }).waitFor()
  await page.keyboard.press('Escape')
  await drawer.waitFor({ state: 'detached' })
  await page.screenshot({ animations: 'disabled', path: join(shots, 't15-travail-tableau.png') })

  // Le menu ⋯ : dans l'ordre, et il n'ouvre pas le tiroir.
  await line.getByRole('button', { name: `Gestes sur ${runningBranch}`, exact: true }).click()
  const items = await page.getByRole('menuitem').allInnerTexts()
  assert.deepEqual(
    items.map((text) => text.trim()),
    ['Ouvrir la session', 'Voir le diff', 'Ouvrir la PR #18', 'Rebaser sur la base', 'Nettoyer l’arbre'],
    `gestes : ${items}`,
  )
  // « Rebaser » d'un arbre où une session tourne : la demande lui est envoyée, le retour se dit sous la barre.
  await page.route('**/api/conversations/*/messages', (route) => route.fulfill({ json: { ok: true } }))
  await page.getByRole('menuitem', { name: 'Rebaser sur la base', exact: true }).click()
  await page.getByRole('status').getByText(`Rebase de ${runningBranch} demandé à sa session.`, { exact: true }).waitFor()
  await page.unroute('**/api/conversations/*/messages')
  assert.equal(await page.getByRole('dialog', { name: `Arbre ${runningBranch}` }).count(), 0, 'Le menu n’ouvre pas le tiroir')

  // « Nettoyer » d'un arbre au travail : le dialogue unique, sur le plan réel ; on annule.
  await line.getByRole('button', { name: `Gestes sur ${runningBranch}`, exact: true }).click()
  await page.getByRole('menuitem', { name: 'Nettoyer l’arbre', exact: true }).click()
  const clean = page.getByRole('dialog', { name: 'Nettoyer', exact: true })
  await clean.getByText('Worktrees · 1', { exact: true }).waitFor()
  await clean.getByText(/y travaille, l’arbre reste/).waitFor()
  assert.ok(await clean.getByRole('button', { name: 'En attente de la session', exact: true }).isDisabled(), 'Un arbre où une session travaille attend')
  await clean.getByRole('button', { name: 'Annuler', exact: true }).click()
  await clean.waitFor({ state: 'hidden' })

  // T-6.2 : « Fusionner la PR » d'une PR prête, après confirmation ; la forge est simulée.
  if (readyBranch) {
    const ready = table.locator('li[data-tree-line]').filter({ has: page.getByRole('button', { name: readyBranch, exact: true }) })
    await ready.getByRole('button', { name: `Gestes sur ${readyBranch}`, exact: true }).click()
    await page.getByRole('menuitem', { name: 'Fusionner la PR', exact: true }).click()
    const confirm = page.getByRole('dialog', { name: 'Fusionner la PR #17 ?', exact: true })
    await confirm.getByText(new RegExp(`^${escaped(readyBranch)} part dans main`)).waitFor()
    await page.route('**/api/projects/*/pull-requests/17/merge', (route) =>
      route.fulfill({ json: { number: 17, url: 'https://github.com/demo/nimbus/pull/17', branch: readyBranch, base: 'main' } }),
    )
    await confirm.getByRole('button', { name: 'Fusionner', exact: true }).click()
    await page.getByRole('status').getByText('PR #17 fusionnée dans main.', { exact: true }).waitFor()
    await page.unroute('**/api/projects/*/pull-requests/17/merge')
  }

  // T-6.3 : une branche sans arbre, sur la même grille, et ses gestes dans le menu.
  const branchLine = table.locator('li[data-branch-line]').first()
  if ((await branchLine.count()) > 0) {
    const name = await branchLine.getAttribute('data-branch-line')
    await branchLine.getByText('sans arbre', { exact: true }).waitFor()
    await branchLine.getByRole('button', { name: new RegExp(`^Gestes sur (origin/)?${escaped(name)}$`) }).click()
    await page.getByRole('menuitem', { name: 'Ouvrir dans un worktree', exact: true }).waitFor()
    await page.getByRole('menuitem', { name: 'Lancer une session dessus', exact: true }).waitFor()
    await page.keyboard.press('Escape')
  }

  // T-6.5 : au téléphone, une carte par ligne, rien ne déborde ; le geste principal en clair.
  await page.setViewportSize({ width: 390, height: 844 })
  await table.waitFor()
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'Le tableau ne déborde pas à 390 px')
  await page.waitForTimeout(300)
  await page.screenshot({ animations: 'disabled', path: join(shots, 't16-tableau-au-telephone.png') })
  await page.setViewportSize({ width: 1440, height: 900 })
}
