import { useEffect, useState } from 'react'
import { FileCode, GitBranch, Repeat, Sparkles } from 'lucide-react'
import { resolveToken, useAppearance } from '../../web/src/lib/appearance'
import { useTheme } from '../../web/src/lib/theme'
import { AppearanceControls } from '../../web/src/components/AppearanceControls'
import { HighlightedCode } from '../../web/src/components/chat/HighlightedCode'
import { Badge, cx } from '@solera/ui'
import {
  DENSITIES,
  ICON_SIZES,
  LAYERS,
  RADII,
  SHADOWS,
  TEXT_STEPS,
  type Step,
} from '@solera/ui/tokens'

/**
 * Spécimens du catalogue : les grilles visuelles, sans un mot de prose.
 *
 * La prose vit dans les pages MDX, et les spécimens ici. La séparation n'est pas
 * cosmétique : une règle se réécrit souvent, une grille presque jamais, et les mélanger
 * ferait relire du JSX pour corriger une phrase.
 *
 * **Aucune valeur n'est recopiée ici.** Les échelles statiques viennent de
 * `@solera/ui/tokens`, qui est aussi la source du CSS généré : une table de catalogue ne
 * peut donc plus annoncer 1.5rem là où le navigateur applique 1rem. Les couleurs, elles,
 * sont résolues sur le document, parce qu'elles dépendent des réglages de l'utilisateur
 * et qu'aucune source statique ne peut les dire.
 *
 * Les classes sont écrites en toutes lettres — dans les tables d'ici comme dans
 * `tokens.ts`, que le `@source` du catalogue couvre — et c'est obligatoire : Tailwind
 * scanne les fichiers source et ne génère rien pour une classe assemblée à l'exécution.
 * Un `rounded-${name}` produirait une page sans aucun arrondi, et sans la moindre erreur
 * pour le dire.
 */

function Mono({ children }: { children: React.ReactNode }) {
  return <code className="font-mono text-meta text-ink-faint">{children}</code>
}

const SURFACES = [
  ['--sg-canvas', 'bg-canvas', "Le fond de l'application. Plat, porté par la racine."],
  ['--sg-surface', 'bg-surface', 'Ce qui se détache du fond : carte, barre, dialogue.'],
  ['--sg-surface-high', 'bg-surface-high', 'Survol, état actif, en-tête de tableau.'],
  ['--sg-sunken', 'bg-sunken', "Ce qui s'enfonce : champ de saisie, bloc de code."],
] as const

const INKS = [
  ['--sg-ink', 'bg-ink', "Le texte qu'on lit."],
  ['--sg-ink-soft', 'bg-ink-soft', 'Libellé, intitulé de champ, texte secondaire.'],
  ['--sg-ink-faint', 'bg-ink-faint', 'Métadonnée, horodatage, aide.'],
] as const

const ACCENTS = [
  ['--sg-accent', 'bg-accent', "L'action principale, la sélection, le tour en cours."],
  ['--sg-accent-hover', 'bg-accent-hover', "Survol des éléments portant l'accent."],
  ['--sg-accent-ink', 'bg-accent-ink', 'Le texte posé *sur* l’accent.'],
  ['--sg-accent-wash', 'bg-accent-wash', 'Fond teinté : entrée sélectionnée, badge.'],
] as const

const STATUSES = [
  ['--sg-positive', 'bg-positive', 'Réussi, propre, à jour.'],
  ['--sg-caution', 'bg-caution', 'À regarder, sans être cassé.'],
  ['--sg-critical', 'bg-critical', 'Erreur, destruction, échec.'],
  ['--sg-loop', 'bg-loop', 'Boucle armée. Teinte absolue.'],
] as const

const LINES = [
  ['--sg-line', 'bg-line', 'Sépare deux zones.'],
  ['--sg-line-strong', 'bg-line-strong', "Survol d'un élément bordé, poignée visible."],
] as const

/**
 * Table de jetons de couleur, avec la valeur sRGB lue sur le document.
 *
 * Résolue après le montage et non au rendu : la valeur n'existe que dans un navigateur,
 * où `<html>` porte le thème et les variables d'apparence. Les deux abonnements sont
 * nécessaires pour la relire — elle change au curseur d'apparence *comme* au changement
 * de thème.
 */
export function Tokens({
  rows,
}: {
  rows: readonly (readonly [string, string, string])[]
}) {
  const { values } = useAppearance()
  const [theme] = useTheme()
  const [resolved, setResolved] = useState<Record<string, string>>({})

  useEffect(() => {
    setResolved(Object.fromEntries(rows.map(([token]) => [token, resolveToken(token)])))
  }, [rows, values, theme])

  return (
    <div className="my-4 overflow-x-auto rounded-md border border-line">
      <table className="w-full border-collapse text-left">
        <tbody>
          {rows.map(([token, className, role]) => (
            <tr key={token} className="border-t border-line align-middle first:border-t-0">
              <td className="w-10 px-3 py-2">
                <span className={cx('block size-6 rounded-sm border border-line', className)} />
              </td>
              <td className="px-3 py-2 whitespace-nowrap">
                <code className="font-mono text-code text-ink">{token}</code>
              </td>
              <td className="px-3 py-2 whitespace-nowrap">
                <Mono>{className}</Mono>
              </td>
              <td className="px-3 py-2 whitespace-nowrap">
                <Mono>{resolved[token] ?? '…'}</Mono>
              </td>
              <td className="px-3 py-2 text-xs text-ink-faint">{role}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export const SurfaceTokens = () => <Tokens rows={SURFACES} />
export const InkTokens = () => <Tokens rows={INKS} />
export const AccentTokens = () => <Tokens rows={ACCENTS} />
export const StatusTokens = () => <Tokens rows={STATUSES} />
export const LineTokens = () => <Tokens rows={LINES} />

/** Bac à spécimen : un fond sunken, pour ce qui serait invisible sur le canevas. */
export function Stage({ children }: { children: React.ReactNode }) {
  return (
    <div className="my-4 flex flex-wrap items-center gap-5 rounded-md border border-line bg-sunken p-4">
      {children}
    </div>
  )
}

function Labelled({ name, meta, children }: { name: string; meta?: string; children: React.ReactNode }) {
  return (
    <span className="flex min-w-0 flex-col gap-1.5">
      {children}
      <span className="flex flex-wrap items-baseline gap-x-2">
        <code className="font-mono text-meta text-ink-soft">{name}</code>
        {meta ? <Mono>{meta}</Mono> : null}
      </span>
    </span>
  )
}

/** Le seul endroit où l'on voit que le dégradé de surface existe. */
export function SurfaceGradient() {
  return (
    <Stage>
      <Labelled name=".surface" meta="dégradé signature">
        <span className="surface block h-16 w-44 rounded-lg border border-line" />
      </Labelled>
      <Labelled name="bg-surface" meta="couleur seule">
        <span className="block h-16 w-44 rounded-lg border border-line bg-surface" />
      </Labelled>
    </Stage>
  )
}

export function AccentOn() {
  return (
    <Stage>
      <span className="gradient-accent rounded-md px-3 py-2 text-sm font-medium text-accent-ink">
        Texte sur accent
      </span>
      <span className="rounded-md bg-accent-wash px-3 py-2 text-sm font-medium text-accent">
        Texte sur lavis
      </span>
      <Labelled name="gradient-accent">
        <span className="gradient-accent block h-10 w-32 rounded-md" />
      </Labelled>
    </Stage>
  )
}

export function Appearance() {
  const appearance = useAppearance()
  const [theme] = useTheme()
  return (
    <div className="my-4 max-w-lg">
      {/* Le thème contrasté est neutre par construction : teinte et intensité n'y
          produiraient rien, seule la luminosité a un effet. */}
      <AppearanceControls
        appearance={appearance}
        keys={theme === 'dark-contrast' ? ['lift'] : ['hue', 'tint', 'lift']}
      />
    </div>
  )
}

const SENTENCE = 'Le vif zéphyr jubile sur les quais.'

/**
 * La valeur d'un pas, telle que la source la déclare.
 *
 * Un pas sans jeton vient de l'échelle intégrée de Tailwind : on le dit, plutôt que de
 * recopier ici une valeur dont nous ne sommes pas la source.
 */
function Value({ step }: { step: Step }) {
  return <Mono>{step.value ?? 'échelle Tailwind'}</Mono>
}

/** Le pas `text-code` se montre en monospace, puisqu'il ne s'emploie que là. */
const CODE_SAMPLE = 'const ratio = used / max'

export function TypeScale() {
  return (
    <div className="my-4 flex flex-col divide-y divide-line rounded-md border border-line px-3">
      {TEXT_STEPS.map((step) => (
        <div key={step.className} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 py-2.5">
          <span
            className={cx(
              'min-w-0 flex-1 text-ink',
              step.className,
              step.className === 'text-code' && 'font-mono',
            )}>
            {step.className === 'text-code' ? CODE_SAMPLE : SENTENCE}
          </span>
          <span className="flex shrink-0 flex-col items-end gap-0.5">
            <code className="font-mono text-meta text-ink-soft">{step.className}</code>
            <Value step={step} />
          </span>
          <span className="w-full text-xs text-ink-faint sm:w-52">{step.role}</span>
        </div>
      ))}
    </div>
  )
}

export function Radii() {
  return (
    <div className="my-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
      {RADII.map((step) => (
        <div key={step.className} className="flex flex-col gap-1.5">
          <span className={cx('surface block h-14 border border-line', step.className)} />
          <code className="font-mono text-meta text-ink-soft">{step.className}</code>
          <Value step={step} />
          <span className="text-xs text-ink-faint">{step.role}</span>
        </div>
      ))}
    </div>
  )
}

/** L'imbrication : seule, une valeur de rayon ne dit rien. */
export function RadiusNesting() {
  return (
    <Stage>
      <Labelled name="lg > md" meta="l'ordre tenu">
        <span className="surface block rounded-lg border border-line p-3">
          <span className="block rounded-md border border-line bg-sunken px-3 py-2 text-sm text-ink-soft">
            Contrôle dans une carte
          </span>
        </span>
      </Labelled>
      <Labelled name="md > xl" meta="l'ordre inversé">
        <span className="surface block rounded-md border border-line p-3">
          <span className="block rounded-xl border border-line bg-sunken px-3 py-2 text-sm text-ink-soft">
            Plus arrondi que son cadre
          </span>
        </span>
      </Labelled>
    </Stage>
  )
}

export function Densities() {
  return (
    <div className="my-4 flex flex-col gap-4">
      {DENSITIES.map((density) => (
        <div key={density.className} className="flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-3">
            {/* Même contenu sur les trois lignes : seule la densité change. */}
            <span
              className={cx(
                'flex items-center rounded-md border border-line bg-sunken',
                density.gap,
                density.className,
              )}>
              <GitBranch size={14} className="text-ink-faint" />
              <span className="text-sm text-ink-soft">main</span>
              <Badge>+3</Badge>
            </span>
            <code className="font-mono text-meta text-ink-soft">{density.className}</code>
            <Mono>{density.gap}</Mono>
          </div>
          <span className="text-xs text-ink-faint">{density.role}</span>
        </div>
      ))}
    </div>
  )
}

export function Shadows() {
  const [theme] = useTheme()
  return (
    <>
      <Stage>
        {SHADOWS.map((shadow) => (
          <Labelled key={shadow.className} name={shadow.className} meta={shadow.token}>
            <span
              className={cx(
                'surface block h-16 w-40 rounded-lg border border-line',
                shadow.className,
              )}
            />
            <span className="block max-w-40 text-xs text-ink-faint">{shadow.role}</span>
          </Labelled>
        ))}
      </Stage>
      <p className="text-xs text-ink-faint">
        {theme === 'dark-contrast'
          ? 'Thème contrasté : les trois valent `none`. Les carrés ci-dessus sont donc plats, et c’est ce que verra l’utilisateur.'
          : 'Passe au thème contrasté dans la barre d’outils pour voir disparaître les trois : un composant qui compte sur son ombre y est cassé.'}
      </p>
    </>
  )
}

export function Icons() {
  return (
    <div className="my-4 flex flex-col divide-y divide-line rounded-md border border-line px-3">
      {ICON_SIZES.map(({ size, role }) => (
        <div key={size} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5">
          <span className="flex w-20 shrink-0 items-center gap-2 text-ink-soft">
            <Sparkles size={size} />
            <Repeat size={size} />
            <FileCode size={size} />
          </span>
          <code className="font-mono text-meta text-ink-soft">size={`{${size}}`}</code>
          <span className="min-w-0 flex-1 text-xs text-ink-faint">{role}</span>
        </div>
      ))}
    </div>
  )
}

export function Layers() {
  return (
    <div className="my-4 flex flex-col divide-y divide-line rounded-md border border-line px-3">
      {LAYERS.map((layer) => (
        <div key={layer.className} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 py-2">
          <code className="w-20 shrink-0 font-mono text-meta text-ink-soft">
            {layer.className}
          </code>
          <span className="min-w-0 flex-1 text-xs text-ink-faint">{layer.role}</span>
        </div>
      ))}
    </div>
  )
}

const SYNTAX_SAMPLE = `// Sept rôles, un seul extrait.
import { readFile } from 'node:fs/promises'

const SEUIL = 0.85
type Niveau = 'calme' | 'tendu'

export async function decrire(state: ContextState): Promise<string> {
  const ratio = state.usedTokens / state.maxTokens
  return \`\${Math.round(ratio * 100)} % (\${ratio > SEUIL ? 'tendu' : 'calme'})\`
}`

const SYNTAX_ROLES = [
  'comment',
  'keyword',
  'string',
  'number',
  'function',
  'type',
  'attribute',
] as const

/**
 * Les sept rôles dans un extrait qui les porte tous.
 *
 * Volontairement court et volontairement complet : une palette jugée sur trois rôles se
 * choisit sur une impression partielle.
 */
export function SyntaxSample() {
  useTheme()
  return (
    <>
      <div className="my-4 overflow-x-auto rounded-md border border-line bg-sunken p-3">
        <HighlightedCode
          code={SYNTAX_SAMPLE}
          language="ts"
          className="font-mono text-code leading-relaxed"
        />
      </div>
      <div className="my-4 flex flex-wrap items-center gap-3">
        {SYNTAX_ROLES.map((role) => (
          <span key={role} className="flex items-center gap-1.5">
            <span className="size-3 rounded-full" style={{ background: `var(--sg-syn-${role})` }} />
            <Mono>--sg-syn-{role}</Mono>
          </span>
        ))}
      </div>
    </>
  )
}

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
