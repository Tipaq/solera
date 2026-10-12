import { stat } from 'node:fs/promises'
import type { Db } from '@solera/db'
import type { VaultStateDto } from '@solera/protocol'
import type { Config } from '../config.js'
import { readAppSettings } from '../settings/app-settings.js'
import { changesSince, headCommit } from './git.js'
import { listNotePaths, readNote, readNotes } from './scan.js'
import { applyBatch, clearIndex, readCounts, readIndexState } from './store.js'

/**
 * L'indexation du vault, niveau 1 : quand elle tourne, et ce qu'elle décide.
 *
 * Deux chemins, et un seul critère pour choisir entre eux :
 *
 * - **la passe complète**, quand l'index ne peut pas dire de quoi il part — aucun
 *   état, un chemin de vault qui a changé, un vault hors dépôt git, ou un commit que
 *   git ne reconnaît plus après une réécriture d'historique ;
 * - **le rattrapage**, sinon : `git diff` entre le commit que l'index reflète et
 *   `HEAD`, plus le statut de l'arbre de travail. Borné et exact, même si Solera est
 *   resté éteint trois semaines pendant qu'on écrivait depuis le téléphone.
 *
 * Les deux passent par `applyBatch`, donc par la même transaction : il n'y a pas un
 * code d'écriture rapide et un code d'écriture complet qui pourraient diverger.
 *
 * Rien ici ne s'exécute en parallèle de soi-même. Deux passes concurrentes se
 * marcheraient sur la résolution des liens, qui est une fonction de l'ensemble des
 * notes : la seconde recalculerait sur un ensemble à moitié écrit par la première.
 */
export class VaultIndex {
  /** La passe en cours, pour y enchaîner la suivante plutôt que de la lancer à côté. */
  private pending: Promise<unknown> = Promise.resolve()

  constructor(
    private readonly db: Db,
    private readonly config: Config,
  ) {}

  /**
   * La racine du vault, ou `null` tant qu'elle n'est pas réglée.
   *
   * Relue à chaque appel : le chemin se change depuis les réglages, et un cache
   * obligerait l'écriture à prévenir l'index. Un vault non réglé n'est pas une erreur
   * — c'est l'état d'une instance qui ne prend pas de notes.
   */
  root(): string | null {
    const path = readAppSettings(this.db, this.config).vaultPath.trim()
    return path.length > 0 ? path : null
  }

  async state(): Promise<VaultStateDto> {
    const root = this.root()
    const stored = readIndexState(this.db)

    if (root === null) {
      return {
        configured: false,
        path: '',
        exists: false,
        indexedCommit: null,
        headCommit: null,
        indexedAt: null,
        counts: readCounts(this.db),
      }
    }

    return {
      configured: true,
      path: root,
      exists: await isDirectory(root),
      // Le SHA n'est rendu que s'il décrit *ce* vault : l'état d'un chemin précédent
      // dirait que l'index reflète un commit alors qu'il parle d'un autre dossier.
      indexedCommit: stored?.path === root ? stored.commitSha : null,
      headCommit: await headCommit(root),
      indexedAt: stored?.path === root ? stored.indexedAt : null,
      counts: readCounts(this.db),
    }
  }

  /** Rattrape ce qui a bougé, ou refait tout quand le rattrapage ne peut pas être exact. */
  sync(): Promise<VaultIndexRun> {
    return this.serialize(() => this.run(false))
  }

  /**
   * Tout réindexer.
   *
   * N'est pas une opération dangereuse, et c'est la propriété qui autorise le reste :
   * l'index ne contient rien qui ne soit dans les fichiers, donc le jeter ne perd rien.
   */
  reindex(): Promise<VaultIndexRun> {
    return this.serialize(() => this.run(true))
  }

  private serialize<T>(body: () => Promise<T>): Promise<T> {
    const next = this.pending.then(body, body)
    // La chaîne ne doit pas se rompre sur un échec, sinon la passe suivante partirait
    // en parallèle de celle qui finit.
    this.pending = next.catch(() => undefined)
    return next
  }

  private async run(force: boolean): Promise<VaultIndexRun> {
    const root = this.root()
    if (root === null) return { skipped: 'unconfigured', indexed: 0, removed: 0, full: false }
    if (!(await isDirectory(root))) {
      return { skipped: 'missing', indexed: 0, removed: 0, full: false }
    }

    const head = await headCommit(root)
    const stored = readIndexState(this.db)
    const since = stored?.path === root ? stored.commitSha : null

    if (!force && since !== null && head !== null) {
      const changes = await changesSince(root, since)
      if (changes !== null) {
        const records = await readNotes(root, changes.changed)
        const read = new Set(records.map((record) => record.path))
        // Un chemin que git donne pour modifié mais que le disque ne rend pas est une
        // suppression de plus : entre git et le fichier, c'est le fichier qui fait foi.
        const removals = [
          ...new Set([...changes.removed, ...changes.changed.filter((path) => !read.has(path))]),
        ]

        const applied = applyBatch(this.db, {
          root,
          upserts: records,
          removals,
          commitSha: head,
          full: false,
        })
        return { ...applied, full: false }
      }
    }

    const records = await readNotes(root, await listNotePaths(root))
    const applied = applyBatch(this.db, {
      root,
      upserts: records,
      removals: [],
      commitSha: head,
      full: true,
    })
    return { ...applied, full: true }
  }

  /**
   * Relit **une** note, après une écriture passée par Solera.
   *
   * Le SHA reflété n'est pas touché : l'index reflète toujours ce commit, plus une
   * modification locale que le `git status` du prochain démarrage rattrapera de toute
   * façon. Le réécrire ici prétendrait refléter un commit qui ne contient pas cette
   * écriture.
   *
   * Sérialisé comme les passes complètes, et pour la même raison : la résolution des
   * liens est une fonction de l'ensemble des notes.
   */
  indexNote(path: string): Promise<void> {
    return this.serialize(async () => {
      const root = this.root()
      if (root === null) return

      const stored = readIndexState(this.db)
      const since = stored?.path === root ? stored.commitSha : null
      const record = await readNote(root, path)

      applyBatch(this.db, {
        root,
        upserts: record ? [record] : [],
        // Le fichier a disparu entre l'écriture et la relecture : c'est le disque qui
        // fait foi, donc la note sort de l'index.
        removals: record ? [] : [path],
        commitSha: since,
        full: false,
      })
    })
  }

  /** Jette l'index sans le refaire, quand le vault n'est plus réglé. */
  clear(): void {
    clearIndex(this.db)
  }
}

export interface VaultIndexRun {
  indexed: number
  removed: number
  /** Vrai quand la passe a tout refait plutôt que rattrapé. */
  full: boolean
  /** Renseigné quand il n'y avait rien à indexer, et pourquoi. */
  skipped?: 'unconfigured' | 'missing'
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}
