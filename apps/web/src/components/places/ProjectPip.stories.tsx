import type { Meta, StoryObj } from '@storybook/react-vite'
import { IconButton } from '@solera/ui'
import { ChevronDown } from 'lucide-react'
import { ProjectGroupHeader, ProjectPip } from './ProjectPip'
import { SectionTitle } from './SectionTitle'

const nimbus = { id: 'p1', name: 'Nimbus', image: null, color: '#5B9DF9' }
const atlas = { id: 'p2', name: 'Atlas, l’API des lieux et de leurs fuseaux horaires', image: null, color: '#E0A43B' }

const meta = {
  title: "Composants d'application/Pastille de projet",
  component: ProjectPip,
  parameters: {
    docs: {
      description: {
        component:
          "Ce qui nomme un projet dans une liste qui en mêle plusieurs — `/sessions`, le portefeuille. L'avatar d'abord, puis le nom, tronqué à 12 rem.\n\n**`plain`** : sans lien, dans une ligne déjà cliquable tout entière. **`ProjectGroupHeader`** : l'en-tête d'un groupe par projet, le nom menant au projet ; un geste de repli se pose dans `aside`, à côté du lien et non autour. **`SectionTitle`** : le titre d'une section et son compte, en petites capitales (`group`) pour une tranche de liste.",
      },
    },
  },
  args: { project: nimbus },
} satisfies Meta<typeof ProjectPip>

export default meta
type Story = StoryObj<typeof meta>

/** Un lien vers le projet. */
export const Lien: Story = {}

/** Sans lien, et un nom long tronqué. */
export const Simple: Story = { args: { project: atlas, plain: true } }

/** Les en-têtes de groupe et de section. */
export const EnTetes: Story = {
  render: () => (
    <div className="flex w-96 flex-col gap-4">
      <ProjectGroupHeader
        project={nimbus}
        count={12}
        aside={
          <IconButton size="sm" label="Replier Nimbus" aria-expanded>
            <ChevronDown size={14} />
          </IconButton>
        }
      />
      <SectionTitle count={4}>Projets</SectionTitle>
      <SectionTitle size="group" count={7}>Aujourd’hui</SectionTitle>
    </div>
  ),
}
