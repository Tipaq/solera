import { ChevronRight, FileText, FolderClosed, FolderOpen, Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { cx } from '@solera/ui'
import type { VaultTreeDto } from '@solera/protocol'
import { useTranslate } from '../../lib/i18n'
import { RenameInput } from '../sidebar/RenameInput'

/**
 * L'arbre du vault, vue *Notes* du panneau.
 *
 * Le panneau et non la colonne, et c'est tranché : le lieu *Savoir* est un **état**, pas
 * un arbre. La grammaire existe déjà, puisqu'en Travail le panneau porte l'arbre du
 * dépôt — ce qui change ici, c'est que les feuilles sont des notes, nommées par leur
 * titre et non par leur fichier.
 *
 * Les dossiers viennent de ce que les notes déclarent : un dossier sans note n'existe
 * pas dans l'index, et n'a donc rien à montrer. C'est cohérent avec le reste — l'index
 * lit des notes, pas des dossiers.
 */

interface Folder {
  path: string
  name: string
  depth: number
  notes: { path: string; title: string }[]
  children: Folder[]
}

export function NoteTree({ tree, current, onOpen, onCreate }: {
  tree: VaultTreeDto | undefined
  /** La note ouverte, pour qu'elle se voie dans l'arbre. */
  current: string | null
  onOpen: (path: string) => void
  /** Créer dans un dossier. Dossier vide : une ébauche, que personne d'autre ne voit. */
  onCreate: (folder: string, title: string) => void
}) {
  const t = useTranslate()
  const [open, setOpen] = useState<Record<string, boolean>>({})
  /** Le dossier où un titre se tape. `''` est la racine, donc une ébauche. */
  const [creating, setCreating] = useState<string | null>(null)

  const { roots, drafts } = useMemo(() => build(tree), [tree])

  if (!tree) return null

  const toggle = (path: string) => setOpen((held) => ({ ...held, [path]: !held[path] }))

  const create = (folder: string) => (title: string) => {
    setCreating(null)
    const trimmed = title.trim()
    if (trimmed.length > 0) onCreate(folder, trimmed)
  }

  const renderFolder = (folder: Folder) => {
    // Déplié dès qu'il contient la note ouverte : arriver sur une note par un lien doit
    // la montrer dans l'arbre, sans qu'on ait à retrouver son dossier.
    const expanded = open[folder.path] ?? (current !== null && current.startsWith(`${folder.path}/`))

    return (
      <li key={folder.path}>
        <div className="group/folder flex items-center">
          <button
            type="button"
            onClick={() => toggle(folder.path)}
            aria-expanded={expanded}
            style={{ paddingLeft: `${0.5 + folder.depth * 0.75}rem` }}
            className="flex h-8 min-w-0 flex-1 items-center gap-1.5 rounded-md pr-1 text-left text-sm text-ink-soft transition-colors hover:bg-surface-high hover:text-ink pointer-coarse:h-11"
          >
            <ChevronRight size={13} className={cx('shrink-0 text-ink-faint transition-transform', expanded && 'rotate-90')} />
            {expanded ? (
              <FolderOpen size={14} className="shrink-0 text-ink-faint" />
            ) : (
              <FolderClosed size={14} className="shrink-0 text-ink-faint" />
            )}
            <span className="min-w-0 flex-1 truncate">{folder.name}</span>
            <span className="shrink-0 text-meta tabular-nums text-ink-faint">{folder.notes.length}</span>
          </button>
          {/* Le `+` du dossier : le titre se tape sur place, et la note hérite du droit
              du dossier sans qu'on y pense. */}
          <button
            type="button"
            aria-label={t('vault.tree.newIn', { folder: folder.name })}
            title={t('vault.tree.newIn', { folder: folder.name })}
            onClick={() => {
              setOpen((held) => ({ ...held, [folder.path]: true }))
              setCreating(folder.path)
            }}
            className="mr-1 flex size-7 shrink-0 items-center justify-center rounded-md text-ink-faint opacity-0 transition-opacity hover:bg-surface-high hover:text-ink focus-visible:opacity-100 group-hover/folder:opacity-100 pointer-coarse:opacity-100"
          >
            <Plus size={14} />
          </button>
        </div>

        {expanded ? (
          <ul>
            {creating === folder.path ? (
              <NewNoteLine depth={folder.depth + 1} onCommit={create(folder.path)} onCancel={() => setCreating(null)} />
            ) : null}
            {folder.children.map(renderFolder)}
            {folder.notes.map((note) => (
              <NoteLine
                key={note.path}
                note={note}
                depth={folder.depth + 1}
                active={note.path === current}
                onOpen={onOpen}
              />
            ))}
          </ul>
        ) : null}
      </li>
    )
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-1 py-1.5">
      <ul>{roots.map(renderFolder)}</ul>

      {/* Les ébauches en bas, et sous leur nom : ce sont des notes sans dossier, donc
          sans droit à hériter — aucun agent ne les voit, et c'est le sens du mot. */}
      <h3 className="flex items-center gap-1.5 px-2 pt-3 pb-1 text-meta font-semibold uppercase tracking-wider text-ink-faint">
        <span className="flex-1">{t('vault.tree.drafts')}</span>
        <button
          type="button"
          aria-label={t('vault.tree.newDraft')}
          title={t('vault.tree.newDraft')}
          onClick={() => setCreating('')}
          className="flex size-6 items-center justify-center rounded-md text-ink-faint transition-colors hover:bg-surface-high hover:text-ink"
        >
          <Plus size={13} />
        </button>
      </h3>
      <ul>
        {creating === '' ? (
          <NewNoteLine depth={0} onCommit={create('')} onCancel={() => setCreating(null)} />
        ) : null}
        {drafts.map((note) => (
          <NoteLine key={note.path} note={note} depth={0} active={note.path === current} onOpen={onOpen} />
        ))}
      </ul>

      {tree.notes.length === 0 && creating === null ? (
        <p className="px-2 py-2 text-sm text-ink-faint">{t('vault.tree.empty')}</p>
      ) : null}
    </div>
  )
}

function NoteLine({ note, depth, active, onOpen }: {
  note: { path: string; title: string }
  depth: number
  active: boolean
  onOpen: (path: string) => void
}) {
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(note.path)}
        title={note.path}
        aria-current={active ? 'true' : undefined}
        style={{ paddingLeft: `${1.25 + depth * 0.75}rem` }}
        className={cx(
          'flex h-8 w-full items-center gap-1.5 rounded-md pr-2 text-left text-sm transition-colors pointer-coarse:h-11',
          active ? 'bg-accent-wash font-medium text-ink' : 'text-ink-soft hover:bg-surface-high hover:text-ink',
        )}
      >
        <FileText size={14} className="shrink-0 text-ink-faint" />
        <span className="min-w-0 flex-1 truncate">{note.title}</span>
      </button>
    </li>
  )
}

/** Le titre se tape là où la note va vivre, et non dans un formulaire ailleurs. */
function NewNoteLine({ depth, onCommit, onCancel }: {
  depth: number
  onCommit: (title: string) => void
  onCancel: () => void
}) {
  const t = useTranslate()
  return (
    <li style={{ paddingLeft: `${1.25 + depth * 0.75}rem` }} className="pr-2">
      <RenameInput
        value=""
        placeholder={t('vault.tree.titlePlaceholder')}
        onCommit={onCommit}
        onCancel={onCancel}
        className="h-8 w-full rounded-md border border-accent bg-sunken px-2 text-sm text-ink outline-none placeholder:text-ink-faint"
      />
    </li>
  )
}

/** L'arbre se refait côté interface : le serveur rend les dossiers et les notes à plat. */
function build(tree: VaultTreeDto | undefined): { roots: Folder[]; drafts: { path: string; title: string }[] } {
  if (!tree) return { roots: [], drafts: [] }

  const byPath = new Map<string, Folder>()
  for (const folder of tree.folders) {
    const segments = folder.path.split('/')
    byPath.set(folder.path, {
      path: folder.path,
      name: segments[segments.length - 1] ?? folder.path,
      depth: segments.length - 1,
      notes: [],
      children: [],
    })
  }

  // Un dossier déclaré `a/b` sans que `a` porte de note n'aurait pas de parent : il est
  // créé au passage, sinon sa branche n'apparaîtrait pas du tout.
  for (const path of [...byPath.keys()]) {
    const segments = path.split('/')
    for (let depth = 1; depth < segments.length; depth += 1) {
      const parent = segments.slice(0, depth).join('/')
      if (byPath.has(parent)) continue
      byPath.set(parent, {
        path: parent,
        name: segments[depth - 1] ?? parent,
        depth: depth - 1,
        notes: [],
        children: [],
      })
    }
  }

  const roots: Folder[] = []
  for (const folder of [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path))) {
    const cut = folder.path.lastIndexOf('/')
    const parent = cut > 0 ? byPath.get(folder.path.slice(0, cut)) : undefined
    if (parent) parent.children.push(folder)
    else roots.push(folder)
  }

  const drafts: { path: string; title: string }[] = []
  for (const note of tree.notes) {
    const folder = note.folder.length > 0 ? byPath.get(note.folder) : undefined
    if (folder) folder.notes.push({ path: note.path, title: note.title })
    else if (note.folder.length === 0) drafts.push({ path: note.path, title: note.title })
  }

  return { roots, drafts }
}
