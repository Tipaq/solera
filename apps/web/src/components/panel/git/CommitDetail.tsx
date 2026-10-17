import { ArrowLeft, Bot, Loader, MessagesSquare, MoreHorizontal, X } from 'lucide-react'
import { useMemo, type ReactNode } from 'react'
import { parseUnifiedDiff } from '../../../lib/diff'
import { relativeDate } from '../../../lib/dates'
import { locale, useTranslate } from '../../../lib/i18n'
import type { WorkspaceScope } from '../../../lib/workspace-scope'
import { Banner, IconButton, cx } from '@solera/ui'
import { FileDiff, SectionTitle } from '../diff-parts'
import { Ref } from './GraphRows'
import { CommitMenu, type MenuContext } from './menus'
import { useCommitDetail } from './queries'

/**
 * Le commit sélectionné : auteur, date, sha, parent, branches qui le contiennent, le
 * diff — et **le fil qui l'a écrit**, cliquable.
 *
 * C'est cette dernière ligne qui justifie que la vue vive dans Solera plutôt qu'à
 * côté : un commit d'agent sans sa conversation est une énigme, et aller la chercher à
 * la main coûte plus cher que tout le reste de l'écran réuni.
 *
 * Le détail remplace la liste au lieu de s'ouvrir à côté : le panneau peut n'avoir que
 * 20 rem, et un volet de plus y laisserait deux colonnes illisibles. D'où le retour,
 * que la planche T4 n'a pas — elle ne montre pas comment on en sort.
 *
 * Sur un panneau large, il s'ouvre **à côté** du graphe, comme chez GitKraken : on
 * passe d'un commit au suivant sans perdre sa place dans la liste. Le retour y
 * devient une fermeture.
 */
export function CommitDetail({
  scope,
  hash,
  menus,
  onBack,
  onOpenThread,
  beside = false,
}: {
  scope: WorkspaceScope
  hash: string
  menus: MenuContext
  onBack: () => void
  /** Ouvert à côté du graphe plutôt qu'à sa place. */
  beside?: boolean
  onOpenThread: (id: string) => void
}) {
  const t = useTranslate()
  const { data, error, isPending } = useCommitDetail(scope, hash)
  const files = useMemo(() => (data ? parseUnifiedDiff(data.patch) : []), [data])

  const added = (data?.files ?? []).reduce((sum, file) => sum + file.added, 0)
  const removed = (data?.files ?? []).reduce((sum, file) => sum + file.removed, 0)

  /**
   * L'en-tête, écrit une fois et rendu deux : avec son menu une fois le commit lu, et
   * sans tant qu'il se charge. C'est aussi lui qui porte le clic droit.
   */
  const header = (menu: ReactNode) => (
    <div className="flex items-start gap-1.5 border-b border-line px-2 py-1.5">
      <IconButton size="sm" label={t(beside ? 'common.close' : 'git.commit.back')} onClick={onBack}>
        {beside ? <X size={15} /> : <ArrowLeft size={15} />}
      </IconButton>

      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-ink">{data?.subject ?? ''}</p>

        {data ? (
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-micro text-ink-faint">
            <span
              className="flex items-center gap-1"
              title={data.agent ? t('git.author.agent', { agent: data.agent, author: data.author }) : data.authorEmail}
            >
              {data.agent ? <Bot size={11} /> : null}
              {data.agent ?? data.author}
            </span>
            <span title={new Date(data.ts).toLocaleString(locale())}>{relativeDate(data.ts)}</span>
            <span className="font-mono">{data.shortHash}</span>
            {data.parents.map((parent) => (
              <span key={parent.hash}>
                {t('git.commit.parent')} <span className="font-mono">{parent.shortHash}</span>
              </span>
            ))}
            {data.refs.filter((ref) => ref.kind !== 'head').map((ref) => (
              <Ref key={ref.name} value={ref} />
            ))}
          </div>
        ) : null}

        {data?.thread ? (
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => data.thread && onOpenThread(data.thread.id)}
              className={cx(
                'flex items-center gap-1 rounded bg-accent-wash px-1.5 py-0.5 text-micro font-medium text-accent hover:underline',
                !data.thread.sure && 'opacity-80',
              )}
            >
              <MessagesSquare size={10} />
              {data.thread.title}
            </button>
            <span className="text-micro text-ink-faint">
              {data.thread.sure ? t('git.commit.thread') : t('git.commit.threadGuessed')}
            </span>
          </div>
        ) : null}

        {/* Les branches qui le contiennent répondent à « est-ce que c'est dans main ? »,
            qui est la question qu'on se pose devant un commit ancien. */}
        {data && data.containedIn.length > 0 ? (
          <p className="mt-1 truncate text-micro text-ink-faint" title={data.containedIn.join(', ')}>
            {t('git.commit.containedIn', { branches: data.containedIn.slice(0, 4).join(', ') })}
          </p>
        ) : null}
      </div>

      {menu}
    </div>
  )

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto pb-safe">
      {/* Le même menu que dans le graphe : un commit ouvert doit pouvoir tout ce
          qu'un commit de la liste peut, sinon on retourne à la liste pour agir. */}
      {data ? (
        <CommitMenu
          hash={data.hash}
          shortHash={data.shortHash}
          threadId={data.thread?.id ?? null}
          context={menus}
          row={header}
          trigger={
            <button
              type="button"
              aria-label={t('git.menu.commit.label', { subject: data.subject })}
              className="flex size-6 shrink-0 items-center justify-center rounded-md text-ink-faint hover:bg-surface-high hover:text-ink"
            >
              <MoreHorizontal size={15} />
            </button>
          }
        />
      ) : (
        header(null)
      )}

      {isPending ? (
        <p className="flex items-center gap-1.5 px-2.5 py-2 text-xs text-ink-faint">
          <Loader size={11} className="animate-spin" />
          {t('changes.commits.diffLoading')}
        </p>
      ) : null}

      {error ? (
        <div className="p-2">
          <Banner>{error instanceof Error ? error.message : t('changes.commits.error')}</Banner>
        </div>
      ) : null}

      {data?.body ? (
        <p className="border-b border-line/60 px-2.5 py-2 text-meta whitespace-pre-wrap text-ink-soft">
          {data.body}
        </p>
      ) : null}

      {data ? (
        <SectionTitle>
          {t(data.files.length > 1 ? 'git.commit.files' : 'git.commit.filesOne', {
            count: data.files.length,
            added,
            removed,
          })}
        </SectionTitle>
      ) : null}

      {/* Sans `onOpenFile` : le fichier du disque n'est plus celui de ce commit, et
          ouvrir l'un en croyant lire l'autre est le pire des deux mondes. */}
      {files.map((file) => (
        <FileDiff key={file.path} file={file} />
      ))}

      {data?.truncated ? (
        <p className="px-2.5 py-2 text-meta text-caution">{t('changes.diff.truncated')}</p>
      ) : null}
    </div>
  )
}
