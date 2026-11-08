import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { bringNewest, dropLinks, keepConversations, mirrorPersonal, type Mirrored } from '../platform/account-home.js'

/**
 * Le `GROK_HOME` d'un compte de Solera, sur le modèle de `CodexAccountHomes` et voir
 * `platform/account-home.ts`.
 *
 * Un dossier par compte, sans aucun lien : la connexion et les caches que Grok remplit
 * d'après elle (catalogue, réglages distants), la configuration de l'utilisateur recopiée
 * sans ses secrets, ses règles globales et ses skills. Sa mémoire (`memory-v2/`) reste
 * celle du compte.
 *
 * Une session se reprend d'un compte à l'autre parce que Solera recopie son dossier
 * (`sessions/<dossier encodé>/<id>/`) au même chemin dans le home qui la reprend. Pas
 * sondé avec un compte connecté : Grok refuse d'ouvrir une session sans connexion.
 */

/** `$GROK_HOME` du serveur, à défaut `~/.grok` : là où vit la connexion du CLI. */
export function userGrokHome(): string {
  return process.env.GROK_HOME || join(homedir(), '.grok')
}

const MIRRORED: Mirrored[] = [
  { name: 'config.toml', kind: 'config' },
  { name: 'rules', kind: 'dir' },
  { name: 'skills', kind: 'dir' },
]

/** Le dossier d'une session sous `root`, ou null. */
export function grokSessionDir(root: string, sessionId: string): string | null {
  // L'identifiant devient un nom de dossier : rien qui sorte de `sessions/`.
  if (!/^[\w-]+$/.test(sessionId)) return null
  const sessions = join(root, 'sessions')
  if (!existsSync(sessions)) return null
  for (const cwd of readdirSync(sessions)) {
    const candidate = join(sessions, cwd, sessionId)
    if (existsSync(candidate) && statSync(candidate).isDirectory()) return candidate
  }
  return null
}

export class GrokAccountHomes {
  constructor(private readonly root: string) {}

  path(accountId: string): string {
    return join(this.root, accountId)
  }

  /**
   * Où vont les conversations des comptes supprimés de l'utilisateur, pour qu'un fil né
   * sur l'un d'eux se reprenne encore sur un autre. Un identifiant de compte est un UUID :
   * le nom ne peut pas en croiser un.
   */
  kept(ownerId: string): string {
    return join(this.root, '_conserve', ownerId)
  }

  /** Les homes où chercher une conversation de l'utilisateur, hors celui du CLI. */
  sources(ownerId: string, accountIds: string[]): string[] {
    return [this.kept(ownerId), ...accountIds.map((id) => this.path(id))]
  }

  /** Met de côté les conversations du compte avant que son home disparaisse. */
  keepConversations(accountId: string, ownerId: string): void {
    keepConversations(this.path(accountId), this.kept(ownerId))
  }

  /** Crée le home s'il manque, et y recopie ce qui vient de l'utilisateur. Rend son chemin. */
  ensure(accountId: string): string {
    const home = this.path(accountId)
    mkdirSync(home, { recursive: true, mode: 0o700 })
    dropLinks(home)
    mirrorPersonal(userGrokHome(), home, MIRRORED)
    return home
  }

  /**
   * Amène dans `home` la dernière version de la session, prise dans `sources` : les homes
   * des autres comptes de l'utilisateur, et celui de la connexion du CLI.
   */
  bringSession(home: string, sessionId: string, sources: string[]): void {
    bringNewest(home, sources, (root) => grokSessionDir(root, sessionId))
  }

  /** Vrai quand le home porte une connexion, c'est-à-dire un `auth.json`. */
  connected(accountId: string): boolean {
    return existsSync(join(this.path(accountId), 'auth.json'))
  }
}
