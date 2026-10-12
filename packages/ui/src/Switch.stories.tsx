import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { Switch } from './Switch'

const meta = {
  title: 'Primitives/Switch',
  parameters: {
    docs: {
      description: {
        component:
          "Un interrupteur seul, pour les endroits où l'intitulé est déjà porté par la ligne ou par l'en-tête de colonne — une cellule de tableau, typiquement.\n\nPartout ailleurs, c'est `SwitchRow` qu'il faut : un interrupteur sans phrase à côté de lui n'apprend pas ce que l'allumer change. Son `label` est obligatoire et ne sert qu'au lecteur d'écran ; la cible fait 44 px de haut, le rail n'en faisant que 20.",
      },
    },
  },
} satisfies Meta<typeof Switch>

export default meta
type Story = StoryObj<typeof meta>

function Demo({ initial = false, disabled = false }: { initial?: boolean; disabled?: boolean }) {
  const [checked, setChecked] = useState(initial)
  return <Switch checked={checked} onCheckedChange={setChecked} disabled={disabled} label="Tâche active" />
}

/** Les deux états, côte à côte : c'est le contraste qui dit lequel est allumé. */
export const Etats: Story = {
  name: 'Allumé et éteint',
  render: () => (
    <div className="flex items-center gap-4">
      <Demo initial />
      <Demo />
    </div>
  ),
}

/** Inerte pendant l'aller-retour serveur : l'état se lit encore, on ne peut plus le changer. */
export const Inactif: Story = {
  name: 'Désactivé',
  render: () => <Demo initial disabled />,
}

/**
 * Dans une ligne de tableau, où la colonne porte l'intitulé — le seul cas pour lequel
 * cette primitive existe.
 */
export const DansUnTableau: Story = {
  name: 'En cellule',
  render: () => (
    <table className="w-80 text-sm">
      <thead>
        <tr className="text-left text-xs text-ink-faint uppercase">
          <th scope="col" className="pb-2 font-semibold">Tâche</th>
          <th scope="col" className="pb-2 text-right font-semibold">Active</th>
        </tr>
      </thead>
      <tbody>
        {['Mettre à jour les CLI', 'Relire les dépendances'].map((name, index) => (
          <tr key={name} className="border-t border-line/60">
            <td className="py-1">{name}</td>
            <td className="py-1">
              <span className="flex justify-end"><Demo initial={index === 0} /></span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  ),
}
