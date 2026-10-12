import type { FastifyInstance } from 'fastify'
import {
  vaultCreateNoteBodySchema,
  vaultNotePathQuerySchema,
  vaultNotesQuerySchema,
  vaultWriteNoteBodySchema,
  type VaultFolderDto,
  type VaultNoteContentDto,
  type VaultNoteDto,
  type VaultNoteFactsDto,
  type VaultNoteHistoryDto,
  type VaultReindexDto,
  type VaultStateDto,
  type VaultTreeDto,
  type VaultWriteNoteDto,
} from '@solera/protocol'
import { isUncommitted, noteHistory } from '../../vault/git.js'
import type { VaultIndex } from '../../vault/index-service.js'
import {
  StaleNoteError,
  VaultPathError,
  freeNotePath,
  notePathFor,
  readNoteText,
  writeNoteText,
} from '../../vault/notes-io.js'
import { listFolders, listNotes, readNoteFacts, readTree } from '../../vault/store.js'
import type { AppContext } from '../context.js'
import { badRequest, conflict, notFound } from '../errors.js'
import { requireUser } from '../require-user.js'

/**
 * Le vault : son index en lecture, et ses notes en lecture et en écriture.
 *
 * Les **faits** viennent de l'index, jamais du disque : c'est ce qui tient le délai
 * promis — liens entrants, liens cassés et compteurs sont immédiats. Le **texte** d'une
 * note, lui, vient toujours du disque : les fichiers sont la vérité, et une note lue
 * depuis un index aurait une chance de mentir.
 *
 * Après chaque écriture, la note est relue par l'index avant que la route ne réponde :
 * l'écran qui enregistre doit voir les faits de ce qu'il vient d'écrire, pas ceux
 * d'avant.
 *
 * Ouvert à tout compte connecté : le vault est une ressource partagée de l'instance.
 * Ce qu'un **agent** peut y écrire est une autre question, qui se règle dossier par
 * dossier et pas ici.
 */
export function registerVaultRoutes(
  app: FastifyInstance,
  ctx: AppContext,
  vault: VaultIndex,
): void {
  /** La racine, ou l'erreur qui dit qu'il n'y a pas de vault — et non une liste vide. */
  const requireRoot = (): string => {
    const root = vault.root()
    if (root === null) {
      throw badRequest('vault_unconfigured', 'No vault folder is configured.')
    }
    return root
  }

  /** Les erreurs de chemin sont des 400 : c'est la requête qui est fautive, pas le vault. */
  const guard = async <T>(body: () => Promise<T>): Promise<T> => {
    try {
      return await body()
    } catch (err) {
      if (err instanceof VaultPathError) {
        throw badRequest('vault_note_path_invalid', err.message)
      }
      if (err instanceof StaleNoteError) {
        throw conflict('vault_note_stale', err.message)
      }
      throw err
    }
  }

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

  /** L'arbre du vault, pour la vue *Notes* du panneau. */
  app.get('/api/vault/tree', async (request): Promise<VaultTreeDto> => {
    requireUser(request)
    return readTree(ctx.db)
  })

  /**
   * Les faits d'une note, les deux bouts de ses liens compris.
   *
   * Le chemin est en paramètre de requête et non dans l'adresse : une note vit dans des
   * dossiers, et le routeur réduirait `Dossier/../Note` à `Note` avant qu'on le voie —
   * deux adresses pour la même note, dont une qui ne ressemble pas à son identité.
   */
  app.get('/api/vault/note', async (request): Promise<VaultNoteFactsDto> => {
    requireUser(request)
    const { path } = vaultNotePathQuerySchema.parse(request.query)

    const facts = readNoteFacts(ctx.db, path)
    // Absente de l'index, pas absente du disque : la nuance compte, parce que la
    // réponse est de réindexer et non de recréer la note.
    if (!facts) throw notFound('vault_note_not_indexed', 'This note is not in the index.')
    return facts
  })

  /** Le texte d'une note, lu sur le disque. */
  app.get('/api/vault/note/content', async (request): Promise<VaultNoteContentDto> => {
    requireUser(request)
    const { path } = vaultNotePathQuerySchema.parse(request.query)
    const root = requireRoot()

    const text = await guard(() => readNoteText(root, path))
    if (!text) throw notFound('vault_note_missing', 'This note is not on disk.')

    return {
      path,
      // Le titre vient de l'index quand il y est, du nom du fichier sinon : une note
      // tout juste créée hors de Solera n'a pas à attendre une passe pour s'afficher.
      title: readNoteFacts(ctx.db, path)?.note.title ?? path.split('/').pop() ?? path,
      content: text.content,
      fingerprint: text.fingerprint,
    }
  })

  /**
   * Enregistrer une note.
   *
   * L'index relit la note avant la réponse, et la réponse porte ses faits : l'écran qui
   * vient d'écrire un `[[lien]]` doit voir le lien, pas l'état d'avant.
   */
  app.put('/api/vault/note/content', async (request): Promise<VaultWriteNoteDto> => {
    requireUser(request)
    const body = vaultWriteNoteBodySchema.parse(request.body)
    const root = requireRoot()

    const fingerprint = await guard(() =>
      writeNoteText(root, body.path, body.content, body.fingerprint),
    )
    await vault.indexNote(body.path)

    const facts = readNoteFacts(ctx.db, body.path)
    if (!facts) throw notFound('vault_note_not_indexed', 'This note is not in the index.')
    return { fingerprint, note: facts.note }
  })

  /**
   * Créer une note : un dossier et un titre.
   *
   * Dossier vide, c'est une **ébauche** — pas de dossier, donc pas de droit à hériter,
   * donc aucun agent ne la voit. Le même appel sert les deux chemins de création parce
   * que ce sont les deux moments d'un même geste, pas deux gestes.
   */
  app.post('/api/vault/notes', async (request, reply): Promise<VaultNoteDto> => {
    requireUser(request)
    const body = vaultCreateNoteBodySchema.parse(request.body)
    const root = requireRoot()

    const note = await guard(async () => {
      const path = await freeNotePath(root, notePathFor(body.folder, body.title))
      // Un titre de niveau 1 et rien d'autre : la note s'ouvre sur son titre, et c'est
      // ce que tout éditeur de vault écrit à la création.
      await writeNoteText(root, path, `# ${body.title.trim()}\n\n`, null)
      await vault.indexNote(path)
      return readNoteFacts(ctx.db, path)?.note ?? null
    })

    if (!note) throw notFound('vault_note_not_indexed', 'This note is not in the index.')
    return reply.status(201).send(note)
  })

  /**
   * L'historique d'une note, tel que git le raconte.
   *
   * `versioned` à faux dit qu'il n'y a pas d'historique du tout, ce qui ne se confond
   * pas avec une note qu'aucun commit ne connaît encore. Les deux donnent une liste
   * vide, et ce ne sont pas les mêmes situations.
   */
  app.get('/api/vault/note/history', async (request): Promise<VaultNoteHistoryDto> => {
    requireUser(request)
    const { path } = vaultNotePathQuerySchema.parse(request.query)
    const root = requireRoot()
    const state = await vault.state()

    if (state.headCommit === null) return { versioned: false, uncommitted: false, revisions: [] }

    const [revisions, uncommitted] = await Promise.all([
      noteHistory(root, path),
      isUncommitted(root, path),
    ])
    return { versioned: true, uncommitted, revisions }
  })
}
