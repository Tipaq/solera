import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const { actionRoot, detectTool, lastLine, outputTail, screenText, summarize, workspacePath } = await import(
  '../../web/src/lib/command-output.js'
)

/**
 * Les fixtures sont des sorties réelles, capturées dans un pseudo-terminal (`script`)
 * comme les produit un terminal du panneau : codes ANSI, `\r\n`, effacements de ligne.
 * `vitest-demo.txt` et `eslint-demo.txt` sont les sorties de démo du prototype ;
 * `pytest.txt` suit le format de pytest 8, qu'on n'a pas pu lancer ici.
 */
const fixture = (name: string) => readFileSync(new URL(`./fixtures/command-output/${name}.txt`, import.meta.url), 'utf8')

test('screenText : retire l’ANSI et rejoue les retours chariot et les effacements', () => {
  assert.equal(screenText('\x1b[31mrouge\x1b[39m et \x1b[1mgras\x1b[22m'), 'rouge et gras')
  assert.equal(screenText('a\r\nb\r\n'), 'a\nb\n')
  // Une barre de progression réécrit sa ligne : seul le dernier état reste.
  assert.equal(screenText('10 %\r50 %\r100 %\r\nfini'), '100 %\nfini')
  // Effacer puis remonter (jest) : les lignes « RUNS » disparaissent.
  assert.equal(screenText('début\r\n RUNS  …\r\n\r\x1b[K\r\x1b[1A\r\x1b[Kfin\r\n'), 'début\nfin\n')
  // Un titre de fenêtre (OSC) n'est pas du texte.
  assert.equal(screenText('\x1b]0;titre\x07texte'), 'texte')
})

test('jest : plus aucune ligne « RUNS » une fois l’écran rejoué', () => {
  assert.doesNotMatch(screenText(fixture('jest')), /RUNS/)
})

test('detectTool : par la commande, puis par la sortie', () => {
  assert.equal(detectTool('pnpm exec vitest run', ''), 'vitest')
  assert.equal(detectTool('npx jest', ''), 'jest')
  assert.equal(detectTool('node --test test/', ''), 'node-test')
  assert.equal(detectTool('tsx --test test/*.test.ts', ''), 'node-test')
  assert.equal(detectTool('python -m pytest -q', ''), 'pytest')
  assert.equal(detectTool('pnpm eslint .', ''), 'eslint')
  assert.equal(detectTool('pnpm tsc --noEmit', ''), 'tsc')
  // `pnpm test`, `pnpm lint`, `pnpm typecheck` : la sortie le dit.
  assert.equal(detectTool('pnpm test', screenText(fixture('vitest'))), 'vitest')
  assert.equal(detectTool('pnpm test', screenText(fixture('jest'))), 'jest')
  assert.equal(detectTool('pnpm test', screenText(fixture('node-test'))), 'node-test')
  assert.equal(detectTool('pnpm test', fixture('node-test-tap')), 'node-test')
  assert.equal(detectTool('make test', fixture('pytest')), 'pytest')
  assert.equal(detectTool('pnpm lint', screenText(fixture('eslint'))), 'eslint')
  assert.equal(detectTool('pnpm typecheck', screenText(fixture('tsc'))), 'tsc')
  assert.equal(detectTool('pnpm build', 'done'), 'other')
})

test('vitest : suite › cas, fichier:ligne, message, attendu / reçu', () => {
  const summary = summarize('pnpm exec vitest run', fixture('vitest'))
  assert.equal(summary.tool, 'vitest')
  assert.deepEqual(
    summary.tests.map((entry) => [entry.name, entry.file, entry.line]),
    [
      ['relativeDate › dit « demain » pour le lendemain', 'src/dates.test.ts', 3],
      ['relativeDate › semaines › passe à la semaine au-delà de 6 jours', 'src/dates.test.ts', 6],
    ],
  )
  const [first, second] = summary.tests
  assert.equal(first!.message, 'AssertionError: expected \'dans 1 j\' to be \'demain\' // Object.is equality')
  assert.equal(first!.expected, '"demain"')
  assert.equal(first!.received, '"dans 1 j"')
  assert.equal(second!.message, 'AssertionError: expected { n: 9 } to deeply equal { n: 7 }')
  assert.equal(second!.expected, '"n": 7,')
  assert.equal(second!.received, '"n": 9,')
  assert.equal(summary.totals, 'Tests  2 failed | 2 passed (4)')
  assert.deepEqual(summary.rerunArgs, ['-t', 'dit « demain » pour le lendemain|passe à la semaine au-delà de 6 jours'])
})

test('vitest : la sortie de démo du prototype', () => {
  const summary = summarize('pnpm --filter @solera/web exec vitest run', fixture('vitest-demo'))
  assert.equal(summary.tests.length, 3)
  assert.deepEqual(summary.tests[2], {
    name: 'rememberVisit › ne garde que les 20 derniers projets',
    file: 'src/lib/project-visits.test.ts',
    line: 28,
    message: 'AssertionError: expected [ …(21) ] to have a length of 20 but got 21',
    expected: '20',
    received: '21',
  })
  assert.equal(summary.totals, 'Tests  3 failed | 49 passed (52)')
})

test('vitest réussi : le dernier bilan, pas celui de la file d’attente', () => {
  const summary = summarize('pnpm vitest run', fixture('vitest-passed'))
  assert.deepEqual(summary.tests, [])
  assert.equal(summary.totals, 'Tests  1 passed (1)')
  assert.equal(summary.rerunArgs, null)
})

test('jest : chemin du test, emplacement dans le fichier de test, attendu / reçu', () => {
  const summary = summarize('npx jest', fixture('jest'))
  assert.equal(summary.tool, 'jest')
  assert.deepEqual(
    summary.tests.map((entry) => [entry.name, entry.file, entry.line, entry.message]),
    [
      ['panier › additionne les lignes', 'src/sum.test.js', 2, 'expect(received).toBe(expected) // Object.is equality'],
      ['panier › applique la remise', 'src/sum.test.js', 3, 'expect(received).toEqual(expected) // deep equality'],
    ],
  )
  assert.equal(summary.tests[0]!.expected, '3')
  assert.equal(summary.tests[0]!.received, '2')
  assert.equal(summary.totals, 'Tests:       2 failed, 1 passed, 3 total')
  assert.deepEqual(summary.rerunArgs, ['-t', 'additionne les lignes|applique la remise'])
})

test('node:test, rapporteur « spec » d’un terminal : la section des échecs et l’arbre', () => {
  const summary = summarize('node --test', fixture('node-test'))
  assert.equal(summary.tool, 'node-test')
  assert.deepEqual(
    summary.tests.map((entry) => [entry.name, entry.file, entry.line, entry.expected, entry.received]),
    [
      ['panier › additionne les lignes', 'nt/cart.test.mjs', 4, '3', '2'],
      ['panier › applique la remise', 'nt/cart.test.mjs', 5, '{ total: 10 }', '{ total: 9 }'],
    ],
  )
  assert.equal(summary.tests[0]!.message, 'AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:')
  assert.equal(summary.totals, 'tests 3 · pass 1 · fail 2')
  assert.deepEqual(summary.rerunArgs, ['--test-name-pattern=additionne les lignes|applique la remise'])
})

test('node:test, rapporteur TAP', () => {
  const summary = summarize('node --test --test-reporter=tap', fixture('node-test-tap'))
  assert.deepEqual(
    summary.tests.map((entry) => [entry.name, entry.file, entry.line, entry.message, entry.expected, entry.received]),
    [
      ['panier › additionne les lignes', '/home/alex/nimbus/nt/cart.test.mjs', 4, 'Expected values to be strictly equal:', '3', '2'],
      ['panier › applique la remise', '/home/alex/nimbus/nt/cart.test.mjs', 5, 'Expected values to be strictly deep-equal:', undefined, undefined],
    ],
  )
  assert.equal(summary.totals, 'tests 3 · pass 1 · fail 2')
})

test('pytest : FAILED du résumé, ligne prise dans la section des échecs, --lf', () => {
  const summary = summarize('pytest', fixture('pytest'))
  assert.equal(summary.tool, 'pytest')
  assert.deepEqual(
    summary.tests.map((entry) => [entry.name, entry.file, entry.line, entry.message]),
    [
      ['test_total', 'tests/test_cart.py', 4, 'assert 2 == 3'],
      ['TestDiscount › test_applies', 'tests/test_cart.py', 12, "AssertionError: assert {'total': 9} == {'total': 10}"],
    ],
  )
  assert.equal(summary.totals, '2 failed, 3 passed in 0.04s')
  assert.deepEqual(summary.rerunArgs, ['--lf'])
})

test('eslint : groupé par fichier, ligne:col, gravité, règle', () => {
  const summary = summarize('pnpm lint', fixture('eslint'))
  assert.equal(summary.tool, 'eslint')
  assert.deepEqual(summary.lint.map((file) => [file.file, file.issues.length]), [
    ['/home/alex/nimbus/lint/a.js', 4],
    ['/home/alex/nimbus/lint/b.js', 2],
  ])
  assert.deepEqual(summary.lint[0]!.issues[2], {
    line: 2,
    col: 7,
    severity: 'warning',
    message: "Expected '===' and instead saw '=='",
    rule: 'eqeqeq',
  })
  assert.equal(summary.totals, '✖ 6 problems (4 errors, 2 warnings)')
  assert.equal(summary.rerunArgs, null)
})

test('eslint en cours (démo du prototype) : ce qui est déjà sorti, règles à barre oblique comprises', () => {
  const summary = summarize('pnpm --filter @solera/web lint', fixture('eslint-demo'))
  assert.deepEqual(summary.lint.map((file) => file.file), [
    'src/routes/prototype-automations/ActionsPage.tsx',
    'src/components/prototype/panel/ProtoSidePanel.tsx',
    'src/lib/dates.ts',
  ])
  assert.equal(summary.lint[1]!.issues[0]!.rule, 'react-hooks/exhaustive-deps')
  assert.equal(summary.totals, null)
})

test('tsc « pretty » d’un terminal, et tsc brut', () => {
  for (const name of ['tsc', 'tsc-plain']) {
    const summary = summarize('pnpm typecheck', fixture(name))
    assert.equal(summary.tool, 'tsc', name)
    assert.deepEqual(
      summary.lint.map((file) => [file.file, file.issues.map((issue) => `${issue.line}:${issue.col} ${issue.rule}`)]),
      [
        ['ts/a.ts', ['1:7 TS2322', '2:41 TS2551']],
        ['ts/b.ts', ['1:14 TS2322']],
      ],
      name,
    )
  }
  assert.equal(summarize('tsc', fixture('tsc')).totals, 'Found 3 errors in 2 files.')
})

test('relancer seulement les échecs : noms échappés, et jamais derrière un opérateur du shell', () => {
  const output = ' FAIL  src/a.test.ts > calcule (a+b)*2 [cas 1]\nAssertionError: non\n'
  assert.deepEqual(summarize('vitest run', output).rerunArgs, ['-t', 'calcule \\(a\\+b\\)\\*2 \\[cas 1\\]'])
  // Ajoutés en bout de commande, ils iraient à la dernière, pas aux tests.
  assert.equal(summarize('pnpm build && vitest run', output).rerunArgs, null)
  assert.equal(summarize('vitest run | tee log', output).rerunArgs, null)
})

test('une sortie inconnue ne casse rien', () => {
  const summary = summarize('pnpm build', '\x1b[32mvite v5\x1b[39m\r\n✓ built in 2s\r\n')
  assert.deepEqual(summary, { tool: 'other', tests: [], lint: [], totals: null, rerunArgs: null, base: null })
  assert.deepEqual(summarize('vitest', '').tests, [])
})

test('workspacePath : le chemin à ouvrir dans Fichiers, relatif à la racine de l’arbre', () => {
  const root = '/home/alex/nimbus'
  // Absolu, ou en `file://` (node:test) : la racine retirée.
  assert.equal(workspacePath('/home/alex/nimbus/lint/a.js', root, root), 'lint/a.js')
  assert.equal(workspacePath('file:///home/alex/nimbus/nt/cart.test.mjs', root, `${root}/`), 'nt/cart.test.mjs')
  // Relatif : au dossier de la commande, qui peut être un sous-dossier de l'arbre.
  assert.equal(workspacePath('src/a.test.ts', `${root}/apps/web`, root), 'apps/web/src/a.test.ts')
  assert.equal(workspacePath('./src/a.ts', root, root), 'src/a.ts')
  assert.equal(workspacePath('../shared/x.ts', `${root}/apps/web`, root), 'apps/shared/x.ts')
  // Hors de l'arbre : rendu tel quel, il ne s'ouvrira pas.
  assert.equal(workspacePath('/home/alex/nimbus-old/a.ts', root, root), null)
  assert.equal(workspacePath('src/a.ts', null, null), 'src/a.ts')
})

test('vitest : ses chemins sont relatifs à la racine qu’il annonce', () => {
  assert.equal(summarize('pnpm --filter web exec vitest run', fixture('vitest-demo')).base, '/home/tim/projects/solera/apps/web')
  assert.equal(summarize('pnpm lint', fixture('eslint')).base, null)
})

test('actionRoot : la racine de l’arbre, le sous-dossier de l’action retiré', () => {
  assert.equal(actionRoot('/home/alex/nimbus/apps/web', 'apps/web'), '/home/alex/nimbus')
  assert.equal(actionRoot('/home/alex/nimbus/apps/web', 'apps/web/'), '/home/alex/nimbus')
  assert.equal(actionRoot('/home/alex/nimbus', null), '/home/alex/nimbus')
  // Un sous-dossier qui ne termine pas le chemin : on ne devine pas.
  assert.equal(actionRoot('/home/alex/ailleurs', 'apps/web'), null)
})

test('lastLine et outputTail : la dernière ligne écrite, les N dernières lignes', () => {
  assert.equal(lastLine('\x1b[2m$ pnpm lint\x1b[0m\r\nsrc/a.ts\r\n  1:1  error  x\r\n\r\n'), '1:1  error  x')
  assert.equal(lastLine(''), null)
  assert.equal(lastLine(null), null)
  const many = Array.from({ length: 300 }, (_, index) => `ligne ${index}`).join('\r\n')
  const tail = outputTail(many, 200).split('\n')
  assert.equal(tail.length, 200)
  assert.equal(tail[0], 'ligne 100')
  assert.equal(tail.at(-1), 'ligne 299')
})
