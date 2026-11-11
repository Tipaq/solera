/* PROTOTYPE — jetable (branche proto/page-projet). Ne pas fusionner dans main.
 *
 * **Quelle version sert chaque service.** Côté serveur (`apps/server/src/actions/actions.ts`),
 * un service est **une unité systemd par action**, démarrée dans le worktree de la
 * conversation d'où l'on clique (sinon la racine) + son sous-dossier. S'il tourne déjà, un
 * clic depuis un autre worktree **rend l'existant tel quel**, sans le dire : le serveur de
 * dev continue de servir la branche d'où il a été lancé la première fois.
 *
 * Ici : on déduit du `cwd` du service (`ProjectActionServiceState.cwd`, aussi dans
 * `/api/services`) le worktree, sa branche, son état sur la base ; on le montre partout
 * (tuile, ligne, détail, et une marque « ⚡ :5173 » sur l'arbre dans Travail) ; et un
 * lancement depuis un autre worktree demande s'il faut **basculer** au lieu de se taire.
 * Le commit n'est pas lisible depuis le client : connu en démo seulement. Tout est simulé.
 *
 * Exporté pour le panneau d'une conversation, qui pourra réutiliser `ServedLine`,
 * `ServedBlock`, `SwitchServiceDialog` et `useServiceSwitch`.
 */
import { ArrowDown, ArrowUp, ArrowUpRight, GitBranch, Repeat, Zap } from 'lucide-react'
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { ConfirmDialog, Menu, MenuItem, MenuLabel, cx } from '@solera/ui'
import { useProjects } from '../../lib/projects'
import { useCodeData, type TreeRow } from '../prototype-code/data'
import { useAutomations, type Automation } from './model'

/** Ce qu'un service en marche sert : l'arbre de travail, HMR compris. */
export interface ServedVersion {
  automationId: string
  label: string
  ports: number[]
  href: string | null
  cwd: string
  /** L'arbre qui contient le `cwd`, ou null s'il n'est pas reconnu. */
  tree: TreeRow | null
  branch: string | null
  /** Commit court. Null hors démo : le client ne lit pas le HEAD d'un dossier. */
  commit: string | null
  ahead: number
  behind: number
  uncommitted: number
}

export interface ServedIndex {
  demo: boolean
  base: string | null
  trees: TreeRow[]
  byAutomation: Map<string, ServedVersion>
  /** Les services qui servent un arbre, par clé d'arbre. */
  byTree: Map<string, ServedVersion[]>
}

const EMPTY: ServedIndex = { demo: false, base: null, trees: [], byAutomation: new Map(), byTree: new Map() }

/** Ramène `~` et les barres finales à une forme comparable. */
function norm(path: string, home: string | null): string {
  let out = path.trim().replace(/\/+$/, '')
  if (home && out.startsWith('~')) out = home + out.slice(1)
  return out
}

/** L'arbre le plus profond qui contient `cwd` (un sous-dossier compte). */
function treeOf(cwd: string, trees: TreeRow[], rootPath: string | null): TreeRow | null {
  const home = rootPath && rootPath.startsWith('/') ? rootPath.split('/').slice(0, 3).join('/') : null
  const target = norm(cwd, home)
  let best: TreeRow | null = null
  let bestLength = -1
  for (const tree of trees) {
    // Les chemins de démo sont relatifs à la racine (`.worktrees/…`).
    const base = tree.path.startsWith('.') && rootPath ? `${norm(rootPath, home)}/${tree.path}` : norm(tree.path, home)
    if ((target === base || target.startsWith(`${base}/`)) && base.length > bestLength) {
      best = tree
      bestLength = base.length
    }
  }
  return best
}

/** Démo : le serveur de dev sert `feat/905-vue-horizon` (2 non commités, 3 derrière main). */
const DEMO_SERVED: Record<string, { branch: string; commit: string }> = {
  'demo-dev': { branch: 'feat/905-vue-horizon', commit: 'a1b2c3d' },
}

export function useServedIndex(projectId: string | undefined): ServedIndex {
  const { data: projects } = useProjects()
  const project = projects?.find((entry) => entry.id === projectId)
  const code = useCodeData(projectId, project)
  const { items, demo } = useAutomations(projectId)

  return useMemo(() => {
    if (!projectId) return EMPTY
    const rootPath = demo ? '~/projects/solera' : (project?.workspacePath ?? null)
    const byAutomation = new Map<string, ServedVersion>()
    const byTree = new Map<string, ServedVersion[]>()
    for (const item of items) {
      const service = item.action?.service
      if (item.commandKind !== 'service' || !service || item.live?.kind !== 'service') continue
      const pinned = demo && item.action ? DEMO_SERVED[item.action.id] : undefined
      const tree = pinned
        ? code.trees.find((entry) => entry.branch === pinned.branch) ?? null
        : service.cwd ? treeOf(service.cwd, code.trees, rootPath) : null
      const served: ServedVersion = {
        automationId: item.id,
        label: item.label,
        ports: service.ports,
        href: item.live.href,
        cwd: pinned && tree ? `${rootPath}/${tree.path}${item.subdir ? `/${item.subdir}` : ''}` : (service.cwd ?? '?'),
        tree,
        branch: tree?.branch ?? null,
        commit: pinned?.commit ?? null,
        ahead: tree?.ahead ?? 0,
        behind: tree?.behind ?? 0,
        uncommitted: tree?.uncommitted ?? 0,
      }
      byAutomation.set(item.id, served)
      if (tree) byTree.set(tree.key, [...(byTree.get(tree.key) ?? []), served])
    }
    return { demo, base: code.base ?? 'main', trees: code.trees, byAutomation, byTree }
  }, [projectId, items, demo, code.trees, code.base, project?.workspacePath])
}

/* ------------------------------------------------------------------ contexte */

const ServedContext = createContext<ServedIndex | null>(null)

/** Posé par la page (onglet Actions) : les tuiles, lignes et le détail le lisent. */
export function ServedProvider({ projectId, children }: { projectId: string; children: ReactNode }) {
  const index = useServedIndex(projectId)
  return <ServedContext.Provider value={index}>{children}</ServedContext.Provider>
}

export function useServedOf(item: Automation): ServedVersion | null {
  return useContext(ServedContext)?.byAutomation.get(item.id) ?? null
}

export function useServedContext(): ServedIndex | null {
  return useContext(ServedContext)
}

/* ------------------------------------------------------------------ rendus */

const shortBranch = (branch: string) => (branch.length > 28 ? `${branch.slice(0, 27)}…` : branch)

/** « sert `feat/905-vue-horizon` @ a1b2c3d · ↓3 · 2 non commités » — tuile, ligne, panneau. */
export function ServedLine({ served, className }: { served: ServedVersion; className?: string }) {
  const where = served.tree?.root ? `la racine (${served.branch ?? '?'})` : served.branch
  return (
    <span className={cx('inline-flex min-w-0 items-center gap-1.5 text-xs text-ink-faint', className)} title={served.cwd}>
      <GitBranch size={11} className="shrink-0" />
      <span className="shrink-0">sert</span>
      <code className="min-w-0 truncate font-mono text-[11px] text-ink-soft">{where ? shortBranch(where) : 'un dossier inconnu'}</code>
      {served.commit ? <code className="shrink-0 font-mono text-[11px]">@ {served.commit}</code> : null}
      {served.behind > 0 ? <span className="inline-flex shrink-0 items-center tabular-nums"><ArrowDown size={10} />{served.behind}</span> : null}
      {served.uncommitted > 0 ? <span className="shrink-0 tabular-nums text-caution" title="Fichiers non commités : c'est l'arbre de travail qui est servi">●{served.uncommitted}</span> : null}
    </span>
  )
}

/** Le bloc « Ce qu'il sert » du détail d'un service en marche. */
export function ServedBlock({ projectId, served, onSwitch }: { projectId: string; served: ServedVersion; onSwitch: (tree: TreeRow) => void }) {
  const index = useServedContext()
  const tree = served.tree
  const others = (index?.trees ?? []).filter((entry) => entry.key !== tree?.key && entry.state !== 'missing' && entry.state !== 'merged').slice(0, 8)
  return (
    <div className="flex flex-col gap-2.5">
      <dl className="grid grid-cols-[7rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-sm">
        <dt className="text-ink-faint">Arbre</dt>
        <dd className="min-w-0">
          {tree ? (
            <Link to={`/p/${projectId}/travail?arbre=${encodeURIComponent(tree.key)}`} className="inline-flex max-w-full items-center gap-1 text-ink hover:underline">
              <span className="truncate">{tree.root ? 'Racine du projet' : tree.name}</span> <ArrowUpRight size={12} className="shrink-0" />
            </Link>
          ) : (
            <span className="text-ink-faint">non reconnu</span>
          )}
          <code className="block truncate font-mono text-[11px] text-ink-faint" title={served.cwd}>{served.cwd}</code>
        </dd>
        <dt className="text-ink-faint">Branche</dt>
        <dd className="min-w-0"><code className="truncate font-mono text-xs text-ink">{served.branch ?? '—'}</code></dd>
        <dt className="text-ink-faint">Commit</dt>
        <dd>
          {served.commit ? <code className="font-mono text-xs text-ink">{served.commit}</code> : <span className="text-xs text-ink-faint">non lu (le serveur ne le donne pas encore)</span>}
        </dd>
        <dt className="text-ink-faint">Sur {index?.base ?? 'la base'}</dt>
        <dd className="inline-flex items-center gap-3 text-xs tabular-nums text-ink-soft">
          <span className="inline-flex items-center"><ArrowUp size={11} />{served.ahead} en avance</span>
          <span className="inline-flex items-center"><ArrowDown size={11} />{served.behind} en retard</span>
        </dd>
        <dt className="text-ink-faint">Non commités</dt>
        <dd className={cx('text-xs', served.uncommitted > 0 ? 'text-caution' : 'text-ink-faint')}>
          {served.uncommitted > 0 ? `${served.uncommitted} fichier${served.uncommitted > 1 ? 's' : ''} — servis tels quels (HMR)` : 'aucun'}
        </dd>
        {tree?.card ? (
          <>
            <dt className="text-ink-faint">Carte</dt>
            <dd className="min-w-0 truncate text-xs text-ink-soft">
              #{tree.card.number} {tree.card.title}
              {tree.card.milestone ? <span className="text-ink-faint"> · Jalon #{tree.card.milestone.number}</span> : null}
            </dd>
          </>
        ) : null}
      </dl>
      {others.length ? (
        <Menu
          trigger={
            <button type="button" className="inline-flex h-9 w-fit items-center gap-1.5 rounded-md border border-line px-2.5 text-xs text-ink-soft transition-colors hover:bg-surface-high hover:text-ink">
              <Repeat size={12} /> Servir une autre branche…
            </button>
          }
        >
          <MenuLabel>Basculer sur</MenuLabel>
          {others.map((entry) => (
            <MenuItem key={entry.key} onSelect={() => onSwitch(entry)}>
              <span className="truncate font-mono text-xs">{entry.root ? `racine (${entry.branch ?? '?'})` : entry.branch ?? entry.name}</span>
            </MenuItem>
          ))}
        </Menu>
      ) : null}
    </div>
  )
}

/* ------------------------------------------------------------------ basculer */

export interface SwitchRequest {
  served: ServedVersion
  to: { name: string; branch: string | null }
}

/**
 * Lancer un service déjà en marche depuis un autre worktree : on ne se tait plus. Le
 * dialogue propose de basculer (il redémarre) ou d'ouvrir celui qui tourne.
 */
export function useServiceSwitch(simulate: (text: string) => void) {
  const [request, setRequest] = useState<SwitchRequest | null>(null)
  const ask = (served: ServedVersion, to: { name: string; branch: string | null }) => setRequest({ served, to })
  const dialog = <SwitchServiceDialog request={request} onClose={() => setRequest(null)} simulate={simulate} />
  return { ask, dialog }
}

export function SwitchServiceDialog({ request, onClose, simulate }: { request: SwitchRequest | null; onClose: () => void; simulate: (text: string) => void }) {
  const from = request?.served
  const toName = request ? request.to.branch ?? request.to.name : ''
  return (
    <ConfirmDialog
      open={request !== null}
      onOpenChange={(open) => (open ? null : onClose())}
      title={from ? `« ${from.label} » sert déjà ${from.branch ?? 'un autre dossier'}` : ''}
      confirmLabel={`Basculer sur ${toName}`}
      onConfirm={() => {
        if (from) simulate(`basculer « ${from.label} » sur ${toName} : l'unité redémarre dans ce worktree`)
        onClose()
      }}
    >
      {from ? (
        <div className="flex flex-col gap-3 text-sm text-ink-soft">
          <p>
            Il tourne depuis <code className="font-mono text-xs text-ink">{from.branch ?? from.cwd}</code>
            {from.ports.length ? <> sur <span className="tabular-nums">:{from.ports.join(' :')}</span></> : null}. Le basculer sur{' '}
            <code className="font-mono text-xs text-ink">{toName}</code> le <strong className="font-medium text-ink">redémarre</strong> dans ce worktree : ce que tu as ouvert dans le navigateur se recharge.
          </p>
          {from.href ? (
            <a href={from.href} target="_blank" rel="noreferrer" onClick={onClose} className="inline-flex w-fit items-center gap-1 text-xs text-accent hover:underline">
              Ouvrir plutôt celui qui tourne <ArrowUpRight size={12} />
            </a>
          ) : null}
          <p className="rounded-md bg-fuchsia-500/10 px-2.5 py-1.5 text-xs text-fuchsia-700 dark:text-fuchsia-300">
            Simulé. Aujourd'hui le serveur rend l'existant tel quel, sans rien dire.
          </p>
        </div>
      ) : null}
    </ConfirmDialog>
  )
}

/* ------------------------------------------------------------------ Travail */

/**
 * La marque « ⚡ :5173 » posée sur un arbre servi par un service, dans Travail. Elle mène
 * à l'action, ouverte dans l'onglet Actions. Lit le projet dans l'adresse.
 */
export function ServiceMark({ treeKey, className }: { treeKey: string; className?: string }) {
  const { projectId } = useParams()
  const [params] = useSearchParams()
  const index = useServedIndex(projectId)
  const served = index.byTree.get(treeKey)
  if (!projectId || !served?.length) return null
  const demo = params.get('demo') === '1' ? '&demo=1' : ''
  return (
    <>
      {served.map((entry) => (
        <Link
          key={entry.automationId}
          to={`/p/${projectId}/actions?action=${encodeURIComponent(entry.automationId)}${demo}`}
          onClick={(event) => event.stopPropagation()}
          title={`« ${entry.label} » sert cet arbre${entry.ports.length ? ` sur :${entry.ports.join(' :')}` : ''}`}
          className={cx(
            'inline-flex shrink-0 items-center gap-0.5 rounded-md border border-positive/40 px-1.5 py-px text-[11px] text-positive tabular-nums transition-colors hover:bg-positive/10',
            className,
          )}
        >
          <Zap size={10} /> {entry.ports.length ? `:${entry.ports[0]}` : entry.label}
        </Link>
      ))}
    </>
  )
}

/* ------------------------------------------------------------------ « Où tourne-t-il » */

export type ServicePlacement = 'follow' | 'root' | 'branch' | 'per-worktree'

const PLACEMENTS: { key: ServicePlacement; title: string; text: string; recommended?: boolean }[] = [
  {
    key: 'follow',
    title: 'Une seule instance, qu’on bascule',
    text: 'Il démarre là d’où on le lance. S’il tourne déjà ailleurs, Solera demande s’il faut le basculer (il redémarre) au lieu de garder l’ancien en silence.',
    recommended: true,
  },
  { key: 'root', title: 'Toujours la racine du projet', text: 'Où qu’on clique, il sert le dossier du projet, quelle que soit sa branche du moment.' },
  { key: 'branch', title: 'Toujours une branche', text: 'Fixé sur une branche, par exemple celle de dev.' },
  { key: 'per-worktree', title: 'Une instance par worktree', text: 'Chaque arbre a la sienne, sur son propre port.' },
]

/**
 * Le réglage d'un service : où il tourne. Aujourd'hui le serveur fait « là d'où on le
 * lance » et se tait s'il tourne déjà ailleurs ; le reste est à construire (simulé).
 */
export function PlacementField({ value, onChange, branch, onBranch, url }: {
  value: ServicePlacement
  onChange: (next: ServicePlacement) => void
  branch: string
  onBranch: (next: string) => void
  /** Le lien du service : une instance par worktree demande `{port}`. */
  url: string
}) {
  const { projectId } = useParams()
  const index = useServedIndex(projectId)
  const root = index.trees.find((tree) => tree.root)
  const branches = Array.from(new Set(index.trees.map((tree) => tree.branch).filter((entry): entry is string => Boolean(entry))))
  const rootOnBranch = root?.branch === branch
  return (
    <div className="flex flex-col gap-1.5" role="radiogroup" aria-label="Où tourne-t-il">
      {PLACEMENTS.map((option) => {
        const active = value === option.key
        return (
          <div key={option.key} className={cx('rounded-md border px-3 py-2 transition-colors', active ? 'border-accent/60 bg-accent/5' : 'border-line hover:border-line-strong')}>
            <button type="button" role="radio" aria-checked={active} onClick={() => onChange(option.key)} className="flex w-full items-start gap-2.5 text-left">
              <span className={cx('mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border', active ? 'border-accent' : 'border-line-strong')}>
                {active ? <span className="size-2 rounded-full bg-accent" /> : null}
              </span>
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="flex items-center gap-2 text-sm text-ink">
                  {option.title}
                  {option.recommended ? <span className="rounded bg-accent/15 px-1.5 py-px text-[11px] text-accent">conseillé</span> : null}
                </span>
                <span className="text-xs text-ink-faint">{option.text}</span>
              </span>
            </button>
            {active && option.key === 'branch' ? (
              <div className="mt-2 flex flex-col gap-1.5 pl-6.5">
                <select
                  value={branch}
                  onChange={(event) => onBranch(event.target.value)}
                  className="h-9 w-full max-w-xs rounded-md border border-line bg-canvas px-2 font-mono text-xs text-ink"
                >
                  {branches.length === 0 ? <option value={branch}>{branch}</option> : null}
                  {branches.map((entry) => <option key={entry} value={entry}>{entry}</option>)}
                </select>
                <span className="text-xs text-ink-faint">
                  {rootOnBranch
                    ? 'La racine est sur cette branche : il y tournera.'
                    : `La racine est sur ${root?.branch ?? 'une autre branche'} : il faudra un worktree dédié à ${branch}, que Solera garde à jour (à construire).`}
                </span>
              </div>
            ) : null}
            {active && option.key === 'per-worktree' ? (
              <p className="mt-2 pl-6.5 text-xs text-caution">
                Coût : un processus et un port par arbre ouvert (mémoire, CPU, un build de plus). La commande doit accepter un port libre
                {url.includes('{port}') ? '' : ', et le lien doit contenir {port}'}.
              </p>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}
