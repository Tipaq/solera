/* PROTOTYPE — jetable (branche proto/page-projet). Ne pas fusionner dans main.
 *
 * La ligne d'outils de l'onglet Git du panneau : « Affichage ▾ » (les destinations de
 * l'ancien rail, avec leurs comptes), un repère ambre quand il y a des conflits, puis
 * les gestes du dépôt — annuler, refaire, tirer, pousser, récupérer, brancher, remiser,
 * dépiler, relire. Ces gestes sont **ceux du vrai panneau** (`useGitActions`), inchangés :
 * ils écrivent dans le dépôt comme aujourd'hui.
 */
import { useState, type ReactNode } from 'react'
import {
  AlertTriangle,
  Archive,
  ArchiveRestore,
  ArrowDown,
  ArrowUp,
  FilePen,
  GitBranch,
  GitMerge,
  History,
  Redo2,
  RefreshCw,
  Search,
  Undo2,
} from 'lucide-react'
import type { GitStateDto } from '@solera/protocol'
import { Popover, cx } from '@solera/ui'
import { useTranslate } from '../../../lib/i18n'
import { useGitActions } from '../../panel/git/actions'
import { NameDialog } from '../../panel/git/menus'
import type { Destination } from '../../panel/git/rail'
import { toolbarButtonClass } from '../ViewSwitch'

const DESTINATIONS: { key: Destination; label: string; icon: ReactNode; hint: string }[] = [
  { key: 'graph', label: 'Graphe', icon: <GitMerge size={15} />, hint: 'Les commits et leurs branches' },
  { key: 'working', label: 'En cours', icon: <FilePen size={15} />, hint: 'Ce qui n’est pas commité' },
  { key: 'branches', label: 'Branches', icon: <GitBranch size={15} />, hint: 'Locales, distantes, worktrees' },
  { key: 'stashes', label: 'Remises', icon: <Archive size={15} />, hint: 'Le travail mis de côté' },
  { key: 'search', label: 'Recherche', icon: <Search size={15} />, hint: 'Dans les messages et les auteurs' },
  { key: 'history', label: 'Historique d’un fichier', icon: <History size={15} />, hint: 'Ses versions et son blâme' },
]

export function GitLine({
  state,
  stashes,
  destination,
  counts,
  conflicted,
  onDestination,
  onRefresh,
  refreshing,
}: {
  state: GitStateDto | undefined
  stashes: number
  destination: Destination
  counts: Partial<Record<Destination, number>>
  conflicted: number
  onDestination: (next: Destination) => void
  onRefresh: () => void
  refreshing: boolean
}) {
  const t = useTranslate()
  const { run, undo, redo, lock, pending } = useGitActions()
  const [open, setOpen] = useState(false)
  const [naming, setNaming] = useState(false)
  const frozen = !!lock || pending
  const ahead = state?.ahead ?? 0
  const behind = state?.behind ?? 0
  const current =
    destination === 'conflicts'
      ? { label: 'Conflits', icon: <AlertTriangle size={15} /> }
      : (DESTINATIONS.find((entry) => entry.key === destination) ?? DESTINATIONS[0]!)

  return (
    <div className="@container flex h-12 shrink-0 items-center gap-1.5 border-b border-line px-3">
      {/* Le squelette commun (PanelTabFrame) : le titre de l'onglet et sa branche en
          méta à gauche, puis la vue choisie, puis les gestes du dépôt. */}
      <span className="hidden min-w-0 shrink items-baseline gap-1.5 @min-[26rem]:flex">
        <span className="text-sm font-medium text-ink">Git</span>
        {state?.branch ? <span className="max-w-[10rem] truncate font-mono text-xs text-ink-faint">{state.branch}</span> : null}
      </span>
      <Popover
        open={open}
        onOpenChange={setOpen}
        label="Affichage"
        side="bottom"
        align="start"
        className="w-72"
        trigger={
          <button type="button" className={toolbarButtonClass(false)} title={`Affichage : ${current.label}`}>
            {current.icon}
            <span className="hidden max-w-[9rem] truncate @min-[20rem]:inline">{current.label}</span>
            <span aria-hidden className="text-ink-faint">▾</span>
          </button>
        }
      >
        <ul className="flex flex-col p-1.5">
          {DESTINATIONS.map((entry) => {
            const active = entry.key === destination
            const count = counts[entry.key]
            return (
              <li key={entry.key}>
                <button
                  type="button"
                  aria-pressed={active}
                  onClick={() => {
                    onDestination(entry.key)
                    setOpen(false)
                  }}
                  className={cx(
                    'flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors',
                    active ? 'bg-accent-wash/50 text-ink' : 'text-ink-soft hover:bg-surface-high hover:text-ink',
                  )}
                >
                  <span className={cx('shrink-0', active ? 'text-accent' : 'text-ink-faint')}>{entry.icon}</span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className={cx('text-sm', active && 'font-medium')}>{entry.label}</span>
                    <span className="truncate text-xs text-ink-faint">{entry.hint}</span>
                  </span>
                  {count ? <span className="shrink-0 text-xs tabular-nums text-ink-faint">{count}</span> : null}
                </button>
              </li>
            )
          })}
        </ul>
      </Popover>

      {/* La destination Conflits n'existe que pendant un conflit : un repère ambre sur la
          ligne, qui y mène, plutôt qu'une entrée de menu qu'on ne verrait pas. */}
      {conflicted > 0 ? (
        <button
          type="button"
          onClick={() => onDestination('conflicts')}
          className={cx(
            'inline-flex h-11 shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-xs md:h-9 pointer-coarse:h-11',
            destination === 'conflicts' ? 'border-caution bg-caution/15 text-caution' : 'border-caution/50 text-caution hover:bg-caution/10',
          )}
        >
          <AlertTriangle size={14} /> {conflicted} conflit{conflicted > 1 ? 's' : ''}
        </button>
      ) : null}

      <span className="flex-1" />

      <Gesture icon={<Undo2 size={14} />} label={t('git.toolbar.undo')} disabled={frozen || !state?.undo} onClick={undo} />
      <Gesture icon={<Redo2 size={14} />} label={t('git.toolbar.redo')} disabled={frozen || !state?.redo} onClick={redo} />
      <span aria-hidden className="mx-0.5 h-4 w-px shrink-0 bg-line" />
      <Gesture icon={<ArrowDown size={14} />} label={t('git.toolbar.pull')} labelled badge={behind} disabled={frozen} onClick={() => run({ kind: 'pull' })} />
      <Gesture
        icon={<ArrowUp size={14} />}
        label={t('git.toolbar.push')}
        labelled
        badge={ahead}
        primary={ahead > 0}
        disabled={frozen}
        onClick={() => run({ kind: 'push', force: false, branch: null })}
      />
      <Gesture icon={<RefreshCw size={14} />} label={t('git.toolbar.fetch')} disabled={frozen} onClick={() => run({ kind: 'fetch' })} />
      <span aria-hidden className="mx-0.5 hidden h-4 w-px shrink-0 bg-line @min-[30rem]:block" />
      <span className="hidden items-center gap-1 @min-[30rem]:flex">
        <Gesture icon={<GitBranch size={14} />} label={t('git.toolbar.branch')} disabled={frozen} onClick={() => setNaming(true)} />
        <Gesture icon={<Archive size={14} />} label={t('git.toolbar.stash')} disabled={frozen} onClick={() => run({ kind: 'stash-push', message: '' })} />
        <Gesture
          icon={<ArchiveRestore size={14} />}
          label={t('git.toolbar.pop')}
          disabled={frozen || stashes === 0}
          onClick={() => run({ kind: 'stash-pop', index: 0, hash: null })}
        />
      </span>
      <Gesture icon={<RefreshCw size={14} className={cx(refreshing && 'animate-spin')} />} label={t('git.toolbar.refresh')} disabled={false} onClick={onRefresh} />

      {naming ? (
        <NameDialog
          title={t('git.toolbar.branch')}
          label={t('git.menu.branchName')}
          onClose={() => setNaming(false)}
          onConfirm={(name) => {
            setNaming(false)
            run({ kind: 'branch-create', name, from: null, checkout: true })
          }}
        />
      ) : null}
    </div>
  )
}

/** Un geste du dépôt, à la hauteur des autres contrôles (`Button size="sm"`). */
function Gesture({ icon, label, labelled = false, badge = 0, primary = false, disabled, onClick }: {
  icon: ReactNode
  label: string
  labelled?: boolean
  badge?: number
  primary?: boolean
  disabled: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={cx(
        'inline-flex h-11 min-w-9 shrink-0 items-center justify-center gap-1.5 rounded-md px-2 text-xs font-medium disabled:opacity-40 md:h-9 pointer-coarse:h-11',
        primary && !disabled ? 'bg-accent text-on-accent' : 'text-ink-soft hover:bg-surface-high hover:text-ink',
      )}
    >
      {icon}
      {labelled ? <span className="hidden @min-[36rem]:inline">{label}</span> : null}
      {badge > 0 ? (
        <span className={cx('rounded-full px-1 text-micro tabular-nums', primary && !disabled ? 'bg-on-accent/20' : 'bg-surface-high text-ink-faint')}>{badge}</span>
      ) : null}
    </button>
  )
}
