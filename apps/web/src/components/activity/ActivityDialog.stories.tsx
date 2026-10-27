import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState, type ComponentProps } from 'react'
import { ActivityDialog, type ActivityFilter } from './ActivityDialog'
import { ENTRIES, FOR_YOU, PROJECTS, SeededForYou } from './for-you-fixtures'

const meta = {
  title: "Composants d'application/ActivityDialog",
  component: ActivityDialog,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          "La modale d'Activité (#121) : quatre filtres qui portent leur compte — **Pour toi**, Non lues, En cours, Tout — et le filtre par projet qui les croise. Elle s'ouvre sur le premier filtre qui n'est pas vide.\n\n« Pour toi » liste ce qui t'attend, une ligne par demande : les fils bloqués, puis les décisions, puis les accords. Une demande se déplie sur place pour y répondre sans ouvrir le fil ; « Ouvrir le fil » ferme la modale. Un clic sur une demande dans la colonne ouvre la modale dépliée sur elle.\n\nGabarit de dialogue du §9 : feuille en bas au doigt, boîte centrée au large.",
      },
    },
  },
  args: {
    open: true,
    onOpenChange: () => undefined,
    onCloseAutoFocus: () => undefined,
    filter: 'forYou',
    onFilter: () => undefined,
    projectId: undefined,
    onProjectId: () => undefined,
    expanded: null,
    onExpanded: () => undefined,
    entries: ENTRIES,
    forYou: FOR_YOU,
    projects: PROJECTS,
    onNavigate: () => undefined,
  },
  render: (args) => <Controlled {...args} />,
} satisfies Meta<typeof ActivityDialog>

/** Les filtres, la demande dépliée et le projet se manipulent comme dans la colonne. */
function Controlled(args: ComponentProps<typeof ActivityDialog>) {
  const [filter, setFilter] = useState<ActivityFilter>(args.filter)
  const [expanded, setExpanded] = useState<string | null>(args.expanded)
  const [projectId, setProjectId] = useState(args.projectId)
  return (
    <SeededForYou>
      <ActivityDialog
        {...args}
        filter={filter}
        onFilter={setFilter}
        expanded={expanded}
        onExpanded={setExpanded}
        projectId={projectId}
        onProjectId={setProjectId}
      />
    </SeededForYou>
  )
}

export default meta
type Story = StoryObj<typeof meta>

/** Ouverte sur « Pour toi », telle qu'elle s'ouvre quand quelque chose attend. */
export const PourToi: Story = { name: 'Pour toi' }

/** Ouverte depuis la colonne sur une permission : dépliée sur elle. */
export const Depliee: Story = { name: 'Dépliée sur une demande', args: { expanded: 'blocked:perm-1' } }

/** Tout : ce qui t'attend, puis les sessions non lues et en cours. */
export const Tout: Story = { name: 'Tout', args: { filter: 'all' } }

/** Rien n'attend. */
export const Vide: Story = { name: 'Rien ne t’attend', args: { forYou: [], entries: [] } }
