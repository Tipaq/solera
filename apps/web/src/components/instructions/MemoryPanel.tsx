import { Check, ChevronRight, FilePlus2, Pencil, Trash2, Wrench } from 'lucide-react'
import { useState } from 'react'
import { MAX_MEMORY_FILE_CHARS, MEMORY_INDEX_FILE, type ProjectMemoryDto } from '@solera/protocol'
import { Badge, Banner, Button, cx } from '@solera/ui'
import { ApiRequestError } from '../../lib/api'
import { relativeDate } from '../../lib/dates'
import { useTranslate, type MessageKey } from '../../lib/i18n'
import { useDeleteMemoryFile, useProjectMemory, useWriteMemoryFile } from '../../lib/memory'
import {
  NOTE_TYPES,
  filterNotes,
  isNoteFileName,
  memoryState,
  parseNote,
  repairIndex,
  resolveLink,
  typeCounts,
  withIndexLine,
  type MemoryNote,
  type MemoryState,
  type NoteFilter,
  type NoteType,
} from '../../lib/memory-index'
import { Markdown } from '../chat/Markdown'
import { ToolbarSearch } from '../toolbar/OneLineToolbar'

const FILTERS: NoteFilter[] = ['all', ...NOTE_TYPES, 'none']

const TYPE_TONE: Record<NoteType, 'accent' | 'caution' | 'positive' | 'neutral'> = {
  user: 'accent',
  feedback: 'caution',
  project: 'positive',
  reference: 'neutral',
  none: 'neutral',
}

const plural = (count: number, key: string) => `${key}.${count > 1 ? 'other' : 'one'}` as MessageKey

/** Ce que le panneau écrit : une note, l'index, ou une suppression qui garde ou non sa ligne. */
export interface MemoryWrites {
  write: (file: string, content: string) => Promise<unknown>
  remove: (file: string, keepIndexLine: boolean) => Promise<unknown>
  busy: boolean
  error: unknown
}

/**
 * Réglages › Agents › Mémoire : ce que les agents ont appris d'une session à l'autre,
 * à relire, corriger ou supprimer, avec l'état de l'index qui l'annonce aux agents.
 *
 * Hors du brouillon de la page : chaque geste écrit tout de suite, par les routes de la
 * mémoire (l'index est un fichier comme un autre).
 */
export function MemoryPanel({ projectId }: { projectId: string }) {
  const t = useTranslate()
  const { data } = useProjectMemory(projectId)
  const write = useWriteMemoryFile(projectId)
  const remove = useDeleteMemoryFile(projectId)
  if (!data) return <p className="text-sm text-ink-faint">{t('memory.loading')}</p>
  return (
    <MemoryNotes
      data={data}
      writes={{
        write: (file, content) => write.mutateAsync({ file, content }),
        remove: (file, keepIndexLine) => remove.mutateAsync({ file, keepIndexLine }),
        busy: write.isPending || remove.isPending,
        error: write.error ?? remove.error,
      }}
    />
  )
}

/** Le panneau, sans ses requêtes : ce que la story et le panneau réel partagent. */
export function MemoryNotes({ data, writes }: { data: ProjectMemoryDto; writes: MemoryWrites }) {
  const t = useTranslate()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<NoteFilter>('all')
  const [open, setOpen] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const state = memoryState(data.files)
  const { notes, indexed } = state
  const counts = typeCounts(notes)
  const shown = filterNotes(notes, filter, query)
  const canEdit = data.canEdit

  const toggle = (file: string) => {
    setOpen((current) => (current === file ? null : file))
    setEditing(null)
  }
  const reveal = (note: MemoryNote) => {
    // La note liée peut être cachée par le filtre : on la remontre avant de l'ouvrir.
    setFilter('all')
    setQuery('')
    setOpen(note.file)
    setEditing(null)
    requestAnimationFrame(() =>
      document.getElementById(noteAnchor(note.file))?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }),
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs leading-relaxed text-ink-faint">{t('memory.intro')}</p>

      <div className="flex flex-wrap items-center gap-2">
        <ToolbarSearch value={query} onChange={setQuery} placeholder={t('memory.search')} />
        <div role="group" aria-label={t('memory.type.label')} className="flex flex-wrap gap-1">
          {FILTERS.map((key) =>
            key !== 'all' && counts[key] === 0 ? null : (
              <button
                key={key}
                type="button"
                aria-pressed={filter === key}
                onClick={() => setFilter(key)}
                className={cx(
                  'h-11 rounded-md px-2.5 text-xs transition-colors focus-visible:outline-2 focus-visible:outline-accent md:h-8',
                  filter === key ? 'bg-surface-high text-ink' : 'text-ink-faint hover:text-ink',
                )}
              >
                {t(`memory.type.${key}`)} <span className="tabular-nums opacity-70">{counts[key]}</span>
              </button>
            ),
          )}
        </div>
        <span className="ml-auto" />
        {canEdit ? (
          <Button size="sm" variant="secondary" icon={<FilePlus2 size={14} />} disabled={creating} onClick={() => { setCreating(true); setOpen(null) }}>
            {t('memory.new')}
          </Button>
        ) : null}
      </div>

      <IndexLine state={state} canEdit={canEdit} busy={writes.busy} onRepair={() => void writes.write(MEMORY_INDEX_FILE, repairIndex(state)).catch(() => undefined)} />

      {writes.error instanceof ApiRequestError ? <Banner>{writes.error.message}</Banner> : null}

      {creating ? (
        <NoteEditor
          creating
          initial={t('memory.template', { name: 'nouvelle-note' })}
          fileName="nouvelle-note.md"
          taken={(name) => data.files.some((file) => file.file === name)}
          busy={writes.busy}
          onCancel={() => setCreating(false)}
          onSave={async (content, file, addToIndex) => {
            await writes.write(file, content)
            if (addToIndex) await writes.write(MEMORY_INDEX_FILE, withIndexLine(state.index, parseNote(file, content, 0)))
            setCreating(false)
            setOpen(file)
          }}
        />
      ) : null}

      {shown.length === 0 ? (
        <p className="text-sm text-ink-faint">{t(notes.length === 0 ? 'memory.empty' : 'memory.noMatch')}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line border-y border-line">
          {shown.map((note) => (
            <NoteLine
              key={note.file}
              note={note}
              notes={notes}
              indexed={indexed.has(note.file)}
              open={open === note.file}
              editing={editing === note.file}
              canEdit={canEdit}
              busy={writes.busy}
              onToggle={() => toggle(note.file)}
              onReveal={reveal}
              onEdit={(value) => setEditing(value ? note.file : null)}
              onSave={async (content) => {
                await writes.write(note.file, content)
                setEditing(null)
              }}
              onDelete={async (alsoIndex) => {
                await writes.remove(note.file, !alsoIndex)
                setOpen(null)
              }}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

const noteAnchor = (file: string) => `note-${file}`

/** `MEMORY.md` · indexées · absentes · orphelines · Réparer l'index ou « à jour ». */
function IndexLine({ state, canEdit, busy, onRepair }: { state: MemoryState; canEdit: boolean; busy: boolean; onRepair: () => void }) {
  const t = useTranslate()
  const { indexed, unindexed, orphans } = state
  const broken = unindexed.length > 0 || orphans.length > 0
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs" aria-label={MEMORY_INDEX_FILE} role="group">
      <span className="font-mono text-ink-soft">{MEMORY_INDEX_FILE}</span>
      <span className="text-ink-faint">{t(plural(indexed.size, 'memory.index.indexed'), { count: indexed.size })}</span>
      {unindexed.length > 0 ? (
        <span className="text-caution">{t(plural(unindexed.length, 'memory.index.unindexed'), { count: unindexed.length })}</span>
      ) : null}
      {orphans.length > 0 ? (
        <span className="text-caution">{t(plural(orphans.length, 'memory.index.orphans'), { count: orphans.length })}</span>
      ) : null}
      {broken ? (
        canEdit ? (
          <Button size="sm" variant="ghost" icon={<Wrench size={12} />} disabled={busy} onClick={onRepair} className="text-accent">
            {t('memory.index.repair')}
          </Button>
        ) : null
      ) : (
        <span className="inline-flex items-center gap-1 text-positive">
          <Check size={12} aria-hidden /> {t('memory.index.upToDate')}
        </span>
      )}
    </div>
  )
}

function NoteLine({
  note,
  notes,
  indexed,
  open,
  editing,
  canEdit,
  busy,
  onToggle,
  onReveal,
  onEdit,
  onSave,
  onDelete,
}: {
  note: MemoryNote
  notes: MemoryNote[]
  indexed: boolean
  open: boolean
  editing: boolean
  canEdit: boolean
  busy: boolean
  onToggle: () => void
  onReveal: (note: MemoryNote) => void
  onEdit: (editing: boolean) => void
  onSave: (content: string) => Promise<void>
  onDelete: (alsoIndex: boolean) => Promise<void>
}) {
  const t = useTranslate()
  return (
    <li id={noteAnchor(note.file)} className="scroll-mt-24">
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="flex min-h-11 w-full min-w-0 items-center gap-3 py-2 text-left focus-visible:outline-2 focus-visible:outline-accent"
      >
        <ChevronRight size={13} aria-hidden className={cx('shrink-0 text-ink-faint transition-transform', open && 'rotate-90')} />
        <span className="min-w-0 shrink truncate font-mono text-sm text-ink">{note.slug}</span>
        <span className="shrink-0">
          <Badge tone={TYPE_TONE[note.type]}>{t(`memory.type.${note.type}`)}</Badge>
        </span>
        <span className="hidden min-w-0 flex-1 truncate text-xs text-ink-faint sm:inline">{note.description}</span>
        <span className="flex-1 sm:hidden" />
        {!indexed ? <span className="shrink-0 text-xs text-caution">{t('memory.outOfIndex')}</span> : null}
        <span className="shrink-0 text-xs text-ink-faint tabular-nums">{relativeDate(note.updatedAt)}</span>
      </button>
      {open ? (
        <div className="flex flex-col gap-3 pb-4 pl-6">
          {editing ? (
            <NoteEditor initial={note.content} fileName={note.file} busy={busy} onCancel={() => onEdit(false)} onSave={(content) => onSave(content)} />
          ) : (
            <>
              {note.description ? <p className="text-xs text-ink-faint sm:hidden">{note.description}</p> : null}
              <div className="text-sm">
                <Markdown text={note.body.replace(/\[\[([^\]]+)\]\]/g, '`$1`')} />
              </div>
              {note.links.length > 0 ? <NoteLinks links={note.links} notes={notes} onReveal={onReveal} /> : null}
              {canEdit ? <NoteActions note={note} indexed={indexed} busy={busy} onEdit={() => onEdit(true)} onDelete={onDelete} /> : null}
            </>
          )}
        </div>
      ) : null}
    </li>
  )
}

/** « Liée à » : une note qui existe s'ouvre sur place, une absente est un sujet à écrire. */
function NoteLinks({ links, notes, onReveal }: { links: string[]; notes: MemoryNote[]; onReveal: (note: MemoryNote) => void }) {
  const t = useTranslate()
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      <span className="text-ink-faint">{t('memory.linkedTo')}</span>
      {links.map((link) => {
        const target = resolveLink(link, notes)
        return target ? (
          <button
            key={link}
            type="button"
            onClick={() => onReveal(target)}
            className="rounded bg-surface-high px-1.5 py-0.5 font-mono text-accent hover:underline focus-visible:outline-2 focus-visible:outline-accent"
          >
            {link}
          </button>
        ) : (
          <span key={link} title={t('memory.toWrite.title')} className="rounded border border-dashed border-line px-1.5 py-0.5 font-mono text-ink-faint">
            {t('memory.toWrite', { name: link })}
          </span>
        )
      })}
    </div>
  )
}

function NoteActions({
  note,
  indexed,
  busy,
  onEdit,
  onDelete,
}: {
  note: MemoryNote
  indexed: boolean
  busy: boolean
  onEdit: () => void
  onDelete: (alsoIndex: boolean) => Promise<void>
}) {
  const t = useTranslate()
  const [confirming, setConfirming] = useState(false)
  const [alsoIndex, setAlsoIndex] = useState(true)
  if (confirming) {
    return (
      <div role="alertdialog" aria-label={t('memory.delete.title', { file: note.file })} className="flex flex-wrap items-center gap-3 rounded-md bg-critical/10 px-3 py-2 text-sm">
        <span className="text-critical">{t('memory.delete.title', { file: note.file })}</span>
        {indexed ? (
          <label className="inline-flex items-center gap-1.5 text-xs text-ink-soft">
            <input type="checkbox" checked={alsoIndex} onChange={(event) => setAlsoIndex(event.target.checked)} className="accent-accent" />
            {t('memory.delete.alsoIndex')}
          </label>
        ) : null}
        <span className="ml-auto" />
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirming(false)}>
          {t('dialog.cancel')}
        </Button>
        <Button size="sm" variant="danger" disabled={busy} onClick={() => void onDelete(indexed && alsoIndex).catch(() => undefined)}>
          {t('memory.delete')}
        </Button>
      </div>
    )
  }
  return (
    <div className="flex items-center gap-1">
      <Button size="sm" variant="ghost" icon={<Pencil size={13} />} onClick={onEdit}>
        {t('memory.edit')}
      </Button>
      <Button size="sm" variant="ghost" icon={<Trash2 size={13} />} onClick={() => setConfirming(true)}>
        {t('memory.delete')}
      </Button>
    </div>
  )
}

/**
 * L'éditeur d'une note : le texte brut, en-tête compris. À la création, un cadre, le
 * nom du fichier (un `.md` à plat, libre et autre que l'index) et la case qui ajoute sa
 * ligne à `MEMORY.md`.
 */
function NoteEditor({
  initial,
  fileName,
  creating = false,
  taken,
  busy,
  onCancel,
  onSave,
}: {
  initial: string
  fileName: string
  creating?: boolean
  taken?: (name: string) => boolean
  busy: boolean
  onCancel: () => void
  onSave: (content: string, fileName: string, addToIndex: boolean) => Promise<void>
}) {
  const t = useTranslate()
  const [text, setText] = useState(initial)
  const [name, setName] = useState(fileName)
  const [addToIndex, setAddToIndex] = useState(true)
  const problem = !creating ? null : !isNoteFileName(name) ? 'memory.editor.invalidName' : taken?.(name) ? 'memory.editor.taken' : null
  return (
    <div className={cx('flex flex-col gap-2', creating && 'rounded-lg border border-line p-3')}>
      {creating ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-ink">{t('memory.editor.newTitle')}</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            aria-label={t('memory.editor.fileName')}
            aria-invalid={problem !== null}
            spellCheck={false}
            autoComplete="off"
            className={cx(
              'h-11 w-64 max-w-full rounded-md border bg-sunken px-2 font-mono text-xs text-ink outline-none md:h-8',
              problem ? 'border-critical' : 'border-line hover:border-line-strong focus:border-accent',
            )}
          />
          {problem ? <span className="text-xs text-critical">{t(problem)}</span> : null}
        </div>
      ) : null}
      <textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        rows={12}
        maxLength={MAX_MEMORY_FILE_CHARS}
        spellCheck={false}
        aria-label={t('memory.editor.content', { file: name })}
        className="w-full resize-y rounded-md border border-line bg-sunken px-3 py-2 font-mono text-xs leading-relaxed text-ink outline-none hover:border-line-strong focus:border-accent"
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          disabled={busy || problem !== null || (!creating && text === initial)}
          onClick={() => void onSave(text, name, addToIndex).catch(() => undefined)}
        >
          {t(creating ? 'memory.editor.create' : 'memory.editor.save')}
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={onCancel}>
          {t('dialog.cancel')}
        </Button>
        {creating ? (
          <label className="inline-flex items-center gap-1.5 text-xs text-ink-soft">
            <input type="checkbox" checked={addToIndex} onChange={(event) => setAddToIndex(event.target.checked)} className="accent-accent" />
            {t('memory.editor.addToIndex')}
          </label>
        ) : null}
      </div>
    </div>
  )
}
