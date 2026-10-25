import {
  Bot,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  CircleSlash,
  CornerDownRight,
  FileText,
  FolderSearch,
  Globe,
  Image,
  ListChecks,
  ListTodo,
  Loader,
  Pencil,
  Search,
  SquareTerminal,
  Wrench,
} from 'lucide-react'
import { memo, useCallback, useLayoutEffect, useMemo, useState, type ReactNode } from 'react'
import { isSpawnTool, type ToolOutputDto } from '@solera/protocol'
import type { ToolItem } from '../../lib/chat-fold'
import { languageFromPath } from '../../lib/highlight'
import { useTranslate, type MessageKey } from '../../lib/i18n'
import { showSubAgent } from '../../lib/panel'
import { useEventBody, useToolOutput } from '../../lib/tool-output'
import { readableView } from '../tools/registry'
import { cx } from '@solera/ui'
import { HighlightedCode } from './HighlightedCode'
import { ScheduleApprovalStrip } from './ScheduleApprovalStrip'
import { isSoleraTool } from '../../lib/solera-tools'
import { toolSummary } from '../../lib/tool-summary'
import { toolEdits, type EditPresentation } from '../../lib/tool-edits'
import { INTENT_LABELS, toolIntent, toolLabel, toolOrigin, toolPreview } from '../../lib/tool-presentation'
import { useToolStyle, type ToolStyle } from '../../lib/tool-style'
import { Logo } from '../Logo'
import { toolWebInput } from '../../lib/tool-web-input'

/**
 * Rendu d'un appel d'outil, et d'une suite d'appels repliée derrière une ligne.
 *
 * Les deux vivent dans le même module parce qu'un groupe déplié rend des appels :
 * les séparer donnerait un cycle d'imports pour rien.
 */

/** Icône par outil. Le rendu détaillé, lui, passe par le registre de vues (`tools/`). */
const TOOL_ICONS: Record<string, ReactNode> = {
  Bash: <SquareTerminal size={14} />,
  Read: <FileText size={14} />,
  ViewImage: <Image size={14} />,
  Write: <Pencil size={14} />,
  Edit: <Pencil size={14} />,
  ApplyPatch: <Pencil size={14} />,
  NotebookEdit: <Pencil size={14} />,
  Glob: <FolderSearch size={14} />,
  Grep: <Search size={14} />,
  WebFetch: <Globe size={14} />,
  WebSearch: <Globe size={14} />,
  TodoWrite: <ListTodo size={14} />,
  Task: <Bot size={14} />,
  Agent: <Bot size={14} />,
  ExitPlanMode: <ListChecks size={14} />,
}

/**
 * L'issue d'un appel, en une icône.
 *
 * « Interrompu » n'est pas un échec : l'appel n'a simplement jamais rendu sa réponse,
 * le CLI ayant été coupé. Le confondre avec une erreur ferait chercher une cause qui
 * n'existe pas.
 */
export function ToolStatusIcon({ status }: { status: ToolItem['status'] }) {
  if (status === 'running') return <Loader size={14} className="shrink-0 animate-spin text-accent" />
  if (status === 'failed') return <CircleAlert size={14} className="shrink-0 text-critical" />
  if (status === 'interrupted') return <CircleSlash size={14} className="shrink-0 text-ink-faint" />
  return <CircleCheck size={14} className="shrink-0 text-positive" />
}

/**
 * Une durée, à la précision qu'elle mérite.
 *
 * Les minutes sont nommées plutôt que comptées en secondes : un sous-agent tourne
 * couramment plusieurs minutes, et « 185.0 s » demande une conversion mentale à
 * chaque coup d'œil.
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`

  const seconds = Math.round(ms / 1000)
  return `${Math.floor(seconds / 60)} min ${String(seconds % 60).padStart(2, '0')} s`
}

/** Langage du fichier que l'appel déclare, quand il en déclare un. */
function languageOfInput(input: unknown): string {
  if (typeof input !== 'object' || input === null) return ''
  const fields = input as Record<string, unknown>
  const path = fields.file_path ?? fields.path
  return typeof path === 'string' ? languageFromPath(path) : ''
}

/**
 * Un payload d'outil, avec le langage à lui appliquer.
 *
 * La sortie est tantôt du JSON, tantôt du texte : le contenu d'un fichier, la sortie
 * d'une commande. Colorer une sortie de commande comme du JSON la rendrait illisible,
 * donc `fallback` ne sert qu'aux chaînes, et seulement quand l'appel dit de quel
 * fichier elles viennent.
 */
function asPayload(value: unknown, fallback = ''): { content: string; language: string } {
  if (value === null || value === undefined) return { content: '', language: '' }
  if (typeof value === 'string') return { content: value, language: fallback }
  return { content: JSON.stringify(value, null, 2), language: 'json' }
}

/**
 * La sortie à afficher : celle du journal, ou le corps complet une fois arrivé.
 *
 * `undefined` tant que la requête n'a pas répondu, ce que `OutputSlot` distingue d'une
 * sortie réellement vide.
 */
function outputOf(tool: ToolItem, full: ToolOutputDto | undefined): unknown {
  if (tool.outputBytes === null) return tool.output
  return full ? full.output : undefined
}

/** La sortie, son chargement, ou l'échec de celui-ci. */
function OutputSlot({
  ready,
  error,
  output,
  language,
}: {
  ready: boolean
  error: Error | null
  output: unknown
  language?: string
}) {
  const t = useTranslate()

  if (error) {
    return (
      <p className="text-meta text-critical">{error.message || t('toolcall.output.error')}</p>
    )
  }

  if (!ready) {
    return (
      <p className="flex items-center gap-1.5 text-meta text-ink-faint">
        <Loader size={11} className="animate-spin" />
        {t('toolcall.output.loading')}
      </p>
    )
  }

  return <Payload label={t('toolcall.payload.output')} {...asPayload(output, language)} />
}

/**
 * L'habillage de chaque présentation, en classes du design system. Toutes gardent la
 * même hauteur de ligne : une marque MCP, un compteur ou un appel en cours n'en ajoute
 * jamais une.
 */
const STYLE_CLASSES: Record<ToolStyle, { tool: string; heading: string; list: string; sequence: string; groupHeading: string }> = {
  inline: { tool: 'rounded-md', heading: 'h-9 rounded-md px-2', list: 'flex flex-col', sequence: '', groupHeading: 'h-9 rounded-md px-2' },
  timeline: {
    tool: 'relative before:absolute before:-left-[1.0625rem] before:top-[0.9375rem] before:size-1.5 before:rounded-full before:bg-ink-faint',
    heading: 'h-9 rounded-md px-2',
    list: 'ml-1.5 flex flex-col border-l border-line-strong pl-3.5',
    sequence: '',
    groupHeading: 'h-9 rounded-md px-2',
  },
  intent: { tool: 'rounded-md', heading: 'h-9 rounded-md px-2', list: 'flex flex-col border-l-2 border-line-strong pl-2', sequence: '', groupHeading: 'h-9 rounded-md px-2' },
  cards: { tool: 'rounded-lg border border-line bg-surface/60', heading: 'h-9 rounded-lg px-2.5', list: 'flex flex-col gap-1.5', sequence: '', groupHeading: 'h-9 rounded-md px-2' },
  console: {
    tool: '',
    heading: 'h-8 px-2 font-mono text-meta',
    list: 'flex flex-col',
    sequence: 'rounded-md border border-line bg-surface/40 p-1',
    groupHeading: 'h-8 rounded px-2 font-mono text-meta',
  },
  classic: { tool: 'rounded-md border border-line bg-surface/60', heading: 'h-9 rounded-md px-2.5', list: 'flex flex-col gap-1.5', sequence: '', groupHeading: 'h-9 rounded-md px-2.5' },
}

/** Ces présentations encadrent chaque appel : l'origine se lit sur le bord gauche du cadre. */
const FRAMED: ToolStyle[] = ['cards', 'classic']

/** Le libellé du compteur dit ce qu'il mesure : un diff, un extrait, ou des lignes écrites. */
function countLabelKey(edits: EditPresentation, status: ToolItem['status']): MessageKey {
  if (edits.scope === 'written') return status === 'running' ? 'tool.write.countsPlanned' : 'tool.write.counts'
  if (status === 'running') return 'tool.edit.countsPlanned'
  if (edits.scope === 'replacement') return 'tool.edit.countsReplacement'
  if (edits.scope === 'fragment') return 'tool.edit.countsFragment'
  return 'tool.edit.counts'
}

const STATUS_LABELS: Record<ToolItem['status'], MessageKey> = {
  running: 'toolStyle.pending',
  done: 'toolStyle.done',
  failed: 'toolStyle.failed',
  interrupted: 'toolStyle.stopped',
}

/** La marque d'un outil MCP qui n'est pas celui de Solera : petite, pour ne pas grandir la ligne. */
function McpMark() {
  return <span className="shrink-0 rounded-sm border border-line-strong px-1 text-micro font-semibold text-ink-soft">MCP</span>
}

export const ToolCall = memo(function ToolCall({
  tool,
  conversationId,
  variant,
  onOpenChange,
}: {
  tool: ToolItem
  conversationId: string
  /** Impose une présentation, pour l'aperçu d'Apparence ; sinon celle du compte. */
  variant?: ToolStyle
  /** Prévient le groupe qu'un appel est ouvert : il ne se replie pas sous la main du lecteur. */
  onOpenChange?: (id: string, open: boolean) => void
}) {
  const t = useTranslate()
  const [open, setOpen] = useState(false)
  const [raw, setRaw] = useState(false)
  const [preferredStyle] = useToolStyle()
  const style = variant ?? preferredStyle
  const classes = STYLE_CLASSES[style]
  const edits = useMemo(() => toolEdits(tool), [tool])
  const summary = toolSummary(tool, edits)
  // Un appel échoué ou interrompu n'a rien appliqué : pas de compteur qui le laisse croire.
  const counts = tool.status === 'failed' || tool.status === 'interrupted' ? null : edits?.counts ?? null
  const countLabel = counts && edits ? t(countLabelKey(edits, tool.status), counts) : ''
  const origin = toolOrigin(tool.name, tool.presentation)
  const label = toolLabel(tool.name, tool.presentation)
  const statusLabel = t(STATUS_LABELS[tool.status])
  const running = tool.status === 'running'
  const framed = FRAMED.includes(style)

  return (
    <div
      className={cx(
        'min-w-0 text-sm',
        classes.tool,
        style === 'timeline' && running && 'before:bg-accent',
        style === 'timeline' && tool.status === 'failed' && 'before:bg-critical',
        framed && tool.status === 'failed' && 'border-critical/40',
        framed && origin.kind === 'solera' && 'rounded-l-none border-l-2 border-l-accent',
        framed && origin.kind === 'mcp' && 'rounded-l-none border-l-2 border-l-line-strong',
      )}
      data-tool-id={tool.id}
      data-tool-style={style}
      data-tool-origin={origin.kind}
      data-tool-status={tool.status}
    >
      <button
        type="button"
        title={[label, statusLabel, summary?.text].filter(Boolean).join(' — ')}
        onClick={() => {
          setOpen(!open)
          onOpenChange?.(tool.id, !open)
        }}
        aria-expanded={open}
        className={cx(
          'relative flex w-full min-w-0 items-center gap-2 text-left text-xs whitespace-nowrap hover:bg-surface-high',
          'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent',
          classes.heading,
          // L'appel en cours se voit sans grandir : un fond et un trait d'accent.
          running && 'bg-accent-wash/40 before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-accent',
        )}
      >
        <ChevronRight size={14} className={cx('shrink-0 text-ink-faint transition-transform', open && 'rotate-90')} />
        {origin.kind === 'solera' ? (
          <Logo size={14} className="shrink-0 text-accent" />
        ) : origin.kind === 'mcp' ? (
          <McpMark />
        ) : style === 'inline' || style === 'console' ? null : (
          <span className="shrink-0 text-ink-faint">{TOOL_ICONS[tool.name] ?? <Wrench size={14} />}</span>
        )}
        <span
          className={cx(
            'min-w-0 max-w-[48%] shrink truncate font-medium max-sm:max-w-[55%]',
            running || origin.kind === 'solera' ? 'text-accent' : 'text-ink',
            style === 'console' && 'font-sans',
          )}
        >
          {label}
        </span>
        {origin.kind === 'mcp' ? (
          <span className="max-w-[18%] shrink-0 truncate rounded-sm border border-line-strong px-1 text-micro text-ink-soft" title={origin.server}>
            {origin.server}
          </span>
        ) : null}
        {summary ? (
          <span className={cx('min-w-0 flex-1 truncate text-ink-faint', summary.mono && 'font-mono')} title={summary.text}>
            {summary.text}
          </span>
        ) : (
          <span className="flex-1" />
        )}

        {counts ? (
          <span className="flex shrink-0 gap-1 font-mono text-meta" role="img" aria-label={countLabel} title={countLabel}>
            <span className="text-positive">+{counts.added}</span>
            {edits?.scope !== 'written' ? <span className="text-critical">−{counts.removed}</span> : null}
          </span>
        ) : null}
        <span className="flex shrink-0 items-center gap-1" role="img" aria-label={statusLabel}>
          <ToolStatusIcon status={tool.status} />
          {/* Un échec se dit en toutes lettres : l'icône seule se confond avec l'interruption. */}
          {tool.status === 'failed' ? <span className="text-meta font-medium text-critical">{statusLabel}</span> : null}
        </span>
        {tool.durationMs !== null ? (
          <span className="shrink-0 text-meta text-ink-faint max-sm:hidden">{formatDuration(tool.durationMs)}</span>
        ) : null}
      </button>

      {style === 'cards' && !open ? (
        <div className="truncate px-2.5 pb-1.5 pl-[1.875rem] text-meta text-ink-soft" title={toolPreview(tool)}>
          {toolPreview(tool)}
        </div>
      ) : null}
      {open ? <ToolDetail tool={tool} conversationId={conversationId} raw={raw} setRaw={setRaw} /> : null}

      {/* Le fil du sous-agent est ailleurs, dans le panneau : sans ce passage, la
          seule façon d'y arriver serait de le retrouver dans une liste. */}
      {isSpawnTool(tool.name) ? (
        <button
          type="button"
          onClick={() => showSubAgent(tool.id)}
          className={cx(
            'flex w-full items-center gap-1.5 border-t border-line px-2.5 py-1.5',
            'text-left text-meta text-ink-faint hover:text-accent',
          )}
        >
          <CornerDownRight size={11} className="shrink-0" />
          {t('toolcall.subagent.view')}
        </button>
      ) : null}

      {tool.status === 'done' && isSoleraTool(tool.name, 'schedule_task') ? <ScheduleApprovalStrip tool={tool} /> : null}
    </div>
  )
})

/**
 * Le détail d'une carte ouverte, monté seulement tant qu'elle l'est : la refermer
 * libère les gros corps et annule une requête en cours.
 *
 * Une entrée ou une sortie volumineuse n'est pas transférée avec le fil : la relecture
 * n'en rend qu'un aperçu et une référence, et le corps complet se demande ici. Les
 * anciens serveurs, sans référence, gardent la route par identifiant d'appel.
 */
function ToolDetail({
  tool,
  conversationId,
  raw,
  setRaw,
}: {
  tool: ToolItem
  conversationId: string
  raw: boolean
  setRaw: (raw: boolean) => void
}) {
  const t = useTranslate()
  const inputBody = useEventBody(conversationId, tool.inputRef)
  const outputBody = useEventBody(conversationId, tool.outputRef)
  const legacy = useToolOutput(conversationId, tool.id, tool.outputBytes !== null && !tool.outputRef)
  const inputReady = !tool.inputRef || inputBody.data !== undefined
  const outputReady = tool.outputRef
    ? outputBody.data !== undefined
    : tool.outputBytes === null || legacy.data !== undefined
  const input = tool.inputRef ? inputBody.data?.value : tool.input
  const output = tool.outputRef ? outputBody.data?.value : outputOf(tool, legacy.data)
  // Les vues lisent les arguments définitifs ; la vue brute garde ceux du journal.
  const readableInput = toolWebInput({ ...tool, input, output })
  // Les vues lisibles distinguent une chaîne d'un tableau de blocs : les nourrir avec
  // l'aperçu ferait clignoter une image cassée avant le vrai contenu, d'où l'attente
  // des corps complets plutôt qu'un rendu intermédiaire.
  const readable = inputReady && outputReady ? readableView({ ...tool, input: readableInput, output }) : null
  return (
    <div className="flex flex-col gap-2 border-t border-line bg-canvas px-2.5 py-2">
      {/* Le libellé de la ligne peut être traduit ou emprunté au harnais : le nom que le
          CLI a donné reste lisible ici. */}
      <span className="break-all text-meta text-ink-faint">{t('toolStyle.rawName', { name: tool.name })}</span>
      {inputBody.error ? (
        <p className="text-xs text-critical" role="alert">
          {inputBody.error.message || t('journal.content.error')}
        </p>
      ) : null}
      {!inputReady && !inputBody.error ? <p className="text-xs text-ink-faint">{t('journal.content.loading')}</p> : null}
      {readable ? <ViewSwitch raw={raw} onChange={setRaw} /> : null}

      {readable && !raw ? (
        readable
      ) : (
        <>
          {inputReady ? <Payload label={t('toolcall.payload.input')} {...asPayload(input)} /> : null}
          {tool.status !== 'running' ? (
            <OutputSlot
              ready={outputReady}
              error={outputBody.error ?? legacy.error}
              output={output}
              language={languageOfInput(input)}
            />
          ) : null}
        </>
      )}
    </div>
  )
}

/**
 * Bascule entre la vue lisible et le payload natif.
 *
 * Le brut n'est pas un mode dégradé qu'on cacherait : c'est ce que le CLI a réellement
 * envoyé, et la seule façon de vérifier qu'une vue ne ment pas ou de retrouver un champ
 * qu'elle a jugé secondaire. Il reste donc à un clic, sur chaque appel.
 */
function ViewSwitch({ raw, onChange }: { raw: boolean; onChange: (raw: boolean) => void }) {
  const t = useTranslate()
  return (
    <div className="flex w-fit gap-0.5 rounded-md border border-line bg-sunken p-0.5">
      {[
        { label: t('toolcall.view.readable'), value: false },
        { label: t('toolcall.view.raw'), value: true },
      ].map((mode) => (
        <button
          key={mode.label}
          type="button"
          onClick={() => onChange(mode.value)}
          aria-pressed={raw === mode.value}
          className={cx(
            'rounded px-2 py-0.5 text-meta',
            raw === mode.value ? 'bg-surface-high text-ink' : 'text-ink-faint hover:text-ink',
          )}
        >
          {mode.label}
        </button>
      ))}
    </div>
  )
}

function Payload({
  label,
  content,
  language,
}: {
  label: string
  content: string
  language: string
}) {
  const t = useTranslate()
  return (
    <div className="flex flex-col gap-1">
      <span className="text-meta font-medium tracking-wide text-ink-faint uppercase">
        {label}
      </span>
      {content ? (
        <HighlightedCode
          code={content}
          language={language}
          wrap
          className="max-h-80 overflow-auto rounded-md border border-line bg-sunken p-2 font-mono text-xs"
        />
      ) : (
        <p className="rounded-md border border-line bg-sunken p-2 font-mono text-xs text-ink-faint">
          {t('toolcall.payload.empty')}
        </p>
      )}
    </div>
  )
}

/** Au-delà, l'énumération des noms d'outils déborde de la ligne. */
const NAMES_SHOWN = 3

function summarizeNames(tools: ToolItem[]): string {
  const names = [...new Set(tools.map((tool) => toolLabel(tool.name, tool.presentation)))]
  const shown = names.slice(0, NAMES_SHOWN).join(', ')
  return names.length > NAMES_SHOWN ? `${shown}, +${names.length - NAMES_SHOWN}` : shown
}

/** En dessous, replier coûte un clic et n'économise pas une ligne. */
const MIN_GROUP_SIZE = 2

/**
 * Une suite d'appels d'outils, repliée derrière une ligne une fois close.
 *
 * Elle ne se replie que quand l'agent a repris la parole (`complete`), et jamais sous
 * la main du lecteur : un appel ouvert, un groupe ouvert ou fermé à la main, une
 * section d'intention touchée, ou une lecture plus haut dans le fil (`mayCollapse`)
 * la laissent telle qu'elle est. Replier pendant qu'on lit déplacerait ce qu'on lit.
 *
 * Les échecs et les interruptions sont comptés dans l'en-tête : replier ne doit jamais
 * faire disparaître une erreur du champ de vision.
 *
 * La comparaison porte sur le contenu du tableau, pas sur son identité : `buildRows`
 * regroupe à chaque appel, donc à chaque lot de deltas, et rend un tableau neuf pour
 * des appels inchangés. Comparé par référence, le `memo` ratait toujours et chaque
 * groupe du fil se redessinait seize fois par seconde pendant un tour.
 */
const ToolCallGroupInner = function ToolCallGroup({
  tools,
  conversationId,
  complete = true,
  mayCollapse = true,
  variant,
}: {
  tools: ToolItem[]
  conversationId: string
  complete?: boolean
  mayCollapse?: boolean
  variant?: ToolStyle
}) {
  const t = useTranslate()
  const [preferredStyle] = useToolStyle()
  const style = variant ?? preferredStyle
  const classes = STYLE_CLASSES[style]
  const eligible = complete && tools.length >= MIN_GROUP_SIZE
  const [collapsed, setCollapsed] = useState(eligible && mayCollapse)
  const [manual, setManual] = useState(false)
  const [touchedIntent, setTouchedIntent] = useState(false)
  const [opened, setOpened] = useState<ReadonlySet<string>>(() => new Set())
  const onOpenChange = useCallback((id: string, open: boolean) => {
    setOpened((previous) => {
      const next = new Set(previous)
      if (open) next.add(id)
      else next.delete(id)
      return next
    })
  }, [])
  // Avant peinture : la suite qui se clôt ne se montre pas dépliée le temps d'une image.
  useLayoutEffect(() => {
    if (eligible && mayCollapse && !manual && !touchedIntent && opened.size === 0) setCollapsed(true)
  }, [eligible, mayCollapse, manual, touchedIntent, opened.size])

  const folded = eligible && collapsed
  // Un groupe déplié à la main garde son en-tête : c'est par lui qu'on le referme.
  const header = folded || manual
  const failed = tools.filter((tool) => tool.status === 'failed').length
  const interrupted = tools.filter((tool) => tool.status === 'interrupted').length
  const total = tools.reduce((sum, tool) => sum + (tool.durationMs ?? 0), 0)
  const origins = tools.map((tool) => toolOrigin(tool.name, tool.presentation))
  const solera = origins.filter((origin) => origin.kind === 'solera').length
  const external = origins.filter((origin) => origin.kind === 'mcp')
  const servers = [...new Set(external.map((origin) => origin.server))].join(', ')
  const framed = FRAMED.includes(style) && header

  const row = (tool: ToolItem) => (
    <ToolCall key={tool.id} tool={tool} conversationId={conversationId} variant={style} onOpenChange={onOpenChange} />
  )

  return (
    <div
      className={cx('min-w-0', classes.sequence, framed && 'rounded-lg border border-line bg-surface/60')}
      data-tool-sequence
      data-folded={folded}
    >
      {header ? (
        <button
          type="button"
          aria-expanded={!folded}
          onClick={() => {
            setManual(true)
            setCollapsed(!folded)
          }}
          className={cx(
            'flex w-full min-w-0 items-center gap-2 text-left text-xs hover:bg-surface-high',
            'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent',
            classes.groupHeading,
          )}
        >
          <ChevronRight size={14} className={cx('shrink-0 text-ink-faint transition-transform', !folded && 'rotate-90')} />
          <span className="shrink-0 font-medium text-ink">
            {t(tools.length > 1 ? 'toolcall.group.count.other' : 'toolcall.group.count.one', { count: tools.length })}
          </span>
          <span className="min-w-0 flex-1 truncate text-ink-faint" title={summarizeNames(tools)}>
            {summarizeNames(tools)}
          </span>
          {solera > 0 ? (
            <span className="flex shrink-0 items-center gap-1 text-meta text-accent" title={t(solera > 1 ? 'toolStyle.origin.solera.many' : 'toolStyle.origin.solera.one', { count: solera })}>
              <Logo size={14} />
              {solera}
            </span>
          ) : null}
          {external.length > 0 ? (
            <span
              className="flex shrink-0 items-center gap-1 text-meta text-ink-soft"
              title={servers}
              aria-label={`${t(external.length > 1 ? 'toolStyle.origin.mcp.many' : 'toolStyle.origin.mcp.one', { count: external.length })} : ${servers}`}
            >
              <McpMark />
              {external.length}
            </span>
          ) : null}
          {failed > 0 ? (
            <span className="shrink-0 text-meta font-medium text-critical">
              {t(failed > 1 ? 'toolcall.group.failed.other' : 'toolcall.group.failed.one', { count: failed })}
            </span>
          ) : null}
          {interrupted > 0 ? (
            <span className="flex shrink-0 items-center gap-1 text-meta text-ink-faint" title={t(interrupted > 1 ? 'toolStyle.interrupted.many' : 'toolStyle.interrupted.one', { count: interrupted })}>
              <CircleSlash size={13} />
              {interrupted}
            </span>
          ) : null}
          {total > 0 ? <span className="shrink-0 text-meta text-ink-faint max-sm:hidden">{formatDuration(total)}</span> : null}
        </button>
      ) : null}

      {!folded ? (
        <div className={cx(classes.list, framed && 'border-t border-line p-1.5')}>
          {style === 'intent'
            ? intentSections(tools).map((section) => (
                <IntentSection
                  key={section[0]!.id}
                  label={t(INTENT_LABELS[toolIntent(section[0]!)])}
                  count={section.length}
                  onInteract={() => setTouchedIntent(true)}
                >
                  {section.map(row)}
                </IntentSection>
              ))
            : tools.map(row)}
        </div>
      ) : null}
    </div>
  )
}

export const ToolCallGroup = memo(
  ToolCallGroupInner,
  (prev, next) =>
    prev.conversationId === next.conversationId &&
    prev.complete === next.complete &&
    prev.mayCollapse === next.mayCollapse &&
    prev.variant === next.variant &&
    prev.tools.length === next.tools.length &&
    // Le fold remplace l'objet d'un appel qui change : la comparaison par référence
    // sur chaque élément est donc exacte, sans avoir à comparer champ par champ.
    prev.tools.every((tool, index) => tool === next.tools[index]),
)

/** Les appels voisins de même famille forment une section, dans l'ordre où ils ont eu lieu. */
function intentSections(tools: ToolItem[]): ToolItem[][] {
  const sections: ToolItem[][] = []
  for (const tool of tools) {
    const last = sections.at(-1)
    if (last && toolIntent(last[0]!) === toolIntent(tool)) last.push(tool)
    else sections.push([tool])
  }
  return sections
}

function IntentSection({ label, count, onInteract, children }: {
  label: string
  count: number
  onInteract: () => void
  children: ReactNode
}) {
  const [open, setOpen] = useState(true)
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => {
          onInteract()
          setOpen(!open)
        }}
        className="flex w-full items-center gap-2 px-2 pt-2.5 pb-1 text-left text-meta font-semibold text-ink-soft hover:text-ink"
      >
        <ChevronRight size={12} className={cx('shrink-0 transition-transform', open && 'rotate-90')} />
        <span className="flex-1">{label}</span>
        <span className="text-ink-faint">{count}</span>
      </button>
      {open ? <div className="flex flex-col">{children}</div> : null}
    </div>
  )
}
