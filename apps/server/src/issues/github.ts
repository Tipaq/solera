import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { IssueAdapterError, type ExternalComment, type ExternalIssue, type IssueAdapter } from './adapter.js'

const run = promisify(execFile)

const GH_TIMEOUT_MS = 20_000
const PER_PAGE = 100

/**
 * Pages lues au plus par passage. Un premier import de mille issues ouvertes se fait en
 * une fois ; au-delà, le curseur reprend au passage suivant.
 */
const MAX_PAGES = 10

/**
 * GitHub, par `gh api` : la machine l'a déjà authentifié pour les sessions, et un jeton
 * enregistré dans Solera passe devant par `GH_TOKEN`, comme pour la revue des PR
 * (`reviews/forge.ts`). Par l'API REST et en polling : ça marche dépôt privé compris,
 * sans adresse publique pour recevoir un webhook.
 */
export const githubIssues: IssueAdapter = {
  provider: 'github',

  async viewer(token) {
    const user = (await api(['user'], token)) as { login?: string }
    return String(user.login ?? '')
  },

  async changedSince(repository, cursor, token) {
    const query = cursor
      ? ['-f', 'state=all', '-f', `since=${cursor}`]
      : ['-f', 'state=open']
    const rows = await pages(`repos/${repository}/issues`, [...query, '-f', 'sort=updated', '-f', 'direction=asc'], token)
    return (
      rows
        // L'API des issues rend aussi les pull requests, qui n'ont rien à faire au board.
        .filter((row) => !row.pull_request)
        .map(toIssue)
    )
  },

  async commentsSince(repository, cursor, token) {
    // `since` filtre sur la date de mise à jour : un vieux commentaire retouché revient,
    // et c'est la date de création qui dit s'il est neuf.
    const rows = await pages(
      `repos/${repository}/issues/comments`,
      ['-f', `since=${cursor}`, '-f', 'sort=created', '-f', 'direction=asc'],
      token,
    )
    return rows.map(toComment).filter((comment) => comment.createdAt > cursor)
  },

  async comments(repository, id, token) {
    return (await pages(`repos/${repository}/issues/${id}/comments`, [], token)).map(toComment)
  },

  async children(repository, id, token) {
    const rows = await pages(`repos/${repository}/issues/${id}/sub_issues`, [], token)
    return rows.map((row) => String(row.number))
  },

  async close(repository, id, reason, token, comment) {
    if (comment) await api(['-X', 'POST', `repos/${repository}/issues/${id}/comments`, '-f', `body=${comment}`], token)
    await api(['-X', 'PATCH', `repos/${repository}/issues/${id}`, '-f', 'state=closed', '-f', `state_reason=${reason}`], token)
  },

  async reopen(repository, id, token) {
    await api(['-X', 'PATCH', `repos/${repository}/issues/${id}`, '-f', 'state=open'], token)
  },
}

type Row = Record<string, unknown>

function toIssue(row: Row): ExternalIssue {
  const summary = row.sub_issues_summary as { total?: number } | undefined
  return {
    id: String(row.number),
    url: String(row.html_url ?? ''),
    title: String(row.title ?? ''),
    body: String(row.body ?? ''),
    state: row.state === 'closed' ? 'closed' : 'open',
    author: login(row),
    updatedAt: String(row.updated_at ?? ''),
    hasChildren: (summary?.total ?? 0) > 0,
  }
}

function toComment(row: Row): ExternalComment {
  return {
    id: String(row.id),
    issueId: /\/issues\/(\d+)$/.exec(String(row.issue_url ?? ''))?.[1] ?? '',
    author: login(row),
    body: String(row.body ?? ''),
    url: String(row.html_url ?? ''),
    createdAt: String(row.created_at ?? ''),
  }
}

const login = (row: Row) => String((row.user as { login?: string } | undefined)?.login ?? '')

/** Lit page après page jusqu'à une page incomplète, ou `MAX_PAGES`. */
async function pages(path: string, query: string[], token?: string): Promise<Row[]> {
  const rows: Row[] = []
  for (let page = 1; page <= MAX_PAGES; page++) {
    const batch = await api(['-X', 'GET', path, ...query, '-f', `per_page=${PER_PAGE}`, '-f', `page=${page}`], token)
    if (!Array.isArray(batch)) throw new IssueAdapterError(`GitHub a rendu autre chose qu'une liste pour ${path}.`)
    rows.push(...(batch as Row[]))
    if (batch.length < PER_PAGE) break
  }
  return rows
}

async function api(args: string[], token?: string): Promise<unknown> {
  try {
    const { stdout } = await run('gh', ['api', ...args], {
      timeout: GH_TIMEOUT_MS,
      maxBuffer: 32 * 1024 * 1024,
      env: { ...process.env, GH_PROMPT_DISABLED: '1', ...(token ? { GH_TOKEN: token } : {}) },
    })
    return stdout.trim() ? JSON.parse(stdout) : null
  } catch (err) {
    if ((err as { code?: string }).code === 'ENOENT') {
      throw new IssueAdapterError("`gh` n'est pas installé sur la machine du serveur : Solera ne peut pas lire GitHub.")
    }
    const stderr = (err as { stderr?: string }).stderr?.trim()
    throw new IssueAdapterError(stderr?.split('\n')[0] || (err instanceof Error ? err.message : String(err)))
  }
}
