import type { Meta, StoryObj } from '@storybook/react-vite'
import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import type { GitRepoListDto } from '@solera/protocol'
import { RepoCombobox } from './RepoCombobox'

/**
 * Le choix d'un dépôt à cloner : saisie libre, et la liste des dépôts des forges qui
 * savent la donner (GitHub, GitLab). Les réponses du serveur sont posées à l'avance dans
 * le cache, pour une requête vide : la liste s'ouvre au focus.
 */

const GITHUB: GitRepoListDto = {
  truncated: false,
  repos: [
    { fullName: 'octocat/solera', name: 'solera', cloneUrl: 'https://github.com/octocat/solera.git', isPrivate: true, description: 'Le serveur et le web', pushedAt: 1 },
    { fullName: 'octocat/site', name: 'site', cloneUrl: 'https://github.com/octocat/site.git', isPrivate: false, description: null, pushedAt: 1 },
  ],
}

const GITLAB: GitRepoListDto = {
  truncated: false,
  repos: [
    { fullName: 'equipe/facturation', name: 'facturation', cloneUrl: 'https://gitlab.monentreprise.fr/equipe/facturation.git', isPrivate: true, description: 'Le service de facturation', pushedAt: 1 },
  ],
}

function Demo({ hosts }: { hosts: string[] }) {
  const client = useQueryClient()
  const [value, setValue] = useState('')
  useState(() => {
    client.setQueryData(['git-repos', 'github.com', ''], GITHUB)
    client.setQueryData(['git-repos', 'gitlab.monentreprise.fr', ''], GITLAB)
    return null
  })
  return (
    <div className="h-80 w-[32rem]">
      <RepoCombobox
        value={value}
        onChange={setValue}
        onPick={(repo) => setValue(repo.cloneUrl)}
        hosts={hosts}
        hint="Tape pour chercher parmi tes dépôts, ou colle l'URL de n'importe quelle forge."
      />
    </div>
  )
}

const meta = {
  title: "Composants d'application/Choix du dépôt à cloner",
  component: RepoCombobox,
  args: { value: '', onChange: () => undefined, onPick: () => undefined, hosts: [] },
} satisfies Meta<typeof RepoCombobox>

export default meta
type Story = StoryObj<typeof meta>

export const GitHubEtGitLab: Story = {
  name: 'GitHub et une GitLab',
  render: () => <Demo hosts={['github.com', 'gitlab.monentreprise.fr']} />,
}

export const SansAcces: Story = {
  name: 'Sans accès qui liste',
  render: () => <Demo hosts={[]} />,
}
