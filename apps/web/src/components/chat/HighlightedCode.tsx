import { useMemo } from 'react'
import { highlight, useHighlighterReady } from '../../lib/highlight'
import { cx } from '@solera/ui'

/**
 * Code coloré, dans un `<pre>`.
 *
 * La bibliothèque de coloration est chargée à la demande : le premier bloc affiché de
 * la session apparaît d'abord en clair, puis se colore, plutôt que d'être retenu le
 * temps du téléchargement.
 *
 * La coloration se calcule au rendu, une fois par texte et par langage, et repasse
 * quand la bibliothèque arrive. L'objet `__html` suit le même mémo : React réécrit
 * `innerHTML` dès que l'objet change, même à texte égal, et chaque rendu du fil
 * reconstruisait sinon le DOM de tous ses blocs de code.
 */
export function HighlightedCode({
  code,
  language,
  wrap = false,
  className,
}: {
  code: string
  /** Vide, inconnu ou trop volumineux : le code reste en clair. */
  language: string
  wrap?: boolean
  className?: string
}) {
  const ready = useHighlighterReady()
  const markup = useMemo(() => {
    // Sans langage, `highlight` rend le code en clair : c'est l'état d'avant le chargement.
    const rendered = highlight(code, ready ? language : '')
    return rendered.applied ? { __html: rendered.html } : null
  }, [code, language, ready])

  return (
    <pre className={cx('overflow-x-auto', wrap && 'break-words whitespace-pre-wrap', className)}>
      {markup ? (
        // Les jetons sont des `<span>` de classes `hljs-*`, stylés avec les tokens de
        // thème (voir index.css).
        <code className="hljs" dangerouslySetInnerHTML={markup} />
      ) : (
        // Rendu comme texte : React échappe, on n'a rien à assainir nous-mêmes.
        <code>{code}</code>
      )}
    </pre>
  )
}
