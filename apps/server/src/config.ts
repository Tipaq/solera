import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { parse as parseToml } from 'smol-toml'
import { z } from 'zod'
import { cronScheduleSchema } from '@solera/protocol'

const configSchema = z.object({
  server: z
    .object({
      host: z.string().default('127.0.0.1'),
      port: z.number().int().min(1).max(65535).default(7517),
      /**
       * Racine publique de l'instance, pour les liens que l'API met dans ses réponses.
       *
       * Vide, elle se déduit de l'en-tête `Host` de la requête, ce qui marche aussi bien
       * par le nom de domaine que par l'adresse locale. La renseigner ferme le cas où un
       * appelant forge ce `Host` pour obtenir un lien vers un autre site, qu'il ferait
       * ensuite suivre à un humain.
       */
      publicUrl: z.string().default(''),
    })
    .default({}),
  limits: z
    .object({
      /**
       * Une session Claude coûte 400 à 500 Mo. C'est le seul plafond qui compte.
       *
       * Défaut de provisionnement seulement : l'interface écrit la valeur en base, et
       * celle-ci l'emporte (voir `readAppSettings`).
       */
      maxConcurrentSessions: z.number().int().min(1).default(10),
      sessionIdleTimeoutMin: z.number().int().min(1).default(30),
      ptyIdleTimeoutMin: z.number().int().min(1).default(60),
      maxAttachmentBytes: z.number().int().default(20 * 1024 * 1024),
    })
    .default({}),
  retention: z
    .object({
      archivedEventsDays: z.number().int().min(1).default(90),
      /**
       * Jours d'inactivité au bout desquels une conversation lue et au repos est
       * rangée. Zéro coupe le rangement automatique, l'action manuelle restant là.
       */
      autoArchiveDays: z.number().int().min(0).default(14),
      /**
       * Motif cron du passage d'archivage. Au petit matin par défaut, et décalé des
       * autres ménages pour ne pas se retrouver à quatre sur l'unique rédacteur SQLite.
       */
      autoArchiveSchedule: cronScheduleSchema.default('45 4 * * *'),
    })
    .default({}),
  mcp: z
    .object({
      /**
       * Monte le serveur MCP de Solera dans les conversations, qui ouvre à l'agent
       * l'historique du projet.
       *
       * Vrai par défaut, et coupable ici pour toute l'instance : certains ne veulent de
       * Solera qu'une interface à Claude Code et Codex, sans les capacités que la
       * plateforme ajoute par-dessus. À faux, l'entrée disparaît aussi de l'interface,
       * un réglage visible mais inopérant valant moins que pas de réglage du tout.
       */
      soleraServer: z.boolean().default(true),
      /**
       * Prête la mémoire de Solera aux agents : les trois outils `*_memory`, l'index
       * injecté à Codex et à opencode, et le dossier que Claude reçoit en
       * `autoMemoryDirectory`.
       *
       * Vrai par défaut comme le réglage de conversation qu'il chapeaute. À faux, la
       * mémoire est éteinte pour toute l'instance et l'entrée disparaît de l'interface,
       * par le même raisonnement que `soleraServer`. Pour qui ne veut pas qu'une session
       * laisse derrière elle, hors de la base, de quoi orienter les suivantes.
       */
      agentMemory: z.boolean().default(true),
      /**
       * Laisse les agents déclarer un projet et demander le rangement d'une
       * conversation (`create_project`, `move_conversation`).
       *
       * Faux par défaut comme le réglage de conversation qu'il chapeaute : ces deux
       * outils agissent au-dessus du projet où la session travaille. À faux, l'entrée
       * disparaît aussi de l'interface, par le même raisonnement que `soleraServer`.
       */
      projectFiling: z.boolean().default(false),
      /**
       * Laisse les agents proposer le déplacement d'une carte du board
       * (`request_card_move`), que l'utilisateur accorde d'un clic.
       *
       * Faux par défaut comme le réglage de conversation qu'il chapeaute. À faux,
       * l'entrée disparaît aussi de l'interface, par le même raisonnement que
       * `soleraServer`.
       */
      cardFiling: z.boolean().default(false),
      /**
       * Laisse les agents demander une décision (`request_decision`), que l'utilisateur
       * tranche plus tard sans que la session attende.
       *
       * Vrai par défaut, à la différence des trois précédents : c'est un veto, pas une
       * portée. Le réglage de conversation qu'il chapeaute est déjà faux par défaut, et
       * rien ne s'applique sans une personne ; l'éteindre ici fait disparaître l'entrée
       * de l'interface, par le même raisonnement que `soleraServer`.
       */
      decisions: z.boolean().default(true),
    })
    .default({}),
  vault: z
    .object({
      /**
       * Racine du vault du lieu *Savoir*, vide par défaut.
       *
       * Défaut de provisionnement seulement : l'interface écrit la valeur en base, et
       * celle-ci l'emporte (voir `readAppSettings`).
       *
       * Un dossier local, hors de `/mnt/c` sous WSL — l'indexation y est trop lente —
       * et versionné par git : c'est ce qui donne la synchronisation, l'historique par
       * note, et le rattrapage borné d'un vault modifié ailleurs.
       */
      path: z.string().default(''),
    })
    .default({}),
  skills: z
    .object({
      /**
       * Livre la bibliothèque de skills de Solera aux sessions. Coupable ici pour toute
       * l'instance, par le même raisonnement que `mcp.soleraServer`.
       */
      library: z.boolean().default(true),
    })
    .default({}),
  agents: z
    .object({
      claude: z
        .object({ binary: z.string().default('claude'), enabled: z.boolean().default(true) })
        .default({}),
      codex: z
        .object({ binary: z.string().default('codex'), enabled: z.boolean().default(true) })
        .default({}),
      opencode: z
        .object({ binary: z.string().default('opencode'), enabled: z.boolean().default(true) })
        .default({}),
      grok: z
        .object({ binary: z.string().default('grok'), enabled: z.boolean().default(true) })
        .default({}),
    })
    .default({}),
})

export type Config = z.infer<typeof configSchema> & {
  paths: Paths
  /**
   * Nom du cookie de session, propre au répertoire de données.
   *
   * Un cookie ne distingue pas les ports : deux instances sur la même machine — le
   * daemon et un serveur d'essai — se voient sous le même nom d'hôte et partageaient
   * donc le même cookie. Se connecter à l'une déconnectait l'autre, chacune recevant
   * un jeton que sa base ne connaît pas. Le suffixe les sépare sans rien à configurer.
   *
   * Même raisonnement et même clé que le cache des sources de skills : c'est le
   * répertoire de données qui identifie une instance.
   */
  sessionCookie: string
}

export interface Paths {
  data: string
  database: string
  attachments: string
  /**
   * Préfixe npm où Solera installe les CLI qu'il gère lui-même.
   *
   * Sous le répertoire de données, et non ailleurs : en Docker c'est déjà le volume
   * monté, donc les CLI survivent au remplacement du conteneur sans qu'il faille en
   * monter un second, et le dossier appartient déjà à l'utilisateur du service.
   */
  agents: string
  worktrees: string
  /**
   * Dossier de travail des fils libres, un sous-dossier vide par conversation.
   *
   * Un fil sans projet n'a pas de répertoire de travail — c'est sa définition — mais un
   * CLI se lance toujours quelque part, et le lancer dans le home donnerait à l'agent
   * la machine entière à lire. On lui donne donc un dossier à lui, vide et jetable,
   * que l'interface n'expose jamais : ni fichiers, ni git, ni terminaux.
   */
  threads: string
  logs: string
  /** Bibliothèque de skills, voir `skill-library/layout.ts`. */
  skillLibrary: string
  /** Mémoire des agents, un dossier par projet, voir `memory/store.ts`. */
  memory: string
  /**
   * Clones des sources de skills, dans le cache et non dans les données : ils se
   * refont d'un rafraîchissement, et la sauvegarde n'a pas à les transporter.
   */
  skillSourcesCache: string
  /** Un `CODEX_HOME` par compte Codex supplémentaire, voir `codex-accounts/homes.ts`. */
  codexAccounts: string
  /** Une connexion par abonnement Claude, pour sa seule jauge, voir `claude-accounts/gauges.ts`. */
  claudeAccounts: string
  webRoot: string
}

/**
 * Le fichier d'exemple et l'usage TOML courant écrivent `max_concurrent_sessions`,
 * mais le schéma est en camelCase. Sans cette passe, les clés snake_case étaient
 * silencieusement ignorées et l'utilisateur tournait sur les défauts en croyant
 * ses réglages appliqués. On accepte donc les deux graphies.
 */
function camelizeKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(camelizeKeys)
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, val]) => [
      key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()),
      camelizeKeys(val),
    ]),
  )
}

function xdg(envVar: string, fallback: string): string {
  const fromEnv = process.env[envVar]
  return fromEnv && fromEnv.length > 0 ? fromEnv : join(homedir(), fallback)
}

function resolvePaths(): Paths {
  const data = process.env.SOLERA_DATA_DIR ?? join(xdg('XDG_DATA_HOME', '.local/share'), 'solera')
  return {
    data,
    database: join(data, 'solera.db'),
    attachments: join(data, 'attachments'),
    agents: join(data, 'agents'),
    worktrees: join(data, 'worktrees'),
    threads: join(data, 'threads'),
    logs: join(data, 'logs'),
    skillLibrary: join(data, 'skill-library'),
    memory: join(data, 'memory'),
    codexAccounts: join(data, 'codex-accounts'),
    claudeAccounts: join(data, 'claude-accounts'),
    // Propre à chaque répertoire de données : deux instances sur une machine (un serveur
    // de test à côté du daemon) ont les mêmes identifiants de sources préconfigurées, et
    // ne doivent pas rafraîchir le même clone en même temps.
    skillSourcesCache: join(
      xdg('XDG_CACHE_HOME', '.cache'),
      'solera',
      createHash('sha256').update(data).digest('hex').slice(0, 12),
      'skill-sources',
    ),
    webRoot: process.env.SOLERA_WEB_ROOT ?? join(import.meta.dirname, '../../web/dist'),
  }
}

/**
 * Un fichier de configuration absent est normal : tous les champs ont un défaut.
 * En revanche un fichier présent mais invalide doit faire échouer le démarrage,
 * sinon on tourne silencieusement avec des réglages que l'utilisateur croit appliqués.
 */
export function loadConfig(): Config {
  const configPath =
    process.env.SOLERA_CONFIG ?? join(xdg('XDG_CONFIG_HOME', '.config'), 'solera/config.toml')

  let raw: unknown = {}
  try {
    raw = parseToml(readFileSync(configPath, 'utf8'))
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw new Error(`Configuration illisible (${configPath}): ${(err as Error).message}`)
    }
  }

  const parsed = configSchema.safeParse(camelizeKeys(raw))
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n')
    throw new Error(`Configuration invalide (${configPath}):\n${issues}`)
  }

  const config = parsed.data

  // En conteneur, écrire un fichier TOML pour changer l'adresse d'écoute est
  // disproportionné : l'image Docker fixe SOLERA_HOST=0.0.0.0 et l'utilisateur
  // ajuste le port par variable d'environnement.
  if (process.env.SOLERA_HOST) config.server.host = process.env.SOLERA_HOST
  if (process.env.SOLERA_PORT) {
    const port = Number(process.env.SOLERA_PORT)
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error(`SOLERA_PORT invalide: ${process.env.SOLERA_PORT}`)
    }
    config.server.port = port
  }

  const paths = resolvePaths()
  return {
    ...config,
    paths,
    sessionCookie: `solera_session_${createHash('sha256').update(paths.data).digest('hex').slice(0, 8)}`,
  }
}
