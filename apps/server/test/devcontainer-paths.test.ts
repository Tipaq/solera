import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { type TestContext } from 'node:test'
import { DevcontainerEnvironment, shellArgs, type RunningContainer } from '../src/environments/devcontainer/environment.js'
import { ephemeralMounts } from '../src/environments/devcontainer/ephemeral.js'
import { ContainerRefusal } from '../src/environments/devcontainer/refusal.js'
import { containerPathOf, hostPathOf } from '../src/environments/devcontainer/paths.js'
import { hasAbsoluteGitLink, relativizeWorktreeLinks, RELATIVE_LINKS_LOCK } from '../src/environments/devcontainer/worktree-links.js'
import { removeWorktree } from '../src/git.js'

async function tempDir(t: TestContext): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'solera-paths-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  return dir
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, encoding: 'utf8' }).trim()
}

function container(overrides: Partial<RunningContainer> = {}): RunningContainer {
  return {
    id: 'c0ffee',
    user: 'node',
    loginShell: '/bin/bash',
    workspace: 'C:\\Users\\me\\project',
    remoteWorkspaceFolder: '/workspaces/project',
    solerasMounts: true,
    env: {},
    agents: new Map(),
    hostAddress: 'host.docker.internal',
    ...overrides,
  }
}

test('sous Windows natif, un chemin de lecteur devient /mnt/<lecteur>, et revient', () => {
  assert.equal(containerPathOf('C:\\Users\\me\\project', 'win32'), '/mnt/c/Users/me/project')
  assert.equal(containerPathOf('d:/data/solera/', 'win32'), '/mnt/d/data/solera')
  assert.equal(containerPathOf('C:\\', 'win32'), '/mnt/c')
  assert.equal(containerPathOf('\\\\server\\share\\x', 'win32'), null, 'un partage réseau ne se monte pas')
  assert.equal(hostPathOf('/mnt/c/Users/me/project/src/a.ts', 'win32'), 'C:\\Users\\me\\project\\src\\a.ts')
  assert.equal(hostPathOf('/mnt/d', 'win32'), 'D:\\')
  assert.equal(hostPathOf('/opt/solera/agents', 'win32'), null)
})

test('sous Linux et macOS, rien ne se traduit', () => {
  assert.equal(containerPathOf('/home/me/project', 'linux'), '/home/me/project')
  assert.equal(hostPathOf('/home/me/project', 'darwin'), '/home/me/project')
})

test("le dev container d'un hôte Windows traduit dans les deux sens", () => {
  const environment = new DevcontainerEnvironment(container(), 'docker', {}, 'win32')
  assert.equal(environment.pathInside('C:\\Users\\me\\project\\src'), '/mnt/c/Users/me/project/src')
  assert.equal(environment.pathOutside('/mnt/c/Users/me/project/src/a.ts'), 'C:\\Users\\me\\project\\src\\a.ts')
  assert.equal(environment.pathOutside('/opt/solera/agents/claude'), '/opt/solera/agents/claude', 'sans équivalent : tel quel')
  assert.equal(environment.pathOutside('src/a.ts'), 'src/a.ts', 'un chemin relatif reste relatif')

  // Sans les montages de Solera, seul le dossier du projet existe, là où le devcontainer.json le monte.
  const foreign = new DevcontainerEnvironment(container({ solerasMounts: false }), 'docker', {}, 'win32')
  assert.equal(foreign.pathInside('C:\\Users\\me\\project\\src'), '/workspaces/project/src')
  assert.equal(foreign.pathOutside('/workspaces/project/src/a.ts'), 'C:\\Users\\me\\project\\src\\a.ts')
})

test("les liens d'un worktree deviennent relatifs, et git s'y retrouve toujours", async (t) => {
  const root = await tempDir(t)
  const repo = join(root, 'repo')
  git(root, 'init', '-q', repo)
  git(repo, 'commit', '-q', '--allow-empty', '-m', 'init')
  const tree = join(root, 'worktrees', 'feat')
  git(repo, 'worktree', 'add', '-q', '-b', 'feat', tree)
  assert.equal(await hasAbsoluteGitLink(tree), true)

  await relativizeWorktreeLinks(repo)

  assert.equal(await hasAbsoluteGitLink(tree), false)
  assert.equal((await readFile(join(tree, '.git'), 'utf8')).trim(), 'gitdir: ../../repo/.git/worktrees/feat')
  assert.equal((await readFile(join(repo, '.git', 'worktrees', 'feat', 'gitdir'), 'utf8')).trim(), '../../../../worktrees/feat/.git')
  assert.equal(git(tree, 'branch', '--show-current'), 'feat')
  assert.doesNotMatch(git(repo, 'worktree', 'list'), /prunable/)
  assert.doesNotMatch(git(repo, 'config', '--list', '--local'), /relativeworktrees/i, "sans l'extension que git < 2.48 refuse")

  // Une deuxième passe ne change rien.
  await relativizeWorktreeLinks(repo)
  assert.equal(git(tree, 'branch', '--show-current'), 'feat')
})

test("un worktree aux liens relatifs est verrouillé contre le prune d'un git ancien, et se retire quand même", async (t) => {
  const root = await tempDir(t)
  const repo = join(root, 'repo')
  git(root, 'init', '-q', repo)
  git(repo, 'commit', '-q', '--allow-empty', '-m', 'init')
  const tree = join(root, 'worktrees', 'feat')
  git(repo, 'worktree', 'add', '-q', '-b', 'feat', tree)

  await relativizeWorktreeLinks(repo)
  const admin = join(repo, '.git', 'worktrees', 'feat')
  assert.equal((await readFile(join(admin, 'locked'), 'utf8')).trim(), RELATIVE_LINKS_LOCK)

  // Ce que verrait un git < 2.48 : un lien retour qui ne mène nulle part. Le verrou le garde.
  const backLink = await readFile(join(admin, 'gitdir'), 'utf8')
  await writeFile(join(admin, 'gitdir'), '/nowhere/.git\n')
  git(repo, 'worktree', 'prune')
  assert.ok(existsSync(admin), 'le prune ne détache pas un worktree verrouillé')
  await writeFile(join(admin, 'gitdir'), backLink)

  await removeWorktree(repo, tree, false)
  assert.ok(!existsSync(tree) && !existsSync(admin))
})

test('le verrou posé par une personne reste', async (t) => {
  const root = await tempDir(t)
  const repo = join(root, 'repo')
  git(root, 'init', '-q', repo)
  git(repo, 'commit', '-q', '--allow-empty', '-m', 'init')
  const tree = join(root, 'worktrees', 'feat')
  git(repo, 'worktree', 'add', '-q', '-b', 'feat', tree)
  git(repo, 'worktree', 'lock', '--reason', 'sur une clé USB', tree)

  await relativizeWorktreeLinks(repo)
  assert.equal((await readFile(join(repo, '.git', 'worktrees', 'feat', 'locked'), 'utf8')).trim(), 'sur une clé USB')
  await assert.rejects(removeWorktree(repo, tree, true), /locked/)
})

test('le PowerShell d’un terminal Windows devient le shell du conteneur, avec des arguments POSIX', () => {
  const pwsh = 'C:\\Program Files\\PowerShell\\7\\pwsh.exe'
  assert.deepEqual(shellArgs(pwsh, ['-NoLogo']), [])
  assert.deepEqual(shellArgs(pwsh, ['-NoLogo', '-Command', 'pnpm dev']), ['-lc', 'pnpm dev'])
  assert.deepEqual(shellArgs('C:\\Program Files\\Git\\bin\\bash.exe', ['-lc', 'pnpm dev']), ['-lc', 'pnpm dev'])
})

test("le conteneur d'une session confinée monte ses dossiers à leur chemin du conteneur", () => {
  const plan = { writable: ['C:\\data\\worktrees\\feat'], readable: ['C:\\data\\memory'], protected: [], homeLinks: [], env: {}, placeholders: [] }
  const mounts = ephemeralMounts(plan, 'C:\\data\\worktrees\\feat', { source: 'C:\\data\\agents', target: '/opt/solera/agents' }, 'win32')
  assert.equal(mounts.workspaceMount, 'type=bind,source=C:\\data\\worktrees\\feat,target=/mnt/c/data/worktrees/feat')
  assert.ok(mounts.mounts.includes('type=bind,source=C:\\data\\memory,target=/mnt/c/data/memory,readonly'))
  assert.ok(mounts.sources.includes('C:\\data\\memory'), "la liste blanche reste en chemins de l'hôte")
})

test("un dossier sur un partage réseau est refusé par un code que l'interface traduit", () => {
  const plan = { writable: ['C:\\data\\worktrees\\feat'], readable: ['\\\\server\\share\\memory'], protected: [], homeLinks: [], env: {}, placeholders: [] }
  assert.throws(
    () => ephemeralMounts(plan, 'C:\\data\\worktrees\\feat', { source: 'C:\\data\\agents', target: '/opt/solera/agents' }, 'win32'),
    (err: unknown) => err instanceof ContainerRefusal && err.code === 'devcontainer_paths',
  )
})
