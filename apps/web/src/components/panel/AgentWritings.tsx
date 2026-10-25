import { ChevronRight, Loader } from 'lucide-react'
import { useMemo, useState } from 'react'
import { cx } from '@solera/ui'
import type { EditTurn, EditedFile } from '../../lib/chat-fold'
import { parseUnifiedDiff } from '../../lib/diff'
import { useEditDiff } from '../../lib/edits'
import { languageFromPath } from '../../lib/highlight'
import { locale, translate, useTranslate } from '../../lib/i18n'
import { useManualSaves } from '../../lib/manual-edits'
import { DiffHunks } from '../DiffHunks'
import { HighlightedCode } from '../chat/HighlightedCode'
import { ACTIONS } from './diff-parts'

/** Heure seule : ces écritures ne couvrent qu'une conversation, jamais plusieurs jours. */
function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' })
}

/** Un fichier, et tous les tours qui l'ont touché, du plus récent au plus ancien. */
interface WrittenFile {
  path: string
  action: EditedFile['action']
  /** Dernière écriture, qui ordonne la liste et se compare à la reprise manuelle. */
  ts: number
  passes: number
  turns: { id: string; rank: number; label: string; ts: number; toolCallIds: string[] }[]
}

/**
 * Regroupe les tours par fichier.
 *
 * L'onglet *Historique* montrait l'inverse — les tours, et sous chacun ses fichiers.
 * C'était le bon axe pour relire une séance, et le mauvais pour la question qu'on se
 * pose vraiment devant un panneau : « qu'est-il arrivé à ce fichier ». Un fichier
 * repris quatre fois en trois tours apparaissait quatre fois, à quatre endroits.
 */
function groupByFile(turns: EditTurn[]): WrittenFile[] {
  const files = new Map<string, WrittenFile>()

  turns.forEach((turn, index) => {
    for (const file of turn.files) {
      const entry = files.get(file.path) ?? {
        path: file.path,
        action: file.action,
        ts: turn.ts,
        passes: 0,
        turns: [],
      }
      // L'action la plus récente l'emporte : un fichier créé puis supprimé est
      // supprimé, et le montrer comme créé serait faux.
      entry.action = file.action
      entry.ts = Math.max(entry.ts, turn.ts)
      entry.passes += file.toolCallIds.length
      entry.turns.unshift({
        id: turn.id,
        rank: index + 1,
        // Un tour sans message a un libellé vide : le fold ne parle aucune langue.
        label: turn.label || translate('activity.turn.noMessage'),
        ts: turn.ts,
        toolCallIds: file.toolCallIds,
      })
      files.set(file.path, entry)
    }
  })

  return [...files.values()].sort((a, b) => b.ts - a.ts)
}

/**
 * Ce que l'agent a écrit dans cette conversation, fichier par fichier.
 *
 * Dérivé du journal, et non du dépôt : c'est un passé, pas un état. Le disque a pu
 * changer depuis, l'agent peut avoir commité, et rien de ce qui est listé ici n'est
 * forcément encore vrai. La vue *Git* répond à l'autre question.
 */
export function AgentWritings({ conversationId, scope, turns, onOpenFile }: {
  conversationId: string
  /** Répertoire de travail du fil : c'est là que se lisent les reprises à la main. */
  scope: string
  turns: EditTurn[]
  /** Bascule sur les fichiers : ouvrir un onglet sans le montrer paraît sans effet. */
  onOpenFile: (path: string) => void
}) {
  const t = useTranslate()
  const manualSaveAt = useManualSaves(scope)
  const files = useMemo(() => groupByFile(turns), [turns])

  if (files.length === 0) return null

  return (
    <section>
      <h3 className="px-2.5 pt-2 pb-1 text-micro font-semibold tracking-wide text-ink-faint uppercase">
        {t('changes.writings.title', { count: files.length })}
      </h3>
      <ul>
        {files.map((file) => (
          <li key={file.path}>
            <WrittenFileRow
              conversationId={conversationId}
              file={file}
              manualSaveAt={manualSaveAt(file.path)}
              onOpenFile={onOpenFile}
            />
          </li>
        ))}
      </ul>
    </section>
  )
}

function WrittenFileRow({ conversationId, file, manualSaveAt, onOpenFile }: {
  conversationId: string
  file: WrittenFile
  manualSaveAt: number | null
  onOpenFile: (path: string) => void
}) {
  const t = useTranslate()
  const [open, setOpen] = useState(false)
  /** Repris après lui, et pas seulement repris : une correction antérieure n'apprend rien. */
  const rewritten = manualSaveAt !== null && manualSaveAt > file.ts

  return (
    <div className="border-b border-line/60">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left hover:bg-surface-high"
      >
        <ChevronRight
          size={14}
          className={cx('shrink-0 text-ink-faint transition-transform', open && 'rotate-90')}
        />
        <span className={cx('shrink-0', ACTIONS[file.action].tone)}>{ACTIONS[file.action].icon}</span>
        <span
          className={cx(
            'min-w-0 flex-1 truncate text-sm',
            file.action === 'deleted' ? 'text-ink-faint line-through' : 'text-ink-soft',
          )}
          title={file.path}
        >
          {file.path.split('/').pop()}
        </span>
        <span className="shrink-0 text-micro text-ink-faint">
          {t('changes.file.passes', { count: file.passes })} · {formatTime(file.ts)}
        </span>
      </button>

      {open ? (
        <div className="border-t border-line/60">
          <ul className="ml-5 border-l border-line/60">
            {file.turns.map((turn) => (
              <li key={turn.id}>
                <WrittenTurn
                  conversationId={conversationId}
                  path={file.path}
                  rank={turn.rank}
                  label={turn.label}
                  toolCallIds={turn.toolCallIds}
                />
              </li>
            ))}

            {/* La reprise à la main se lit dans la même colonne que les tours, et
                après eux : c'est le dernier état du fichier, et c'est le seul qui ne
                vienne pas de l'agent. */}
            {rewritten ? (
              <li className="flex items-center gap-1.5 py-1 pr-2 pl-3 text-xs">
                <span className="size-1.5 shrink-0 rounded-full border border-caution" />
                <span className="min-w-0 flex-1 truncate text-ink-soft">
                  {t('changes.writings.manual')}
                </span>
                <span className="shrink-0 text-micro text-caution">{formatTime(manualSaveAt)}</span>
              </li>
            ) : null}
          </ul>

          {/* Un fichier supprimé n'a plus rien à ouvrir : l'action disparaît plutôt
              que d'ouvrir un onglet en erreur. */}
          {file.action === 'deleted' ? null : (
            <button
              type="button"
              onClick={() => onOpenFile(file.path)}
              className="px-2.5 py-1.5 text-meta text-ink-faint underline hover:text-ink"
            >
              {t('changes.file.open')}
            </button>
          )}
        </div>
      ) : null}
    </div>
  )
}

/**
 * Un tour qui a touché ce fichier, dépliable sur ce qu'il y a fait.
 *
 * Le décompte `+n −m` n'est connu qu'une fois le diff lu, et le diff ne peut pas venir
 * de git : le disque a continué d'évoluer depuis. Il est reconstitué depuis le payload
 * natif de chaque appel, ce qui limite ce qu'on peut en dire (voir `EditDiffDto`), mais
 * reste la seule source fidèle à ce moment-là.
 */
function WrittenTurn({ conversationId, path, rank, label, toolCallIds }: {
  conversationId: string
  path: string
  rank: number
  label: string
  toolCallIds: string[]
}) {
  const t = useTranslate()
  const [open, setOpen] = useState(false)

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 py-1 pr-2 pl-3 text-left hover:bg-surface-high"
      >
        <ChevronRight
          size={11}
          className={cx('shrink-0 text-ink-faint transition-transform', open && 'rotate-90')}
        />
        <span className="min-w-0 flex-1 truncate text-xs text-ink-soft" title={label}>
          {t('changes.writings.turn', { rank, label })}
        </span>
        <TurnStat conversationId={conversationId} toolCallIds={toolCallIds} path={path} />
      </button>

      {open ? (
        <div className="border-y border-line/60 bg-sunken/40">
          {toolCallIds.map((toolCallId, index) => (
            <EditDiff
              key={toolCallId}
              conversationId={conversationId}
              toolCallId={toolCallId}
              path={path}
              rank={toolCallIds.length > 1 ? index + 1 : null}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}

/**
 * `+n −m` pour un tour, somme de ses passes sur ce fichier.
 *
 * Une requête par appel d'outil, et seulement une fois le fichier déplié : les lire
 * d'avance demanderait au serveur de reconstituer chaque modification de la
 * conversation entière pour afficher deux nombres.
 */
function TurnStat({ conversationId, toolCallIds, path }: {
  conversationId: string
  toolCallIds: string[]
  path: string
}) {
  return (
    <span className="flex shrink-0 items-center gap-1 font-mono text-micro">
      {toolCallIds.map((toolCallId) => (
        <EditStat key={toolCallId} conversationId={conversationId} toolCallId={toolCallId} path={path} />
      ))}
    </span>
  )
}

function EditStat({ conversationId, toolCallId, path }: {
  conversationId: string
  toolCallId: string
  path: string
}) {
  const { data } = useEditDiff(conversationId, toolCallId, path)
  const stat = useMemo(() => {
    if (data?.kind !== 'patch') return null
    let added = 0
    let removed = 0
    for (const line of data.patch.split('\n')) {
      if (line.startsWith('+') && !line.startsWith('+++')) added += 1
      else if (line.startsWith('-') && !line.startsWith('---')) removed += 1
    }
    return { added, removed }
  }, [data])

  if (!stat) return null
  return (
    <>
      {stat.added > 0 ? <span className="text-positive">+{stat.added}</span> : null}
      {stat.removed > 0 ? <span className="text-critical">−{stat.removed}</span> : null}
    </>
  )
}

/** Une modification, telle que le payload de son appel permet de la reconstituer. */
function EditDiff({ conversationId, toolCallId, path, rank }: {
  conversationId: string
  toolCallId: string
  path: string
  /** Rang de la passe, quand le fichier a été repris plusieurs fois dans le tour. */
  rank: number | null
}) {
  const t = useTranslate()
  const { data, error, isPending } = useEditDiff(conversationId, toolCallId, path)
  const files = useMemo(() => (data?.kind === 'patch' ? parseUnifiedDiff(data.patch) : []), [data])

  if (isPending) {
    return (
      <p className="flex items-center gap-1.5 px-2.5 py-1.5 text-meta text-ink-faint">
        <Loader size={11} className="animate-spin" />
        {t('changes.edit.loading')}
      </p>
    )
  }

  if (error || !data) {
    return (
      <p className="px-2.5 py-1.5 text-meta text-critical">
        {error instanceof Error ? error.message : t('changes.edit.error')}
      </p>
    )
  }

  return (
    <div>
      {rank === null && !data.partial && data.kind === 'patch' ? null : (
        <p className="px-2.5 pt-1.5 text-micro text-ink-faint">
          {[
            rank === null ? null : t('changes.edit.pass', { rank }),
            data.partial ? t('changes.edit.partial') : null,
            data.reason,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
      )}

      {files.map((entry) => (
        <DiffHunks key={entry.path} hunks={entry.hunks} path={path} />
      ))}

      {/* Un contenu écrit reste du code : il se colore comme le reste, même sans
          diff auquel le comparer. */}
      {data.kind === 'content' ? (
        <HighlightedCode
          code={data.content}
          language={languageFromPath(path)}
          className="px-2.5 py-1.5 font-mono text-meta text-ink-soft"
        />
      ) : null}
    </div>
  )
}
