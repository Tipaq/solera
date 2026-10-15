import { useState } from 'react'
import { Archive, ArchiveRestore, FileCode2, GitBranch, Loader, Trash2 } from 'lucide-react'
import type { StashDto } from '@solera/protocol'
import { shortAge } from '../../../lib/dates'
import { useTranslate } from '../../../lib/i18n'
import type { WorkspaceScope } from '../../../lib/workspace-scope'
import { Banner, cx } from '@solera/ui'
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
 * *En faire une branche* est l'entrée que GitKraken a et qu'on oublie toujours : c'est
 * souvent ce qu'on voulait, plutôt que de verser la remise dans un arbre qui a changé
 * depuis. Usage propre à Solera : remiser avant de lancer un tour, pour que l'agent ne
 * trouve pas l'arbre sale.
 */
export function StashesView({ scope }: { scope: WorkspaceScope }) {
  const t = useTranslate()
  const { data, error, isPending } = useStashes(scope, true)

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 overflow-y-auto p-2 pb-safe">
      {isPending ? (
        <p className="flex items-center gap-1.5 px-1 py-2 text-xs text-ink-faint">
          <Loader size={11} className="animate-spin" />
          {t('git.stashes.loading')}
        </p>
      ) : null}

      {error ? <Banner>{error instanceof Error ? error.message : t('git.stashes.error')}</Banner> : null}

      {data?.stashes.length === 0 ? (
        <p className="px-1 py-2 text-xs text-ink-faint">{t('git.stashes.empty')}</p>
      ) : null}

      {(data?.stashes ?? []).map((stash) => (
        <Stash key={stash.hash} stash={stash} />
      ))}
    </div>
  )
}

function Stash({ stash }: { stash: StashDto }) {
  const t = useTranslate()
  const { run, lock, pending } = useGitActions()
  const [naming, setNaming] = useState(false)
  const frozen = !!lock || pending
  const target = { index: stash.index, hash: stash.hash }

  return (
    <div className="overflow-hidden rounded-md border border-line">
      <div className="flex items-center gap-1.5 border-b border-line/60 px-2 py-1.5">
        <Archive size={12} className="shrink-0 text-ink-faint" />
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-ink" title={stash.message}>
          {stash.message}
        </span>
        {stash.branch ? (
          <span className="shrink-0 rounded bg-accent-wash px-1 py-px text-micro font-medium text-accent">
            {stash.branch}
          </span>
        ) : null}
        <span className="shrink-0 text-micro text-ink-faint tabular-nums">{shortAge(stash.ts)}</span>
      </div>

      {/* L'aperçu : les fichiers et leur volume, pas le diff. Ce qu'il faut pour
          décider de dépiler tient en trois lignes. */}
      <div className="flex flex-col py-1">
        {stash.files.map((file) => (
          <div key={file.path} className="flex items-center gap-1.5 px-2 py-0.5">
            <FileCode2 size={11} className="shrink-0 text-ink-faint" />
            <span className="min-w-0 flex-1 truncate text-micro text-ink-soft" title={file.path}>
              {file.path}
            </span>
            {file.added > 0 ? (
              <span className="font-mono text-micro text-positive tabular-nums">+{file.added}</span>
            ) : null}
            {file.removed > 0 ? (
              <span className="font-mono text-micro text-critical tabular-nums">−{file.removed}</span>
            ) : null}
          </div>
        ))}
        {stash.truncated ? (
          <span className="px-2 text-micro text-ink-faint">{t('git.stashes.more')}</span>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-1.5 border-t border-line/60 px-2 py-1.5">
        <button
          type="button"
          disabled={frozen}
          onClick={() => run({ kind: 'stash-pop', ...target })}
          className="flex items-center gap-1.5 rounded-md bg-accent px-2 py-1 text-micro font-medium text-on-accent disabled:opacity-45"
        >
          <ArchiveRestore size={12} />
          {t('git.stashes.pop')}
        </button>
        <button
          type="button"
          disabled={frozen}
          onClick={() => run({ kind: 'stash-apply', ...target })}
          className="rounded-md border border-line px-2 py-1 text-micro font-medium text-ink-soft hover:bg-surface-high disabled:opacity-45"
        >
          {t('git.stashes.apply')}
        </button>
        <button
          type="button"
          disabled={frozen}
          onClick={() => setNaming(true)}
          className="flex items-center gap-1.5 rounded-md border border-line px-2 py-1 text-micro font-medium text-ink-soft hover:bg-surface-high disabled:opacity-45"
        >
          <GitBranch size={12} />
          {t('git.stashes.branch')}
        </button>

        <span className="flex-1" />

        {/* Supprimer une remise ne s'annule pas : garde-fou, et rien d'autre. */}
        <button
          type="button"
          disabled={frozen}
          aria-label={t('git.stashes.drop')}
          title={t('git.stashes.drop')}
          onClick={() => run({ kind: 'stash-drop', ...target })}
          className={cx(
            'flex size-6 items-center justify-center rounded-md text-ink-faint',
            'hover:bg-critical/12 hover:text-critical disabled:opacity-45',
          )}
        >
          <Trash2 size={13} />
        </button>
      </div>

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
