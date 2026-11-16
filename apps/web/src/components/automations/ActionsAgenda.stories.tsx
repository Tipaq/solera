import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import type { ActionRunDto, ProjectActionDto, ScheduleCadence, ScheduledRunDto, ScheduledTaskDto } from '@solera/protocol'
import type { AgendaScope } from '../../lib/agenda-layout'
import { fromAction, fromTask, type ActionInput, type Automation, type TaskInput } from '../../lib/automations'
import { ActionsAgenda } from './ActionsAgenda'

/** Mercredi 11 novembre 2026, 10:00 à Paris : les captures ne bougent pas avec l'horloge. */
const NOW = Date.UTC(2026, 10, 11, 9, 0)
const ZONE = 'Europe/Paris'
const MIN = 60_000
/** Une heure murale de Paris en novembre (UTC+1). */
const at = (day: number, hour: number, minute = 0) => Date.UTC(2026, 10, day, hour - 1, minute)
const cron = (expression: string): ScheduleCadence => ({ kind: 'cron', expression })

function action(id: string, extra: Partial<ActionInput>): Automation {
  return fromAction({
    id, projectId: 'p-nimbus', label: id, description: null, kind: 'task', command: './scripts/backup.sh', subdir: null,
    url: null, placement: 'follow', pinnedBranch: null, status: 'approved', agentConversationId: null, agentConversationTitle: null,
    createdAt: NOW, updatedAt: NOW, service: null, lastRun: null, runs: [], approved: null, onDemand: false, ...extra,
  } as ProjectActionDto)
}

const cmdRun = (id: string, startedAt: number, minutes: number, exitCode: number): ActionRunDto => ({
  id, actionId: 'x', trigger: 'schedule', conversationId: null, terminalId: null, cwd: '/srv/nimbus',
  status: exitCode === 0 ? 'succeeded' : 'failed', exitCode, startedAt, finishedAt: startedAt + minutes * MIN,
})

function task(id: string, extra: Partial<TaskInput>): Automation {
  return fromTask({
    id, projectId: 'p-nimbus', userId: 'u1', name: id, agent: 'claude', config: {} as ScheduledTaskDto['config'],
    prompt: 'Passe en revue les dépendances.', cadence: cron('0 3 * * *'), executionMode: 'fresh', overlapPolicy: 'skip',
    confined: null, maxDurationMinutes: 30, enabled: true, lastRunAt: null, nextRunAt: null, createdAt: NOW, updatedAt: NOW,
    runs: [], check: null, ...extra,
  } as ScheduledTaskDto)
}

const agentRun = (id: string, startedAt: number, minutes: number | null, status: ScheduledRunDto['status'] = 'succeeded'): ScheduledRunDto => ({
  id, taskId: 't', conversationId: `c-${id}`, trigger: 'schedule', status, scheduledFor: startedAt, startedAt,
  finishedAt: minutes === null ? null : startedAt + minutes * MIN, error: null, check: null,
})

/** Une semaine chargée : la nuit de 3 h se dispute entre la revue et la sauvegarde. */
const REVIEW = task('t-review', {
  name: 'Revue des dépendances',
  runs: [agentRun('rv3', at(11, 3), 12, 'failed'), agentRun('rv2', at(10, 3), 22), agentRun('rv1', at(9, 3), 18)],
})
const BACKUP = action('a-backup', {
  label: 'Sauvegarde', schedule: { cadence: cron('10 3 * * 1,3,5'), enabled: true, nextRunAt: null },
  runs: [cmdRun('bk2', at(11, 3, 10), 25, 0), cmdRun('bk1', at(9, 3, 10), 31, 0)],
} as Partial<ActionInput>)
const MORNING = task('t-morning', {
  name: 'Rapport du matin', agent: 'codex', cadence: cron('45 8 * * 1-5'),
  runs: [agentRun('mo3', at(11, 8, 45), 6), agentRun('mo2', at(10, 8, 45), 41, 'timed_out'), agentRun('mo1', at(9, 8, 45), 7)],
})
const SECURITY = task('t-security', {
  name: 'Revue de sécurité', cadence: cron('50 9 * * 3'), runs: [agentRun('se1', at(11, 9, 50), null, 'running')],
})
const TRIAGE = task('t-triage', {
  name: 'Tri des tickets', agent: 'codex', cadence: cron('0 14 * * 1-5'),
  runs: [agentRun('tr2', at(10, 14), 9), agentRun('tr1', at(9, 14), null, 'skipped')],
})
const PURGE = action('a-purge', {
  label: 'Purge des journaux', command: 'pnpm logs:purge', schedule: { cadence: cron('30 22 * * *'), enabled: false, nextRunAt: null },
  runs: [cmdRun('pu2', at(10, 22, 30), 4, 1), cmdRun('pu1', at(9, 22, 30), 4, 1)],
} as Partial<ActionInput>)
const DEV = action('a-dev', {
  label: 'Serveur de dev', kind: 'service', command: 'pnpm dev', onDemand: true,
  service: { unit: 'solera-app-action-a-dev.service', state: 'active', cwd: '/srv/nimbus', ports: [5173], startedAt: NOW - 2 * 60 * MIN, served: null },
} as Partial<ActionInput>)

const BUSY = [REVIEW, BACKUP, MORNING, SECURITY, TRIAGE, PURGE, DEV]

/** L'agenda, et dessous l'action qu'un clic ouvrirait : ce que le tiroir recevra. */
function Harness({ items, scope, width }: { items: Automation[]; scope?: AgendaScope; width?: string }) {
  const [opened, setOpened] = useState<string | null>(null)
  return (
    <div className="flex flex-col gap-4" style={{ maxWidth: width ?? '80rem' }}>
      <ActionsAgenda items={items} defaultScope={scope} now={NOW} timeZone={ZONE} onOpen={(item) => setOpened(item.label)} />
      <code data-testid="opened" className="font-mono text-xs text-ink-faint">
        {opened ?? '—'}
      </code>
    </div>
  )
}

const meta = {
  title: "Composants d'application/Actions/ActionsAgenda",
  component: Harness,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          "**L'Agenda des actions** (`actions.md` §1.G) : les passages passés et à venir des actions planifiées, sur une semaine ou un jour. Un bloc a la couleur de sa nature (agent, commande, service), le verdict d'un passage fini en liseré gauche ; un passage à venir est en pointillé, de la durée habituelle de l'action. Deux actions qui se recouvrent se rangent côte à côte, cerclées d'ambre, et l'en-tête les compte. Les heures vides se resserrent en bandes `⋯` qui déplient tout. Sous 44 rem **de conteneur**, une liste par jour.\n\nLa géométrie est dans `lib/agenda-layout.ts`, testée seule. Tout se lit à l'heure du serveur. Les stories figent l'horloge au mercredi 11 novembre 2026, 10:00 à Paris ; la ligne sous l'agenda montre l'action qu'un clic ouvre.",
      },
    },
  },
  args: { items: BUSY, scope: 'week' },
} satisfies Meta<typeof Harness>

export default meta
type Story = StoryObj<typeof meta>

export const Semaine: Story = { name: 'Semaine chargée, avec chevauchements' }

export const Jour: Story = { name: 'Jour', args: { scope: 'day' } }

export const Etroit: Story = { name: 'Étroit (liste par jour)', args: { width: '24rem' } }

export const Vide: Story = { name: 'Rien de planifié', args: { items: [DEV] } }
