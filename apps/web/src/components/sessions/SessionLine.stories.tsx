import type { Decorator, Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import type { ProjectDto } from '@solera/protocol'
import { toggled } from '../../lib/filters'
import type { SessionRow } from '../../lib/sessions-view'
import { SessionLine } from './SessionLine'

const HOUR = 3_600_000
const nimbus = { id: 'p1', name: 'Nimbus', image: null, color: '#5B9DF9' } as ProjectDto

const row = (fields: Partial<SessionRow>): SessionRow => ({
  id: fields.title ?? 'session',
  title: 'Session',
  agent: 'claude',
  project: nimbus,
  state: 'done',
  branch: null,
  cardNumber: null,
  pinned: false,
  archived: false,
  at: Date.now() - HOUR,
  path: '/p/p1/c/session',
  ...fields,
})

const ROWS: SessionRow[] = [
  row({ title: 'Refactor settings storage', state: 'awaiting', at: Date.now() - 0.2 * HOUR }),
  row({ title: 'Corriger le build CSS', agent: 'grok', state: 'error', branch: 'fix/14-build-css', cardNumber: 14, at: Date.now() - 2 * HOUR }),
  row({ title: 'Radar tile prefetching', state: 'review', branch: 'feat/radar-prefetch', cardNumber: 4, at: Date.now() - 3 * HOUR }),
  row({ title: 'Add offline caching for forecasts', state: 'running', branch: 'feat/2-offline-cache', cardNumber: 2, at: Date.now() - 0.1 * HOUR }),
  row({ title: 'Idées de nom pour la newsletter', project: null, pinned: true, path: '/c/idees', at: Date.now() - 30 * HOUR }),
]

/** Les lignes vivent dans une liste à filets, comme dans la page. */
const inList: Decorator = (Story) => (
  <ul className="flex w-[56rem] max-w-full flex-col divide-y divide-line border-y border-line">
    <Story />
  </ul>
)

const meta = {
  title: "Composants d'application/Ligne de session",
  component: SessionLine,
  parameters: {
    docs: {
      description: {
        component:
          "Une session dans `/sessions`. L'icône de l'agent porte le **point d'état** — ambre : t'attend, rouge : en erreur, accent pâle : à relire, accent qui pulse : travaille, gris : terminée. Le titre est gras quand la session réclame, et le mot d'état suit quand il appelle un geste. Dès `lg`, le projet, la branche et la carte. Toute la ligne mène au fil.\n\n`compact` dans les colonnes de « Par état », qui disent déjà l'état ; `hideProject` dans un groupe qui nomme le projet. En mode sélection (`onToggle`), la ligne devient une case à cocher et ne mène plus au fil.",
      },
    },
  },
  args: { row: ROWS[0]! },
  decorators: [inList],
} satisfies Meta<typeof SessionLine>

export default meta
type Story = StoryObj<typeof meta>

/** Les cinq états, avec projet, branche et carte. */
export const Etats: Story = {
  render: () => <>{ROWS.map((entry) => <SessionLine key={entry.id} row={entry} />)}</>,
}

/** La forme compacte des colonnes de « Par état ». */
export const Compacte: Story = {
  render: () => <>{ROWS.map((entry) => <SessionLine key={entry.id} row={entry} compact />)}</>,
}

/** Le mode sélection de `/sessions` : la case en tête, le fond accent pâle quand elle est cochée. */
export const Selection: Story = {
  render: function Render() {
    const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set([ROWS[1]!.id, ROWS[3]!.id]))
    const toggle = (id: string) => setSelected((current) => toggled(current, id))
    return <>{ROWS.map((entry) => <SessionLine key={entry.id} row={entry} selected={selected.has(entry.id)} onToggle={toggle} />)}</>
  },
}
