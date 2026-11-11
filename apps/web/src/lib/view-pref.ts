/**
 * La vue d'une page (Kanban, Liste, Par geste…) : un réglage de la page, pas une
 * navigation. Elle se lit dans cet ordre :
 *
 * 1. l'adresse, `?vue=`, pour qu'un lien partagé ouvre la même vue ;
 * 2. sinon la dernière choisie **dans ce projet**, que le navigateur retient ;
 * 3. sinon la première de la page.
 *
 * Une valeur inconnue (une vue retirée, une adresse tapée à la main) est ignorée à
 * chaque étage plutôt que de rendre une page vide.
 */
export const VIEW_PARAM = 'vue'

export function resolveView<K extends string>(fromUrl: string | null, remembered: string | null, keys: readonly K[]): K {
  const known = (value: string | null): value is K => value !== null && (keys as readonly string[]).includes(value)
  if (known(fromUrl)) return fromUrl
  if (known(remembered)) return remembered
  return keys[0]!
}

/** La clé de mémoire d'une page : par projet, ou seule pour une page hors projet. */
export function viewStorageKey(scope: string, projectId: string | null): string {
  return projectId ? `solera.view.${scope}.${projectId}` : `solera.view.${scope}`
}
