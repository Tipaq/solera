import { createContext, useContext, type ReactNode } from 'react'

/**
 * Les quelques libellés que les primitives portent elles-mêmes.
 *
 * Un design system ne possède pas la copie du produit : `Select` et `ConfirmDialog`
 * allaient chercher leurs textes dans le catalogue de traduction de l'application, ce
 * qui liait le paquet à un module qu'il ne devrait pas connaître — et rien n'empêchait
 * la prochaine primitive d'en faire autant.
 *
 * Ils ne sont pas devenus des props pour autant : « Annuler » n'est pas une décision
 * que prend l'appelant, c'est le libellé d'un contrôle, et le passer à chacun des
 * quatorze sites d'appel aurait surtout créé quatorze occasions de le traduire
 * différemment. Ils sont donc fournis une fois, par l'application, comme le font les
 * bibliothèques de composants qui ont le même problème.
 *
 * Les valeurs par défaut sont en anglais : une primitive montée sans provider — dans un
 * catalogue, dans un test — affiche quelque chose de juste plutôt qu'une clé.
 */
export interface UiLabels {
  /** Bouton d'annulation d'un dialogue de confirmation. */
  cancel: string
  /** Déclencheur d'un `Select` dont aucune option n'est choisie. */
  selectPlaceholder: string
}

const DEFAULTS: UiLabels = {
  cancel: 'Cancel',
  selectPlaceholder: 'Select…',
}

const Context = createContext<UiLabels>(DEFAULTS)

export function UiLabelsProvider({
  labels,
  children,
}: {
  labels: Partial<UiLabels>
  children: ReactNode
}) {
  return <Context.Provider value={{ ...DEFAULTS, ...labels }}>{children}</Context.Provider>
}

export function useUiLabels(): UiLabels {
  return useContext(Context)
}
