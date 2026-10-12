import { TooltipButton } from '@solera/ui'
import { Archive, Code2, Download, Eye, Link2, Loader, MoreHorizontal, PanelLeft, Save, Search, Trash2, Undo2, X } from 'lucide-react'
import { Suspense, lazy, useEffect, useRef, useState } from 'react'
import {
  OPENABLE_MODEL_EXTENSIONS,
  VIEWABLE_DOCUMENT_TYPES,
  VIEWABLE_IMAGE_TYPES,
  VIEWABLE_MEDIA_TYPES,
} from '@solera/protocol'
import { useEditorDocument, useEditorDraftPaths } from '../../lib/editor-documents'
import { useCurrentUser } from '../../lib/session'
import {
  activateTab,
  closeOtherTabs,
  closeSavedTabs,
  closeTab,
  openTab,
  pinTab,
  reopenLastClosedTab,
  reorderTabs,
  useEditorTabs,
  useHasClosedTabs,
} from '../../lib/editor-tabs'
import { copyText } from '../../lib/clipboard'
import { clearReveal, useRevealTarget } from '../../lib/editor-reveal'
import { fileIconUrl } from '../../lib/file-icons'
import { languageFromPath } from '../../lib/highlight'
import { downloadFile, rawFileUrl } from '../../lib/files-io'
import { useTranslate } from '../../lib/i18n'
import { isMarkdownPath, setMarkdownView, useMarkdownView } from '../../lib/markdown-view'
import { Markdown } from '../chat/Markdown'
import { FileLinkContext } from '../../lib/file-links'
import { Banner, Button, IconButton, Menu, MenuItem, MenuSeparator, cx } from '@solera/ui'
import { CodeEditor, type CodeEditorHandle } from './CodeEditor'
import { ImageView } from './ImageView'
import { MediaView } from './MediaView'

/** Chargé à la demande : le visualiseur entraîne `three`, plus lourd que tout le reste. */
const ModelView = lazy(() => import('./ModelView').then((m) => ({ default: m.ModelView })))

/** Type de transfert du glisser-déposer des onglets, distinct de celui de l'arborescence. */
const TAB_DRAG_TYPE = 'application/x-solera-tab'

/** Le raccourci de la réouverture, écrit comme le clavier de la machine. */
const REOPEN_HINT = navigator.userAgent.includes('Mac') ? '⇧⌘T' : 'Ctrl ⇧ T'

/** Onglets ouverts, et le fichier actif en dessous. */
export function EditorPane({ scope, treeOpen, onShowTree }: {
  scope: string
  /** L'arborescence est repliée : la rangée d'onglets porte alors de quoi la ramener. */
  treeOpen: boolean
  onShowTree: () => void
}) {
  const { data: user } = useCurrentUser()
  return user ? (
    <UserEditorPane key={`${user.id}:${scope}`} userId={user.id} scope={scope} treeOpen={treeOpen} onShowTree={onShowTree} />
  ) : null
}

function UserEditorPane({ userId, scope, treeOpen, onShowTree }: {
  userId: string
  scope: string
  treeOpen: boolean
  onShowTree: () => void
}) {
  const { paths, active, preview } = useEditorTabs(scope)
  const drafts = useEditorDraftPaths(userId, scope)
  const closedDrafts = drafts.filter((path) => !paths.includes(path))
  const t = useTranslate()
  const hasClosed = useHasClosedTabs(scope)
  const tabList = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const node = tabList.current
    if (!node) return
    const reveal = () => node.querySelector('[data-editor-tab][aria-pressed="true"]')?.closest('[data-index]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    reveal()
    const observer = new ResizeObserver(reveal)
    observer.observe(node)
    return () => observer.disconnect()
  }, [active, paths])

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      {closedDrafts.length > 0 ? (
        <details open className="shrink-0 border-b border-line bg-accent-wash px-3 py-2 text-xs text-ink-soft">
          <summary className="cursor-pointer py-1">{t('editor.drafts.recover', { count: closedDrafts.length })}</summary>
          <div className="flex max-h-32 flex-wrap gap-1 overflow-auto">
            {closedDrafts.map((path) => <Button key={path} size="sm" variant="ghost" className="min-w-0 max-w-full" title={path} onClick={() => openTab(scope, path)}><span className="truncate">{path}</span></Button>)}
          </div>
        </details>
      ) : null}
      {/*
        La rangée du haut existe même sans onglet, quand l'arborescence est repliée.
        Le bouton qui la ramène vit dedans, et la rangée ne naissait qu'avec le premier
        fichier ouvert : replier l'arbre sur un éditeur vide laissait donc un panneau
        qui dit « clique sur un fichier dans l'arborescence » sans aucun moyen d'y
        retourner.
      */}
      {paths.length === 0 ? (
        <>
          {treeOpen ? null : (
            <div className="flex shrink-0 items-center gap-1 border-b border-line px-1">
              <IconButton size="sm" label={t('panel.tree.show')} onClick={onShowTree}>
                <PanelLeft size={14} />
              </IconButton>
            </div>
          )}
          <p className="px-4 py-8 text-center text-sm text-ink-faint">{t('editor.empty')}</p>
        </>
      ) : <>
      <div className="flex shrink-0 items-center border-b border-line">
        {treeOpen ? null : (
          <IconButton size="sm" label={t('panel.tree.show')} onClick={onShowTree}>
            <PanelLeft size={14} />
          </IconButton>
        )}
        <div ref={tabList} data-file-tabs className="flex min-w-0 flex-1 items-center gap-px overflow-x-auto">
          {paths.map((path, index) => (
            <Tab
              key={path}
              path={path}
              index={index}
              active={path === active}
              preview={path === preview}
              dirty={drafts.includes(path)}
              showParent={paths.some((other) => other !== path && other.split('/').pop() === path.split('/').pop())}
              onActivate={() => activateTab(scope, path)}
              onPin={() => pinTab(scope, path)}
              onClose={() => closeTab(scope, path)}
              onDropAt={(from) => reorderTabs(scope, from, index)}
            />
          ))}
        </div>

        {active ? <IconButton
          size="sm"
          label={t(drafts.includes(active) ? 'editor.download.saved' : 'editor.download', { path: active })}
          onClick={() => downloadFile(scope, active)}
        ><Download size={14} /></IconButton> : null}
        <Menu
          trigger={
            <TooltipButton
              type="button"
              aria-label={t('editor.tabs.actions')}
              className="flex size-11 shrink-0 items-center justify-center border-l border-line text-ink-faint hover:text-ink md:size-8 pointer-coarse:size-11"
            >
              <MoreHorizontal size={14} />
            </TooltipButton>
          }
        >
          {/* La liste des fichiers ouverts a quitté ce menu : la rangée les montre
              déjà et défile, et un menu qui redit la barre au-dessus de lui ne sert
              qu'à la masquer. Ne restent que les gestes. */}
          <MenuItem icon={<X size={14} />} disabled={active === null} onSelect={() => { if (active) closeTab(scope, active) }}>
            {t('editor.tabs.close')}
          </MenuItem>
          <MenuItem
            icon={<Archive size={14} />}
            disabled={active === null || paths.length < 2}
            onSelect={() => closeOtherTabs(scope, active)}
          >
            {t('editor.tabs.closeOthers')}
          </MenuItem>
          {/* Les brouillons restent : c'est toute la différence avec « tout fermer »,
              et la seule raison de choisir ce geste plutôt que l'autre. */}
          <MenuItem
            icon={<Archive size={14} />}
            disabled={paths.every((path) => drafts.includes(path))}
            onSelect={() => closeSavedTabs(scope, drafts)}
          >
            {t('editor.tabs.closeSaved')}
          </MenuItem>
          <MenuItem icon={<Trash2 size={14} />} disabled={paths.length === 0} onSelect={() => closeOtherTabs(scope, null)}>
            {t('editor.tabs.closeAll')}
          </MenuItem>
          <MenuSeparator />
          <MenuItem
            icon={<Undo2 size={14} />}
            shortcut={REOPEN_HINT}
            disabled={!hasClosed}
            onSelect={() => reopenLastClosedTab(scope)}
          >
            {t('editor.tabs.reopen')}
          </MenuItem>
          <MenuItem icon={<Link2 size={14} />} disabled={active === null} onSelect={() => { if (active) void copyText(active) }}>
            {t('editor.tabs.copyPath')}
          </MenuItem>
        </Menu>
      </div>

      {/* Un seul CodeMirror monté ; les documents et brouillons vivent hors du panneau. */}
      {active ? (
        <FileView
          key={active}
          scope={scope}
          userId={userId}
          path={active}
        />
      ) : null}
      </>}
    </div>
  )
}

/**
 * Un onglet, déplaçable par glissement.
 *
 * L'ordre d'ouverture ne dit rien de l'usage : on regroupe volontiers ce qui va
 * ensemble. Le clic du milieu ferme, comme dans un navigateur.
 */
function Tab({
  path,
  index,
  active,
  preview,
  dirty,
  showParent,
  onActivate,
  onPin,
  onClose,
  onDropAt,
}: {
  path: string
  index: number
  active: boolean
  /** Onglet de parcours, que le prochain clic simple dans l'arborescence remplacera. */
  preview: boolean
  dirty: boolean
  showParent: boolean
  onActivate: () => void
  onPin: () => void
  onClose: () => void
  onDropAt: (from: string) => void
}) {
  const [dropping, setDropping] = useState(false)
  const t = useTranslate()

  return (
    <div
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData(TAB_DRAG_TYPE, path)
        event.dataTransfer.effectAllowed = 'move'
      }}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes(TAB_DRAG_TYPE)) return
        // Sans `preventDefault`, le navigateur refuse le dépôt sans rien dire.
        event.preventDefault()
        setDropping(true)
      }}
      onDragLeave={() => setDropping(false)}
      onDrop={(event) => {
        event.preventDefault()
        setDropping(false)
        const from = event.dataTransfer.getData(TAB_DRAG_TYPE)
        if (from && from !== path) onDropAt(from)
      }}
      onAuxClick={(event) => {
        if (event.button === 1) onClose()
      }}
      className={cx(
        'group/tab flex h-11 shrink-0 items-center gap-1.5 border-r border-line pr-1 pl-2 md:h-8 pointer-coarse:h-11',
        active ? 'bg-surface text-ink' : 'bg-sunken text-ink-faint',
        dropping && 'border-l-2 border-l-accent',
      )}
      title={path}
      data-index={index}
    >
      {/* Le double clic garde l'onglet, comme dans un éditeur : c'est le même geste que
          celui qui l'ouvre pour de bon depuis l'arborescence. */}
      <button
        type="button"
        onClick={onActivate}
        onDoubleClick={onPin}
        data-editor-tab
        onKeyDown={(event) => {
          const tabs = Array.from(event.currentTarget.closest('[data-file-tabs]')?.querySelectorAll<HTMLButtonElement>('[data-editor-tab]') ?? [])
          const index = tabs.indexOf(event.currentTarget)
          const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index - 1 + tabs.length) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : null
          if (next === null) return
          event.preventDefault()
          tabs[next]?.focus()
          tabs[next]?.click()
        }}
        aria-pressed={active}
        aria-label={t(dirty ? 'editor.tab.labelDirty' : 'editor.tab.label', { path })}
        className="flex h-full min-w-0 items-center gap-1.5"
      >
        <img
          src={fileIconUrl(path.split('/').pop() ?? path, false)}
          alt=""
          aria-hidden
          className="size-4 shrink-0"
        />
        {/* L'italique dit que l'onglet ne survivra pas au fichier suivant. */}
        <span className="flex min-w-0 flex-col text-left">
          <span className={cx('max-w-40 truncate text-xs', preview && 'italic')}>{path.split('/').pop()}</span>
          {showParent ? <span className="max-w-40 truncate text-micro text-ink-faint">{path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '/'}</span> : null}
        </span>
      </button>

      {dirty ? (
        <span aria-label={t('editor.tab.unsaved')} className="size-1.5 shrink-0 rounded-full bg-accent" />
      ) : null}

      <TooltipButton
        type="button"
        onClick={onClose}
        aria-label={t('editor.tab.close', { path })}
        className="flex size-11 items-center justify-center rounded text-ink-faint opacity-0 hover:text-ink group-hover/tab:opacity-100 focus-visible:opacity-100 md:size-6 pointer-coarse:size-11 pointer-coarse:opacity-100"
      >
        <X size={14} />
      </TooltipButton>
    </div>
  )
}

function FileView({ userId, scope, path }: { userId: string; scope: string; path: string }) {
  const editor = useRef<CodeEditorHandle>(null)
  // La vue *Recherche* désigne une ligne : l'éditeur la montre, qu'il vienne d'ouvrir
  // le fichier ou qu'il l'ait déjà sous les yeux.
  const reveal = useRevealTarget(scope, path)
  const [position, setPosition] = useState({ line: 1, column: 1 })
  const { document, dirty, load, save, edit } = useEditorDocument(userId, scope, path)
  const { file, content, error, conflict, loading, saving, persisted, revision } = document
  const extension = languageFromPath(path)
  const isImage = extension in VIEWABLE_IMAGE_TYPES
  const isDocument = extension in VIEWABLE_DOCUMENT_TYPES
  const mediaType = VIEWABLE_MEDIA_TYPES[extension]
  const isModel = OPENABLE_MODEL_EXTENSIONS.has(extension)
  const isMarkdown = isMarkdownPath(path)
  const view = useMarkdownView()
  const t = useTranslate()
  const rawView = isImage || isDocument || Boolean(mediaType) || isModel
  useEffect(() => {
    if (!rawView) void load()
  }, [rawView, load])

  const discard = () => {
    if (dirty && !confirm(t('editor.discard.confirm', { path }))) return
    void load(true)
  }

  if (isImage) return <ImageView scope={scope} path={path} />
  if (isDocument) return <iframe data-editor-file={path} src={rawFileUrl(scope, path)} title={path} className="min-h-0 min-w-0 flex-1 border-0 bg-canvas" />
  if (mediaType) return <MediaView scope={scope} path={path} type={mediaType} />
  if (isModel) {
    return <Suspense fallback={<div className="flex min-h-0 flex-1 items-center justify-center text-ink-faint">
      <Loader size={22} className="animate-spin" aria-label={t('editor.loading')} />
    </div>}>
      <ModelView scope={scope} path={path} />
    </Suspense>
  }

  if (!file) {
    return error ? <div data-editor-file={path} tabIndex={-1} className="min-h-0 flex-1 overflow-auto p-3 outline-none">
      <Banner>{error.message}</Banner>
      <Button size="sm" variant="ghost" className="mt-2" disabled={loading} onClick={() => void load()}>{t('editor.retry')}</Button>
    </div> : <div className="flex min-h-0 flex-1 items-center justify-center text-ink-faint">
      <Loader size={22} className="animate-spin" aria-label={t('editor.loading')} />
    </div>
  }

  return (
    <div data-editor-file={path} tabIndex={-1} className="flex min-h-0 min-w-0 flex-1 flex-col outline-none">
      {error ? <div className="shrink-0 p-2">
        <Banner>{error.message} {dirty ? t('editor.error.kept') : ''}</Banner>
        <Button variant="ghost" size="sm" disabled={loading || saving} onClick={() => void (error.kind === 'read' ? load() : save())}>{t('editor.retry')}</Button>
      </div> : null}
      {conflict ? <div role="alert" className="flex shrink-0 flex-wrap items-center gap-2 border-b border-caution/40 bg-caution/12 px-3 py-2 text-xs text-ink-soft">
        <p className="w-full">{t('editor.conflict.message')}</p>
        <Button variant="secondary" size="sm" disabled={loading || saving} onClick={discard}>{t('editor.conflict.reload')}</Button>
        <Button variant="secondary" size="sm" disabled={loading || saving} onClick={() => {
          if (confirm(t('editor.conflict.overwriteConfirm', { path }))) void save(true)
        }}>{t('editor.conflict.overwrite')}</Button>
      </div> : null}

      {isMarkdown && view === 'preview' ? (
        <div className="min-h-0 min-w-0 flex-1 overflow-auto px-4 py-3">
          {/* La portée de l'éditeur, et non celle du fil : l'aperçu s'ouvre aussi depuis
              le panneau d'un projet, hors de toute conversation. */}
          <FileLinkContext.Provider value={scope}>
            <Markdown text={content} base={path.slice(0, path.lastIndexOf('/') + 1)} />
          </FileLinkContext.Provider>
        </div>
      ) : (
        <div className="min-h-0 min-w-0 flex-1">
          <CodeEditor
            ref={editor}
            key={revision}
            sessionKey={JSON.stringify([userId, scope, path])}
            revision={revision}
            onPosition={(line, column) => setPosition({ line, column })}
            reveal={reveal}
            onRevealed={() => clearReveal(scope)}
            initial={content}
            path={file.path}
            onChange={(value) => { edit(value); pinTab(scope, path) }}
            onSave={() => { if (!conflict) void save() }}
          />
        </div>
      )}

      <div className="flex shrink-0 flex-col gap-1 border-t border-line px-2.5 py-1.5 text-xs text-ink-faint">
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate" title={path}>{path}</span>
          {isMarkdown && view === 'preview' ? null : <button type="button" className="shrink-0 rounded px-1 py-1 hover:text-ink" aria-label={t('editor.position', position)} title={t('editor.goToLine')} onClick={() => editor.current?.goToLine()}>
            {t('editor.position.short', position)}
          </button>}
          <span role="status" className={dirty ? 'shrink-0 text-ink-soft' : 'shrink-0'}>
            {t(saving ? 'editor.saving' : loading ? 'editor.loading' : dirty ? 'editor.tab.unsaved' : 'editor.saved')}
          </span>
        </div>
        {dirty ? <p>{t(persisted ? 'editor.drafts.kept' : 'editor.drafts.memory')}</p> : null}
        <div className="flex flex-wrap items-center justify-end gap-1">
          {isMarkdown && view === 'preview' ? null : <IconButton size="sm" label={t('editor.find')} onClick={() => editor.current?.find()}><Search size={14} /></IconButton>}
          {isMarkdown ? <Button size="sm" variant="ghost" icon={view === 'preview' ? <Code2 size={14} /> : <Eye size={14} />}
            onClick={() => setMarkdownView(view === 'preview' ? 'source' : 'preview')}>
            {t(view === 'preview' ? 'editor.markdown.source' : 'editor.markdown.preview')}
          </Button> : null}
          {dirty && !conflict ? <Button size="sm" variant="ghost" aria-label={t('editor.discard')} title={t('editor.discard')} disabled={saving || loading} onClick={discard}>{t('editor.discard.short')}</Button> : null}
          <Button size="sm" variant={dirty ? 'primary' : 'ghost'} icon={saving ? <Loader size={14} className="animate-spin" /> : <Save size={14} />}
            disabled={!dirty || saving || loading || conflict} onClick={() => void save()}>{t(saving ? 'editor.saving' : 'editor.save')}</Button>
        </div>
      </div>
    </div>
  )
}
