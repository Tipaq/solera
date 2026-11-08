import { useState } from 'react'
import { HOST_ENVIRONMENT, type ExecutionEnvironment } from '@solera/protocol'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { EnvironmentPill, EnvironmentSelect } from './Environment'

const ALL: ExecutionEnvironment[] = [
  HOST_ENVIRONMENT,
  { where: 'host', confined: true },
  { where: 'devcontainer', confined: false },
  { where: 'devcontainer', confined: true },
]

const meta = {
  title: "Composants d'application/Environment",
  component: EnvironmentPill,
  parameters: {
    docs: {
      description: {
        component:
          "L'**environnement d'exécution** d'une session (ADR 0001) : où tournent son CLI et ses terminaux — l'hôte ou le dev container du projet — et s'ils y sont confinés. Deux axes indépendants, quatre combinaisons.\n\nLe projet en a un par défaut, choisi dans ses réglages ; une session en prend un à sa création, au brouillon, et le garde. La pastille de l'en-tête le rappelle.\n\nTant que seul l'hôte est lancé par le serveur, le sélecteur n'a qu'un choix : il reste affiché, désactivé, pour dire où la session tournera.",
      },
    },
  },
  args: { environment: HOST_ENVIRONMENT },
} satisfies Meta<typeof EnvironmentPill>

export default meta
type Story = StoryObj<typeof meta>

export const Pastille: Story = {}

export const LesQuatre: Story = {
  name: 'Les quatre pastilles',
  render: () => (
    <div className="flex flex-wrap gap-2">
      {ALL.map((environment) => (
        <EnvironmentPill key={`${environment.where}-${environment.confined}`} environment={environment} />
      ))}
    </div>
  ),
}

function Choice({ choices }: { choices: ExecutionEnvironment[] }) {
  const [value, setValue] = useState(choices[0]!)
  return (
    <div className="w-80">
      <EnvironmentSelect value={value} choices={choices} onChange={setValue} />
    </div>
  )
}

/** Aujourd'hui : l'hôte seul, désactivé. */
export const SelecteurHoteSeul: Story = {
  name: 'Sélecteur, hôte seul',
  render: () => <Choice choices={[HOST_ENVIRONMENT]} />,
}

/** Demain, quand le dev container et le confinement seront lancés. */
export const SelecteurComplet: Story = {
  name: 'Sélecteur, tous les choix',
  render: () => <Choice choices={ALL} />,
}

/** Hors de l'hôte non confiné, la pastille mène à la ligne de son environnement dans Services. */
export const VersServices: Story = {
  name: 'Pastille, vers Services',
  args: {
    environment: { where: 'devcontainer', confined: false },
    to: '/services?environment=devcontainer%3Aprojet&session=conversation',
  },
}
