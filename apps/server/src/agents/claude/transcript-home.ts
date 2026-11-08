import { join } from 'node:path'
import type { ConversationRow } from '@solera/db'
import type { Paths } from '../../config.js'
import { containerHomes } from '../../environments/devcontainer/containers.js'
import { containerPathOf } from '../../environments/devcontainer/paths.js'
import { hostTranscripts, type TranscriptHome } from './transcript.js'

/** Le `CLAUDE_CONFIG_DIR` des sessions Claude d'un utilisateur dans un dev container, en chemin de l'hôte. */
export function containerClaudeHome(paths: Paths, userId: string): string {
  return join(containerHomes(paths), userId, 'claude')
}

/**
 * Où trouver les transcripts d'une session, selon l'environnement où elle tourne (#154).
 *
 * Dans un dev container, le CLI les écrit sous le dossier que Solera lui monte, au nom
 * du cwd vu de l'intérieur. Confinée, la session a son conteneur ou son bac à sable à
 * elle, et le dossier du cwd sur l'hôte y est relié (`sessionScope`) : elle reste sur
 * les transcripts de l'hôte, comme une session hors conteneur.
 */
export function claudeTranscripts(
  paths: Paths,
  conversation: Pick<ConversationRow, 'environmentWhere' | 'environmentConfined' | 'userId'>,
): TranscriptHome {
  if (conversation.environmentWhere !== 'devcontainer' || conversation.environmentConfined) return hostTranscripts()
  return {
    configDir: containerClaudeHome(paths, conversation.userId),
    cwdInside: (cwd) => containerPathOf(cwd) ?? cwd,
    searchById: true,
  }
}
