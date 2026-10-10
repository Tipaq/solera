import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { Field } from './Field'
import { Presets } from './Presets'

const CRONS = [
  { key: '0 3 * * *', label: 'Chaque nuit' },
  { key: '0 3 * * 1', label: 'Chaque lundi' },
  { key: '0 3 1 * *', label: 'Chaque 1er du mois' },
]

const meta = {
  title: 'Primitives/Presets',
  parameters: {
    docs: {
      description: {
        component:
          "Des valeurs toutes faites qui remplissent le champ au-dessus d'elles — un cron, une adresse de service, une cadence.\n\nCe n'est **pas** un choix exclusif : le champ reste saisissable, et aucune pastille n'est retenue quand on a écrit autre chose. D'où des boutons ordinaires plutôt que des `radio`, et un `selected` facultatif. Pour un choix qui s'exclut, c'est `SegmentedControl` ou `ChoiceList`.\n\nTrois écrans portaient la même rangée mot pour mot, avec le même défaut : vingt-deux pixels de haut, pour une cible qu'on vise au doigt dans un formulaire de réglages.",
      },
    },
  },
} satisfies Meta<typeof Presets>

export default meta
type Story = StoryObj<typeof meta>

function Demo() {
  const [cron, setCron] = useState('0 3 * * *')
  return (
    <div className="flex max-w-md flex-col gap-2">
      <Field
        label="Expression cron"
        value={cron}
        spellCheck={false}
        onChange={(event) => setCron(event.target.value)}
      />
      <Presets label="Cadences courantes" presets={CRONS} selected={cron} onSelect={setCron} />
    </div>
  )
}

export const Defaut: Story = {
  name: 'Par défaut',
  render: () => <Demo />,
}

/** Rien de retenu : le champ porte une valeur qu'aucune pastille ne propose. */
export const HorsListe: Story = {
  name: 'Hors liste',
  render: () => (
    <Presets label="Cadences courantes" presets={CRONS} onSelect={() => {}} />
  ),
}
