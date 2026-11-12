import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState, type ReactNode } from 'react'
import { Button } from '@solera/ui'
import type { ActionPanel } from '../../lib/action-panel'
import { DetailSurfaceContext, type DetailSurface } from '../../lib/detail-surface'
import { useTranslate } from '../../lib/i18n'
import { DrawerLayer } from '../shell/Drawer'
import { ActionDrawer } from './ActionDrawer'
import {
  AGENT,
  AGENT_CHECK,
  FAIL_STREAK,
  NEVER,
  NIGHTLY,
  PROJECT_ID,
  PROPOSED,
  PROPOSED_CHANGE,
  SERVICE_ON,
  SeededRuns,
  SeededWorktrees,
} from './automation-fixtures'

/** Les actions que le tiroir connaît : de quoi ouvrir chaque détail, et planifier les autres. */
const ITEMS = [NIGHTLY, PROPOSED_CHANGE, PROPOSED, SERVICE_ON, FAIL_STREAK, NEVER, AGENT, AGENT_CHECK]

/**
 * Le tiroir, tenu comme une page le tient : sur une page sans panneau, dans le tiroir
 * commun ; dans le panneau d'une conversation, en pile à la place de la liste.
 */
function Harness({ surface, initial }: { surface: DetailSurface; initial: ActionPanel }) {
  const t = useTranslate()
  const [panel, setPanel] = useState<ActionPanel | null>(initial)
  const reopen = (
    <Button size="sm" onClick={() => setPanel(initial)}>
      {t('actionDrawer.label.detail')}
    </Button>
  )
  const drawer = <ActionDrawer projectId={PROJECT_ID} items={ITEMS} panel={panel} onPanel={setPanel} onClose={() => setPanel(null)} />
  return (
    <Seeded>
      <DetailSurfaceContext.Provider value={surface}>
        {surface === 'drawer' ? (
          <div className="flex h-[46rem] flex-col border border-line">
            <div className="h-11 shrink-0 border-b border-line" />
            <div className="relative flex min-h-0 flex-1 overflow-clip">
              <div className="min-w-0 flex-1 p-4 md:p-6">{reopen}</div>
              {drawer}
              <DrawerLayer />
            </div>
          </div>
        ) : (
          <div className="flex h-[46rem] w-[24rem] max-w-full flex-col overflow-hidden rounded-lg border border-line bg-canvas">
            {panel ? drawer : <div className="p-3">{reopen}</div>}
          </div>
        )}
      </DetailSurfaceContext.Provider>
    </Seeded>
  )
}

function Seeded({ children }: { children: ReactNode }) {
  return (
    <SeededWorktrees>
      <SeededRuns>{children}</SeededRuns>
    </SeededWorktrees>
  )
}

const detail = (id: string, review = false): ActionPanel => ({ mode: 'detail', id, ...(review ? { review } : {}) })

const meta = {
  title: "Composants d'application/Actions/Tiroir d'une action",
  component: Harness,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          "Le tiroir unifié d'une action : le **détail** (l'état en une phrase et le geste principal, la relecture, Quoi, Quand, Passages, Origine ; Dupliquer et Supprimer au pied), l'**édition** (« Modifier » bascule le même tiroir, Annuler y revient), « **Planifier une action existante** » et le passage d'une commande qui tourne. Sur une page sans panneau, dans le tiroir commun ; dans le panneau d'une conversation, **en pile** à la place de la liste, « ‹ Actions » et Échap pour remonter d'un niveau.",
      },
    },
  },
  args: { surface: 'drawer', initial: detail(NIGHTLY.id) },
} satisfies Meta<typeof Harness>

export default meta
type Story = StoryObj<typeof meta>

/** Une commande planifiée : trois prochains passages, la frise et l'extrait du dernier échec. */
export const Planifiee: Story = { name: 'Commande planifiée' }

/** Une commande validée qu'un agent a modifiée : ce qui a changé, Valider / Refuser. */
export const Relecture: Story = { name: 'À relire, modifiée', args: { initial: detail(PROPOSED_CHANGE.id, true) } }

/** Une commande neuve écrite par un agent : elle se relit telle quelle. */
export const RelectureNeuve: Story = { name: 'À relire, neuve', args: { initial: detail(PROPOSED.id, true) } }

/** Un service en marche : Ouvrir ↗, Arrêter, le journal et la relance. */
export const Service: Story = { name: 'Service en marche', args: { initial: detail(SERVICE_ON.id) } }

/** Deux échecs d'affilée : le bandeau rouge. */
export const Echecs: Story = { name: 'Échecs d’affilée', args: { initial: detail(FAIL_STREAK.id) } }

/** Une tâche d'agent : son prompt, ses passages et leur session. */
export const Agent: Story = { name: 'Agent planifié', args: { initial: detail(AGENT.id) } }

/** Un script de vérification écrit par un agent, à valider. */
export const AgentVerification: Story = { name: 'Agent, vérification à relire', args: { initial: detail(AGENT_CHECK.id, true) } }

/** « Planifier une action existante » : celles qui ne le sont pas encore. */
export const Choisir: Story = { name: 'Planifier une action existante', args: { initial: { mode: 'pick' } } }

/** Dans le panneau d'une conversation : en pile, « ‹ Actions » à la place du ✕. */
export const Panneau: Story = { name: 'Panneau', args: { surface: 'panel', initial: detail(NIGHTLY.id) } }

/** Dans le panneau, une relecture : la pile s'ouvre sur le bloc. */
export const PanneauRelecture: Story = { name: 'Panneau, à relire', args: { surface: 'panel', initial: detail(PROPOSED_CHANGE.id, true) } }

/** L'éditeur dans le panneau, venu du détail : Annuler y revient. */
export const PanneauEdition: Story = {
  name: 'Panneau, modifier',
  args: { surface: 'panel', initial: { mode: 'edit', seed: { from: NIGHTLY }, back: NIGHTLY.id } },
}
