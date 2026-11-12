import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { cx } from '@solera/ui'
import type { EditorSeed } from '../../lib/action-editor'
import { ACTIONS_KEY } from '../../lib/actions'
import { ActionEditor } from './ActionEditor'
import { ActionChromeProvider } from './ActionSheet'
import { AGENT, PROJECT_ID, SERVICE_ON, SERVICE_SCHEDULED, SUGGESTIONS, SeededWorktrees } from './automation-fixtures'

const ignore = () => {}

/** Le dépôt et ses branches dans le cache : l'éditeur les lit sans requête. */
function Seeded({ children }: { children: ReactNode }) {
  const client = useQueryClient()
  useState(() => {
    client.setQueryData([...ACTIONS_KEY, 'suggestions', PROJECT_ID], SUGGESTIONS)
    client.setQueryData(['branches', PROJECT_ID], { branches: ['main', 'dev', 'feat/factures'], current: 'main' })
    return null
  })
  return <SeededWorktrees>{children}</SeededWorktrees>
}

function Harness({ seed, inline = false }: { seed: EditorSeed; inline?: boolean }) {
  return (
    <Seeded>
      <ActionChromeProvider value={inline ? { inline: true, backLabel: 'Actions', onBack: ignore } : { inline: false }}>
        <div className={cx('flex h-[46rem] flex-col overflow-hidden rounded-lg border border-line bg-canvas', inline ? 'w-[21rem]' : 'w-[48rem] max-w-full')}>
          <ActionEditor projectId={PROJECT_ID} seed={seed} onClose={ignore} />
        </div>
      </ActionChromeProvider>
    </Seeded>
  )
}

const meta = {
  title: "Composants d'application/Actions/Éditeur",
  component: Harness,
  parameters: {
    docs: {
      description: {
        component:
          "**L'éditeur unifié** (`actions.md` §1.E) : **1 · Quoi** (une commande — tâche ou service — ou un agent), puis **2 · Quand** (à la demande et/ou planifiée, `ScheduleBuilder`). Un exemple se lit comme un exemple (« ex. … », pâle, penché) ; une erreur s'affiche sous son champ quand on le quitte ; « Enregistrer » reste grisé tant qu'un problème bloque, sa raison en infobulle.\n\nL'état, les erreurs et le brouillon enregistré sont dans `lib/action-editor.ts`, testé seul. En modification, la nature est figée : « Dupliquer » sert à en changer (Q5). Un service planifié (cas limite, AC-06) démarre à sa cadence et s'arrête à une seconde, 19 h en semaine d'office.",
      },
    },
  },
  args: { seed: {} },
} satisfies Meta<typeof Harness>

export default meta
type Story = StoryObj<typeof meta>

export const NouvelleCommande: Story = { name: 'Nouvelle commande', args: { seed: { preset: { what: 'command' } } } }

export const NouveauService: Story = {
  name: 'Nouveau service',
  args: { seed: { preset: { what: 'command', kind: 'service' }, prefill: { label: 'Serveur de dev', command: 'pnpm dev', url: 'http://localhost:{port}' } } },
}

export const NouvelAgent: Story = { name: 'Nouvelle tâche d’agent, planifiée', args: { seed: { preset: { what: 'agent' }, schedule: true } } }

export const Modification: Story = { name: 'Modifier un service', args: { seed: { from: SERVICE_ON } } }

/** Le cas limite d'un service planifié : « Démarrer », puis l'encart « Arrêter » (EDI-18). */
export const ServicePlanifie: Story = { name: 'Service planifié', args: { seed: { from: SERVICE_SCHEDULED, schedule: true } } }

export const ModificationAgent: Story = { name: 'Modifier une tâche d’agent', args: { seed: { from: AGENT } } }

export const Etroit: Story = { name: 'Panneau étroit', args: { seed: { preset: { what: 'command' } }, inline: true } }
