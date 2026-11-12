import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { Button } from '@solera/ui'
import { useMilestoneDraft } from '../../lib/card-drafts'
import { CARDS, PROJECT_ID, SeededBoard } from '../board/card-fixtures'
import { DrawerLayer } from '../shell/Drawer'
import { MilestoneCreatedNotice, NewMilestoneDrawer, type MilestoneOutcome } from './NewMilestoneDrawer'

const BRIEF = `# Mode hors-ligne complet

## Objectif
Pouvoir relire et répondre aux sessions sans réseau.

## Étapes
- Cache local des fils (voir #27)
- File d'envoi des réponses
- Resynchronisation au retour du réseau

## Hors champ
- Lancer une session hors ligne`

/** Pose le brouillon du projet, comme si on l'avait écrit puis refermé. */
function Draft({ text }: { text: string }) {
  const { setDraft } = useMilestoneDraft('u1', `new:${PROJECT_ID}`)
  useState(() => {
    setDraft(text ? { title: '', text, due: '' } : null)
    return null
  })
  return null
}

function Place({ text = '' }: { text?: string }) {
  const [open, setOpen] = useState(true)
  const [outcome, setOutcome] = useState<MilestoneOutcome | null>(null)
  return (
    <SeededBoard>
      <Draft text={text} />
      <div className="flex h-[44rem] flex-col border border-line">
        <div className="h-11 shrink-0 border-b border-line" />
        <div className="relative flex min-h-0 flex-1 overflow-clip">
          <div className="flex min-w-0 flex-1 flex-col items-start gap-4 p-4 md:p-6">
            <Button size="sm" onClick={() => setOpen(true)}>
              Jalon
            </Button>
            {outcome ? <MilestoneCreatedNotice outcome={outcome} onDismiss={() => setOutcome(null)} /> : null}
          </div>
          <NewMilestoneDrawer open={open} onClose={() => setOpen(false)} projectId={PROJECT_ID} onDone={setOutcome} />
          <DrawerLayer />
        </div>
      </div>
    </SeededBoard>
  )
}

const meta = {
  title: "Composants d'application/Nouveau jalon",
  component: Place,
  parameters: {
    docs: {
      description: {
        component:
          "Le tiroir « Nouveau jalon » (#193, spec jalons CMP) : un titre tiré du texte, le champ d'écriture (`BriefField`) et son échéance, les pièces jointes avec Réf./Inclure, et un pied qui dit l'étape d'arrivée et ce que fera l'agent selon le geste survolé. *Noter l'idée* crée le jalon sans session ; *Affiner* et *Découper* le créent puis ouvrent sa session d'affinage. Le texte, le titre et l'échéance restent d'une ouverture à l'autre.",
      },
    },
  },
} satisfies Meta<typeof Place>

export default meta
type Story = StoryObj<typeof meta>

/** Vide : les trois gestes grisés, « Écris d'abord le jalon. » en infobulle. */
export const Vide: Story = {}

/** Une phrase : « Affiner avec un agent » est le geste principal, « Découper » attend un brief. */
export const UnePhrase: Story = { args: { text: 'Un mode hors-ligne pour relire les sessions dans le train' } }

/** Un brief qui suffit : titre tiré du texte, « Découper directement » en geste principal, une carte jointe. */
export const BriefSuffisant: Story = { args: { text: BRIEF } }

/** Le retour d'une idée notée, sous le cap de l'onglet. */
export const IdeeNotee: Story = {
  render: () => (
    <div className="max-w-xl p-6">
      <MilestoneCreatedNotice outcome={{ card: CARDS[0]!, failed: null, href: null }} onDismiss={() => {}} />
    </div>
  ),
}

/** Un jalon créé dont un fichier n'a pas suivi : la carte existe, la session s'ouvre d'ici. */
export const PieceNonSuivie: Story = {
  render: () => (
    <div className="max-w-xl p-6">
      <MilestoneCreatedNotice
        outcome={{ card: CARDS[0]!, failed: { count: 1, message: 'Le fichier dépasse 25 Mo.' }, href: '/p/x/c/new' }}
        onDismiss={() => {}}
      />
    </div>
  ),
}
