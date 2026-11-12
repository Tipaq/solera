import type { Meta, StoryObj } from '@storybook/react-vite'
import { Plus } from 'lucide-react'
import type { LibrarySkillDto } from '@solera/protocol'
import { Button } from '@solera/ui'
import { ProjectSkillList } from './ProjectSkills'

const skill = (name: string, description: string, enabled = true): LibrarySkillDto => ({
  id: name,
  scope: 'project',
  projectId: 'nimbus',
  name,
  description,
  enabled,
  origin: null,
  locallyModified: false,
  updateAvailable: false,
  compat: [],
  problem: null,
  createdAt: 0,
  updatedAt: 0,
})

const SKILLS = [
  skill('deployer-la-preprod', 'Pousse la branche courante sur la préprod et vérifie la santé du service.'),
  skill('migrations-drizzle', 'Écrit une migration drizzle dans l’ordre, avec son test.'),
  skill('ancien-rituel', 'Le rituel de release d’avant la CI.', false),
]

const add = (
  <Button size="sm" variant="ghost" icon={<Plus size={14} />} className="self-start">
    Ajouter un skill
  </Button>
)

const meta = {
  title: "Composants d'application/Réglages › Skills",
  component: ProjectSkillList,
  args: { own: SKILLS, instanceCount: 12, libraryOff: false, add },
  parameters: {
    docs: {
      description: {
        component:
          "Les skills propres au projet, une ligne chacun : le nom, la description, « désactivé » s'il l'est. Déplié, la ligne mène à l'éditeur du skill. Dessous, ce que l'instance livre ici aussi, puis le menu d'ajout (propriétaire seul).",
      },
    },
  },
  decorators: [(Story) => <div className="max-w-[60rem]"><Story /></div>],
} satisfies Meta<typeof ProjectSkillList>

export default meta
type Story = StoryObj<typeof meta>

export const Liste: Story = {}
export const Aucun: Story = { name: 'Aucun skill propre', args: { own: [], instanceCount: 1 } }
export const BibliothequeCoupee: Story = { name: 'Bibliothèque coupée', args: { libraryOff: true, add: null } }
