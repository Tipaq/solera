import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ComponentProps } from 'react'
import { SessionRow } from './SessionRow'

const MINUTE = 60_000

type Row = ComponentProps<typeof SessionRow>

function row(
  id: string,
  title: string,
  marker: Row['marker'],
  ago: number,
  rest: Partial<Omit<Row, 'conversation' | 'marker'>> & { card?: number; agent?: Row['conversation']['agent'] } = {},
): Row {
  return {
    conversation: {
      id,
      projectId: 'p1',
      title,
      agent: rest.agent ?? 'claude',
      card: rest.card ? { id: `card-${rest.card}`, number: rest.card, title: `Carte ${rest.card}`, column: 'in_progress' } : null,
      updatedAt: Date.now() - ago * MINUTE,
    },
    marker,
    summary: rest.summary ?? null,
    place: rest.place ?? { root: true, branch: 'main' },
  }
}

/** Les cinq états de la planche B1, dans l'ordre des groupes. */
const ROWS: Row[] = [
  row('a', 'Dessiner la page projet', 'awaiting', 42, {
    card: 73,
    summary: { text: 'Attend 3 min', tone: 'caution' },
    place: { root: false, branch: 'design/page-projet' },
  }),
  row('b', 'Vue Git, lot 3', 'broken', 120, {
    agent: 'codex',
    card: 50,
    summary: { text: 'Interrompue', tone: 'critical' },
    place: { root: false, branch: 'feat/vue-git-lot-3' },
  }),
  row('c', 'Lier un design system au projet', 'review', 55, {
    card: 62,
    place: { root: false, branch: 'feat/ds-lie-au-projet' },
  }),
  row('d', 'Flow de projet, cards et jalons', 'working', 50),
  row('e', 'Sessions inachevées et worktrees', 'unread', 60 * 5),
  row('f', 'Réutilisation du design system', 'quiet', 60 * 24),
]

function List({ rows }: { rows: Row[] }) {
  return (
    <ul className="divide-y divide-line border-y border-line">
      {rows.map((entry) => (
        <SessionRow key={entry.conversation.id} {...entry} />
      ))}
    </ul>
  )
}

const meta = {
  title: "Composants d'application/La ligne de session",
  component: SessionRow,
  args: ROWS[0]!,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          "Une session sur une ligne, dans l'onglet Activité d'un projet (planches B1, B4 et E1 de `docs/audits/2026-10-21-page-projet/final/`).\n\n**Des colonnes fixes**, à la même place qu'on lise une ou trente lignes : point d'état, agent, nom, résumé, carte, worktree et branche, âge. La colonne PR viendra avec son badge (#115), avant l'âge.\n\nLe point suit **la charte de la colonne** — l'accent qui pulse, l'ambre, le rouge, l'encre —, avec un vert en plus pour « prête à relire » et un gris pour une session finie et déjà lue.\n\nTant que le résumé d'une ligne n'existe pas (#113), la quatrième colonne ne dit que l'attente ou l'erreur. **Au téléphone**, la ligne passe sur deux étages et la carte tombe : les points de rupture suivent la fenêtre et non le cadre de la story, il faut donc réduire la fenêtre pour la voir.",
      },
    },
  },
} satisfies Meta<typeof SessionRow>

export default meta
type Story = StoryObj<typeof meta>

/** Les six points, du plus urgent au plus calme. */
export const Etats: Story = {
  name: 'États',
  render: () => <List rows={ROWS} />,
}

