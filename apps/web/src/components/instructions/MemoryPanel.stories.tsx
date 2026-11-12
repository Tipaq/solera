import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { MEMORY_INDEX_FILE, type MemoryFileDto, type ProjectMemoryDto } from '@solera/protocol'
import { MemoryNotes } from './MemoryPanel'

const HOUR = 3_600_000
const now = Date.now()

const note = (name: string, type: string, description: string, body: string) =>
  `---\nname: ${name}\ndescription: ${description}\nmetadata:\n  type: ${type}\n---\n\n${body}\n`

/** Une mémoire réaliste : une note hors index, une ligne d'index orpheline, des liens. */
const FILES: MemoryFileDto[] = [
  {
    file: MEMORY_INDEX_FILE,
    content: '- [Port du dev](port-du-dev.md) — le dev écoute sur 7417\n- [Pas de jq](pas-de-jq.md) — la CI n’a pas jq\n- [Ancienne](ancienne.md) — supprimée depuis\n',
    updatedAt: now - 30 * HOUR,
  },
  {
    file: 'port-du-dev.md',
    content: note('Port du dev', 'project', 'le dev écoute sur 7417', 'Le serveur de dev tourne sur **7417**, vite sur 5417. Voir [[pas-de-jq]] et [[scripts-dev]].\n\n**Why:** deux instances tournent sur la machine.\n\n**How to apply:** ne jamais viser 7517 en essai.'),
    updatedAt: now - 2 * HOUR,
  },
  {
    file: 'pas-de-jq.md',
    content: note('Pas de jq', 'feedback', 'la CI n’a pas jq', 'Lire le JSON avec `node -e`, jamais `jq`.'),
    updatedAt: now - 26 * HOUR,
  },
  {
    file: 'tim-francais.md',
    content: note('Tim écrit en français', 'user', 'répondre en français, court', 'Réponses courtes, en français.'),
    updatedAt: now - 5 * 24 * HOUR,
  },
  { file: 'brouillon.md', content: 'Une note sans en-tête, écrite à la main.', updatedAt: now - 40 * 24 * HOUR },
]

function Demo({ files = FILES, canEdit = true }: { files?: MemoryFileDto[]; canEdit?: boolean }) {
  const [current, setCurrent] = useState(files)
  const data: ProjectMemoryDto = { dir: '/home/tim/.local/share/solera/memory/projects/nimbus', files: current, importedFrom: null, canEdit }
  const write = async (file: string, content: string) =>
    setCurrent((list) => [...list.filter((entry) => entry.file !== file), { file, content, updatedAt: Date.now() }])
  const remove = async (file: string, keepIndexLine: boolean) =>
    setCurrent((list) =>
      list
        .filter((entry) => entry.file !== file)
        .map((entry) =>
          entry.file === MEMORY_INDEX_FILE && !keepIndexLine
            ? { ...entry, content: entry.content.split('\n').filter((line) => !line.includes(`](${file})`)).join('\n') }
            : entry,
        ),
    )
  return (
    <div className="max-w-[60rem]">
      <MemoryNotes data={data} writes={{ write, remove, busy: false, error: null }} />
    </div>
  )
}

const meta = {
  title: "Composants d'application/Réglages › Mémoire",
  component: Demo,
  parameters: {
    docs: {
      description: {
        component:
          "La mémoire d'un projet dans ses Réglages : une note par fichier, `MEMORY.md` pour index.\n\nLa ligne d'index dit combien de notes il annonce, lesquelles il oublie et quelles lignes pointent dans le vide ; « Réparer l'index » retire les unes et ajoute les autres. Une note se déplie sur place : son corps en markdown, ses `[[liens]]` (une note qui existe s'ouvre, une absente est « à écrire »), Modifier et Supprimer, qui demande s'il faut retirer aussi sa ligne de l'index.\n\nChaque geste écrit tout de suite : la mémoire ne passe pas par le brouillon de la page.",
      },
    },
  },
} satisfies Meta<typeof Demo>

export default meta
type Story = StoryObj<typeof meta>

export const NotesEtIndex: Story = { name: 'Notes et index à réparer' }
export const IndexAJour: Story = {
  name: 'Index à jour',
  args: { files: FILES.filter((file) => file.file !== 'brouillon.md').map((file) => file.file === MEMORY_INDEX_FILE ? { ...file, content: file.content.replace(/- \[Ancienne\][^\n]*\n/, '') + '- [Tim écrit en français](tim-francais.md) — répondre en français, court\n' } : file) },
}
export const Vide: Story = { args: { files: [] } }
export const LectureSeule: Story = { name: 'Lecture seule (projet partagé)', args: { canEdit: false } }
