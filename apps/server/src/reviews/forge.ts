import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)

/** `gh` interroge l'API : plus lent qu'un git local, mais une seule requête. */
const GH_TIMEOUT_MS = 20_000

/** Ce que la revue lit d'une PR, et rien de plus. */
export interface PullRequest {
  number: number
  url: string
  /** La branche proposée. */
  head: string
  /** Le dernier commit de la branche sur la forge. */
  headSha: string
  /** La branche visée. */
  base: string
  state: 'OPEN' | 'CLOSED' | 'MERGED'
}

/**
 * La forge, vue de la revue : lire une PR depuis l'arbre qui la porte.
 *
 * Une interface et non un appel direct, pour que les tests n'aient pas besoin de GitHub.
 */
export interface Forge {
  /** `ref` : un numéro ou une URL de PR, comme `gh pr view` les accepte. */
  readPullRequest(cwd: string, ref: string, token?: string): Promise<PullRequest>
  /**
   * Fusionne en squash, à condition que la PR soit toujours au commit relu. **Ne
   * supprime jamais la branche** : son worktree disparaîtrait sous la session qui y vit.
   */
  mergePullRequest(cwd: string, number: number, headSha: string, token?: string): Promise<void>
  /** Ouvre une PR d'une branche déjà poussée ; rend son numéro et son adresse. */
  createPullRequest(
    cwd: string,
    pr: { head: string; base: string; title: string; body: string },
    token?: string,
  ): Promise<{ number: number; url: string }>
}

/** Refus lisible par l'agent : la forge n'a pas pu répondre, ou la PR n'est pas là. */
export class ForgeError extends Error {}

/**
 * Par `gh`, que la machine a déjà authentifié pour les sessions : le serveur tourne sous
 * le même compte qu'elles. Un jeton GitHub enregistré dans Solera passe devant, par
 * `GH_TOKEN`, pour une instance où `gh` n'est pas connecté.
 *
 * Par la forge plutôt que par ce que l'agent affirme : c'est elle qui dit que la PR
 * existe, sur quelle branche, vers laquelle, et jusqu'à quel commit elle a été poussée.
 */
export const ghForge: Forge = {
  async readPullRequest(cwd, ref, token) {
    try {
      const { stdout } = await gh(cwd, ['pr', 'view', ref, '--json', 'number,url,headRefName,headRefOid,baseRefName,state'], token)
      const value = JSON.parse(stdout) as Record<string, unknown>
      return {
        number: Number(value.number),
        url: String(value.url ?? ''),
        head: String(value.headRefName ?? ''),
        headSha: String(value.headRefOid ?? ''),
        base: String(value.baseRefName ?? ''),
        state: value.state === 'MERGED' ? 'MERGED' : value.state === 'CLOSED' ? 'CLOSED' : 'OPEN',
      }
    } catch (err) {
      throw forgeError(err, `Solera n'a pas pu lire la PR « ${ref} »`)
    }
  },

  async mergePullRequest(cwd, number, headSha, token) {
    try {
      await gh(cwd, ['pr', 'merge', String(number), '--squash', '--match-head-commit', headSha], token)
    } catch (err) {
      throw forgeError(err, `Solera n'a pas pu fusionner la PR #${number}`)
    }
  },

  async createPullRequest(cwd, pr, token) {
    let stdout: string
    try {
      ;({ stdout } = await gh(
        cwd,
        ['pr', 'create', '--head', pr.head, '--base', pr.base, '--title', pr.title, '--body', pr.body],
        token,
      ))
    } catch (err) {
      throw forgeError(err, `Solera n'a pas pu ouvrir la PR de \`${pr.head}\``)
    }
    // `gh pr create` écrit l'adresse de la PR en dernière ligne.
    const url = stdout.trim().split('\n').at(-1)?.trim() ?? ''
    const number = Number(/\/pull\/(\d+)/.exec(url)?.[1])
    if (!Number.isInteger(number)) throw new ForgeError(`PR de \`${pr.head}\` ouverte, mais son adresse est illisible : « ${url} ».`)
    return { number, url }
  },
}

function gh(cwd: string, args: string[], token?: string) {
  return run('gh', args, {
    cwd,
    timeout: GH_TIMEOUT_MS,
    env: { ...process.env, GH_PROMPT_DISABLED: '1', ...(token ? { GH_TOKEN: token } : {}) },
  })
}

function forgeError(err: unknown, what: string): ForgeError {
  const stderr = (err as { stderr?: string }).stderr?.trim()
  if ((err as { code?: string }).code === 'ENOENT') {
    return new ForgeError("`gh` n'est pas installé sur la machine du serveur : Solera ne peut pas parler à la forge.")
  }
  return new ForgeError(`${what} : ${stderr?.split('\n')[0] || (err instanceof Error ? err.message : String(err))}`)
}
