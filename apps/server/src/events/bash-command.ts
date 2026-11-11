/**
 * La commande d'un appel `Bash`, le nom canonique d'une exécution quel que soit le CLI
 * (`CANONICAL_TOOLS`) ; null pour tout autre outil, ou un argument d'une autre forme.
 */
export function bashCommand(call: { name: string; input?: unknown }): string | null {
  const command = (call.input as { command?: unknown } | null)?.command
  return call.name === 'Bash' && typeof command === 'string' ? command : null
}
