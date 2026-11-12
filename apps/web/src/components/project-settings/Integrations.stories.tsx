import type { Meta, StoryObj } from '@storybook/react-vite'
import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import type { IssueSourceDto } from '@solera/protocol'
import { DesignSystemControl, IssueSourceControl, PrototypeCandidates } from './Integrations'

const SOURCE: IssueSourceDto = { provider: 'github', repository: 'tipaq/nimbus', polledAt: Date.now() - 4 * 60_000, error: null, cardCount: 3 }

/** Les contrôles des Intégrations dans la colonne de droite d'une rangée ; la source d'issues est posée dans le cache. */
function Demo({ source, path }: { source: IssueSourceDto | null; path: string | null }) {
  const client = useQueryClient()
  useState(() => client.setQueryData(['issue-source', `demo-${source?.repository ?? 'none'}-${source?.error ?? ''}`], source))
  return (
    <div className="flex max-w-[36rem] flex-col gap-8">
      <IssueSourceControl projectId={`demo-${source?.repository ?? 'none'}-${source?.error ?? ''}`} />
      <DesignSystemControl projectId="demo" path={path} />
      {path ? (
        <PrototypeCandidates
          candidates={[
            { name: 'TimelineScrubber', path: '/home/tim/nimbus/.solera/prototypes/TimelineScrubber.stories.tsx', modifiedAt: 0 },
            { name: 'QuotaGauge', path: '/home/tim/nimbus/.solera/prototypes/QuotaGauge.stories.tsx', modifiedAt: 0 },
          ]}
        />
      ) : null}
    </div>
  )
}

const meta = {
  title: "Composants d'application/Réglages › Intégrations",
  component: Demo,
  args: { source: SOURCE, path: '/home/tim/projects/nimbus-ds' },
  parameters: {
    docs: {
      description: {
        component:
          "Le dépôt des issues et le design system lié, lus au repos (la valeur en mono, ou son absence en gris) et changés sur place. Se brancher ou se délier écrit tout de suite : hors du brouillon de la page. Sous le design system, les candidats que les agents ont dû créer faute de les y trouver.",
      },
    },
  },
} satisfies Meta<typeof Demo>

export default meta
type Story = StoryObj<typeof meta>

export const Relies: Story = { name: 'Reliés' }
export const Aucun: Story = { name: 'Rien de relié', args: { source: null, path: null } }
export const LectureEchouee: Story = { name: 'Lecture échouée', args: { source: { ...SOURCE, error: 'Bad credentials (401)' } } }
