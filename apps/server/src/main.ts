import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { openDatabase, projects } from '@solera/db'
import { createAgentRegistry } from './agents/registry.js'
import { purgeIdempotencyKeys } from './auth/api-tokens.js'
import { WebhookService } from './webhooks/service.js'
import { purgeExpiredSessions } from './auth/sessions.js'
import { loadConfig } from './config.js'
import { AttachmentStore } from './attachments/store.js'
import { ActionRunner } from './actions/actions.js'
import { EventLog } from './events/event-log.js'
import { buildApp } from './http/app.js'
import { announceToLauncher, openDesktopSession, scrubLauncherEnv } from './instance/desktop.js'
import { INSTANCE_PROFILE } from './instance/profile.js'
import { migrationsFolder, runPendingMigrations } from './migrations.js'
import { PushService } from './push/push-service.js'
import { Notifications } from './notifications/dispatcher.js'
import { Decisions } from './decisions/decisions.js'
import { registerMaintenanceJobs } from './scheduler/jobs.js'
import { Scheduler } from './scheduler/scheduler.js'
import { TaskScheduler } from './scheduler/task-scheduler.js'
import { AgentRequests } from './sessions/agent-requests.js'
import { MilestoneRuns } from './milestones/milestone-runs.js'
import { SessionRelay } from './sessions/session-relay.js'
import { GitCredentialStore } from './git-credentials/store.js'
import { ghForge } from './reviews/forge.js'
import { IssueSources } from './issues/service.js'
import { githubIssues } from './issues/github.js'
import { CardClosure } from './cards/close.js'
import { installCredentialLauncher } from './git-credential/helper.js'
import { upgradeCredentialHelpers } from './git-credential/migrate.js'
import { ClaudeAccountStore } from './claude-accounts/store.js'
import { ClaudeLoginService } from './claude-accounts/login.js'
import { ClaudeAccountGauges } from './claude-accounts/gauges.js'
import { CodexAccountHomes } from './codex-accounts/homes.js'
import { CodexLoginService } from './codex-accounts/login.js'
import { CodexAccountStore } from './codex-accounts/store.js'
import { GrokAccountHomes } from './grok-accounts/homes.js'
import { GrokLoginService } from './grok-accounts/login.js'
import { GrokAccountStore } from './grok-accounts/store.js'
import { loadOrCreateKey } from './secrets/cipher.js'
import { SecretStore } from './secrets/store.js'
import { SessionManager } from './sessions/session-manager.js'
import { TerminalManager } from './terminals/terminal-manager.js'
import { linkedDesignSystems, prototypesRoot, StorybookSupervisor } from './design-system/storybooks.js'
import { VaultIndex } from './vault/index-service.js'
import { backfillCommandPaths } from './worktrees/backfill.js'
import { backfillConfigLayers } from './conversations/config-backfill.js'
import { WorktreeCleanup } from './worktrees/cleanup.js'
import { watchMergedCards } from './worktrees/merged-cards.js'
import { WorktreeStatusService } from './worktrees/status-service.js'
import { ProjectPullRequests, ghListPullRequests } from './reviews/pull-requests.js'

async function main(): Promise<void> {
  const config = loadConfig()
  if (INSTANCE_PROFILE === 'desktop') scrubLauncherEnv()
  for (const dir of [config.paths.attachments, config.paths.worktrees, config.paths.logs]) {
    mkdirSync(dir, { recursive: true })
  }

  const { db, sqlite } = openDatabase(config.paths.database)
  runPendingMigrations(db, migrationsFolder())
  backfillCommandPaths(db)
  // L'héritage vivant (#120) : les copies complètes deviennent des écarts, sans perte.
  backfillConfigLayers(db)
  await purgeExpiredSessions(db)
  purgeIdempotencyKeys(db)

  const log = new EventLog(db)
  // Partagé entre le gestionnaire de sessions et les routes : les adaptateurs portent
  // les caches de catalogue et de quota, qui ne doivent exister qu'une fois.
  const registry = createAgentRegistry(config)
  // La clé vit à côté de la base, pas dedans : c'est ce qui fait qu'une base copiée
  // seule ne livre pas les secrets qu'elle contient.
  const encryptionKey = loadOrCreateKey(config.paths.data)
  const secrets = new SecretStore(db, encryptionKey)
  const gitCredentials = new GitCredentialStore(db, encryptionKey)
  const claudeGauges = new ClaudeAccountGauges(config.paths.claudeAccounts)
  const claudeAccounts = new ClaudeAccountStore(db, encryptionKey, claudeGauges)
  // La connexion guidée pilote le CLI, résolu comme pour les conversations.
  const claudeLogin = new ClaudeLoginService(claudeAccounts, () => registry.adapter('claude').cli.executable(), claudeGauges)
  const codexAccounts = { store: new CodexAccountStore(db), homes: new CodexAccountHomes(config.paths.codexAccounts) }
  // La connexion d'un compte Codex lance l'app-server du CLI, résolu comme pour les
  // conversations : le binaire que Solera gère passe avant celui du PATH.
  const codexLogin = new CodexLoginService(codexAccounts.homes, codexAccounts.store, () => registry.adapter('codex').cli.executable())
  const grokAccounts = { store: new GrokAccountStore(db), homes: new GrokAccountHomes(config.paths.grokAccounts) }
  const grokLogin = new GrokLoginService(grokAccounts.homes, grokAccounts.store, () => registry.adapter('grok').cli.executable())
  const sessions = new SessionManager(db, log, config, registry, secrets, claudeAccounts, codexAccounts, grokAccounts)
  const storybooks = new StorybookSupervisor({
    directory: join(config.paths.data, 'design-systems'),
    prototypesDirectory: prototypesRoot(config.paths.data),
    inUse: (path) => sessions.designSystemInUse(path),
    linked: () => linkedDesignSystems(db),
  })
  sessions.setStorybooks(storybooks)
  const attachments = new AttachmentStore(db, config.paths.attachments)
  const terminals = new TerminalManager(config)
  // Boutons des projets : commandes jouées dans un terminal ou une unité systemd.
  const actions = new ActionRunner(db, config, terminals)
  const recovered = sessions.recoverInterrupted()
  const webhooks = new WebhookService(db, log, sessions, config.server.publicUrl)
  // Construit avant l'application, dont les routes remettent ou écartent un message
  // retenu, mais démarré après elle, faute de logger avant.
  const relay = new SessionRelay(db, sessions, log)
  // Tâches planifiées par l'utilisateur ou par un agent, tirées dans des sessions neuves.
  const tasks = new TaskScheduler({ db, config }, sessions, registry, log)

  // Les fichiers téléversés puis jamais envoyés s'accumuleraient sinon sans limite.
  const orphans = await attachments.purgeOrphans()

  const push = new PushService(db, config.paths.data, config.server.publicUrl)
  // Toast sur l'appareil où l'application est visible, notification système ailleurs ;
  // le hub WebSocket lui dira qui regarde quoi.
  const notifications = new Notifications(db, push)
  sessions.setNotifier(notifications)
  // Les décisions que les sessions demandent : déposées et échues par le balayage des
  // demandes d'agent, tranchées par la route. Elles notifient par l'aiguillage.
  const decisions = new Decisions({ db, config }, log, sessions.statusBus, notifications)
  // Un jeton qui ne se déchiffre plus ne doit pas empêcher la revue : `gh` a le sien.
  const githubToken = (userId: string) => {
    try {
      return gitCredentials.resolve(userId, 'github.com')?.token
    } catch {
      return undefined
    }
  }
  // Les PR du projet, lues une fois par minute : les badges de l'Activité, et l'état des
  // worktrees qui y reconnaît une branche fusionnée par squash (#126).
  const pullRequests = new ProjectPullRequests(db, ghListPullRequests, githubToken)
  // L'avancement des worktrees, par projet, invalidé à chaque fin de tour.
  const worktreeStatus = new WorktreeStatusService(db, log, pullRequests.merged)
  // Nettoyer un chantier ferme ses terminaux et range ses sessions. C'est un geste de la
  // vue Chantiers : une fusion ne le propose plus dans « À décider », réservé à ce qu'un
  // agent demande à une personne, et les propositions d'avant sont retirées ici.
  const worktreeCleanup = new WorktreeCleanup(db, config.paths.data, worktreeStatus, terminals, (id) => sessions.dropCheckpoints(id))
  decisions.retireWorktreeProposals()
  // Une fusion détectée passe en « Terminé » les cartes des sessions qui vivaient dans l'arbre.
  watchMergedCards(db, worktreeStatus)
  // Lancements, cartes, projets, rangements et décisions demandés par les agents, par le
  // serveur MCP.
  // Clore une carte finie (#69) : l'agent le propose, le clic archive ses sessions, retire
  // ses worktrees et supprime ses branches fusionnées.
  const cardClosure = new CardClosure(db, worktreeStatus, worktreeCleanup, ghForge, githubToken)
  // Les issues de GitHub qui entrent dans le board, et l'état des cartes qui en repart (#84).
  const issueSources = new IssueSources(db, { github: githubIssues }, githubToken)
  const agentRequests = new AgentRequests({ db, config }, sessions, registry, log, decisions, worktreeStatus, actions, {
    forge: ghForge,
    notifications,
    token: githubToken,
    closure: cardClosure,
  })
  // Les jalons lancés (#72) : leurs cartes partent en sessions dans l'ordre de leurs liens
  // « bloque ». Construit avant l'application, qui expose ses routes, démarré après elle.
  const milestones = new MilestoneRuns({ db, config }, sessions, registry, notifications)
  // Construit avant l'application, qui expose la route capable de le reprogrammer, mais
  // démarré après elle, faute de logger avant.
  const scheduler = new Scheduler()
  // L'index du vault : construit avant l'application, qui expose ses routes, et
  // rattrapé après elle, faute de logger avant.
  const vault = new VaultIndex(db, config)
  const app = await buildApp(
    { db, config },
    log,
    sessions,
    registry,
    attachments,
    terminals,
    push,
    secrets,
    gitCredentials,
    claudeAccounts,
    claudeLogin,
    codexAccounts,
    codexLogin,
    grokAccounts,
    grokLogin,
    webhooks,
    scheduler,
    relay,
    tasks,
    vault,
    storybooks,
    notifications,
    decisions,
    worktreeStatus,
    worktreeCleanup,
    actions,
    cardClosure,
    issueSources,
    milestones,
    pullRequests,
  )
  push.setLogger(app.log)
  if (orphans > 0) app.log.info({ orphans }, 'pieces jointes orphelines supprimees')
  if (recovered.length > 0) {
    app.log.info({ recovered: recovered.length }, 'conversations marquees interrompues apres redemarrage')
  }
  // Après buildApp pour que le logger existe, avant listen pour ne rien manquer :
  // chaque tâche d'API tuée par le redémarrage doit le dire à son appelant.
  webhooks.start()
  webhooks.sessionEnded(recovered)

  registerMaintenanceJobs(scheduler, { db, attachments, log: app.log, config })
  scheduler.start(app.log)
  // Après `recoverInterrupted` : les statuts lus pour choisir entre inflexion et relance
  // doivent décrire les runners de ce process, pas ceux du précédent.
  relay.start(app.log)
  agentRequests.start(app.log)
  // Après `recoverInterrupted` : une session coupée par le redémarrage doit se lire
  // interrompue, et bloquer sa carte, plutôt que de compter comme au travail.
  milestones.start(app.log)
  issueSources.start(app.log)
  // Après `recoverInterrupted` aussi : un tir coupé par le redémarrage doit se lire
  // « interrompu », pas « en cours » jusqu'à sa durée maximale.
  tasks.start(app.log)

  /**
   * Le rattrapage de l'index du vault, lancé sans l'attendre.
   *
   * Le vault se modifie ailleurs — un autre éditeur, le téléphone — et c'est au
   * démarrage qu'on rattrape : `git diff` entre le commit que l'index reflète et
   * `HEAD` dit exactement ce qui a bougé. Rien ne doit en dépendre pour écouter : un
   * index en retard rend des faits en retard, un serveur qui n'écoute pas ne rend
   * rien du tout.
   */
  void vault
    .sync()
    .then((run) => {
      if (run.skipped === undefined) {
        app.log.info({ indexed: run.indexed, removed: run.removed, full: run.full }, 'index du vault a jour')
      }
    })
    .catch((err: unknown) => {
      app.log.error({ err }, 'indexation du vault en echec')
    })

  await app.listen({ host: config.server.host, port: config.server.port })

  // L'application de bureau attend cette annonce pour ouvrir sa fenêtre : le serveur
  // répond déjà, et la session de l'utilisateur est prête à poser en cookie.
  if (INSTANCE_PROFILE === 'desktop') {
    const address = app.server.address()
    const port = typeof address === 'object' && address ? address.port : config.server.port
    announceToLauncher({ port, session: await openDesktopSession(db), cookie: config.sessionCookie })
  }

  // Le lanceur du helper git décrit le Node et la release de ce process : réécrit à
  // chaque démarrage, il suit les mises à jour sans que les dépôts clonés aient à changer.
  // Puis les dépôts clonés avant lui passent au lanceur. Après listen et sans l'attendre :
  // un git par projet n'a pas à retarder l'ouverture du serveur.
  try {
    installCredentialLauncher(config.paths)
    const workspaces = db.select({ path: projects.workspacePath }).from(projects).all().map((row) => row.path)
    upgradeCredentialHelpers(workspaces, config.paths)
      .then((upgraded) => {
        if (upgraded.length > 0) app.log.info({ repos: upgraded }, 'helper git des depots clones mis a jour')
      })
      .catch((err: unknown) => app.log.warn({ err }, 'mise a jour du helper git des depots impossible'))
  } catch (err) {
    // Installation incomplète (pas de `.mjs`) : le serveur sert quand même, sans helper.
    app.log.warn({ err }, 'lanceur du helper git non installe')
  }

  // Deux demandes d'arrêt peuvent se croiser (un signal, puis l'app de bureau qui ferme
  // l'entrée standard) : la seconde ne doit pas refermer ce que la première a fermé.
  let stopping = false
  const shutdown = async (signal: string) => {
    if (stopping) return
    stopping = true
    app.log.info({ signal }, 'arrêt en cours')
    // Avant stopAll, qui expire les sollicitations : les statuts disent encore ce qui
    // était en vol, et les livraisons persistées partiront au prochain démarrage.
    webhooks.shutdownFlush()
    webhooks.stop()
    scheduler.stop()
    relay.stop()
    agentRequests.stop()
    tasks.stop()
    await sessions.stopAll()
    terminals.shutdown()
    storybooks.shutdown()
    await app.close()
    sqlite.close()
    process.exit(0)
  }
  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
  // L'app de bureau demande l'arrêt en fermant l'entrée standard : sous Windows, il n'y a
  // pas de signal à envoyer, et tuer le serveur laisserait les CLI des sessions orphelins.
  // L'entrée se ferme aussi quand l'app disparaît sans prévenir : le serveur part avec elle.
  // Tuée, l'app peut laisser un tube rompu plutôt qu'une fin propre, d'où `close` et
  // `error` en plus de `end`.
  if (INSTANCE_PROFILE === 'desktop') {
    for (const event of ['end', 'close', 'error'] as const) {
      process.stdin.once(event, () => void shutdown('launcher'))
    }
    process.stdin.resume()
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
