import type { Meta, StoryObj } from '@storybook/react-vite'
import type { SystemLoadDto } from '@solera/protocol'
import { SystemLoad, type LoadConsumer } from './SystemLoad'

const MB = 1024 * 1024
const GB = 1024 * MB

const system: SystemLoadDto = {
  cpu: 0.46,
  cores: 8,
  load: [3.7, 2.9, 2.1],
  memoryTotal: 16 * GB,
  memoryAvailable: 6.1 * GB,
  swapTotal: 4 * GB,
  swapFree: 3.4 * GB,
}

const consumers: LoadConsumer[] = [
  { id: 'load', label: 'node scripts/load-test.mjs --clients 200', memoryBytes: 1240 * MB, cpu: 1.8 },
  { id: 'pytest', label: 'python -m pytest -x tests/migrations', memoryBytes: 860 * MB, cpu: 0.97 },
  { id: 'storybook', label: 'pnpm storybook --port 6006', memoryBytes: 530 * MB, cpu: 0.04 },
  { id: 'agent', label: 'Refonte du tableau de bord', memoryBytes: 515 * MB, cpu: 0.08 },
  { id: 'gateway', label: 'api-gateway', memoryBytes: 460 * MB, cpu: 0.12 },
  { id: 'vite', label: 'pnpm vite --port 5173', memoryBytes: 380 * MB, cpu: 0.34 },
  { id: 'docs', label: 'docs-site', memoryBytes: 95 * MB, cpu: 0 },
]

/**
 * La charge de la machine en tête de la page des services : le processeur en deux parts
 * (Solera, le reste), la mémoire empilée par gros consommateur, puis hors Solera et
 * disponible.
 */
const meta = {
  title: "Composants d'application/Services · machine",
  component: SystemLoad,
  args: { system, consumers },
  render: (args) => <div className="w-[56rem]"><SystemLoad {...args} /></div>,
} satisfies Meta<typeof SystemLoad>

export default meta
type Story = StoryObj<typeof meta>

export const Chargee: Story = { name: 'Machine chargée' }

export const Tendue: Story = {
  name: 'Mémoire presque pleine',
  args: { system: { ...system, cpu: 0.93, memoryAvailable: 0.9 * GB, swapFree: 1.2 * GB } },
}

export const Calme: Story = {
  name: 'Peu de services, première mesure',
  args: { system: { ...system, cpu: null, memoryAvailable: 12.4 * GB }, consumers: consumers.slice(5) },
}
