import type { Meta, StoryObj } from '@storybook/react-vite'
import { WaitingMark } from './WaitingMark'

const meta = {
  title: "Composants d'application/Ce qui t'attend · Repère d'un jalon",
  component: WaitingMark,
  parameters: {
    docs: {
      description: {
        component:
          "Le repère d'un jalon qui t'attend (`projet.md` A-3.8, INB-13) : un point ambre et « N t'attend ». Il ne redit pas la demande, qui vit dans « Ce qui t'attend » : un clic l'y déplie (`openInboxItem`) et la fait défiler au centre.",
      },
    },
  },
  args: { waiting: { count: 1, key: 's-demo' } },
} satisfies Meta<typeof WaitingMark>

export default meta
type Story = StoryObj<typeof meta>

export const Une: Story = { name: 'Une demande' }

export const Plusieurs: Story = { args: { waiting: { count: 3, key: 's-demo' } } }
