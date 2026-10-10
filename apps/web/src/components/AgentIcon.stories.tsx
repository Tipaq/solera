import type { AgentKind } from '@solera/protocol'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { AGENT_META, AgentIcon } from './AgentIcon'

const AGENTS: AgentKind[] = ['claude', 'codex', 'opencode']

const meta = {
  title: "Composants d'application/AgentIcon",
  component: AgentIcon,
  parameters: {
    docs: {
      description: {
        component:
          "La marque du CLI qui répond. **Le composant hors `ui/` le plus réemployé** : quinze fichiers l'importent, plus que toute primitive sauf `Button`.\n\n`AGENT_META` est une table exhaustive sur l'enum du protocole, et non des ternaires dispersés : un CLI ajouté sans sa ligne **ne compile pas**, là où le ternaire binaire d'avant aurait affiché le logo OpenAI sur n'importe quel nouvel agent.\n\nClaude porte sa couleur de marque en aplat ; les deux autres sont monochromes et héritent de la couleur du texte environnant — change le thème dans la barre d'outils pour le voir.\n\nUsage nominatif : dire quel CLI répond. Solera n'est affiliée à aucun des trois.",
      },
    },
  },
  args: { agent: 'claude' },
  argTypes: { agent: { control: 'inline-radio', options: AGENTS } },
} satisfies Meta<typeof AgentIcon>

export default meta
type Story = StoryObj<typeof meta>

export const Bac: Story = { args: { size: 22 } }

export const LesTrois: Story = {
  name: 'Les trois CLI',
  render: () => (
    <div className="flex flex-col gap-3">
      {AGENTS.map((agent) => (
        <span key={agent} className="flex items-center gap-2 text-ink">
          <AgentIcon agent={agent} size={16} />
          <span className="text-sm">{AGENT_META[agent].label}</span>
          <span className="text-meta text-ink-faint">{AGENT_META[agent].vendor}</span>
        </span>
      ))}
    </div>
  ),
}

/** Les quatre pas de l'échelle d'icônes (§8), pour juger la lisibilité des tracés. */
export const Tailles: Story = {
  render: () => (
    <div className="flex flex-wrap items-end gap-5">
      {[11, 14, 16, 22].map((size) => (
        <span key={size} className="flex flex-col items-center gap-2">
          <span className="flex items-center gap-2 text-ink">
            {AGENTS.map((agent) => (
              <AgentIcon key={agent} agent={agent} size={size} />
            ))}
          </span>
          <span className="font-mono text-meta text-ink-faint">{size}</span>
        </span>
      ))}
    </div>
  ),
}
