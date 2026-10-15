import { useState } from 'react'
import {
  Archive,
  ArchiveRestore,
  ArrowDown,
  ArrowUp,
  GitBranch,
  RefreshCw,
  Redo2,
  Undo2,
} from 'lucide-react'
import type { GitStateDto } from '@solera/protocol'
import { useTranslate } from '../../../lib/i18n'
import { cx } from '@solera/ui'
import { useGitActions } from './actions'
import { NameDialog } from './menus'

/**
 * La barre d'outils de la vue Git : les gestes qui n'ont **pas d'objet à désigner**.
 *
 * C'est la moitié haute de la règle de rangement du tour 3, et ce qui la tient à huit
 * boutons : tout ce qui porte sur *ce* commit, *cette* branche ou *ce* fichier vit
 * dans le menu de cet objet (`menus.tsx`). Y ajouter un geste qui a un objet, c'est
 * commencer la barre à dix-huit boutons que la règle existe pour éviter.
 *
 * *Annuler* et *Refaire* ouvrent la barre comme chez GitKraken. Ils sont éteints quand
 * il n'y a rien à annuler — ce qui est la plupart du temps, et c'est voulu : le
 * bandeau de T13 qui dit *quoi* se trouve sous la barre, pas ici.
 *
 * Les libellés tombent au même palier que la colonne *Auteur* : sous 36 rem, icônes
 * seules.
 */
export function Toolbar({
  state,
  stashes,
  onRefresh,
  refreshing,
}: {
  state: GitStateDto | undefined
  /** Combien de remises : *Dépiler* n'a pas de sens quand la pile est vide. */
  stashes: number
  onRefresh: () => void
  refreshing: boolean
}) {
  const t = useTranslate()
  const { run, undo, redo, lock, pending } = useGitActions()
  const [naming, setNaming] = useState(false)

  const frozen = !!lock || pending
  const ahead = state?.ahead ?? 0
  const behind = state?.behind ?? 0

  return (
    <div className="flex shrink-0 items-center gap-1 border-b border-line px-2 py-1.5">
      <Action
        icon={<Undo2 size={14} />}
        label={t('git.toolbar.undo')}
        disabled={frozen || !state?.undo}
        onClick={undo}
      />
      <Action
        icon={<Redo2 size={14} />}
        label={t('git.toolbar.redo')}
        disabled={frozen || !state?.redo}
        onClick={redo}
      />

      <Separator />

      <Action
        icon={<ArrowDown size={14} />}
        label={t('git.toolbar.pull')}
        labelled
        badge={behind}
        disabled={frozen}
        onClick={() => run({ kind: 'pull' })}
      />
      <Action
        icon={<ArrowUp size={14} />}
        label={t('git.toolbar.push')}
        labelled
        badge={ahead}
        // Ce que GitKraken met en avant : pousser est le geste qu'on vient faire.
        primary={ahead > 0}
        disabled={frozen}
        onClick={() => run({ kind: 'push', force: false, branch: null })}
      />
      <Action
        icon={<RefreshCw size={14} />}
        label={t('git.toolbar.fetch')}
        disabled={frozen}
        onClick={() => run({ kind: 'fetch' })}
      />

      <Separator />

      <Action
        icon={<GitBranch size={14} />}
        label={t('git.toolbar.branch')}
        labelled
        disabled={frozen}
        onClick={() => setNaming(true)}
      />
      <Action
        icon={<Archive size={14} />}
        label={t('git.toolbar.stash')}
        labelled
        disabled={frozen}
        onClick={() => run({ kind: 'stash-push', message: '' })}
      />
      <Action
        icon={<ArchiveRestore size={14} />}
        label={t('git.toolbar.pop')}
        disabled={frozen || stashes === 0}
        // Sans sha : « celle du dessus, quelle qu'elle soit ». La liste des remises,
        // elle, désigne la sienne et la vérifie.
        onClick={() => run({ kind: 'stash-pop', index: 0, hash: null })}
      />

      <span className="flex-1" />

      <button
        type="button"
        onClick={onRefresh}
        aria-label={t('git.toolbar.refresh')}
        title={t('git.toolbar.refresh')}
        className="flex size-7 items-center justify-center rounded-md text-ink-faint hover:bg-surface-high hover:text-ink"
      >
        <RefreshCw size={14} className={cx(refreshing && 'animate-spin')} />
      </button>

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

const Separator = () => <span className="mx-1 h-4 w-px shrink-0 bg-line" />

function Action({
  icon,
  label,
  labelled = false,
  badge = 0,
  primary = false,
  disabled,
  onClick,
}: {
  icon: React.ReactNode
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
        'flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs font-medium disabled:opacity-45',
        primary && !disabled
          ? 'bg-accent text-on-accent'
          : 'text-ink-soft hover:bg-surface-high hover:text-ink',
      )}
    >
      {icon}
      {labelled ? <span className="hidden @min-[36rem]:inline">{label}</span> : null}
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
