import type { Meta, StoryObj } from '@storybook/react-vite'
import type { PlannedScope } from '../../lib/planned'
import { PROJECTS } from './planned-fixtures'
import { ScopePip } from './ScopeMarks'

const SCOPES: PlannedScope[] = [
  { kind: 'project', projectId: PROJECTS[0]!.id, project: PROJECTS[0]! },
  { kind: 'vault' },
  { kind: 'instance' },
  { kind: 'none' },
  { kind: 'project', projectId: 'p-gone', project: null },
]

const meta = {
  title: "Composants d'application/Planifiées/Portée",
  component: ScopePip,
  args: { scope: SCOPES[0]!, plain: true },
  parameters: {
    docs: {
      description: {
        component:
          "**La pastille de portée** : où une tâche planifiée travaille. La `ProjectPip` d'un projet, sinon l'icône et le nom — le Savoir (le vault), l'instance (son dossier de données), sans projet ; un projet qu'on ne voit plus reste nommé « Projet inconnu ».",
      },
    },
  },
} satisfies Meta<typeof ScopePip>

export default meta
type Story = StoryObj<typeof meta>

export const Toutes: Story = {
  name: 'Toutes les portées',
  render: () => (
    <div className="flex flex-col gap-2">
      {SCOPES.map((scope, index) => (
        <ScopePip key={index} scope={scope} plain />
      ))}
    </div>
  ),
}
