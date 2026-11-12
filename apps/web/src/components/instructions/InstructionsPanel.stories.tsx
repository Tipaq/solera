import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import type { ProjectInstructionsDto, RepoInstructionFileDto } from '@solera/protocol'
import { InstructionsView } from './InstructionsPanel'

const GLOBAL = '- Répondre en français.\n- Vérifier ce qu’on affirme avant de l’annoncer.'
const AGENTS = '# Consignes\n\n- Les tests se lancent avec `pnpm test`.\n- Ne jamais pousser directement sur main.\n- Une PR par carte, relue avant fusion.\n'
const POINTER = 'Voir [AGENTS.md](AGENTS.md) — les mêmes consignes pour tous les CLI.\n'
const OTHER = '# Claude\n\n- Toujours lancer le lint.\n- Préférer pnpm à npm.\n- Écrire les tests d’abord.\n- Pas de console.log.\n'

function data(overrides: Partial<ProjectInstructionsDto>, repoFiles: RepoInstructionFileDto[]): ProjectInstructionsDto {
  return {
    content: '',
    updatedAt: null,
    author: null,
    canEdit: true,
    mode: 'repo',
    modeChosen: true,
    repoFiles,
    ...overrides,
  }
}

/** Le bloc, avec ses gestes joués sur place : changer de mode, enregistrer un texte. */
function Demo({ initial, global = GLOBAL }: { initial: ProjectInstructionsDto; global?: string }) {
  const [value, setValue] = useState(initial)
  return (
    <div className="max-w-3xl">
      <InstructionsView
        data={value}
        global={global}
        onMode={({ mode, content }) => setValue((current) => ({ ...current, mode, modeChosen: true, content: content ?? current.content }))}
        onSave={async (target, content) => {
          setValue((current) =>
            target.kind === 'solera'
              ? { ...current, content, updatedAt: Date.now() }
              : {
                  ...current,
                  repoFiles: [...current.repoFiles.filter((file) => file.path !== target.path), { path: target.path, content }],
                },
          )
        }}
        saving={false}
        modeError={null}
        saveError={null}
        onEditing={() => undefined}
        onEditGlobal={() => undefined}
      />
    </div>
  )
}

const meta = {
  title: "Composants d'application/Réglages › Consignes",
  component: Demo,
  parameters: {
    docs: {
      description: {
        component:
          "Les consignes du projet dans ses réglages : où elles vivent (le dépôt ou Solera), les fichiers à la racine du dépôt, ce que chaque CLI en lit, ce qui manque, et le texte en vigueur avec « Modifier ».\n\nCodex ne lit que `AGENTS.md` ; Claude, Grok et OpenCode lisent `AGENTS.md` et `CLAUDE.md`. Dans Solera, le texte de Solera va aux quatre et les fichiers du dépôt leur sont masqués. Un fichier de quatre lignes au plus qui cite l'autre est un renvoi.\n\nHors du brouillon de la page : chaque geste prend effet tout de suite.",
      },
    },
  },
} satisfies Meta<typeof Demo>

export default meta
type Story = StoryObj<typeof meta>

/** Le cas sain : `AGENTS.md` porte les consignes, `CLAUDE.md` y renvoie. */
export const Depot: Story = {
  name: 'Dans le dépôt, avec un renvoi',
  args: {
    initial: data({}, [
      { path: 'AGENTS.md', content: AGENTS },
      { path: 'CLAUDE.md', content: POINTER },
    ]),
  },
}

/** Seul `CLAUDE.md` : Codex n'a rien, et l'alerte dit comment y remédier. */
export const SeulClaude: Story = {
  name: 'Seul CLAUDE.md',
  args: { initial: data({ modeChosen: false }, [{ path: 'CLAUDE.md', content: AGENTS }]) },
}

/** Deux fichiers qui ont chacun leur contenu : les CLI ne lisent pas la même chose. */
export const Divergents: Story = {
  name: 'Deux fichiers divergents',
  args: {
    initial: data({}, [
      { path: 'AGENTS.md', content: AGENTS },
      { path: 'CLAUDE.md', content: OTHER },
    ]),
  },
}

/** Dans Solera : le texte de Solera aux quatre CLI, les fichiers du dépôt masqués. */
export const Solera: Story = {
  name: 'Dans Solera',
  args: {
    initial: data({ mode: 'solera', content: AGENTS, updatedAt: Date.now() - 3 * 3_600_000 }, [{ path: 'AGENTS.md', content: AGENTS }]),
  },
}

/** Rien nulle part, et une partie globale vide : personne ne reçoit de consignes. */
export const Vide: Story = {
  name: 'Rien nulle part',
  args: { initial: data({}, []), global: '' },
}

/** Un membre d'un projet partagé : il lit, sans changer de mode ni modifier. */
export const Lecture: Story = {
  name: 'En lecture seule',
  args: { initial: data({ canEdit: false }, [{ path: 'AGENTS.md', content: AGENTS }]) },
}
