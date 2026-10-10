import type { Meta, StoryObj } from '@storybook/react-vite'
import { Code, Empty, Plain, Section } from '../tools/parts'
import { CodeBlock } from './CodeBlock'
import { HighlightedCode } from './HighlightedCode'

const SNIPPET = `// Sept rôles, un seul extrait.
import { readFile } from 'node:fs/promises'

const SEUIL = 0.85
type Niveau = 'calme' | 'tendu'

export async function decrire(state: ContextState): Promise<string> {
  const ratio = state.usedTokens / state.maxTokens
  return \`\${Math.round(ratio * 100)} % (\${ratio > SEUIL ? 'tendu' : 'calme'})\`
}`

const meta = {
  title: "Composants d'application/Surfaces de code",
  component: CodeBlock,
  parameters: {
    docs: {
      description: {
        component:
          "Les trois façons d'afficher du code, et les briques communes aux vues d'outils. Toutes lisent les mêmes sept jetons `--sg-syn-*` : change la palette dans la barre d'outils, tout suit d'un coup.\n\n**`CodeBlock`** — le bloc complet avec sa barre d'outils : copie, retour à la ligne, téléchargement. Le choix par défaut dès que le code peut être copié.\n\n**`HighlightedCode`** — le code seul, sans cadre ni barre, à employer quand l'appelant fournit déjà les deux. Au-delà de 100 Ko la coloration est abandonnée : analyser un gros fichier bloquerait le fil d'exécution.\n\n**`tools/parts`** — un petit design system dans le design system. Huit vues d'outils l'importent, et c'est lui qui fait qu'un `Read` et un `Bash` se lisent de la même façon. Un renderer qui invente sa propre mise en forme fait perdre plus qu'il n'apporte.",
      },
    },
  },
  args: { language: 'ts', code: SNIPPET },
} satisfies Meta<typeof CodeBlock>

export default meta
type Story = StoryObj<typeof meta>

export const Bloc: Story = {
  name: 'CodeBlock',
  render: (args) => (
    <div className="max-w-2xl">
      <CodeBlock {...args} />
    </div>
  ),
}

export const Nu: Story = {
  name: 'HighlightedCode',
  render: () => (
    <div className="max-w-2xl overflow-x-auto rounded-md border border-line bg-sunken p-3">
      <HighlightedCode code={SNIPPET} language="ts" className="font-mono text-code" />
    </div>
  ),
}

/**
 * Les quatre briques des vues d'outils, dans l'ordre où un appel les emploie :
 * l'argument, le contenu, la sortie, et l'absence de sortie.
 */
export const Outils: Story = {
  name: 'tools/parts',
  render: () => (
    <div className="flex max-w-2xl flex-col gap-4">
      <Section label="file_path" hint="src/styles/tokens.css" />
      <Section label="content">
        <Code content={SNIPPET} language="ts" />
      </Section>
      <Section label="stdout">
        <Plain content={'tokens.css\nindex.css\n2 fichiers'} />
      </Section>
      <Section label="stderr">
        <Empty>Aucune sortie</Empty>
      </Section>
    </div>
  ),
}
