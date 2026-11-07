import { randomUUID } from 'node:crypto'
import { and, asc, eq, isNull, sql } from 'drizzle-orm'
import { claudeAccounts, type Db } from '@solera/db'
import { claudeAccountName, claudeSecretKind, type ClaudeAccount, type ClaudeAccountKind } from '@solera/protocol'
import { decryptValue, encryptValue } from '../secrets/cipher.js'
import type { ClaudeAccountGauges } from './gauges.js'

/**
 * L'ordre des comptes, le même partout : le sélecteur les montre ainsi, et un fil sans
 * compte choisi hérite du premier (`accountLayer`). Par nom affiché, alias d'abord.
 */
export const claudeAccountOrder = asc(sql`lower(coalesce(${claudeAccounts.alias}, ${claudeAccounts.email}, ''))`)

/**
 * Secrets des comptes Claude supplémentaires, un par compte et par utilisateur.
 *
 * Un compte est une adresse Claude : le magasin n'en crée jamais deux pour la même. Le
 * gestionnaire de sessions en lit un au lancement d'une conversation qui le désigne,
 * pour le poser dans l'environnement du CLI ; les routes ne rendent que l'adresse,
 * l'alias et la nature du secret, comme pour les credentials git.
 */
export class ClaudeAccountStore {
  constructor(
    private readonly db: Db,
    private readonly key: Buffer,
    /** Absentes, aucun compte n'a de jauge : c'est le cas des tests qui ne la regardent pas. */
    readonly gauges: ClaudeAccountGauges | null = null,
  ) {}

  list(ownerId: string): ClaudeAccount[] {
    const rows = this.db
      .select({
        id: claudeAccounts.id,
        email: claudeAccounts.email,
        alias: claudeAccounts.alias,
        kind: claudeAccounts.kind,
        createdAt: claudeAccounts.createdAt,
        updatedAt: claudeAccounts.updatedAt,
      })
      .from(claudeAccounts)
      .where(eq(claudeAccounts.ownerId, ownerId))
      .orderBy(claudeAccountOrder)
      .all()
    return rows.map((row) => ({
      ...row,
      label: claudeAccountName(row),
      duplicate: row.email !== null && rows.some((other) => other.id !== row.id && other.email === row.email),
      gauge: row.kind === 'oauth' && (this.gauges?.has(row.id) ?? false),
    }))
  }

  /** Le compte, s'il appartient bien à cet utilisateur, sans son secret. */
  find(ownerId: string, id: string): ClaudeAccount | undefined {
    return this.list(ownerId).find((account) => account.id === id)
  }

  /** Le compte de cette adresse, s'il existe déjà chez cet utilisateur. */
  findByEmail(ownerId: string, email: string): ClaudeAccount | undefined {
    return this.list(ownerId).find((account) => account.email === email)
  }

  create(ownerId: string, identity: { email: string | null; alias: string | null }, secret: string): ClaudeAccount {
    const now = Date.now()
    const id = randomUUID()
    const kind = claudeSecretKind(secret)
    this.db
      .insert(claudeAccounts)
      .values({ id, ownerId, ...identity, kind, ...encryptValue(this.key, secret), createdAt: now, updatedAt: now })
      .run()
    return this.find(ownerId, id)!
  }

  /**
   * Change l'alias (`null` le retire), remplace le secret, ou pose l'adresse retrouvée.
   * L'adresse n'est vérifiée qu'en amont : c'est à l'appelant de refuser un jeton qui
   * mène à un autre compte.
   */
  update(
    ownerId: string,
    id: string,
    patch: { alias?: string | null; token?: string; email?: string },
  ): boolean {
    if (!this.row(ownerId, id)) return false
    this.db
      .update(claudeAccounts)
      .set({
        ...(patch.alias === undefined ? {} : { alias: patch.alias }),
        ...(patch.email === undefined ? {} : { email: patch.email }),
        ...(patch.token === undefined
          ? {}
          : { kind: claudeSecretKind(patch.token), ...encryptValue(this.key, patch.token) }),
        // L'adresse retrouvée ne change ni le nom ni le secret : la date reste celle du jeton.
        ...(patch.alias === undefined && patch.token === undefined ? {} : { updatedAt: Date.now() }),
      })
      .where(eq(claudeAccounts.id, id))
      .run()
    return true
  }

  /**
   * Les abonnements d'avant les adresses, tous utilisateurs confondus : le démarrage
   * retrouve la leur sous leur jeton.
   */
  withoutEmail(): Array<{ ownerId: string; id: string }> {
    return this.db
      .select({ ownerId: claudeAccounts.ownerId, id: claudeAccounts.id })
      .from(claudeAccounts)
      .where(and(isNull(claudeAccounts.email), eq(claudeAccounts.kind, 'oauth')))
      .all()
  }

  delete(ownerId: string, id: string): boolean {
    if (!this.row(ownerId, id)) return false
    this.db.delete(claudeAccounts).where(eq(claudeAccounts.id, id)).run()
    // Sa connexion de jauge part avec lui : un abonnement qu'on retire ne se lit plus.
    this.gauges?.forget(id)
    return true
  }

  /**
   * Le secret en clair et sa nature, pour l'environnement d'une session. Le
   * propriétaire est exigé avec l'identifiant : une configuration de projet partagée
   * peut désigner le compte d'un autre, qui ne doit pas se retrouver dans ses sessions.
   */
  resolveToken(ownerId: string, id: string): { label: string; kind: ClaudeAccountKind; token: string } | undefined {
    const row = this.row(ownerId, id)
    if (!row) return undefined
    const label = claudeAccountName(row)
    try {
      return { label, kind: row.kind, token: decryptValue(this.key, row) }
    } catch (err) {
      throw new Error(
        `Le secret du compte Claude « ${label} » n'a pas pu être déchiffré : ` +
          `${err instanceof Error ? err.message : String(err)}. ` +
          'La clé de chiffrement ne correspond pas à la base, ou la ligne a été modifiée.',
      )
    }
  }

  private row(ownerId: string, id: string) {
    return this.db
      .select()
      .from(claudeAccounts)
      .where(and(eq(claudeAccounts.ownerId, ownerId), eq(claudeAccounts.id, id)))
      .get()
  }
}
