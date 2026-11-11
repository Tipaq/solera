/* PROTOTYPE — jetable (branche proto/page-projet). Ne pas fusionner dans main.
 *
 * L'ajout et la modification d'une action, en deux variantes à comparer :
 * - `assistant` : quatre pas (nature, commande et dossier, lien, nom), un à la fois ;
 * - `formulaire` : tout sur un écran, les suggestions à gauche, un aperçu vivant.
 * Rien n'est enregistré : « Enregistrer » et « Essayer » sont simulés.
 */
import { Drawer } from '../../components/prototype/Drawer'
import { ArrowLeft, ArrowRight, Check, CircleAlert, Folder, FolderOpen, Infinity as Loop, Play, Sparkles, SquareTerminal, TriangleAlert } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { MAX_ACTION_LABEL_CHARS, resolveActionUrl, type ProjectActionKind } from '@solera/protocol'
import { Button, cx } from '@solera/ui'
import {
  EMPTY_DRAFT,
  REPO_TREE,
  SUGGESTIONS,
  fakeOutput,
  problemsOf,
  soleraIsRemote,
  type ActionDraft,
  type DraftProblems,
  type Suggestion,
} from './data'

export type EditorVariant = 'assistant' | 'formulaire'

export function ActionEditor({
  variant,
  initial,
  editing,
  onClose,
  onSaved,
}: {
  variant: EditorVariant
  initial?: ActionDraft
  /** Vrai pour une modification : la nature et la commande changées repassent « à relire » si un agent l'avait écrite. */
  editing: boolean
  onClose: () => void
  onSaved: (draft: ActionDraft) => void
}) {
  const [draft, setDraft] = useState<ActionDraft>(initial ?? EMPTY_DRAFT)
  const [touched, setTouched] = useState(false)
  const set = (patch: Partial<ActionDraft>) => setDraft((current) => ({ ...current, ...patch }))
  const problems = problemsOf(draft)
  const valid = Object.keys(problems).length === 0
  const title = editing ? 'Modifier l’action' : 'Nouvelle action'

  const save = () => {
    setTouched(true)
    if (!valid) return
    onSaved(draft)
  }

  return (
    // Le tiroir large (48 rem), le seul : même géométrie que les autres, par-dessus
    // le tiroir « Gérer les actions » quand il en vient.
    <Drawer
      open
      onClose={onClose}
      label={title}
      width="wide"
      title={title}
      subtitle={<span className="rounded border border-dashed border-fuchsia-500/60 px-1.5 text-meta text-fuchsia-700 dark:text-fuchsia-300">{variant} · simulé</span>}
    >
      {variant === 'assistant' ? (
        <Assistant draft={draft} set={set} problems={problems} onSave={save} />
      ) : (
        <Formulaire draft={draft} set={set} problems={touched ? problems : {}} editing={editing} onSave={save} onCancel={onClose} />
      )}
    </Drawer>
  )
}

/* ------------------------------------------------------------------ assistant */

const STEPS = ['Nature', 'Commande', 'Lien', 'Nom'] as const

function Assistant({ draft, set, problems, onSave }: { draft: ActionDraft; set: (patch: Partial<ActionDraft>) => void; problems: DraftProblems; onSave: () => void }) {
  const [step, setStep] = useState(0)
  // Une tâche n'a pas de lien : son pas est sauté.
  const steps = STEPS.filter((name) => name !== 'Lien' || draft.kind !== 'task')
  const current = steps[Math.min(step, steps.length - 1)]!
  const blocked =
    (current === 'Nature' && !draft.kind) ||
    (current === 'Commande' && Boolean(problems.command || problems.subdir)) ||
    (current === 'Lien' && Boolean(problems.url)) ||
    (current === 'Nom' && Boolean(problems.label))
  const last = step >= steps.length - 1

  const pick = (suggestion: Suggestion) => {
    set({ kind: suggestion.kind, command: suggestion.command, subdir: suggestion.subdir, label: suggestion.label, url: suggestion.url ?? '' })
    setStep(1)
  }

  return (
    <>
      <ol className="flex items-center gap-2 border-b border-line px-5 py-3 text-xs">
        {steps.map((name, index) => (
          <li key={name} className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => index <= step && setStep(index)}
              className={cx(
                'flex items-center gap-1.5 rounded-full px-2 py-1',
                index === step ? 'bg-accent-wash/60 font-medium text-ink' : index < step ? 'text-ink-soft hover:text-ink' : 'text-ink-faint',
              )}
            >
              <span className={cx('grid size-4 place-items-center rounded-full text-[10px] tabular-nums', index < step ? 'bg-positive text-canvas' : 'border border-current')}>
                {index < step ? <Check size={10} /> : index + 1}
              </span>
              {name}
            </button>
            {index < steps.length - 1 ? <span className="h-px w-4 bg-line" /> : null}
          </li>
        ))}
      </ol>

      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 py-5">
        {current === 'Nature' ? (
          <>
            <KindCards value={draft.kind} onChange={(kind) => set({ kind })} />
            <Suggestions onPick={pick} compact />
          </>
        ) : null}
        {current === 'Commande' ? (
          <>
            <CommandField draft={draft} set={set} problem={problems.command} />
            <FolderPicker draft={draft} set={set} problem={problems.subdir} />
          </>
        ) : null}
        {current === 'Lien' ? <UrlField draft={draft} set={set} problem={problems.url} /> : null}
        {current === 'Nom' ? (
          <>
            <LabelFields draft={draft} set={set} problem={problems.label} />
            <Preview draft={draft} />
            <TryRun draft={draft} disabled={Boolean(problems.command || problems.subdir)} />
          </>
        ) : null}
      </div>

      <footer className="flex items-center gap-2 border-t border-line px-5 py-3">
        {step > 0 ? (
          <Button variant="ghost" icon={<ArrowLeft size={15} />} onClick={() => setStep(step - 1)}>Retour</Button>
        ) : null}
        <span className="flex-1" />
        {last ? (
          <Button disabled={blocked} icon={<Check size={15} />} onClick={onSave}>Enregistrer</Button>
        ) : (
          <Button disabled={blocked} onClick={() => setStep(step + 1)}>
            Suivant <ArrowRight size={15} />
          </Button>
        )}
      </footer>
    </>
  )
}

/* ------------------------------------------------------------------ formulaire */

function Formulaire({
  draft,
  set,
  problems,
  editing,
  onSave,
  onCancel,
}: {
  draft: ActionDraft
  set: (patch: Partial<ActionDraft>) => void
  problems: DraftProblems
  editing: boolean
  onSave: () => void
  onCancel: () => void
}) {
  const pick = (suggestion: Suggestion) =>
    set({ kind: suggestion.kind, command: suggestion.command, subdir: suggestion.subdir, label: suggestion.label, url: suggestion.url ?? '' })

  return (
    <>
      <div className="grid min-h-0 flex-1 overflow-y-auto md:grid-cols-[17rem_minmax(0,1fr)]">
        {/* Les suggestions à gauche : on part d'un script du dépôt plutôt que d'une page blanche. */}
        <aside className="border-b border-line bg-surface/50 px-4 py-4 md:border-r md:border-b-0">
          <Suggestions onPick={pick} />
        </aside>

        <div className="flex min-w-0 flex-col gap-5 px-5 py-5">
          <KindCards value={draft.kind} onChange={(kind) => set({ kind })} problem={problems.kind} />
          <CommandField draft={draft} set={set} problem={problems.command} />
          <FolderPicker draft={draft} set={set} problem={problems.subdir} />
          {draft.kind === 'service' ? <UrlField draft={draft} set={set} problem={problems.url} /> : null}
          <LabelFields draft={draft} set={set} problem={problems.label} />
          <Preview draft={draft} />
          <TryRun draft={draft} disabled={!draft.command.trim()} />
          {editing ? (
            <p className="text-xs text-ink-faint">
              Changer la commande, la nature ou le dossier d’une action écrite par un agent la repasse « à relire » ; le libellé et la description, non.
            </p>
          ) : null}
        </div>
      </div>

      <footer className="flex items-center gap-2 border-t border-line px-5 py-3">
        <span className="min-w-0 flex-1 text-xs text-ink-faint">Rien n’est écrit dans le dépôt : l’action vit dans Solera.</span>
        <Button variant="ghost" onClick={onCancel}>Annuler</Button>
        <Button icon={<Check size={15} />} onClick={onSave}>Enregistrer</Button>
      </footer>
    </>
  )
}

/* ------------------------------------------------------------------ morceaux */

function FieldLabel({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  return (
    <span className="flex items-baseline gap-2">
      <span className="text-sm font-medium">{children}</span>
      {hint ? <span className="text-xs text-ink-faint">{hint}</span> : null}
    </span>
  )
}

function Problem({ text }: { text?: string }) {
  if (!text) return null
  return (
    <span className="flex items-start gap-1.5 text-xs text-critical">
      <CircleAlert size={13} className="mt-px shrink-0" /> {text}
    </span>
  )
}

function KindCards({ value, onChange, problem }: { value: ProjectActionKind | null; onChange: (kind: ProjectActionKind) => void; problem?: string }) {
  const cards: { kind: ProjectActionKind; icon: ReactNode; title: string; body: string; examples: string }[] = [
    {
      kind: 'task',
      icon: <SquareTerminal size={20} />,
      title: 'Tâche',
      body: 'Se termine. Elle s’ouvre dans un terminal du panneau et laisse son code de sortie.',
      examples: 'tests, lint, build, seed',
    },
    {
      kind: 'service',
      icon: <Loop size={20} />,
      title: 'Service',
      body: 'Tourne en continu, même Solera fermé. On le voit dans Services, on l’arrête ou le relance.',
      examples: 'serveur de dev, worker, Storybook',
    },
  ]
  return (
    <div className="flex flex-col gap-2">
      <FieldLabel>Nature</FieldLabel>
      <div role="radiogroup" aria-label="Nature" className="grid gap-2 sm:grid-cols-2">
        {cards.map((card) => {
          const active = value === card.kind
          return (
            <button
              key={card.kind}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(card.kind)}
              className={cx(
                'flex flex-col gap-1.5 rounded-xl border p-3.5 text-left transition-colors',
                active ? 'border-accent bg-accent-wash/40' : 'border-line hover:border-line-strong',
              )}
            >
              <span className={cx('flex items-center gap-2 font-medium', active ? 'text-accent' : 'text-ink')}>
                {card.icon} {card.title}
                {active ? <Check size={15} className="ml-auto" /> : null}
              </span>
              <span className="text-sm text-ink-soft">{card.body}</span>
              <span className="text-xs text-ink-faint">ex. {card.examples}</span>
            </button>
          )
        })}
      </div>
      <Problem text={problem} />
    </div>
  )
}

function Suggestions({ onPick, compact = false }: { onPick: (suggestion: Suggestion) => void; compact?: boolean }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="flex items-center gap-1.5 text-sm font-medium">
        <Sparkles size={14} className="text-accent" /> Trouvé dans le dépôt
        <span className="text-meta font-normal text-fuchsia-600 dark:text-fuchsia-300">simulé</span>
      </span>
      <ul className={cx('flex flex-col', compact ? 'divide-y divide-line rounded-lg border border-line' : 'gap-1')}>
        {SUGGESTIONS.map((suggestion) => (
          <li key={suggestion.command}>
            <button
              type="button"
              onClick={() => onPick(suggestion)}
              className={cx('flex w-full flex-col gap-0.5 px-2.5 py-2 text-left transition-colors hover:bg-surface-high', !compact && 'rounded-lg')}
            >
              <span className="flex items-center gap-2 text-sm">
                {suggestion.kind === 'service' ? <Loop size={13} className="shrink-0 text-ink-faint" /> : <SquareTerminal size={13} className="shrink-0 text-ink-faint" />}
                <span className="min-w-0 truncate">{suggestion.label}</span>
                <code className="ml-auto truncate font-mono text-xs text-ink-faint">{suggestion.command}</code>
              </span>
              {!compact ? <span className="pl-5 text-xs text-ink-faint">{suggestion.source} · {suggestion.why}</span> : null}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

function CommandField({ draft, set, problem }: { draft: ActionDraft; set: (patch: Partial<ActionDraft>) => void; problem?: string }) {
  return (
    <label className="flex flex-col gap-1.5">
      <FieldLabel hint="jouée par $SHELL -lc">Commande</FieldLabel>
      <textarea
        value={draft.command}
        onChange={(event) => set({ command: event.target.value })}
        rows={Math.min(5, Math.max(2, draft.command.split('\n').length))}
        spellCheck={false}
        placeholder={draft.kind === 'service' ? 'pnpm dev' : 'pnpm test'}
        className="resize-y rounded-lg border border-line bg-canvas px-3 py-2 font-mono text-sm outline-none focus:border-accent"
      />
      <span className="text-xs text-ink-faint">
        Pas de chemin absolu vers un worktree : l’action doit marcher depuis n’importe lequel.
        {draft.kind === 'service' ? ' Un serveur écoute sur 127.0.0.1.' : ''}
      </span>
      <Problem text={problem} />
    </label>
  )
}

function FolderPicker({ draft, set, problem }: { draft: ActionDraft; set: (patch: Partial<ActionDraft>) => void; problem?: string }) {
  const [open, setOpen] = useState(false)
  const shown = draft.subdir.trim()
  return (
    <div className="flex flex-col gap-1.5">
      <FieldLabel hint="relatif au worktree">Dossier</FieldLabel>
      <div className="flex items-center gap-2">
        <span className="font-mono text-sm text-ink-faint">&lt;worktree&gt;/</span>
        <input
          value={draft.subdir}
          onChange={(event) => set({ subdir: event.target.value })}
          placeholder="racine"
          spellCheck={false}
          className="min-w-0 flex-1 rounded-lg border border-line bg-canvas px-3 py-1.5 font-mono text-sm outline-none focus:border-accent"
        />
        <Button size="sm" variant="secondary" icon={open ? <FolderOpen size={14} /> : <Folder size={14} />} onClick={() => setOpen(!open)}>
          Parcourir
        </Button>
      </div>
      {open ? (
        <ul className="max-h-48 overflow-y-auto rounded-lg border border-line py-1">
          {REPO_TREE.map((entry) => {
            const active = entry.path === shown
            return (
              <li key={entry.path || 'root'}>
                <button
                  type="button"
                  onClick={() => { set({ subdir: entry.path }); setOpen(false) }}
                  className={cx('flex w-full items-center gap-2 py-1 pr-3 text-left font-mono text-sm hover:bg-surface-high', active && 'bg-accent-wash/40 text-accent')}
                  style={{ paddingLeft: 12 + entry.depth * 16 }}
                >
                  <Folder size={13} className="shrink-0 text-ink-faint" />
                  {entry.path ? entry.path.split('/').pop() : '(racine)'}
                </button>
              </li>
            )
          })}
        </ul>
      ) : null}
      <span className="text-xs text-ink-faint">
        S’exécutera dans <code className="font-mono">&lt;worktree&gt;{shown ? `/${shown}` : ''}</code> : le worktree de la conversation d’où l’on clique, ou la racine du projet.
      </span>
      <Problem text={problem} />
    </div>
  )
}

function UrlField({ draft, set, problem }: { draft: ActionDraft; set: (patch: Partial<ActionDraft>) => void; problem?: string }) {
  const resolved = resolveActionUrl(draft.url.trim() || null, [5173])
  const local = /\/\/(localhost|127\.0\.0\.1)\b/.test(draft.url)
  return (
    <label className="flex flex-col gap-1.5">
      <FieldLabel hint="facultatif">Lien quand il tourne</FieldLabel>
      <input
        value={draft.url}
        onChange={(event) => set({ url: event.target.value })}
        placeholder="http://mon-hote:{port}"
        spellCheck={false}
        className="rounded-lg border border-line bg-canvas px-3 py-1.5 font-mono text-sm outline-none focus:border-accent"
      />
      <span className="text-xs text-ink-faint">
        <code className="font-mono">{'{port}'}</code> devient le premier port sur lequel il écoute.
        {resolved ? <> Exemple : <span className="font-mono text-ink-soft">{resolved}</span></> : null}
      </span>
      {local && soleraIsRemote() ? (
        <span className="flex items-start gap-1.5 rounded-md bg-caution/10 px-2.5 py-1.5 text-xs text-caution">
          <TriangleAlert size={13} className="mt-px shrink-0" />
          Solera est ouvert depuis {window.location.hostname} : « localhost » désignerait ton appareil, pas la machine où tourne le service.
        </span>
      ) : null}
      <Problem text={problem} />
    </label>
  )
}

function LabelFields({ draft, set, problem }: { draft: ActionDraft; set: (patch: Partial<ActionDraft>) => void; problem?: string }) {
  const left = MAX_ACTION_LABEL_CHARS - draft.label.length
  return (
    <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
      <label className="flex flex-col gap-1.5">
        <FieldLabel hint={<span className={cx('tabular-nums', left < 0 && 'text-critical')}>{left}</span>}>Libellé</FieldLabel>
        <input
          value={draft.label}
          onChange={(event) => set({ label: event.target.value })}
          placeholder="Serveur de dev"
          className="rounded-lg border border-line bg-canvas px-3 py-1.5 text-sm outline-none focus:border-accent"
        />
        <Problem text={problem} />
      </label>
      <label className="flex flex-col gap-1.5">
        <FieldLabel hint="facultatif">Description</FieldLabel>
        <input
          value={draft.description}
          onChange={(event) => set({ description: event.target.value })}
          placeholder="Une phrase, montrée sous le libellé"
          className="rounded-lg border border-line bg-canvas px-3 py-1.5 text-sm outline-none focus:border-accent"
        />
      </label>
    </div>
  )
}

/** Le bouton tel qu'il apparaîtra dans le lanceur ⚡. */
function Preview({ draft }: { draft: ActionDraft }) {
  return (
    <div className="flex flex-col gap-1.5">
      <FieldLabel hint="dans le lanceur ⚡">Aperçu</FieldLabel>
      <div className="flex items-center gap-3 rounded-lg border border-line px-3 py-2.5">
        <span className="grid size-8 shrink-0 place-items-center rounded-md bg-surface-high text-ink-faint">
          {draft.kind === 'service' ? <Loop size={15} /> : <SquareTerminal size={15} />}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-medium">{draft.label || 'Sans libellé'}</span>
          <span className="truncate text-xs text-ink-faint">{draft.description || (draft.kind === 'service' ? 'Arrêté' : 'Pas encore lancée')}</span>
        </span>
        <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-accent px-2 py-1 text-xs text-accent-ink">
          <Play size={12} /> Lancer
        </span>
      </div>
    </div>
  )
}

function TryRun({ draft, disabled }: { draft: ActionDraft; disabled: boolean }) {
  const [lines, setLines] = useState<string[] | null>(null)
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Button size="sm" variant="secondary" icon={<Play size={14} />} disabled={disabled} onClick={() => setLines(fakeOutput(draft))}>
          Essayer
        </Button>
        <span className="text-xs text-ink-faint">Lance la commande une fois, à la racine du projet, avant d’enregistrer. <span className="text-fuchsia-600 dark:text-fuchsia-300">Simulé.</span></span>
      </div>
      {lines ? (
        <pre className="max-h-40 overflow-auto rounded-lg bg-[#0b0d1c] px-3 py-2 font-mono text-xs leading-relaxed text-[#cfd3e6]">
          {lines.join('\n')}
        </pre>
      ) : null}
    </div>
  )
}
