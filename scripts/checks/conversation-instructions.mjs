import assert from 'node:assert/strict'

/**
 * Régression : une conversation ouverte charge aussi l'objet des fichiers de consignes.
 *
 * Ce fichier gardait aussi le geste des favoris, du menu de la sidebar jusqu'au
 * stockage. La carte #11 a retiré les favoris de la colonne — plus de section *Signets*,
 * plus d'entrée de menu, plus d'étoile — et ce pan de la vérification n'avait plus
 * d'interface à toucher. Il est tombé avec elle, puis le reste de la chaîne avec lui :
 * le hook, les deux routes et le champ `favorite` du DTO n'existent plus.
 */
export async function checkConversationInstructions({ page, context, base, project, hero }) {
  await page.setViewportSize({ width: 1440, height: 900 })
  const instructions = page.waitForResponse(response => response.url().endsWith(`/api/conversations/${hero.id}/files/exist`))
  await page.goto(`${base}/p/${project.id}/c/${hero.id}`)
  assert.ok((await instructions).ok())
  console.log('OK : l’objet des fichiers de consignes est chargé à l’ouverture d’une conversation.')

  await page.goto(`${base}/p/${project.id}/board`)
}
