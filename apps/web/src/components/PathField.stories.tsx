import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { PathField } from './PathField'

const meta = {
  title: "Composants d'application/PathField",
  component: PathField,
  parameters: {
    docs: {
      description: {
        component:
          "Un chemin sur la machine hôte, avec sa validation. Bâti sur `Field`, auquel il ajoute ce que seul un chemin demande.\n\nDistinct de `Field` parce qu'un chemin **se valide** : il doit être absolu, et l'erreur se dit avant l'envoi plutôt qu'au retour du serveur.\n\nL'aide doit préciser que le chemin est celui de la machine hôte — pas celui du poste depuis lequel on remplit le formulaire.",
      },
    },
  },
  args: { label: 'Répertoire de travail', value: '', onChange: () => undefined },
} satisfies Meta<typeof PathField>

export default meta
type Story = StoryObj<typeof meta>

function Demo() {
  const [path, setPath] = useState('/home/tim-north/projects/solera')
  return (
    <div className="w-full max-w-md">
      <PathField
        label="Répertoire de travail"
        value={path}
        onChange={setPath}
        hint="Chemin absolu sur la machine hôte."
        required
      />
    </div>
  )
}

export const Defaut: Story = {
  name: 'Par défaut',
  render: () => <Demo />,
}

export const EnErreur: Story = {
  name: 'En erreur',
  render: () => (
    <div className="w-full max-w-md">
      <PathField
        label="Répertoire de travail"
        value="projets/solera"
        onChange={() => undefined}
        error="Le chemin doit être absolu."
      />
    </div>
  ),
}
