import type { Meta, StoryObj } from '@storybook/react-vite'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import { DEFAULT_CLAUDE_CONFIG, type AgentConfig, type AgentUsage } from '@solera/protocol'
import { AccountChoice } from './AccountChoice'

/**
 * Un client à part, amorcé : la liste des comptes et l'usage de chacun sont posés dans
 * le cache, et le composant reçoit `enabled={false}`, donc il ne relit rien. Le
 * catalogue n'a pas de serveur, et une lecture lancée ici ne rapporterait qu'une erreur.
 */
function seeded(): QueryClient {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const now = Date.now()
  client.setQueryData(['claude-accounts'], {
    accounts: [
      { id: 'perso', label: 'Perso', kind: 'oauth', gauge: { email: 'alex@example.com' }, createdAt: now, updatedAt: now },
      { id: 'jeton', label: 'Jeton seul', kind: 'oauth', gauge: null, createdAt: now, updatedAt: now },
      { id: 'cle', label: 'Clé Console', kind: 'apiKey', gauge: null, createdAt: now, updatedAt: now },
    ],
  })
  const usage = (five: number, week: number): AgentUsage => ({
    agent: 'claude',
    plan: 'max',
    limitsAvailable: true,
    credits: null,
    fetchedAt: now,
    windows: [
      { id: 'five_hour', label: '5 heures', utilization: five, resetsAt: now + 3_600_000 },
      { id: 'seven_day', label: '7 jours', utilization: week, resetsAt: now + 200_000_000 },
    ],
  })
  client.setQueryData(['usage', 'claude', null], usage(0.91, 0.64))
  client.setQueryData(['usage', 'claude', 'perso'], usage(0.12, 0.3))
  return client
}

function Interactive() {
  const [client] = useState(seeded)
  const [config, setConfig] = useState<AgentConfig>(DEFAULT_CLAUDE_CONFIG)
  return (
    <QueryClientProvider client={client}>
      <div className="w-full max-w-md">
        <AccountChoice config={config} onChange={setConfig} enabled={false} />
      </div>
    </QueryClientProvider>
  )
}

const meta = {
  title: "Composants d'application/AccountChoice",
  component: AccountChoice,
  parameters: {
    docs: {
      description: {
        component:
          "Sur quel compte la session va partir, choisi dans le brouillon avant le premier message.\n\nChaque option dit où en est son compte — les deux fenêtres les plus chargées — pour choisir d'après l'usage plutôt que de le découvrir au milieu d'un tour. Un jeton de setup-token sans jauge et une clé API ne sont pas sondés : leur aperçu est une phrase.\n\nAbsent tant qu'il n'y a pas de compte supplémentaire.",
      },
    },
  },
  args: { config: DEFAULT_CLAUDE_CONFIG, onChange: () => {}, enabled: false },
} satisfies Meta<typeof AccountChoice>

export default meta
type Story = StoryObj<typeof meta>

/** La connexion du CLI presque au bout de sa fenêtre, un compte avec jauge qui a de la marge. */
export const Bac: Story = { render: () => <Interactive /> }
