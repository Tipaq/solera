import { useAppearance } from '../../web/src/lib/appearance'
import { AppearanceControls } from '../../web/src/components/AppearanceControls'

/**
 * Spécimens des règles propres à Solera : ce que sa feuille `app.css` style, et que le
 * design system ne connaît pas. Les fondations — couleurs, échelles, syntaxe — sont dans
 * le Storybook du design system, composé dans celui-ci.
 */

const SENTENCE = 'Le vif zéphyr jubile sur les quais.'

/** Le markdown rendu : la feuille style des balises, pas des utilitaires. */
export function MarkdownSample() {
  return (
    <div className="sg-markdown my-4 max-w-prose rounded-md border border-line bg-sunken p-4 text-sm text-ink">
      <h2>Un titre de niveau deux</h2>
      <p>
        Un paragraphe, avec du code inline comme <code>--sg-accent</code>, et un chemin
        cliquable rendu par <code>.sg-file</code> quand le serveur confirme qu'il existe.
      </p>
      <ul>
        <li>Une puce</li>
        <li>Une deuxième, pour voir l'écart entre les deux</li>
      </ul>
      <blockquote>Une citation, bordée à gauche et en encre atténuée.</blockquote>
      <pre>
        <code>pnpm build</code>
      </pre>
    </div>
  )
}

/** Le confort de lecture, réglé par l'utilisateur et porté par `.sg-reading`. */
export function ReadingSample() {
  const appearance = useAppearance()
  return (
    <div className="my-4 flex max-w-lg flex-col gap-4">
      <p className="sg-reading">
        {SENTENCE} Le réglage porte la taille, l'interligne et l'atténuation de l'encre.
      </p>
      <AppearanceControls
        appearance={appearance}
        keys={['readingSize', 'readingLeading', 'readingSoftness']}
        swatches={false}
      />
    </div>
  )
}
