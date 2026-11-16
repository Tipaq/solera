/**
 * La visionneuse PDF de Chromium prend le focus une centaine de ms après le `load` de
 * son iframe, où qu'il soit, même sous un dialogue modal et même dans une iframe
 * `inert` (carte #251). Si l'utilisateur tape alors dans un champ, la suite de sa
 * saisie part dans le PDF.
 *
 * À appeler sur le `load` de l'iframe : pendant `delay` ms, la première fois que le
 * focus passe d'un élément de la page à cette iframe, on le rend à cet élément. La
 * visionneuse tourne hors processus, et la page ne voit aucun pointeur sur l'iframe :
 * rien ne distingue un clic de l'utilisateur dans le PDF de ce vol. Le garde ne vaut
 * donc qu'une fois et qu'un instant ; passé ce délai, cliquer dans le PDF lui donne le
 * focus comme avant.
 */
export function keepFocusFromFrame(frame: HTMLIFrameElement, delay = 1500): () => void {
  const view = frame.ownerDocument.defaultView
  if (!view) return () => {}
  // L'élément qui vient de perdre le focus : son `focusout` précède de peu le `blur` de
  // la fenêtre. Un focus resté sur `body` n'a rien à rendre.
  let lost: { element: HTMLElement; at: number } | null = null
  const onFocusOut = (event: FocusEvent) => {
    if (event.target instanceof HTMLElement && event.target !== frame) lost = { element: event.target, at: performance.now() }
  }
  const onBlur = () => {
    if (frame.ownerDocument.activeElement !== frame || !lost || performance.now() - lost.at > 50) return
    const { element } = lost
    stop()
    // Rendu dans le même tour, le focus reste à la visionneuse côté navigateur, et les
    // touches suivantes y partent encore.
    setTimeout(() => {
      if (element.isConnected && frame.ownerDocument.activeElement === frame) element.focus({ preventScroll: true })
    }, 0)
  }
  const timer = setTimeout(() => stop(), delay)
  function stop() {
    clearTimeout(timer)
    frame.ownerDocument.removeEventListener('focusout', onFocusOut, true)
    view?.removeEventListener('blur', onBlur)
  }
  frame.ownerDocument.addEventListener('focusout', onFocusOut, true)
  view.addEventListener('blur', onBlur)
  return stop
}
