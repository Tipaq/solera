import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { IPty } from 'node-pty'
import { MAX_TERMINALS_PER_PROJECT, type TerminalDto } from '@solera/protocol'
import { withManagedPath } from '../agents/cli-binary.js'
import type { Config } from '../config.js'
import type { EnvironmentProvider } from '../environments/provider.js'
import { commandShell, interactiveShell } from '../platform/shells.js'
import { processOrigins } from '../services/origins.js'

/**
 * Terminaux attachés aux projets.
 *
 * Un pty est un process qui vit dans un répertoire : rien ne le rattache à une
 * conversation, et l'y indexer rendait introuvable un serveur lancé dans le shell
 * d'une session archivée. La session ne fait que fournir un répertoire par défaut
 * (son worktree) au moment de l'ouverture.
 *
 * Volontairement hors du journal : la sortie d'un shell n'est pas du contenu de
 * conversation, elle est massive, et la persister en base ferait grossir celle-ci
 * sans qu'aucun rendu ne s'appuie dessus. Ce que le terminal garde, c'est un tampon,
 * juste assez pour restituer l'écran quand on revient sur la vue.
 *
 * Les process ne survivent pas au redémarrage du daemon, et c'est assumé : les faire
 * survivre demanderait un porteur externe (la pente tmux). En revanche les
 * métadonnées et le dernier écran sont écrits sur disque : au redémarrage, l'entrée
 * réapparaît marquée « interrompue », écran lisible, prête à être relancée. Celle d'un
 * process déjà sorti revient telle qu'elle a fini, avec son code et sa date.
 */

/** Tampon de restitution. Au-delà, on ne reconstitue plus un écran mais un historique. */
const REPLAY_BYTES = 128 * 1024

/** L'écran se réécrit sur disque à ce pas, tant qu'il a changé depuis la dernière fois. */
const FLUSH_INTERVAL_MS = 30 * 1000

const DEFAULT_COLS = 80
const DEFAULT_ROWS = 24

export interface TerminalSubscriber {
  onOutput(data: string): void
  onExit(code: number): void
}

interface ManagedTerminal {
  id: string
  projectId: string
  title: string
  /** Null pour une entrée restaurée après un redémarrage : le process est perdu. */
  pty: IPty | null
  /** Où son shell tourne ; null pour une entrée restaurée. */
  environment: EnvironmentProvider | null
  cwd: string
  /** Sortie récente, pour repeindre l'écran à la reconnexion. */
  replay: string
  /** L'écran sur disque est en retard sur celui en mémoire. */
  replayDirty: boolean
  subscribers: Set<TerminalSubscriber>
  idleTimer: NodeJS.Timeout | null
  cols: number
  rows: number
  createdAt: number
  /** Le process s'est terminé : l'onglet reste, avec son écran final. */
  exited: boolean
  /** Le process a été emporté par un redémarrage du daemon, pas par un `exit`. */
  interrupted: boolean
  /** Action de projet dont ce terminal joue la commande ; null pour un shell. */
  actionId: string | null
  /** L'essai d'une commande de l'éditeur, et la personne qui l'a lancé ; null sinon. */
  trialOf: string | null
  /** Session qui l'a ouvert, et dont il suit l'environnement ; null hors session. */
  conversationId: string | null
  exitCode: number | null
  /** Quand le process s'est terminé ; null tant qu'il tourne, ou s'il a été interrompu. */
  finishedAt: number | null
}

interface PersistedTerminal {
  id: string
  projectId: string
  title: string
  cwd: string
  createdAt: number
  actionId?: string | null
  trialOf?: string | null
  conversationId?: string | null
  /** Absents tant que le process tourne : l'entrée relue sans eux est une interrompue. */
  exitCode?: number | null
  finishedAt?: number | null
}

/**
 * Où le shell tourne : l'environnement qui le lance, et la session dont il le tient
 * (null hors session), retenue pour le relancer au même endroit.
 */
export interface TerminalPlace {
  environment: EnvironmentProvider
  conversationId: string | null
}

/** Une commande à jouer à la place du shell interactif. */
export interface TerminalCommand {
  command: string
  title: string
  actionId: string | null
  /** Personne qui essaie la commande depuis l'éditeur, sans l'enregistrer. */
  trialOf?: string
  /** Variables propres à cette exécution, par-dessus celles du daemon et l'origine. */
  env?: Record<string, string>
  /**
   * Appelé quand la commande se termine, même dans un terminal fermé entre-temps :
   * son code, sa date et ce qu'elle a écrit (l'écran retenu, sans l'en-tête `$ …`).
   */
  onExit?: (end: { exitCode: number; finishedAt: number; output: string }) => void
}

/**
 * Trois refus distincts à afficher : le plafond de terminaux est atteint, le terminal
 * n'existe pas (ou pas dans ce projet), ou son process est déjà sorti.
 */
export class TerminalError extends Error {
  constructor(
    readonly code: 'too_many_terminals' | 'terminal_not_found' | 'terminal_finished',
    message: string,
  ) {
    super(message)
    this.name = 'TerminalError'
  }
}

export class TerminalManager {
  private readonly terminals = new Map<string, ManagedTerminal>()
  private readonly storeDir: string
  private readonly flushTimer: NodeJS.Timeout

  constructor(private readonly config: Config) {
    this.storeDir = join(config.paths.data, 'terminals')
    mkdirSync(this.storeDir, { recursive: true })
    this.restore()

    this.flushTimer = setInterval(() => this.flushDirty(), FLUSH_INTERVAL_MS)
    this.flushTimer.unref()
  }

  private touch(terminalId: string): void {
    const managed = this.terminals.get(terminalId)
    if (!managed) return

    if (managed.idleTimer) clearTimeout(managed.idleTimer)
    managed.idleTimer = setTimeout(
      () => this.reapIfIdle(terminalId),
      this.config.limits.ptyIdleTimeoutMin * 60 * 1000,
    )
    // Un terminal en veille ne doit pas maintenir le process en vie à lui seul.
    managed.idleTimer.unref()
  }

  /**
   * L'échéance d'inactivité ne fauche que les shells au prompt.
   *
   * Un shell qui fait tourner quelque chose (un serveur de dev, un build long) n'est
   * pas inactif : personne ne lui parle, mais son travail est la raison pour laquelle
   * on l'a ouvert. Tant qu'il a un process enfant, on remet l'échéance.
   */
  private reapIfIdle(terminalId: string): void {
    const managed = this.terminals.get(terminalId)
    if (!managed || managed.exited || !managed.pty) return

    // Le process d'une action est la commande elle-même (`sh -c` l'exécute souvent à la
    // place du shell) : pas d'enfant à voir, mais rien d'inactif non plus.
    if (managed.actionId || managed.trialOf || hasChildProcess(managed.pty.pid)) {
      this.touch(terminalId)
      return
    }
    this.close(terminalId)
  }

  private of(projectId: string): ManagedTerminal[] {
    return [...this.terminals.values()]
      .filter((managed) => managed.projectId === projectId)
      .sort((a, b) => a.createdAt - b.createdAt)
  }

  list(projectId: string): TerminalDto[] {
    return this.of(projectId).map(toDto)
  }

  /** Le dernier terminal ouvert pour cette action, vivant ou non. */
  latestForAction(projectId: string, actionId: string): TerminalDto | null {
    const found = this.of(projectId).filter((managed) => managed.actionId === actionId).at(-1)
    return found ? toDto(found) : null
  }

  /**
   * L'exécution de cette action qui tourne encore dans ce dossier, quelle que soit la
   * session qui l'a lancée : deux exécutions dans le même arbre se disputeraient ses
   * ports et sa base. Celle d'un autre worktree n'empêche pas d'en lancer une ici.
   */
  liveForAction(projectId: string, actionId: string, cwd: string): TerminalDto | null {
    const found = this.of(projectId)
      .filter((managed) => managed.actionId === actionId && !managed.exited && managed.cwd === cwd)
      .at(-1)
    return found ? toDto(found) : null
  }

  /** Shells vivants du projet, pour l'indicateur d'activité de la liste de projets. */
  aliveCount(projectId: string): number {
    return [...this.terminals.values()].filter(
      (managed) => managed.projectId === projectId && !managed.exited,
    ).length
  }

  /**
   * Ouvre un shell, ou joue une commande quand `run` est donné.
   *
   * Une commande passe par `shell -lc` plutôt que par une frappe dans un shell
   * interactif : le terminal se termine avec elle, ce qui donne son code de sortie, et
   * le shell de connexion charge le même PATH que celui qu'on ouvrirait à la main.
   *
   * Le shell tourne dans l'environnement de `place` : celui de la session qui l'ouvre,
   * et hors session celui du projet (ADR 0001).
   */
  open(projectId: string, cwd: string, place: TerminalPlace, run?: TerminalCommand): TerminalDto {
    const existing = this.of(projectId)
    if (run?.actionId) {
      // Une exécution terminée de la même action, au même endroit, cède sa place :
      // relancer un bouton ne doit pas épuiser le plafond de terminaux avec des écrans
      // périmés. Celle d'une autre session ou d'un autre dossier reste à lire.
      for (const previous of existing) {
        if (previous.actionId === run.actionId && previous.exited && samePlace(previous, place.conversationId, cwd)) {
          this.close(previous.id)
        }
      }
    }
    const remaining = this.of(projectId)
    if (remaining.length >= MAX_TERMINALS_PER_PROJECT) {
      throw new TerminalError(
        'too_many_terminals',
        `Maximum ${MAX_TERMINALS_PER_PROJECT} terminals per project.`,
      )
    }

    const id = randomUUID()
    // Une commande se lance dans le shell qui comprend sa syntaxe POSIX, un terminal vide
    // dans celui de l'utilisateur (voir `platform/shells.ts`).
    const shell = run ? commandShell() : interactiveShell()
    const pty = place.environment.spawnPty({
      command: shell.command,
      args: run ? [...shell.args, run.command] : shell.args,
      name: 'xterm-256color',
      cols: DEFAULT_COLS,
      rows: DEFAULT_ROWS,
      cwd,
      env: withManagedPath(
        {
          ...(process.env as Record<string, string>),
          ...processOrigins(this.config.paths.data).environment(projectId, null),
          ...run?.env,
          TERM: 'xterm-256color',
        },
        this.config.paths.agents,
      ),
    })

    // La commande en tête, en gris : l'écran dit ce qui a été lancé, même une fois la
    // sortie défilée hors de vue.
    const header = run ? `\x1b[2m$ ${run.command.replace(/\n/g, '\r\n  ')}\x1b[0m\r\n` : ''
    const managed: ManagedTerminal = {
      id,
      projectId,
      // Numéroté d'après ce qui est ouvert, pas d'un compteur : fermer le premier puis
      // en rouvrir un ne doit pas donner deux « shell 2 ».
      title: run?.title ?? nextTitle(remaining),
      pty,
      environment: place.environment,
      cwd,
      replay: header,
      replayDirty: false,
      subscribers: new Set(),
      idleTimer: null,
      cols: DEFAULT_COLS,
      rows: DEFAULT_ROWS,
      createdAt: Date.now(),
      exited: false,
      interrupted: false,
      actionId: run?.actionId ?? null,
      trialOf: run?.trialOf ?? null,
      conversationId: place.conversationId,
      exitCode: null,
      finishedAt: null,
    }
    this.terminals.set(id, managed)
    this.persistMeta(managed)

    pty.onData((data) => {
      managed.replay = (managed.replay + data).slice(-REPLAY_BYTES)
      managed.replayDirty = true
      for (const subscriber of managed.subscribers) subscriber.onOutput(data)
    })

    pty.onExit(({ exitCode: code, signal }) => {
      // Tué par un signal, le process sort « en 0 » pour node-pty : on lui rend le code
      // qu'un shell afficherait (130 pour Ctrl-C), sans quoi une commande arrêtée
      // passerait pour réussie.
      const exitCode = signal ? 128 + signal : code
      // Un terminal confiné a son propre bac à sable : ce qu'il a lancé meurt avec lui,
      // et son home privé s'efface. Sans effet sur l'hôte.
      void place.environment.close()
      // L'entrée survit à son process, avec son dernier écran : un `exit` accidentel ou
      // une commande qui plante ne doivent pas faire disparaître ce qu'on voulait lire.
      managed.exited = true
      managed.finishedAt = Date.now()
      if (managed.idleTimer) clearTimeout(managed.idleTimer)
      managed.idleTimer = null
      if (run) {
        managed.exitCode = exitCode
        if (run.onExit) {
          const output = managed.replay.startsWith(header) ? managed.replay.slice(header.length) : managed.replay
          try {
            run.onExit({ exitCode, finishedAt: managed.finishedAt, output })
          } catch {
            // À l'arrêt du daemon, la base peut être déjà fermée : le passage sera clos
            // au prochain démarrage.
          }
        }
        const footer = `\r\n\x1b[2m[${exitCode === 0 ? 'exit 0' : `exit ${exitCode}`}]\x1b[0m\r\n`
        managed.replay = (managed.replay + footer).slice(-REPLAY_BYTES)
        managed.replayDirty = true
        for (const subscriber of managed.subscribers) subscriber.onOutput(footer)
      }
      // Un terminal fermé, ou emporté par l'arrêt du daemon, n'est plus le nôtre : le
      // réécrire ferait revenir le premier, et donnerait au second une fin qu'il n'a pas eue.
      if (this.terminals.get(id) === managed) {
        this.persistMeta(managed)
        this.flushReplay(managed)
      }
      for (const subscriber of managed.subscribers) subscriber.onExit(exitCode)
    })

    this.touch(id)
    return toDto(managed)
  }

  /**
   * Les terminaux dont le shell tourne encore, avec leur environnement : Services les
   * range sous le dev container ou le bac à sable qui les fait tourner.
   */
  live(): { id: string; projectId: string; title: string; pid: number; environment: EnvironmentProvider }[] {
    return [...this.terminals.values()].flatMap((managed) =>
      managed.pty && managed.environment && !managed.exited
        ? [{ id: managed.id, projectId: managed.projectId, title: managed.title, pid: managed.pty.pid, environment: managed.environment }]
        : [],
    )
  }

  rename(projectId: string, terminalId: string, title: string): TerminalDto {
    const managed = this.require(projectId, terminalId)
    managed.title = title
    this.persistMeta(managed)
    return toDto(managed)
  }

  /**
   * Attache un client. Renvoie la sortie déjà produite pour qu'il repeigne son écran,
   * ainsi que la façon de se détacher.
   */
  attach(
    projectId: string,
    terminalId: string,
    subscriber: TerminalSubscriber,
  ): { replay: string; cols: number; rows: number; exited: boolean; detach: () => void } {
    const managed = this.require(projectId, terminalId)
    managed.subscribers.add(subscriber)
    if (!managed.exited) this.touch(terminalId)

    return {
      replay: managed.replay,
      cols: managed.cols,
      rows: managed.rows,
      exited: managed.exited,
      // Le terminal survit au départ de son dernier client : fermer un onglet ne doit
      // pas tuer une commande en cours. C'est l'inactivité qui finit par le libérer.
      detach: () => managed.subscribers.delete(subscriber),
    }
  }

  /**
   * Ctrl-C, comme au clavier : le pty le traduit en SIGINT pour ce qui tourne au premier
   * plan, dans un conteneur comme sur l'hôte. Le terminal et son écran restent.
   */
  interrupt(projectId: string, terminalId: string): void {
    const managed = this.require(projectId, terminalId)
    if (managed.exited || !managed.pty) {
      throw new TerminalError('terminal_finished', 'This terminal has already finished.')
    }
    managed.pty.write('\x03')
    this.touch(terminalId)
  }

  write(projectId: string, terminalId: string, data: string): void {
    const managed = this.terminals.get(terminalId)
    if (!managed || managed.projectId !== projectId || managed.exited || !managed.pty) return
    managed.pty.write(data)
    this.touch(terminalId)
  }

  /**
   * Redimensionne le pty.
   *
   * Plusieurs clients peuvent regarder le même terminal avec des tailles différentes ;
   * le pty n'en a qu'une. Le dernier qui parle l'emporte, comme le ferait un
   * multiplexeur sans mode « taille minimale ».
   */
  resize(projectId: string, terminalId: string, cols: number, rows: number): void {
    const managed = this.terminals.get(terminalId)
    if (!managed || managed.projectId !== projectId || managed.exited || !managed.pty) return
    if (cols < 1 || rows < 1) return
    if (managed.cols === cols && managed.rows === rows) return

    managed.cols = cols
    managed.rows = rows
    managed.pty.resize(cols, rows)
  }

  /**
   * Le terminal, s'il appartient bien à ce projet.
   *
   * La vérification est ici et non chez l'appelant : un identifiant seul suffirait
   * sinon à lire le shell d'un projet qu'on n'a pas le droit de voir.
   */
  private require(projectId: string, terminalId: string): ManagedTerminal {
    const managed = this.terminals.get(terminalId)
    if (!managed || managed.projectId !== projectId) {
      throw new TerminalError('terminal_not_found', 'Terminal not found.')
    }
    return managed
  }

  /**
   * Tue le shell d'un terminal sans fermer son onglet : son environnement s'arrête, et
   * son dernier écran reste à lire, comme après un `exit`.
   */
  kill(terminalId: string): void {
    const managed = this.terminals.get(terminalId)
    if (managed && !managed.exited) managed.pty?.kill()
  }

  close(terminalId: string): void {
    const managed = this.terminals.get(terminalId)
    if (!managed) return

    if (managed.idleTimer) clearTimeout(managed.idleTimer)
    this.terminals.delete(terminalId)
    this.forget(terminalId)
    if (!managed.exited) managed.pty?.kill()
  }

  closeIn(projectId: string, terminalId: string): void {
    this.require(projectId, terminalId)
    this.close(terminalId)
  }

  /** Les essais de cette personne dans le projet, qu'un nouvel essai remplace. */
  closeTrials(projectId: string, userId: string): void {
    for (const managed of this.of(projectId)) {
      if (managed.trialOf === userId) this.close(managed.id)
    }
  }

  /** À la suppression du projet : rien ne doit continuer à tourner en son nom. */
  closeForProject(projectId: string): void {
    for (const managed of this.of(projectId)) this.close(managed.id)
  }

  /** À la suppression d'un worktree : un shell dans un dossier disparu n'a plus d'objet. */
  closeForCwd(cwd: string): void {
    for (const managed of [...this.terminals.values()]) {
      if (managed.cwd === cwd) this.close(managed.id)
    }
  }

  /** Les shells ouverts dans un dossier ou en dessous : à fermer avant qu'il parte. */
  underCwd(cwd: string): string[] {
    const prefix = cwd.endsWith('/') ? cwd : `${cwd}/`
    return [...this.terminals.values()]
      .filter((managed) => managed.cwd === cwd || managed.cwd.startsWith(prefix))
      .map((managed) => managed.id)
  }

  /**
   * Arrêt du daemon : on écrit les écrans puis on tue les process, mais on garde les
   * fichiers. C'est eux qui feront réapparaître les entrées, marquées interrompues.
   * Leurs environnements sont fermés avant de rendre la main : le conteneur d'un
   * terminal confiné (#145) ne doit pas survivre au serveur.
   */
  async shutdown(): Promise<void> {
    clearInterval(this.flushTimer)
    const environments: EnvironmentProvider[] = []
    for (const managed of this.terminals.values()) {
      if (managed.idleTimer) clearTimeout(managed.idleTimer)
      this.persistMeta(managed)
      this.flushReplay(managed)
      if (!managed.exited) managed.pty?.kill()
      if (managed.environment) environments.push(managed.environment)
    }
    this.terminals.clear()
    await Promise.all(environments.map((environment) => environment.close().catch(() => undefined)))
  }

  private restore(): void {
    for (const entry of readdirSync(this.storeDir)) {
      if (!entry.endsWith('.json')) continue
      let meta: PersistedTerminal
      try {
        meta = JSON.parse(readFileSync(join(this.storeDir, entry), 'utf8')) as PersistedTerminal
      } catch {
        // Un fichier tronqué par un arrêt brutal ne doit pas empêcher le démarrage,
        // ni rester là à échouer à chaque redémarrage.
        rmSync(join(this.storeDir, entry), { force: true })
        continue
      }

      let replay = ''
      try {
        replay = readFileSync(join(this.storeDir, `${meta.id}.replay`), 'utf8')
      } catch {
        // Pas d'écran sauvé : l'entrée réapparaît quand même, vide.
      }

      this.terminals.set(meta.id, {
        id: meta.id,
        projectId: meta.projectId,
        title: meta.title,
        pty: null,
        environment: null,
        cwd: meta.cwd,
        replay,
        replayDirty: false,
        subscribers: new Set(),
        idleTimer: null,
        cols: DEFAULT_COLS,
        rows: DEFAULT_ROWS,
        createdAt: meta.createdAt,
        exited: true,
        // Une fin enregistrée dit que le process est sorti de lui-même avant l'arrêt.
        interrupted: meta.finishedAt == null,
        actionId: meta.actionId ?? null,
        trialOf: meta.trialOf ?? null,
        conversationId: meta.conversationId ?? null,
        exitCode: meta.exitCode ?? null,
        finishedAt: meta.finishedAt ?? null,
      })
    }
  }

  private persistMeta(managed: ManagedTerminal): void {
    const meta: PersistedTerminal = {
      id: managed.id,
      projectId: managed.projectId,
      title: managed.title,
      cwd: managed.cwd,
      createdAt: managed.createdAt,
      actionId: managed.actionId,
      trialOf: managed.trialOf,
      conversationId: managed.conversationId,
      exitCode: managed.exitCode,
      finishedAt: managed.finishedAt,
    }
    try {
      writeFileSync(join(this.storeDir, `${managed.id}.json`), JSON.stringify(meta))
    } catch {
      // Disque plein ou dossier retiré : le terminal fonctionne, seule la
      // restitution après redémarrage est perdue.
    }
  }

  private flushReplay(managed: ManagedTerminal): void {
    if (!managed.replayDirty) return
    try {
      writeFileSync(join(this.storeDir, `${managed.id}.replay`), managed.replay)
      managed.replayDirty = false
    } catch {
      // Même contrat que persistMeta : on réessaiera au prochain passage.
    }
  }

  private flushDirty(): void {
    for (const managed of this.terminals.values()) this.flushReplay(managed)
  }

  private forget(terminalId: string): void {
    rmSync(join(this.storeDir, `${terminalId}.json`), { force: true })
    rmSync(join(this.storeDir, `${terminalId}.replay`), { force: true })
  }
}

/**
 * Le shell a-t-il un process enfant en cours ?
 *
 * Lecture de `/proc` sous Linux, `pgrep` sur macOS, qui n'a pas de `/proc` et sort en 1
 * quand rien ne correspond. Ailleurs, la question répond non et l'échéance d'inactivité
 * retrouve son comportement d'origine. Posée une fois par échéance, pas plus souvent :
 * l'appel synchrone ne coûte rien.
 */
function hasChildProcess(pid: number): boolean {
  try {
    if (process.platform === 'darwin') {
      return execFileSync('pgrep', ['-P', String(pid)], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim().length > 0
    }
    return readFileSync(`/proc/${pid}/task/${pid}/children`, 'utf8').trim().length > 0
  } catch {
    return false
  }
}

function toDto(managed: ManagedTerminal): TerminalDto {
  return {
    id: managed.id,
    title: managed.title,
    alive: !managed.exited,
    interrupted: managed.interrupted,
    cwd: managed.cwd,
    createdAt: managed.createdAt,
    actionId: managed.actionId,
    trial: managed.trialOf !== null,
    conversationId: managed.conversationId,
    exitCode: managed.exitCode,
    finishedAt: managed.finishedAt,
  }
}

/**
 * Le lieu d'une exécution : la session qui l'a lancée (null à la racine) et son dossier.
 * Une même session peut lancer une action à deux endroits, son worktree et un autre.
 */
function samePlace(managed: ManagedTerminal, conversationId: string | null, cwd: string): boolean {
  return managed.conversationId === conversationId && managed.cwd === cwd
}

/** Premier numéro libre, pour que les intitulés restent lisibles après des fermetures. */
function nextTitle(existing: ManagedTerminal[]): string {
  const taken = new Set(existing.map((managed) => managed.title))
  for (let index = 1; ; index += 1) {
    const candidate = `shell ${index}`
    if (!taken.has(candidate)) return candidate
  }
}
