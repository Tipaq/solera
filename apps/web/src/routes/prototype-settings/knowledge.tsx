/* PROTOTYPE — jetable (branche proto/page-projet). Ne pas fusionner dans main.
 *
 * Consignes et mémoire dans `page-gauche`, refaites après le retour de Tim (« je ne
 * comprends pas ce qui est pris en compte : AGENTS.md ? CLAUDE.md ? et Codex, Grok ? »,
 * « la mémoire, ce serait bien de pouvoir la modifier, la supprimer »).
 *
 * Ce que fait le code, et que ces blocs disent en clair :
 * - Consignes (`packages/protocol/src/instructions.ts`, docs CODEX/GROK/OPENCODE) : deux
 *   modes par projet. *Dans le dépôt* : la partie projet est le fichier du dépôt, que
 *   chaque CLI lit lui-même — Claude lit `CLAUDE.md` et `AGENTS.md`, **Codex ignore
 *   `CLAUDE.md`**, Grok et OpenCode lisent les deux. *Dans Solera* : Solera garde le texte,
 *   l'injecte aux 4 CLI et masque les fichiers du dépôt. La partie globale de SOLERA.md
 *   est injectée dans les deux cas.
 * - Mémoire (`packages/protocol/src/memory.ts`, `memory/store.ts`, `session-manager.ts`) :
 *   `MEMORY.md` en index, une note par fichier. Claude la lit et l'écrit nativement ;
 *   Codex, Grok et OpenCode reçoivent l'index en début de session, lisent les notes au
 *   besoin et écrivent par les outils MCP de Solera.
 *
 * Lecture réelle ; toute écriture est simulée (état local, marqué « Simulé »).
 */
import { AlertTriangle, Check, ChevronRight, FilePlus2, Pencil, Search, Trash2, Wrench, X } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { MEMORY_INDEX_FILE, type AgentKind, type InstructionsMode, type ProjectInstructionsDto } from '@solera/protocol'
import { Button, cx } from '@solera/ui'
import { AGENT_LABELS, AgentIcon } from '../../components/AgentIcon'
import { Markdown } from '../../components/chat/Markdown'
import { relativeDate } from '../../lib/dates'
import { useGlobalInstructions, useProjectInstructions } from '../../lib/instructions'
import { useProjectMemory } from '../../lib/memory'
import { openSettings } from '../../lib/settings-dialog'

const CLIS: AgentKind[] = ['claude', 'codex', 'grok', 'opencode']

function SimTag() {
  return <span className="rounded bg-fuchsia-500/15 px-1 text-[10px] font-medium tracking-wide text-fuchsia-700 uppercase dark:text-fuchsia-300">simulé</span>
}

function Raw({ text, className }: { text: string; className?: string }) {
  return <pre className={cx('max-h-72 overflow-auto rounded-md bg-sunken px-3 py-2 font-mono text-xs leading-relaxed whitespace-pre-wrap text-ink-soft', className)}>{text}</pre>
}

const nonEmptyLines = (text: string) => text.split('\n').filter((line) => line.trim()).length

/* ================================================================== consignes */

type RepoFile = 'AGENTS.md' | 'CLAUDE.md'

/** Un fichier court qui ne fait que renvoyer à l'autre : `CLAUDE.md` → « Voir AGENTS.md ». */
function pointsTo(content: string, other: RepoFile): boolean {
  return nonEmptyLines(content) <= 4 && content.includes(other)
}

interface CliReading {
  agent: AgentKind
  global: boolean
  project: 'solera' | RepoFile[] | null
  note: string | null
}

function readings(mode: InstructionsMode, solera: string, files: Partial<Record<RepoFile, string>>, global: string): CliReading[] {
  const has = (file: RepoFile) => (files[file] ?? '').trim().length > 0
  return CLIS.map((agent) => {
    if (mode === 'solera') {
      return { agent, global: global.trim().length > 0, project: solera.trim() ? 'solera' : null, note: solera.trim() ? null : 'le texte de Solera est vide' }
    }
    // Dans le dépôt : chaque CLI lit ce qu'il sait lire.
    const readable: RepoFile[] = agent === 'codex' ? ['AGENTS.md'] : ['AGENTS.md', 'CLAUDE.md']
    const used = readable.filter(has)
    const note = agent === 'codex' && !has('AGENTS.md') && has('CLAUDE.md') ? 'Codex ignore CLAUDE.md' : used.length === 0 ? 'aucun fichier de consignes' : null
    return { agent, global: global.trim().length > 0, project: used.length ? used : null, note }
  })
}

function YesNo({ ok, children }: { ok: boolean; children?: ReactNode }) {
  return (
    <span className={cx('inline-flex items-center gap-1.5 text-sm', ok ? 'text-ink' : 'text-critical')}>
      {ok ? <Check size={14} className="shrink-0 text-positive" /> : <X size={14} className="shrink-0" />}
      {children}
    </span>
  )
}

export function InstructionsPanel({ projectId, notify }: { projectId: string; notify: (text: string) => void }) {
  const { data } = useProjectInstructions(projectId)
  const { data: global } = useGlobalInstructions()
  const [mode, setMode] = useState<InstructionsMode | null>(null)
  const [editing, setEditing] = useState(false)
  if (!data) return <p className="text-sm text-ink-faint">Chargement…</p>
  return <InstructionsBody data={data} global={global?.content ?? ''} mode={mode ?? data.mode} setMode={setMode} editing={editing} setEditing={setEditing} notify={notify} />
}

function InstructionsBody({
  data,
  global,
  mode,
  setMode,
  editing,
  setEditing,
  notify,
}: {
  data: ProjectInstructionsDto
  global: string
  mode: InstructionsMode
  setMode: (mode: InstructionsMode) => void
  editing: boolean
  setEditing: (value: boolean) => void
  notify: (text: string) => void
}) {
  const files: Partial<Record<RepoFile, string>> = Object.fromEntries(data.repoFiles.map((file) => [file.path, file.content]))
  const rows = readings(mode, data.content, files, global)
  const missing = rows.filter((row) => row.project === null)
  const agents = files['AGENTS.md']
  const claude = files['CLAUDE.md']
  const diverge = mode === 'repo' && agents?.trim() && claude?.trim() && !pointsTo(claude, 'AGENTS.md') && !pointsTo(agents, 'CLAUDE.md')
  const editTarget: { title: string; text: string } =
    mode === 'solera'
      ? { title: 'Texte tenu par Solera', text: data.content }
      : agents !== undefined
        ? { title: 'AGENTS.md', text: agents }
        : { title: claude !== undefined ? 'CLAUDE.md' : 'AGENTS.md (à créer)', text: claude ?? '' }
  const [draft, setDraft] = useState<string | null>(null)
  const text = draft ?? editTarget.text

  const choose = (next: InstructionsMode) => {
    if (next === mode) return
    setMode(next)
    notify(`Simulé : les consignes du projet passeraient ${next === 'repo' ? 'dans le dépôt' : 'dans Solera'}.`)
  }

  return (
    <div className="flex flex-col gap-6">
      {/* ---------------- le mode */}
      <div className="flex flex-col gap-2">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-medium">Où vivent les consignes du projet</span>
          {!data.modeChosen ? <span className="text-xs text-ink-faint">déduit du dossier, jamais choisi</span> : null}
        </div>
        <div role="radiogroup" className="grid gap-2 md:grid-cols-2">
          <ModeOption
            active={mode === 'repo'}
            onClick={() => choose('repo')}
            title="Dans le dépôt"
            text="Le fichier AGENTS.md (ou CLAUDE.md) versionné avec le code. Chaque CLI le lit lui-même ; Solera n'y ajoute rien. Tous ceux qui clonent ont les mêmes consignes."
          />
          <ModeOption
            active={mode === 'solera'}
            onClick={() => choose('solera')}
            title="Dans Solera"
            text="Un texte gardé par Solera et donné aux 4 CLI. Les AGENTS.md et CLAUDE.md du dépôt leur sont masqués, pour ne pas doubler. Rien n'est écrit dans le dépôt."
          />
        </div>
      </div>

      {/* ---------------- les fichiers du dépôt */}
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Fichiers à la racine du dépôt</span>
        <ul className="flex flex-col">
          {(['AGENTS.md', 'CLAUDE.md'] as const).map((file) => {
            const content = files[file]
            const other: RepoFile = file === 'AGENTS.md' ? 'CLAUDE.md' : 'AGENTS.md'
            return (
              <Fold
                key={file}
                title={<span className="font-mono">{file}</span>}
                meta={
                  content === undefined
                    ? 'absent'
                    : pointsTo(content, other)
                      ? `renvoie à ${other}`
                      : `${nonEmptyLines(content)} lignes${mode === 'solera' ? ' · masqué aux CLI' : ''}`
                }
              >
                {content !== undefined ? <Raw text={content} /> : null}
              </Fold>
            )
          })}
        </ul>
      </div>

      {/* ---------------- ce que lit chaque CLI */}
      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">Ce que lit chaque CLI</span>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[34rem] text-left">
            <thead>
              <tr className="text-xs text-ink-faint">
                <th className="py-1.5 pr-4 font-normal">CLI</th>
                <th className="py-1.5 pr-4 font-normal">Partie globale</th>
                <th className="py-1.5 pr-4 font-normal">Partie projet</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line border-t border-line">
              {rows.map((row) => (
                <tr key={row.agent}>
                  <td className="py-2 pr-4">
                    <span className="inline-flex items-center gap-2 text-sm"><AgentIcon agent={row.agent} size={14} />{AGENT_LABELS[row.agent]}</span>
                  </td>
                  <td className="py-2 pr-4"><YesNo ok={row.global}>{row.global ? 'SOLERA.md global' : 'vide'}</YesNo></td>
                  <td className="py-2 pr-4">
                    <YesNo ok={row.project !== null}>
                      {row.project === 'solera'
                        ? 'texte de Solera'
                        : row.project
                          ? <span className="font-mono text-[13px]">{row.project.join(' + ')}</span>
                          : row.note}
                    </YesNo>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {missing.length > 0 ? (
          <Alert>
            {missing.map((row) => AGENT_LABELS[row.agent]).join(', ')} {missing.length > 1 ? 'n’auront' : 'n’aura'} pas les consignes du projet
            {mode === 'repo' && files['CLAUDE.md'] && !files['AGENTS.md']
              ? ' : seul CLAUDE.md existe, et Codex ne le lit pas. Renomme-le en AGENTS.md et laisse dans CLAUDE.md une ligne « Voir AGENTS.md ».'
              : '.'}
          </Alert>
        ) : null}
        {diverge ? <Alert>AGENTS.md et CLAUDE.md ont chacun leur contenu : Claude lit les deux, Codex seulement AGENTS.md. Les agents n'auront pas les mêmes consignes ; garde-en un seul, l'autre en renvoi.</Alert> : null}
        <p className="text-xs text-ink-faint">
          La partie globale vaut pour tous tes projets.{' '}
          <button type="button" className="text-accent hover:underline" onClick={() => openSettings('consignes')}>La modifier</button>
        </p>
      </div>

      {/* ---------------- l'édition */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{editTarget.title}</span>
          <span className="text-xs text-ink-faint">{nonEmptyLines(editTarget.text)} lignes{data.updatedAt && mode === 'solera' ? ` · ${relativeDate(data.updatedAt)}` : ''}</span>
          <span className="ml-auto" />
          {editing ? null : (
            <Button size="sm" variant="ghost" icon={<Pencil size={13} />} onClick={() => setEditing(true)} disabled={!data.canEdit}>
              Modifier
            </Button>
          )}
        </div>
        {editing ? (
          <div className="flex flex-col gap-2">
            <textarea
              value={text}
              onChange={(event) => setDraft(event.target.value)}
              rows={14}
              className="w-full rounded-lg border border-line bg-canvas px-3 py-2 font-mono text-xs leading-relaxed outline-none focus:border-accent"
            />
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={() => { setEditing(false); setDraft(null); notify(`Simulé : ${editTarget.title} serait enregistré.`) }}>Enregistrer</Button>
              <Button size="sm" variant="ghost" onClick={() => { setEditing(false); setDraft(null) }}>Annuler</Button>
              <SimTag />
            </div>
          </div>
        ) : editTarget.text.trim() ? (
          <div className="max-h-72 overflow-auto rounded-lg border border-line px-4 py-3 text-sm">
            <Markdown text={editTarget.text} />
          </div>
        ) : (
          <p className="text-sm text-ink-faint">Vide.</p>
        )}
      </div>
    </div>
  )
}

function ModeOption({ active, onClick, title, text }: { active: boolean; onClick: () => void; title: string; text: string }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={cx(
        'flex flex-col gap-1 rounded-lg border px-3.5 py-3 text-left transition-colors',
        active ? 'border-accent bg-accent-wash/40' : 'border-line hover:border-line-strong',
      )}
    >
      <span className="flex items-center gap-2 text-sm font-medium">
        <span className={cx('grid size-4 place-items-center rounded-full border', active ? 'border-accent' : 'border-line-strong')}>
          {active ? <span className="size-2 rounded-full bg-accent" /> : null}
        </span>
        {title}
      </span>
      <span className="text-xs leading-relaxed text-ink-soft">{text}</span>
    </button>
  )
}

function Alert({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-start gap-2 rounded-md bg-caution/10 px-3 py-2 text-sm text-caution">
      <AlertTriangle size={14} className="mt-0.5 shrink-0" />
      <span>{children}</span>
    </p>
  )
}

function Fold({ title, meta, children }: { title: ReactNode; meta?: ReactNode; children?: ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <li className="border-t border-line first:border-t-0">
      <button
        type="button"
        disabled={!children}
        onClick={() => setOpen((value) => !value)}
        className="flex min-h-10 w-full min-w-0 items-center gap-2 py-2 text-left disabled:cursor-default"
      >
        {children ? <ChevronRight size={13} className={cx('shrink-0 text-ink-faint transition-transform', open && 'rotate-90')} /> : <span className="w-[13px]" />}
        <span className="shrink-0 text-sm">{title}</span>
        {meta ? <span className="min-w-0 truncate text-xs text-ink-faint">{meta}</span> : null}
      </button>
      {open && children ? <div className="pb-3 pl-[21px]">{children}</div> : null}
    </li>
  )
}

/* ================================================================== mémoire */

const TYPES = ['user', 'feedback', 'project', 'reference'] as const
type NoteType = (typeof TYPES)[number]
const TYPE_LABEL: Record<NoteType | 'none', string> = { user: 'Toi', feedback: 'Retour', project: 'Projet', reference: 'Référence', none: 'Sans type' }
const TYPE_TONE: Record<NoteType | 'none', string> = {
  user: 'bg-accent/15 text-accent',
  feedback: 'bg-caution/15 text-caution',
  project: 'bg-positive/15 text-positive',
  reference: 'bg-surface-high text-ink-soft',
  none: 'bg-surface-high text-ink-faint',
}

interface Note {
  file: string
  slug: string
  name: string
  description: string | null
  type: NoteType | 'none'
  body: string
  links: string[]
  content: string
  updatedAt: number
}

function parseNote(file: string, content: string, updatedAt: number): Note {
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(content)
  const head = match?.[1] ?? ''
  const field = (key: string) => {
    const line = head.split('\n').find((candidate) => candidate.trim().startsWith(`${key}:`))
    return line ? line.slice(line.indexOf(':') + 1).trim().replace(/^["']|["']$/g, '') : null
  }
  const rawType = field('type')
  const type = (TYPES as readonly string[]).includes(rawType ?? '') ? (rawType as NoteType) : 'none'
  const body = match ? content.slice(match[0].length) : content
  const slug = file.replace(/\.md$/, '')
  const links = [...new Set([...body.matchAll(/\[\[([^\]]+)\]\]/g)].map((entry) => entry[1]!.trim()))]
  return { file, slug, name: field('name') ?? slug, description: field('description'), type, body, links, content, updatedAt }
}

/** Les lignes de `MEMORY.md` : `- [Titre](fichier.md) — accroche`. */
function indexEntries(index: string): { file: string; line: string }[] {
  return index
    .split('\n')
    .map((line) => ({ line, file: /\]\(([^)]+\.md)\)/.exec(line)?.[1] ?? null }))
    .filter((entry): entry is { line: string; file: string } => entry.file !== null)
}

const TEMPLATE = (slug: string) => `---
name: ${slug}
description: Une ligne qui dit de quoi parle la note
metadata:
  type: project
---

Le fait, en quelques lignes.

**Why:** pourquoi c'est vrai, ou ce qui s'est passé.

**How to apply:** ce qu'un agent doit en faire.
`

export function MemoryPanel({ projectId, notify }: { projectId: string; notify: (text: string) => void }) {
  const { data } = useProjectMemory(projectId)
  // Les écritures simulées : contenus réécrits, notes supprimées, index réécrit.
  const [overlay, setOverlay] = useState<Record<string, string>>({})
  const [deleted, setDeleted] = useState<ReadonlySet<string>>(() => new Set())
  const [query, setQuery] = useState('')
  const [type, setType] = useState<NoteType | 'none' | 'all'>('all')
  const [open, setOpen] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const files = useMemo(() => {
    const base = new Map((data?.files ?? []).map((file) => [file.file, { content: file.content, updatedAt: file.updatedAt }]))
    for (const [file, content] of Object.entries(overlay)) base.set(file, { content, updatedAt: Date.now() })
    for (const file of deleted) base.delete(file)
    return base
  }, [data, overlay, deleted])

  const notes = useMemo(
    () => [...files.entries()].filter(([file]) => file !== MEMORY_INDEX_FILE).map(([file, value]) => parseNote(file, value.content, value.updatedAt)).sort((a, b) => b.updatedAt - a.updatedAt),
    [files],
  )
  const index = files.get(MEMORY_INDEX_FILE)?.content ?? ''
  const entries = indexEntries(index)
  const indexed = new Set(entries.map((entry) => entry.file))
  const unindexed = notes.filter((note) => !indexed.has(note.file))
  const orphans = entries.filter((entry) => !files.has(entry.file))
  const bySlug = new Map(notes.flatMap((note) => [[note.slug, note], [note.name, note]] as const))

  if (!data) return <p className="text-sm text-ink-faint">Chargement…</p>

  const q = query.trim().toLocaleLowerCase()
  const shown = notes.filter(
    (note) => (type === 'all' || note.type === type) && (!q || `${note.name} ${note.description ?? ''} ${note.body}`.toLocaleLowerCase().includes(q)),
  )
  const counts = Object.fromEntries((['all', ...TYPES, 'none'] as const).map((key) => [key, key === 'all' ? notes.length : notes.filter((note) => note.type === key).length]))

  const write = (file: string, content: string, message: string) => {
    setOverlay((current) => ({ ...current, [file]: content }))
    setDeleted((current) => { const next = new Set(current); next.delete(file); return next })
    notify(`Simulé : ${message}`)
  }
  const remove = (note: Note, alsoIndex: boolean) => {
    setDeleted((current) => new Set(current).add(note.file))
    if (alsoIndex) setOverlay((current) => ({ ...current, [MEMORY_INDEX_FILE]: index.split('\n').filter((line) => !line.includes(`](${note.file})`)).join('\n') }))
    setOpen(null)
    notify(`Simulé : ${note.file} serait supprimée${alsoIndex ? ', et sa ligne retirée de MEMORY.md' : ''}.`)
  }
  const repairIndex = () => {
    const kept = index.split('\n').filter((line) => !orphans.some((entry) => entry.line === line))
    const added = unindexed.map((note) => `- [${note.name}](${note.file}) — ${note.description ?? ''}`.trimEnd())
    write(MEMORY_INDEX_FILE, [...kept, ...added].join('\n').replace(/\n{3,}/g, '\n\n'), `MEMORY.md serait réparé (${added.length} ligne${added.length > 1 ? 's' : ''} ajoutée${added.length > 1 ? 's' : ''}, ${orphans.length} orpheline${orphans.length > 1 ? 's' : ''} retirée${orphans.length > 1 ? 's' : ''}).`)
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs leading-relaxed text-ink-faint">
        Ce que les agents ont appris en route, une note par fichier, avec <span className="font-mono">MEMORY.md</span> pour index.
        Claude la lit et l'écrit de lui-même ; Codex, Grok et OpenCode reçoivent l'index en début de session, lisent les notes
        au besoin et écrivent par les outils de Solera.
      </p>

      {/* ---------------- outils */}
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex h-8 min-w-48 flex-1 items-center gap-2 rounded-md border border-line px-2.5 md:max-w-64 md:flex-none">
          <Search size={13} className="shrink-0 text-ink-faint" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Chercher dans les notes" className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-ink-faint" />
        </label>
        <div className="flex flex-wrap gap-1">
          {(['all', ...TYPES, 'none'] as const).map((key) =>
            key !== 'all' && counts[key] === 0 ? null : (
              <button
                key={key}
                type="button"
                onClick={() => setType(key)}
                className={cx('h-8 rounded-md px-2.5 text-xs transition-colors', type === key ? 'bg-surface-high text-ink' : 'text-ink-faint hover:text-ink')}
              >
                {key === 'all' ? 'Toutes' : TYPE_LABEL[key]} <span className="tabular-nums opacity-70">{counts[key]}</span>
              </button>
            ),
          )}
        </div>
        <span className="ml-auto" />
        {data.canEdit ? (
          <Button size="sm" variant="secondary" icon={<FilePlus2 size={14} />} onClick={() => { setCreating(true); setOpen(null) }}>
            Nouvelle note
          </Button>
        ) : null}
      </div>

      {/* ---------------- index */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <span className="font-mono text-ink-soft">MEMORY.md</span>
        <span className="text-ink-faint">{entries.length - orphans.length} note{entries.length - orphans.length > 1 ? 's' : ''} indexée{entries.length - orphans.length > 1 ? 's' : ''}</span>
        {unindexed.length ? <span className="text-caution">{unindexed.length} absente{unindexed.length > 1 ? 's' : ''} de l'index</span> : null}
        {orphans.length ? <span className="text-caution">{orphans.length} ligne{orphans.length > 1 ? 's' : ''} sans note</span> : null}
        {unindexed.length || orphans.length ? (
          <button type="button" onClick={repairIndex} className="inline-flex items-center gap-1 text-accent hover:underline"><Wrench size={12} /> Réparer l'index</button>
        ) : (
          <span className="inline-flex items-center gap-1 text-positive"><Check size={12} /> à jour</span>
        )}
      </div>

      {creating ? (
        <NoteEditor
          initial={TEMPLATE('nouvelle-note')}
          fileName="nouvelle-note.md"
          creating
          onCancel={() => setCreating(false)}
          onSave={(content, fileName, addToIndex) => {
            const note = parseNote(fileName, content, Date.now())
            write(fileName, content, `${fileName} serait créée${addToIndex ? ' et ajoutée à MEMORY.md' : ''}.`)
            if (addToIndex) setOverlay((current) => ({ ...current, [fileName]: content, [MEMORY_INDEX_FILE]: `${index.trimEnd()}\n- [${note.name}](${fileName}) — ${note.description ?? ''}`.trimEnd() }))
            setCreating(false)
            setOpen(fileName)
          }}
        />
      ) : null}

      {/* ---------------- notes */}
      {shown.length === 0 ? (
        <p className="text-sm text-ink-faint">{notes.length === 0 ? 'Aucune note pour l’instant.' : 'Aucune note ne correspond.'}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line border-y border-line">
          {shown.map((note) => {
            const isOpen = open === note.file
            return (
              <li key={note.file} id={`note-${note.slug}`}>
                <button
                  type="button"
                  onClick={() => { setOpen(isOpen ? null : note.file); setEditing(null) }}
                  className="flex min-h-11 w-full min-w-0 items-center gap-3 py-2 text-left"
                >
                  <ChevronRight size={13} className={cx('shrink-0 text-ink-faint transition-transform', isOpen && 'rotate-90')} />
                  <span className="shrink-0 font-mono text-sm">{note.slug}</span>
                  <span className={cx('shrink-0 rounded px-1.5 py-0.5 text-[11px]', TYPE_TONE[note.type])}>{TYPE_LABEL[note.type]}</span>
                  <span className="min-w-0 flex-1 truncate text-xs text-ink-faint">{note.description}</span>
                  {!indexed.has(note.file) ? <span className="shrink-0 text-[11px] text-caution">hors index</span> : null}
                  <span className="shrink-0 text-xs text-ink-faint tabular-nums">{relativeDate(note.updatedAt)}</span>
                </button>
                {isOpen ? (
                  <div className="flex flex-col gap-3 pb-4 pl-6">
                    {editing === note.file ? (
                      <NoteEditor
                        initial={note.content}
                        fileName={note.file}
                        onCancel={() => setEditing(null)}
                        onSave={(content) => { write(note.file, content, `${note.file} serait enregistrée.`); setEditing(null) }}
                      />
                    ) : (
                      <>
                        <div className="text-sm"><Markdown text={note.body.replace(/\[\[([^\]]+)\]\]/g, '`$1`')} /></div>
                        {note.links.length ? (
                          <div className="flex flex-wrap items-center gap-1.5 text-xs">
                            <span className="text-ink-faint">Liée à</span>
                            {note.links.map((link) => {
                              const target = bySlug.get(link)
                              return target ? (
                                <button key={link} type="button" onClick={() => { setOpen(target.file); document.getElementById(`note-${target.slug}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }) }} className="rounded bg-surface-high px-1.5 py-0.5 font-mono text-accent hover:underline">
                                  {link}
                                </button>
                              ) : (
                                <span key={link} title="Aucune note de ce nom : un sujet à écrire" className="rounded border border-dashed border-line px-1.5 py-0.5 font-mono text-ink-faint">
                                  {link} · à écrire
                                </span>
                              )
                            })}
                          </div>
                        ) : null}
                        {data.canEdit ? <NoteActions note={note} indexed={indexed.has(note.file)} onEdit={() => setEditing(note.file)} onDelete={remove} /> : null}
                      </>
                    )}
                  </div>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function NoteActions({ note, indexed, onEdit, onDelete }: { note: Note; indexed: boolean; onEdit: () => void; onDelete: (note: Note, alsoIndex: boolean) => void }) {
  const [confirming, setConfirming] = useState(false)
  const [alsoIndex, setAlsoIndex] = useState(true)
  if (confirming) {
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-md bg-critical/10 px-3 py-2 text-sm">
        <span className="text-critical">Supprimer {note.file} ?</span>
        {indexed ? (
          <label className="inline-flex items-center gap-1.5 text-xs text-ink-soft">
            <input type="checkbox" checked={alsoIndex} onChange={(event) => setAlsoIndex(event.target.checked)} />
            retirer aussi sa ligne de MEMORY.md
          </label>
        ) : null}
        <span className="ml-auto" />
        <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>Annuler</Button>
        <Button size="sm" variant="danger" onClick={() => onDelete(note, indexed && alsoIndex)}>Supprimer</Button>
      </div>
    )
  }
  return (
    <div className="flex items-center gap-1">
      <Button size="sm" variant="ghost" icon={<Pencil size={13} />} onClick={onEdit}>Modifier</Button>
      <Button size="sm" variant="ghost" icon={<Trash2 size={13} />} onClick={() => setConfirming(true)}>Supprimer</Button>
    </div>
  )
}

function NoteEditor({
  initial,
  fileName,
  creating = false,
  onCancel,
  onSave,
}: {
  initial: string
  fileName: string
  creating?: boolean
  onCancel: () => void
  onSave: (content: string, fileName: string, addToIndex: boolean) => void
}) {
  const [text, setText] = useState(initial)
  const [name, setName] = useState(fileName)
  const [addToIndex, setAddToIndex] = useState(true)
  const valid = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}\.md$/.test(name) && name !== MEMORY_INDEX_FILE
  return (
    <div className={cx('flex flex-col gap-2', creating && 'rounded-lg border border-line p-3')}>
      {creating ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">Nouvelle note</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            className={cx('h-8 w-64 rounded-md border bg-canvas px-2 font-mono text-xs outline-none', valid ? 'border-line focus:border-accent' : 'border-critical')}
          />
          {!valid ? <span className="text-xs text-critical">un nom de fichier .md, sans dossier</span> : null}
        </div>
      ) : null}
      <textarea value={text} onChange={(event) => setText(event.target.value)} rows={12} className="w-full rounded-lg border border-line bg-canvas px-3 py-2 font-mono text-xs leading-relaxed outline-none focus:border-accent" />
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={!valid} onClick={() => onSave(text, name, addToIndex)}>{creating ? 'Créer' : 'Enregistrer'}</Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>Annuler</Button>
        {creating ? (
          <label className="inline-flex items-center gap-1.5 text-xs text-ink-soft">
            <input type="checkbox" checked={addToIndex} onChange={(event) => setAddToIndex(event.target.checked)} />
            l'ajouter à MEMORY.md
          </label>
        ) : null}
        <SimTag />
      </div>
    </div>
  )
}

