import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import {
  agentOf,
  assignLanes,
  branchOf,
  mergedBranch,
  parseDecoration,
  parseLog,
  parseTrack,
  readCommitFacts,
  readGraphWindow,
  readRefSections,
  uniqueOwners,
  workingNode,
  type LogEntry,
} from '../src/git-graph.js'
import { threadAt, threadByPath, type ThreadWindow } from '../src/git-threads.js'

/**
 * Les couloirs et le rattachement au fil sont de la logique, pas du câblage : ce sont
 * les deux endroits de la vue Git où une erreur ne se voit pas à l'œil sur une capture
 * — un trait qui passe derrière le bon nœud par accident, un commit attribué au fil
 * voisin. D'où des tests sur les fonctions pures, et un dépôt réel pour la lecture.
 */

const entry = (hash: string, parents: string[] = []): LogEntry => ({
  hash,
  shortHash: hash.slice(0, 7),
  parents,
  ts: 0,
  author: 'Tim',
  email: 'tim@example.test',
  decoration: '',
  coAuthors: [],
  subject: hash,
})

const commit = () => 'commit' as const

test('une histoire rectiligne tient dans un seul couloir', () => {
  const { rows, lanes } = assignLanes([entry('c', ['b']), entry('b', ['a']), entry('a')], commit)

  assert.equal(lanes, 1)
  assert.deepEqual(rows.map((row) => row.lane), [0, 0, 0])
  // Le premier est une tête : son trait part du nœud. Le dernier est une racine : il
  // s'y arrête. Les deux ne se dessinent pas comme un commit du milieu.
  assert.deepEqual(rows.map((row) => row.tip), [true, false, false])
  assert.deepEqual(rows.map((row) => row.root), [false, false, true])
  assert.deepEqual(rows.map((row) => row.through), [[], [], []])
})

test('une branche ouvre un couloir, et la fusion le referme par le bas', () => {
  // m fusionne b (couloir de la branche) dans a ; la branche diverge de `base`.
  const rows = assignLanes(
    [entry('m', ['a', 'b']), entry('a', ['base']), entry('b', ['base']), entry('base')],
    commit,
  )

  const [merge, onMain, onBranch, base] = rows.rows
  assert.equal(rows.lanes, 2)
  assert.equal(merge?.lane, 0)
  // Le second parent descend dans un couloir neuf, rattaché au nœud par une courbe.
  assert.deepEqual(merge?.joins, [1])
  assert.equal(onMain?.lane, 0)
  assert.deepEqual(onMain?.through, [1], 'le couloir de la branche traverse la rangée')
  assert.equal(onBranch?.lane, 1)
  assert.deepEqual(onBranch?.through, [0])
  // Les deux couloirs se rejoignent sur la base : l'un par le haut, d'où `collapses`.
  assert.equal(base?.lane, 0)
  assert.deepEqual(base?.collapses, [1])
  assert.equal(base?.root, true)
})

test('une course porte le nom de sa branche, et la fusion nomme celle qu\'elle ouvre', () => {
  const decorated = (hash: string, parents: string[], decoration: string, subject = hash): LogEntry => ({
    ...entry(hash, parents),
    decoration,
    subject,
  })
  const { rows, runs } = assignLanes(
    [
      decorated('m', ['a', 'b'], 'HEAD -> main, origin/main', "Merge branch 'feat/x'"),
      entry('a', ['base']),
      entry('b', ['base']),
      entry('base'),
    ],
    commit,
  )

  const [merge, onMain, onBranch, base] = rows
  assert.equal(runs[merge?.run ?? -1], 'main')
  assert.equal(runs[merge?.joinRuns[0] ?? -1], 'feat/x')
  // Le trait qui traverse `a` est celui de la branche : même course, d'un bout à l'autre.
  assert.deepEqual(onMain?.throughRuns, merge?.joinRuns)
  assert.equal(onBranch?.run, merge?.joinRuns[0])
  assert.equal(onMain?.run, merge?.run)
  // La branche retombe sur la base : la courbe appartient à sa course, pas à `main`.
  assert.deepEqual(base?.collapseRuns, merge?.joinRuns)
  assert.equal(base?.run, merge?.run)
})

test('au point de fourche, l\'histoire de main garde son nom quand une branche plus récente tient le premier couloir', () => {
  // Le cas courant : un agent commite dans son worktree après le dernier commit de
  // main. `--date-order` lui donne le couloir 0, et c'est main qui s'y replie.
  const decorated = (hash: string, parents: string[], decoration: string): LogEntry => ({
    ...entry(hash, parents),
    decoration,
  })
  const { rows, runs } = assignLanes(
    [decorated('x1', ['base'], 'feat/x'), decorated('m1', ['base'], 'HEAD -> main'), entry('base', ['root']), entry('root')],
    commit,
  )
  const [x1, m1, base, root] = rows
  assert.equal(runs[x1?.run ?? -1], 'feat/x')
  assert.equal(runs[m1?.run ?? -1], 'main')
  assert.equal(runs[base?.run ?? -1], 'main', 'la base appartient à main, pas à feat/x')
  assert.equal(runs[root?.run ?? -1], 'main')
  // Le trait qui arrive sur la base par son couloir reste celui de feat/x : la course
  // change au nœud, pas au-dessus de lui.
  assert.equal(runs[base?.aboveRun ?? -1], 'feat/x')
})

test('sans branche principale ni HEAD parmi elles, la fourche se tait au lieu de deviner', () => {
  const decorated = (hash: string, parents: string[], decoration: string): LogEntry => ({
    ...entry(hash, parents),
    decoration,
  })
  const { rows, runs } = assignLanes(
    [decorated('x1', ['base'], 'feat/x'), decorated('y1', ['base'], 'feat/y'), entry('base')],
    commit,
  )
  assert.equal(runs[rows[2]?.run ?? -1], null)
})

test('une branche en retard sur une autre nomme l\'histoire sous sa tête', () => {
  // feat/x a un commit d'avance sur main, sur le même couloir.
  const decorated = (hash: string, parents: string[], decoration: string): LogEntry => ({
    ...entry(hash, parents),
    decoration,
  })
  const { rows, runs } = assignLanes(
    [decorated('x1', ['m1'], 'feat/x'), decorated('m1', ['root'], 'HEAD -> main, origin/main'), entry('root')],
    commit,
  )
  const [x1, m1, root] = rows
  assert.equal(runs[x1?.run ?? -1], 'feat/x')
  assert.equal(runs[m1?.run ?? -1], 'main')
  assert.equal(runs[root?.run ?? -1], 'main')
  assert.equal(m1?.lane, x1?.lane, 'le dessin ne bouge pas : seule la course change')
})

test('la copie distante en retard ne renomme pas la branche qu\'elle suit', () => {
  const decorated = (hash: string, parents: string[], decoration: string): LogEntry => ({
    ...entry(hash, parents),
    decoration,
  })
  const { rows, runs } = assignLanes(
    [decorated('m2', ['m1'], 'HEAD -> main'), decorated('m1', ['root'], 'origin/main'), entry('root')],
    commit,
  )
  assert.deepEqual(rows.map((row) => runs[row.run]), ['main', 'main', 'main'])
})

test('le nom d\'une branche se lit dans la décoration et dans le message de fusion', () => {
  assert.equal(branchOf('HEAD -> feat/y, origin/feat/y'), 'feat/y')
  assert.equal(branchOf('origin/feat/y, feat/y, tag: v1'), 'feat/y')
  assert.equal(branchOf('tag: v1'), null)
  assert.equal(branchOf(''), null)
  assert.equal(mergedBranch("Merge branch 'fix/z' into main"), 'fix/z')
  assert.equal(mergedBranch("Merge remote-tracking branch 'origin/fix/z'"), 'origin/fix/z')
  assert.equal(mergedBranch('Merge pull request #12 from Tipaq/feat/vue-git'), 'feat/vue-git')
  assert.equal(mergedBranch('Quatre familles (#8)'), null)
})

test('une remise ne traîne pas derrière elle son index ni ses non-suivis', () => {
  // `stash` a trois parents ; seuls les commits du dépôt doivent être suivis.
  const { rows } = assignLanes([entry('stash', ['base', 'index', 'untracked']), entry('base')], commit => commit.hash === 'stash' ? 'stash' : 'commit')

  assert.deepEqual(rows[0]?.joins, [], 'ni l’index ni les non-suivis n’ouvrent un couloir')
  assert.equal(rows[1]?.lane, rows[0]?.lane, 'la remise se pose sur le couloir de sa base')
})

test('un commit atteint depuis une seule tête appartient à cette branche', () => {
  const rows = [
    { hash: 'f2', parents: ['f1'] },
    { hash: 'f1', parents: ['base'] },
    { hash: 'm2', parents: ['base'] },
    { hash: 'base', parents: [] },
  ]
  const owners = uniqueOwners(rows, [
    { hash: 'f2', key: 'feat/truc' },
    { hash: 'm2', key: 'main' },
  ])

  assert.equal(owners.get('f1'), 'feat/truc')
  assert.equal(owners.get('m2'), 'main')
  // L'histoire commune n'appartient à personne : la nommer serait un mensonge.
  assert.equal(owners.get('base'), null)
})

test('la décoration de git se range en étiquettes, sans doubler la branche de HEAD', () => {
  const refs = parseDecoration('HEAD -> feat/vue-git, origin/main, tag: v0.7.0', new Set(['feat/vue-git']))

  assert.deepEqual(refs, [
    { name: 'feat/vue-git', kind: 'worktree' },
    { name: 'origin/main', kind: 'remote' },
    { name: 'v0.7.0', kind: 'tag' },
  ])
})

test('le retard sur l’amont se lit dans %(upstream:track)', () => {
  assert.deepEqual(parseTrack('[ahead 1, behind 2]'), { ahead: 1, behind: 2 })
  assert.deepEqual(parseTrack('[ahead 4]'), { ahead: 4, behind: 0 })
  assert.deepEqual(parseTrack(''), { ahead: null, behind: null }, 'sans amont, rien à dire')
  assert.deepEqual(parseTrack('[gone]'), { ahead: null, behind: null })
})

test('l’agent se lit sur le co-auteur, le seul endroit où il est écrit', () => {
  assert.equal(agentOf(['Claude Opus 5 (1M context) <noreply@anthropic.com>']), 'Claude Opus 5 (1M context)')
  assert.equal(agentOf([]), null)
})

test('le fil d’un worktree est le dernier à y avoir travaillé', () => {
  const threads: ThreadWindow[] = [
    { id: 'vieux', title: 'Premier passage', path: '/w/a', from: 0, to: 10 },
    { id: 'recent', title: 'Second passage', path: '/w/a', from: 20, to: 30 },
    { id: 'racine', title: 'À la racine', path: '/repo', from: 0, to: 100 },
  ]

  assert.equal(threadByPath(threads).get('/w/a')?.id, 'recent')
  assert.equal(threadAt(threads, '/repo', 50)?.id, 'racine')
  assert.equal(threadAt(threads, '/repo', 50)?.sure, false, 'déduit des dates, donc annoncé comme tel')
  // Deux fils dans le même dossier au même moment : on se tait plutôt que de choisir.
  assert.equal(
    threadAt([...threads, { id: 'autre', title: 'En même temps', path: '/repo', from: 40, to: 60 }], '/repo', 50),
    null,
  )
})

test('le nœud « en cours » se pose sur le couloir du premier commit', () => {
  const node = workingNode({ changedFiles: 5, added: 65, removed: 11 }, {
    ...workingNode({ changedFiles: 0, added: 0, removed: 0 }, undefined),
    lane: 2,
    through: [0, 1],
    tip: false,
  })

  assert.equal(node.lane, 2)
  assert.deepEqual(node.through, [0, 1], 'les couloirs du dessous continuent derrière lui')
  assert.deepEqual(node.working, { files: 5, added: 65, removed: 11 })
})

/* ------------------------------------------------- lecture d'un dépôt réel ---- */

const repo = mkdtempSync(join(tmpdir(), 'solera-graph-'))
after(() => rmSync(repo, { recursive: true, force: true }))

const git = (...args: string[]): string =>
  execFileSync('git', args, {
    cwd: repo,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Tim',
      GIT_AUTHOR_EMAIL: 'tim@example.test',
      GIT_COMMITTER_NAME: 'Tim',
      GIT_COMMITTER_EMAIL: 'tim@example.test',
    },
  })

const write = (name: string, content: string): void => writeFileSync(join(repo, name), content)

test('le graphe d’un vrai dépôt : fusion, étiquette, remise et co-auteur', async () => {
  git('init', '--initial-branch=main', '--quiet')
  write('a.txt', 'un')
  git('add', '.')
  git('commit', '--quiet', '-m', 'Le premier')

  git('checkout', '--quiet', '-b', 'feat/essai')
  write('b.txt', 'deux')
  git('add', '.')
  git('commit', '--quiet', '-m', 'Écrit par un agent', '-m', 'Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>')

  git('checkout', '--quiet', 'main')
  write('c.txt', 'trois')
  git('add', '.')
  git('commit', '--quiet', '-m', 'Écrit à la main')
  git('tag', 'v1')
  git('merge', '--quiet', '--no-ff', 'feat/essai', '-m', 'Fusionner feat/essai')

  write('a.txt', 'remisé')
  git('stash', 'push', '--quiet', '-m', 'Avant de reprendre')
  write('a.txt', 'en cours')

  const window = await readGraphWindow(repo, { limit: 60, skip: 0 })
  assert.ok(window)
  assert.equal(window.branch, 'main')

  const subjects = window.rows.map((row) => row.entry.subject)
  assert.ok(subjects.some((subject) => subject.startsWith('On main: Avant de reprendre')), subjects.join(' | '))
  assert.equal(
    subjects.filter((subject) => subject.startsWith('index on')).length,
    0,
    'les parents internes de la remise ne sont pas des commits du dépôt',
  )

  const merge = window.rows.find((row) => row.entry.subject === 'Fusionner feat/essai')
  assert.ok(merge)
  assert.equal(merge.entry.parents.length, 2)
  assert.equal(merge.joins.length, 1, 'le second parent descend dans son propre couloir')
  assert.equal(window.lanes, 2)

  const byAgent = window.rows.find((row) => row.entry.subject === 'Écrit par un agent')
  assert.equal(agentOf(byAgent?.entry.coAuthors ?? []), 'Claude Opus 5')
  assert.equal(agentOf(window.rows.find((row) => row.entry.subject === 'Écrit à la main')?.entry.coAuthors ?? []), null)

  const tagged = window.rows.find((row) => row.entry.subject === 'Écrit à la main')
  assert.deepEqual(parseDecoration(tagged?.entry.decoration ?? '', new Set()), [{ name: 'v1', kind: 'tag' }])
})

test('les sections de Branches gardent celles qui sont vides', async () => {
  const sections = await readRefSections(repo, () => null)
  assert.ok(sections)

  // Aucun remote ici, et la section y est quand même : toutes restent, vides comprises.
  assert.deepEqual(sections.map((section) => section.kind), ['local', 'worktrees', 'remote', 'tags', 'submodules'])
  assert.deepEqual(
    sections.find((section) => section.kind === 'local')?.lines.map((line) => line.name).sort(),
    ['feat/essai', 'main'],
  )
  assert.equal(sections.find((section) => section.kind === 'tags')?.lines[0]?.name, 'v1')
  assert.deepEqual(sections.find((section) => section.kind === 'submodules')?.lines, [])
  assert.equal(sections.find((section) => section.kind === 'local')?.lines.find((line) => line.name === 'main')?.current, true)
})

test('un commit sélectionné dit ses parents et les branches qui le contiennent', async () => {
  const head = git('rev-parse', 'HEAD').trim()
  const facts = await readCommitFacts(repo, head)

  assert.ok(facts)
  assert.equal(facts.entry.parents.length, 2)
  assert.ok(facts.containedIn.includes('refs/heads/main'))
  assert.equal(facts.containedIn.includes('refs/heads/feat/essai'), false)
})

test('le format de log survit à un sujet qui contient des séparateurs', () => {
  const parsed = parseLog(
    'abc\x00abc\x00def ghi\x001700000000\x00Tim\x00tim@example.test\x00\x00\x00Un sujet, avec des, virgules\x1e',
  )

  assert.equal(parsed.length, 1)
  assert.deepEqual(parsed[0]?.parents, ['def', 'ghi'])
  assert.equal(parsed[0]?.subject, 'Un sujet, avec des, virgules')
  assert.equal(parsed[0]?.ts, 1700000000000)
})
