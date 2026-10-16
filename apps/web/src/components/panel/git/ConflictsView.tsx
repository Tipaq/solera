import { useEffect, useState } from 'react'
import { AlertTriangle, Bot, Check, Loader } from 'lucide-react'
import type { ConflictFileDto } from '@solera/protocol'
import { api } from '../../../lib/api'
import { useTranslate } from '../../../lib/i18n'
import type { WorkspaceScope } from '../../../lib/workspace-scope'
import { Banner, cx } from '@solera/ui'
import { useGitActions } from './actions'
import { useConflicts } from './queries'

/**
 * L'éditeur de conflits (planche T10) : trois versions empilées, et le bouton qui
 * passe la main.
 *
 * Empilées et non côte à côte : le panneau peut n'avoir que 20 rem, et trois colonnes
 * de code y seraient trois colonnes illisibles. Chaque bloc porte son « prendre », et
 * le résultat est **modifiable** — c'est lui qui part sur le disque, pas la somme des
 * boutons cliqués.
 *
 * **« Laisser l'agent le résoudre » est le quatrième écart assumé** avec GitKraken
 * (carte #10). Un agent résout un conflit mieux et plus vite dès qu'il dépasse un
 * `else` déplacé, et passer la main doit coûter un clic — pas un abandon, pas un
 * copier-coller dans la barre de saisie. Le bouton écrit un message dans le fil, où il
 * reste visible : on sait ce qu'on a demandé, et l'agent répond dans la conversation
 * comme pour n'importe quelle autre demande.
 *
 * Il est **éteint pendant un rebase**, et l'écran dit pourquoi : les tours sont
 * suspendus tant que le rebase court (écart n° 3), donc le message partirait dans le
 * vide. Finir ou abandonner le rebase rend l'agent disponible.
 */
export function ConflictsView({
  scope,
  threadId,
  rebasing,
  onOpenThread,
}: {
  scope: WorkspaceScope
  /** Le fil où écrire pour passer la main. Null en portée projet : pas d'agent désigné. */
  threadId: string | null
  /** Un rebase court : les tours sont suspendus, donc l'agent ne répondrait pas. */
  rebasing: boolean
  onOpenThread: (id: string) => void
}) {
  const t = useTranslate()
  const { run, lock, pending } = useGitActions()
  const { data, isPending, error } = useConflicts(scope, true)

  const [opened, setOpened] = useState<string | null>(null)
  const [handing, setHanding] = useState(false)
  const files = data?.files ?? []
  const file = files.find((entry) => entry.path === opened) ?? files[0]
  const frozen = !!lock || pending

  const handOver = (): void => {
    if (!threadId) return
    setHanding(true)
    void api
      .post(`/api/conversations/${threadId}/messages`, {
        clientMessageId: crypto.randomUUID(),
        text: t('git.conflicts.agentPrompt', {
          files: files.map((entry) => entry.path).join(', '),
        }),
      })
      .then(() => onOpenThread(threadId))
      .finally(() => setHanding(false))
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col pb-safe">
      <div className="flex shrink-0 items-center gap-2 border-b border-caution/40 bg-caution/8 px-2.5 py-2">
        <AlertTriangle size={14} className="shrink-0 text-caution" />
        <p className="min-w-0 flex-1 truncate text-xs font-medium text-ink">
          {t(files.length === 1 ? 'git.conflicts.headerOne' : 'git.conflicts.header', {
            count: files.length,
            origin: t(originKey(data?.origin ?? null)),
            theirs: data?.theirsLabel ?? '',
          })}
        </p>
        <button
          type="button"
          disabled={frozen || files.length === 0}
          onClick={() => run({ kind: 'conflict-take', side: 'ours', path: null })}
          className="shrink-0 rounded-md border border-line px-2 py-1 text-micro font-medium text-ink-soft hover:bg-surface disabled:opacity-45"
        >
          {t('git.conflicts.allOurs')}
        </button>
        <button
          type="button"
          disabled={frozen || files.length === 0}
          onClick={() => run({ kind: 'conflict-take', side: 'theirs', path: null })}
          className="shrink-0 rounded-md border border-line px-2 py-1 text-micro font-medium text-ink-soft hover:bg-surface disabled:opacity-45"
        >
          {t('git.conflicts.allTheirs')}
        </button>
      </div>

      {/* La liste des fichiers n'apparaît qu'à partir de deux : à un seul, elle ne
          ferait que répéter l'en-tête du fichier ouvert. */}
      {files.length > 1 ? (
        <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-line px-2 py-1.5">
          {files.map((entry) => (
            <button
              key={entry.path}
              type="button"
              onClick={() => setOpened(entry.path)}
              className={cx(
                'shrink-0 rounded px-1.5 py-0.5 text-micro',
                entry.path === file?.path ? 'bg-accent-wash text-accent' : 'text-ink-faint hover:text-ink',
              )}
            >
              {entry.path.slice(entry.path.lastIndexOf('/') + 1)}
            </button>
          ))}
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {isPending ? (
          <p className="flex items-center gap-1.5 px-2.5 py-2 text-xs text-ink-faint">
            <Loader size={11} className="animate-spin" />
            {t('changes.diff.loading')}
          </p>
        ) : null}
        {error ? (
          <div className="p-2">
            <Banner>{error instanceof Error ? error.message : t('git.conflicts.error')}</Banner>
          </div>
        ) : null}
        {!isPending && files.length === 0 ? (
          <p className="px-2.5 py-3 text-xs text-ink-faint">{t('git.conflicts.none')}</p>
        ) : null}

        {file ? (
          <FileEditor
            key={file.path}
            file={file}
            oursLabel={data?.oursLabel ?? ''}
            theirsLabel={data?.theirsLabel ?? ''}
            frozen={frozen}
          />
        ) : null}
      </div>

      {files.length > 0 ? (
        <div className="flex shrink-0 items-center gap-2 border-t border-line px-2 py-2">
          <button
            type="button"
            disabled={threadId === null || rebasing || handing}
            title={rebasing ? t('git.conflicts.agentDuringRebase') : undefined}
            onClick={handOver}
            className="flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1.5 text-xs font-medium text-ink-soft hover:bg-surface-high disabled:opacity-45"
          >
            <Bot size={14} />
            {t('git.conflicts.handOver')}
          </button>
          {rebasing ? (
            <p className="min-w-0 flex-1 text-micro text-ink-faint">
              {t('git.conflicts.agentDuringRebase')}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

const originKey = (origin: string | null) =>
  origin === 'rebase'
    ? ('git.conflicts.origin.rebase' as const)
    : origin === 'cherry-pick'
      ? ('git.conflicts.origin.cherryPick' as const)
      : origin === 'revert'
        ? ('git.conflicts.origin.revert' as const)
        : ('git.conflicts.origin.merge' as const)

/**
 * Un fichier en conflit, bloc par bloc.
 *
 * Le résultat est composé **ici** et envoyé en entier : le serveur l'écrit tel quel,
 * après avoir refusé tout marqueur qui traînerait. Composer côté client et vérifier
 * côté serveur n'est pas une redondance — c'est le seul moyen que le fichier écrit
 * soit celui qu'on a vu.
 */
function FileEditor({
  file,
  oursLabel,
  theirsLabel,
  frozen,
}: {
  file: ConflictFileDto
  oursLabel: string
  theirsLabel: string
  frozen: boolean
}) {
  const t = useTranslate()
  const { run } = useGitActions()

  const blocks = file.segments.filter((segment) => segment.kind === 'conflict')
  /** Le texte retenu pour chaque bloc, dans l'ordre où ils apparaissent. */
  const [results, setResults] = useState<string[]>([])
  useEffect(() => {
    setResults(blocks.map((block) => (block.kind === 'conflict' ? block.ours.join('\n') : '')))
    // `blocks` est dérivé de `file`, qui est la vraie dépendance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file])

  const compose = (): string => {
    let index = -1
    return file.segments
      .map((segment) => {
        if (segment.kind === 'context') return segment.lines.join('\n')
        index += 1
        return results[index] ?? ''
      })
      .join('\n')
  }

  if (file.binary) {
    return (
      <p className="px-2.5 py-3 text-xs text-ink-faint">{t('git.conflicts.binary')}</p>
    )
  }

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-2 border-b border-line px-2.5 py-2">
        <p className="min-w-0 flex-1 truncate text-xs text-ink" title={file.path}>
          {file.path}
        </p>
        <span className="shrink-0 text-micro text-ink-faint">
          {t(blocks.length === 1 ? 'git.conflicts.blocksOne' : 'git.conflicts.blocks', {
            count: blocks.length,
          })}
        </span>
      </div>

      {blocks.map((block, index) =>
        block.kind === 'conflict' ? (
          <div key={index} className="flex flex-col gap-1.5 border-b border-line/60 p-2">
            <Version
              label={t('git.conflicts.ours', { name: oursLabel })}
              lines={block.ours}
              tone="ours"
              onTake={() =>
                setResults((current) =>
                  current.map((value, at) => (at === index ? block.ours.join('\n') : value)),
                )
              }
            />
            <Version
              label={t('git.conflicts.theirs', { name: theirsLabel })}
              lines={block.theirs}
              tone="theirs"
              onTake={() =>
                setResults((current) =>
                  current.map((value, at) => (at === index ? block.theirs.join('\n') : value)),
                )
              }
            />
            <div className="rounded-md border border-accent/60">
              <div className="flex items-center gap-2 border-b border-accent/30 px-2 py-1">
                <span className="min-w-0 flex-1 text-micro font-semibold text-accent">
                  {t('git.conflicts.result')}
                </span>
                <span className="shrink-0 text-micro text-ink-faint">
                  {t('git.conflicts.editable')}
                </span>
              </div>
              <textarea
                value={results[index] ?? ''}
                aria-label={t('git.conflicts.resultOf', { block: index + 1 })}
                onChange={(event) =>
                  setResults((current) =>
                    current.map((value, at) => (at === index ? event.target.value : value)),
                  )
                }
                rows={Math.min(12, Math.max(2, (results[index] ?? '').split('\n').length))}
                className="w-full resize-y bg-transparent px-2 py-1 font-mono text-meta whitespace-pre text-ink outline-none"
              />
            </div>
          </div>
        ) : null,
      )}

      <div className="flex items-center justify-end gap-2 p-2">
        <button
          type="button"
          disabled={frozen}
          onClick={() => run({ kind: 'conflict-resolve', path: file.path, content: compose() })}
          className="flex items-center gap-1.5 rounded-md bg-accent px-2.5 py-1.5 text-xs font-medium text-on-accent disabled:opacity-45"
        >
          <Check size={14} />
          {t('git.conflicts.markResolved')}
        </button>
      </div>
    </div>
  )
}

function Version({
  label,
  lines,
  tone,
  onTake,
}: {
  label: string
  lines: string[]
  tone: 'ours' | 'theirs'
  onTake: () => void
}) {
  const t = useTranslate()
  return (
    <div
      className={cx(
        'rounded-md border',
        tone === 'ours' ? 'border-accent/30 bg-accent-wash/40' : 'border-positive/30 bg-positive/8',
      )}
    >
      <div className="flex items-center gap-2 px-2 py-1">
        <span
          className={cx(
            'min-w-0 flex-1 truncate text-micro font-semibold',
            tone === 'ours' ? 'text-accent' : 'text-positive',
          )}
        >
          {label}
        </span>
        <button
          type="button"
          onClick={onTake}
          className="shrink-0 rounded border border-line bg-surface px-1.5 py-0.5 text-micro text-ink-soft hover:bg-surface-high"
        >
          {t('git.conflicts.take')}
        </button>
      </div>
      <pre className="overflow-x-auto px-2 pb-1 font-mono text-meta text-ink-soft">
        {lines.length > 0 ? lines.join('\n') : t('git.conflicts.emptySide')}
      </pre>
    </div>
  )
}

