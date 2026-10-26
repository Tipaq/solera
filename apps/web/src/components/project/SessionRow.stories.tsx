import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState, type ComponentProps } from 'react'
import type { ProjectPullRequestDto, PullRequestBadgeState } from '@solera/protocol'
import type { SessionRequest } from '../../lib/session-requests'
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
      isOwner: true,
    },
    marker,
    summary: rest.summary ?? null,
    place: rest.place ?? { root: true, branch: 'main', path: null },
    pr: rest.pr ?? null,
  }
}

function pr(number: number, branch: string, state: PullRequestBadgeState, failed: string[] = []): ProjectPullRequestDto {
  return {
    number,
    url: `https://github.com/o/r/pull/${number}`,
    title: `PR de ${branch}`,
    branch,
    base: 'main',
    state,
    checks: { passed: 0, pending: state === 'checks' ? 2 : 0, failed },
    review: state === 'ready' ? 'approved' : null,
    updatedAt: Date.now(),
  }
}

/** Les cinq états de la planche B1, dans l'ordre des groupes. */
const ROWS: Row[] = [
  row('a', 'Dessiner la page projet', 'awaiting', 42, {
    card: 73,
    summary: { text: 'Attend 3 min', tone: 'caution' },
    place: { root: false, branch: 'design/page-projet', path: '/wt/design/page-projet' },
  }),
  row('b', 'Vue Git, lot 3', 'broken', 120, {
    agent: 'codex',
    card: 50,
    summary: { text: 'Interrompue', tone: 'critical' },
    place: { root: false, branch: 'feat/vue-git-lot-3', path: '/wt/feat/vue-git-lot-3' },
  }),
  row('c', 'Lier un design system au projet', 'review', 55, {
    card: 62,
    place: { root: false, branch: 'feat/ds-lie-au-projet', path: '/wt/feat/ds-lie-au-projet' },
    pr: pr(17, 'feat/ds-lie-au-projet', 'ready'),
  }),
  row('d', 'Flow de projet, cards et jalons', 'working', 50),
  row('g', 'Worktree disparu', 'working', 18, {
    card: 61,
    place: { root: false, branch: 'fix/worktree-disparu', path: '/wt/fix/worktree-disparu' },
    pr: pr(18, 'fix/worktree-disparu', 'checks'),
  }),
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
          "Une session sur une ligne, dans l'onglet Activité d'un projet (planches B1, B4 et E1 de `docs/audits/2026-10-21-page-projet/final/`).\n\n**Des colonnes fixes**, à la même place qu'on lise une ou trente lignes : point d'état, agent, nom, résumé, carte, worktree et branche, âge. La colonne PR porte le badge de la PR de la branche (#115), avant l'âge.\n\nLe point suit **la charte de la colonne** — l'accent qui pulse, l'ambre, le rouge, l'encre —, avec un vert en plus pour « prête à relire » et un gris pour une session finie et déjà lue.\n\nTant que le résumé d'une ligne n'existe pas (#113), la quatrième colonne ne dit que l'attente ou l'erreur. **Au téléphone**, la ligne passe sur deux étages et la carte tombe : les points de rupture suivent la fenêtre et non le cadre de la story, il faut donc réduire la fenêtre pour la voir.",
      },
    },
  },
} satisfies Meta<typeof SessionRow>

export default meta
type Story = StoryObj<typeof meta>

/** Les cinq états du badge de PR (planche B4) : brouillon, checks, échec, prête, fusionnée. */
export const BadgesDePr: Story = {
  name: 'Badges de PR',
  render: () => (
    <List
      rows={(
        [
          ['draft', 'Brouillon'],
          ['checks', 'Checks en cours'],
          ['failing', 'Checks en échec'],
          ['ready', 'Prête'],
          ['merged', 'Fusionnée'],
        ] as const
      ).map(([state, title], index) =>
        row(`pr-${state}`, title, state === 'ready' ? 'review' : state === 'merged' ? 'quiet' : 'working', 10 * (index + 1), {
          place: { root: false, branch: 'fix/worktree-disparu', path: '/wt/fix/worktree-disparu' },
          pr: pr(18, 'fix/worktree-disparu', state, state === 'failing' ? ['ci', 'macos'] : []),
        }),
      )}
    />
  ),
}

/** Les six points, du plus urgent au plus calme. */
export const Etats: Story = {
  name: 'États',
  render: () => <List rows={ROWS} />,
}


const QUESTION: SessionRequest = {
  kind: 'question',
  requestId: 'q1',
  requestedAt: Date.now() - 3 * MINUTE,
  event: {
    type: 'question.requested',
    requestId: 'q1',
    questions: [
      {
        id: 'jalon',
        header: 'Jalon',
        question: 'Le jalon lancé (#72), où le voit-on sur la page projet ?',
        options: [
          { label: 'En tête de l’Activité', description: '', preview: null },
          { label: 'Un onglet Jalon', description: '', preview: null },
          { label: 'Dans la Chronologie', description: '', preview: null },
        ],
        multiSelect: false,
        allowOther: true,
        secret: false,
      },
    ],
  },
}

const PERMISSION: SessionRequest = {
  kind: 'permission',
  requestId: 'p1',
  requestedAt: Date.now() - 12 * MINUTE,
  event: {
    type: 'permission.requested',
    requestId: 'p1',
    toolName: 'Bash',
    input: { command: 'pnpm install --ignore-scripts' },
    suggestions: [],
    title: 'Autoriser une commande',
  },
}

/** Deux lignes qui te demandent quelque chose, dépliables au clic, à l'Espace et au chiffre. */
function Foldable() {
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set(['a', 'g']))
  const rows: (Row & { request: SessionRequest })[] = [
    {
      ...ROWS[0]!,
      summary: { text: 'Attend 3 min · Le jalon lancé (#72), où le voit-on sur la page projet ?', tone: 'caution' },
      request: QUESTION,
    },
    {
      ...row('g', 'Tri des nouveautés de Sillage', 'awaiting', 65, {
        card: 65,
        place: { root: false, branch: 'feat/tri-sillage', path: '/wt/feat/tri-sillage' },
        summary: { text: 'Attend 12 min · Bash : pnpm install --ignore-scripts', tone: 'caution' },
      }),
      request: PERMISSION,
    },
  ]
  const toggle = (id: string) =>
    setOpen((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  return (
    <ul className="divide-y divide-line border-y border-line">
      {rows.map((entry) => (
        <SessionRow
          key={entry.conversation.id}
          {...entry}
          expanded={open.has(entry.conversation.id)}
          onToggle={() => toggle(entry.conversation.id)}
        />
      ))}
    </ul>
  )
}

/**
 * La planche B2 : la question et la permission dépliées sous leur ligne. Les réponses
 * partent vers un serveur que la story n'a pas, et reviennent donc en erreur.
 */
export const Depliee: Story = {
  name: 'Demande dépliée',
  render: () => <Foldable />,
}
