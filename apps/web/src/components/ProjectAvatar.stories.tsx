import type { Meta, StoryObj } from '@storybook/react-vite'
import { ProjectAvatar } from './ProjectAvatar'

const meta = {
  title: "Composants d'application/ProjectAvatar",
  component: ProjectAvatar,
  parameters: {
    docs: {
      description: {
        component:
          "Le repère visuel d'un projet : son image, ou à défaut sa pastille de couleur.\n\nLes deux formes occupent **la même boîte**, pour que les noms restent alignés dans une liste où certains projets ont une image et d'autres non.\n\nL'image est en `contain` et non `cover` : un logo rogné ne se reconnaît plus.\n\nLa taille passe par `className` et non par une prop `size` : la boîte est parfois carrée, parfois contrainte par son parent.",
      },
    },
  },
  args: { project: { image: null, color: 'oklch(0.6 0.16 150)' } },
} satisfies Meta<typeof ProjectAvatar>

export default meta
type Story = StoryObj<typeof meta>

export const Couleur: Story = {}

/** Sans couleur déclarée, la pastille retombe sur l'accent du thème. */
export const Repli: Story = {
  name: 'Repli sur l’accent',
  args: { project: { image: null, color: null } },
}

export const Tailles: Story = {
  render: () => (
    <div className="flex items-end gap-4">
      {['size-4', 'size-5', 'size-6', 'size-8'].map((className) => (
        <span key={className} className="flex flex-col items-center gap-2">
          <ProjectAvatar project={{ image: null, color: 'oklch(0.62 0.18 25)' }} className={className} />
          <span className="font-mono text-meta text-ink-faint">{className}</span>
        </span>
      ))}
    </div>
  ),
}

/** Dans une liste : le point de la règle, les noms restent alignés. */
export const EnListe: Story = {
  name: 'En liste',
  render: () => (
    <ul className="flex w-64 flex-col gap-1">
      {[
        { image: null, color: 'oklch(0.6 0.16 150)' },
        { image: null, color: null },
        { image: null, color: 'oklch(0.62 0.18 25)' },
      ].map((project, index) => (
        <li key={index} className="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-ink-soft">
          <ProjectAvatar project={project} />
          projet-{index + 1}
        </li>
      ))}
    </ul>
  ),
}
