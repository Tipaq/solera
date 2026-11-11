/* PROTOTYPE — jetable (branche proto/page-projet). Ne pas fusionner dans main.
 *
 * Réglages › Actions : toutes les actions du projet au même endroit, groupées par ce
 * qu'elles demandent — à relire, services, tâches —, avec leurs gestes. Les vraies
 * viennent de `/api/actions` ; `?demo=1` charge un jeu de même forme. Aucune écriture :
 * lancer, arrêter, enregistrer, supprimer sont simulés.
 */
import {
  ArrowUpRight,
  Bot,
  ChevronDown,
  Copy,
  Infinity as Loop,
  Pencil,
  Play,
  Plus,
  RotateCw,
  ShieldCheck,
  Square,
  SquareTerminal,
  Trash2,
} from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { ProjectActionDto } from '@solera/protocol'
import { Button, cx } from '@solera/ui'
import { actionView, useActions } from '../../lib/actions'
import { elapsed } from '../../lib/dates'
import { useWorktrees } from '../../lib/worktrees'
import { ActionEditor, type EditorVariant } from './ActionEditor'
import { DEMO_PREVIOUS_COMMAND, demoActions, draftOf, groupOf, stateOf, type ActionDraft, type ActionGroup, type Tone } from './data'

const GROUPS: { key: ActionGroup; title: string; hint: string }[] = [
  { key: 'review', title: 'À relire', hint: 'Écrites ou modifiées par un agent : relis la commande avant le premier lancement d’un clic.' },
  { key: 'service', title: 'Services', hint: 'Tournent en continu sous systemd, même Solera fermé. Visibles aussi dans Services.' },
  { key: 'task', title: 'Tâches', hint: 'Se terminent dans un terminal du panneau. Leur dernier passage reste visible tant que l’onglet du terminal est ouvert.' },
]

const DOT: Record<Tone, string> = {
  positive: 'bg-positive',
  critical: 'bg-critical',
  caution: 'bg-caution',
  neutral: 'bg-line-strong',
}

const TEXT: Record<Tone, string> = {
  positive: 'text-positive',
  critical: 'text-critical',
  caution: 'text-caution',
  neutral: 'text-ink-faint',
}

type Editing = { mode: 'new' } | { mode: 'edit'; action: ProjectActionDto } | { mode: 'copy'; action: ProjectActionDto } | null

export function ActionsSection({ projectId }: { projectId: string }) {
  const [params] = useSearchParams()
  const demo = params.get('demo') === '1'
  const { data } = useActions()
  const [variant, setVariant] = useState<EditorVariant>('formulaire')
  const [editing, setEditing] = useState<Editing>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)

  const actions = demo ? demoActions(projectId) : (data ?? []).filter((action) => action.projectId === projectId)
  const stub = (text: string) => {
    setNotice(`Simulé : ${text}`)
    window.setTimeout(() => setNotice(null), 3500)
  }

  const running = actions.filter((action) => action.kind === 'service' && actionView(action).live).length

  return (
    <div className="flex flex-col gap-6">
      {/* Ce qu'est une action, une fois, en tête : la section sert aussi à le découvrir. */}
      <div className="flex flex-col gap-3 rounded-xl border border-line px-4 py-3.5 sm:flex-row sm:items-center">
        <p className="min-w-0 flex-1 text-sm text-ink-soft">
          Des raccourcis : un clic lance une commande dans le worktree de la conversation d’où tu cliques, ou à la racine du projet.
          On les lance aussi depuis le lanceur ⚡ de la bande, et <span className="inline-flex items-center gap-1"><Bot size={13} /> les agents peuvent les lancer</span> de leur session.
        </p>
        <div className="flex shrink-0 items-center gap-2">
          <span className="text-xs text-ink-faint">Ajout :</span>
          <span className="inline-flex rounded-lg border border-line p-0.5 text-xs">
            {(['formulaire', 'assistant'] as const).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setVariant(key)}
                className={cx('rounded-md px-2 py-1', variant === key ? 'bg-surface-high text-ink' : 'text-ink-faint hover:text-ink')}
              >
                {key}
              </button>
            ))}
          </span>
          <Button size="sm" icon={<Plus size={14} />} onClick={() => setEditing({ mode: 'new' })}>Action</Button>
        </div>
      </div>

      <p className="-mt-3 text-xs text-ink-faint">
        {actions.length} action{actions.length > 1 ? 's' : ''} · {running} service{running > 1 ? 's' : ''} en marche
        {demo ? <span className="ml-2 text-fuchsia-600 dark:text-fuchsia-300">données de démo</span> : null}
      </p>

      {actions.length === 0 ? (
        <div className="flex flex-col items-start gap-2 rounded-xl border border-dashed border-line px-4 py-6">
          <p className="text-sm">Aucune action dans ce projet.</p>
          <p className="text-sm text-ink-faint">Pars d’un script du dépôt : le dialogue d’ajout en propose. Ou demande à un agent « ajoute un bouton pour lancer le serveur ».</p>
          <Button size="sm" variant="secondary" icon={<Plus size={14} />} onClick={() => setEditing({ mode: 'new' })}>Ajouter une action</Button>
        </div>
      ) : (
        GROUPS.map((group) => {
          const items = actions.filter((action) => groupOf(action) === group.key)
          if (items.length === 0) return null
          return (
            <section key={group.key} className="flex flex-col gap-2">
              <header className="flex items-baseline gap-2">
                <h2 className={cx('text-sm font-semibold', group.key === 'review' && 'text-caution')}>{group.title}</h2>
                <span className="text-xs text-ink-faint tabular-nums">{items.length}</span>
              </header>
              <p className="-mt-1 text-xs text-ink-faint">{group.hint}</p>
              <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line">
                {items.map((action) => (
                  <ActionRow
                    key={action.id}
                    projectId={projectId}
                    demo={demo}
                    action={action}
                    open={open === action.id}
                    onToggle={() => setOpen(open === action.id ? null : action.id)}
                    onEdit={() => setEditing({ mode: 'edit', action })}
                    onCopy={() => setEditing({ mode: 'copy', action })}
                    stub={stub}
                  />
                ))}
              </ul>
            </section>
          )
        })
      )}

      {notice ? (
        <div role="status" className="fixed bottom-24 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-ink px-3 py-2 text-sm text-canvas shadow-pop">{notice}</div>
      ) : null}

      {editing ? (
        <ActionEditor
          variant={variant}
          editing={editing.mode === 'edit'}
          initial={editing.mode === 'new' ? undefined : copyOf(editing)}
          onClose={() => setEditing(null)}
          onSaved={(draft: ActionDraft) => {
            setEditing(null)
            stub(`« ${draft.label} » enregistrée (${draft.kind === 'service' ? 'service' : 'tâche'})`)
          }}
        />
      ) : null}
    </div>
  )
}

function copyOf(editing: Exclude<Editing, { mode: 'new' } | null>): ActionDraft {
  const draft = draftOf(editing.action)
  return editing.mode === 'copy' ? { ...draft, label: `${draft.label} (copie)`.slice(0, 60) } : draft
}

function ActionRow({
  projectId,
  demo,
  action,
  open,
  onToggle,
  onEdit,
  onCopy,
  stub,
}: {
  projectId: string
  demo: boolean
  action: ProjectActionDto
  open: boolean
  onToggle: () => void
  onEdit: () => void
  onCopy: () => void
  stub: (text: string) => void
}) {
  const state = stateOf(action)
  const view = actionView(action)
  const proposed = action.status === 'proposed'
  const isService = action.kind === 'service'

  return (
    <li>
      <div className="flex items-start gap-3 px-4 py-3">
        <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-md bg-surface-high text-ink-faint">
          {isService ? <Loop size={15} /> : <SquareTerminal size={15} />}
        </span>

        <button type="button" onClick={onToggle} className="flex min-w-0 flex-1 flex-col gap-0.5 text-left">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-medium">{action.label}</span>
            <ChevronDown size={14} className={cx('shrink-0 text-ink-faint transition-transform', open && 'rotate-180')} />
          </span>
          {action.description ? <span className="truncate text-xs text-ink-soft">{action.description}</span> : null}
          <span className={cx('flex items-center gap-1.5 text-xs', TEXT[state.tone])}>
            <span className={cx('size-1.5 shrink-0 rounded-full', DOT[state.tone], state.live && 'animate-pulse')} />
            {state.text}
          </span>
        </button>

        <span className="flex shrink-0 items-center gap-1">
          {view.href ? (
            <a href={view.href} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-xs text-accent hover:bg-surface-high">
              Ouvrir <ArrowUpRight size={12} />
            </a>
          ) : null}
          {proposed ? (
            <Button size="sm" variant="secondary" icon={<ShieldCheck size={14} />} onClick={onToggle}>Relire</Button>
          ) : isService && state.live ? (
            <>
              <IconAction label="Relancer" onClick={() => stub(`relancer ${action.label}`)}><RotateCw size={14} /></IconAction>
              <IconAction label="Arrêter" onClick={() => stub(`arrêter ${action.label}`)}><Square size={14} /></IconAction>
            </>
          ) : (
            <LaunchMenu projectId={projectId} demo={demo} action={action} stub={stub} />
          )}
        </span>
      </div>

      {open ? (
        <div className="flex flex-col gap-3 border-t border-line bg-surface/40 px-4 py-3 pl-[3.75rem]">
          {proposed ? <Review action={action} /> : null}
          <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[7rem_minmax(0,1fr)]">
            <Fact term="Commande"><code className="font-mono text-xs break-all whitespace-pre-wrap">{action.command}</code></Fact>
            <Fact term="Dossier"><code className="font-mono text-xs">&lt;worktree&gt;{action.subdir ? `/${action.subdir}` : ''}</code></Fact>
            {isService ? <Fact term="Lien">{action.url ? <code className="font-mono text-xs">{action.url}</code> : <span className="text-ink-faint">aucun</span>}</Fact> : null}
            {action.service ? <Fact term="Unité"><code className="font-mono text-xs">{action.service.unit}</code></Fact> : null}
            <Fact term="Origine">
              {action.agentConversationTitle ? (
                <span className="inline-flex items-center gap-1"><Bot size={13} /> {proposed ? 'Proposée' : 'Écrite'} dans « {action.agentConversationTitle} »</span>
              ) : (
                <span>Créée depuis l’interface</span>
              )}
              <span className="text-ink-faint"> · modifiée il y a {elapsed(action.updatedAt)}</span>
            </Fact>
            <Fact term="Agents"><span className="inline-flex items-center gap-1 text-ink-soft"><Bot size={13} /> Peuvent la lancer de leur session (dans leur worktree)</span></Fact>
          </dl>
          <div className="flex flex-wrap gap-1.5">
            {proposed ? (
              <Button size="sm" icon={<ShieldCheck size={14} />} onClick={() => stub(`« ${action.label} » validée`)}>Valider la commande</Button>
            ) : null}
            <Button size="sm" variant="secondary" icon={<Pencil size={14} />} onClick={onEdit}>Modifier</Button>
            <Button size="sm" variant="ghost" icon={<Copy size={14} />} onClick={onCopy}>Dupliquer</Button>
            <Button
              size="sm"
              variant="ghost"
              icon={<Trash2 size={14} />}
              onClick={() => { if (window.confirm(`Supprimer « ${action.label} » ?${isService ? ' Son unité sera arrêtée.' : ''}`)) stub(`« ${action.label} » supprimée`) }}
            >
              Supprimer
            </Button>
          </div>
        </div>
      ) : null}
    </li>
  )
}

/** Ce qui a changé dans la commande, pour une action qu'un agent a écrite. */
function Review({ action }: { action: ProjectActionDto }) {
  const before = DEMO_PREVIOUS_COMMAND[action.id] ?? null
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-caution/40 bg-caution/5 px-3 py-2.5">
      <span className="text-xs font-medium text-caution">
        {before ? 'Commande modifiée par un agent' : 'Commande écrite par un agent'} — rien ne se lance d’un clic avant ta validation.
      </span>
      <pre className="overflow-x-auto font-mono text-xs leading-relaxed">
        {before ? <span className="block text-critical">- {before}</span> : null}
        <span className="block text-positive">+ {action.command}</span>
      </pre>
    </div>
  )
}

/** Lancer, en choisissant où : la racine du projet ou un worktree. */
function LaunchMenu({ projectId, demo, action, stub }: { projectId: string; demo: boolean; action: ProjectActionDto; stub: (text: string) => void }) {
  const [open, setOpen] = useState(false)
  const { data: trees } = useWorktrees(demo ? undefined : projectId)
  const places = demo
    ? ['feat/903-schema-des-jalons', 'feat/905-vue-horizon', 'fix/911-gantt-largeur']
    : (trees ?? []).map((tree) => tree.name)

  return (
    <span className="relative">
      <span className="inline-flex overflow-hidden rounded-md border border-line">
        <button type="button" onClick={() => stub(`lancer ${action.label} à la racine du projet`)} className="inline-flex h-8 items-center gap-1 px-2 text-xs hover:bg-surface-high">
          <Play size={13} /> Lancer
        </button>
        <button type="button" aria-label="Choisir où lancer" onClick={() => setOpen(!open)} className="grid h-8 w-6 place-items-center border-l border-line text-ink-faint hover:bg-surface-high">
          <ChevronDown size={13} />
        </button>
      </span>
      {open ? (
        <div className="absolute right-0 z-20 mt-1 w-64 rounded-lg border border-line bg-canvas p-1 shadow-pop" onMouseLeave={() => setOpen(false)}>
          <p className="px-2 py-1 text-meta tracking-wide text-ink-faint uppercase">Lancer dans</p>
          <button type="button" onClick={() => { setOpen(false); stub(`lancer ${action.label} à la racine`) }} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-surface-high">
            Racine du projet
          </button>
          {places.map((place) => (
            <button key={place} type="button" onClick={() => { setOpen(false); stub(`lancer ${action.label} dans ${place}`) }} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left font-mono text-xs hover:bg-surface-high">
              {place}
            </button>
          ))}
        </div>
      ) : null}
    </span>
  )
}

function IconAction({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" title={`${label} (simulé)`} aria-label={label} onClick={onClick} className="grid size-8 place-items-center rounded-md text-ink-faint hover:bg-surface-high hover:text-ink">
      {children}
    </button>
  )
}

function Fact({ term, children }: { term: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-xs text-ink-faint sm:pt-0.5">{term}</dt>
      <dd className="min-w-0">{children}</dd>
    </>
  )
}
