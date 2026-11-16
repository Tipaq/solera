import { useQueryClient } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
import type { ProjectActionDto, TerminalDto, TerminalServerMessage } from '@solera/protocol'
import { ACTIONS_KEY } from '../../lib/actions'
import { commandRunsOf, type CommandRun } from '../../lib/command-runs'
import { TerminalSocketsProvider, type TerminalSocket } from '../../lib/terminal-output'
import { ACTIONS, PROJECT_ID } from '../actions/action-fixtures'

/**
 * Les commandes lancées depuis une conversation de démonstration : un lint qui tourne et
 * écrit ses lignes une à une, des tests qui viennent d'échouer, un typecheck réussi, une
 * attente arrêtée. Les stories préremplissent la liste des terminaux et rejouent leur
 * sortie par une fausse socket : rien ne part.
 */
export const CONVERSATION_ID = 'c-here'
const ROOT = '/srv/nimbus'
const now = Date.now()
const SEC = 1000

const TEST_OUTPUT = `\x1b[2m$ pnpm --filter @nimbus/web exec vitest run\x1b[0m\r
\r
 RUN  v3.2.4 /srv/nimbus/apps/web\r
\r
 ✓ src/lib/cron.test.ts (12 tests) 18ms\r
 ❯ src/lib/dates.test.ts (14 tests | 2 failed) 31ms\r
\r
 FAIL  src/lib/dates.test.ts > relativeDate > dit « demain » pour le lendemain\r
AssertionError: expected 'dans 1 j' to be 'demain' // Object.is equality\r
\r
Expected: "demain"\r
Received: "dans 1 j"\r
\r
 ❯ src/lib/dates.test.ts:42:31\r
\r
⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/2]⎯\r
\r
 FAIL  src/lib/dates.test.ts > relativeDate > passe à la semaine au-delà de 6 jours\r
AssertionError: expected 'dans 9 j' to be 'dans 1 sem.' // Object.is equality\r
\r
Expected: "dans 1 sem."\r
Received: "dans 9 j"\r
\r
 ❯ src/lib/dates.test.ts:57:39\r
\r
⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/2]⎯\r
\r
 Test Files  1 failed | 1 passed (2)\r
      Tests  2 failed | 24 passed (26)\r
\r
\x1b[2m[exit 1]\x1b[0m\r
`

const LINT_LINES = [
  '\x1b[2m$ pnpm --filter @nimbus/web lint\x1b[0m',
  '> eslint src --max-warnings 0',
  '',
  '/srv/nimbus/apps/web/src/routes/Forecast.tsx',
  "  48:10  warning  'AgendaVariant' is defined but never used  @typescript-eslint/no-unused-vars",
  '',
  '/srv/nimbus/apps/web/src/lib/dates.ts',
  "  88:15  error  'week' is assigned a value but never used  @typescript-eslint/no-unused-vars",
  "  91:3   error  Unexpected console statement                no-console",
]

const TYPECHECK_OUTPUT = '\x1b[2m$ pnpm --filter @nimbus/web typecheck\x1b[0m\r\n> tsc --noEmit\r\n\r\n\x1b[2m[exit 0]\x1b[0m\r\n'

const base: ProjectActionDto = ACTIONS.find((action) => action.id === 'a-tests')!
const task = (id: string, label: string, command: string): ProjectActionDto => ({ ...base, id, label, command, subdir: 'apps/web', lastRun: null })

export const RUN_ACTIONS: ProjectActionDto[] = [
  task('r-lint', 'Lint', 'pnpm --filter @nimbus/web lint'),
  task('r-tests', 'Tests unitaires', 'pnpm --filter @nimbus/web exec vitest run'),
  task('r-types', 'Typecheck du web', 'pnpm --filter @nimbus/web typecheck'),
  task('r-wait', 'Attendre la base', 'pnpm db:wait'),
]

const terminal = (id: string, actionId: string, extra: Partial<TerminalDto>): TerminalDto => ({
  id,
  title: actionId,
  alive: false,
  interrupted: false,
  cwd: `${ROOT}/apps/web`,
  conversationId: CONVERSATION_ID,
  createdAt: now,
  actionId,
  trial: false,
  exitCode: null,
  finishedAt: null,
  ...extra,
})

export const TERMINALS: TerminalDto[] = [
  terminal('t-lint', 'r-lint', { alive: true, createdAt: now - 38 * SEC }),
  terminal('t-tests', 'r-tests', { exitCode: 1, createdAt: now - 3 * 60 * SEC - 18 * SEC, finishedAt: now - 3 * 60 * SEC }),
  terminal('t-types', 'r-types', { exitCode: 0, createdAt: now - 12 * 60 * SEC - 9 * SEC, finishedAt: now - 12 * 60 * SEC }),
  terminal('t-wait', 'r-wait', { exitCode: 130, createdAt: now - 20 * 60 * SEC - 5 * SEC, finishedAt: now - 20 * 60 * SEC }),
]

export const RUNS: CommandRun[] = commandRunsOf(TERMINALS, RUN_ACTIONS, CONVERSATION_ID)
export const runOf = (terminalId: string): CommandRun => RUNS.find((run) => run.terminalId === terminalId)!

/** Une socket qui rejoue la sortie d'un terminal de démonstration ; le lint écrit ligne à ligne. */
function replaySocket(_projectId: string, terminalId: string): TerminalSocket {
  const timers: number[] = []
  const socket: TerminalSocket = {
    onmessage: null,
    onerror: null,
    close: () => timers.forEach((timer) => window.clearTimeout(timer)),
  }
  const send = (message: TerminalServerMessage) =>
    socket.onmessage?.call(socket as WebSocket, new MessageEvent('message', { data: JSON.stringify(message) }))
  const replay = terminalId === 't-tests' ? TEST_OUTPUT : terminalId === 't-types' ? TYPECHECK_OUTPUT : terminalId === 't-lint' ? `${LINT_LINES.slice(0, 5).join('\r\n')}\r\n` : ''
  timers.push(window.setTimeout(() => send({ t: 'ready', replay, cols: 120, rows: 30, exited: terminalId !== 't-lint' }), 50))
  if (terminalId === 't-lint') {
    LINT_LINES.slice(5).forEach((line, index) => {
      timers.push(window.setTimeout(() => send({ t: 'output', data: `${line}\r\n` }), 1200 * (index + 1)))
    })
  }
  return socket
}

export function SeededCommandRuns({ children }: { children: ReactNode }) {
  const client = useQueryClient()
  useState(() => {
    client.setQueryData(ACTIONS_KEY, [...ACTIONS, ...RUN_ACTIONS])
    client.setQueryData(['terminals', PROJECT_ID], TERMINALS)
    return null
  })
  return <TerminalSocketsProvider value={replaySocket}>{children}</TerminalSocketsProvider>
}

export { PROJECT_ID }
