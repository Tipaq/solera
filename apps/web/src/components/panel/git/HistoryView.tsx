import { GitCommitHorizontal, Loader, MessagesSquare } from 'lucide-react'
import type { BlameLineDto, DiffFileDto } from '@solera/protocol'
import { useTranslate } from '../../../lib/i18n'
import { relativeDate, shortAge } from '../../../lib/dates'
import type { WorkspaceScope } from '../../../lib/workspace-scope'
import { Banner, cx } from '@solera/ui'
import { useBlame, useFileHistory } from './queries'

/**
 * L'historique d'un fichier, et son blâme **par fil** (planche T12).
 *
 * C'est le deuxième écart assumé avec GitKraken, et le plus profond de la vue : « qui
 * a écrit cette ligne » devient « quelle conversation l'a écrite ». Dans un dépôt où
 * presque tout est signé d'un agent, l'auteur git est l'utilisateur dans les deux cas
 * — le CLI commite sous son identité — et ne renseigne donc plus rien. Le fil, si : il
 * porte l'intention, et on peut l'ouvrir.
 *
 * L'auteur reste affiché pour les lignes qu'aucun fil ne revendique, où il est la
 * seule chose vraie qu'on puisse dire : « Tim, à la main ».
 *
 * Deux onglets plutôt que deux destinations : ce sont deux façons de lire le même
 * fichier, et le rail répondrait deux fois à la même question.
 */
export function HistoryView({
  scope,
  path,
  blame,
  changed,
  onPath,
  onBlame,
  onOpenCommit,
  onOpenThread,
}: {
  scope: WorkspaceScope
  /** Le fichier regardé, choisi par le menu d'un fichier. */
  path: string | null
  blame: boolean
  /** Les fichiers modifiés, qui servent de raccourci quand rien n'est encore choisi. */
  changed: DiffFileDto[]
  onPath: (path: string) => void
  onBlame: (blame: boolean) => void
  onOpenCommit: (hash: string) => void
  onOpenThread: (id: string) => void
}) {
  const t = useTranslate()
  const history = useFileHistory(scope, path)
  const lines = useBlame(scope, path, blame)

  if (path === null) {
    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 overflow-y-auto p-2.5">
        <p className="text-xs text-ink-faint">{t('git.history.pick')}</p>
        {changed.map((file) => (
          <button
            key={file.path}
            type="button"
            onClick={() => onPath(file.path)}
            className="truncate rounded-md border border-line px-2 py-1 text-left text-xs text-ink hover:bg-surface-high"
          >
            {file.path}
          </button>
        ))}
      </div>
    )
  }

  const name = path.slice(path.lastIndexOf('/') + 1)
  const folder = path.slice(0, path.lastIndexOf('/') + 1)

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-line px-2.5 py-2">
        <div className="flex min-w-0 flex-1 items-baseline gap-1.5">
          <span className="truncate text-xs font-medium text-ink">{name}</span>
          <span className="hidden truncate text-micro text-ink-faint @min-[28rem]:inline">
            {folder}
          </span>
        </div>
        <Tab on={!blame} onClick={() => onBlame(false)} label={t('git.history.commits')} />
        <Tab on={blame} onClick={() => onBlame(true)} label={t('git.history.blame')} />
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {!blame ? (
          <>
            {history.isPending ? <Loading /> : null}
            {history.error ? (
              <div className="p-2">
                <Banner>{t('git.history.error')}</Banner>
              </div>
            ) : null}

            {history.data?.commits ? (
              <p className="px-2.5 pt-2 pb-1 text-micro font-semibold tracking-wide text-ink-soft uppercase">
                {t(history.data.threads === 1 ? 'git.history.countOne' : 'git.history.count', {
                  commits: history.data.commits.length,
                  threads: history.data.threads,
                })}
              </p>
            ) : null}

            {(history.data?.commits ?? []).map((commit) => (
              <div key={commit.hash} className="flex items-center gap-1.5 px-2.5 py-1 hover:bg-surface-high">
                <GitCommitHorizontal size={12} className="shrink-0 text-ink-faint" />
                <button
                  type="button"
                  onClick={() => onOpenCommit(commit.hash)}
                  className="min-w-0 flex-1 truncate text-left text-xs text-ink"
                  title={commit.subject}
                >
                  {commit.subject}
                </button>
                {commit.thread ? (
                  <Thread thread={commit.thread} onOpen={onOpenThread} />
                ) : null}
                <span
                  title={relativeDate(commit.ts)}
                  className="shrink-0 text-micro text-ink-faint tabular-nums"
                >
                  {shortAge(commit.ts)}
                </span>
              </div>
            ))}

            {history.data && history.data.commits?.length === 0 ? (
              <p className="px-2.5 py-3 text-xs text-ink-faint">{t('git.history.empty')}</p>
            ) : null}
            {history.data?.truncated ? (
              <p className="px-2.5 py-2 text-meta text-caution">{t('git.history.truncated')}</p>
            ) : null}
          </>
        ) : (
          <>
            {lines.isPending ? <Loading /> : null}
            {lines.error ? (
              <div className="p-2">
                <Banner>{t('git.history.blameError')}</Banner>
              </div>
            ) : null}
            {/* `table-fixed` : sans lui, la colonne du fil pousse la table au-delà du
                panneau et son texte se fait couper par le bord. */}
            <table className="w-full table-fixed border-collapse font-mono text-meta">
              <tbody>
                {(lines.data?.lines ?? []).map((line) => (
                  <BlameRow key={line.line} line={line} onOpenThread={onOpenThread} />
                ))}
              </tbody>
            </table>
            {lines.data?.truncated ? (
              <p className="px-2.5 py-2 text-meta text-caution">{t('git.history.blameTruncated')}</p>
            ) : null}
          </>
        )}
      </div>
    </div>
  )
}

/**
 * Une ligne de blâme : son sha, son code, et **le fil qui l'a écrite**.
 *
 * Quand aucun fil ne la revendique, c'est l'auteur qui s'affiche — et la mention « à
 * la main », qui est l'information utile : dans ce dépôt, une ligne écrite à la main
 * est l'exception, donc c'est elle qu'il faut signaler.
 */
function BlameRow({
  line,
  onOpenThread,
}: {
  line: BlameLineDto
  onOpenThread: (id: string) => void
}) {
  const t = useTranslate()
  return (
    <tr className="hover:bg-surface-high">
      <td className="w-16 border-r border-line/60 px-1.5 text-micro text-ink-faint/70 select-none">
        {line.shortHash}
      </td>
      <td className="max-w-0 px-1.5 whitespace-pre text-ink-soft">
        <span className="block truncate">{line.text}</span>
      </td>
      {/* La colonne du fil s'élargit avec le panneau, comme les colonnes du graphe :
          « Alex Demo, à la main » coupé au milieu ne dit plus ce qu'il faut lire. */}
      <td className="w-32 px-2.5 text-right @min-[36rem]:w-44">
        {line.thread ? (
          <button
            type="button"
            onClick={() => onOpenThread(line.thread?.id ?? '')}
            title={line.thread.sure ? line.thread.title : t('git.thread.guessed', { title: line.thread.title })}
            className={cx(
              'flex w-full items-center justify-end gap-1 truncate text-micro text-accent hover:underline',
              !line.thread.sure && 'opacity-70',
            )}
          >
            <MessagesSquare size={11} className="shrink-0" />
            <span className="truncate">{line.thread.title}</span>
          </button>
        ) : (
          // `block` : `truncate` ne fait rien sur un span en ligne, qui déborde alors
          // de la cellule et se fait couper par le bord du panneau.
          <span className="block truncate text-micro text-ink-faint">
            {line.agent ?? t('git.history.byHand', { author: line.author })}
          </span>
        )}
      </td>
    </tr>
  )
}

function Thread({
  thread,
  onOpen,
}: {
  thread: { id: string; title: string; sure: boolean }
  onOpen: (id: string) => void
}) {
  const t = useTranslate()
  return (
    <button
      type="button"
      onClick={() => onOpen(thread.id)}
      title={thread.sure ? thread.title : t('git.thread.guessed', { title: thread.title })}
      className={cx(
        'hidden max-w-[10rem] shrink-0 items-center gap-1 truncate text-micro text-accent hover:underline @min-[32rem]:flex',
        !thread.sure && 'opacity-70',
      )}
    >
      <MessagesSquare size={11} className="shrink-0" />
      <span className="truncate">{thread.title}</span>
    </button>
  )
}

function Tab({ on, label, onClick }: { on: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={cx(
        'shrink-0 rounded-md px-2 py-1 text-micro font-medium',
        on ? 'bg-accent text-on-accent' : 'text-ink-faint hover:bg-surface-high hover:text-ink',
      )}
    >
      {label}
    </button>
  )
}

function Loading() {
  const t = useTranslate()
  return (
    <p className="flex items-center gap-1.5 px-2.5 py-2 text-xs text-ink-faint">
      <Loader size={11} className="animate-spin" />
      {t('changes.diff.loading')}
    </p>
  )
}
