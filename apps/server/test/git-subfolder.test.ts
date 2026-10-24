import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { after, test } from 'node:test'
import { readFileStates } from '../src/git.js'
import { perform, readWriteState } from '../src/git-write.js'

/**
 * Un projet ouvert sur un sous-dossier du dépôt, et une configuration git qui n'est
 * pas celle de git par défaut.
 *
 * `status`, `--numstat` et les en-têtes de patch parlent depuis la racine du dépôt ;
 * les gestes, l'explorateur et l'ouverture d'un fichier, depuis le dossier du projet.
 * Ce que ces tests attrapent : un fichier listé sous un chemin que le geste ne
 * retrouve pas, un diff que l'écran n'apparie à aucun fichier, et un patch que la
 * couleur forcée ou `diff.noprefix` rendent illisible.
 */

const roots: string[] = []
after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' })
}

function write(root: string, path: string, content: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true })
  writeFileSync(join(root, path), content)
}

function repo(): string {
  const root = mkdtempSync(join(tmpdir(), 'solera-git-subfolder-'))
  roots.push(root)
  git(root, 'init', '-b', 'main')
  git(root, 'config', 'user.name', 'Tim')
  git(root, 'config', 'user.email', 'tim@example.test')
  write(root, 'README.md', 'racine\n')
  write(root, 'nested/source.txt', 'avant\n')
  git(root, 'add', '-A')
  git(root, 'commit', '-m', 'Départ')
  return root
}

/** Les préférences d'un terminal, qui ne font pas un patch qu'on puisse lire. */
function hostileConfig(root: string): void {
  git(root, 'config', 'color.ui', 'always')
  git(root, 'config', 'diff.noprefix', 'true')
  git(root, 'config', 'diff.mnemonicPrefix', 'true')
  git(root, 'config', 'diff.relative', 'true')
}

test('statut depuis un sous-dossier : chemins du projet, diffs appariés, gestes qui tiennent', async () => {
  const root = repo()
  hostileConfig(root)
  write(root, 'nested/source.txt', 'avant\naprès\n')
  write(root, 'README.md', 'racine modifiée\n')
  write(root, 'nested/échantillon.txt', 'Contenu réel\n')
  const cwd = join(root, 'nested')

  const state = (await readWriteState(cwd))!
  const source = state.unstaged.find((file) => file.path === 'source.txt')
  assert.ok(source, JSON.stringify(state.unstaged))
  assert.equal(source.added, 1)
  assert.ok(state.unstaged.some((file) => file.path === '../README.md'))
  assert.ok(state.unstaged.some((file) => file.path === 'échantillon.txt'))
  assert.ok(!state.unstagedPatch.includes('\u001b['), 'pas de couleur dans le patch')
  assert.match(state.unstagedPatch, /^diff --git a\/source\.txt b\/source\.txt$/m)
  assert.match(state.unstagedPatch, /^diff --git a\/échantillon\.txt b\/échantillon\.txt$/m)
  assert.match(state.unstagedPatch, /^diff --git a\/\.\.\/README\.md b\/\.\.\/README\.md$/m)

  await perform(cwd, { kind: 'stage', paths: ['source.txt'] }, {})
  const staged = (await readWriteState(cwd))!
  assert.deepEqual(staged.staged.map((file) => file.path), ['source.txt'])
  assert.match(staged.stagedPatch, /^\+\+\+ b\/source\.txt$/m)
  assert.match(staged.stagedPatch, /^\+après$/m)

  await perform(cwd, { kind: 'unstage', paths: ['source.txt'] }, {})
  await perform(cwd, { kind: 'discard', paths: ['source.txt'] }, {})
  assert.equal(readFileSync(join(root, 'nested/source.txt'), 'utf8'), 'avant\n')
})

test('indexer une ligne depuis un sous-dossier', async () => {
  const root = repo()
  hostileConfig(root)
  write(root, 'nested/source.txt', 'AVANT\nencore\n')
  const cwd = join(root, 'nested')

  const patch = (await readWriteState(cwd))!.unstagedPatch
  const header = /^@@ .*$/m.exec(patch)?.[0] ?? ''
  const body = patch.slice(patch.indexOf(header) + header.length + 1).split('\n')
  const minus = body.findIndex((line) => line === '-avant')
  const plus = body.findIndex((line) => line === '+AVANT')
  assert.ok(header && minus !== -1 && plus !== -1, patch)

  await perform(cwd, { kind: 'stage-lines', path: 'source.txt', selections: [{ hunk: 0, header, lines: [minus, plus] }] }, {})
  assert.equal(git(root, 'show', ':nested/source.txt'), 'AVANT\n')
})

test('l’explorateur d’un sous-dossier retrouve l’état de ses fichiers', async () => {
  const root = repo()
  write(root, 'nested/source.txt', 'avant\naprès\n')
  write(root, 'nested/neuf.txt', 'neuf\n')
  const states = (await readFileStates(join(root, 'nested')))!
  assert.equal(states.get('source.txt'), 'modified')
  assert.equal(states.get('neuf.txt'), 'untracked')
})
