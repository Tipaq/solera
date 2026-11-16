import type { Meta, StoryObj } from '@storybook/react-vite'
import { AlarmClock, CalendarClock, CalendarDays, Hand, Pause } from 'lucide-react'
import type { ReactNode } from 'react'
import { DUE_GROUPS, groupByDue, type DueGroup } from '../../lib/planned'
import { LauncherGroup } from '../automations/LauncherGroup'
import { PLANNED } from './planned-fixtures'
import { PlannedTile, type PlannedHandlers } from './PlannedTile'

const ignore = () => {}
const HANDLERS: PlannedHandlers = { onOpen: ignore, onEdit: ignore, onLaunch: ignore, onPause: ignore, onDuplicate: ignore, onDelete: ignore }

const GROUPS: Record<DueGroup, { title: string; icon: ReactNode }> = {
  today: { title: 'Aujourd’hui', icon: <AlarmClock size={14} /> },
  week: { title: 'Cette semaine', icon: <CalendarDays size={14} /> },
  later: { title: 'Plus tard', icon: <CalendarClock size={14} /> },
  idle: { title: 'En pause', icon: <Pause size={14} /> },
  demand: { title: 'À la demande', icon: <Hand size={14} /> },
}

/** Le Lanceur des Planifiées, par échéance : chaque groupe avec sa tuile « + Tâche ». */
function Launcher() {
  const groups = groupByDue(PLANNED, Date.now())
  return (
    <div className="flex flex-col gap-7">
      {DUE_GROUPS.map((key) =>
        groups[key].length === 0 ? null : (
          <LauncherGroup key={key} icon={GROUPS[key].icon} title={GROUPS[key].title} count={groups[key].length} add={{ label: 'Tâche', onClick: ignore }}>
            {groups[key].map((item) => (
              <PlannedTile key={item.id} item={item} handlers={HANDLERS} />
            ))}
          </LauncherGroup>
        ),
      )}
    </div>
  )
}

const meta = {
  title: "Composants d'application/Planifiées/Tuile",
  component: PlannedTile,
  args: { item: PLANNED[0]!, handlers: HANDLERS },
  parameters: {
    docs: {
      description: {
        component:
          "**La tuile d'une tâche planifiée** (PLF-5), au gabarit du Lanceur de l'onglet Actions : ce qui vient puis ce qui s'est passé (« Prochain dans 3 h · dernier ✓ il y a 6 h »), la cadence et la **pastille de portée**, et un seul geste — Relire, Session ↗, Reprendre ou Lancer maintenant. La phrase vient de `plannedState` (`lib/planned.ts`).",
      },
    },
  },
} satisfies Meta<typeof PlannedTile>

export default meta
type Story = StoryObj<typeof meta>

export const Seule: Story = { name: 'Une tuile', render: (args) => <div className="w-72"><PlannedTile {...args} /></div> }

export const ParEcheance: Story = { name: 'Le Lanceur, par échéance', render: () => <Launcher /> }
