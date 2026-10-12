import type { FastifyInstance } from 'fastify'
import {
  vaultNotesQuerySchema,
  type VaultFolderDto,
  type VaultNoteDto,
  type VaultNoteFactsDto,
  type VaultReindexDto,
  type VaultStateDto,
} from '@solera/protocol'
import { isVaultNotePath } from '../../vault/notes.js'
import type { VaultIndex } from '../../vault/index-service.js'
import { listFolders, listNotes, readNoteFacts } from '../../vault/store.js'
import type { AppContext } from '../context.js'
import { badRequest, notFound } from '../errors.js'
import { requireUser } from '../require-user.js'

/**
 * L'index du vault, en lecture : les **faits du texte**.
 *
 * Toutes ces routes répondent depuis l'index, jamais depuis le disque. C'est ce qui
 * tient le délai promis — liens entrants, liens cassés et compteurs sont immédiats —
 * et ce qui rend chaque réponse une requête SQL plutôt qu'une passe sur mille
 * fichiers.
 *
 * Lecture ouverte à tout compte connecté, comme les réglages d'instance : le vault est
 * une ressource partagée. Ce qu'un **agent** peut y écrire est une autre question, qui
 * se règle dossier par dossier et pas ici.
 */
export function registerVaultRoutes(
  app: FastifyInstance,
  ctx: AppContext,
  vault: VaultIndex,
): void {
  app.get('/api/vault', async (request): Promise<VaultStateDto> => {
    requireUser(request)
    return vault.state()
  })

  /**
   * Tout réindexer.
   *
   * Ouvert à tout compte connecté, et ce n'est pas un oubli : l'index est dérivé, donc
   * le jeter ne perd rien, et c'est exactement le bouton qu'on veut pouvoir presser
   * quand on doute de ce qu'on lit. Son seul coût est une passe de lecture.
   */
  app.post('/api/vault/reindex', async (request): Promise<VaultReindexDto> => {
    requireUser(request)

    const run = await vault.reindex()
    return { state: await vault.state(), indexed: run.indexed, removed: run.removed }
  })

  app.get('/api/vault/notes', async (request): Promise<VaultNoteDto[]> => {
    requireUser(request)
    const query = vaultNotesQuerySchema.parse(request.query)
    return listNotes(ctx.db, query)
  })

  app.get('/api/vault/folders', async (request): Promise<VaultFolderDto[]> => {
    requireUser(request)
    return listFolders(ctx.db)
  })

  /**
   * Les faits d'une note, les deux bouts de ses liens compris.
   *
   * Le chemin est en reste d'URL et non en paramètre : une note vit dans des dossiers,
   * et l'encoder dans un segment unique obligerait l'interface à échapper les barres
   * obliques de ce qui est, pour elle, l'identité d'une note.
   */
  app.get('/api/vault/notes/*', async (request): Promise<VaultNoteFactsDto> => {
    requireUser(request)
    const path = notePath((request.params as Record<string, string>)['*'] ?? '')

    const facts = readNoteFacts(ctx.db, path)
    // Absente de l'index, pas absente du disque : la nuance compte, parce que la
    // réponse est de réindexer et non de recréer la note.
    if (!facts) throw notFound('vault_note_not_indexed', 'This note is not in the index.')
    return facts
  })
}

/**
 * Le chemin tel que l'index le nomme : relatif, en séparateurs `/`, sans remontée.
 *
 * Le refus de `..` n'est pas une précaution de lecture de fichier — ces routes ne
 * lisent aucun fichier — mais une question d'identité : `Dossier/../Note` et `Note`
 * désignent la même note et ne doivent pas avoir deux adresses.
 */
function notePath(path: string): string {
  // Fastify a déjà décodé le reste d'URL : le redécoder abîmerait un nom de note qui
  // porte un pourcent.

  if (path.length === 0 || path.startsWith('/') || !isVaultNotePath(path)) {
    throw badRequest('vault_note_path_invalid', 'Expected a relative markdown path.')
  }
  if (path.split('/').some((segment) => segment === '.' || segment === '..')) {
    throw badRequest('vault_note_path_invalid', 'Expected a relative markdown path.')
  }
  return path
}
