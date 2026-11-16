import type { Meta, StoryObj } from '@storybook/react-vite'
import { Button } from '@solera/ui'
import { ComposerFooter, ComposerHeader, SubmitShortcut } from './ComposerChrome'

function Chrome() {
  return (
    <div className="flex h-[24rem] w-[36rem] max-w-full flex-col border border-line bg-canvas">
      <ComposerHeader eyebrow="Ajouter au jalon" onClose={() => {}}>
        <h2 className="min-w-0 truncate text-xl leading-tight font-semibold tracking-tight text-ink">#182 Page projet v2 · Jalons</h2>
      </ComposerHeader>
      <div className="flex-1 px-6 pt-2 text-sm text-ink-faint">Le champ d’écriture vient ici.</div>
      <ComposerFooter
        info={<span className="min-w-0 flex-1 truncate text-sm text-ink-soft">L’agent le range dans une carte existante, ou propose de nouvelles cartes.</span>}
        actions={
          <>
            <Button size="sm" variant="ghost">Annuler</Button>
            <Button size="sm">
              Proposer à l’agent
              <SubmitShortcut />
            </Button>
          </>
        }
      />
    </div>
  )
}

const meta = {
  title: "Composants d'application/Cadre des tiroirs d'écriture",
  component: Chrome,
  parameters: {
    docs: {
      description: {
        component:
          "L'en-tête et le pied des tiroirs d'écriture (« Ajouter au jalon », « Nouveau jalon ») : la nature en petit, le titre en grand, ✕ ; puis le pied collant, ce qui va se passer à gauche et les gestes à droite, le raccourci `⌘↵`/`Ctrl↵` dans le geste principal dès `md`.",
      },
    },
  },
} satisfies Meta<typeof Chrome>

export default meta
type Story = StoryObj<typeof meta>

export const Cadre: Story = {}
