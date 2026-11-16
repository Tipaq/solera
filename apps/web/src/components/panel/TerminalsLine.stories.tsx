import type { Decorator, Meta, StoryObj } from '@storybook/react-vite'
import type { TerminalDto } from '@solera/protocol'
import { TerminalsEmpty, TerminalsLine } from './TerminalsLine'

/** Trois largeurs de panneau : les pastilles défilent, la ligne ne passe jamais à la ligne. */
const inPanels: Decorator = (Story) => (
  <div className="flex flex-col gap-4">
    {['w-[20rem]', 'w-[30rem]', 'w-[48rem]'].map((width) => (
      <div key={width} className={`${width} border border-line`}>
        <Story />
      </div>
    ))}
  </div>
)

const workspacePath = '/home/alex/nimbus'

const shell = (id: string, fields: Partial<TerminalDto> = {}): TerminalDto => ({
  id,
  title: `shell ${id}`,
  alive: true,
  interrupted: false,
  cwd: '/home/alex/.solera/worktrees/nimbus/feat-offline-cache',
  conversationId: 'c1',
  createdAt: 0,
  actionId: null,
  trial: false,
  exitCode: null,
  finishedAt: null,
  ...fields,
})

const meta = {
  title: "Composants d'application/TerminalsLine",
  component: TerminalsLine,
  parameters: {
    docs: {
      description: {
        component:
          "La ligne d'outils de l'onglet Terminaux du panneau, sur le cadre commun (`PanelToolbar`) : « Terminaux » et leur compte, les shells en **pastilles** à la hauteur des outils (point vert vivant, rouge sorti en erreur, gris fini ; titre, dossier ; ✕ au survol, toujours au doigt), « + » au bout, désactivé au plafond.\n\nDes pastilles plutôt qu'une pile : on passe d'un shell à l'autre sans cesse. Elles cèdent avant le titre et défilent quand elles ne tiennent plus.",
      },
    },
  },
  decorators: [inPanels],
  args: {
    terminals: [shell('1'), shell('2', { cwd: workspacePath })],
    active: '1',
    workspacePath,
    opening: false,
    onSelect: () => {},
    onClose: () => {},
    onNew: () => {},
  },
} satisfies Meta<typeof TerminalsLine>

export default meta
type Story = StoryObj<typeof meta>

/** Un shell dans le worktree, l'autre à la racine du projet. */
export const DeuxShells: Story = { name: 'Deux shells' }

/** Vivant, sorti en erreur, fini : la couleur du point dit l'état. */
export const Etats: Story = {
  name: 'États',
  args: {
    terminals: [
      shell('1'),
      shell('2', { title: 'pnpm test', alive: false, exitCode: 1, actionId: 'a1' }),
      shell('3', { alive: false, exitCode: 0 }),
    ],
  },
}

/** Au plafond : « + » se grise et dit pourquoi. */
export const AuPlafond: Story = {
  name: 'Au plafond',
  args: { terminals: ['1', '2', '3', '4', '5', '6'].map((id) => shell(id)) },
}

/** Aucun terminal : l'état centré de l'onglet, sous sa ligne. */
export const Vide: Story = {
  args: { terminals: [], active: null },
  render: (args) => (
    <div className="flex h-80 flex-col">
      <TerminalsLine {...args} />
      <TerminalsEmpty inWorktree opening={false} onNew={args.onNew} />
    </div>
  ),
}

/** Un fil sans worktree : le shell s'ouvrira à la racine du projet. */
export const VideALaRacine: Story = {
  name: 'Vide, à la racine',
  args: { terminals: [], active: null },
  render: (args) => (
    <div className="flex h-80 flex-col">
      <TerminalsLine {...args} />
      <TerminalsEmpty inWorktree={false} opening={false} onNew={args.onNew} />
    </div>
  ),
}
