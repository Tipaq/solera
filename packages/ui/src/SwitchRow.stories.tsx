import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { SwitchRow } from './SwitchRow'

const meta = {
  title: 'Primitives/SwitchRow',
  parameters: {
    docs: {
      description: {
        component:
          "Une ligne de liste qui s'allume ou s'éteint : un intitulé, sa phrase d'explication, et l'interrupteur à droite. Toute la ligne est la cible et fait 44 px de haut — au doigt, viser un rail de 32 px par 20 au bord d'un panneau rate une fois sur trois.\n\n`role=\"switch\"` : le réglage prend effet au clic, sans formulaire à valider. Un choix entre deux valeurs *nommées* n'est pas un interrupteur et revient à `ChoiceList` ; celui-ci ne convient qu'à ce qui s'allume.",
      },
    },
  },
} satisfies Meta<typeof SwitchRow>

export default meta
type Story = StoryObj<typeof meta>

function Demo({ initial = false, label, description }: { initial?: boolean; label: string; description?: string }) {
  const [checked, setChecked] = useState(initial)
  return (
    <div className="w-80">
      <SwitchRow checked={checked} onCheckedChange={setChecked} label={label} description={description} />
    </div>
  )
}

/** Le cas ordinaire : un réglage de session, avec ce que l'allumer change. */
export const Explique: Story = {
  name: 'Avec explication',
  render: () => (
    <Demo
      initial
      label="Bibliothèque de skills"
      description="Les skills globaux et du projet de Solera sont disponibles"
    />
  ),
}

/** Quand l'intitulé se suffit : un serveur qu'on branche ou non. */
export const Nu: Story = {
  name: 'Intitulé seul',
  render: () => <Demo label="docs" />,
}

/** Inerte : le réglage est tenu ailleurs, mais son état se lit toujours. */
export const Inactif: Story = {
  name: 'Désactivé',
  render: () => (
    <div className="w-80">
      <SwitchRow
        checked
        disabled
        onCheckedChange={() => {}}
        label="Mémoire et coordination"
        description="L'isolation stricte le coupe avec les autres"
      />
    </div>
  ),
}
