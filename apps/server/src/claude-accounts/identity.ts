import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runAuthCommand } from '../agents/auth.js'
import type { ClaudeAccountStore } from './store.js'

/**
 * L'adresse d'un compte Claude, telle que `claude auth status --json` la rend.
 *
 * Sous le seul jeton de `setup-token`, dans un dossier de configuration vide, le CLI
 * rend bien l'adresse du compte (vérifié par Tim le 7 novembre 2026) : un code suffit
 * donc à nommer un compte. Les fichiers du CLI (`.claude.json`, `.credentials.json`)
 * sont un format interne, on ne les lit pas.
 *
 * La même lecture sert à la jauge, dans son dossier de configuration, pour vérifier
 * qu'`auth login` a autorisé le même compte que le jeton.
 *
 * Null quand le CLI ne dit pas d'adresse : jeton révoqué, réseau absent, sortie
 * illisible. L'appelant n'a pas à distinguer : le compte est à reconnecter.
 */
export type ClaudeIdentify = (source: { token: string } | { configDir: string }) => Promise<string | null>

export function claudeIdentity(binary: () => Promise<string>): ClaudeIdentify {
  return async (source) => {
    // Un dossier vide pour le jeton : le CLI ne doit lire ni la connexion du poste, ni
    // celle d'une jauge, qui passerait devant ou à côté.
    const configDir = 'configDir' in source ? source.configDir : await mkdtemp(join(tmpdir(), 'solera-claude-identity-'))
    try {
      // Vidés, les secrets que le serveur aurait hérités : ils passeraient devant celui lu.
      const env: Record<string, string> = { CLAUDE_CONFIG_DIR: configDir, CLAUDE_CODE_OAUTH_TOKEN: '', ANTHROPIC_API_KEY: '' }
      if ('token' in source) env.CLAUDE_CODE_OAUTH_TOKEN = source.token
      const { stdout } = await runAuthCommand(await binary(), ['auth', 'status', '--json'], env)
      return emailFrom(stdout)
    } catch {
      return null
    } finally {
      if (!('configDir' in source)) await rm(configDir, { recursive: true, force: true })
    }
  }
}

export function emailFrom(stdout: string): string | null {
  try {
    const parsed = JSON.parse(stdout) as { loggedIn?: unknown; email?: unknown }
    if (parsed.loggedIn !== true || typeof parsed.email !== 'string' || !parsed.email.includes('@')) return null
    return parsed.email.trim().toLowerCase()
  } catch {
    return null
  }
}

/**
 * Retrouve l'adresse des abonnements d'avant les adresses, au démarrage et en tâche de
 * fond. L'ancien libellé, devenu alias par la migration, disparaît s'il ne fait que
 * répéter l'adresse. Un jeton qui ne répond pas laisse le compte sans adresse : l'écran
 * propose de le reconnecter. Deux comptes qui se révèlent être le même gardent chacun
 * l'adresse, et l'écran les signale : c'est à l'utilisateur de choisir lequel garder.
 */
export async function backfillClaudeEmails(store: ClaudeAccountStore, identify: ClaudeIdentify): Promise<number> {
  let found = 0
  for (const { ownerId, id } of store.withoutEmail()) {
    let secret
    try {
      secret = store.resolveToken(ownerId, id)
    } catch {
      // Indéchiffrable : rien à lire, le compte reste à reconnecter.
      continue
    }
    if (!secret) continue
    const email = await identify({ token: secret.token })
    if (!email) continue
    const alias = store.find(ownerId, id)?.alias
    store.update(ownerId, id, { email, ...(alias?.trim().toLowerCase() === email ? { alias: null } : {}) })
    found += 1
  }
  return found
}

/**
 * Les jauges d'avant la vérification d'adresse : une connexion `auth login` faite avec un
 * autre compte que celui du jeton n'était qu'un avertissement, et la consommation affichée
 * était celle d'un autre. Une jauge qui mène ailleurs est retirée : l'écran propose alors
 * de la refaire. Une jauge muette (réseau absent, connexion expirée) est laissée : rien ne
 * dit qu'elle est fausse.
 */
export async function checkGauges(store: ClaudeAccountStore, identify: ClaudeIdentify): Promise<string[]> {
  const gauges = store.gauges
  if (!gauges) return []
  const removed: string[] = []
  for (const { id, email } of store.withGauge()) {
    const gaugeEmail = await identify({ configDir: gauges.path(id) })
    if (!gaugeEmail || gaugeEmail === email) continue
    gauges.forget(id)
    removed.push(id)
  }
  return removed
}
