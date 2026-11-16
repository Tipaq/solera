import type { Meta, StoryObj } from '@storybook/react-vite'
import { CheckBox } from './CheckBox'

const meta = {
  title: "Composants d'application/Case à cocher",
  component: CheckBox,
  parameters: {
    docs: {
      description: {
        component:
          "La case seule, **muette** (`aria-hidden`) : celui qui la porte dit son rôle et son état — `role=\"checkbox\"` d'une ligne de `/sessions` en sélection, `checkbox` ou `radio` d'un `MenuCheck`. `round` pour un choix unique.",
      },
    },
  },
  args: { checked: false },
} satisfies Meta<typeof CheckBox>

export default meta
type Story = StoryObj<typeof meta>

/** Les quatre formes : case et rond, vide et cochée. */
export const Formes: Story = {
  render: () => (
    <div className="flex items-center gap-4">
      <CheckBox checked={false} />
      <CheckBox checked />
      <CheckBox checked={false} round />
      <CheckBox checked round />
    </div>
  ),
}
