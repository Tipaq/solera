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

test('git : un worktree n’écrit que ses objets, ses refs, ses journaux et son propre dossier', async (t) => {
  const { repo, worktree } = await repoWithWorktree(t)
  const mounts = gitMounts(worktree)
  const common = join(repo, '.git')
  const admin = join(common, 'worktrees', 'worktree')
  assert.deepEqual(mounts.readable, [common])
  assert.deepEqual(mounts.writable, [join(common, 'objects'), join(common, 'refs'), join(common, 'logs'), admin])
  assert.deepEqual(mounts.protected, [
    join(worktree, '.git'),
    join(admin, 'commondir'),
    join(admin, 'gitdir'),
    join(admin, 'config.worktree'),
  ])

  // Un dépôt simple : son `.git` en entier, en lecture seule.
  assert.deepEqual(gitMounts(repo), { readable: [], writable: [], protected: [common] })

  // Hors dépôt : un `.git` vide, protégé, que la fermeture retirera.
  const loose = await realpath(await mkdtemp(join(tmpdir(), 'solera-loose-')))
  t.after(() => rm(loose, { recursive: true, force: true }))
  assert.deepEqual(gitMounts(loose), { readable: [], writable: [], protected: [join(loose, '.git')], placeholder: join(loose, '.git') })
  // Un sous-dossier de dépôt n'en reçoit pas : la portée le refuse.
  await mkdir(join(repo, 'sous'))
  assert.deepEqual(gitMounts(join(repo, 'sous')), { readable: [], writable: [], protected: [] })
  assert.throws(() => terminalScope(join(repo, 'sous')), (err: unknown) =>
    err instanceof EnvironmentUnavailableError && err.code === 'confinement_subfolder')
})

test('git : `config.worktree` est créé vide, pour qu’un agent ne puisse pas l’écrire avant que l’extension s’active', async (t) => {
  const { repo, worktree } = await repoWithWorktree(t)
  const configWorktree = join(repo, '.git', 'worktrees', 'worktree', 'config.worktree')
  assert.equal(existsSync(configWorktree), false)
  gitMounts(worktree)
  assert.equal(await readFile(configWorktree, 'utf8'), '')
})

test('plan : le dossier de travail inscriptible, le dossier commun lisible, ce qui redirige git protégé', async (t) => {
  const { repo, worktree } = await repoWithWorktree(t)
  const plan = confinementPlan({
    scope: { ...terminalScope(worktree), readable: [join(worktree, 'a-l-interieur'), '/absent'] },
    path: '/usr/bin',
    home: homedir(),
    coveredRoots: ['/usr'],
    deniedRoots: [],
  })
  const common = join(repo, '.git')
  assert.deepEqual(plan.writable, [worktree, ...['objects', 'refs', 'logs', 'worktrees/worktree'].map((name) => join(common, name))])
  assert.deepEqual(plan.readable, [common], 'un chemin absent, ou déjà inscriptible, ne se remonte pas')
  assert.ok(plan.protected.includes(join(common, 'worktrees', 'worktree', 'commondir')))
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

  // Un faux `/usr/bin` : le vrai porte des liens vers `/opt` ou `/mnt` qui changent
  // d'une machine à l'autre (Chrome, Docker Desktop), et ouvriraient leurs dossiers.
  const usr = join(base, 'usr')
  const usrBin = join(usr, 'bin')
  await mkdir(usrBin, { recursive: true })
  const toolchain = hostToolchain({ path: [home, base, '/', bin, usrBin].join(':'), home, coveredRoots: [usr], deniedRoots: [] })
  assert.deepEqual(toolchain.pathEntries, [bin, usrBin])
  assert.deepEqual(toolchain.readableDirs.sort(), [bin, pkg].sort())

  const denied = hostToolchain({ path: `/mnt/c/Windows:${bin}`, home, coveredRoots: [], deniedRoots: ['/mnt'] })
  assert.deepEqual(denied.pathEntries, [bin])

  // Le `node_modules/.bin` d'un projet n'ouvre pas le projet.
  const project = join(home, 'projet')
  await mkdir(join(project, '.git'), { recursive: true })
  await mkdir(join(project, 'node_modules', '.bin'), { recursive: true })
  const inRepo = hostToolchain({ path: `${join(project, 'node_modules', '.bin')}:${bin}`, home, coveredRoots: [], deniedRoots: [] })
  assert.deepEqual(inRepo.pathEntries, [bin])

  // nvm, pyenv, asdf s'installent par `git clone` : leurs versions restent lisibles.
  const nvmBin = join(home, '.nvm', 'versions', 'node', 'v22', 'bin')
  await mkdir(nvmBin, { recursive: true })
  await mkdir(join(home, '.nvm', '.git'))
  assert.deepEqual(hostToolchain({ path: nvmBin, home, coveredRoots: [], deniedRoots: [] }).pathEntries, [nvmBin])
  // Mais un `~/bin` qui est un dépôt de dotfiles, non.
  await mkdir(join(bin, '.git'))
  assert.deepEqual(hostToolchain({ path: bin, home, coveredRoots: [], deniedRoots: [] }).pathEntries, [])
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
  const base = { cwd: worktree, workTrees: [], memoryDir: null, skillRoots: [], prototypesDir: null }
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
  // Tout ce qui ferait exécuter du code à git sur l'hôte, ou le redirigerait vers une
  // config que l'agent écrirait.
  const common = join(repo, '.git')
  const escapes = [
    'git config core.fsmonitor "touch /tmp/pwned"',
    `echo x > ${common}/hooks/pre-commit`,
    `mv ${common}/hooks ${common}/ailleurs`,
    `echo ../evil > ${common}/commondir`,
    `mkdir -p ${common}/modules/m && echo x > ${common}/modules/m/config`,
    `echo x > ${common}/packed-refs`,
    `mkdir ${common}/worktrees/autre`,
    `echo x > ${common}/worktrees/worktree/commondir`,
    `echo x > ${common}/worktrees/worktree/config.worktree`,
    `mv ${common}/worktrees/worktree ${common}/worktrees/w2`,
    'echo x > .git',
  ]
  for (const script of escapes) assert.notEqual((await sh(script)).code, 0, script)
  assert.equal(existsSync(join(common, 'commondir')), false)
  assert.equal(await readFile(join(common, 'config'), 'utf8').then((text) => text.includes('fsmonitor')), false)
  assert.equal(git(worktree, 'status', '--porcelain'), '', 'git de l’hôte lit toujours le worktree')

  assert.equal((await sh('echo $HOME')).stdout, '/home/agent')
  // Les identifiants de l'hôte et les données de Solera, présents ou non sur cette machine.
  const hidden = ['.ssh', '.claude', '.codex', '.grok', '.config/gh', '.gitconfig', '.local/share/solera/solera.db', '.local/share/solera/secret.key']
  for (const name of hidden) {
    assert.notEqual((await sh(`test -e ${join(homedir(), name)}`)).code, 0, `${name} est caché`)
  }
  assert.notEqual((await sh(`echo x > ${join(homedir(), '.solera-pwned')}`)).code, 0)
  assert.equal(existsSync(join(homedir(), '.solera-pwned')), false)

  // Une pièce jointe arrive par une copie dans le tmp privé, pas par son dossier.
  const attachment = join(repo, 'piece.txt')
  await writeFile(attachment, 'contenu')
  const [shared] = await environment.shareAttachments([
    { id: 'a1', filename: '../piece.txt', path: attachment, inlineImage: false },
  ])
  assert.equal(shared!.path, '/tmp/solera-attachments/a1/piece.txt')
  assert.equal((await sh(`cat ${shared!.path}`)).stdout, 'contenu')

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

test('bwrap, hors dépôt : pas de `git init` pour l’agent, et le `.git` posé repart à la fermeture', { skip: !bwrapUsable && 'bwrap indisponible ici' }, async (t) => {
  const loose = await realpath(await mkdtemp(join(homedir(), '.solera-confinement-test-')))
  t.after(() => rm(loose, { recursive: true, force: true }))
  const environment = new ConfinedEnvironment(bwrapBackend, terminalScope(loose))
  t.after(() => environment.close())
  const result = await environment.exec({
    command: 'sh',
    args: ['-c', 'git init -q && git config core.fsmonitor "touch pwned"'],
    cwd: loose,
    timeoutMs: 20_000,
  })
  assert.notEqual(result.code, 0)
  assert.equal(existsSync(join(loose, '.git', 'config')), false)
  assert.equal((await environment.exec({ command: 'sh', args: ['-c', 'echo ok > fichier'], cwd: loose, timeoutMs: 20_000 })).code, 0)
  await environment.close()
  assert.equal(existsSync(join(loose, '.git')), false, 'le `.git` vide est retiré')
  assert.equal(existsSync(join(loose, 'fichier')), true)
})
