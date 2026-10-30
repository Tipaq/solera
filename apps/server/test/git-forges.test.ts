import assert from 'node:assert/strict'
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { fileURLToPath } from 'node:url'
import Fastify from 'fastify'
import { eq } from 'drizzle-orm'
import { openDatabase, runMigrations, users } from '@solera/db'
import { tokenCreationUrl, type GitCredentialListDto, type GitRepoListDto } from '@solera/protocol'
import { RepoCatalog } from '../src/git-credentials/catalog.js'
import { ForgeClient, type ApiBase } from '../src/git-credentials/forges.js'
import { GitCredentialStore } from '../src/git-credentials/store.js'
import { registerErrorHandler } from '../src/http/errors.js'
import { registerGitCredentialRoutes } from '../src/http/routes/git-credentials.js'
import { encryptValue, loadOrCreateKey } from '../src/secrets/cipher.js'

/**
 * Accès git par forge : le jeton vérifié auprès de GitHub ou de GitLab avant d'être
 * enregistré, la liste des dépôts GitLab, et les lignes d'avant le choix de la forge.
 *
 * Aucune forge réelle n'est appelée : l'adresse de l'API est injectée et pointe vers un
 * faux serveur local qui imite les deux.
 */

const MIGRATIONS = fileURLToPath(new URL('../../../packages/db/migrations', import.meta.url))

const GOOD = 'glpat-bon'

/** Cent cinquante projets : deux pages, la seconde incomplète. */
const PROJECTS = Array.from({ length: 150 }, (_, index) => ({
  path_with_namespace: `equipe/projet-${index}`,
  path: `projet-${index}`,
  name: `Projet ${index}`,
  http_url_to_repo: `https://gitlab.entreprise.fr/equipe/projet-${index}.git`,
  visibility: index === 0 ? 'public' : 'private',
  description: index === 1 ? 'Le site' : '',
  last_activity_at: '2026-10-01T00:00:00Z',
}))

interface FakeForge {
  base: string
  /** Les chemins demandés, requête comprise, dans l'ordre. */
  calls: string[]
}

/**
 * Le faux serveur : `/github/…` répond comme api.github.com, `/gitlab/<hôte>/api/v4/…`
 * comme une GitLab. `/hang/…` ne répond jamais, pour le délai.
 */
async function fakeForge(t: TestContext): Promise<FakeForge> {
  const calls: string[] = []
  const json = (res: ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json' })
    res.end(JSON.stringify(body))
  }
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://local')
    calls.push(`${url.pathname}${url.search}`)
    if (url.pathname.startsWith('/hang/')) return

    if (req.headers.authorization !== `Bearer ${GOOD}`) return json(res, 401, { message: 'Bad credentials' })

    if (url.pathname === '/github/user') return json(res, 200, { login: 'octocat' })
    if (url.pathname === '/gitlab/gitlab.entreprise.fr/api/v4/user') return json(res, 200, { username: 'jdupont' })
    if (url.pathname === '/gitlab/gitlab.entreprise.fr/api/v4/projects') {
      const page = Number(url.searchParams.get('page'))
      const perPage = Number(url.searchParams.get('per_page'))
      return json(res, 200, PROJECTS.slice((page - 1) * perPage, page * perPage))
    }
    // Une adresse qui n'est pas une GitLab : une page HTML, comme un portail d'entreprise.
    res.writeHead(404, { 'content-type': 'text/html' })
    res.end('<html>Not Found</html>')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => {
    server.closeAllConnections()
    server.close()
  })
  return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, calls }
}

async function harness(t: TestContext, options: { apiBase?: ApiBase; timeoutMs?: number } = {}) {
  const forge = await fakeForge(t)
  const dir = await mkdtemp(join(tmpdir(), 'solera-forges-'))
  t.after(() => rm(dir, { recursive: true, force: true }))

  const { db, sqlite } = openDatabase(join(dir, 'solera.db'))
  t.after(() => sqlite.close())
  runMigrations(db, MIGRATIONS)
  db.insert(users).values({ id: 'owner', username: 'owner', displayName: 'owner', passwordHash: '', createdAt: 1 }).run()

  const store = new GitCredentialStore(db, loadOrCreateKey(dir))
  const client = new ForgeClient({
    apiBase:
      options.apiBase ??
      ((kind, host) => (kind === 'github' ? `${forge.base}/github` : `${forge.base}/gitlab/${host}/api/v4`)),
    timeoutMs: options.timeoutMs,
  })

  const app = Fastify()
  app.addHook('preHandler', async (request) => {
    request.user = db.select().from(users).where(eq(users.id, 'owner')).get()
  })
  registerErrorHandler(app)
  registerGitCredentialRoutes(app, store, new RepoCatalog(client), client)
  t.after(() => app.close())

  const put = async (body: unknown) => {
    const response = await app.inject({ method: 'PUT', url: '/api/git-credentials', payload: body as object })
    return { status: response.statusCode, body: response.body ? (response.json() as { error?: { code: string; params?: Record<string, unknown> } }) : null }
  }
  const list = async () =>
    (await app.inject({ method: 'GET', url: '/api/git-credentials' })).json() as GitCredentialListDto
  const repos = async (host: string, q = '') => {
    const response = await app.inject({ method: 'GET', url: `/api/git-credentials/${host}/repos?q=${encodeURIComponent(q)}` })
    return { status: response.statusCode, body: response.json() as GitRepoListDto & { error?: { code: string } } }
  }
  return { forge, store, put, list, repos }
}

test('GitHub : le jeton accepté est enregistré sous x-access-token, avec le login reconnu', async (t) => {
  const { put, list, store } = await harness(t)

  assert.equal((await put({ forge: 'github', token: GOOD })).status, 204)

  const [credential] = (await list()).credentials
  assert.deepEqual(
    { host: credential?.host, username: credential?.username, forge: credential?.forge, login: credential?.login },
    { host: 'github.com', username: 'x-access-token', forge: 'github', login: 'octocat' },
  )
  assert.equal(store.resolve('owner', 'github.com')?.token, GOOD)
})

test('GitLab auto-hébergée : le jeton accepté est enregistré sous oauth2, avec le login reconnu', async (t) => {
  const { put, list, store } = await harness(t)

  assert.equal((await put({ forge: 'gitlab', host: 'gitlab.entreprise.fr', token: `  ${GOOD}\n` })).status, 204)

  const [credential] = (await list()).credentials
  assert.equal(credential?.host, 'gitlab.entreprise.fr')
  assert.equal(credential?.username, 'oauth2')
  assert.equal(credential?.login, 'jdupont')
  // Le retour à la ligne d'un copier-coller ne finit pas dans le mot de passe de git.
  assert.equal(store.resolve('owner', 'gitlab.entreprise.fr')?.token, GOOD)
})

test('un jeton refusé par la forge ne s’enregistre pas, et le dit', async (t) => {
  const { put, list } = await harness(t)

  const github = await put({ forge: 'github', token: 'ghp_faux' })
  assert.equal(github.status, 400)
  assert.equal(github.body?.error?.code, 'git_forge_token_rejected')

  const gitlab = await put({ forge: 'gitlab', host: 'gitlab.entreprise.fr', token: 'glpat-faux' })
  assert.equal(gitlab.body?.error?.code, 'git_forge_token_rejected')

  assert.deepEqual((await list()).credentials, [])
})

test('une adresse qui n’est pas une GitLab se distingue d’un jeton refusé', async (t) => {
  const { put, list } = await harness(t)

  const response = await put({ forge: 'gitlab', host: 'intranet.entreprise.fr', token: GOOD })
  assert.equal(response.status, 400)
  assert.equal(response.body?.error?.code, 'git_forge_api_missing')
  assert.equal(response.body?.error?.params?.host, 'intranet.entreprise.fr')
  assert.deepEqual((await list()).credentials, [])
})

test('une GitLab injoignable depuis le serveur le dit, sans rien enregistrer', async (t) => {
  // Un port fermé : la connexion est refusée avant toute réponse.
  const closed = createServer()
  await new Promise<void>((resolve) => closed.listen(0, '127.0.0.1', resolve))
  const port = (closed.address() as AddressInfo).port
  await new Promise<void>((resolve) => closed.close(() => resolve()))

  const { put, list } = await harness(t, { apiBase: () => `http://127.0.0.1:${port}/api/v4` })
  const response = await put({ forge: 'gitlab', host: 'gitlab.entreprise.fr', token: GOOD })
  assert.equal(response.status, 502)
  assert.equal(response.body?.error?.code, 'git_forge_offline')
  assert.equal(response.body?.error?.params?.host, 'gitlab.entreprise.fr')
  assert.equal(response.body?.error?.params?.reason, 'ECONNREFUSED')
  assert.deepEqual((await list()).credentials, [])
})

test('une forge qui ne répond pas est abandonnée au bout du délai', async (t) => {
  let base = ''
  const { forge, put } = await harness(t, { apiBase: () => base, timeoutMs: 200 })
  base = `${forge.base}/hang`

  const started = Date.now()
  const response = await put({ forge: 'github', token: GOOD })
  assert.equal(response.status, 502)
  assert.equal(response.body?.error?.code, 'git_forge_timeout')
  assert.ok(Date.now() - started < 5_000)
})

test('autre forge : ni vérification ni login, le nom d’utilisateur saisi est gardé', async (t) => {
  const { forge, put, list } = await harness(t)

  assert.equal((await put({ forge: 'other', host: 'codeberg.org', username: 'moi', token: 'quelconque' })).status, 204)
  // Un corps d'avant le choix de la forge se lit comme une forge inconnue.
  assert.equal((await put({ host: 'gitea.maison.lan', username: 'moi', token: 'quelconque' })).status, 204)

  assert.deepEqual(
    (await list()).credentials.map(({ host, forge: kind, login, username }) => ({ host, forge: kind, login, username })),
    [
      { host: 'codeberg.org', forge: 'other', login: null, username: 'moi' },
      { host: 'gitea.maison.lan', forge: 'other', login: null, username: 'moi' },
    ],
  )
  assert.deepEqual(forge.calls, [])
})

test('GitLab : la liste des projets est paginée, mise en cache, et filtrée', async (t) => {
  const { forge, put, repos } = await harness(t)
  await put({ forge: 'gitlab', host: 'gitlab.entreprise.fr', token: GOOD })
  forge.calls.length = 0

  const first = await repos('gitlab.entreprise.fr')
  assert.equal(first.status, 200)
  assert.equal(first.body.truncated, false)
  // Sans requête, les cinquante premiers, dans l'ordre de la forge.
  assert.equal(first.body.repos.length, 50)
  assert.deepEqual(first.body.repos[0], {
    fullName: 'equipe/projet-0',
    name: 'projet-0',
    cloneUrl: 'https://gitlab.entreprise.fr/equipe/projet-0.git',
    isPrivate: false,
    description: null,
    pushedAt: Date.parse('2026-10-01T00:00:00Z'),
  })
  assert.equal(first.body.repos[1]?.isPrivate, true)
  assert.equal(first.body.repos[1]?.description, 'Le site')

  const projectCalls = forge.calls.filter((call) => call.includes('/projects'))
  assert.equal(projectCalls.length, 2)
  const query = new URL(projectCalls[0] ?? '', 'http://local').searchParams
  assert.equal(query.get('membership'), 'true')
  assert.equal(query.get('per_page'), '100')
  assert.equal(query.get('order_by'), 'last_activity_at')

  // Le projet 149 n'est que sur la seconde page, et le cache répond sans rappeler la forge.
  const filtered = await repos('gitlab.entreprise.fr', 'projet-149')
  assert.equal(filtered.body.repos[0]?.fullName, 'equipe/projet-149')
  assert.equal(forge.calls.filter((call) => call.includes('/projects')).length, 2)
})

test('la liste des dépôts est refusée pour une autre forge', async (t) => {
  const { put, repos } = await harness(t)
  await put({ forge: 'other', host: 'codeberg.org', username: 'moi', token: 'x' })

  const response = await repos('codeberg.org')
  assert.equal(response.status, 400)
  assert.equal(response.body.error?.code, 'git_repo_listing_unsupported')
})

test('la page de création du jeton est pré-remplie par forge', () => {
  assert.equal(tokenCreationUrl('github', 'github.com'), 'https://github.com/settings/tokens/new?description=Solera&scopes=repo')
  assert.equal(
    tokenCreationUrl('gitlab', 'gitlab.com'),
    'https://gitlab.com/-/user_settings/personal_access_tokens?name=Solera&scopes=read_api,write_repository',
  )
  assert.equal(
    tokenCreationUrl('gitlab', 'gitlab.entreprise.fr'),
    'https://gitlab.entreprise.fr/-/user_settings/personal_access_tokens?name=Solera&scopes=read_api,write_repository',
  )
  assert.equal(tokenCreationUrl('other', 'codeberg.org'), null)
})

/** Le dossier des migrations, arrêté juste avant `tag` : une base d'avant. */
async function migrationsBefore(dir: string, tag: string): Promise<string> {
  const folder = join(dir, 'migrations')
  await cp(MIGRATIONS, folder, { recursive: true })
  const journalPath = join(folder, 'meta', '_journal.json')
  const journal = JSON.parse(await readFile(journalPath, 'utf8')) as { entries: { tag: string }[] }
  const cut = journal.entries.findIndex((entry) => entry.tag === tag)
  assert.notEqual(cut, -1, `migration ${tag} introuvable`)
  const kept = journal.entries.slice(0, cut)
  await writeFile(journalPath, JSON.stringify({ ...journal, entries: kept }, null, 2))
  for (const name of await readdir(folder)) {
    if (name.endsWith('.sql') && !kept.some((entry) => `${entry.tag}.sql` === name)) await rm(join(folder, name))
  }
  return folder
}

test('les accès d’avant le choix de la forge restent lisibles, leur forge déduite de l’hôte', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'solera-forges-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const file = join(dir, 'solera.db')
  const key = loadOrCreateKey(dir)

  const first = openDatabase(file)
  runMigrations(first.db, await migrationsBefore(dir, '0066_acces_git_par_forge'))
  first.sqlite.exec(`INSERT INTO users (id, username, display_name, password_hash, is_admin, created_at) VALUES ('owner', 'owner', 'owner', '', 0, 1)`)
  const insert = first.sqlite.prepare(
    `INSERT INTO git_credentials (id, owner_id, host, username, ciphertext, iv, auth_tag, created_at, updated_at)
     VALUES (?, 'owner', ?, ?, ?, ?, ?, 1, 2)`,
  )
  for (const [id, host, username] of [
    ['a', 'github.com', 'x-access-token'],
    ['b', 'gitlab.com', 'oauth2'],
    ['c', 'gitea.maison.lan', 'moi'],
  ] as const) {
    const encrypted = encryptValue(key, `jeton-${id}`)
    insert.run(id, host, username, encrypted.ciphertext, encrypted.iv, encrypted.authTag)
  }
  first.sqlite.close()

  const { db, sqlite } = openDatabase(file)
  t.after(() => sqlite.close())
  runMigrations(db, MIGRATIONS)
  const store = new GitCredentialStore(db, key)

  assert.deepEqual(
    store.list('owner').map(({ host, username, forge, login }) => ({ host, username, forge, login })),
    [
      { host: 'gitea.maison.lan', username: 'moi', forge: 'other', login: null },
      { host: 'github.com', username: 'x-access-token', forge: 'github', login: null },
      { host: 'gitlab.com', username: 'oauth2', forge: 'gitlab', login: null },
    ],
  )
  assert.deepEqual(store.resolve('owner', 'gitlab.com'), { username: 'oauth2', token: 'jeton-b', forge: 'gitlab' })
})
