import type { Meta, StoryObj } from '@storybook/react-vite'
import { useQueryClient } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
import type { GitCredential, GitCredentialListDto } from '@solera/protocol'
import { GitCredentialsSettingsPage } from '../../routes/GitCredentialsSettingsPage'
import { GitAccessForm, GitAccessRow } from './GitAccess'

/**
 * Réglages › Accès git : choisir sa forge, créer le jeton sur la page qu'elle ouvre déjà
 * réglée, le coller. Sans serveur, le catalogue ne peut pas vérifier un jeton : l'envoi
 * y échoue, le reste se regarde.
 */

const at = Date.parse('2026-10-28T09:30:00Z')

const CREDENTIALS: GitCredential[] = [
  { host: 'github.com', username: 'x-access-token', forge: 'github', login: 'octocat', createdAt: at, updatedAt: at },
  { host: 'gitlab.monentreprise.fr', username: 'oauth2', forge: 'gitlab', login: 'jdupont', createdAt: at, updatedAt: at },
  // Enregistré avant le choix de la forge : forge déduite de l'hôte, pas de login.
  { host: 'gitlab.com', username: 'oauth2', forge: 'gitlab', login: null, createdAt: at, updatedAt: at },
  { host: 'codeberg.org', username: 'moi', forge: 'other', login: null, createdAt: at, updatedAt: at },
]

function Seeded({ credentials, children }: { credentials: GitCredential[]; children: ReactNode }) {
  const client = useQueryClient()
  useState(() => {
    client.setQueryData<GitCredentialListDto>(['git-credentials'], { credentials })
    return null
  })
  return <div className="w-[40rem]">{children}</div>
}

const meta = {
  title: "Composants d'application/Accès git",
  component: GitAccessForm,
  parameters: {
    docs: {
      description: {
        component:
          "Un accès git par forge. **GitHub et GitLab** (la publique ou celle d'une entreprise) : pas d'hôte ni de nom d'utilisateur à connaître, un lien ouvre la page qui crée le jeton avec le nom « Solera » et les bonnes portées, et le serveur vérifie le jeton avant de l'enregistrer. La ligne de l'accès dit alors « Connecté en tant que @login ».\n\n**Autre forge** (Gitea, Forgejo, Bitbucket…) : hôte, nom d'utilisateur et jeton, sans vérification.",
      },
    },
  },
} satisfies Meta<typeof GitAccessForm>

export default meta
type Story = StoryObj<typeof meta>

export const GitHub: Story = { name: 'Formulaire · GitHub', render: () => <div className="w-[40rem]"><GitAccessForm /></div> }

export const GitLabEntreprise: Story = {
  name: "Formulaire · GitLab d'entreprise",
  render: () => <div className="w-[40rem]"><GitAccessForm initialChoice="gitlab-self" /></div>,
}

export const AutreForge: Story = {
  name: 'Formulaire · autre forge',
  render: () => <div className="w-[40rem]"><GitAccessForm initialChoice="other" /></div>,
}

export const Lignes: Story = {
  name: 'Accès enregistrés',
  render: () => (
    <div className="flex w-[40rem] flex-col gap-2">
      {CREDENTIALS.map((credential) => <GitAccessRow key={credential.host} credential={credential} />)}
    </div>
  ),
}

export const Page: Story = {
  name: 'La page entière',
  render: () => (
    <Seeded credentials={CREDENTIALS}>
      <GitCredentialsSettingsPage />
    </Seeded>
  ),
}
