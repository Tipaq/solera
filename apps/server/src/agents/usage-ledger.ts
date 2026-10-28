import { sql } from 'drizzle-orm'
import type { Db } from '@solera/db'
import type { AgentKind, AgentUsage, UsageLiveWindowDto, UsagePeekDto } from '@solera/protocol'

/**
 * Tout ce qu'on sait de la consommation sans rien lancer.
 *
 * Deux sources, gardées en mémoire par (CLI, compte) : la dernière lecture complète
 * réussie (`/api/agents/:agent/usage` la dépose ici en passant), et les signaux de
 * limite que les CLI émettent pendant les vrais tours (`usage.updated` porteur d'un
 * `rateLimit`). L'aperçu se construit sur elles seules : il ne sonde jamais, c'est ce
 * qui le rend gratuit pour une page qui s'ouvre sans qu'on ait rien demandé.
 *
 * `account` vaut null pour la connexion propre du CLI, sinon l'identifiant du compte
 * supplémentaire de Solera. Le registre ne sait pas à qui appartient un compte : la
 * route filtre.
 */

/** Profondeur de la relecture au démarrage, et âge au-delà duquel un signal sans date
 *  de remise à zéro ne dit plus rien. */
export const LIVE_HORIZON_MS = 7 * 24 * 3600_000

export interface LiveRateLimit {
  type: string
  status: UsageLiveWindowDto['status']
  utilization: number | null
  resetsAt: number | null
}

const STATUSES = new Set<string>(['allowed', 'allowed_warning', 'rejected'])

const keyOf = (agent: AgentKind, account: string | null) => `${agent}\u0000${account ?? ''}`

/**
 * Lit un `rateLimit` journalisé. Les événements anciens portent `resetsAt` en secondes
 * (même règle que le schéma du protocole : sous 1e12, ce sont des secondes).
 */
function toLive(value: unknown): LiveRateLimit | null {
  if (typeof value !== 'object' || value === null) return null
  const fields = value as Record<string, unknown>
  if (typeof fields.type !== 'string') return null
  const resetsAt = typeof fields.resetsAt === 'number' ? fields.resetsAt : null
  return {
    type: fields.type,
    status: typeof fields.status === 'string' && STATUSES.has(fields.status) ? (fields.status as LiveRateLimit['status']) : 'allowed',
    utilization: typeof fields.utilization === 'number' ? fields.utilization : null,
    resetsAt: resetsAt === null ? null : resetsAt < 1e12 ? resetsAt * 1000 : resetsAt,
  }
}

interface Slot {
  agent: AgentKind
  account: string | null
  probed: AgentUsage | null
  live: Map<string, UsageLiveWindowDto>
}

export class UsageLedger {
  private readonly slots = new Map<string, Slot>()

  private slot(agent: AgentKind, account: string | null): Slot {
    const key = keyOf(agent, account)
    let slot = this.slots.get(key)
    if (!slot) {
      slot = { agent, account, probed: null, live: new Map() }
      this.slots.set(key, slot)
    }
    return slot
  }

  /** Une lecture complète a réussi : elle devient la dernière connue, quel que soit l'âge
   *  de celle qu'elle remplace. */
  recordProbe(agent: AgentKind, account: string | null, usage: AgentUsage): void {
    this.slot(agent, account).probed = usage
  }

  /** Un signal de limite vu pendant un tour. Un signal plus ancien que celui qu'on a déjà
   *  pour la même fenêtre est ignoré : la relecture du journal peut arriver après coup. */
  recordLive(agent: AgentKind, account: string | null, rateLimit: LiveRateLimit, at: number = Date.now()): void {
    const live = this.slot(agent, account).live
    const known = live.get(rateLimit.type)
    if (known && known.at > at) return
    live.set(rateLimit.type, { ...rateLimit, at })
  }

  /**
   * Relit dans le journal le dernier signal par (CLI, compte, fenêtre) des sept derniers
   * jours, pour qu'un redémarrage ne vide pas l'aperçu. Une seule requête, bornée par
   * les conversations touchées dans la période (`updated_at` suit chaque événement) :
   * la table des événements n'a pas d'index sur le type, et la balayer entière coûterait
   * au démarrage ce qu'on cherche justement à ne pas payer.
   */
  seed(db: Db, now: number = Date.now()): void {
    const since = now - LIVE_HORIZON_MS
    const rows = db.all<{ agent: AgentKind; account: string | null; payload: string; ts: number }>(sql`
      SELECT c.agent AS agent,
             c.config ->> '$.account' AS account,
             e.payload AS payload,
             MAX(e.ts) AS ts
        FROM conversations c
        JOIN events e ON e.conversation_id = c.id
       WHERE c.updated_at >= ${since}
         AND e.type = 'usage.updated'
         AND e.ts >= ${since}
         AND e.payload ->> '$.rateLimit' IS NOT NULL
       GROUP BY c.agent, account, e.payload ->> '$.rateLimit.type'
    `)
    for (const row of rows) {
      let payload: unknown
      try {
        payload = JSON.parse(row.payload)
      } catch {
        continue
      }
      const rateLimit = toLive((payload as { rateLimit?: unknown }).rateLimit)
      if (rateLimit) this.recordLive(row.agent, row.account ?? null, rateLimit, row.ts)
    }
  }

  /**
   * L'aperçu, restreint à ce que `visible` laisse voir. Les fenêtres déjà remises à zéro
   * sont retirées au passage : un signal d'avant la remise ne décrit plus rien.
   */
  peek(visible: (agent: AgentKind, account: string | null) => boolean, now: number = Date.now()): UsagePeekDto[] {
    const entries: UsagePeekDto[] = []
    for (const slot of this.slots.values()) {
      for (const [type, window] of slot.live) {
        const stale = window.resetsAt === null ? window.at < now - LIVE_HORIZON_MS : window.resetsAt <= now
        if (stale) slot.live.delete(type)
      }
      if (!visible(slot.agent, slot.account)) continue
      if (slot.probed === null && slot.live.size === 0) continue
      entries.push({
        agent: slot.agent,
        account: slot.account,
        probed: slot.probed,
        live: [...slot.live.values()].sort((a, b) => a.type.localeCompare(b.type)),
      })
    }
    return entries
  }
}
