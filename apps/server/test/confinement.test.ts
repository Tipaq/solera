import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { HOST_CONFINED_ENVIRONMENT } from '@solera/protocol'
import { anchorArgs, bwrapBackend, probeBwrap } from '../src/environments/confined/bwrap.js'
import { ConfinedEnvironment } from '../src/environments/confined/confined.js'
import { gitMounts } from '../src/environments/confined/git.js'
import { hostToolchain, installRootOf } from '../src/environments/confined/paths.js'
import { confinedEnv, confinementPlan } from '../src/environments/confined/plan.js'
import { sessionScope, terminalScope } from '../src/environments/confined/scope.js'
import { seatbeltPolicy } from '../src/environments/confined/seatbelt.js'
import { EnvironmentUnavailableError } from '../src/environments/provider.js'

const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' })

/** Un dépôt d'un commit et un worktree lié, sous le home : là où vivent ceux de Solera. */
async function repoWithWorktree(t: TestContext) {
  const base = await realpath(await mkdtemp(join(homedir(), '.solera-confinement-test-')))
  t.after(() => rm(base, { recursive: true, force: true }))
  const repo = join(base, 'repo')
  const worktree = join(base, 'worktree')
  await mkdir(repo)
  git(repo, 'init', '-q')
  git(repo, 'config', 'user.name', 'Tim')
  git(repo, 'config', 'user.email', 'tim@example.com')
  await writeFile(join(repo, 'a'), 'a')
  git(repo, 'add', '.')
  git(repo, 'commit', '-qm', 'a')
  git(repo, 'worktree', 'add', '-q', worktree)
  return { base, repo, worktree }
}

test('git : un worktree écrit dans le dépôt commun, mais ni sa config, ni ses hooks, ni son pointeur', async (t) => {
  const { repo, worktree } = await repoWithWorktree(t)
  const mounts = gitMounts(worktree)
  const common = join(repo, '.git')
  assert.deepEqual(mounts.writable, [common])
  assert.ok(mounts.protected.includes(join(worktree, '.git')))
  for (const name of ['config', 'hooks', 'info']) assert.ok(mounts.protected.includes(join(common, name)), name)
  assert.ok(mounts.protected.some((path) => path.endsWith('/commondir')))

  // Un dépôt simple : son `.git` est déjà dans le dossier de travail.
  assert.deepEqual(gitMounts(repo), { writable: [], protected: ['config', 'hooks', 'info'].map((name) => join(common, name)) })
  assert.deepEqual(gitMounts(tmpdir()), { writable: [], protected: [] })
})

test('plan : le dossier de travail et git inscriptibles, les fichiers de contrôle protégés', async (t) => {
  const { repo, worktree } = await repoWithWorktree(t)
  const plan = confinementPlan({
    scope: { ...terminalScope(worktree), readable: [join(worktree, 'a-l-interieur'), '/absent'] },
    path: '/usr/bin',
    home: homedir(),
    coveredRoots: ['/usr'],
    deniedRoots: [],
  })
  assert.deepEqual(plan.writable, [worktree, join(repo, '.git')])
  assert.ok(plan.protected.includes(join(repo, '.git', 'hooks')))
  assert.deepEqual(plan.readable, [], 'un chemin absent, ou déjà inscriptible, ne se remonte pas')
  assert.equal(plan.env.GIT_AUTHOR_NAME, 'Tim')
  assert.equal(plan.env.GIT_COMMITTER_EMAIL, 'tim@example.com')
})

test("chaîne d'outils : jamais le home ni ses ancêtres, et le paquet entier d'un CLI npm", async (t) => {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'solera-toolchain-')))
  t.after(() => rm(base, { recursive: true, force: true }))
  const home = join(base, 'home')
  const bin = join(home, '.local', 'bin')
  const pkg = join(home, '.nvm', 'lib', 'node_modules', 'codex')
  await mkdir(join(pkg, 'bin'), { recursive: true })
  await mkdir(bin, { recursive: true })
  await writeFile(join(pkg, 'package.json'), '{}')
  await writeFile(join(pkg, 'bin', 'codex.js'), '')
  await symlink(join(pkg, 'bin', 'codex.js'), join(bin, 'codex'))
  assert.equal(installRootOf(join(pkg, 'bin', 'codex.js'), home), pkg)

  const toolchain = hostToolchain({ path: [home, base, '/', bin, '/usr/bin'].join(':'), home, coveredRoots: ['/usr'], deniedRoots: [] })
  assert.deepEqual(toolchain.pathEntries, [bin, '/usr/bin'])
  assert.deepEqual(toolchain.readableDirs.sort(), [bin, pkg].sort())

  const denied = hostToolchain({ path: `/mnt/c/Windows:${bin}`, home, coveredRoots: [], deniedRoots: ['/mnt'] })
  assert.deepEqual(denied.pathEntries, [bin])
})

test("variables : ce que Solera ajoute passe, l'environnement du serveur et ses sockets non", () => {
  const host = { PATH: '/usr/bin', GH_TOKEN: 'secret', LANG: 'fr_FR.UTF-8', LC_ALL: 'C', SSH_AUTH_SOCK: '/run/ssh' }
  const env = confinedEnv(
    { ...host, CLAUDE_CODE_OAUTH_TOKEN: 'token', SOLERA_PROJECT_ID: 'p', SSH_AUTH_SOCK: '/autre' },
    host,
    { HOME: '/home/agent' },
  )
  assert.deepEqual(env, {
    LANG: 'fr_FR.UTF-8',
    LC_ALL: 'C',
    CLAUDE_CODE_OAUTH_TOKEN: 'token',
    SOLERA_PROJECT_ID: 'p',
    HOME: '/home/agent',
  })
  assert.deepEqual(confinedEnv(undefined, host, {}), { LANG: 'fr_FR.UTF-8', LC_ALL: 'C' })
})

test('bwrap : chaque dossier entre un fichier protégé et sa racine inscriptible est ancré', () => {
  assert.deepEqual(anchorArgs(['/r'], ['/r/.git/worktrees/w/commondir', '/r/.git/hooks']), [
    '--bind', '/r/.git', '/r/.git',
    '--bind', '/r/.git/worktrees', '/r/.git/worktrees',
    '--bind', '/r/.git/worktrees/w', '/r/.git/worktrees/w',
  ])
})

test('seatbelt : refus par défaut, aucun chemin dans le texte du profil, les fichiers de git protégés en dernier', () => {
  const policy = seatbeltPolicy({
    readable: ['/usr'],
    writable: ['/Users/tim/projet "x"'],
    protected: ['/Users/tim/projet "x"/.git/hooks'],
    hostHome: '/Users/tim',
  })
  assert.match(policy.profile, /^\(version 1\)\n\(deny default\)/u)
  assert.ok(!policy.profile.includes('/Users/tim'), 'les chemins passent par -D')
  assert.ok(policy.params.some(([, value]) => value === '/Users/tim/.docker'))
  const protectedKey = policy.params.find(([key, value]) => key.startsWith('PROTECTED') && value.endsWith('/hooks'))?.[0]
  assert.ok(protectedKey)
  const deny = policy.profile.indexOf(`(deny file-write* (subpath (param "${protectedKey}")))`)
  assert.ok(deny > policy.profile.indexOf('file-read* file-write* file-map-executable'))
})

test('portée de session : un compte est exigé, OpenCode refusé, les transcripts de Claude survivent au home privé', async (t) => {
  const { worktree } = await repoWithWorktree(t)
  const base = { cwd: worktree, workTrees: [], memoryDir: null, attachmentsRoot: '/tmp', skillRoots: [], prototypesDir: null }
  const refusal = (code: string) => (err: unknown) =>
    err instanceof EnvironmentUnavailableError && err.code === code && err.params?.environment === 'host.confined'
  assert.throws(() => sessionScope({ ...base, agent: 'opencode', accountEnv: {} }), refusal('confinement_agent_unsupported'))
  assert.throws(() => sessionScope({ ...base, agent: 'claude', accountEnv: {} }), refusal('confinement_account_required'))
  assert.throws(() => sessionScope({ ...base, agent: 'codex', accountEnv: {} }), refusal('confinement_account_required'))

  const codex = sessionScope({ ...base, agent: 'codex', accountEnv: { CODEX_HOME: '/data/codex-accounts/a' } })
  assert.ok(codex.writable.includes('/data/codex-accounts/a'))

  const claudeDir = await mkdtemp(join(tmpdir(), 'solera-claude-config-'))
  t.after(() => rm(claudeDir, { recursive: true, force: true }))
  await writeFile(join(claudeDir, 'CLAUDE.md'), 'consignes')
  const previous = process.env.CLAUDE_CONFIG_DIR
  process.env.CLAUDE_CONFIG_DIR = claudeDir
  t.after(() => (previous === undefined ? delete process.env.CLAUDE_CONFIG_DIR : (process.env.CLAUDE_CONFIG_DIR = previous)))
  const claude = sessionScope({ ...base, agent: 'claude', accountEnv: { CLAUDE_CODE_OAUTH_TOKEN: 't' } })
  const transcripts = join(claudeDir, 'projects', worktree.replace(/[^a-zA-Z0-9]/g, '-'))
  assert.ok(existsSync(transcripts))
  assert.ok(claude.writable.includes(transcripts))
  assert.deepEqual(claude.homeLinks, [
    { path: join('.claude', 'projects', transcripts.split('/').at(-1)!), target: transcripts },
    { path: join('.claude', 'CLAUDE.md'), target: join(claudeDir, 'CLAUDE.md') },
  ])
  assert.ok(claude.readable.includes(join(claudeDir, 'CLAUDE.md')))
  assert.ok(!claude.readable.some((path) => path.endsWith('.credentials.json')))
})

const bwrapUsable = process.platform === 'linux' && probeBwrap() === null

test('bwrap, pour de vrai : écrire et commiter dans le worktree, rien d’autre, et tout tuer à la fermeture', { skip: !bwrapUsable && 'bwrap indisponible ici' }, async (t) => {
  const { repo, worktree } = await repoWithWorktree(t)
  const environment = new ConfinedEnvironment(bwrapBackend, terminalScope(worktree))
  t.after(() => environment.close())
  assert.deepEqual(environment.environment, HOST_CONFINED_ENVIRONMENT)
  const sh = async (script: string) => {
    const result = await environment.exec({ command: 'sh', args: ['-c', script], cwd: worktree, timeoutMs: 20_000 })
    return { ...result, stdout: result.stdout.trim() }
  }

  assert.equal((await sh('echo b > b && git add b && git commit -qm b && git log --format=%an -1')).stdout, 'Tim')
  assert.equal(git(worktree, 'log', '--format=%s', '-1'), 'b\n', 'le commit est sur l’hôte')
  assert.notEqual((await sh('git config core.fsmonitor "touch /tmp/pwned"')).code, 0, '.git/config en lecture seule')
  assert.notEqual((await sh(`echo x > ${repo}/.git/hooks/pre-commit`)).code, 0, 'hooks en lecture seule')
  assert.notEqual((await sh(`mv ${repo}/.git/hooks ${repo}/.git/ailleurs`)).code, 0, 'hooks inamovibles')
  assert.notEqual((await sh('echo x > .git')).code, 0, 'pointeur du worktree en lecture seule')
  assert.equal(await readFile(join(repo, '.git', 'config'), 'utf8').then((text) => text.includes('fsmonitor')), false)

  assert.equal((await sh('echo $HOME')).stdout, '/home/agent')
  // Les identifiants de l'hôte et les données de Solera, présents ou non sur cette machine.
  const hidden = ['.ssh', '.claude', '.codex', '.grok', '.config/gh', '.gitconfig', '.local/share/solera/solera.db', '.local/share/solera/secret.key']
  for (const name of hidden) {
    assert.notEqual((await sh(`test -e ${join(homedir(), name)}`)).code, 0, `${name} est caché`)
  }
  assert.notEqual((await sh(`echo x > ${join(homedir(), '.solera-pwned')}`)).code, 0)
  assert.equal(existsSync(join(homedir(), '.solera-pwned')), false)

  environment.spawn({ command: 'sh', args: ['-c', 'sleep 3141 & sleep 3142 & wait'], cwd: worktree })
  await new Promise((resolve) => setTimeout(resolve, 500))
  const sleeping = () => execFileSync('sh', ['-c', 'pgrep -a -x sleep | grep -c "sleep 314[12]" || true'], { encoding: 'utf8' }).trim()
  assert.equal(sleeping(), '2')
  const privateRoot = (environment as unknown as { dirs: { root: string } }).dirs.root
  assert.ok(existsSync(privateRoot))
  await environment.close()
  await new Promise((resolve) => setTimeout(resolve, 300))
  assert.equal(sleeping(), '0', 'tout ce que la session a lancé est mort')
  assert.equal(existsSync(privateRoot), false, 'le home et le tmp privés sont effacés')
})
