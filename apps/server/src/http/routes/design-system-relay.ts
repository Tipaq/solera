import { request as httpRequest, type IncomingHttpHeaders, type IncomingMessage } from 'node:http'
import { connect } from 'node:net'
import type { Duplex } from 'node:stream'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { StorybookSupervisor } from '../../design-system/storybooks.js'

/**
 * Le relais des Storybook de design system, sous `/ds/<jeton>/` (carte #63).
 *
 * Un prototype s'affiche dans la vue *Web*, et la vue Web peut être regardée depuis le
 * téléphone : l'adresse du Storybook, `127.0.0.1:<port>`, n'y mène nulle part, et une
 * page servie en https n'encadre pas du http. Le relais le sert donc depuis l'origine
 * de Solera, d'où qu'on la joigne.
 *
 * **Le contenu relayé n'a jamais l'origine de Solera.** C'est le code du DS et celui
 * qu'un agent a écrit dans un prototype : avec l'origine de Solera, il lirait l'API avec
 * la session de qui le regarde. Chaque réponse porte donc une CSP `sandbox` sans
 * `allow-same-origin`, qui la rend opaque même ouverte hors du cadre, dans un onglet.
 * La contrepartie est double :
 *
 * - le cookie de session ne suit pas les requêtes d'un document opaque, d'où le jeton
 *   dans le chemin, seul secret du relais (`StorybookSupervisor.token`) ;
 * - `localStorage` lève une exception dans un document opaque, et Storybook y lit ses
 *   réglages au démarrage : une page relayée reçoit un stockage en mémoire.
 *
 * Vite sert ses modules sous le préfixe (le module du DS lui donne `base`), mais les
 * routes propres de Storybook restent à la racine de son serveur : le relais retire
 * le préfixe pour elles seules.
 */

/** Les routes du serveur de Storybook, servies à sa racine et non sous `base`. */
const STORYBOOK_ROUTES = /^\/(?:$|\?|index\.html|iframe\.html|index\.json|project\.json|manifests\/|sb-[\w-]+\/|favicon\.|storybook-server-channel|vite-inject-mocker-entry\.js)/

/** En-têtes qui ne passent pas un relais, plus ceux de la session de Solera. */
const DROPPED_REQUEST_HEADERS = ['host', 'cookie', 'authorization', 'origin', 'referer', 'accept-encoding', 'connection']
const DROPPED_RESPONSE_HEADERS = [
  'content-security-policy',
  'x-frame-options',
  'content-length',
  'content-encoding',
  'transfer-encoding',
  'connection',
  'keep-alive',
]

const SANDBOX_POLICY = "sandbox allow-scripts allow-forms allow-popups allow-modals allow-downloads; frame-ancestors 'self'"

export function registerDesignSystemRelay(app: FastifyInstance, storybooks: StorybookSupervisor): void {
  app.get<{ Params: { token: string } }>('/ds/:token', (request, reply) => {
    reply.redirect(`/ds/${request.params.token}/`)
  })
  app.route<{ Params: { token: string; '*': string } }>({
    method: ['GET', 'HEAD'],
    url: '/ds/:token/*',
    handler: (request, reply) => relayHttp(storybooks, request, reply),
  })

  // Les websockets ne passent pas par une route : `@fastify/websocket` route toutes les
  // montées de protocole vers les siennes et ferme les autres. Ses écouteurs sont donc
  // repris derrière un aiguillage, une fois enregistrés, et ceux du relais passent avant.
  app.addHook('onReady', async () => {
    const server = app.server
    const others = server.listeners('upgrade') as ((...args: unknown[]) => void)[]
    server.removeAllListeners('upgrade')
    server.on('upgrade', (raw: IncomingMessage, socket: Duplex, head: Buffer) => {
      if (raw.url?.startsWith('/ds/')) {
        relayUpgrade(storybooks, raw, socket, head)
        return
      }
      for (const listener of others) listener.call(server, raw, socket, head)
    })
  })
}

/**
 * Les websockets de Storybook : son canal seulement. Celle du HMR de Vite se branche à
 * la racine du préfixe (`/ds/<jeton>/?token=…`), que la page du gestionnaire partage en
 * HTTP : elle garde donc le préfixe.
 */
const STORYBOOK_SOCKETS = /^\/storybook-server-channel/

/** Le jeton et la suite du chemin, pour le Storybook : avec ou sans le préfixe. */
function split(url: string, routes: RegExp): { token: string; upstreamPath: string } | null {
  const match = /^\/ds\/([0-9a-f]{32})(\/.*)$/.exec(url)
  if (!match) return null
  const [, token, rest] = match as unknown as [string, string, string]
  return { token, upstreamPath: routes.test(rest) ? rest : url }
}

function relayHttp(
  storybooks: StorybookSupervisor,
  request: FastifyRequest,
  reply: FastifyReply,
): void {
  const parts = split(request.url, STORYBOOK_ROUTES)
  const target = parts ? storybooks.resolve(parts.token) : null
  if (!parts || !target) {
    void reply.code(404).send({ error: { code: 'not_found', message: 'Unknown design system.' } })
    return
  }
  if (!target.url) {
    // Il démarre : une navigation reçoit une page qui se recharge, le reste attend.
    if (/text\/html/.test(request.headers.accept ?? '')) {
      void reply
        .code(503)
        .header('content-security-policy', SANDBOX_POLICY)
        .header('retry-after', '2')
        .type('text/html; charset=utf-8')
        .send(STARTING_PAGE)
    } else {
      void reply.code(503).header('retry-after', '2').send()
    }
    return
  }

  reply.hijack()
  const upstream = new URL(target.url)
  const proxied = httpRequest(
    {
      host: upstream.hostname,
      port: upstream.port,
      method: request.method,
      path: parts.upstreamPath,
      headers: { ...forwarded(request.headers), host: upstream.host, 'accept-encoding': 'identity' },
    },
    (response) => {
      const headers: Record<string, string | string[]> = {}
      for (const [name, value] of Object.entries(response.headers)) {
        if (value !== undefined && !DROPPED_RESPONSE_HEADERS.includes(name)) headers[name] = value
      }
      headers['content-security-policy'] = SANDBOX_POLICY
      // Un document opaque charge ses modules en CORS, depuis l'origine `null`.
      headers['access-control-allow-origin'] = '*'
      headers['cache-control'] = 'no-store'

      const raw = reply.raw
      if (!/text\/html/.test(String(response.headers['content-type'] ?? ''))) {
        raw.writeHead(response.statusCode ?? 502, headers)
        response.pipe(raw)
        return
      }
      const chunks: Buffer[] = []
      response.on('data', (chunk: Buffer) => chunks.push(chunk))
      response.on('end', () => {
        const base = `/ds/${parts.token}/`
        const body = rewriteHtml(Buffer.concat(chunks).toString('utf8'), base)
        raw.writeHead(response.statusCode ?? 502, { ...headers, 'content-length': Buffer.byteLength(body) })
        raw.end(body)
      })
    },
  )
  proxied.on('error', () => {
    if (!reply.raw.headersSent) reply.raw.writeHead(502)
    reply.raw.end()
  })
  proxied.end()
}

function relayUpgrade(storybooks: StorybookSupervisor, raw: IncomingMessage, socket: Duplex, head: Buffer): void {
  const parts = split(raw.url ?? '', STORYBOOK_SOCKETS)
  const target = parts ? storybooks.resolve(parts.token) : null
  if (!parts || !target?.url) {
    socket.end('HTTP/1.1 404 Not Found\r\n\r\n')
    return
  }
  const upstream = new URL(target.url)
  const remote = connect(Number(upstream.port), upstream.hostname, () => {
    // Storybook n'accepte son canal que de sa propre origine : vu d'un document opaque,
    // l'origine est `null`. Le relais parle donc en son nom.
    const headers = { ...forwarded(raw.headers), host: upstream.host, origin: upstream.origin }
    const lines = [`GET ${parts.upstreamPath} HTTP/1.1`]
    for (const [name, value] of Object.entries(headers)) {
      for (const one of [value].flat()) if (one !== undefined) lines.push(`${name}: ${one}`)
    }
    lines.push('connection: Upgrade', '', '')
    remote.write(lines.join('\r\n'))
    if (head.length > 0) remote.write(head)
    remote.pipe(socket)
    socket.pipe(remote)
  })
  remote.on('error', () => socket.destroy())
  socket.on('error', () => remote.destroy())
  socket.on('close', () => remote.destroy())
}

function forwarded(headers: IncomingHttpHeaders): IncomingHttpHeaders {
  const kept: IncomingHttpHeaders = {}
  for (const [name, value] of Object.entries(headers)) {
    if (!DROPPED_REQUEST_HEADERS.includes(name)) kept[name] = value
  }
  return kept
}

/**
 * Une page relayée : le stockage en mémoire avant tout script, et ses adresses
 * absolues ramenées sous le préfixe. Deux d'entre elles sont écrites par Storybook dans
 * son gabarit, hors de Vite, et ne connaissent pas `base`.
 */
export function rewriteHtml(html: string, base: string): string {
  // Ni celles qui y sont déjà, ni celles d'un autre hôte (`//cdn…`).
  const already = base.slice(1).replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
  const rebased = html.replace(new RegExp(`(\\s(?:src|href)=")/(?!/|${already})`, 'g'), `$1${base}`)
  const shim = `<script>${pageShim(base)}</script>`
  return /<head[^>]*>/i.test(rebased) ? rebased.replace(/<head[^>]*>/i, (tag) => tag + shim) : shim + rebased
}

/**
 * Ce que la page relayée ne trouverait pas dans un document opaque : un stockage, et le
 * canal de Storybook, dont l'adresse est calculée à la racine de l'hôte.
 */
function pageShim(base: string): string {
  return `(()=>{
const memory=()=>{const m=new Map();return{get length(){return m.size},key:i=>[...m.keys()][i]??null,getItem:k=>m.has(String(k))?m.get(String(k)):null,setItem:(k,v)=>{m.set(String(k),String(v))},removeItem:k=>{m.delete(String(k))},clear:()=>m.clear()}};
for(const name of ['localStorage','sessionStorage']){try{window[name]}catch{Object.defineProperty(window,name,{value:memory(),configurable:true})}}
const Native=window.WebSocket;
window.WebSocket=class extends Native{constructor(url,protocols){const target=new URL(url,location.href);if(target.pathname==='/storybook-server-channel')target.pathname=${JSON.stringify(base)}+'storybook-server-channel';super(target,protocols)}};
})()`
}

const STARTING_PAGE = `<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="2"><meta name="color-scheme" content="light dark"><title>Storybook</title><style>body{margin:0;display:grid;place-items:center;height:100vh;font:13px system-ui;opacity:.6}</style><body>Storybook…</body>`
