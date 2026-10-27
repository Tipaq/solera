import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { FOR_YOU, PROJECTS, SeededForYou } from './for-you-fixtures'
import { ForYouItem, ForYouSettled } from './ForYouItem'

const meta = {
  title: "Composants d'application/ForYouItem",
  component: ForYouItem,
  parameters: {
    docs: {
      description: {
        component:
          "Une demande dans le filtre « Pour toi » de la modale d'Activité (#121) : **ce qui est demandé** en titre, le fil et son projet dessous, son rang en étiquette (Bloqué, Décision, Accord), l'âge ou l'échéance.\n\n**Un clic la déplie sur place**, une seule à la fois, pour y répondre sans ouvrir le fil, et **par les mêmes routes que le fil** : une permission propose Refuser, Autoriser pour la session et Autoriser ; une question ses choix et un champ libre ; une décision ses options, celle par défaut marquée, et l'échéance ; un accord le bloc même du fil, replié de son événement. Un plan se relit en entier : il renvoie au fil.\n\nRien n'est anticipé : la ligne part quand le journal ou l'API dit la demande tranchée, et dit une seconde qu'elle est réglée.",
      },
    },
  },
  args: {
    entry: FOR_YOU[0]!,
    project: PROJECTS[0],
    open: true,
    onToggle: () => undefined,
    onOpenThread: () => undefined,
    threadPath: '/c/c-perm',
  },
  render: (args) => (
    <SeededForYou>
      <ul className="surface w-[640px] rounded-xl border border-line p-2"><ForYouItem {...args} /></ul>
    </SeededForYou>
  ),
} satisfies Meta<typeof ForYouItem>

export default meta
type Story = StoryObj<typeof meta>

/** Un fil bloqué sur une permission : les trois boutons du fil. */
export const Permission: Story = { name: 'Permission dépliée' }

/** Une question : ses choix, numérotés, et le champ libre. */
export const Question: Story = { name: 'Question dépliée', args: { entry: FOR_YOU[1]!, project: PROJECTS[1] } }

/** Un plan renvoie au fil : il se relit en entier. */
export const Plan: Story = { name: 'Plan', args: { entry: FOR_YOU[2]!, project: undefined } }

/** Une décision : ses options, celle par défaut marquée, et l'échéance. */
export const Decision: Story = { name: 'Décision dépliée', args: { entry: FOR_YOU[3]! } }

/** Un accord : le bloc du fil, ce qui changera, puis refuser ou accorder. */
export const Accord: Story = { name: 'Accord déplié', args: { entry: FOR_YOU[4]! } }

/** Repliées, l'une sous l'autre : la liste telle qu'elle s'ouvre. */
export const Liste: Story = {
  name: 'Liste repliée',
  render: () => <List />,
}

/** Repliées, avec le dépliage d'une seule à la fois. */
function List() {
  const [open, setOpen] = useState<string | null>(null)
  return (
    <SeededForYou>
      <ul className="surface w-[640px] divide-y divide-line/50 rounded-xl border border-line p-2">
        {FOR_YOU.map((entry) => (
          <ForYouItem
            key={entry.key}
            entry={entry}
            project={PROJECTS.find((project) => project.id === entry.projectId)}
            open={open === entry.key}
            onToggle={() => setOpen(open === entry.key ? null : entry.key)}
            onOpenThread={() => undefined}
            threadPath={`/c/${entry.conversationId}`}
          />
        ))}
      </ul>
    </SeededForYou>
  )
}

/** La seconde où la demande dit qu'elle est réglée, avant de partir. */
export const Reglee: Story = {
  name: 'Réglée',
  render: () => (
    <ul className="surface w-[640px] rounded-xl border border-line p-2"><ForYouSettled entry={FOR_YOU[0]!} verdict="Autorisé" /></ul>
  ),
}
