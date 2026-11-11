import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import { and, desc, eq, isNotNull, isNull, lte, ne } from 'drizzle-orm'
import type { FastifyBaseLogger } from 'fastify'
import { actionRuns, projectActions, projects, type Db, type ProjectActionRow } from '@solera/db'
import { actionRunStatusOf, nextScheduleRun } from '@solera/protocol'
import type { Config } from '../config.js'
import type { Environments } from '../environments/environments.js'
import type { Notifications } from '../notifications/dispatcher.js'
import { processOrigins } from '../services/origins.js'
import { runDetached, type CommandExecutor, type DetachedResult } from '../scheduler/detached.js'
import { readActionCadence } from './actions.js'
import { finishDetachedRun, startRun } from './runs.js'

/**
 * Les commandes planifiées : le Quand d'une action `task`.
 *
 * Tirées dans la même passe que les tâches d'agent (`TaskScheduler.tick`), avec la même
 * règle : l'état vit dans `next_run_at`, un tir manqué pendant un arrêt part une fois au
 * redémarrage, puis le suivant s'arme depuis maintenant, sans rattraper les autres.
 *
 * Détachées de tout terminal : personne ne les regarde, et un terminal par tir userait
 * le plafond du projet. Un processus comme le script de vérification d'une tâche, hors
 * du cgroup du daemon quand systemd le permet, coupé à sa durée maximale ; sa sortie
 * finit dans le passage.
 */

/** Ce que le planificateur attend de l'aiguillage des notifications, et rien de plus. */
export type FailureNotifier = Pick<Notifications, 'dispatch'>

export class CommandScheduler {
  /** Actions dont un tir tourne : le suivant ne part pas par-dessus. */
  private readonly running = new Set<string>()
  private readonly inFlight = new Set<Promise<void>>()
  private readonly execute: CommandExecutor
  private notifications: FailureNotifier | null
  private logger: FastifyBaseLogger | null = null

  constructor(
    private readonly db: Db,
    private readonly config: Config,
    private readonly environments: Environments,
    options: { execute?: CommandExecutor; notifications?: FailureNotifier } = {},
  ) {
    this.execute = options.execute ?? runDetached
    this.notifications = options.notifications ?? null
  }

  setLogger(logger: FastifyBaseLogger): void {
    this.logger = logger
  }

  /** Renseignée après coup : l'aiguillage est construit après le planificateur. */
  setNotifications(notifications: FailureNotifier): void {
    this.notifications = notifications
  }

  /**
   * Lance les commandes dues, sans attendre leur fin : une sauvegarde peut prendre des
   * minutes, et le balayage porte aussi les tâches d'agent.
   */
  async tick(now = Date.now()): Promise<void> {
    const due = this.db
      .select({ action: projectActions, workspacePath: projects.workspacePath, ownerId: projects.ownerId })
      .from(projectActions)
      .innerJoin(projects, eq(projects.id, projectActions.projectId))
      .where(
        and(
          isNotNull(projectActions.cadence),
          eq(projectActions.scheduleEnabled, true),
          lte(projectActions.nextRunAt, now),
          // Un projet rangé ne travaille plus : ses commandes attendent son retour.
          isNull(projects.archivedAt),
        ),
      )
      .all()

    for (const { action, workspacePath, ownerId } of due) {
      // Écrite ou modifiée par un agent et pas encore relue : elle partirait sans que
      // personne l'ait vue. Le tir est perdu plutôt que gardé : la valider ne doit pas
      // déclencher un arriéré.
      if (!action.approvedAt) {
        this.advance(action, now, false)
        continue
      }
      // Jamais deux tirs à la fois : ils travailleraient le même arbre.
      if (this.running.has(action.id)) {
        this.advance(action, now, false)
        continue
      }
      this.advance(action, now, true)
      this.running.add(action.id)
      const flight = this.launch(action, workspacePath, ownerId, now)
        .catch((err: unknown) => this.logger?.warn({ err, action: action.id }, 'commande planifiée en échec au lancement'))
        .finally(() => {
          this.running.delete(action.id)
          this.inFlight.delete(flight)
        })
      this.inFlight.add(flight)
    }
  }

  /** Attend la fin des tirs en cours, ceux que les tirs suivants ont pu lancer compris. */
  async idle(): Promise<void> {
    while (this.inFlight.size > 0) await Promise.all([...this.inFlight])
  }

  /** Arme le tir suivant ; une ponctuelle a fait son office et se met en pause. */
  private advance(action: ProjectActionRow, now: number, fired: boolean): void {
    const cadence = readActionCadence(action.cadence)!
    const nextRunAt = cadence.kind === 'once' ? null : nextScheduleRun(cadence, now, now)
    this.db
      .update(projectActions)
      .set({
        nextRunAt,
        scheduleEnabled: nextRunAt !== null,
        ...(fired ? { lastScheduledAt: now } : {}),
      })
      .where(eq(projectActions.id, action.id))
      .run()
  }

  private async launch(action: ProjectActionRow, workspacePath: string, ownerId: string, now: number): Promise<void> {
    const cwd = action.subdir ? join(workspacePath, action.subdir) : workspacePath
    const runId = startRun(this.db, {
      actionId: action.id,
      projectId: action.projectId,
      trigger: 'schedule',
      conversationId: null,
      terminalId: null,
      cwd,
      startedAt: now,
    })
    const end = await this.play(action, cwd)
    finishDetachedRun(this.db, runId, { ...end, finishedAt: Date.now() })
    // Arrêtée par un signal, quelqu'un l'a voulu : ce n'est pas une panne à signaler.
    const failed = end.exitCode === null || actionRunStatusOf(end.exitCode) === 'failed'
    if (failed && this.firstFailure(action.id, runId)) await this.notifyFailure(action, ownerId, end)
  }

  /** La fin du tir, ou la raison pour laquelle il n'est pas parti. */
  private async play(action: ProjectActionRow, cwd: string): Promise<DetachedResult> {
    // Un projet qui fait tourner ses commandes confinées ou dans un conteneur : les jouer
    // sur l'hôte sortirait de ce qu'il a choisi. Refusé et dit, plutôt que fait ailleurs.
    const environment = this.environments.ofProject(action.projectId)
    if (environment.where !== 'host' || environment.confined) {
      return {
        exitCode: null,
        timedOut: false,
        output: "Commande planifiée non lancée : ce projet fait tourner ses commandes confinées ou dans un dev container, où une commande planifiée ne sait pas encore aller.",
      }
    }
    const isDir = await stat(cwd).then((s) => s.isDirectory(), () => false)
    if (!isDir) {
      return { exitCode: null, timedOut: false, output: `Commande planifiée non lancée : le dossier ${cwd} n'existe pas.` }
    }
    return this.execute({
      command: action.command,
      cwd,
      env: processOrigins(this.config.paths.data).environment(action.projectId, null),
      timeoutMs: action.scheduleMaxMinutes * 60_000,
      label: action.label,
    })
  }

  /**
   * Le premier échec d'une série : une commande horaire qui casse ne doit pas réveiller
   * son propriétaire toutes les heures. Le passage planifié précédent dit si la série
   * vient de commencer.
   */
  private firstFailure(actionId: string, runId: string): boolean {
    const previous = this.db
      .select({ status: actionRuns.status })
      .from(actionRuns)
      .where(
        and(
          eq(actionRuns.actionId, actionId),
          eq(actionRuns.trigger, 'schedule'),
          ne(actionRuns.id, runId),
          ne(actionRuns.status, 'running'),
        ),
      )
      .orderBy(desc(actionRuns.startedAt))
      .limit(1)
      .get()
    return previous?.status !== 'failed'
  }

  private async notifyFailure(action: ProjectActionRow, ownerId: string, end: DetachedResult): Promise<void> {
    const outcome = end.timedOut
      ? `coupée au bout de ${action.scheduleMaxMinutes} min`
      : end.exitCode === null
        ? 'non lancée'
        : `code ${end.exitCode}`
    await this.notifications
      ?.dispatch(ownerId, {
        kind: 'scheduleFailed',
        push: {
          title: 'Commande planifiée en échec',
          body: `${action.label} : ${outcome}`,
          url: `/p/${action.projectId}/actions`,
          tag: `action-failed-${action.id}`,
          kind: 'scheduleFailed',
        },
      })
      .catch((err: unknown) => this.logger?.warn({ err, action: action.id }, "notification d'échec planifié non émise"))
  }
}
