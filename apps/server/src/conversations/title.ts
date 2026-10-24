import type { EventEmitter } from 'node:events'
import { and, eq, ne, or } from 'drizzle-orm'
import { conversations, type Db } from '@solera/db'
import { MAX_SESSION_TITLE_CHARS } from '@solera/protocol'

/**
 * Adopte un titre de session venu de l'agent (`rename_session`) ou du CLI (son résumé).
 *
 * L'ordre de priorité : l'utilisateur, puis l'agent, puis le CLI. L'écriture est
 * conditionnelle, et non lue puis écrite : le CLI calcule son résumé de façon
 * asynchrone, et un renommage par l'utilisateur pendant ce temps doit l'emporter.
 *
 * Un agent qui reprend à son compte le titre déjà affiché le marque quand même comme le
 * sien, pour qu'un résumé tardif du CLI ne le remplace pas.
 */
export function adoptSessionTitle(
  db: Db,
  bus: Pick<EventEmitter, 'emit'>,
  conversationId: string,
  title: string,
  source: 'agent' | 'cli',
): 'updated' | 'unchanged' | 'protected' | 'missing' {
  const changed = db
    .update(conversations)
    .set({ title, ...(source === 'agent' ? { titleSetByAgent: true } : {}) })
    .where(
      and(
        eq(conversations.id, conversationId),
        eq(conversations.titleSetByUser, false),
        source === 'cli' ? eq(conversations.titleSetByAgent, false) : undefined,
        or(ne(conversations.title, title), source === 'agent' ? eq(conversations.titleSetByAgent, false) : undefined),
      ),
    )
    .returning({ id: conversations.id })
    .get()
  if (changed) {
    bus.emit('title', { conversationId, title })
    return 'updated'
  }
  const after = db
    .select({ user: conversations.titleSetByUser, agent: conversations.titleSetByAgent })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .get()
  if (!after) return 'missing'
  return after.user || (source === 'cli' && after.agent) ? 'protected' : 'unchanged'
}

/**
 * Le rappel injecté au démarrage pour que l'agent nomme sa session, ou null.
 *
 * Par le prompt système et non par la seule description de l'outil : c'est le même canal
 * pour les quatre CLI, et le seul qui arrive sans que l'agent ait regardé ses outils.
 * Rien quand le serveur MCP n'est pas monté, ni quand l'utilisateur a choisi le titre ;
 * relu à chaque démarrage, il dit à une session déjà nommée de garder son titre.
 */
export function sessionTitleReminder(db: Db, conversationId: string, soleraMcp: boolean): string | null {
  if (!soleraMcp) return null
  const current = db
    .select({ title: conversations.title, user: conversations.titleSetByUser, agent: conversations.titleSetByAgent })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .get()
  if (!current || current.user) return null
  if (current.agent) {
    return `Titre de cette session : ${JSON.stringify(current.title)}. Garde-le tant que le sujet principal ne change pas ; s'il change vraiment, ajuste-le avec \`rename_session\` du serveur \`solera\`, en 3 à 6 mots dans la langue de l'utilisateur (${MAX_SESSION_TITLE_CHARS} caractères au plus).`
  }
  return `Dès que tu as compris la demande, appelle \`rename_session\` du serveur \`solera\` pour donner à cette session un titre court et parlant : 3 à 6 mots, ${MAX_SESSION_TITLE_CHARS} caractères au plus, dans la langue de l'utilisateur. Nomme le sujet concret, « Refonte de la sidebar » ou « Corriger la connexion » par exemple, plutôt que de recopier sa phrase ou d'annoncer où en est le travail. Ce titre aide l'utilisateur à retrouver le fil : donne-le sans lui demander de confirmer et sans interrompre le travail demandé. Ne le change ensuite que si le sujet principal change.`
}
