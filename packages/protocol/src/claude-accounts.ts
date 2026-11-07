import { z } from 'zod'

/**
 * Comptes Claude supplémentaires, par utilisateur.
 *
 * Le CLI ne connaît qu'une connexion par dossier de configuration, celle de `/login`.
 * Pour en tenir plusieurs sans dédoubler ce dossier (réglages, transcripts, mémoire),
 * Solera retient un secret par compte et le passe à la session dans l'environnement :
 * un jeton OAuth longue durée de `claude setup-token` dans `CLAUDE_CODE_OAUTH_TOKEN`
 * (abonnement), ou une clé API Console dans `ANTHROPIC_API_KEY` (facturée à l'usage).
 * Les deux passent devant la connexion enregistrée du CLI (sondé sur 2.1.296).
 *
 * Comme les credentials git, un secret s'écrit et ne se relit jamais par l'API, et il
 * appartient à un compte Solera et non à l'instance : c'est l'abonnement de quelqu'un.
 */

export const claudeAccountKindSchema = z.enum(['oauth', 'apiKey'])
export type ClaudeAccountKind = z.infer<typeof claudeAccountKindSchema>

export const claudeAccountSchema = z.object({
  id: z.string(),
  /** Le nom affiché : l'adresse, précédée de l'alias s'il y en a un (`claudeAccountName`). */
  label: z.string(),
  /**
   * L'adresse du compte Claude, lue par `claude auth status` sous le jeton. Nulle pour
   * une clé API, et pour un compte d'avant les adresses dont le jeton ne répond plus :
   * il est à reconnecter.
   */
  email: z.string().nullable(),
  /** Nom facultatif (« Perso ») ; c'est le seul nom d'une clé API. */
  alias: z.string().nullable(),
  kind: claudeAccountKindSchema,
  /**
   * Vrai quand un autre compte du même utilisateur a la même adresse : deux comptes
   * d'avant les adresses peuvent se révéler être le même. À l'utilisateur d'en retirer un.
   */
  duplicate: z.boolean(),
  /**
   * Jauge d'usage d'un abonnement : le jeton de setup-token ne porte que la portée
   * `user:inference` et ne lit pas les limites du forfait. Une vraie connexion
   * (`claude auth login`), gardée à part et réservée aux lectures d'usage, les lit.
   * Faux tant qu'elle n'a pas été faite, et pour une clé API, qui n'a pas de forfait.
   */
  gauge: z.boolean(),
  createdAt: z.number(),
  updatedAt: z.number(),
})
export type ClaudeAccount = z.infer<typeof claudeAccountSchema>

/** « Perso · moi@exemple.fr », l'adresse seule sans alias, l'alias seul sans adresse. */
export function claudeAccountName(account: { email: string | null; alias: string | null }): string {
  if (account.alias && account.email) return `${account.alias} · ${account.email}`
  return account.email ?? account.alias ?? '?'
}

export const claudeAccountAliasSchema = z.string().trim().max(60)

/**
 * Ce que `claude setup-token` imprime (`sk-ant-oat01-…`) ou une clé API Console
 * (`sk-ant-api03-…`). Le préfixe est la seule vérification possible sans dépenser un
 * tour, le CLI ne sachant rien dire d'un secret tant qu'une requête ne l'a pas présenté.
 */
export const claudeSecretSchema = z
  .string()
  .trim()
  .regex(
    /^sk-ant-(oat01|api\d{2})-[A-Za-z0-9_-]{20,}$/,
    'Un jeton de `claude setup-token` (sk-ant-oat01-…) ou une clé API (sk-ant-api03-…).',
  )

/** La nature d'un secret se lit dans son préfixe. */
export function claudeSecretKind(secret: string): ClaudeAccountKind {
  return secret.startsWith('sk-ant-oat01-') ? 'oauth' : 'apiKey'
}

/** Un alias vide n'en est pas un : le compte s'appelle alors par son adresse. */
const aliasField = claudeAccountAliasSchema.transform((alias) => alias || null)

/** Une clé API n'a pas d'adresse : son alias est son seul nom, la route l'exige. */
export const createClaudeAccountBodySchema = z.object({
  alias: aliasField.optional(),
  token: claudeSecretSchema,
})

/**
 * Changer d'alias (`null` le retire), remplacer le secret expiré, ou les deux. Un jeton
 * qui ne mène pas à la même adresse est refusé : ce serait un autre compte.
 */
export const updateClaudeAccountBodySchema = z
  .object({
    alias: aliasField.nullable().optional(),
    token: claudeSecretSchema.optional(),
  })
  .refine((body) => body.alias !== undefined || body.token !== undefined, {
    message: 'Rien à modifier.',
  })

export interface ClaudeAccountListDto {
  accounts: ClaudeAccount[]
}

/**
 * Connexion guidée d'un abonnement : Solera pilote `claude setup-token` dans un
 * pseudo-terminal, montre l'URL d'autorisation, reçoit le code que la page affiche et
 * récupère le jeton imprimé. Le compte n'est créé qu'à la fin, avec ce jeton et
 * l'adresse qu'il donne ; une adresse déjà connue reconnecte son compte au lieu d'en
 * créer un second.
 */
export const startClaudeLoginBodySchema = z.object({ alias: aliasField.optional() })

/**
 * Ce que mène une connexion guidée : `token` crée ou reconnecte le compte avec le jeton de
 * `setup-token`, `gauge` donne une jauge à un compte existant par `auth login`, `cli`
 * connecte le CLI lui-même, là où les sessions lisent sa connexion.
 */
export type ClaudeLoginPurpose = 'token' | 'gauge' | 'cli'
export const submitClaudeLoginCodeBodySchema = z.object({ code: z.string().trim().min(1).max(400) })

export interface ClaudeLoginStatusDto {
  loginId: string
  purpose: ClaudeLoginPurpose
  /**
   * `starting` tant que le CLI n'a pas imprimé l'URL ; `waiting_code` quand il
   * l'attend ; `checking` pendant qu'il vérifie un code ; `done` avec le compte créé ;
   * `failed` avec le motif, et on peut renvoyer un code tant que le CLI vit.
   */
  state: 'starting' | 'waiting_code' | 'checking' | 'done' | 'failed'
  authUrl: string | null
  error: string | null
  account: ClaudeAccount | null
}
