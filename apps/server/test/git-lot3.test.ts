import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { parseConflict } from '../src/git-conflicts.js'
import { partialPatch } from '../src/git-lines.js'
import { rebaseInProgress } from '../src/git-rebase.js'
import { impactOf, perform, readWriteState } from '../src/git-write.js'

/**
 * Le lot 3 de la vue Git : l'indexation par ligne, le rebase interactif, les conflits.
 *
 * Ce que ces tests attrapent et qu'aucune relecture ne verrait :
 *
 * - **ce qui est coché est exactement ce qui est indexé**, et rien d'autre ne bouge —
 *   ni le disque, ni les lignes voisines, ni les blocs qu'on n'a pas touchés. Le patch
 *   partiel est la seule fonction du lot qui ne délègue pas à git, donc la seule qui
 *   puisse se tromper en silence : un patch mal recompté est accepté par `git apply`
 *   sur un fichier court et refusé sur un fichier long ;
 * - **les deux sens ne se construisent pas pareil.** Indexer et retirer inversent la
 *   règle sur les lignes non cochées, et se tromper ne donne pas un mauvais résultat
 *   mais un refus de `git apply`. Les deux sens sont donc exercés ;
 * - **un rebase interactif suspend les tours**, ce qui est une promesse faite à
 *   l'écran et tenue ailleurs ;
 * - **on ne marque pas résolu un fichier qui porte encore un marqueur.**
 */

const roots: string[] = []
after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Tim',
      GIT_AUTHOR_EMAIL: 'tim@example.test',
      GIT_COMMITTER_NAME: 'Tim',
      GIT_COMMITTER_EMAIL: 'tim@example.test',
    },
  })
}

function repo(): string {
  const root = mkdtempSync(join(tmpdir(), 'solera-git-lot3-'))
  roots.push(root)
  git(root, 'init', '-b', 'main')
  // Dans le dépôt, et pas seulement dans l'environnement du helper : c'est le serveur
  // qui commite pendant un rebase interactif, et il n'hérite pas de ces variables.
  // Voir `git-write.test.ts`, où le même piège est expliqué en entier.
  git(root, 'config', 'user.name', 'Tim')
  git(root, 'config', 'user.email', 'tim@example.test')
  return root
}

const lines = (...values: string[]): string => `${values.join('\n')}\n`

/* ------------------------------------------------------ indexer par ligne (T3) ---- */

test('indexer deux lignes d’un bloc n’indexe que celles-là, et laisse le disque intact', async () => {
  const root = repo()
  writeFileSync(join(root, 'f.txt'), lines('a', 'b', 'c', 'd', 'e'))
  git(root, 'add', '-A')
  git(root, 'commit', '-m', 'Départ')

  // Trois modifications dans un seul bloc : on n'en coche qu'une.
  //
  // Les nouvelles lignes sont **plus longues** que les anciennes, et ce n'est pas un
  // détail de style : une modification qui laisse le fichier de la même taille, à la
  // même seconde que le commit, tombe dans l'heuristique de fraîcheur de git, qui peut
  // alors tenir le fichier pour propre. Le test ne mesurerait plus rien.
  writeFileSync(join(root, 'f.txt'), lines('a', 'BB', 'c', 'DD', 'EE'))

  const before = await readWriteState(root)
  const patch = before?.unstagedPatch ?? ''
  const header = /^@@ .*$/m.exec(patch)?.[0] ?? ''
  assert.ok(header, 'le diff affiché porte bien un bloc')

  // Les rangs sont ceux du corps du bloc tel que l'écran le numérote :
  //   0 ' a'  1 '-b'  2 '+BB'  3 ' c'  4 '-d'  5 '-e'  6 '+DD'  7 '+EE'
  // On coche la paire du « b » → « BB » seule.
  const body = patch.slice(patch.indexOf(header) + header.length + 1).split('\n')
  const minus = body.findIndex((line) => line === '-b')
  const plus = body.findIndex((line) => line === '+BB')
  assert.ok(minus !== -1 && plus !== -1, patch)

  await perform(
    root,
    {
      kind: 'stage-lines',
      path: 'f.txt',
      selections: [{ hunk: 0, header, lines: [minus, plus] }],
    },
    {},
  )

  // L'index porte exactement la ligne cochée, et aucune des deux autres.
  assert.equal(git(root, 'show', ':f.txt'), lines('a', 'BB', 'c', 'd', 'e'))
  // Et le disque n'a pas bougé d'un octet : c'est tout l'intérêt du geste.
  assert.equal(readFileSync(join(root, 'f.txt'), 'utf8'), lines('a', 'BB', 'c', 'DD', 'EE'))
})

test('retirer une ligne de l’index est le même geste à l’envers, et il s’applique', async () => {
  const root = repo()
  writeFileSync(join(root, 'f.txt'), lines('a', 'b', 'c'))
  git(root, 'add', '-A')
  git(root, 'commit', '-m', 'Départ')

  writeFileSync(join(root, 'f.txt'), lines('AA', 'b', 'CC'))
  git(root, 'add', '-A')

  const staged = (await readWriteState(root))?.stagedPatch ?? ''
  const header = /^@@ .*$/m.exec(staged)?.[0] ?? ''
  const body = staged.slice(staged.indexOf(header) + header.length + 1).split('\n')
  const minus = body.findIndex((line) => line === '-a')
  const plus = body.findIndex((line) => line === '+AA')

  await perform(
    root,
    {
      kind: 'unstage-lines',
      path: 'f.txt',
      selections: [{ hunk: 0, header, lines: [minus, plus] }],
    },
    {},
  )

  // La première ligne est revenue à ce que HEAD en dit, la troisième est restée indexée.
  assert.equal(git(root, 'show', ':f.txt'), lines('a', 'b', 'CC'))
  assert.equal(readFileSync(join(root, 'f.txt'), 'utf8'), lines('AA', 'b', 'CC'))
})

test('un diff qui a bougé sous le clic est refusé, pas appliqué de travers', async () => {
  const root = repo()
  writeFileSync(join(root, 'f.txt'), lines('a', 'b'))
  git(root, 'add', '-A')
  git(root, 'commit', '-m', 'Départ')
  writeFileSync(join(root, 'f.txt'), lines('a', 'BB'))

  await assert.rejects(
    perform(
      root,
      {
        kind: 'stage-lines',
        path: 'f.txt',
        // L'en-tête d'un bloc qui n'est plus celui qu'on regardait.
        selections: [{ hunk: 0, header: '@@ -40,3 +40,3 @@', lines: [0] }],
      },
      {},
    ),
    /changé depuis l’affichage/,
  )
  assert.equal(git(root, 'diff', '--cached', '--name-only').trim(), '', 'rien n’a été indexé')
})

test('le patch partiel recompte ses blocs, et le second suit le décalage du premier', () => {
  // Deux blocs, un seul retenu dans chacun : si les comptes ou le départ du second
  // bloc n'étaient pas recalculés, `git apply` le refuserait sur un vrai fichier.
  const patch = [
    'diff --git a/f.txt b/f.txt',
    'index 111..222 100644',
    '--- a/f.txt',
    '+++ b/f.txt',
    '@@ -1,4 +1,5 @@',
    ' a',
    '+un',
    '+deux',
    ' b',
    ' c',
    '@@ -20,3 +21,3 @@',
    ' x',
    '-y',
    '+Y',
    ' z',
    '',
  ].join('\n')

  const out = partialPatch(
    patch,
    [
      { hunk: 0, header: '@@ -1,4 +1,5 @@', lines: [1] },
      { hunk: 1, header: '@@ -20,3 +21,3 @@', lines: [1, 2] },
    ],
    false,
  ).split('\n')

  // Premier bloc : la seconde ligne ajoutée a disparu, et les comptes sont ceux du
  // patch partiel — trois lignes de contexte, une seule ajoutée — et non ceux du
  // patch complet dont il est tiré.
  assert.equal(out[4], '@@ -1,3 +1,4 @@')
  assert.ok(!out.includes('+deux'))
  // Second bloc : son départ côté « après » a pris le décalage du premier (+1), alors
  // qu'il valait +21 dans le patch complet parce que deux lignes y étaient ajoutées.
  assert.equal(out[9], '@@ -20,3 +21,3 @@')
})

/* ------------------------------------------------ le rebase interactif (T9) ---- */

async function threeCommits(): Promise<string> {
  const root = repo()
  for (const [file, message] of [
    ['un.txt', 'Le premier'],
    ['deux.txt', 'Le deuxième'],
    ['trois.txt', 'Le troisième'],
  ] as const) {
    writeFileSync(join(root, file), `${file}\n`)
    git(root, 'add', '-A')
    git(root, 'commit', '-m', message)
  }
  git(root, 'branch', 'base', 'HEAD~2')
  return root
}

test('le rebase interactif fond, réécrit et jette, et tout le reste arrive', async () => {
  const root = await threeCommits()
  const hashes = git(root, 'log', '--format=%H', '--reverse', 'base..HEAD')
    .trim()
    .split('\n')
  assert.equal(hashes.length, 2)

  // Un quatrième commit, pour que le plan ait de quoi fondre et de quoi jeter.
  writeFileSync(join(root, 'quatre.txt'), 'quatre\n')
  git(root, 'add', '-A')
  git(root, 'commit', '-m', 'Le quatrième')
  const fourth = git(root, 'rev-parse', 'HEAD').trim()

  await perform(
    root,
    {
      kind: 'rebase-start',
      onto: 'base',
      plan: [
        { hash: hashes[0] as string, verb: 'reword', message: 'Le deuxième, réécrit' },
        { hash: hashes[1] as string, verb: 'squash', message: '' },
        { hash: fourth, verb: 'drop', message: '' },
      ],
    },
    {},
  )

  assert.equal(await rebaseInProgress(root), false, 'le rebase est allé au bout')
  const subjects = git(root, 'log', '--format=%s', 'base..HEAD').trim().split('\n')
  assert.deepEqual(subjects, ['Le deuxième, réécrit'], '3 commits → 1')

  // Le message du commit fondu n'est pas perdu : il est descendu dans le corps.
  const body = git(root, 'log', '-1', '--format=%B').trim()
  assert.match(body, /Le deuxième, réécrit/)
  assert.match(body, /Le troisième/, 'fondre garde le message du commit fondu')

  // Et ce qui a été jeté l'est : le fichier du quatrième n'est plus dans l'arbre.
  assert.equal(git(root, 'ls-files', 'quatre.txt').trim(), '')
  // Les deux autres sont là, eux.
  assert.equal(git(root, 'ls-files', 'deux.txt').trim(), 'deux.txt')
  assert.equal(git(root, 'ls-files', 'trois.txt').trim(), 'trois.txt')
})

test('un rebase interrompu se voit, et son abandon nomme ce qu’il emporte', async () => {
  const root = repo()
  writeFileSync(join(root, 'f.txt'), lines('commun'))
  git(root, 'add', '-A')
  git(root, 'commit', '-m', 'Base')
  git(root, 'branch', 'autre')

  writeFileSync(join(root, 'f.txt'), lines('version de main'))
  git(root, 'add', '-A')
  git(root, 'commit', '-m', 'Main écrit')

  git(root, 'switch', 'autre')
  writeFileSync(join(root, 'f.txt'), lines('version de autre'))
  git(root, 'add', '-A')
  git(root, 'commit', '-m', 'Autre écrit')
  const mine = git(root, 'rev-parse', 'HEAD').trim()

  // Les deux branches touchent la même ligne : le rebase bute.
  const outcome = await perform(
    root,
    { kind: 'rebase-start', onto: 'main', plan: [{ hash: mine, verb: 'pick', message: '' }] },
    {},
  )
  assert.equal(outcome.undo, null, 'un rebase interrompu ne promet aucune annulation')
  assert.equal(await rebaseInProgress(root), true)

  const state = await readWriteState(root)
  assert.ok(state?.rebase, 'l’état dit qu’un rebase court')
  assert.deepEqual(state.conflicted, ['f.txt'], 'et quel fichier le retient')

  const impact = await impactOf(root, { kind: 'rebase-abort' })
  assert.equal(impact.undoable, false, 'abandonner ne s’annule pas')

  await perform(root, { kind: 'rebase-abort' }, {})
  assert.equal(await rebaseInProgress(root), false)
  assert.equal(git(root, 'rev-parse', 'HEAD').trim(), mine, 'le dépôt est revenu où il était')
})

/* ----------------------------------------------------- les conflits (T10) ---- */

test('un fichier en conflit se découpe en morceaux, le style diff3 compris', () => {
  const { segments } = parseConflict(
    [
      'avant',
      '<<<<<<< HEAD',
      'les miens',
      '||||||| ancêtre',
      'le commun',
      '=======',
      'les leurs',
      '>>>>>>> autre',
      'après',
      '',
    ].join('\n'),
  )

  assert.equal(segments.length, 3)
  assert.deepEqual(segments[0], { kind: 'context', lines: ['avant'] })
  // L'ancêtre est lu pour être sauté : le confondre avec « les miens » donnerait un
  // résultat faux, et l'écran de T10 n'a de place que pour trois versions.
  assert.deepEqual(segments[1], { kind: 'conflict', ours: ['les miens'], theirs: ['les leurs'] })
  assert.deepEqual(segments[2], { kind: 'context', lines: ['après', ''] })
})

test('on ne marque pas résolu un fichier qui porte encore un marqueur', async () => {
  const root = repo()
  writeFileSync(join(root, 'f.txt'), lines('a'))
  git(root, 'add', '-A')
  git(root, 'commit', '-m', 'Base')

  await assert.rejects(
    perform(
      root,
      {
        kind: 'conflict-resolve',
        path: 'f.txt',
        content: lines('<<<<<<< HEAD', 'a', '=======', 'b', '>>>>>>> autre'),
      },
      {},
    ),
    /marqueur de conflit/,
  )
  // Le fichier n'a pas été écrit : refuser doit refuser, pas écrire puis se plaindre.
  assert.equal(readFileSync(join(root, 'f.txt'), 'utf8'), lines('a'))
})

test('prendre un côté résout le fichier et le marque dans l’index', async () => {
  const root = repo()
  writeFileSync(join(root, 'f.txt'), lines('commun'))
  git(root, 'add', '-A')
  git(root, 'commit', '-m', 'Base')
  git(root, 'branch', 'autre')

  writeFileSync(join(root, 'f.txt'), lines('les miens'))
  git(root, 'add', '-A')
  git(root, 'commit', '-m', 'Main')

  git(root, 'switch', 'autre')
  writeFileSync(join(root, 'f.txt'), lines('les leurs'))
  git(root, 'add', '-A')
  git(root, 'commit', '-m', 'Autre')

  try {
    git(root, 'merge', 'main')
  } catch {
    // La fusion échoue : c'est le conflit qu'on vient chercher.
  }
  assert.deepEqual((await readWriteState(root))?.conflicted, ['f.txt'])

  // Le garde-fou nomme ce qui sera écrasé avant d'écraser quoi que ce soit.
  const impact = await impactOf(root, { kind: 'conflict-take', side: 'theirs', path: null })
  assert.equal(impact.undoable, false)
  assert.equal(impact.losses[0]?.count, 1)

  await perform(root, { kind: 'conflict-take', side: 'theirs', path: null }, {})
  assert.equal(readFileSync(join(root, 'f.txt'), 'utf8'), lines('les miens'))
  assert.deepEqual((await readWriteState(root))?.conflicted, [], 'plus rien en conflit')
})
