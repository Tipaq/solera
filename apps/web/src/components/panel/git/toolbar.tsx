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
import type { LucideIcon } from 'lucide-react'
import { useTranslate, type MessageKey } from '../../../lib/i18n'
import { cx } from '@solera/ui'

/**
 * La barre d'outils de la vue Git : les gestes qui n'ont pas d'objet à désigner.
 *
 * C'est la règle de rangement du tour 3, qui est la vraie décision du dessin : une
 * liste qu'on consulte → une destination du rail ; un geste sur le dépôt sans objet à
 * désigner → ici ; un geste sur *ce* commit, *cette* branche, *ce* fichier → le menu
 * de cet objet. S'y tenir, sinon la barre gonfle à dix-huit boutons.
 *
 * **Tout y est inerte sauf relire** : tirer, pousser, brancher, remiser et dépiler
 * sont des écritures, et aucune route n'écrit encore (lot 2 de la carte #29). Les
 * boutons sont dessinés et désactivés plutôt qu'absents, pour que la barre ne change
 * pas de forme quand le lot 2 arrivera.
 *
 * Les libellés tombent au même palier que la colonne *Auteur* : sous 36 rem, les
 * icônes seules.
 */
const ACTIONS: { id: string; icon: LucideIcon; label: MessageKey; labelled: boolean }[] = [
  { id: 'undo', icon: Undo2, label: 'git.toolbar.undo', labelled: false },
  { id: 'redo', icon: Redo2, label: 'git.toolbar.redo', labelled: false },
  { id: 'pull', icon: ArrowDown, label: 'git.toolbar.pull', labelled: true },
  { id: 'push', icon: ArrowUp, label: 'git.toolbar.push', labelled: true },
  { id: 'branch', icon: GitBranch, label: 'git.toolbar.branch', labelled: true },
  { id: 'stash', icon: Archive, label: 'git.toolbar.stash', labelled: true },
  { id: 'pop', icon: ArchiveRestore, label: 'git.toolbar.pop', labelled: false },
]

export function Toolbar({ onRefresh, refreshing }: { onRefresh: () => void; refreshing: boolean }) {
  const t = useTranslate()

  return (
    <div className="flex shrink-0 items-center gap-1 border-b border-line px-2 py-1.5">
      {ACTIONS.map(({ id, icon: Icon, label, labelled }, index) => (
        <span key={id} className="flex items-center">
          {/* Les séparateurs de GitKraken : annuler / refaire, puis les échanges avec
              le distant, puis ce qui se fait en local. */}
          {index === 2 || index === 4 ? <span className="mx-1 h-4 w-px bg-line" /> : null}
          <button
            type="button"
            disabled
            title={t('git.toolbar.later', { action: t(label) })}
            aria-label={t(label)}
            className="flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-ink-faint opacity-45"
          >
            <Icon size={14} />
            {labelled ? <span className="hidden @min-[36rem]:inline">{t(label)}</span> : null}
          </button>
        </span>
      ))}

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
    </div>
  )
}
