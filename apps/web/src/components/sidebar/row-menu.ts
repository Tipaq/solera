import type { MouseEvent } from 'react'

/**
 * Le clic droit sur une ligne de la colonne ouvre son menu « ⋯ » : viser le bouton est
 * fastidieux, et un explorateur de fichiers a habitué à ce geste.
 *
 * Le menu du bouton lui-même, et non un menu contextuel au curseur : celui des
 * conversations a un sous-menu (*Ranger*) et celui des projets ses pastilles de couleur,
 * que le `ContextMenu` du design system ne sait pas rendre. Un second menu aux entrées
 * amputées ferait deux menus différents selon la main qui ouvre. Le prix : il s'ouvre
 * sous le bouton, pas sous le curseur.
 *
 * Au doigt, rien : l'appui long y sert déjà au glissement, et le `⋯` y est toujours
 * visible. Dans un champ de renommage, le menu du navigateur garde son coller.
 */
export function openRowMenu(event: MouseEvent<HTMLElement>): void {
  if (window.matchMedia('(pointer: coarse)').matches) return
  if (event.target instanceof Element && event.target.closest('input, textarea')) return
  const button = event.currentTarget.querySelector<HTMLElement>('[data-row-menu]')
  if (!button) return
  event.preventDefault()
  button.focus()
  // La flèche plutôt qu'Entrée : le déclencheur Radix l'entend comme « ouvrir », jamais
  // comme « basculer », et un second clic droit ne referme pas le menu.
  button.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }))
}
