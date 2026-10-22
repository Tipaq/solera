import type { FastifyInstance } from 'fastify'
import {
  MAX_UPLOAD_BYTES,
  archiveQuerySchema,
  copyEntryBodySchema,
  createEntryBodySchema,
  deleteEntryBodySchema,
  moveEntryBodySchema,
  contentReplaceBodySchema,
  contentSearchQuerySchema,
  treeQuerySchema,
  treeSearchQuerySchema,
  uploadQuerySchema,
  type ContentReplaceDto,
  type ContentSearchDto,
  type FileState,
  type TreeListingDto,
  type TreeSearchDto,
} from '@solera/protocol'
import { readFileStates } from '../../git.js'
import { replaceContent, searchContent, type SearchCriteria } from '../../search/search-files.js'
import {
  copyEntry,
  createEntry,
  deleteEntry,
  listDirectory,
  moveEntry,
  searchEntries,
  writeUpload,
} from '../../workspace.js'
import { collectArchive, streamArchive } from '../../workspace-archive.js'
import { attachmentHeader } from '../attachment-header.js'
import type { AppContext } from '../context.js'
import { badRequest } from '../errors.js'
import { requireUser } from '../require-user.js'
import { workspaceScopes } from './workspace-scopes.js'

/**
 * Priorité d'agrégation sur un dossier : c'est le changement le plus notable de son
 * contenu qui le colore.
 *
 * `ignored` n'y figure pas, et c'est le point : un dossier ignoré à l'intérieur d'un
 * dossier versionné ne dit rien du parent. Le propager remontait `ignored` jusqu'à la
 * racine dès qu'un `node_modules` existait quelque part, et un dossier réellement
 * modifié s'affichait alors en gris au lieu de sa couleur.
 */
const SEVERITY: Record<Exclude<FileState, 'ignored'>, number> = {
  deleted: 1,
  untracked: 2,
  added: 3,
  modified: 4,
}

/**
 * Arborescence du répertoire de travail d'une conversation, un niveau par requête.
 *
 * Les couleurs viennent d'un seul `git status` pour tout le dépôt : un appel par
 * fichier serait ruineux dans un dossier de plusieurs centaines d'entrées. Un dossier
 * porte l'état le plus notable de ce qu'il contient, faute de quoi il faudrait tout
 * déplier pour trouver ce qui a changé.
 */
export function registerTreeRoutes(app: FastifyInstance, ctx: AppContext): void {
  // Deux portées, conversation et projet : voir `workspace-scopes.ts`.
  for (const { base, cwdOf } of workspaceScopes) {
    app.get(`${base}/tree`, async (request): Promise<TreeListingDto> => {
      const user = requireUser(request)
      const { id } = request.params as { id: string }
      const { path } = treeQuerySchema.parse(request.query)

      const cwd = cwdOf(ctx.db, id, user.id)
      const [entries, states] = await Promise.all([listDirectory(cwd, path), readFileStates(cwd)])

      if (!states) return { path, entries, versioned: false, root: cwd }

      const directoryStates = new Map<string, Exclude<FileState, 'ignored'>>()
      for (const [file, state] of states) {
        if (state === 'ignored') continue

        // Chaque ancêtre du fichier hérite de son état : `apps/web/src/x.ts` colore
        // `apps`, `apps/web` et `apps/web/src`, quel que soit le niveau déplié.
        const parts = file.split('/')
        for (let depth = 1; depth < parts.length; depth += 1) {
          const ancestor = parts.slice(0, depth).join('/')
          const current = directoryStates.get(ancestor)
          if (current === undefined || SEVERITY[state] > SEVERITY[current]) {
            directoryStates.set(ancestor, state)
          }
        }
      }

      return {
        path,
        entries: entries.map((entry) => {
          const state = entry.isDirectory
            ? (states.get(entry.path) ?? directoryStates.get(entry.path))
            : states.get(entry.path)
          return state ? { ...entry, state } : entry
        }),
        versioned: true,
        root: cwd,
      }
    })

    /**
     * Recherche d'un fichier par son nom, dans tout le répertoire de travail.
     *
     * Séparée de l'arborescence, qui est paginée par niveau : chercher demande de
     * traverser, et traverser à la demande depuis le client ferait une requête par
     * dossier. Aucun état git n'est joint, la liste ne sert qu'à rejoindre un fichier.
     */
    app.get(`${base}/tree/search`, async (request): Promise<TreeSearchDto> => {
      const user = requireUser(request)
      const { id } = request.params as { id: string }
      const { q } = treeSearchQuerySchema.parse(request.query)

      const cwd = cwdOf(ctx.db, id, user.id)
      return searchEntries(cwd, q)
    })

    /**
     * Recherche dans le **contenu** des fichiers.
     *
     * Distincte de la recherche par nom : elle lit chaque fichier au lieu de traverser
     * des noms, et ses plafonds n'ont rien à voir. La vue les présente côte à côte,
     * mais ce sont deux marches, dont l'une peut être tronquée sans l'autre.
     */
    app.get(`${base}/search/content`, async (request): Promise<ContentSearchDto> => {
      const user = requireUser(request)
      const { id } = request.params as { id: string }
      const query = contentSearchQuerySchema.parse(request.query)

      const cwd = cwdOf(ctx.db, id, user.id)
      return searchContent(cwd, criteriaOf(query))
    })

    /**
     * Remplacement en masse, sur le même critère que la recherche.
     *
     * `POST` et non `PUT` : ce n'est pas l'écriture d'une ressource nommée, c'est une
     * commande dont l'effet dépend de l'état du disque au moment où elle passe. Rien
     * n'est journalisé, comme pour les autres manipulations d'entrées : un fichier est
     * l'état vivant du disque, pas un événement (l'invariant I2 ne porte que sur la
     * conversation).
     */
    app.post(`${base}/search/replace`, async (request): Promise<ContentReplaceDto> => {
      const user = requireUser(request)
      const { id } = request.params as { id: string }
      const body = contentReplaceBodySchema.parse(request.body)

      const cwd = cwdOf(ctx.db, id, user.id)
      return replaceContent(cwd, criteriaOf(body), body.replacement)
    })

    /**
     * Manipulations d'entrées.
     *
     * Rien n'est journalisé : un fichier est l'état vivant du disque, pas un événement
     * (l'invariant I2 ne porte que sur la conversation). Ces trois routes ne font que ce
     * que leur nom dit, et le bornage au workspace vit dans `workspace.ts`, avec la
     * résolution de chemin qu'il protège.
     */
    app.post(`${base}/entries`, async (request, reply) => {
      const user = requireUser(request)
      const { id } = request.params as { id: string }
      const body = createEntryBodySchema.parse(request.body)

      const cwd = cwdOf(ctx.db, id, user.id)
      const path = await createEntry(cwd, body.parent, body.name, body.kind)
      return reply.status(201).send({ path })
    })

    /**
     * Fichier déposé dans l'explorateur.
     *
     * Un fichier par requête, et le chemin de destination en paramètre d'URL plutôt
     * qu'en champ du formulaire : les champs d'un envoi multipart n'arrivent qu'à leur
     * tour dans le flux, donc lire la destination avant le contenu obligerait à espérer
     * un ordre que le navigateur ne garantit pas. Le découpage par fichier est aussi ce
     * qui donne une progression fiable côté interface, et ce qui permet qu'un fichier
     * refusé n'emporte pas les autres.
     */
    app.post(`${base}/entries/upload`, async (request, reply) => {
      const user = requireUser(request)
      const { id } = request.params as { id: string }
      const { path } = uploadQuerySchema.parse(request.query)

      const cwd = cwdOf(ctx.db, id, user.id)

      // La limite du greffon vaut pour les pièces jointes ; un fichier posé sur le
      // disque du workspace a droit à la sienne, plus haute.
      const part = await request.file({ limits: { fileSize: MAX_UPLOAD_BYTES } })
      if (!part) throw badRequest('no_file', 'No file received.')

      // `truncated` n'est lisible qu'une fois le flux consommé : l'écriture le consulte
      // après coup pour distinguer un dépassement de taille d'une panne disque.
      await writeUpload(cwd, path, part.file, () => part.file.truncated)
      return reply.status(201).send({ path })
    })

    app.post(`${base}/entries/move`, async (request, reply) => {
      const user = requireUser(request)
      const { id } = request.params as { id: string }
      const body = moveEntryBodySchema.parse(request.body)

      const cwd = cwdOf(ctx.db, id, user.id)
      await moveEntry(cwd, body.from, body.to)
      return reply.status(204).send()
    })

    /** Copier et dupliquer : le serveur choisit le nom, voir `copyEntry`. */
    app.post(`${base}/entries/copy`, async (request, reply) => {
      const user = requireUser(request)
      const { id } = request.params as { id: string }
      const body = copyEntryBodySchema.parse(request.body)

      const cwd = cwdOf(ctx.db, id, user.id)
      const path = await copyEntry(cwd, body.from, body.toParent)
      return reply.status(201).send({ path })
    })

    /**
     * Une sélection de l'explorateur en `.zip`, écrit en flux.
     *
     * L'inventaire précède la réponse : un dépassement de plafond ou un chemin refusé
     * répond une erreur, plutôt qu'un téléchargement coupé au milieu.
     */
    app.get(`${base}/entries/archive`, async (request, reply) => {
      const user = requireUser(request)
      const { id } = request.params as { id: string }
      const { path } = archiveQuerySchema.parse(request.query)

      const cwd = cwdOf(ctx.db, id, user.id)
      const archive = await collectArchive(cwd, path)
      return reply
        .header('content-type', 'application/zip')
        .header('content-disposition', attachmentHeader(archive.filename))
        .header('x-content-type-options', 'nosniff')
        .header('cache-control', 'no-store')
        .send(streamArchive(archive.items))
    })

    app.delete(`${base}/entries`, async (request, reply) => {
      const user = requireUser(request)
      const { id } = request.params as { id: string }
      const body = deleteEntryBodySchema.parse(request.body)

      const cwd = cwdOf(ctx.db, id, user.id)
      await deleteEntry(cwd, body.path)
      return reply.status(204).send()
    })
  }
}

/** Le schéma transporte des `'0'` / `'1'`, parce qu'une requête GET n'a que des chaînes. */
function criteriaOf(query: {
  q: string
  caseSensitive: '0' | '1'
  wholeWord: '0' | '1'
  regex: '0' | '1'
  include: string
  exclude: string
}): SearchCriteria {
  return {
    query: query.q,
    caseSensitive: query.caseSensitive === '1',
    wholeWord: query.wholeWord === '1',
    regex: query.regex === '1',
    include: query.include,
    exclude: query.exclude,
  }
}
