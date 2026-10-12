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
