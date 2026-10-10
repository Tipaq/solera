import type { Meta, StoryObj } from '@storybook/react-vite'
import { parseUnifiedDiff } from '../lib/diff'
import { DiffHunks } from './DiffHunks'

const PATCH = `diff --git a/src/styles/tokens.css b/src/styles/tokens.css
--- a/src/styles/tokens.css
+++ b/src/styles/tokens.css
@@ -12,7 +12,8 @@ function resolve(token) {
   --sg-accent: oklch(0.54 0.19 var(--sg-hue));
-  --sg-line: oklch(0.895 0.032 var(--sg-hue));
+  --sg-line: oklch(calc(0.895 + var(--sg-lift)) 0.032 var(--sg-hue));
+  --sg-line-strong: oklch(calc(0.8 + var(--sg-lift)) 0.05 var(--sg-hue));
 }
`

const file = parseUnifiedDiff(PATCH)[0]

const meta = {
  title: "Composants d'application/DiffHunks",
  component: DiffHunks,
  parameters: {
    docs: {
      description: {
        component:
          "Un diff unifié, coloré **ligne à ligne** et non par bloc : un diff n'est pas du code continu, ses lignes supprimées et ajoutées ne coexistent nulle part. Un commentaire multiligne ou un littéral de gabarit peut donc être mal coloré, ce que `ignoreIllegals` rend inoffensif et que la lecture d'un diff pardonne largement.\n\nLes tons sont des lavis à 12 %, sans couleur de texte : le code garde sa coloration syntaxique, sinon un diff cesserait de se lire comme du code. Change la palette dans la barre d'outils pour le vérifier.\n\nLes numéros de ligne sont `select-none` : copier un extrait doit donner du code, pas du code numéroté.",
      },
    },
  },
  args: { hunks: file?.hunks ?? [], path: 'src/styles/tokens.css' },
} satisfies Meta<typeof DiffHunks>

export default meta
type Story = StoryObj<typeof meta>

export const Defaut: Story = {
  name: 'Par défaut',
  render: (args) => (
    <div className="max-w-2xl overflow-hidden rounded-md border border-line bg-sunken">
      <DiffHunks {...args} />
    </div>
  ),
}
