import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import type { ScheduleCadence } from '@solera/protocol'
import { ScheduleBuilder } from './ScheduleBuilder'

/** Mercredi 11 novembre 2026, 10:00 à Paris : les captures ne bougent pas avec l'horloge. */
const NOW = Date.UTC(2026, 10, 11, 9, 0)
const ZONE = 'Europe/Paris'

/** Le builder, et dessous la cadence qu'il rend : ce que l'éditeur enregistrera. */
function Harness({ initial, width }: { initial: ScheduleCadence | null; width?: string }) {
  const [out, setOut] = useState<ScheduleCadence | null>(null)
  return (
    <div className="flex flex-col gap-4" style={{ maxWidth: width ?? '44rem' }}>
      <ScheduleBuilder initial={initial} now={NOW} timeZone={ZONE} onChange={(cadence) => setOut(cadence)} />
      <code data-testid="cadence" className="font-mono text-xs text-ink-faint">
        {JSON.stringify(out)}
      </code>
    </div>
  )
}

const meta = {
  title: "Composants d'application/Actions/ScheduleBuilder",
  component: Harness,
  parameters: {
    docs: {
      description: {
        component:
          "**La planification lisible** (`actions.md` §1.F) : la règle se lit comme une phrase dont chaque morceau est un contrôle — « Répéter [chaque semaine ▾] le [L M M J V S D] à [03:00 ▾] ». Dessous, l'aperçu : la phrase en clair, le mois avec les jours de passage, les cinq prochains passages et **le fuseau du serveur**, celui où le daemon lit un motif cron.\n\nLa traduction règle ↔ cadence est dans `lib/schedule-rule.ts`, testée seule. Ce qu'il ne sait pas relire passe en Personnalisé, le cron tel quel. Les stories figent l'horloge au mercredi 11 novembre 2026, 10:00 à Paris ; la ligne de code sous le builder montre la cadence rendue.",
      },
    },
  },
  args: { initial: null },
} satisfies Meta<typeof Harness>

export default meta
type Story = StoryObj<typeof meta>

const cron = (expression: string): ScheduleCadence => ({ kind: 'cron', expression })

export const ChaqueJour: Story = { name: 'Chaque jour', args: { initial: null } }

export const JoursOuvres: Story = { name: 'Chaque jour ouvré', args: { initial: cron('30 9 * * 1-5') } }

export const ChaqueSemaine: Story = { name: 'Chaque semaine', args: { initial: cron('0 3 * * 1,4') } }

export const ChaqueMois: Story = { name: 'Chaque mois', args: { initial: cron('0 3 1 * *') } }

export const AuDelaDe28: Story = { name: 'Chaque mois, le 31', args: { initial: cron('0 3 31 * *') } }

export const DernierJour: Story = { name: 'Chaque mois, le dernier jour', args: { initial: cron('0 3 L * *') } }

export const ToutesLesHeures: Story = { name: 'Toutes les N heures', args: { initial: cron('0 */6 * * *') } }

export const SurUnePlage: Story = { name: 'Toutes les N heures, sur une plage', args: { initial: cron('0 8-20/2 * * *') } }

export const UneFois: Story = {
  name: 'Une seule fois',
  args: { initial: { kind: 'once', at: Date.UTC(2026, 10, 20, 13, 30) } },
}

export const Personnalise: Story = { name: 'Personnalisé', args: { initial: cron('0 9 1 1 *') } }

export const Invalide: Story = { name: 'Personnalisé, invalide', args: { initial: cron('0 9 * *') } }

export const Etroit: Story = {
  name: 'Étroit (téléphone)',
  args: { initial: cron('0 3 * * 1,4'), width: '22rem' },
}
