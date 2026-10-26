import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ProjectDto } from '@solera/protocol'
import { ArrangeFreeThreadDialog, ArrangeRefusalDialog } from './ArrangeConversation'

const project = (id: string, name: string, color: string) =>
  ({ id, name, color, image: null, archivedAt: null }) as unknown as ProjectDto

const PROJECTS = [
  project('solera', 'Solera', 'oklch(0.6 0.16 150)'),
  project('ds', 'solera-ds', 'oklch(0.62 0.14 260)'),
  project('site', 'Le site', 'oklch(0.66 0.15 40)'),
]

const meta = {
  title: "Composants d'application/ArrangeConversation",
  component: ArrangeFreeThreadDialog,
  parameters: {
    docs: {
      description: {
        component:
          "*Ranger…* : la destination d'un fil, décidée après coup (cartes #14 et #118).\n\n**La modale du fil libre** s'ouvre depuis la ligne « Sans projet » de son en-tête — un fil rangé y garde le nom de son projet en lien, et rien d'autre ne change. Elle propose les projets, ou de garder le fil en note dans le Savoir (une ébauche, à soi), ou d'en faire un projet. *Garder en note* reste visible et désactivée tant qu'aucun vault n'est réglé.\n\n**Le refus pendant un tour** dit pourquoi le fil ne bouge pas : son CLI tourne dans le dossier que le rangement changerait. Il propose d'arrêter le tour et de ranger tout de suite. Il n'y a pas de rangement différé qui s'appliquerait seul, plus tard.\n\nRanger ne coûte plus la mémoire de l'agent : la session native continue quand le dossier ne change pas, elle est reprise depuis le nouveau quand le CLI le sait, et sinon la session suivante démarre avec le fil en contexte.",
      },
    },
  },
  args: {
    projects: PROJECTS,
    open: true,
    onOpenChange: () => undefined,
    canKeepAsNote: true,
    onPick: () => undefined,
    onKeepAsNote: () => undefined,
    onNewProject: () => undefined,
  },
} satisfies Meta<typeof ArrangeFreeThreadDialog>

export default meta
type Story = StoryObj<typeof meta>

/** Un fil libre, et un vault réglé. */
export const FilLibre: Story = { name: 'Fil libre' }

/** Sans vault : l'entrée reste là, hors d'atteinte. */
export const SansVault: Story = { name: 'Sans vault', args: { canKeepAsNote: false } }

/** Un tour tourne : le refus le dit, et propose d'arrêter. */
export const TourEnCours: Story = {
  name: 'Refus pendant un tour',
  render: () => (
    <ArrangeRefusalDialog
      refusal={{ kind: 'busy', projectId: 'solera' }}
      stopping={false}
      onClose={() => undefined}
      onStopAndMove={() => undefined}
    />
  ),
}

/** L'arrêt est demandé : le bouton attend que le tour se termine. */
export const Arret: Story = {
  name: 'Arrêt du tour',
  render: () => (
    <ArrangeRefusalDialog
      refusal={{ kind: 'busy', projectId: 'solera' }}
      stopping
      onClose={() => undefined}
      onStopAndMove={() => undefined}
    />
  ),
}

/** Le tour ne s'est pas arrêté dans le délai. */
export const TourBloque: Story = {
  name: 'Tour qui ne s’arrête pas',
  render: () => (
    <ArrangeRefusalDialog
      refusal={{ kind: 'stuck', projectId: 'solera' }}
      stopping={false}
      onClose={() => undefined}
      onStopAndMove={() => undefined}
    />
  ),
}
