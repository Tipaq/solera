import type { TerminalDto } from '@solera/protocol'
import type { StatusTone } from '@solera/ui'

/**
 * Le point d'une pastille de terminal. Sans lui, un shell dont le process est mort
 * ressemble à un onglet inactif ; et une commande d'action sortie en erreur doit se
 * voir sans ouvrir son onglet.
 */
export function terminalTone(terminal: TerminalDto): StatusTone {
  if (terminal.alive) return 'positive'
  return terminal.exitCode ? 'critical' : 'neutral'
}

/**
 * Où tourne ce shell, tel que sa pastille le dit : null pour le workspace du projet,
 * que l'appelant nomme, sinon le nom du dossier — celui du worktree.
 */
export function terminalDir(terminal: TerminalDto, workspacePath: string | undefined): string | null {
  if (terminal.cwd === workspacePath) return null
  return terminal.cwd.split('/').filter(Boolean).pop() ?? terminal.cwd
}
