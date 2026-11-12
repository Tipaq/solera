import { ChevronRight, Loader, Replace, Search, X } from 'lucide-react'
import { memo, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  ConfirmDialog,
  IconButton,
  PanelGroup,
  PanelNotice,
  PanelToolbar,
  TooltipButton,
  cx,
  panelGestureClass,
  panelRowClass,
  panelToolClass,
} from '@solera/ui'
import type { ContentFileDto } from '@solera/protocol'
import { ApiRequestError } from '../../lib/api'
import { revealLine } from '../../lib/editor-reveal'
import { fileIconUrl } from '../../lib/file-icons'
import { useTranslate } from '../../lib/i18n'
import { useDebounced } from '../../lib/search'
import { useFileSearch } from '../../lib/tree'
import { iconToolClass, toolbarFieldClass } from '../toolbar/OneLineToolbar'
import { FilterMenu, MenuCheck, MenuHeading } from '../toolbar/ToolbarMenus'
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
export const SearchPane = memo(function SearchPane({ scope, onOpenFile }: {
  scope: string
  onOpenFile: (path: string) => void
}) {
  const t = useTranslate()
  const [criteria, setCriteria] = useState<SearchCriteria>(EMPTY_CRITERIA)
  const [replacement, setReplacement] = useState('')
  const [replacing, setReplacing] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [done, setDone] = useState<{ files: number; matches: number } | null>(null)
  const [replaceError, setReplaceError] = useState<string | null>(null)
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

  /** Une panne, elle : dans la bande commune, avec de quoi réessayer. */
  const failed = ready && !pending && content.isError && !invalidRegex

  // Ce qui est affiché montre l'avant : changer le critère périme le compte rendu.
  useEffect(() => setDone(null), [criteria])

  const activeFilters = [
    criteria.caseSensitive,
    criteria.wholeWord,
    criteria.regex,
    criteria.include.trim() !== '',
    criteria.exclude.trim() !== '',
  ].filter(Boolean).length

  const set = (patch: Partial<SearchCriteria>) =>
    setCriteria((current) => ({ ...current, ...patch }))

  const apply = async () => {
    setReplacing(true)
    setReplaceError(null)
    try {
      setDone(await replaceAll(scope, effective, replacement))
      // Fermée seulement après l'écriture : la refermer d'abord ferait croire que le
      // geste a abouti alors qu'il peut encore échouer, et l'erreur n'aurait plus de
      // boîte où s'afficher. `ConfirmDialog` ne se ferme pas tout seul, exprès.
      setConfirming(false)
      await content.refetch()
    } catch (error) {
      // La boîte reste ouverte : c'est là que l'échec se lit, à côté du geste qui l'a causé.
      setReplaceError(error instanceof Error ? error.message : t('panel.search.replace.error'))
    } finally {
      setReplacing(false)
    }
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col pb-safe">
      {/* Une seule ligne, comme les autres onglets : le champ tient lieu de titre — c'est
          tout l'objet de la vue —, les drapeaux et les motifs de fichiers passent dans
          « Filtrer ▾ », et Remplacer reste un geste à part qui déplie sa propre ligne. */}
      <PanelToolbar>
        <label className={cx(toolbarFieldClass(Boolean(invalidRegex)), 'flex-1 transition-colors')}>
          <Search size={16} className="shrink-0" />
          <input
            type="search"
            value={criteria.query}
            onChange={(event) => set({ query: event.target.value })}
            onKeyDown={(event) => { if (event.key === 'Escape') set({ query: '' }) }}
            placeholder={t('panel.search.placeholder')}
            aria-label={t('panel.search.label')}
            aria-invalid={invalidRegex ? true : undefined}
            maxLength={500}
            className="min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-ink-soft"
          />
        </label>
        <FilterMenu
          compact
          active={activeFilters}
          onClearAll={() => set({ ...EMPTY_CRITERIA, query: criteria.query })}
        >
          <MenuHeading>{t('panel.search.filter.match')}</MenuHeading>
          <MenuCheck checked={criteria.caseSensitive} onChange={(next) => set({ caseSensitive: next })}>
            {t('panel.search.caseSensitive')}
          </MenuCheck>
          <MenuCheck checked={criteria.wholeWord} onChange={(next) => set({ wholeWord: next })}>
            {t('panel.search.wholeWord')}
          </MenuCheck>
          <MenuCheck checked={criteria.regex} onChange={(next) => set({ regex: next })}>
            {t('panel.search.regex')}
          </MenuCheck>
          <MenuHeading>{t('panel.search.filter.files')}</MenuHeading>
          <div className="flex flex-col gap-1.5 px-3 pb-1">
            <Filter value={criteria.include} onChange={(value) => set({ include: value })}
              placeholder={t('panel.search.include')} clearLabel={t('panel.search.clear')} />
            <Filter value={criteria.exclude} onChange={(value) => set({ exclude: value })}
              placeholder={t('panel.search.exclude')} clearLabel={t('panel.search.clear')} />
          </div>
        </FilterMenu>
        <TooltipButton
          type="button"
          aria-label={t(replaceOpen ? 'panel.search.replace.hide' : 'panel.search.replace.show')}
          aria-expanded={replaceOpen}
          onClick={() => setReplaceOpen((value) => !value)}
          className={cx(panelToolClass(replaceOpen), iconToolClass)}
        >
          <Replace size={14} />
        </TooltipButton>
      </PanelToolbar>

      {replaceOpen ? (
        <div className="flex shrink-0 items-center gap-1.5 border-b border-line px-3 py-1.5">
          <input
            value={replacement}
            onChange={(event) => setReplacement(event.target.value)}
            placeholder={t('panel.search.replace.placeholder')}
            aria-label={t('panel.search.replace.placeholder')}
            maxLength={500}
            className="h-11 min-w-0 flex-1 rounded-md border border-line bg-transparent px-2.5 text-sm text-ink outline-none placeholder:text-ink-soft focus:border-line-strong md:h-9 pointer-coarse:h-11"
          />
          {/* Désarmé tant qu'il n'y a rien à remplacer : un bouton cliquable sur
              zéro résultat se lirait comme une panne. */}
          <button
            type="button"
            disabled={!ready || replacing || files.length === 0 || Boolean(invalidRegex)}
            onClick={() => setConfirming(true)}
            className={cx(panelToolClass(), 'disabled:pointer-events-none disabled:opacity-45')}
          >
            {replacing ? <Loader size={14} className="animate-spin" /> : null}
            {t('panel.search.replace.all')}
          </button>
        </div>
      ) : null}

      {invalidRegex ? <PanelNotice tone="critical">{invalidRegex}</PanelNotice> : null}

      {failed ? (
        <PanelNotice tone="critical">
          <span className="flex flex-wrap items-center gap-x-2">
            <span className="min-w-0 flex-1">
              {content.error instanceof Error ? content.error.message : t('panel.search.error')}
            </span>
            <button type="button" onClick={() => void content.refetch()} className={cx(panelGestureClass, 'shrink-0')}>
              {t('editor.retry')}
            </button>
          </span>
        </PanelNotice>
      ) : null}

      {done ? (
        <PanelNotice onClose={() => setDone(null)}>{t('panel.search.replace.done', done)}</PanelNotice>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {!ready ? (
          <p role="status" className="px-3 py-2 text-xs text-ink-faint">{t('panel.search.start')}</p>
        ) : pending ? (
          <p role="status" className="flex items-center gap-1.5 px-3 py-2 text-xs text-ink-faint">
            <Loader size={11} className="animate-spin" />
            {t('panel.search.loading')}
          </p>
        ) : failed ? null : nameEntries.length === 0 && files.length === 0 ? (
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
                <PanelGroup title={t('panel.search.section.names')} count={nameEntries.length} />
                <ul data-search-results>
                  {nameEntries.map((entry) => (
                    <li key={entry.path}>
                      <button
                        type="button"
                        onClick={() => onOpenFile(entry.path)}
                        className={panelRowClass}
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
                <PanelGroup title={t('panel.search.section.content')} count={files.length} />
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
        onOpenChange={(open) => {
          setConfirming(open)
          if (!open) setReplaceError(null)
        }}
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
        {replaceError ? <p role="alert" className="text-critical">{replaceError}</p> : null}
      </ConfirmDialog>
    </div>
  )
})

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
        className={panelRowClass}
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
                className="flex w-full items-baseline gap-2 py-0.5 pr-2 pl-7 text-left font-mono text-meta hover:bg-surface-high pointer-coarse:py-3"
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
