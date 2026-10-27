import { useMemo, useState } from 'react'
import { Check } from 'lucide-react'
import type { LineSelection } from '@solera/protocol'
import type { DiffFile } from '../../../lib/diff'
import { highlight, languageFromPath, useHighlighterReady } from '../../../lib/highlight'
import { useTranslate } from '../../../lib/i18n'
import { cx } from '@solera/ui'
import { useGitActions } from './actions'

/**
 * Indexer **par bloc et par ligne** (planche T3).
 *
 * Un composant à part de `DiffHunks`, qui est partagé avec l'onglet des modifications
 * et avec les rendus d'outils : y poser des cases à cocher les ferait apparaître là où
 * il n'y a rien à indexer. Ici le diff n'est pas une illustration, c'est un formulaire.
 *
 * Ce que le client envoie n'est **pas du texte** mais des positions — rang du bloc,
 * rangs des lignes — accompagnées de l'en-tête du bloc tel qu'il était à l'écran. Le
 * serveur relit le diff, compare l'en-tête, et refuse s'il a bougé : entre l'affichage
 * et le clic, un agent a pu écrire dans le fichier. Reconstruire le patch côté client
 * aurait voulu dire envoyer du texte à appliquer sur un disque qu'on ne regarde plus.
 *
 * Le compteur du bouton suit la sélection, et le reste du fichier reste dehors : c'est
 * la phrase de la planche, et c'est ce qui rend le geste lisible.
 */
export function LineStage({
  file,
  path,
  staged,
  frozen,
}: {
  file: DiffFile
  path: string
  /** Vrai dans la section *Indexés* : le geste est alors le retrait. */
  staged: boolean
  frozen: boolean
}) {
  const t = useTranslate()
  const { run } = useGitActions()
  const ready = useHighlighterReady()
  const language = languageFromPath(path)

  /** Les lignes cochées, par bloc. La clé est le rang du bloc dans le diff du fichier. */
  const [picked, setPicked] = useState<Record<number, number[]>>({})

  const total = useMemo(
    () => Object.values(picked).reduce((sum, lines) => sum + lines.length, 0),
    [picked],
  )

  const toggle = (hunk: number, line: number): void => {
    setPicked((current) => {
      const lines = current[hunk] ?? []
      const next = lines.includes(line)
        ? lines.filter((value) => value !== line)
        : [...lines, line]
      return { ...current, [hunk]: next }
    })
  }

  /** Cocher un bloc entier, qui est le geste le plus courant des deux. */
  const toggleHunk = (hunk: number): void => {
    const changed = (file.hunks[hunk]?.lines ?? [])
      .map((line, index) => ({ line, index }))
      .filter(({ line }) => line.kind === 'added' || line.kind === 'removed')
      .map(({ index }) => index)
    setPicked((current) => ({
      ...current,
      [hunk]: (current[hunk]?.length ?? 0) === changed.length ? [] : changed,
    }))
  }

  const apply = (): void => {
    const selections: LineSelection[] = Object.entries(picked)
      .filter(([, lines]) => lines.length > 0)
      .map(([hunk, lines]) => ({
        hunk: Number(hunk),
        header: file.hunks[Number(hunk)]?.header ?? '',
        lines: [...lines].sort((a, b) => a - b),
      }))
      // Les blocs partent dans l'ordre : un patch dont les blocs se croisent est un
      // patch que `git apply` refuse.
      .sort((a, b) => a.hunk - b.hunk)
    if (selections.length === 0) return
    run({ kind: staged ? 'unstage-lines' : 'stage-lines', path, selections })
    setPicked({})
  }

  return (
    <div className="flex flex-col">
      {file.hunks.map((hunk, hunkIndex) => (
        <div key={hunk.header} className="overflow-x-auto">
          <div className="flex items-center gap-2 bg-surface-high px-2.5 py-1">
            <p className="min-w-0 flex-1 truncate font-mono text-micro text-ink-faint">
              {hunk.header}
            </p>
            <button
              type="button"
              disabled={frozen}
              onClick={() => toggleHunk(hunkIndex)}
              className="shrink-0 rounded px-1.5 py-0.5 text-micro text-accent hover:bg-accent-wash disabled:opacity-45"
            >
              {staged ? t('git.lines.unstageHunk') : t('git.lines.stageHunk')}
            </button>
          </div>

          <table className="w-full border-collapse font-mono text-meta">
            <tbody>
              {hunk.lines.map((line, index) => {
                const changed = line.kind === 'added' || line.kind === 'removed'
                const on = (picked[hunkIndex] ?? []).includes(index)
                return (
                  <tr
                    key={index}
                    className={cx(
                      line.kind === 'added' && 'bg-positive/12',
                      line.kind === 'removed' && 'bg-critical/12',
                    )}
                  >
                    {/* La case tient la place même sur une ligne de contexte : sans
                        elle, le code sauterait d'un demi-centimètre d'une ligne à
                        l'autre et le diff deviendrait illisible. */}
                    <td className="w-6 px-1 text-center select-none">
                      {changed ? (
                        <button
                          type="button"
                          disabled={frozen}
                          aria-pressed={on}
                          aria-label={t('git.lines.toggle', { line: line.text.trim() || ' ' })}
                          onClick={() => toggle(hunkIndex, index)}
                          className={cx(
                            'flex size-3.5 items-center justify-center rounded-full border disabled:opacity-45',
                            on ? 'border-accent bg-accent text-on-accent' : 'border-line',
                          )}
                        >
                          {on ? <Check size={9} /> : null}
                        </button>
                      ) : null}
                    </td>
                    <td className="w-8 border-r border-line/60 px-1 text-right text-ink-faint/70 select-none">
                      {line.before ?? ''}
                    </td>
                    <td className="w-8 border-r border-line/60 px-1 text-right text-ink-faint/70 select-none">
                      {line.after ?? ''}
                    </td>
                    <td className="px-1.5 whitespace-pre text-ink-soft">
                      {line.kind === 'added' ? '+' : line.kind === 'removed' ? '-' : ' '}
                      <Code text={line.text} language={ready ? language : ''} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ))}

      {/* Le bouton n'apparaît qu'une fois quelque chose coché : il est la conséquence
          de la sélection, et un bouton éteint en permanence sous chaque fichier
          n'apprendrait qu'à ne plus le regarder. */}
      {total > 0 ? (
        <div className="flex items-center justify-end gap-2 border-t border-line/60 px-2.5 py-1.5">
          <button
            type="button"
            onClick={() => setPicked({})}
            className="rounded px-1.5 py-1 text-micro text-ink-faint hover:text-ink"
          >
            {t('git.lines.clear')}
          </button>
          <button
            type="button"
            disabled={frozen}
            onClick={apply}
            className="rounded-md bg-accent px-2 py-1 text-micro font-medium text-on-accent disabled:opacity-45"
          >
            {t(
              staged
                ? total === 1
                  ? 'git.lines.unstageOne'
                  : 'git.lines.unstage'
                : total === 1
                  ? 'git.lines.stageOne'
                  : 'git.lines.stage',
              { count: total },
            )}
          </button>
        </div>
      ) : null}
    </div>
  )
}

/**
 * Même rendu qu'un diff ordinaire : une ligne à la fois, `ignoreIllegals` compris.
 *
 * L'objet `__html` est mémoïsé comme dans `HighlightedCode` : React réécrit `innerHTML`
 * dès que l'objet change, même à texte égal. Le langage reste vide tant que la
 * bibliothèque n'est pas là, ce qui suffit à relancer la coloration à son arrivée.
 */
function Code({ text, language }: { text: string; language: string }) {
  const markup = useMemo(() => {
    const rendered = highlight(text, language)
    return rendered.applied ? { __html: rendered.html } : null
  }, [text, language])
  return markup ? (
    <span className="hljs" dangerouslySetInnerHTML={markup} />
  ) : (
    <>{text}</>
  )
}
