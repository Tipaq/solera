import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { Button } from './Button'
import { Field } from './Field'
import { Popover } from './Popover'

const meta = {
  title: 'Primitives/Popover',
  parameters: {
    docs: {
      description: {
        component:
          "Un panneau ancré à **contenu libre** : il peut porter des champs, ce qu'un `Menu` ne peut pas.\n\nL'ouverture est pilotée par l'appelant et non par un état interne : un panneau se ferme souvent depuis son propre contenu, après une action.\n\nLa hauteur est bornée par la place réelle au-dessus du déclencheur, que Radix mesure — une constante déborderait sur une fenêtre courte.\n\n`onCloseAutoFocus` est là pour intercepter le retour du focus : Radix le ramène au déclencheur, ce qui n'est pas toujours où l'on veut l'envoyer.",
      },
    },
  },
} satisfies Meta<typeof Popover>

export default meta
type Story = StoryObj<typeof meta>

function Demo() {
  const [open, setOpen] = useState(false)
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      label="Choix de branche"
      side="bottom"
      trigger={<Button variant="secondary">Branche</Button>}
    >
      <div className="flex w-64 flex-col gap-2 p-3">
        <p className="text-xs text-ink-faint">
          Un panneau à contenu libre : champs, boutons, ce qu'on veut.
        </p>
        <Field label="Nom" defaultValue="main" />
        <Button size="sm" onClick={() => setOpen(false)}>
          Appliquer
        </Button>
      </div>
    </Popover>
  )
}

export const Defaut: Story = {
  name: 'Par défaut',
  render: () => <Demo />,
}
