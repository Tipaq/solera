import { ChevronRight, FilePlus2, FileX2, Pencil } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import type { EditedFile } from '../../lib/chat-fold'
import type { DiffFile } from '../../lib/diff'
import { useTranslate } from '../../lib/i18n'
import { DiffHunks } from '../DiffHunks'
import { cx } from '@solera/ui'

/**
 * Ce que les deux vues de changements ont en commun.
 *
 * L'onglet Git montre ce que dit le dépôt, l'onglet Historique ce que l'agent a écrit
 * dans cette conversation. Deux sources et deux questions, mais les mêmes lignes de
 * fichier et les mêmes couleurs : les partager est le seul moyen qu'elles ne divergent
 * pas d'une vue à l'autre.
 */

/** Icône et teinte par nature de changement. */
export const ACTIONS: Record<EditedFile['action'], { icon: ReactNode; tone: string }> = {
  created: { icon: <FilePlus2 size={14} />, tone: 'text-positive' },
  modified: { icon: <Pencil size={14} />, tone: 'text-caution' },
  deleted: { icon: <FileX2 size={14} />, tone: 'text-critical' },
}

/** Statuts d'un diff ramenés au vocabulaire des trois actions du journal. */
const DIFF_ACTIONS: Record<DiffFile['status'], EditedFile['action']> = {
  added: 'created',
  removed: 'deleted',
  renamed: 'modified',
  modified: 'modified',
  binary: 'modified',
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="surface sticky top-0 z-10 flex items-center gap-2 border-b border-line px-2.5 py-1.5">
      <span className="flex-1 text-meta font-semibold tracking-wide text-ink-faint uppercase">
        {children}
      </span>
      {action}
    </div>
  )
}

/**
 * La ligne d'un fichier changé, dépliable : icône de nature, chemin, lignes ajoutées et
 * retirées. Le corps déplié est fourni par l'appelant, déjà lu ou lu à la demande.
 */
export function FileRow({
  path,
  action,
  added,
  removed,
  detail,
  children,
}: {
  path: string
  action: EditedFile['action']
  added: number
  removed: number
  /** Ajouté au chemin, en retrait : l'ancien nom d'un renommage. */
  detail?: string
  /** Rendu seulement une fois la ligne dépliée. */
  children: () => ReactNode
}) {
  const [open, setOpen] = useState(false)
  const tone = ACTIONS[action]

  return (
    <div className="border-b border-line/60">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        data-path={path}
        className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left hover:bg-surface-high"
      >
        <ChevronRight
          size={14}
          className={cx('shrink-0 text-ink-faint transition-transform', open && 'rotate-90')}
        />
        <span className={cx('shrink-0', tone.tone)}>{tone.icon}</span>
        <span className="min-w-0 flex-1 truncate text-sm text-ink-soft" title={path}>
          {path}
          {detail ? <span className="text-ink-faint"> · {detail}</span> : null}
        </span>
        {added > 0 ? <span className="shrink-0 font-mono text-micro text-positive">+{added}</span> : null}
        {removed > 0 ? (
          <span className="shrink-0 font-mono text-micro text-critical">-{removed}</span>
        ) : null}
      </button>

      {open ? <div className="border-t border-line/60">{children()}</div> : null}
    </div>
  )
}

/** Le corps déplié d'un fichier : ses hunks, et de quoi ouvrir le fichier du disque. */
export function FileDiffBody({
  file,
  onOpenFile,
}: {
  file: DiffFile
  onOpenFile?: (path: string) => void
}) {
  const t = useTranslate()
  return (
    <>
      {file.status === 'binary' ? (
        <p className="px-2.5 py-2 text-xs text-ink-faint">{t('changes.file.binary')}</p>
      ) : (
        <DiffHunks hunks={file.hunks} path={file.path} />
      )}

      {onOpenFile && file.status !== 'removed' ? (
        <button
          type="button"
          onClick={() => onOpenFile(file.path)}
          className="px-2.5 py-1.5 text-meta text-ink-faint underline hover:text-ink"
        >
          {t('changes.file.open')}
        </button>
      ) : null}
    </>
  )
}

/** Un fichier d'un diff, dépliable sur ses hunks. */
export function FileDiff({
  file,
  onOpenFile,
}: {
  file: DiffFile
  /** Absent pour un commit passé : le fichier du disque n'est plus celui d'alors. */
  onOpenFile?: (path: string) => void
}) {
  return (
    <FileRow path={file.path} action={DIFF_ACTIONS[file.status]} added={file.added} removed={file.removed}>
      {() => <FileDiffBody file={file} onOpenFile={onOpenFile} />}
    </FileRow>
  )
}
