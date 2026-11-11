import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import type { AgentKind } from '@solera/protocol'
import type { SettingGroup } from '../chat/ComposerSettings'
import { AgentPick, GroupControl, Inheritance } from './AgentSettingRows'

function group(key: string, label: string, options: SettingGroup['options'], value: string, onChange: (value: string) => void): SettingGroup {
  return { key, label, options, value, onChange }
}

/** Les contrôles de Réglages › Agents, chacun dans la colonne de droite d'une rangée. */
function Controls() {
  const [agent, setAgent] = useState<AgentKind>('claude')
  const [queue, setQueue] = useState('steer')
  const [decisions, setDecisions] = useState('auto')
  const [local, setLocal] = useState(true)
  return (
    <div className="flex max-w-[18rem] flex-col gap-6">
      <AgentPick agent={agent} onChange={setAgent} />
      <div className="flex flex-col gap-1">
        <GroupControl
          group={group('queue', 'Envoi pendant un tour', [
            { value: 'steer', label: 'Infléchir' },
            { value: 'queue', label: 'Mettre en file' },
          ], queue, setQueue)}
        />
        <Inheritance local={false} onReset={() => undefined} />
      </div>
      <div className="flex flex-col gap-1">
        <GroupControl
          group={group('decisions', 'Décisions', [
            { value: 'deny', label: 'Interdit', hint: 'L’agent ne peut pas te demander de trancher' },
            { value: 'ask', label: 'Demande mon accord', hint: 'L’agent te demande de trancher sans t’attendre' },
            { value: 'auto', label: 'Automatique', hint: 'Personne n’est sollicité : l’option par défaut de l’agent est retenue', tone: 'caution' },
          ], decisions, setDecisions)}
        />
        <Inheritance local={local} onReset={() => setLocal(false)} />
      </div>
    </div>
  )
}

const meta = {
  title: "Composants d'application/Réglages › Agents",
  component: Controls,
  parameters: {
    docs: {
      description: {
        component:
          "Les contrôles des réglages d'agent du projet, sans libellé : la rangée le dit à gauche, avec l'indice du choix retenu pour aide.\n\nUn segment pour trois choix courts au plus, s'il tient dans la colonne ; une liste sinon. Un choix à risque dit son indice sous le contrôle, en ambre. Dessous, « hérité du compte », ou « modifié ici ↺ » qui rend le réglage à l'héritage d'un clic, dans le brouillon de la page.\n\nLe choix du CLI règle les rangées qui ne valent que pour lui.",
      },
    },
  },
} satisfies Meta<typeof Controls>

export default meta
type Story = StoryObj<typeof meta>

export const Controles: Story = { name: 'Contrôles' }
