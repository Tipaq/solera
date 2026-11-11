import { useId, useState, type ReactNode } from 'react'
import {
  AlertTriangle,
  Archive,
  ArchiveRestore,
  ArrowDown,
  ArrowUp,
  CloudDownload,
  FilePen,
  GitBranch,
  GitMerge,
  History,
  MoreHorizontal,
  Redo2,
  RefreshCw,
  Search,
  Undo2,
  type LucideIcon,
} from 'lucide-react'
import type { GitStateDto } from '@solera/protocol'
import { Menu, MenuItem, MenuSeparator, PanelToolbar, Popover, cx, panelToolClass } from '@solera/ui'
import { useTranslate, type MessageKey } from '../../../lib/i18n'
import { useGitActions } from './actions'
import { NameDialog } from './menus'

/**
 * La ligne d'outils de l'onglet Git : le cadre commun du panneau (`PanelToolbar`), et
 * tout ce que l'onglet porte au-dessus du dépôt — sur **une seule ligne**.
 *
 * Elle remplace le rail vertical de destinations et la barre de gestes au-dessus, que
 * la carte #10 avait retenus (parti S2 du tour 2). La refonte de la page projet v2 les
 * réunit : pas de sous-navigation dans la navigation, et les 44 px du rail rendus au
 * graphe.
 *
 * - « Git » et la branche à gauche ;
 * - **Affichage ▾** choisit la destination, chacune avec ce qu'elle montre et son
 *   compte ;
 * - **Conflits** n'existe que pendant un conflit (planche T10) : un repère ambre sur
 *   la ligne, qui y mène, plutôt qu'une entrée de menu qu'on ne verrait pas ;
 * - les gestes du dépôt qui n'ont **pas d'objet à désigner** (règle T0 du tour 3) :
 *   annuler, refaire | tirer, pousser, récupérer | brancher, remiser, dépiler |
 *   relire. Tout ce qui porte sur *ce* commit ou *cette* branche vit dans le menu de
 *   l'objet (`menus.tsx`).
 *
 * **La ligne se replie, elle ne passe jamais à la ligne.** Le panneau ancré descend à
 * 20 rem, et les paliers sont mesurés pour que rien n'y déborde — ceux du prototype
 * (titre à 26 rem, gestes de remise à 30, libellés à 36) débordaient jusqu'à 40 px.
 * Ils portent sur la largeur utile de la ligne, son conteneur, marges ôtées ; au
 * téléphone (390 px), elle en a 22 :
 *
 * | à partir de | entre |
 * | --- | --- |
 * | — | l'icône d'Affichage, tirer, pousser, le repère de conflits en chiffre, « ⋯ » |
 * | 20 rem | le nom de la destination (26 rem pendant un conflit) |
 * | 22 rem | annuler, refaire |
 * | 26 rem | « Git » et la branche, récupérer |
 * | 38 rem | brancher, remiser, dépiler et relire, qui remplacent « ⋯ » ; « N conflits » en toutes lettres |
 * | 46 rem | les libellés de Tirer et Pousser, le nom de la destination en entier |
 *
 * **Rien ne se perd en se repliant** : « ⋯ » porte tous les gestes qui peuvent manquer
 * à la ligne, tant qu'il en manque un. Pendant un conflit, il reste aussi au large, à
 * la place de brancher, remiser et dépiler — git refuse de remiser et de dépiler, et
 * le repère ambre a besoin de la place.
 */
export type Destination =
  | 'graph'
  | 'working'
  | 'branches'
  | 'stashes'
  | 'search'
  | 'history'
  | 'conflicts'

const DESTINATIONS: { id: Exclude<Destination, 'conflicts'>; icon: LucideIcon; label: MessageKey; hint: MessageKey }[] = [
  { id: 'graph', icon: GitMerge, label: 'git.view.graph', hint: 'git.view.graph.hint' },
  { id: 'working', icon: FilePen, label: 'git.view.working', hint: 'git.view.working.hint' },
  { id: 'branches', icon: GitBranch, label: 'git.view.branches', hint: 'git.view.branches.hint' },
  { id: 'stashes', icon: Archive, label: 'git.view.stashes', hint: 'git.view.stashes.hint' },
  { id: 'search', icon: Search, label: 'git.view.search', hint: 'git.view.search.hint' },
  { id: 'history', icon: History, label: 'git.view.history', hint: 'git.view.history.hint' },
]

export function GitLine({
  state,
  destination,
  counts,
  onDestination,
  onRefresh,
  refreshing,
}: {
  state: GitStateDto | undefined
  destination: Destination
  /** Ce qui attend derrière une destination : fichiers sales, branches, remises. */
  counts: Partial<Record<Destination, number>>
  onDestination: (next: Destination) => void
  onRefresh: () => void
  refreshing: boolean
}) {
  const t = useTranslate()
  const { run, undo, redo, lock, pending } = useGitActions()
  const [open, setOpen] = useState(false)
  const [naming, setNaming] = useState(false)
  const hints = useId()

  const frozen = !!lock || pending
  const ahead = state?.ahead ?? 0
  const behind = state?.behind ?? 0
  const stashes = counts.stashes ?? 0
  const conflicted = state?.conflicted.length ?? 0
  const current =
    destination === 'conflicts'
      ? { icon: AlertTriangle, label: 'git.view.conflicts' as const }
      : (DESTINATIONS.find((entry) => entry.id === destination) ?? DESTINATIONS[0]!)
  const CurrentIcon = current.icon
  const viewLabel = t('git.view.current', { view: t(current.label) })
  const conflictsLabel = t(conflicted === 1 ? 'git.view.conflicts.one' : 'git.view.conflicts.many', { count: conflicted })

  /** Les gestes que la ligne peut replier : chacun sur la ligne, et dans « ⋯ ». */
  const fetching = { label: t('git.toolbar.fetch'), disabled: frozen, onClick: () => run({ kind: 'fetch' }) }
  const undoing = { label: t('git.toolbar.undo'), disabled: frozen || !state?.undo, onClick: undo }
  const redoing = { label: t('git.toolbar.redo'), disabled: frozen || !state?.redo, onClick: redo }
  const branching = { label: t('git.toolbar.branch'), disabled: frozen, onClick: () => setNaming(true) }
  const stashing = { label: t('git.toolbar.stash'), disabled: frozen, onClick: () => run({ kind: 'stash-push', message: '' }) }
  const popping = {
    label: t('git.toolbar.pop'),
    disabled: frozen || stashes === 0,
    // Sans sha : « celle du dessus, quelle qu'elle soit ». La liste des remises, elle,
    // désigne la sienne et la vérifie.
    onClick: () => run({ kind: 'stash-pop', index: 0, hash: null }),
  }
  const rereading = { label: t('git.toolbar.refresh'), disabled: false, onClick: onRefresh }

  return (
    // Le repère sert aux suites : la ligne doit tenir sur 48 px sans déborder.
    <div data-git-line className="shrink-0">
      <PanelToolbar
        title={t('panel.tab.git')}
        meta={state?.branch ? <span className="font-mono">{state.branch}</span> : null}
        foldTitle
        lead={
          <>
            <Popover
              open={open}
              onOpenChange={setOpen}
              label={t('git.view.label')}
              side="bottom"
              align="start"
              className="w-72"
              trigger={
                <button type="button" aria-label={viewLabel} title={viewLabel} className={panelToolClass()}>
                  <CurrentIcon size={15} aria-hidden />
                  <span
                    className={cx(
                      'hidden max-w-[6rem] truncate @min-[46rem]:max-w-[9rem]',
                      conflicted > 0 ? '@min-[26rem]:inline' : '@min-[20rem]:inline',
                    )}
                  >
                    {t(current.label)}
                  </span>
                  <span aria-hidden className="text-ink-faint">▾</span>
                </button>
              }
            >
              <ul className="flex flex-col p-1.5">
                {DESTINATIONS.map(({ id, icon: Icon, label, hint }) => {
                  const active = id === destination
                  const count = counts[id]
                  return (
                    <li key={id}>
                      <button
                        type="button"
                        aria-pressed={active}
                        aria-label={t(label)}
                        aria-describedby={`${hints}-${id}`}
                        onClick={() => {
                          onDestination(id)
                          setOpen(false)
                        }}
                        className={cx(
                          'flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors',
                          'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent',
                          active ? 'bg-accent-wash/50 text-ink' : 'text-ink-soft hover:bg-surface-high hover:text-ink',
                        )}
                      >
                        <Icon size={15} aria-hidden className={cx('shrink-0', active ? 'text-accent' : 'text-ink-faint')} />
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className={cx('text-sm', active && 'font-medium')}>{t(label)}</span>
                          <span id={`${hints}-${id}`} className="truncate text-xs text-ink-faint">{t(hint)}</span>
                        </span>
                        {count ? <span className="shrink-0 text-xs tabular-nums text-ink-faint">{count}</span> : null}
                      </button>
                    </li>
                  )
                })}
              </ul>
            </Popover>

            {conflicted > 0 ? (
              <button
                type="button"
                aria-pressed={destination === 'conflicts'}
                aria-label={conflictsLabel}
                title={conflictsLabel}
                onClick={() => onDestination('conflicts')}
                className={cx(
                  // La forme de `panelToolClass`, à la couleur de « il y a quelque chose à faire ici ».
                  'inline-flex h-11 shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-xs md:h-9 pointer-coarse:h-11',
                  'focus-visible:outline-2 focus-visible:outline-accent',
                  destination === 'conflicts'
                    ? 'border-caution bg-caution/15 text-caution'
                    : 'border-caution/50 text-caution hover:bg-caution/10',
                )}
              >
                <AlertTriangle size={14} aria-hidden />
                <span aria-hidden className="tabular-nums @min-[38rem]:hidden">{conflicted}</span>
                <span aria-hidden className="hidden @min-[38rem]:inline">{conflictsLabel}</span>
              </button>
            ) : null}
          </>
        }
      >
        <span className="hidden items-center gap-1.5 @min-[22rem]:flex">
          <Gesture icon={<Undo2 size={14} />} {...undoing} />
          <Gesture icon={<Redo2 size={14} />} {...redoing} />
          <Separator />
        </span>
        <Gesture icon={<ArrowDown size={14} />} label={t('git.toolbar.pull')} labelled badge={behind} disabled={frozen} onClick={() => run({ kind: 'pull' })} />
        <Gesture
          icon={<ArrowUp size={14} />}
          label={t('git.toolbar.push')}
          labelled
          badge={ahead}
          // Ce que GitKraken met en avant : pousser est le geste qu'on vient faire.
          primary={ahead > 0}
          disabled={frozen}
          onClick={() => run({ kind: 'push', force: false, branch: null })}
        />
        <span className="hidden @min-[26rem]:flex">
          <Gesture icon={<CloudDownload size={14} />} {...fetching} />
        </span>
        <span className={cx('hidden items-center gap-1.5', conflicted === 0 && '@min-[38rem]:flex')}>
          <Separator />
          <Gesture icon={<GitBranch size={14} />} {...branching} />
          <Gesture icon={<Archive size={14} />} {...stashing} />
          <Gesture icon={<ArchiveRestore size={14} />} {...popping} />
          <Gesture icon={<RefreshCw size={14} className={cx(refreshing && 'animate-spin')} />} {...rereading} />
        </span>
        <span className={cx('flex', conflicted === 0 && '@min-[38rem]:hidden')}>
          <Menu
            align="end"
            trigger={
              <button
                type="button"
                aria-label={t('git.toolbar.more')}
                title={t('git.toolbar.more')}
                className={gestureClass(false, false)}
              >
                <MoreHorizontal size={14} aria-hidden />
              </button>
            }
          >
            <MenuItem icon={<CloudDownload size={14} />} {...menuItem(fetching)} />
            <MenuItem icon={<Undo2 size={14} />} {...menuItem(undoing)} />
            <MenuItem icon={<Redo2 size={14} />} {...menuItem(redoing)} />
            <MenuSeparator />
            <MenuItem icon={<GitBranch size={14} />} {...menuItem(branching)} />
            <MenuItem icon={<Archive size={14} />} {...menuItem(stashing)} />
            <MenuItem icon={<ArchiveRestore size={14} />} {...menuItem(popping)} />
            <MenuSeparator />
            <MenuItem icon={<RefreshCw size={14} />} {...menuItem(rereading)} />
          </Menu>
        </span>

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
      </PanelToolbar>
    </div>
  )
}

/** Un geste de la ligne, rendu en entrée du menu « ⋯ ». */
const menuItem = ({ label, disabled, onClick }: { label: string; disabled: boolean; onClick: () => void }) => ({
  disabled,
  onSelect: onClick,
  children: label,
})

const Separator = () => <span aria-hidden className="mx-0.5 h-4 w-px shrink-0 bg-line" />

/** Un geste du dépôt, à la hauteur des autres outils de la ligne (`Button size="sm"`). */
function Gesture({
  icon,
  label,
  labelled = false,
  badge = 0,
  primary = false,
  disabled,
  onClick,
}: {
  icon: ReactNode
  label: string
  /** Le libellé à côté de l'icône, à partir de 46 rem. */
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
      className={gestureClass(primary, disabled)}
    >
      {icon}
      {labelled ? <span className="hidden @min-[46rem]:inline">{label}</span> : null}
      {badge > 0 ? (
        <span
          className={cx(
            'rounded-full px-1 text-micro tabular-nums',
            primary && !disabled ? 'bg-on-accent/20' : 'bg-surface-high text-ink-faint',
          )}
        >
          {badge}
        </span>
      ) : null}
    </button>
  )
}

const gestureClass = (primary: boolean, disabled: boolean) =>
  cx(
    'inline-flex h-11 min-w-9 shrink-0 items-center justify-center gap-1.5 rounded-md px-2 text-xs font-medium md:h-9 pointer-coarse:h-11',
    'focus-visible:outline-2 focus-visible:outline-accent disabled:pointer-events-none disabled:opacity-45',
    primary && !disabled ? 'bg-accent text-on-accent' : 'text-ink-soft hover:bg-surface-high hover:text-ink',
  )
