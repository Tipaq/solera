import type { Meta, StoryObj } from '@storybook/react-vite'
import { useEffect, useMemo, useRef, useState } from 'react'
import { readBrief } from '../../lib/brief'
import { CARDS } from '../board/card-fixtures'
import { AttachedPieces } from './AttachedPieces'
import { BriefField, DueField } from './BriefField'
import { BriefSpotted } from './BriefSpotted'
import { useBriefAttachments } from './use-brief-attachments'

const BRIEF = `# Mode hors-ligne complet

## Objectif
Pouvoir relire et répondre aux sessions sans réseau.

## Étapes
- Cache local des fils (voir #27)
- File d'envoi des réponses, comme #58
- Resynchronisation au retour du réseau

## Hors champ
- Lancer une session hors ligne`

const PLACEHOLDER = `ex. Mode hors-ligne complet

ou un brief :
## Objectif
Pouvoir relire et répondre aux sessions sans réseau.`

/** Une vignette d'image, dessinée sur place pour ne rien charger. */
function imageFile(): Promise<File> {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 64
  const context = canvas.getContext('2d')!
  context.fillStyle = '#7c6cf0'
  context.fillRect(0, 0, 64, 64)
  context.fillStyle = '#f5f3ff'
  context.fillRect(12, 20, 40, 24)
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(new File([blob!], 'maquette-hors-ligne.png', { type: 'image/png' })), 'image/png'))
}

function Field({ initial = '', rows, allowInclude = true, withDue = true, seeded = false }: {
  initial?: string
  rows?: number
  allowInclude?: boolean
  withDue?: boolean
  /** Joint d'emblée un lien de PR, un lien web, un PDF et une image. */
  seeded?: boolean
}) {
  const [text, setText] = useState(initial)
  const [due, setDue] = useState(seeded ? '2026-12-12' : '')
  const textRef = useRef<HTMLTextAreaElement>(null)
  const attachments = useBriefAttachments(CARDS, text, setText)
  const reading = useMemo(() => readBrief(text), [text])
  // Une fois, même sous le double montage du mode strict.
  const once = useRef(false)
  useEffect(() => {
    if (!seeded || once.current) return
    once.current = true
    attachments.addLink('https://github.com/Tipaq/solera/pull/212')
    attachments.addLink('https://developer.mozilla.org/fr/docs/Web/API/Service_Worker_API')
    void imageFile().then((image) => attachments.addFiles([new File(['%PDF'.repeat(400)], 'notes-reunion.pdf', { type: 'application/pdf' }), image]))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="flex w-[40rem] max-w-full flex-col gap-4 pb-64">
      <BriefField
        value={text}
        onChange={setText}
        label="Brief du jalon"
        placeholder={PLACEHOLDER}
        rows={rows}
        cards={CARDS}
        attachments={attachments}
        onSubmitShortcut={() => undefined}
        textRef={textRef}
        aside={withDue ? <DueField value={due} onChange={setDue} /> : undefined}
        autoFocus={false}
      />
      <AttachedPieces attachments={attachments} allowInclude={allowInclude} />
      <BriefSpotted reading={reading} attachments={attachments} />
    </div>
  )
}

const meta = {
  title: "Composants d'application/BriefField",
  component: Field,
  parameters: {
    docs: {
      description: {
        component:
          "Le champ d'écriture à mentions (#192), commun au tiroir « Nouveau jalon » et à « Ajouter au jalon ».\n\n**Un seul cadre** : le texte, puis sa barre Carte · Lien · Fichier. `#` ouvre la liste des cartes (↑↓ Entrée Échap) ; une URL collée devient une puce ; un fichier se dépose, se colle ou se choisit. **Une carte jointe est une carte mentionnée** : retirer sa puce retire sa mention. La liste des cartes et le champ de lien sont des couches : Échap les ferme sans fermer le tiroir.",
      },
    },
  },
} satisfies Meta<typeof Field>

export default meta
type Story = StoryObj<typeof meta>

/** Vide : l'exemple en placeholder, la barre et l'échéance discrète. */
export const Vide: Story = {}

/** Un brief : deux cartes mentionnées et surlignées, des liens, des fichiers, une échéance. */
export const BriefEtPieces: Story = { args: { initial: BRIEF, seeded: true } }

/** « Ajouter au jalon » : plus court, sans échéance ni Réf./Inclure. */
export const AjoutAuJalon: Story = { args: { rows: 8, allowInclude: false, withDue: false, initial: 'Il faut aussi gérer les pièces jointes hors ligne (#27)' } }
