import { useState } from 'react'
import { Archive, ArchiveRestore, FileCode2, GitBranch, Loader, MoreHorizontal, Trash2 } from 'lucide-react'
import type { StashDto } from '@solera/protocol'
import { shortAge } from '../../../lib/dates'
import { useTranslate } from '../../../lib/i18n'
import type { WorkspaceScope } from '../../../lib/workspace-scope'
import {
  Banner,
  Menu,
  MenuItem,
  MenuSeparator,
  PanelEmpty,
  PanelStatusIcon,
  cx,
  panelGestureClass,
  panelRowClass,
} from '@solera/ui'
import { useGitActions } from './actions'
import { NameDialog } from './menus'
import { useStashes } from './queries'

/**
 * La destination *Remises* (planche T8).
 *
 * **Avec l'aperçu de ce que chaque remise contient**, sans quoi on n'ose plus dépiler :
 * « WIP on main » ne dit rien de ce qui reviendrait dans l'arbre. C'est le seul ajout
 * de la planche par rapport à une liste, et c'est tout son intérêt.
 *
 * Usage propre à Solera : remiser avant de lancer un tour, pour que l'agent ne
 * trouve pas l'arbre sale.
 */
export function StashesView({ scope }: { scope: WorkspaceScope }) {
  const t = useTranslate()
  const { data, error, isPending } = useStashes(scope, true)

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto py-1 pb-safe">
      {isPending ? (
        <p className="flex items-center gap-1.5 px-3 py-2 text-xs text-ink-faint">
          <Loader size={11} className="animate-spin" />
          {t('git.stashes.loading')}
        </p>
      ) : null}

      {error ? <Banner>{error instanceof Error ? error.message : t('git.stashes.error')}</Banner> : null}

      {data?.stashes.length === 0 ? <PanelEmpty>{t('git.stashes.empty')}</PanelEmpty> : null}

      {(data?.stashes ?? []).map((stash) => (
        <Stash key={stash.hash} stash={stash} />
      ))}
    </div>
  )
}

/**
 * Une remise, en ligne du cadre commun et sans carte bordée : son message, sa branche
 * et son âge, **Dépiler** au survol — le geste qu'on vient faire — et le reste dans son
 * menu. L'aperçu suit, en retrait sous la ligne.
 */
function Stash({ stash }: { stash: StashDto }) {
  const t = useTranslate()
  const { run, lock, pending } = useGitActions()
  const [naming, setNaming] = useState(false)
  const frozen = !!lock || pending
  const target = { index: stash.index, hash: stash.hash }

  return (
    <div data-stash className="flex flex-col pb-1">
      <div className={panelRowClass} title={stash.message}>
        <PanelStatusIcon icon={<Archive size={15} />} />
        <span className="min-w-0 flex-1 truncate text-sm text-ink">{stash.message}</span>
        <span className="flex shrink-0 items-center gap-1.5 text-xs text-ink-faint">
          {stash.branch ? <span className="max-w-[8rem] truncate font-mono">{stash.branch}</span> : null}
          <span className="tabular-nums">{shortAge(stash.ts)}</span>
        </span>
        <button
          type="button"
          disabled={frozen}
          onClick={() => run({ kind: 'stash-pop', ...target })}
          className={cx(
            panelGestureClass,
            'shrink-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100',
          )}
        >
          <ArchiveRestore size={13} aria-hidden />
          {t('git.stashes.pop')}
        </button>
        <Menu
          align="end"
          trigger={
            <button
              type="button"
              aria-label={t('git.stashes.menu', { message: stash.message })}
              className="flex size-5 shrink-0 items-center justify-center rounded text-ink-faint opacity-0 group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100"
            >
              <MoreHorizontal size={13} />
            </button>
          }
        >
          <MenuItem icon={<ArchiveRestore size={13} />} disabled={frozen} onSelect={() => run({ kind: 'stash-apply', ...target })}>
            {t('git.stashes.apply')}
          </MenuItem>
          {/* *En faire une branche* est l'entrée que GitKraken a et qu'on oublie
              toujours : c'est souvent ce qu'on voulait, plutôt que de verser la remise
              dans un arbre qui a changé depuis. */}
          <MenuItem icon={<GitBranch size={13} />} disabled={frozen} onSelect={() => setNaming(true)}>
            {t('git.stashes.branch')}
          </MenuItem>
          <MenuSeparator />
          {/* Supprimer une remise ne s'annule pas : garde-fou, et rien d'autre. */}
          <MenuItem icon={<Trash2 size={13} />} tone="critical" disabled={frozen} onSelect={() => run({ kind: 'stash-drop', ...target })}>
            {t('git.stashes.drop')}
          </MenuItem>
        </Menu>
      </div>

      {/* L'aperçu : les fichiers et leur volume, pas le diff. Ce qu'il faut pour
          décider de dépiler tient en trois lignes. */}
      {stash.files.map((file) => (
        <div key={file.path} className="flex items-center gap-1.5 pr-3 pl-10.5">
          <FileCode2 size={11} className="shrink-0 text-ink-faint" />
          <span className="min-w-0 flex-1 truncate text-xs text-ink-soft" title={file.path}>
            {file.path}
          </span>
          {file.added > 0 ? (
            <span className="font-mono text-xs text-positive tabular-nums">+{file.added}</span>
          ) : null}
          {file.removed > 0 ? (
            <span className="font-mono text-xs text-critical tabular-nums">−{file.removed}</span>
          ) : null}
        </div>
      ))}
      {stash.truncated ? <span className="pl-10.5 text-xs text-ink-faint">{t('git.stashes.more')}</span> : null}

      {naming ? (
        <NameDialog
          title={t('git.stashes.branch')}
          label={t('git.menu.branchName')}
          onClose={() => setNaming(false)}
          onConfirm={(name) => {
            setNaming(false)
            run({ kind: 'stash-branch', ...target, name })
          }}
        />
      ) : null}
    </div>
  )
}
