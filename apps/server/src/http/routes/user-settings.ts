import type { FastifyInstance } from 'fastify'
import { updateUserSettingsBodySchema, type UserSettingsDto } from '@solera/protocol'
import {
  readUserSettings,
  writeAppearance,
  writeBoardOrder,
  writeCollapsedProjects,
  writeHiddenAgents,
  writeNotificationPrefs,
  writeOnboarding,
  writeProjectDefaults,
  writeProjectsDir,
  writeUserAgentDefault,
  writeUserAgentLayer,
} from '../../settings/user-settings.js'
import type { AgentRegistry } from '../../agents/registry.js'
import { refreshConversationConfigs } from '../../conversations/config-inheritance.js'
import type { AppContext } from '../context.js'
import { requireUser } from '../require-user.js'

/**
 * Réglages du compte connecté.
 *
 * Ni lecture ni écriture pour un autre compte, administrateur compris : ce sont des
 * préférences, pas une politique, et personne n'a à décider avec quel modèle un
 * collègue ouvre ses conversations.
 */
export function registerUserSettingsRoutes(
  app: FastifyInstance,
  ctx: AppContext,
  /**
   * De quoi recalculer la configuration des fils du compte quand son niveau change.
   * Absent dans les tests qui n'en ont pas l'usage : le lancement suivant recalcule.
   */
  registry?: Pick<AgentRegistry, 'adapter'>,
): void {
  app.get('/api/me/settings', async (request): Promise<UserSettingsDto> => {
    const user = requireUser(request)
    return readUserSettings(ctx.db, user.id)
  })

  app.patch('/api/me/settings', async (request): Promise<UserSettingsDto> => {
    const user = requireUser(request)
    const body = updateUserSettingsBodySchema.parse(request.body)

    // Champ par champ, chacun facultatif : le panneau des défauts et la sidebar
    // écrivent le même document sans jamais parler du réglage de l'autre.
    if (body.agentDefault) writeUserAgentDefault(ctx.db, user.id, body.agentDefault)
    if (body.agentLayer) writeUserAgentLayer(ctx.db, user.id, body.agentLayer)
    // Les fils qui n'ont pas changé ce réglage le suivent : leur configuration est tenue
    // à jour tout de suite, et le runner vivant la prend à sa relance (Q10).
    if ((body.agentDefault || body.agentLayer) && registry) {
      await refreshConversationConfigs(ctx.db, registry, { userId: user.id })
    }
    if (body.collapsedProjects) writeCollapsedProjects(ctx.db, user.id, body.collapsedProjects)
    if (body.boardOrder) writeBoardOrder(ctx.db, user.id, body.boardOrder.projectId, body.boardOrder.order)
    if (body.hiddenAgents) writeHiddenAgents(ctx.db, user.id, body.hiddenAgents)
    if (body.projectsDir !== undefined) writeProjectsDir(ctx.db, user.id, body.projectsDir)
    if (body.appearance) writeAppearance(ctx.db, user.id, body.appearance)
    if (body.notifications) writeNotificationPrefs(ctx.db, user.id, body.notifications)
    if (body.projectDefaults) writeProjectDefaults(ctx.db, user.id, body.projectDefaults)
    if (body.onboarding) writeOnboarding(ctx.db, user.id, body.onboarding)
    // Relu plutôt que reconstruit depuis le corps : l'écran a besoin des deux CLI, et
    // le corps n'en porte qu'un.
    return readUserSettings(ctx.db, user.id)
  })
}
