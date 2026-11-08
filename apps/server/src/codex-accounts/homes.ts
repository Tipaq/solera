import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { bringNewest, dropLinks, mirrorPersonal, type Mirrored } from '../platform/account-home.js'

/**
 * Le `CODEX_HOME` d'un compte de Solera, voir `platform/account-home.ts`.
 *
 * Un dossier par compte, sans aucun lien : `auth.json`, que Codex écrit et rafraîchit
 * lui-même, la configuration de l'utilisateur recopiée sans ses secrets, ses consignes
 * globales et ses skills. Ses mémoires (`memories_1.sqlite`) restent les siennes : Codex
 * en tient une par home, propre au compte.
 *
 * Une conversation se reprend d'un compte à l'autre parce que Solera recopie son fichier
 * (`sessions/AAAA/MM/JJ/rollout-…-<id>.jsonl`) au même chemin dans le home qui la reprend :
 * Codex l'y retrouve, à défaut de l'avoir dans sa base (sondé sur 0.167.0). Un nom ou un
 * chemin différent est refusé.
 */

/** `$CODEX_HOME` du serveur, à défaut `~/.codex` : là où vit la connexion du CLI. */
export function userCodexHome(): string {
  return process.env.CODEX_HOME || join(homedir(), '.codex')
}

const MIRRORED: Mirrored[] = [
  { name: 'config.toml', kind: 'config' },
  { name: 'AGENTS.md', kind: 'file' },
  { name: 'AGENTS.override.md', kind: 'file' },
  { name: 'rules', kind: 'dir' },
  // `.system` : les skills que Codex installe lui-même dans chaque home.
  { name: 'skills', kind: 'dir', skip: ['.system'] },
]

/** Le fichier d'un thread sous `root`, ou null. */
export function codexThreadFile(root: string, threadId: string): string | null {
  const suffix = `-${threadId}.jsonl`
  const sessions = join(root, 'sessions')
  if (!existsSync(sessions)) return null
  // `sessions/AAAA/MM/JJ/rollout-<date>-<id>.jsonl`, du plus récent au plus ancien.
  const down = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
      .reverse()
      .map((name) => join(dir, name))
  for (const year of down(sessions)) {
    for (const month of down(year)) {
      for (const day of down(month)) {
        const found = readdirSync(day).find((name) => name.startsWith('rollout-') && name.endsWith(suffix))
        if (found) return join(day, found)
      }
    }
  }
  return null
}

export class CodexAccountHomes {
  constructor(private readonly root: string) {}

  path(accountId: string): string {
    return join(this.root, accountId)
  }

  /** Crée le home s'il manque, et y recopie ce qui vient de l'utilisateur. Rend son chemin. */
  ensure(accountId: string): string {
    const home = this.path(accountId)
    mkdirSync(home, { recursive: true, mode: 0o700 })
    dropLinks(home)
    mirrorPersonal(userCodexHome(), home, MIRRORED)
    return home
  }

  /**
   * Amène dans `home` la dernière version du thread, prise dans `sources` : les homes des
   * autres comptes de l'utilisateur, et celui de la connexion du CLI.
   */
  bringThread(home: string, threadId: string, sources: string[]): void {
    bringNewest(home, sources, (root) => codexThreadFile(root, threadId))
  }

  /** Vrai quand le home porte une connexion, c'est-à-dire un `auth.json`. */
  connected(accountId: string): boolean {
    return existsSync(join(this.path(accountId), 'auth.json'))
  }
}
