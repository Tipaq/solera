import { CaseSensitive, ChevronRight, Loader, Regex, Search, WholeWord, X } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Button, ConfirmDialog, IconButton, TooltipButton, cx } from '@solera/ui'
import type { ContentFileDto } from '@solera/protocol'
import { ApiRequestError } from '../../lib/api'
import { revealLine } from '../../lib/editor-reveal'
import { fileIconUrl } from '../../lib/file-icons'
import { useTranslate } from '../../lib/i18n'
import { useDebounced } from '../../lib/search'
import { useFileSearch } from '../../lib/tree'
import {
  EMPTY_CRITERIA,
  replaceAll,
  useContentSearch,
  type SearchCriteria,
} from '../../lib/workspace-search'

/**
 * Chercher dans le répertoire de travail, par nom **et** par contenu.
 *
 * Vue à part et non champ de l'arborescence : filtrer un arbre oblige à replier et
 * déplier des dossiers pour suivre un résultat, et à perdre les niveaux qu'on avait
 * ouverts. Une recherche a ses propres résultats, son propre défilement, et ne doit
 * rien à la forme de l'arbre.
 *
 * Les deux marches sont indépendantes — l'une lit des noms, l'autre ouvre des fichiers
 * — et chacune peut être tronquée sans l'autre. Elles se présentent sous deux titres
 * pour cette raison, et pas seulement pour la mise en page.
 */
export function SearchPane({ scope, onOpenFile }: {
  scope: string
  onOpenFile: (path: string) => void
}) {
  const t = useTranslate()
  const [criteria, setCriteria] = useState<SearchCriteria>(EMPTY_CRITERIA)
  const [replacement, setReplacement] = useState('')
  const [replacing, setReplacing] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [done, setDone] = useState<{ files: number; matches: number } | null>(null)
  /**
   * La ligne de remplacement est repliée par défaut, comme dans VS Code : c'est le
   * geste rare, et le seul de cette vue qui écrit dans des fichiers qu'on n'a pas
   * ouverts. La déplier est le premier des trois temps du geste.
   */
  const [replaceOpen, setReplaceOpen] = useState(false)

  const settled = useDebounced(criteria, 220)
  const ready = settled.query.trim().length >= 2
  const effective = useMemo(() => (ready ? settled : EMPTY_CRITERIA), [ready, settled])

  const names = useFileSearch(scope, ready ? settled.query.trim() : '')
  const content = useContentSearch(scope, effective)

  const nameEntries = (names.data?.entries ?? []).filter((entry) => !entry.isDirectory)
  const files = content.data?.files ?? []
  const matchCount = content.data?.totalMatches ?? 0
  const pending = ready && (settled !== criteria || content.isPending || names.isPending)
  /** Une expression régulière fautive est une faute de frappe, pas une panne. */
  const invalidRegex =
    content.error instanceof ApiRequestError && content.error.code === 'invalid_regex'
      ? content.error.message
      : null

  // Ce qui est affiché montre l'avant : changer le critère périme le compte rendu.
  useEffect(() => setDone(null), [criteria])

  const set = (patch: Partial<SearchCriteria>) =>
    setCriteria((current) => ({ ...current, ...patch }))

  const apply = async () => {
    setReplacing(true)
    try {
      setDone(await replaceAll(scope, effective, replacement))
      // Fermée seulement après l'écriture : la refermer d'abord ferait croire que le
      // geste a abouti alors qu'il peut encore échouer, et l'erreur n'aurait plus de
      // boîte où s'afficher. `ConfirmDialog` ne se ferme pas tout seul, exprès.
      setConfirming(false)
      await content.refetch()
    } finally {
      setReplacing(false)
    }
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col pb-safe">
      <div className="flex shrink-0 gap-1 p-2">
        <TooltipButton
          type="button"
          aria-label={t(replaceOpen ? 'panel.search.replace.hide' : 'panel.search.replace.show')}
          aria-expanded={replaceOpen}
          onClick={() => setReplaceOpen((value) => !value)}
          className="mt-1 flex size-6 shrink-0 items-center justify-center rounded text-ink-faint hover:text-ink"
        >
          <ChevronRight size={14} className={cx('transition-transform', replaceOpen && 'rotate-90')} />
        </TooltipButton>

        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className={cx(
            'flex items-center gap-1 rounded-md border bg-sunken pr-1 pl-2',
            invalidRegex ? 'border-critical' : 'border-line focus-within:border-accent',
          )}>
            <Search size={14} className="shrink-0 text-ink-faint" />
            <input
              type="search"
              value={criteria.query}
              onChange={(event) => set({ query: event.target.value })}
              onKeyDown={(event) => { if (event.key === 'Escape') set({ query: '' }) }}
              placeholder={t('panel.search.placeholder')}
              aria-label={t('panel.search.label')}
              aria-invalid={invalidRegex ? true : undefined}
              maxLength={500}
              className="h-9 min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-faint"
            />
            <Flag label={t('panel.search.caseSensitive')} on={criteria.caseSensitive}
              onToggle={() => set({ caseSensitive: !criteria.caseSensitive })}>
              <CaseSensitive size={14} />
            </Flag>
            <Flag label={t('panel.search.wholeWord')} on={criteria.wholeWord}
              onToggle={() => set({ wholeWord: !criteria.wholeWord })}>
              <WholeWord size={14} />
            </Flag>
            <Flag label={t('panel.search.regex')} on={criteria.regex}
              onToggle={() => set({ regex: !criteria.regex })}>
              <Regex size={14} />
            </Flag>
          </div>

          {replaceOpen ? (
            <div className="flex gap-1.5">
              <input
                value={replacement}
                onChange={(event) => setReplacement(event.target.value)}
                placeholder={t('panel.search.replace.placeholder')}
                aria-label={t('panel.search.replace.placeholder')}
                maxLength={500}
                className="h-9 min-w-0 flex-1 rounded-md border border-line bg-sunken px-2 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-accent"
              />
              {/* Désarmé tant qu'il n'y a rien à remplacer : un bouton cliquable sur
                  zéro résultat se lirait comme une panne. */}
              <Button
                size="sm"
                variant="secondary"
                disabled={!ready || replacing || files.length === 0 || Boolean(invalidRegex)}
                onClick={() => setConfirming(true)}
              >
                {replacing ? <Loader size={14} className="animate-spin" /> : null}
                {t('panel.search.replace.all')}
              </Button>
            </div>
          ) : null}

          <div className="flex gap-1.5">
            <Filter value={criteria.include} onChange={(value) => set({ include: value })}
              placeholder={t('panel.search.include')} clearLabel={t('panel.search.clear')} />
            <Filter value={criteria.exclude} onChange={(value) => set({ exclude: value })}
              placeholder={t('panel.search.exclude')} clearLabel={t('panel.search.clear')} />
          </div>
        </div>
      </div>

      {invalidRegex ? (
        <p role="alert" className="shrink-0 px-3 pb-2 text-xs text-critical">{invalidRegex}</p>
      ) : null}

      {done ? (
        <p role="status" className="shrink-0 border-y border-line bg-accent-wash px-3 py-1.5 text-xs text-ink-soft">
          {t('panel.search.replace.done', done)}
        </p>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {!ready ? (
          <p role="status" className="px-3 py-2 text-xs text-ink-faint">{t('panel.search.start')}</p>
        ) : pending ? (
          <p role="status" className="flex items-center gap-1.5 px-3 py-2 text-xs text-ink-faint">
            <Loader size={11} className="animate-spin" />
            {t('panel.search.loading')}
          </p>
        ) : content.isError && !invalidRegex ? (
          <div role="alert" className="flex items-center gap-2 px-3 py-2 text-xs text-critical">
            {content.error instanceof Error ? content.error.message : t('panel.search.error')}
            <Button size="sm" variant="ghost" onClick={() => void content.refetch()}>{t('editor.retry')}</Button>
          </div>
        ) : nameEntries.length === 0 && files.length === 0 ? (
          <p role="status" className="px-3 py-2 text-xs text-ink-faint">{t('panel.search.empty')}</p>
        ) : (
          <>
            {/* Trois fragments plutôt qu'une phrase à trous : « 1 résultats dans 1
                fichiers » se lit mal, et le singulier ne se devine pas depuis un
                gabarit. La section des noms disparaît du compte quand elle est vide. */}
            <p role="status" className="px-3 pt-1.5 pb-1 text-xs text-ink-faint">
              {[
                t(matchCount === 1 ? 'panel.search.count.one' : 'panel.search.count.many', { count: matchCount }),
                t(files.length === 1 ? 'panel.search.files.one' : 'panel.search.files.many', { count: files.length }),
              ].join(' ')}
              {nameEntries.length > 0
                ? ` · ${t(nameEntries.length === 1 ? 'panel.search.names.one' : 'panel.search.names.many', { count: nameEntries.length })}`
                : null}
              {content.data?.truncated || names.data?.truncated
                ? ` · ${t('panel.search.truncated')}`
                : null}
            </p>

            {nameEntries.length > 0 ? (
              <>
                <Section>{t('panel.search.section.names')}</Section>
                <ul data-search-results>
                  {nameEntries.map((entry) => (
                    <li key={entry.path}>
                      <button
                        type="button"
                        onClick={() => onOpenFile(entry.path)}
                        className="flex min-h-8 w-full items-center gap-2 px-3 py-1 text-left hover:bg-surface-high"
                      >
                        <img src={fileIconUrl(entry.name, false)} alt="" className="size-4 shrink-0" />
                        <span className="min-w-0 flex-1 truncate text-sm text-ink-soft">{entry.name}</span>
                        <span className="min-w-0 shrink truncate text-meta text-ink-faint" title={entry.path}>
                          {entry.path.split('/').slice(0, -1).join('/')}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}

            {files.length > 0 ? (
              <>
                <Section>{t('panel.search.section.content')}</Section>
                <ul data-search-content>
                  {files.map((file) => (
                    <li key={file.path}>
                      <FileMatches file={file} scope={scope} onOpen={onOpenFile} />
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </>
        )}
      </div>

      {/* Le seul geste de cette vue qui écrit dans des fichiers qu'on n'a pas ouverts :
          il se confirme, et la confirmation dit combien de fichiers vont changer. */}
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t('panel.search.replace.confirm.title')}
        confirmLabel={t('panel.search.replace.all')}
        tone="critical"
        busy={replacing}
        onConfirm={() => void apply()}
      >
        <p>
          {t('panel.search.replace.confirm.body', { matches: matchCount, files: files.length })}
        </p>
        <p className="font-mono text-xs break-all text-ink">
          {criteria.query} → {replacement || '∅'}
        </p>
        <p>{t('panel.search.replace.confirm.note')}</p>
      </ConfirmDialog>
    </div>
  )
}

function Section({ children }: { children: string }) {
  return (
    <p className="px-3 pt-2 pb-1 text-micro font-semibold tracking-wide text-ink-faint uppercase">
      {children}
    </p>
  )
}

/** Un des trois drapeaux du champ, dans l'ordre de VS Code. */
function Flag({ label, on, onToggle, children }: {
  label: string
  on: boolean
  onToggle: () => void
  children: ReactNode
}) {
  return (
    <TooltipButton
      type="button"
      aria-label={label}
      aria-pressed={on}
      onClick={onToggle}
      className={cx(
        'flex size-7 shrink-0 items-center justify-center rounded',
        on ? 'bg-accent-wash text-accent' : 'text-ink-faint hover:text-ink',
      )}
    >
      {children}
    </TooltipButton>
  )
}

/** Inclure ou exclure : une liste de motifs séparés par des virgules. */
function Filter({ value, onChange, placeholder, clearLabel }: {
  value: string
  onChange: (value: string) => void
  placeholder: string
  clearLabel: string
}) {
  return (
    <div className="flex min-w-0 flex-1 items-center rounded-md border border-line bg-sunken pr-1 focus-within:border-accent">
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        maxLength={500}
        className="h-8 min-w-0 flex-1 bg-transparent px-2 text-xs text-ink outline-none placeholder:text-ink-faint"
      />
      {value ? (
        <IconButton size="sm" label={clearLabel} onClick={() => onChange('')}>
          <X size={12} />
        </IconButton>
      ) : null}
    </div>
  )
}

/**
 * Un fichier et ses correspondances, repliable.
 *
 * Déplié par défaut, contrairement à l'arborescence : on vient ici pour lire des
 * lignes, pas pour parcourir une liste de fichiers. Le repli sert à écarter ce qu'on a
 * déjà vu, ce qui n'a de sens qu'une fois les lignes lues.
 */
function FileMatches({ file, scope, onOpen }: {
  file: ContentFileDto
  scope: string
  onOpen: (path: string) => void
}) {
  const t = useTranslate()
  const [open, setOpen] = useState(true)
  const name = file.path.split('/').pop() ?? file.path
  const parent = file.path.split('/').slice(0, -1).join('/')

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex min-h-8 w-full items-center gap-1.5 px-2 py-1 text-left hover:bg-surface-high"
      >
        <ChevronRight size={13} className={cx('shrink-0 text-ink-faint transition-transform', open && 'rotate-90')} />
        <img src={fileIconUrl(name, false)} alt="" className="size-4 shrink-0" />
        <span className="shrink-0 truncate text-sm text-ink-soft">{name}</span>
        <span className="min-w-0 flex-1 truncate text-meta text-ink-faint" title={file.path}>{parent}</span>
        <span className="shrink-0 rounded-full bg-surface-high px-1.5 text-micro tabular-nums text-ink-faint">
          {file.total}
        </span>
      </button>

      {open ? (
        <ul>
          {file.matches.map((match) => (
            <li key={`${match.line}:${match.ranges[0]?.[0] ?? 0}`}>
              <button
                type="button"
                onClick={() => {
                  // La ligne d'abord : l'éditeur peut déjà afficher ce fichier, auquel
                  // cas l'ouverture ne déclenche rien et seule la cible le fait bouger.
                  revealLine(scope, file.path, match.line)
                  onOpen(file.path)
                }}
                className="flex w-full items-baseline gap-2 py-0.5 pr-2 pl-7 text-left font-mono text-meta hover:bg-surface-high"
              >
                <span className="w-10 shrink-0 text-right text-ink-faint tabular-nums">{match.line}</span>
                <span className="min-w-0 flex-1 truncate text-ink-soft">
                  {match.trimmedStart ? <span className="text-ink-faint">…</span> : null}
                  {highlight(match.text, match.ranges)}
                </span>
              </button>
            </li>
          ))}
          {file.total > file.matches.length ? (
            <li className="py-0.5 pr-2 pl-7 text-micro text-ink-faint">
              {t('panel.search.more', { count: file.total - file.matches.length })}
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  )
}

/**
 * L'extrait, avec ses correspondances marquées.
 *
 * Découpé sur les décalages rendus par le serveur plutôt que par une expression
 * rejouée ici : c'est lui qui a trouvé, et refaire la recherche côté client ferait
 * deux vérités le jour où une règle changerait d'un seul côté.
 */
function highlight(text: string, ranges: [number, number][]): ReactNode[] {
  const parts: ReactNode[] = []
  let at = 0
  ranges.forEach(([from, to], index) => {
    if (from > at) parts.push(text.slice(at, from))
    parts.push(
      <mark key={index} className="rounded-sm bg-caution/30 text-ink">
        {text.slice(from, to)}
      </mark>,
    )
    at = to
  })
  if (at < text.length) parts.push(text.slice(at))
  return parts
}
