const GUARD_MS = 1500
// Le `focusout` du champ et le `blur` de la fenêtre partent dans la même tâche ; au-delà,
// le champ avait perdu le focus avant le vol, et il n'y a rien à lui rendre.
const FOCUSOUT_TO_BLUR_MS = 50

/**
 * La visionneuse PDF de Chromium prend le focus une centaine de ms après le `load` de
 * son iframe, où qu'il soit, même sous un dialogue modal et même dans une iframe
 * `inert` (carte #251). Si l'utilisateur tape alors dans un champ, la suite de sa
 * saisie part dans le PDF.
 *
 * À appeler sur le `load` de l'iframe : pendant 1,5 s, la première fois que le
 * focus passe d'un élément de la page à cette iframe, on le rend à cet élément. La
 * visionneuse tourne hors processus, et la page ne voit aucun pointeur sur l'iframe :
 * rien ne distingue un clic de l'utilisateur dans le PDF de ce vol. Le garde ne vaut
 * donc qu'une fois et qu'un instant ; passé ce délai, cliquer dans le PDF lui donne le
 * focus comme avant.
 */
export function keepFocusFromFrame(frame: HTMLIFrameElement): void {
  const view = frame.ownerDocument.defaultView
  if (!view) return
  // L'élément qui vient de perdre le focus. Un focus resté sur `body` n'a rien à rendre.
  let lost: { element: HTMLElement; at: number } | null = null
  const onFocusOut = (event: FocusEvent) => {
    if (event.target instanceof HTMLElement && event.target !== frame) lost = { element: event.target, at: performance.now() }
  }
  const onBlur = () => {
    if (frame.ownerDocument.activeElement !== frame) return
    // Le premier passage à l'iframe désarme le garde, qu'il y ait un champ à rendre ou
    // non : un clic suivant dans le PDF lui laisse le focus.
    stop()
    if (!lost || performance.now() - lost.at > FOCUSOUT_TO_BLUR_MS) return
    const { element } = lost
    // Rendu dans le même tour, le focus reste à la visionneuse côté navigateur, et les
    // touches suivantes y partent encore.
    setTimeout(() => {
      if (element.isConnected && frame.ownerDocument.activeElement === frame) element.focus({ preventScroll: true })
    }, 0)
  }
  const timer = setTimeout(() => stop(), GUARD_MS)
  function stop() {
    clearTimeout(timer)
    frame.ownerDocument.removeEventListener('focusout', onFocusOut, true)
    view?.removeEventListener('blur', onBlur)
  }
  frame.ownerDocument.addEventListener('focusout', onFocusOut, true)
  view.addEventListener('blur', onBlur)
}
