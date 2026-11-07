import { z } from 'zod'
import { projectInstructionsModeSchema } from './instructions.js'

/**
 * Accès aux forges git, par utilisateur et par hôte.
 *
 * Comme les secrets, un jeton s'écrit et ne se relit jamais par l'API. Contrairement à
 * eux, il appartient à un compte et non à l'instance : cloner un dépôt privé est un
 * geste d'utilisateur, alors que les secrets sont réservés aux administrateurs.
 *
 * Le jeton ne sert pas qu'au clone. Il est aussi ce qui rend possible le `push` d'un
 * agent, par un helper que Solera inscrit dans le dépôt cloné.
 */

/** Hôte seul, tel que git le présentera au helper : ni schéma, ni port, ni chemin. */
export const gitHostSchema = z
  .string()
  .min(1)
  .max(253)
  .regex(/^[a-z0-9.-]+$/, 'Un nom d\'hôte seul, sans schéma ni port.')

/**
 * La famille de la forge, qui décide de tout ce que Solera sait faire avec un jeton :
 * le vérifier, lister les dépôts, et proposer la page qui le crée.
 *
 * GitLab.com et une GitLab d'entreprise sont la même forge à un hôte près. `other`
 * couvre Gitea, Forgejo, Bitbucket… : Solera n'en connaît pas l'API, il se contente de
 * rendre le jeton à git.
 */
export const gitForgeSchema = z.enum(['github', 'gitlab', 'other'])
export type GitForge = z.infer<typeof gitForgeSchema>

export const GITHUB_HOST = 'github.com'
export const GITLAB_HOST = 'gitlab.com'

/**
 * Ce que le helper présente à git comme nom d'utilisateur, par forge.
 *
 * GitHub n'en tient pas compte pour un jeton personnel, et `x-access-token` reste valable
 * pour un jeton d'installation. GitLab n'en tient pas compte non plus pour un jeton
 * personnel (« any non-empty string »), mais `oauth2` est la valeur qu'il exige d'un
 * jeton OAuth : la prendre dès maintenant laisse la connexion par OAuth réutiliser la
 * même ligne. Le login réel n'est pas présenté : un login suivi d'un mot de passe faux
 * est ce que GitLab compte comme tentative échouée.
 */
export const GIT_USERNAME: Record<Exclude<GitForge, 'other'>, string> = {
  github: 'x-access-token',
  gitlab: 'oauth2',
}

/**
 * La forge d'une credential, y compris pour les lignes d'avant le choix de la forge, qui
 * n'en ont pas : les deux hôtes publics se reconnaissent, le reste reste `other`. Une
 * GitLab d'entreprise enregistrée à l'ancienne le restera donc, jusqu'à ce qu'on
 * réenregistre son jeton en la désignant.
 */
export function effectiveForge(host: string, forge: GitForge | null | undefined): GitForge {
  if (forge) return forge
  if (host === GITHUB_HOST) return 'github'
  if (host === GITLAB_HOST) return 'gitlab'
  return 'other'
}

/**
 * La page de la forge qui crée un jeton, pré-remplie : nom « Solera » et portées.
 *
 * GitHub : un jeton classique et non « fine-grained ». Ce dernier ne vaut que pour un
 * seul propriétaire de dépôts, et la personne qui travaille aussi sur les dépôts d'une
 * organisation devrait en comprendre la différence pour en créer deux. `repo` suffit à
 * cloner, pousser et lister les dépôts, y compris ceux des organisations (`/user/repos`
 * ne demande pas `read:org`). `description` et `scopes` ne sont pas documentés par
 * GitHub pour cette page, mais elle les lit ; ignorés, il resterait à cocher `repo`.
 *
 * GitLab : `read_api` couvre `/user` et `/projects`, `write_repository` le clone et le
 * push. `api` aurait aussi marché, mais il ouvre l'écriture sur toute l'API (supprimer
 * un projet, modifier ses membres), dont Solera n'a pas besoin. Les paramètres de
 * pré-remplissage sont lus depuis GitLab 15/16 ; une version plus ancienne les ignore et
 * montre le formulaire vide.
 *
 * `null` pour `other` : Solera ne connaît pas l'adresse de la page.
 */
export function tokenCreationUrl(forge: GitForge, host: string): string | null {
  if (forge === 'github') {
    return 'https://github.com/settings/tokens/new?description=Solera&scopes=repo'
  }
  if (forge === 'gitlab') {
    return `https://${host}/-/user_settings/personal_access_tokens?name=Solera&scopes=read_api,write_repository`
  }
  return null
}

export const gitCredentialSchema = z.object({
  host: z.string(),
  /**
   * Ce que le helper présentera comme nom d'utilisateur (voir `GIT_USERNAME`). Saisi à
   * la main pour `other`, dont Solera ne connaît pas les attentes.
   */
  username: z.string(),
  /** Déduite de l'hôte pour les lignes d'avant le choix de la forge. */
  forge: gitForgeSchema,
  /** Le compte reconnu par la forge à l'enregistrement ; nul sans vérification. */
  login: z.string().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
})
export type GitCredential = z.infer<typeof gitCredentialSchema>

const tokenSchema = z.string().trim().min(1)

/**
 * Selon la forge, l'hôte et le nom d'utilisateur sont fixés par Solera ou saisis :
 * GitHub n'a qu'un hôte, GitLab en a un par instance, et seule une forge inconnue
 * demande un nom d'utilisateur. Un corps sans `forge` est celui d'avant ce choix, et se
 * lit comme une forge inconnue.
 */
const putGitCredentialBodyUnion = z.discriminatedUnion('forge', [
  z.object({ forge: z.literal('github'), token: tokenSchema }),
  z.object({ forge: z.literal('gitlab'), host: gitHostSchema.default(GITLAB_HOST), token: tokenSchema }),
  z.object({
    forge: z.literal('other'),
    host: gitHostSchema,
    username: z.string().min(1).max(120).default('x-access-token'),
    token: tokenSchema,
  }),
])
export type PutGitCredentialBody = z.input<typeof putGitCredentialBodyUnion>

export const putGitCredentialBodySchema = z.preprocess(
  (body) =>
    body && typeof body === 'object' && !('forge' in body) ? { ...body, forge: 'other' } : body,
  putGitCredentialBodyUnion,
)

export interface GitCredentialListDto {
  credentials: GitCredential[]
}

/** Une entrée de la combobox de sélection de dépôt. */
export interface GitRepoDto {
  /** `owner/repo`, tel que la forge le nomme. */
  fullName: string
  /** Le nom seul, proposé comme nom de projet. */
  name: string
  cloneUrl: string
  isPrivate: boolean
  description: string | null
  /** Dernier push, pour classer les plus vivants en tête. */
  pushedAt: number | null
}

export interface GitRepoListDto {
  repos: GitRepoDto[]
  /** Vrai quand la forge a plus de dépôts que Solera n'en a rapatriés. */
  truncated: boolean
}

export const startCloneBodySchema = z.object({
  url: z.string().min(1).max(2048),
  name: z.string().min(1).max(120),
  /** Dossier qui accueillera le clone ; le dépôt y crée son propre sous-dossier. */
  parentDir: z.string().min(1),
  /** Nom du sous-dossier, par défaut celui que git aurait choisi. */
  directory: z.string().min(1).max(255),
  visibility: z.enum(['private', 'shared']).default('private'),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .nullable()
    .default(null),
  /** Absent : décidé d'après le dépôt cloné, comme pour un dossier existant. */
  /** Absent : le défaut du compte. */
  instructionsMode: projectInstructionsModeSchema.optional(),
})

export interface CloneJobDto {
  id: string
  status: 'running' | 'done' | 'failed'
  /** La phase telle que git la nomme, vide tant qu'il n'a rien dit. */
  phase: string
  percent: number | null
  /** Renseigné à la réussite : le projet créé dans la foulée du clone. */
  projectId: string | null
  /**
   * Même forme qu'une erreur d'API : un code que le client traduit, et un message
   * anglais de repli. Les échecs que Solera ne sait pas nommer portent le texte brut
   * de git, qui reste plus précis que ne le serait une reformulation.
   */
  error: { code: string; message: string } | null
}

export interface RemoteUrl {
  /**
   * L'URL débarrassée de sa requête et de son fragment, et c'est elle qu'il faut
   * cloner : git suit l'adresse au caractère près et échouerait sur un `?ref=x` que la
   * validation aurait pourtant laissé passer.
   */
  url: string
  /** Hôte seul, minuscule, sans port : la clé des credentials. */
  host: string
  /** Dernier segment du chemin, sans `.git` : le nom de dossier que git choisirait. */
  repo: string
  isSsh: boolean
}

/** Schéma, identifiants facultatifs, hôte, port facultatif, puis chemin. */
const SCHEME_URL = /^([a-z][a-z0-9+.-]*):\/\/(?:[^@/]*@)?([^:/?#]+)(?::\d+)?(\/.*)?$/i

/** Forme scp : pas de schéma, et un deux-points qui sépare l'hôte du chemin. */
const SCP_URL = /^(?:[^@/]+@)?([^:/]+):(.+)$/

/**
 * Découpe une URL de dépôt, dans les deux formes que les forges proposent au
 * copier-coller : `https://github.com/owner/repo.git` et `git@github.com:owner/repo.git`.
 *
 * Par motif et non par `new URL` : ce paquet est partagé entre le serveur et le
 * navigateur et ne déclare aucun global de runtime, ni DOM ni Node.
 *
 * Retourne null sur tout le reste, y compris un chemin local. C'est volontaire : le
 * clone d'un dépôt local n'a rien à faire dans un formulaire qui demande une URL, et le
 * refuser ici évite d'avoir à valider un chemin arbitraire plus loin.
 */
export function parseRemoteUrl(input: string): RemoteUrl | null {
  // Requête et fragment retirés d'emblée : une URL de dépôt n'en porte pas, mais une
  // adresse copiée depuis un navigateur en traîne souvent une.
  const url = input.trim().split(/[?#]/)[0]?.trim() ?? ''
  if (!url) return null

  const scheme = SCHEME_URL.exec(url)
  if (scheme) {
    const [, protocol = '', host = '', path = ''] = scheme
    if (!/^(https?|ssh)$/i.test(protocol)) return null

    const repo = lastSegment(path)
    if (!repo) return null
    return { url, host: host.toLowerCase(), repo, isSsh: protocol.toLowerCase() === 'ssh' }
  }

  if (url.includes('://')) return null

  const scp = SCP_URL.exec(url)
  if (!scp) return null

  const [, host = '', path = ''] = scp
  const repo = lastSegment(path)
  return repo ? { url, host: host.toLowerCase(), repo, isSsh: true } : null
}

function lastSegment(path: string): string | null {
  const segment = path.split('/').filter(Boolean).pop()
  if (!segment) return null
  const name = segment.replace(/\.git$/, '')
  // Un nom de dépôt sert de nom de dossier : refuser ce qui remonterait l'arborescence.
  return name && name !== '.' && name !== '..' ? name : null
}
