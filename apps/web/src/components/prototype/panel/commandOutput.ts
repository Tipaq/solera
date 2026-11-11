/* PROTOTYPE — jetable (branche proto/page-projet). Ne pas fusionner dans main.
 *
 * Lire la sortie d'une commande de projet pour dire **ce qui a échoué, et comment** :
 * les tests en échec (vitest, jest, node:test, pytest) et les erreurs de lint ou de
 * typage (eslint, tsc), dans leurs formats par défaut. Un parseur tolérant : il prend ce
 * qu'il reconnaît et rend toujours les dernières lignes, pour le reste.
 */

export type ToolKind = 'vitest' | 'jest' | 'node-test' | 'pytest' | 'eslint' | 'tsc' | 'other'

export interface FailedTest {
  /** Fichier du test, relatif quand la sortie le donne ainsi. */
  file: string | null
  line: number | null
  /** Le chemin du test : « suite › cas ». */
  name: string
  message: string
  expected?: string
  received?: string
}

export interface LintIssue {
  line: number
  col: number
  severity: 'error' | 'warning'
  rule: string | null
  message: string
}

export interface LintFile {
  file: string
  issues: LintIssue[]
}

export interface OutputSummary {
  tool: ToolKind
  tests: FailedTest[]
  lint: LintFile[]
  /** La ligne de bilan de l'outil (« Tests 3 failed | 41 passed (44) »). */
  totals: string | null
  /** Les dernières lignes, toujours. */
  tail: string[]
  /** L'outil sait-il relancer seulement les échecs, et avec quoi. */
  rerunFailed: string | null
}

const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007]*(\u0007|\u001b\\)|\r/g

export function stripAnsi(text: string): string {
  return text.replace(ANSI, '')
}

export function detectTool(command: string, output: string): ToolKind {
  const c = command.toLowerCase()
  if (/\bvitest\b/.test(c)) return 'vitest'
  if (/\bjest\b/.test(c)) return 'jest'
  if (/node\b.*--test\b/.test(c)) return 'node-test'
  if (/\bpytest\b/.test(c)) return 'pytest'
  if (/\beslint\b/.test(c)) return 'eslint'
  if (/\btsc\b|typecheck/.test(c)) return 'tsc'
  // `pnpm test`, `pnpm lint` : on regarde la sortie.
  if (/ RUN  v\d|Test Files |✓ .*\(\d+ tests?\)/.test(output) || / FAIL  .* > /.test(output)) return 'vitest'
  if (/^Tests:\s+\d+/m.test(output) || /^\s*● /m.test(output)) return 'jest'
  if (/^TAP version|^not ok \d+ - /m.test(output)) return 'node-test'
  if (/^=+ (FAILURES|short test summary info) =+$/m.test(output) || /^FAILED .+::/m.test(output)) return 'pytest'
  if (/error TS\d+:/.test(output)) return 'tsc'
  if (/^\s+\d+:\d+\s+(error|warning)\s+/m.test(output) || /✖ \d+ problems?/.test(output)) return 'eslint'
  if (/\blint\b/.test(c)) return 'eslint'
  if (/\btest\b/.test(c)) return 'vitest'
  return 'other'
}

function location(text: string): { file: string; line: number } | null {
  const match = text.match(/([\w./@-]+\.(?:[cm]?[jt]sx?|py|vue|svelte)):(\d+)(?::\d+)?/)
  return match ? { file: match[1]!, line: Number(match[2]) } : null
}

function parseVitest(lines: string[]): FailedTest[] {
  const tests: FailedTest[] = []
  for (let index = 0; index < lines.length; index += 1) {
    const head = lines[index]!.match(/^\s*FAIL\s+(\S+?)\s+>\s+(.+)$/)
    if (!head) continue
    const test: FailedTest = { file: head[1]!, line: null, name: head[2]!.replace(/\s+>\s+/g, ' › '), message: '' }
    for (let next = index + 1; next < lines.length && !/^\s*FAIL\s+/.test(lines[next]!) && !/^[⎯-]{6,}/.test(lines[next]!.trim()); next += 1) {
      const line = lines[next]!
      if (!test.message && line.trim() && !/^\s*[-+] (Expected|Received)$/.test(line)) test.message = line.trim()
      const minus = line.match(/^\s*- (?!Expected)(.*)$/)
      const plus = line.match(/^\s*\+ (?!Received)(.*)$/)
      if (minus && test.expected === undefined) test.expected = minus[1]
      if (plus && test.received === undefined) test.received = plus[1]
      const where = line.match(/❯\s+(\S+):(\d+):\d+/)
      if (where && test.line === null) {
        test.file = where[1]!
        test.line = Number(where[2])
      }
    }
    tests.push(test)
  }
  return tests
}

function parseJest(lines: string[]): FailedTest[] {
  const tests: FailedTest[] = []
  for (let index = 0; index < lines.length; index += 1) {
    const head = lines[index]!.match(/^\s*● (.+)$/)
    if (!head || /Test suite failed to run/.test(head[1]!)) continue
    const test: FailedTest = { file: null, line: null, name: head[1]!, message: '' }
    for (let next = index + 1; next < lines.length && !/^\s*● /.test(lines[next]!); next += 1) {
      const line = lines[next]!
      if (!test.message && line.trim()) test.message = line.trim()
      const expected = line.match(/^\s*Expected:\s*(.*)$/)
      const received = line.match(/^\s*Received:\s*(.*)$/)
      if (expected) test.expected = expected[1]
      if (received) test.received = received[1]
      const where = line.match(/\(([^()]+):(\d+):\d+\)/)
      if (where && test.line === null && !/node_modules/.test(where[1]!)) {
        test.file = where[1]!
        test.line = Number(where[2])
      }
    }
    tests.push(test)
  }
  return tests
}

function parseNodeTest(lines: string[]): FailedTest[] {
  const tests: FailedTest[] = []
  for (let index = 0; index < lines.length; index += 1) {
    const head = lines[index]!.match(/^\s*not ok \d+ - (.+)$/)
    if (!head) continue
    const test: FailedTest = { file: null, line: null, name: head[1]!, message: '' }
    for (let next = index + 1; next < lines.length && !/^\s*(not )?ok \d+ - /.test(lines[next]!); next += 1) {
      const line = lines[next]!
      const error = line.match(/^\s*error:\s*['|>-]*\s*(.*?)'?$/)
      if (error && !test.message) test.message = error[1]!
      const expected = line.match(/^\s*expected:\s*(.*)$/)
      const actual = line.match(/^\s*actual:\s*(.*)$/)
      if (expected) test.expected = expected[1]
      if (actual) test.received = actual[1]
      const where = line.match(/^\s*location:\s*'?(.+?):(\d+):\d+'?$/)
      if (where) {
        test.file = where[1]!
        test.line = Number(where[2])
      }
    }
    tests.push(test)
  }
  return tests
}

function parsePytest(lines: string[]): FailedTest[] {
  return lines.flatMap((line) => {
    const match = line.match(/^FAILED (\S+?)::(\S+)(?: - (.*))?$/)
    if (!match) return []
    return [{ file: match[1]!, line: null, name: match[2]!.replace(/::/g, ' › '), message: match[3] ?? '' }]
  })
}

function parseEslint(lines: string[]): LintFile[] {
  const files: LintFile[] = []
  let current: LintFile | null = null
  for (const line of lines) {
    if (/^\S.*\.(?:[cm]?[jt]sx?|vue|svelte|json|md)$/.test(line.trim()) && !/\s{2,}/.test(line.trim())) {
      current = { file: line.trim(), issues: [] }
      files.push(current)
      continue
    }
    const issue = line.match(/^\s+(\d+):(\d+)\s+(error|warning)\s+(.+?)(?:\s{2,}(\S+))?\s*$/)
    if (issue && current) {
      current.issues.push({ line: Number(issue[1]), col: Number(issue[2]), severity: issue[3] as 'error' | 'warning', message: issue[4]!, rule: issue[5] ?? null })
    }
  }
  return files.filter((file) => file.issues.length > 0)
}

function parseTsc(lines: string[]): LintFile[] {
  const byFile = new Map<string, LintFile>()
  for (const line of lines) {
    const match = line.match(/^(.+?)\((\d+),(\d+)\):\s+(error|warning)\s+(TS\d+):\s+(.*)$/) ?? line.match(/^(.+?):(\d+):(\d+)\s+-\s+(error|warning)\s+(TS\d+):\s+(.*)$/)
    if (!match) continue
    const file = match[1]!.trim()
    const entry = byFile.get(file) ?? { file, issues: [] }
    entry.issues.push({ line: Number(match[2]), col: Number(match[3]), severity: match[4] as 'error' | 'warning', rule: match[5]!, message: match[6]! })
    byFile.set(file, entry)
  }
  return [...byFile.values()]
}

const TOTALS: RegExp[] = [
  /^\s*Tests\s+.*\(\d+\)\s*$/m, // vitest
  /^Tests:\s+.*total\s*$/m, // jest
  /^# (fail|pass) \d+$/m, // node:test
  /^=+ .*(failed|passed).* in [\d.]+s =+$/m, // pytest
  /✖ \d+ problems? .*$/m, // eslint
  /^Found \d+ errors? .*$/m, // tsc
]

export function summarize(command: string, raw: string): OutputSummary {
  const text = stripAnsi(raw)
  const lines = text.split('\n')
  const tool = detectTool(command, text)
  const tests = tool === 'vitest' ? parseVitest(lines) : tool === 'jest' ? parseJest(lines) : tool === 'node-test' ? parseNodeTest(lines) : tool === 'pytest' ? parsePytest(lines) : []
  const lint = tool === 'eslint' ? parseEslint(lines) : tool === 'tsc' ? parseTsc(lines) : []
  const totals = TOTALS.map((pattern) => text.match(pattern)?.[0]?.trim() ?? null).find(Boolean) ?? null
  const failedNames = tests.map((test) => test.name.split(' › ').pop()!).filter(Boolean)
  const rerunFailed =
    tests.length === 0 ? null
      : tool === 'vitest' ? `${command} -t "${failedNames.join('|')}"`
        : tool === 'jest' ? `${command} -t "${failedNames.join('|')}"`
          : tool === 'pytest' ? `${command} --lf`
            : tool === 'node-test' ? `${command} --test-name-pattern="${failedNames.join('|')}"`
              : null
  return { tool, tests, lint, totals, tail: lines.filter((line) => line.trim()).slice(-40), rerunFailed }
}

/** Un chemin cliquable : relatif au worktree, sans `./`. */
export function relativePath(path: string, cwd: string | null): string {
  let next = path.replace(/^\.\//, '')
  if (cwd && next.startsWith(cwd)) next = next.slice(cwd.length).replace(/^\/+/, '')
  return next
}

export { location }

/* ------------------------------------------------------------------ démo */

export const DEMO_TEST_OUTPUT = `
 RUN  v2.1.8 /home/tim/projects/solera/apps/web

 ✓ src/lib/cron.test.ts (12 tests) 18ms
 ✓ src/lib/activity-groups.test.ts (9 tests) 7ms
 ❯ src/lib/dates.test.ts (14 tests | 2 failed) 31ms
   × relativeDate > dit « demain » pour le lendemain 9ms
   × relativeDate > passe à la semaine au-delà de 6 jours 4ms
 ❯ src/lib/project-visits.test.ts (6 tests | 1 failed) 12ms
   × rememberVisit > ne garde que les 20 derniers projets 6ms
 ✓ src/lib/signals.test.ts (11 tests) 9ms

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 3 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  src/lib/dates.test.ts > relativeDate > dit « demain » pour le lendemain
AssertionError: expected 'dans 1 j' to be 'demain' // Object.is equality

- Expected
+ Received

- demain
+ dans 1 j

 ❯ src/lib/dates.test.ts:42:31
     40|   it('dit « demain » pour le lendemain', () => {
     41|     const tomorrow = startOfDay(Date.now()) + DAY + 9 * HOUR
     42|     expect(relativeDate(tomorrow)).toBe('demain')
       |                               ^
     43|   })

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/3]⎯

 FAIL  src/lib/dates.test.ts > relativeDate > passe à la semaine au-delà de 6 jours
AssertionError: expected 'dans 9 j' to be 'dans 1 sem.' // Object.is equality

- Expected
+ Received

- dans 1 sem.
+ dans 9 j

 ❯ src/lib/dates.test.ts:57:39

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/3]⎯

 FAIL  src/lib/project-visits.test.ts > rememberVisit > ne garde que les 20 derniers projets
AssertionError: expected [ …(21) ] to have a length of 20 but got 21

- Expected
+ Received

- 20
+ 21

 ❯ src/lib/project-visits.test.ts:28:22

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[3/3]⎯

 Test Files  2 failed | 3 passed (5)
      Tests  3 failed | 49 passed (52)
   Start at  16:41:07
   Duration  1.82s (transform 412ms, setup 0ms, collect 1.21s, tests 79ms)
`

export const DEMO_TYPECHECK_OUTPUT = `
> @solera/web@0.20.1 typecheck /home/tim/projects/solera/apps/web
> tsc --noEmit

`

/** Le lint qui tourne : ses lignes arrivent une à une. */
export const DEMO_LINT_LINES = [
  '> @solera/web@0.20.1 lint /home/tim/projects/solera/apps/web',
  '> eslint src --max-warnings 0',
  '',
  'src/routes/prototype-automations/ActionsPage.tsx',
  "  48:10  warning  'AgendaVariant' is defined but never used  @typescript-eslint/no-unused-vars",
  '',
  'src/components/prototype/panel/ProtoSidePanel.tsx',
  "  212:6  error  React Hook useCallback has a missing dependency: 'aside'  react-hooks/exhaustive-deps",
  '',
  'src/lib/dates.ts',
  "  88:15  error  'week' is assigned a value but never used  @typescript-eslint/no-unused-vars",
  '',
  'Vérification de 214 fichiers sur 240…',
]
