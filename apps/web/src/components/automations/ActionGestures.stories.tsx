import type { Decorator, Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { ActionGesture, LaunchButton, ServiceSwitch, type GestureSize } from './ActionGestures'
import { AGENT, NEVER, SERVICE_OFF, STATES, SeededWorktrees, WORKTREES } from './automation-fixtures'

const ignore = () => {}
const withWorktrees: Decorator = (Story) => <SeededWorktrees><Story /></SeededWorktrees>

function Gestures({ size }: { size: GestureSize }) {
  return (
    <ul className="flex max-w-md flex-col gap-2">
      {STATES.map((item) => (
        <li key={item.id} className="flex min-w-0 items-center gap-3">
          <span className="w-40 shrink-0 truncate text-xs text-ink-faint">{item.label}</span>
          <span className="flex min-w-0 flex-1 items-center gap-1.5">
            <ActionGesture item={item} size={size} onReview={ignore} onToggleService={ignore} onTerminal={ignore} onLaunch={ignore} />
          </span>
        </li>
      ))}
    </ul>
  )
}

const meta = {
  title: "Composants d'application/Actions/Gestes",
  component: LaunchButton,
  args: { item: NEVER, onLaunch: ignore },
  decorators: [withWorktrees],
  parameters: {
    docs: {
      description: {
        component:
          "Le geste principal d'une action, toujours au même endroit : « Relire » pour ce qu'un agent a écrit, l'interrupteur d'un service, « Terminal » ou « Session ↗ » pour rejoindre ce qui tourne, sinon « Lancer ▾ ». Le bouton scindé lance à la racine du projet ; son chevron propose la racine puis six arbres au plus. Une tâche d'agent part dans une nouvelle session, sans chevron. En tuile, 44 px au doigt et 36 à partir de `md` ; en ligne, 32 px.",
      },
    },
  },
} satisfies Meta<typeof LaunchButton>

export default meta
type Story = StoryObj<typeof meta>

/** Le geste de chaque état, à la taille d'une tuile. */
export const Tuile: Story = { name: 'Tuile', render: () => <Gestures size="tile" /> }

/** Les mêmes, à la taille d'une ligne de panneau : l'interrupteur perd son mot. */
export const Ligne: Story = { name: 'Ligne', render: () => <Gestures size="row" /> }

/** « Lancer ▾ » d'une commande : le chevron ouvre la racine et les arbres du projet. */
export const Lancer: Story = { name: 'Lancer ▾' }

/** Depuis une conversation : la partie gauche lance dans son arbre. */
export const LancerIci: Story = {
  name: 'Lancer ici',
  args: { here: { worktreeId: WORKTREES[0]!.id, name: WORKTREES[0]!.name } },
}

/** Une tâche d'agent : une nouvelle session, pas de chevron. */
export const LancerAgent: Story = { name: 'Lancer un agent', args: { item: AGENT } }

function Toggle() {
  const [on, setOn] = useState(false)
  return (
    <span className="flex items-center gap-4">
      <ServiceSwitch on={on} label={SERVICE_OFF.label} onToggle={setOn} />
      <ServiceSwitch on={on} label={SERVICE_OFF.label} onToggle={setOn} withText={false} />
    </span>
  )
}

/** L'interrupteur d'un service, avec et sans son mot. Son nom dit ce qu'un clic fera. */
export const Interrupteur: Story = { name: 'Interrupteur', render: () => <Toggle /> }

