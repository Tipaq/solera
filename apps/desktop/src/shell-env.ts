import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'

/** Au-delà, le shell est jugé bloqué (une invite dans un `.zshrc`, un réseau lent). */
const SHELL_TIMEOUT_MS = 10_000
/** Après la sortie du shell, le temps laissé au tube pour livrer ce qu'il contient. */
const STDOUT_DRAIN_MS = 500

/**
 * Les dossiers où les installeurs courants posent leurs binaires, repris du service
 * launchd de l'installeur (`deploy/solera.plist.tmpl`). Servent quand le shell de
 * connexion ne répond pas.
 */
const COMMON_BIN_DIRS = [
  join(homedir(), '.local/bin'),
  join(homedir(), '.npm-global/bin'),
  join(homedir(), '.bun/bin'),
  '/opt/homebrew/bin',
  '/usr/local/bin',
]

/**
 * L'environnement du shell de connexion de l'utilisateur, celui de ses terminaux.
 *
 * Lancée depuis le Finder ou un menu d'applications, l'app hérite de l'environnement
 * minimal du gestionnaire de session ; sur macOS, `PATH=/usr/bin:/bin:/usr/sbin:/sbin`.
 * Ni les CLI des agents, ni Homebrew, ni nvm n'y figurent, et le serveur ne trouverait
 * rien à lancer. On demande donc au shell de l'utilisateur, en connexion et en interactif
 * comme un terminal, d'afficher le sien. C'est le Node embarqué qui l'écrit, en JSON :
 * la sortie ne dépend ni du shell (zsh, bash, fish) ni des valeurs sur plusieurs lignes.
 *
 * `lang` sert quand aucune locale n'est posée, ce qui est la règle pour une app lancée
 * depuis le Finder : sans elle, zsh affiche les accents en séquences d'octets.
 */
export async function loginShellEnv(node: string, lang: string): Promise<NodeJS.ProcessEnv> {
  const base = withoutLauncherVars(process.env)
  let env: NodeJS.ProcessEnv
  try {
    env = process.platform === 'win32' ? base : await askLoginShell(node, base)
  } catch {
    env = { ...base, PATH: [base.PATH, ...COMMON_BIN_DIRS].filter(Boolean).join(delimiter) }
  }
  env.LANG ??= lang
  return env
}

async function askLoginShell(node: string, base: NodeJS.ProcessEnv): Promise<NodeJS.ProcessEnv> {
  const shell = base.SHELL || (process.platform === 'darwin' ? '/bin/zsh' : '/bin/sh')
  const mark = randomUUID()
  const script =
    '"$SOLERA_ENV_NODE" -e "process.stdout.write(process.env.SOLERA_ENV_MARK + JSON.stringify(process.env) + process.env.SOLERA_ENV_MARK)"'
  const output = await run(shell, ['-ilc', script], { ...base, SOLERA_ENV_NODE: node, SOLERA_ENV_MARK: mark })
  // Ce que les fichiers du shell écrivent avant ou après (un message d'accueil) reste
  // hors des marques.
  const json = output.split(mark)[1]
  if (!json) throw new Error("le shell de connexion n'a pas rendu son environnement")
  const env = JSON.parse(json) as NodeJS.ProcessEnv
  delete env.SOLERA_ENV_NODE
  delete env.SOLERA_ENV_MARK
  return withoutLauncherVars(env)
}

/**
 * La clé du PATH dans `env`. Sous Windows elle s'écrit `Path`, et une copie de
 * `process.env` en objet ordinaire n'est plus insensible à la casse : écrire `PATH` à côté
 * créerait une seconde variable, et le processus enfant ne lirait que l'une des deux.
 */
export function pathKey(env: NodeJS.ProcessEnv): string {
  return Object.keys(env).find((key) => key.toUpperCase() === 'PATH') ?? 'PATH'
}

function run(command: string, args: string[], env: NodeJS.ProcessEnv): Promise<string> {
  return new Promise((resolve, reject) => {
    // stdin fermé : un shell interactif qui poserait une question n'attend pas une
    // réponse qui ne viendra jamais.
    const child = spawn(command, args, { env, stdio: ['ignore', 'pipe', 'ignore'] })
    let output = ''
    let settled = false
    const settle = (err: Error | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      clearTimeout(drain)
      if (err) reject(err)
      else resolve(output)
    }
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      output += chunk
    })
    // Un petit-enfant lancé par les fichiers du shell (ssh-agent, direnv) peut garder
    // stdout ouvert après la sortie du shell : on n'attend donc que la fin du shell, plus
    // le temps de vider le tube, et le délai ferme le tube lui aussi.
    let drain: NodeJS.Timeout | undefined
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      child.stdout.destroy()
      settle(new Error(`le shell de connexion n'a pas répondu en ${SHELL_TIMEOUT_MS / 1000} s`))
    }, SHELL_TIMEOUT_MS)
    child.on('error', (err) => settle(err))
    child.on('exit', (code) => {
      const done = () => settle(code === 0 ? null : new Error(`le shell de connexion a rendu ${code}`))
      if (child.stdout.closed) return done()
      child.stdout.once('close', done)
      drain = setTimeout(() => child.stdout.destroy(), STDOUT_DRAIN_MS)
    })
  })
}

/**
 * Retire ce que l'emballage de l'app ajoute à l'environnement et qui n'a rien à faire
 * chez les agents ni dans les terminaux. Une AppImage pose `APPDIR` et préfixe des
 * chemins vers son point de montage, qui change à chaque lancement : un `git` lancé par
 * un agent chargerait sinon les bibliothèques embarquées dans l'app.
 *
 * Toutes les variables `SOLERA_*` partent aussi : le serveur reçoit les siennes du
 * lanceur (`server.ts`), et une app ouverte depuis un terminal d'une autre instance
 * hériterait sinon de son dossier d'installation, de ses serveurs MCP ou de son web.
 * Le profil jetable du contrôle de lancement, lui, ne regarde que l'app.
 */
function withoutLauncherVars(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env = { ...source }
  const appDir = env.APPDIR
  for (const name of Object.keys(env)) {
    if (name.startsWith('SOLERA_')) delete env[name]
  }
  for (const name of ['APPDIR', 'APPIMAGE', 'ARGV0', 'OWD', 'CHROME_DESKTOP', 'ELECTRON_RUN_AS_NODE']) {
    delete env[name]
  }
  if (appDir) {
    for (const name of ['PATH', 'LD_LIBRARY_PATH', 'XDG_DATA_DIRS']) {
      const kept = env[name]?.split(delimiter).filter((entry) => entry && !entry.startsWith(appDir))
      if (kept && kept.length > 0) env[name] = kept.join(delimiter)
      else delete env[name]
    }
  }
  return env
}
