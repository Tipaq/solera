import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ACTIONS_KEY } from '../../lib/actions'
import type { ActionsView } from '../../lib/actions-tab'
import type { Automation } from '../../lib/automations'
import { viewStorageKey } from '../../lib/view-pref'
import { AGENT, AGENT_RUNNING, NIGHTLY, PROPOSED, SERVICE_OFF, SERVICE_ON, SUGGESTIONS, SeededAutomations } from '../automations/automation-fixtures'
import { SeededSessionWorks } from '../automations/session-works/session-work-fixtures'
import { ActionsPane } from './ActionsPane'
import { CONVERSATION_ID, PROJECT_ID, RUN_ACTIONS, SeededCommandRuns } from './command-run-fixtures'

/**
 * Un projet qui a déjà ses actions : deux services (dont un en marche), une commande
 * planifiée chaque nuit, une action à relire, deux tâches d'agent (dont une en cours),
 * les commandes lancées ici — un lint qui tourne, des tests en échec — et les processus
 * des sessions.
 */
const ITEMS: Automation[] = [SERVICE_ON, SERVICE_OFF, NIGHTLY, PROPOSED, AGENT, AGENT_RUNNING]

/** La vue retenue par projet, posée avant le premier rendu. */
function Seeded({ view, items, width = 'w-[30rem]', children }: { view: ActionsView; items: Automation[]; width?: string; children: ReactNode }) {
  const client = useQueryClient()
  useState(() => {
    localStorage.setItem(viewStorageKey('panneau-actions', PROJECT_ID), JSON.stringify(view))
    client.setQueryData([...ACTIONS_KEY, 'suggestions', PROJECT_ID], SUGGESTIONS)
    return null
  })
  return (
    <SeededSessionWorks>
      <SeededCommandRuns>
        <SeededAutomations items={items} extra={items.length ? RUN_ACTIONS : []}>
          <div className={`surface flex h-[40rem] flex-col border border-line ${width}`}>{children}</div>
        </SeededAutomations>
      </SeededCommandRuns>
    </SeededSessionWorks>
  )
}

const meta = {
  title: "Composants d'application/ActionsPane",
  component: ActionsPane,
  parameters: {
    docs: {
      description: {
        component:
          "L'onglet *Actions* du panneau d'une conversation : **toutes** les actions du projet, sans quitter la session. Une ligne d'outils — « Actions » et son compte, « ● N en marche » et « ● N à relire » (un clic passe en *Liste* et descend au groupe), la recherche au-delà de huit actions, *Affichage* en icône, « + Nouvelle ▾ » et ↗ vers l'onglet du projet.\n\nTrois vues : le **Lanceur** en lignes (commandes lancées ici, processus des sessions, puis services, commandes, agents), la **Liste** par état, l'**Agenda** en liste par jour. *Lancer* part dans le worktree de la conversation. Le détail, l'édition et le choix s'ouvrent **en pile**, « ‹ Actions » pour remonter.",
      },
    },
  },
  args: { projectId: PROJECT_ID, conversationId: CONVERSATION_ID },
} satisfies Meta<typeof ActionsPane>

export default meta
type Story = StoryObj<typeof meta>

/** Le Lanceur : ce qui tourne en tête, puis une ligne par action, rangées par nature. */
export const Lanceur: Story = {
  render: (args) => (
    <Seeded view="lanceur" items={ITEMS}>
      <ActionsPane {...args} />
    </Seeded>
  ),
}

/** La Liste : en cours et en marche, à relire, planifiées, à la demande. */
export const Liste: Story = {
  render: (args) => (
    <Seeded view="liste" items={ITEMS}>
      <ActionsPane {...args} />
    </Seeded>
  ),
}

/** Aucune action encore : une ligne, et trois suggestions du dépôt qui ouvrent l'éditeur pré-rempli. */
export const Vide: Story = {
  render: (args) => (
    <Seeded view="lanceur" items={[]}>
      <ActionsPane {...args} />
    </Seeded>
  ),
}

/** Un panneau étroit : la ligne d'outils tient en 48 px, les phrases d'état cèdent avant les libellés. */
export const Etroit: Story = {
  render: (args) => (
    <Seeded view="lanceur" items={ITEMS} width="w-[20rem]">
      <ActionsPane {...args} onExpand={() => {}} />
    </Seeded>
  ),
}
