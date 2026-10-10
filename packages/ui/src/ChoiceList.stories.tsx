import type { Meta, StoryObj } from '@storybook/react-vite'
import { GitBranch, Copy } from 'lucide-react'
import { useState } from 'react'
import { ChoiceList, type Choice } from './ChoiceList'

const SCOPES: Choice<string>[] = [
  {
    value: 'worktree',
    label: 'Worktree dédié',
    hint: 'Une branche par session, isolée du dossier principal.',
    icon: <GitBranch size={15} />,
  },
  {
    value: 'clone',
    label: 'Clone complet',
    hint: 'Un dossier séparé, plus lent à créer.',
    icon: <Copy size={15} />,
  },
]

const meta = {
  title: 'Primitives/ChoiceList',
  parameters: {
    docs: {
      description: {
        component:
          "Quelques options **dépliées** plutôt que repliées dans une liste déroulante.\n\nUn `select` cache ce qu'on peut choisir avant qu'on l'ouvre, et ne montre jamais deux options côte à côte. Quand elles sont peu nombreuses et qu'elles portent une explication, les montrer coûte quelques lignes et évite l'ouverture. Au-delà d'une demi-douzaine, la liste déroulante reprend l'avantage.\n\nSémantique de groupe de boutons radio, pas de boutons pressés : les options s'excluent, et un lecteur d'écran doit l'annoncer comme tel.\n\nLa coche occupe sa place **même absente** : apparaissant au choix, elle décalerait le libellé de chaque ligne au moment du clic.",
      },
    },
  },
} satisfies Meta<typeof ChoiceList>

export default meta
type Story = StoryObj<typeof meta>

function Demo() {
  const [value, setValue] = useState('worktree')
  return (
    <div className="max-w-md">
      <ChoiceList
        label="Répertoire de travail"
        value={value}
        options={SCOPES}
        onChange={setValue}
      />
    </div>
  )
}

export const Defaut: Story = {
  name: 'Par défaut',
  render: () => <Demo />,
}
