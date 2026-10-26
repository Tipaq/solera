import type { Decorator, Meta, StoryObj } from '@storybook/react-vite'
import { CardActivityRow } from './CardActivityRow'
import { SessionRow } from './SessionRow'

const MINUTE = 60_000
const DAY = 24 * 60 * MINUTE

const SOLERA = { name: 'Solera', image: null, color: '#8B7BF7' }
const VAULT = { name: 'Vault', image: null, color: '#5BC98C' }
const SITE = { name: 'Site perso', image: null, color: '#D9B441' }

const inList: Decorator = (Story) => (
  <ul className="divide-y divide-line border-y border-line">
    <Story />
  </ul>
)

const meta = {
  title: "Composants d'application/La ligne de carte du portefeuille",
  component: CardActivityRow,
  args: {
    card: { projectId: 'vault', number: 41, title: 'Index des liens du vault' },
    project: VAULT,
    marker: 'review',
    summary: { text: "Carte en À vérifier depuis 2 j — la session qui l'a faite est archivée", tone: 'soft' },
    since: Date.now() - 2 * DAY,
  },
  decorators: [inList],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          "Une carte qui réclame quelqu'un sans qu'aucune session ne la porte, dans l'Activité du portefeuille (planche D1 de `docs/audits/2026-10-21-page-projet/final/`, #117). Les mêmes colonnes qu'une ligne de session avec la colonne Projet : l'icône du board à la place de l'agent, « aucune session » à la place de la branche.",
      },
    },
  },
} satisfies Meta<typeof CardActivityRow>

export default meta
type Story = StoryObj<typeof meta>

export const PreteARelire: Story = { name: 'Prête à relire' }

export const APreciser: Story = {
  name: 'À préciser',
  args: {
    card: { projectId: 'solera', number: 88, title: 'Exporter le journal en Markdown' },
    project: SOLERA,
    marker: 'awaiting',
    summary: { text: 'Carte à préciser depuis 3 h', tone: 'caution' },
    since: Date.now() - 3 * 60 * MINUTE,
  },
}

/** La planche D1 en petit : des sessions de trois projets, et une carte sans session parmi elles. */
export const DansLePortefeuille: Story = {
  name: 'Dans le portefeuille',
  render: (args) => (
    <>
      <SessionRow
        conversation={{
          id: 'a', projectId: 'solera', title: 'Lier un design system au projet', agent: 'claude',
          card: { id: 'c62', number: 62, title: 'Lier un design system', column: 'review' },
          updatedAt: Date.now() - 55 * MINUTE, isOwner: true,
        }}
        marker="review"
        summary={null}
        place={{ root: false, branch: 'feat/ds-lie-au-projet', path: '/wt/feat/ds-lie-au-projet' }}
        project={SOLERA}
      />
      <CardActivityRow {...args} />
      <SessionRow
        conversation={{
          id: 'b', projectId: 'site', title: "Page d'accueil", agent: 'codex', card: null,
          updatedAt: Date.now() - 3 * 60 * MINUTE, isOwner: true,
        }}
        marker="review"
        summary={null}
        place={{ root: false, branch: 'feat/hero', path: '/wt/feat/hero' }}
        project={SITE}
      />
    </>
  ),
}
