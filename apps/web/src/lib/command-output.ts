/**
 * Lire la sortie d'une commande de projet pour dire **ce qui a échoué, et comment** : les
 * tests en échec (vitest, jest, node:test, pytest) et les erreurs de lint ou de typage
 * (eslint, tsc), dans les formats qu'ils écrivent dans un terminal.
 *
 * Tolérant : il prend ce qu'il reconnaît et ignore le reste. La sortie vient d'un pty,
 * avec ses couleurs, ses `\r\n` et les lignes qu'un rapporteur efface pour les réécrire
 * (« RUNS » de jest) : `screenText` la rejoue d'abord comme l'écran l'aurait montrée.
 *
 * Pur, sans React : testé par `apps/server/test/command-output.test.ts`, sur des sorties
 * réelles.
 */

export type ToolKind = 'vitest' | 'jest' | 'node-test' | 'pytest' | 'eslint' | 'tsc' | 'other'

export interface FailedTest {
  /** Le chemin du test : « suite › cas ». */
  name: string
  /** Fichier du test, tel que la sortie le donne (relatif, absolu ou `file://`). */
  file: string | null
  line: number | null
  message: string
  expected?: string
  received?: string
}

export interface LintIssue {
  line: number
  col: number
  severity: 'error' | 'warning'
  /** La règle eslint, ou le code `TS2322`. */
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
  /** eslint ou tsc : les problèmes, groupés par fichier. */
  lint: LintFile[]
  /** La ligne de bilan de l'outil (« Tests  3 failed | 41 passed (44) »). */
  totals: string | null
  /** Ce qu'il faut ajouter à la commande pour ne relancer que les échecs. */
  rerunArgs: string[] | null
  /** Le dossier auquel ses chemins relatifs se rapportent, quand l'outil le dit (vitest). */
  base: string | null
}

/* ------------------------------------------------------------------ l'écran */

/*
 * Une séquence de contrôle (CSI, OSC, ou ESC + un caractère), un caractère de contrôle
 * qui déplace le curseur, ou une suite de caractères à écrire.
 */
const TOKENS = /\x1b\[([0-9;?]*)[ -/]*([@-~])|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?|\x1b[()][0-9A-Za-z]|\x1b.?|\r|\n|\x08|[^\x1b\r\n\x08]+/g

/**
 * Les lignes telles que l'écran les montre : l'ANSI retiré, les retours chariot et les
 * effacements rejoués. Un terminal minimal — curseur, effacement de ligne et de bas
 * d'écran, montée et descente ; les positions absolues (`H`) sont ignorées, faute de
 * connaître la hauteur de l'écran.
 */
export function screenLines(raw: string): string[] {
  const lines: string[] = ['']
  let row = 0
  let col = 0
  const write = (text: string) => {
    const line = lines[row] ?? ''
    lines[row] = line.slice(0, col).padEnd(col) + text + line.slice(col + text.length)
    col += text.length
  }
  for (const match of raw.matchAll(TOKENS)) {
    const token = match[0]
    if (token === '\n') {
      row += 1
      col = 0
      while (lines.length <= row) lines.push('')
    } else if (token === '\r') col = 0
    else if (token === '\x08') col = Math.max(0, col - 1)
    else if (match[2] !== undefined) {
      const params = match[1] ?? ''
      if (params.startsWith('?')) continue
      const n = Number(params.split(';')[0]) || 0
      const line = lines[row] ?? ''
      switch (match[2]) {
        case 'A':
          row = Math.max(0, row - Math.max(1, n))
          break
        case 'B':
          row += Math.max(1, n)
          while (lines.length <= row) lines.push('')
          break
        case 'C':
          col += Math.max(1, n)
          break
        case 'D':
          col = Math.max(0, col - Math.max(1, n))
          break
        case 'G':
          col = Math.max(0, n - 1)
          break
        case 'K':
          lines[row] = n === 2 ? '' : n === 1 ? ' '.repeat(col) + line.slice(col) : line.slice(0, col)
          break
        case 'J':
          if (n === 0) {
            lines[row] = line.slice(0, col)
            lines.length = row + 1
          } else if (n >= 2) {
            lines.length = 0
            lines.push('')
            row = 0
            col = 0
          }
          break
      }
    } else if (token[0] !== '\x1b') write(token)
  }
  return lines.map((line) => line.trimEnd())
}

/** Le texte de l'écran, en une chaîne. */
export function screenText(raw: string): string {
  return screenLines(raw).join('\n')
}

/** Les `count` dernières lignes de l'écran, sans les lignes vides de la fin. */
export function outputTail(raw: string, count: number): string {
  const lines = screenLines(raw)
  while (lines.length > 0 && lines.at(-1) === '') lines.pop()
  return lines.slice(-count).join('\n')
}

/** La dernière ligne écrite, pour dire où en est une commande qui tourne. */
export function lastLine(raw: string | null): string | null {
  if (!raw) return null
  const lines = screenLines(raw)
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]!.trim()
    if (line) return line
  }
  return null
}

/**
 * La commande qui a vraiment tourné : la première ligne que le serveur écrit en tête du
 * terminal (`$ …`), arguments de relance compris. Null sans en-tête.
 */
export function commandLine(raw: string | null): string | null {
  if (!raw) return null
  const first = screenLines(raw.slice(0, 4096)).find((line) => line.trim())
  return first?.startsWith('$ ') ? first.slice(2) : null
}

/** Un chemin absolu, ses `.` et `..` résolus. */
function normalize(path: string): string {
  const parts: string[] = []
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }
  return `/${parts.join('/')}`
}

/**
 * Le chemin à ouvrir dans Fichiers, relatif à la racine de l'arbre (`root`). Un chemin
 * relatif l'est au dossier d'où l'outil parle (`base`) : celui de la commande, ou la
 * racine que vitest annonce. Null pour un fichier hors de l'arbre, qui ne s'ouvrirait
 * pas ; sans racine connue, le chemin tel que la sortie le donne.
 */
export function workspacePath(path: string, base: string | null, root: string | null): string | null {
  let next = path.replace(/^file:\/\//, '')
  if (!root) return next.replace(/^\.\//, '')
  if (!next.startsWith('/')) next = `${base ?? root}/${next}`
  next = normalize(next)
  const top = normalize(root)
  return next.startsWith(`${top}/`) ? next.slice(top.length + 1) : null
}

/**
 * La racine de l'arbre d'un terminal d'action : son dossier, moins le sous-dossier où
 * l'action se joue. Null quand le dossier ne finit pas par lui : on ne devine pas.
 */
export function actionRoot(cwd: string, subdir: string | null): string | null {
  const dir = cwd.replace(/\/+$/, '')
  const sub = subdir?.replace(/^\/+|\/+$/g, '')
  if (!sub) return dir
  return dir.endsWith(`/${sub}`) ? dir.slice(0, -sub.length - 1) : null
}

/* ------------------------------------------------------------------ l'outil */

export function detectTool(command: string, text: string): ToolKind {
  const c = command.toLowerCase()
  if (/\bvitest\b/.test(c)) return 'vitest'
  if (/\bjest\b/.test(c)) return 'jest'
  if (/\b(node|tsx|bun)\b.*\s--test\b/.test(c)) return 'node-test'
  if (/\bpytest\b/.test(c)) return 'pytest'
  if (/\beslint\b/.test(c)) return 'eslint'
  if (/\b(tsc|vue-tsc)\b/.test(c)) return 'tsc'
  // `pnpm test`, `make lint` : la sortie le dit.
  if (/^ RUN {2}v\d|^ Test Files |^ FAIL {2}.* > /m.test(text)) return 'vitest'
  if (/^Tests:\s+\d+/m.test(text) || /^\s*● /m.test(text)) return 'jest'
  if (/^TAP version|^ℹ (tests|fail) \d+$|^✖ failing tests:$/m.test(text)) return 'node-test'
  if (/^=+ (FAILURES|short test summary info|test session starts) =+$/m.test(text) || /^FAILED \S+::/m.test(text)) return 'pytest'
  if (/error TS\d+:/.test(text)) return 'tsc'
  if (/^\s+\d+:\d+\s+(error|warning)\s+/m.test(text) || /✖ \d+ problems? /.test(text)) return 'eslint'
  if (/\btypecheck\b/.test(c)) return 'tsc'
  if (/\blint\b/.test(c)) return 'eslint'
  return 'other'
}

/* ------------------------------------------------------------------ les tests */

/** Lit les lignes à partir de `start` jusqu'à `stop` (exclue). */
function block(lines: string[], start: number, stop: (line: string) => boolean): string[] {
  const out: string[] = []
  for (let index = start; index < lines.length && !stop(lines[index]!); index += 1) out.push(lines[index]!)
  return out
}

function parseVitest(lines: string[]): FailedTest[] {
  const tests: FailedTest[] = []
  lines.forEach((line, index) => {
    const head = line.match(/^\s*FAIL\s+(\S+?)\s+>\s+(.+)$/)
    if (!head) return
    const test: FailedTest = { name: head[2]!.replace(/\s+>\s+/g, ' › '), file: head[1]!, line: null, message: '' }
    let diff = false
    for (const next of block(lines, index + 1, (entry) => /^\s*FAIL\s+/.test(entry) || /^[⎯-]{6,}/.test(entry.trim()))) {
      const text = next.trim()
      if (!test.message && text) test.message = text
      if (/^- Expected/.test(text)) diff = true
      const expected = text.match(/^Expected:\s*(.*)$/) ?? (diff ? text.match(/^- (?!Expected)\s*(.*)$/) : null)
      const received = text.match(/^Received:\s*(.*)$/) ?? (diff ? text.match(/^\+ (?!Received)\s*(.*)$/) : null)
      if (expected && test.expected === undefined) test.expected = expected[1]!.trim()
      if (received && test.received === undefined) test.received = received[1]!.trim()
      const where = text.match(/^❯\s+(\S+?):(\d+):\d+/)
      if (where && test.line === null) {
        test.file = where[1]!
        test.line = Number(where[2])
      }
    }
    tests.push(test)
  })
  return tests
}

function parseJest(lines: string[]): FailedTest[] {
  const tests: FailedTest[] = []
  lines.forEach((line, index) => {
    const head = line.match(/^\s*● (.+)$/)
    if (!head || /Test suite failed to run/.test(head[1]!)) return
    const test: FailedTest = { name: head[1]!.trim(), file: null, line: null, message: '' }
    for (const next of block(lines, index + 1, (entry) => /^\s*● /.test(entry) || /^(Test Suites|Tests):/.test(entry))) {
      const text = next.trim()
      if (!test.message && text) test.message = text
      const expected = text.match(/^Expected:\s*(.*)$/)
      const received = text.match(/^Received:\s*(.*)$/)
      if (expected && test.expected === undefined) test.expected = expected[1]
      if (received && test.received === undefined) test.received = received[1]
      const where = text.match(/^at .*?\(?([^\s()]+):(\d+):\d+\)?$/)
      if (where && test.line === null && !/node_modules|node:internal/.test(where[1]!)) {
        test.file = where[1]!
        test.line = Number(where[2])
      }
    }
    tests.push(test)
  })
  return tests
}

/** Une valeur de l'objet d'erreur d'`assert` (`actual: 2,`), quand elle tient sur la ligne. */
function inlineValue(text: string): string | undefined {
  const value = text.replace(/,$/, '').trim()
  return value && !/^[[{]$/.test(value) ? value : undefined
}

/**
 * node:test dans un terminal : le rapporteur « spec ». Les cas en échec sont redits sous
 * « ✖ failing tests: », avec leur emplacement mais sans leurs suites, qu'on retrouve dans
 * l'arbre au-dessus, par l'indentation.
 */
function parseNodeSpec(lines: string[]): FailedTest[] {
  const section = lines.findIndex((line) => /^✖ failing tests:$/.test(line.trim()))
  if (section === -1) return []
  // L'arbre : chaque cas en échec avec ses suites.
  const paths: string[] = []
  const stack: string[] = []
  for (const line of lines.slice(0, section)) {
    const node = line.match(/^(\s*)([▶✖✔﹣])\s+(.+?)(?:\s+\([\d.]+m?s\))?$/)
    if (!node) continue
    const depth = Math.floor(node[1]!.length / 2)
    stack.length = depth
    stack[depth] = node[3]!
    if (node[2] === '✖' && /\([\d.]+m?s\)$/.test(line)) paths.push(stack.join(' › '))
  }
  const tests: FailedTest[] = []
  lines.slice(section + 1).forEach((line, offset, rest) => {
    const at = line.match(/^test at (.+?):(\d+):\d+$/)
    if (!at) return
    const body = block(rest, offset + 1, (entry) => /^test at /.test(entry))
    const title = body[0]?.match(/^✖\s+(.+?)(?:\s+\([\d.]+m?s\))?$/)?.[1] ?? ''
    const found = paths.findIndex((path) => path === title || path.endsWith(` › ${title}`))
    const name = found === -1 ? title : paths.splice(found, 1)[0]!
    const test: FailedTest = { name, file: at[1]!, line: Number(at[2]), message: body[1]?.trim() ?? '' }
    for (const next of body.slice(2)) {
      const actual = next.match(/^\s*actual:\s*(.*)$/)
      const expected = next.match(/^\s*expected:\s*(.*)$/)
      if (actual && test.received === undefined) test.received = inlineValue(actual[1]!)
      if (expected && test.expected === undefined) test.expected = inlineValue(expected[1]!)
    }
    tests.push(test)
  })
  return tests
}

/** node:test avec `--test-reporter=tap`. Les suites sont des `# Subtest:` englobants. */
function parseNodeTap(lines: string[]): FailedTest[] {
  const tests: FailedTest[] = []
  const stack: string[] = []
  lines.forEach((line, index) => {
    const subtest = line.match(/^(\s*)# Subtest: (.+)$/)
    if (subtest) {
      const depth = Math.floor(subtest[1]!.length / 4)
      stack.length = depth
      stack[depth] = subtest[2]!
      return
    }
    const head = line.match(/^(\s*)not ok \d+ - (.+?)(?:\s+#.*)?$/)
    if (!head) return
    const depth = Math.floor(head[1]!.length / 4)
    const body = block(lines, index + 1, (entry) => /^\s*\.\.\.$/.test(entry))
    if (body.some((entry) => /^\s*type:\s*'suite'/.test(entry))) return
    const test: FailedTest = { name: [...stack.slice(0, depth), head[2]!].join(' › '), file: null, line: null, message: '' }
    body.forEach((entry, at) => {
      const error = entry.match(/^\s*error:\s*(.*)$/)
      if (error && !test.message) {
        const value = error[1]!.trim()
        test.message = /^[|>]-?$/.test(value) ? (body[at + 1]?.trim() ?? '') : value.replace(/^'|'$/g, '')
      }
      const expected = entry.match(/^\s*expected:\s*(.*)$/)
      const actual = entry.match(/^\s*actual:\s*(.*)$/)
      if (expected && test.expected === undefined) test.expected = inlineValue(expected[1]!)
      if (actual && test.received === undefined) test.received = inlineValue(actual[1]!)
      const where = entry.match(/^\s*location:\s*'?(.+?):(\d+):\d+'?$/)
      if (where) {
        test.file = where[1]!
        test.line = Number(where[2])
      }
    })
    tests.push(test)
  })
  return tests
}

function parsePytest(lines: string[]): FailedTest[] {
  // La ligne de chaque échec, dans la section FAILURES : « ___ Classe.cas ___ » puis
  // « fichier.py:12: AssertionError ».
  const lineOf = new Map<string, number>()
  let current: string | null = null
  for (const line of lines) {
    const header = line.match(/^_{3,} (.+?) _{3,}$/)
    if (header) current = header[1]!
    const where = line.match(/^(\S+\.py):(\d+): /)
    if (where && current && !lineOf.has(current)) lineOf.set(current, Number(where[2]))
  }
  return lines.flatMap((line) => {
    const match = line.match(/^FAILED (\S+?)::(\S+)(?: - (.*))?$/)
    if (!match) return []
    const id = match[2]!
    return [{ name: id.replace(/::/g, ' › '), file: match[1]!, line: lineOf.get(id.replace(/::/g, '.')) ?? null, message: match[3] ?? '' }]
  })
}

/* ------------------------------------------------------------------ lint, typage */

function parseEslint(lines: string[]): LintFile[] {
  const files: LintFile[] = []
  let current: LintFile | null = null
  for (const line of lines) {
    if (/^[^\s>✖].*\.[A-Za-z0-9]+$/.test(line) && !/\s{2,}/.test(line)) {
      current = { file: line, issues: [] }
      files.push(current)
      continue
    }
    const issue = line.match(/^\s+(\d+):(\d+)\s+(error|warning)\s+(.+?)(?:\s{2,}(\S+))?\s*$/)
    if (issue && current) {
      current.issues.push({
        line: Number(issue[1]),
        col: Number(issue[2]),
        severity: issue[3] as LintIssue['severity'],
        message: issue[4]!,
        rule: issue[5] ?? null,
      })
    }
  }
  return files.filter((file) => file.issues.length > 0)
}

function parseTsc(lines: string[]): LintFile[] {
  const byFile = new Map<string, LintFile>()
  for (const line of lines) {
    const match =
      line.match(/^(\S.*?)\((\d+),(\d+)\):\s+(error|warning)\s+(TS\d+):\s+(.*)$/) ??
      line.match(/^(\S.*?):(\d+):(\d+)\s+-\s+(error|warning)\s+(TS\d+):\s+(.*)$/)
    if (!match) continue
    const file = match[1]!
    const entry = byFile.get(file) ?? { file, issues: [] }
    entry.issues.push({
      line: Number(match[2]),
      col: Number(match[3]),
      severity: match[4] as LintIssue['severity'],
      rule: match[5]!,
      message: match[6]!,
    })
    byFile.set(file, entry)
  }
  return [...byFile.values()]
}

/* ------------------------------------------------------------------ le bilan */

function lastMatch(text: string, pattern: RegExp): string | null {
  const all = [...text.matchAll(pattern)]
  return all.at(-1)?.[1]?.trim() ?? null
}

function totalsOf(tool: ToolKind, text: string): string | null {
  switch (tool) {
    case 'vitest':
      // Le dernier : vitest réécrit son bilan à chaque fichier.
      return lastMatch(text, /^\s*(Tests\s+.*\(\d+\))\s*$/gm)
    case 'jest':
      return lastMatch(text, /^(Tests:\s+.*total)\s*$/gm)
    case 'node-test': {
      const counts = ['tests', 'pass', 'fail'].flatMap((name) => {
        const value = lastMatch(text, new RegExp(`^[ℹ#] ${name} (\\d+)$`, 'gm'))
        return value === null ? [] : [`${name} ${value}`]
      })
      return counts.length > 0 ? counts.join(' · ') : null
    }
    case 'pytest':
      return lastMatch(text, /^=+ (.*(?:failed|passed|error).* in [\d.]+s(?: \([^)]*\))?) =+$/gm)
    case 'eslint':
      return lastMatch(text, /^(✖ \d+ problems? .*)$/gm)
    case 'tsc':
      return lastMatch(text, /^(Found \d+ errors?\b.*)$/gm)
    default:
      return null
  }
}

const REGEX_SPECIALS = /[.*+?^${}()|[\]\\]/g

/**
 * Les arguments qui ne relancent que les échecs, ajoutés en bout de commande par le
 * serveur (`args` d'un lancement). Rien quand la commande en enchaîne plusieurs : ils
 * iraient à la dernière, pas forcément aux tests.
 */
function rerunArgsOf(command: string, tool: ToolKind, tests: FailedTest[]): string[] | null {
  if (tests.length === 0 || /&&|\|\||[;|`]|\$\(/.test(command)) return null
  const names = [...new Set(tests.map((test) => test.name.split(' › ').at(-1)!.trim()).filter(Boolean))]
  const pattern = names.map((name) => name.replace(REGEX_SPECIALS, '\\$&')).join('|')
  const args =
    tool === 'vitest' || tool === 'jest'
      ? ['-t', pattern]
      : tool === 'node-test'
        ? [`--test-name-pattern=${pattern}`]
        : tool === 'pytest'
          ? ['--lf']
          : null
  // `npm test` garde pour lui les options qui ne suivent pas `--` (pnpm et yarn les passent).
  const npmScript = /^npm\s+(test|t|run\s+\S+|run-script\s+\S+)\b/.test(command.trim()) && !/\s--(\s|$)/.test(command)
  return args && npmScript ? ['--', ...args] : args
}

/** Les tests en double (jest les redit sous « Summary of all failing tests ») ne comptent qu'une fois. */
function unique(tests: FailedTest[]): FailedTest[] {
  const seen = new Set<string>()
  return tests.filter((test) => {
    const key = `${test.file ?? ''}\u0000${test.name}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function summarize(command: string, raw: string): OutputSummary {
  const lines = screenLines(raw)
  const text = lines.join('\n')
  const tool = detectTool(command, text)
  const tests = unique(
    tool === 'vitest'
      ? parseVitest(lines)
      : tool === 'jest'
        ? parseJest(lines)
        : tool === 'node-test'
          ? /^TAP version/m.test(text) ? parseNodeTap(lines) : parseNodeSpec(lines)
          : tool === 'pytest'
            ? parsePytest(lines)
            : [],
  )
  const lint = tool === 'eslint' ? parseEslint(lines) : tool === 'tsc' ? parseTsc(lines) : []
  const base = tool === 'vitest' ? (text.match(/^ RUN {2}v\S+ (\/.*)$/m)?.[1]?.trim() ?? null) : null
  return { tool, tests, lint, totals: totalsOf(tool, text), rerunArgs: rerunArgsOf(command, tool, tests), base }
}

/** Les problèmes de lint ou de typage, tous fichiers confondus. */
export function issueCount(summary: OutputSummary): number {
  return summary.lint.reduce((sum, file) => sum + file.issues.length, 0)
}
