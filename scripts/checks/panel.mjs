/**
 * Le bouton qui ferme le panneau.
 *
 * Depuis que le panneau n'a plus d'en-tête, c'est celui de la bande du haut qui le
 * ferme — sauf quand il recouvre l'écran, où il porte sa propre croix. Les deux ont
 * le même nom, et c'est voulu : c'est le même geste. Celui du panneau l'emporte quand
 * il existe, parce que c'est celui qu'on a sous les yeux à ce moment-là.
 *
 * Rendu après comptage plutôt que par `.or()` : une union se résout dans l'ordre du
 * document, et la bande vient avant le panneau.
 */
export async function closePanelButton(page) {
  const name = { name: 'Fermer le panneau', exact: true }
  // `[data-panel]` et non le rôle `dialog` : le panneau n'est une boîte de dialogue
  // que lorsqu'il recouvre l'écran, et il porte sa croix bien avant ça.
  const inPanel = page.locator('[data-panel="workspace"]').getByRole('button', name)
  if ((await inPanel.count()) > 0) return inPanel.first()
  return page.getByRole('button', name).first()
}

/**
 * Ouvre le panneau à portée projet, sur le Tableau. Il n'y a plus de bouton (#180) : il
 * est « appelé », ici par le geste de la palette. Il charge le Tableau, sauf avec
 * `{ inPlace: true }` : on rouvre alors le panneau sans quitter la page, et il retrouve
 * son état comme le rouvrait le bouton.
 * (Quand Travail montera son propre panneau, cette aide passera par lui : #253.)
 */
export async function openProjectPanel(page, base, project, { inPlace = false } = {}) {
  if (!inPlace) await page.goto(`${base}/p/${project.id}/board`)
  // La barre du Tableau dit que l'application est montée, et le raccourci écouté.
  await page.getByRole('searchbox', { name: 'Rechercher une carte, un numéro…', exact: true }).waitFor()
  await page.keyboard.press('Control+k')
  const palette = page.getByRole('dialog', { name: 'Rechercher', exact: true })
  await palette.getByRole('textbox').fill('panneau du projet')
  await palette.getByRole('button', { name: /Ouvrir le panneau du projet/ }).click()
  await palette.waitFor({ state: 'detached' })
  const panel = page.locator('[data-panel="workspace"]')
  await panel.waitFor()
  return panel
}
