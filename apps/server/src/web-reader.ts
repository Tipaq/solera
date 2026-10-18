import dns, { type LookupAddress, type LookupAllOptions } from 'node:dns'
import { BlockList, isIP, type LookupFunction } from 'node:net'
import { fork } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { Agent, fetch, type Response } from 'undici'
import { readerUrl, type WebPageDto } from '@solera/protocol'
import type { WebArticle } from './web-article.js'

export { sanitizeHtml } from './web-article.js'

/**
 * La lecture d'une page du web pour la vue *Web* du panneau.
 *
 * Le serveur va chercher l'adresse qu'on lui donne, réseau local compris : c'est voulu,
 * les aperçus d'une application qui tourne sur la machine passent par là. Seules les
 * adresses de liaison locale (le service de métadonnées d'un hôte cloud, `169.254/16`)
 * et l'API locale de Tailscale sont refusées, à chaque saut de redirection, sur
 * l'adresse même à laquelle on se connecte.
 *
 * L'article est extrait dans un processus à part, au tas borné : une page lourde tue
 * ce processus-là, pas le serveur qui pilote les agents.
 */

/** Au-delà, ce n'est plus une page à lire : on s'arrête de télécharger. */
const MAX_BYTES = 5 * 1024 * 1024
const TIMEOUT_MS = 12_000
const MAX_REDIRECTS = 5

/**
 * Les bornes de l'extraction. Deux processus à la fois : une page qui pend n'arrête
 * pas toutes les autres. `budgetMs` compte l'attente d'une place avec l'extraction
 * elle-même, pour qu'une lecture finisse toujours, lue ou refusée. Les tests les
 * resserrent.
 */
export const parseLimits = {
  /** Le tas d'un processus : ce qu'une page lourde peut coûter, et pas plus. */
  heapMb: 256,
  parallel: 2,
  /** Au-delà des extractions en cours, les pages qui attendent une place. */
  waiting: 4,
  timeoutMs: 10_000,
  budgetMs: 20_000,
}

const HEADERS = {
  // Certains sites refusent un client sans navigateur ; celui-ci dit ce qu'il est.
  'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) Solera/1.0 (reader view)',
  accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
}

/**
 * Les adresses jamais lues. Un nom est vérifié par la résolution même de la connexion
 * (`checkedLookup`), pas par une résolution faite avant : un serveur DNS qui répond une
 * adresse publique puis une adresse interdite (DNS rebinding) n'a pas de seconde
 * réponse à placer. Une adresse écrite en chiffres ne passe pas par le DNS : elle est
 * vérifiée avant la requête (`assertReachable`).
 */
const BLOCKED = new BlockList()
BLOCKED.addSubnet('169.254.0.0', 16, 'ipv4')
BLOCKED.addSubnet('fe80::', 10, 'ipv6')
// Quad100, le résolveur et l'interface de Tailscale, sous ses deux adresses.
BLOCKED.addAddress('100.100.100.100', 'ipv4')
BLOCKED.addAddress('fd7a:115c:a1e0::53', 'ipv6')

const RESERVED = 'This address is reserved to the machine and cannot be read.'

function blocked(address: string, family: number): boolean {
  return BLOCKED.check(address, family === 6 ? 'ipv6' : 'ipv4')
}

/**
 * La résolution des connexions de la lecture : refuse le nom dont une adresse est
 * interdite. `dns.lookup` est lu à chaque appel, ce qui laisse les tests y substituer un
 * DNS qui change de réponse.
 */
const checkedLookup = ((hostname: string, options: LookupAllOptions, callback: (
  err: Error | null, address: string | LookupAddress[], family?: number,
) => void) => {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, [])
    if (addresses.some(({ address, family }) => blocked(address, family))) return callback(new WebReadError(RESERVED), [])
    const [first] = addresses
    if (options.all || !first) callback(null, addresses)
    else callback(null, first.address, first.family)
  })
}) as LookupFunction

const dispatcher = new Agent({ connect: { lookup: checkedLookup } })

/** `safeUrl` reste le nom côté serveur ; la règle vit dans le protocole, partagée. */
export const safeUrl = readerUrl

/**
 * Vrai si la page accepte d'être affichée dans un cadre d'une autre origine.
 *
 * Plusieurs en-têtes `Content-Security-Policy` arrivent joints par « , » : chacune de
 * ces politiques doit l'accepter. `frame-ancestors` l'emporte sur `X-Frame-Options`,
 * comme dans le navigateur, et ne l'accepte que par `*` ou un schéma — l'origine de
 * Solera n'y figure jamais. `https:` est compté comme une acceptation : Solera est servi
 * en https hors de la machine. De `X-Frame-Options`, seuls `DENY` et `SAMEORIGIN`
 * refusent ; le navigateur ignore toute autre valeur.
 */
export function embeddable(headers: { get(name: string): string | null }): boolean {
  const policies = (headers.get('content-security-policy') ?? '').split(',')
  const ancestors = policies.flatMap((policy) => {
    const match = /(?:^|;)\s*frame-ancestors(?=[\s;]|$)([^;]*)/i.exec(policy)
    return match ? [(match[1] ?? '').trim().split(/\s+/)] : []
  })
  if (ancestors.length > 0) {
    return ancestors.every((sources) => sources.some((source) => source === '*' || /^https?:$/i.test(source)))
  }
  const frameOptions = (headers.get('x-frame-options') ?? '').split(',').map((value) => value.trim().toLowerCase())
  return !frameOptions.some((value) => value === 'deny' || value === 'sameorigin')
}

export class WebReadError extends Error {}

/**
 * Lit une page. Avec `frameOnly`, seuls les en-têtes comptent : c'est ce dont le mode
 * *Direct* a besoin pour savoir si le cadre s'affichera, sans payer l'extraction.
 */
export async function readWebPage(target: string, { frameOnly = false } = {}): Promise<WebPageDto> {
  const start = safeUrl(target, 'https://invalid.example/')
  if (!start || !/^https?:/.test(start)) throw new WebReadError('Only http and https addresses can be read.')

  const signal = AbortSignal.timeout(TIMEOUT_MS)
  try {
    const { response, url } = await fetchFollowing(start, signal)
    const contentType = (response.headers.get('content-type') ?? '').split(';')[0]?.trim() ?? ''
    const frame = embeddable(response.headers)
    if (!response.ok) {
      await response.body?.cancel()
      throw new WebReadError(`HTTP ${response.status}`)
    }

    const html = contentType === 'text/html' || contentType === 'application/xhtml+xml'
    if (!html || frameOnly) {
      await response.body?.cancel()
      return { url, title: url, siteName: null, byline: null, html: null, contentType, embeddable: frame }
    }

    const article = await parseApart(await readCapped(response), url)
    if (!article.html.trim()) throw new WebReadError('This page has no readable text.')
    return { url, ...article, contentType, embeddable: frame }
  } catch (err) {
    if (err instanceof WebReadError) throw err
    // Un refus de `checkedLookup` arrive enveloppé dans l'échec de `fetch`.
    if (err instanceof Error && err.cause instanceof WebReadError) throw err.cause
    if (signal.aborted) throw new WebReadError('The page took too long to answer.')
    throw new WebReadError(err instanceof Error ? err.message : String(err))
  }
}

/** Suit les redirections une à une, pour vérifier chaque adresse avant d'y aller. */
async function fetchFollowing(start: string, signal: AbortSignal): Promise<{ response: Response; url: string }> {
  let url = start
  for (let hop = 0; ; hop++) {
    assertReachable(url)
    const response = await fetch(url, { redirect: 'manual', signal, headers: HEADERS, dispatcher })
    const location = response.headers.get('location')
    if (response.status < 300 || response.status >= 400 || !location) return { response, url }

    await response.body?.cancel()
    if (hop >= MAX_REDIRECTS) throw new WebReadError('Too many redirects.')
    const next = safeUrl(location, url)
    if (!next || !/^https?:/.test(next)) throw new WebReadError('Redirected to an address that cannot be read.')
    url = next
  }
}

/** Une adresse en chiffres, que la connexion ne résoudra pas : vérifiée ici. */
function assertReachable(url: string): void {
  const host = new URL(url).hostname.replace(/^\[|\]$/g, '')
  const family = isIP(host)
  if (family && blocked(host, family)) throw new WebReadError(RESERVED)
}

async function readCapped(response: Response): Promise<Uint8Array> {
  const reader = response.body?.getReader()
  if (!reader) return new Uint8Array()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > MAX_BYTES) {
      await reader.cancel()
      break
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks)
}

/** Le processus d'extraction : `.ts` sous tsx, `.js` une fois construit, à côté de ce module. */
const WORKER_PATH = fileURLToPath(new URL(
  import.meta.url.endsWith('.ts') ? './web-reader-worker.ts' : './web-reader-worker.js',
  import.meta.url,
))

let running = 0
const queued: (() => void)[] = []

/** La place libérée passe à la page qui attend, s'il y en a une. */
function release(): void {
  const next = queued.shift()
  if (next) next()
  else running--
}

/**
 * Extrait l'article dans un processus jetable, au tas borné : voir `parseLimits`.
 *
 * Le serveur tourne avec un tas de 256 Mo, et quelques Mo de balisage dense suffisent à
 * le dépasser. Un `worker_thread` ne suffit pas : son `resourceLimits` ne rattrape pas
 * toutes les allocations, et un dépassement emporte alors tout le processus. Un
 * processus à part meurt seul, et la page est dite trop lourde.
 *
 * L'attente est bornée par construction : `waiting` pages derrière `parallel` places
 * attendent au plus `waiting / parallel` extractions, chacune bornée par `timeoutMs`.
 */
async function parseApart(bytes: Uint8Array, url: string): Promise<WebArticle> {
  const deadline = Date.now() + parseLimits.budgetMs
  if (running < parseLimits.parallel) running++
  else if (queued.length >= parseLimits.waiting) throw new WebReadError('Too many pages are being read; try again.')
  else await new Promise<void>((resolve) => queued.push(resolve))
  try {
    const left = Math.min(parseLimits.timeoutMs, deadline - Date.now())
    if (left <= 0) throw new WebReadError('This page took too long to read.')
    return await runApart(bytes, url, left)
  } finally {
    release()
  }
}

function runApart(bytes: Uint8Array, url: string, timeoutMs: number): Promise<WebArticle> {
  return new Promise((resolve, reject) => {
    const child = fork(WORKER_PATH, [], {
      // Les options de Node du serveur (le chargeur de tsx en développement), sans
      // celles du lanceur de tests, et avec le tas borné en dernier, qui l'emporte.
      execArgv: [...process.execArgv.filter((arg) => !arg.startsWith('--test')), `--max-old-space-size=${parseLimits.heapMb}`],
      serialization: 'advanced',
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    })
    const timer = setTimeout(() => {
      reject(new WebReadError('This page took too long to read.'))
      child.kill('SIGKILL')
    }, timeoutMs)
    child.once('message', (reply: { article: WebArticle } | { error: string }) => {
      clearTimeout(timer)
      if ('article' in reply) resolve(reply.article)
      else reject(new WebReadError(reply.error))
    })
    child.once('error', (err) => {
      clearTimeout(timer)
      reject(new WebReadError(err.message))
    })
    // Sans effet si la promesse est déjà tenue. Sinon, un tas dépassé sort en SIGABRT.
    child.once('exit', (code, signal) => {
      clearTimeout(timer)
      reject(new WebReadError(signal === 'SIGABRT' || code === 134 ? 'This page is too heavy to read.' : 'The page could not be read.'))
    })
    child.send({ bytes, url })
  })
}
