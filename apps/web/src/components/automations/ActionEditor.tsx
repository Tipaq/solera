import {
  AlarmClock,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  Folder,
  FolderGit2,
  FolderOpen,
  Hand,
  Maximize2,
  Play,
  Server,
  SquareTerminal,
  TriangleAlert,
} from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import {
  MAX_ACTION_COMMAND_CHARS,
  MAX_ACTION_DESCRIPTION_CHARS,
  MAX_ACTION_URL_CHARS,
  MAX_CHECK_TIMEOUT_SECONDS,
  MAX_SCHEDULE_DURATION_MINUTES,
  MAX_SCHEDULE_PROMPT_CHARS,
  MIN_CHECK_TIMEOUT_SECONDS,
  MIN_SCHEDULE_DURATION_MINUTES,
  agentKindSchema,
  resolveActionUrl,
  type ActionSuggestion,
  type ScheduleCadence,
} from '@solera/protocol'
import {
  Banner,
  Button,
  CheckCards,
  ChoiceCards,
  Field,
  Popover,
  SegmentedControl,
  Select,
  TerminalOutput,
  Tooltip,
  cx,
} from '@solera/ui'
import {
  ALL_FIELDS,
  draftFrom,
  editorStateOf,
  headerWhen,
  isService as isServiceState,
  labelMax,
  linkIsLocalOnly,
  problemsOf,
  summaryOf,
  type EditorField,
  type EditorSeed,
  type EditorState,
} from '../../lib/action-editor'
import { suggestionDraft, suggestionWhy, useActionSuggestions, useTryAction } from '../../lib/actions'
import { useAutomationMutations } from '../../lib/automations-query'
import type { CommandKind, What } from '../../lib/automations'
import { useTranslate, type MessageKey } from '../../lib/i18n'
import { setPanelExpanded } from '../../lib/panel'
import { useProjectEnvironments, useProjects } from '../../lib/projects'
import { screenText } from '../../lib/command-output'
import { useTerminalOutput } from '../../lib/terminal-output'
import { useTreeLevel } from '../../lib/tree'
import { inheritedConfigFor, useUserSettings } from '../../lib/user-settings'
import { projectScope } from '../../lib/workspace-scope'
import { useBranches } from '../../lib/worktrees'
import { PlacementField } from './served/PlacementField'
import { AGENT_LABELS, AgentIcon } from '../AgentIcon'
import { AutonomousConfinementSelect } from '../Environment'
import { useAgentSettings } from '../chat/agent-settings'
import { CheckSection } from '../schedule/CheckSection'
import { NatureIcon } from './ActionMarks'
import { ActionFooter, ActionHeader, Chip, useActionChrome, useActionPad } from './ActionSheet'
import { ScheduleBuilder } from './ScheduleBuilder'

/*
 * L'éditeur unifié d'une action (`actions.md` §1.E) : **1 · Quoi** (une commande — tâche
 * ou service — ou un agent), puis **2 · Quand** (à la demande et/ou planifiée).
 *
 * Trois règles de forme, d'après le retour de Tim :
 * - un exemple de saisie se lit comme un exemple (« ex. … », pâle, penché), jamais comme
 *   une valeur déjà là ;
 * - une erreur s'affiche sous son champ, quand on le quitte, et non en phrase au pied ;
 * - les deux étapes sont des blocs numérotés, chacun avec son choix principal en cartes.
 *
 * L'état, ses erreurs et ce qu'il enregistre sont dans `lib/action-editor.ts` ; ici, le
 * rendu et les requêtes. Rendu dans un tiroir (`ActionEditorDrawer`) ou à la place de la
 * liste dans le panneau (`ActionChromeProvider inline`).
 */

/** Un exemple se lit comme un exemple : pâle et penché, jamais comme une valeur. */
const INPUT =
  'w-full rounded-md border border-line bg-canvas px-2.5 py-2 text-sm text-ink outline-none transition-colors placeholder:italic placeholder:text-ink-faint/55 hover:border-line-strong focus:border-accent'
const INPUT_BAD = 'border-critical/60 focus:border-critical'

/** Le port qu'un exemple de lien résout : celui d'un serveur Vite. */
const EXAMPLE_PORT = 5173

/** Au-delà, les niveaux d'effort ne tiennent plus en segments dans une demi-largeur. */
const MAX_EFFORT_SEGMENTS = 4

/** `{port}` se montre tel quel dans les textes qui le citent. */
const PORT_TOKEN = { port: '{port}' }

/** En deçà, dans le panneau, l'éditeur se lit mal : on propose d'agrandir (PACT-9). */
const NARROW_PX = 360

/** Les paramètres d'une erreur : les bornes qu'elle cite. */
function problemText(key: MessageKey, state: EditorState, t: (key: MessageKey, params?: Record<string, string | number>) => string): string {
  if (key === 'actionEditor.error.labelMax') return t(key, { max: labelMax(state) })
  if (key === 'actionEditor.error.duration') return t(key, { min: MIN_SCHEDULE_DURATION_MINUTES, max: MAX_SCHEDULE_DURATION_MINUTES })
  if (key === 'actionEditor.error.checkTimeout') return t(key, { min: MIN_CHECK_TIMEOUT_SECONDS, max: MAX_CHECK_TIMEOUT_SECONDS })
  if (key === 'actionEditor.error.url') return t(key, PORT_TOKEN)
  return t(key)
}

export function ActionEditor({
  projectId,
  seed,
  conversationId,
  onClose,
  onBack,
  onSaved,
}: {
  projectId: string
  seed: EditorSeed
  /** Depuis une conversation : « Essayer » tourne dans son worktree. */
  conversationId?: string
  /** ✕ : ferme le tiroir. */
  onClose: () => void
  /** Annuler : revient au détail quand on en vient, sinon ferme. */
  onBack?: () => void
  /** Après l'enregistrement ; sinon, comme Annuler. */
  onSaved?: () => void
}) {
  const t = useTranslate()
  const pad = useActionPad()
  const chrome = useActionChrome()
  const from = seed.from
  const [state, setState] = useState<EditorState>(() => editorStateOf(seed))
  const set = (patch: Partial<EditorState>) => setState((current) => ({ ...current, ...patch }))
  const [touched, setTouched] = useState<ReadonlySet<EditorField>>(() => new Set())
  const touch = (field: EditorField) => setTouched((current) => new Set(current).add(field))
  const [sentence, setSentence] = useState<string | null>(null)
  const [picked, setPicked] = useState<string | null>(null)
  const [optionsOpen, setOptionsOpen] = useState(false)

  const { data: projects } = useProjects()
  const project = projects?.find((entry) => entry.id === projectId) ?? null
  const { data: userSettings } = useUserSettings()
  const { data: environments } = useProjectEnvironments(state.what === 'agent' ? projectId : undefined)
  // Ce qu'une session neuve du projet prendrait ; une configuration d'un autre CLI est
  // abandonnée, pas convertie.
  const config = state.config?.agent === state.agent ? state.config : inheritedConfigFor(state.agent, userSettings, project)
  const { groups, catalogError } = useAgentSettings({ config, onConfigChange: (next) => set({ config: next }) })
  const mutations = useAutomationMutations(projectId)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const isService = isServiceState(state)
  const { data: repo } = useBranches(isService ? projectId : undefined)
  const problems = problemsOf(state)
  const blocking = Object.values(problems).map((key) => problemText(key, state, t))
  const shown = (field: EditorField) => {
    const key = problems[field]
    return touched.has(field) && key ? problemText(key, state, t) : undefined
  }

  /* « Planifier » ou « Modifier la planification » : on arrive directement sur Quand. */
  const whenRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (seed.schedule) whenRef.current?.scrollIntoView({ block: 'start' })
  }, [seed.schedule])

  /* Dans le panneau, trop étroit pour éditer (EDI-21). */
  const root = useRef<HTMLDivElement>(null)
  const [narrow, setNarrow] = useState(false)
  useLayoutEffect(() => {
    const element = root.current
    if (!chrome.inline || !element) return
    const observer = new ResizeObserver(([entry]) => setNarrow(Boolean(entry && entry.contentRect.width < NARROW_PX)))
    observer.observe(element)
    return () => observer.disconnect()
  }, [chrome.inline])

  const save = async () => {
    setTouched(new Set(ALL_FIELDS))
    if (blocking.length || saving) return
    setSaving(true)
    setSaveError(null)
    try {
      await mutations.save(draftFrom(state, config), from)
      ;(onSaved ?? onBack ?? onClose)()
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  const cliLabel = AGENT_LABELS[state.agent]
  const title = state.label.trim() || (from ? from.label : t('actionEditor.titleNew'))

  return (
    <div ref={root} className="flex min-h-0 flex-1 flex-col" data-action-editor>
      <ActionHeader
        nature={{ what: state.what, kind: state.kind, agent: state.agent }}
        title={title}
        when={headerWhen(state, sentence, t)}
        extra={<Chip>{t(from ? 'actionEditor.badge.edit' : 'actionEditor.badge.new')}</Chip>}
        onClose={onClose}
      />
      {narrow ? (
        <div className={cx('flex shrink-0 items-center gap-2 border-b border-line bg-caution/10 py-2 text-xs text-ink-soft', pad)}>
          <span className="min-w-0 flex-1">{t('actionEditor.narrow.text')}</span>
          <Button size="sm" variant="ghost" icon={<Maximize2 size={13} />} onClick={() => setPanelExpanded(true)}>
            {t('actionEditor.narrow.expand')}
          </Button>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className={cx('@container/action flex flex-col gap-8 py-5', pad)}>
          {/* ------------------------------------------------------------ 1 · Quoi */}
          <Step number={1} title={t('actionEditor.step.what')} hint={t('actionEditor.step.whatHint')}>
            <WhatCards value={state.what} frozen={Boolean(from)} onChange={(what) => set({ what })} />

            {state.what === 'command' ? (
              <>
                {from ? null : (
                  <Suggestions
                    projectId={projectId}
                    picked={picked}
                    onPick={(suggestion) => {
                      const draft = suggestionDraft(suggestion, t)
                      setPicked(`${suggestion.source}:${suggestion.name}`)
                      set({ label: draft.label, kind: draft.kind, command: draft.command, subdir: draft.subdir, url: draft.url })
                    }}
                  />
                )}

                <FieldRow label={t('actionEditor.kind.label')}>
                  <ChoiceCards<CommandKind>
                    label={t('actionEditor.kind.label')}
                    size="sm"
                    columns={2}
                    value={state.kind}
                    onChange={(kind) => set({ kind })}
                    options={[
                      { value: 'task', label: t('actionEditor.kind.task'), hint: t('actionEditor.kind.taskHint'), icon: <SquareTerminal size={14} /> },
                      { value: 'service', label: t('actionEditor.kind.service'), hint: t('actionEditor.kind.serviceHint'), icon: <Server size={14} /> },
                    ]}
                  />
                </FieldRow>

                <CommandField
                  value={state.command}
                  error={shown('command')}
                  onChange={(command) => set({ command })}
                  onBlur={() => touch('command')}
                />

                <FieldRow
                  label={t('actionEditor.field.folder')}
                  error={shown('subdir')}
                  hint={t('actionEditor.field.folderHint', { path: `${t('actionEditor.field.worktree')}${state.subdir.trim() ? `/${state.subdir.trim()}` : ''}` })}
                >
                  <FolderPicker projectId={projectId} value={state.subdir} onChange={(subdir) => { set({ subdir }); touch('subdir') }} />
                </FieldRow>

                {isService ? (
                  <FieldRow label={t('served.placement.label')} error={shown('branch')}>
                    <PlacementField
                      value={state.placement}
                      onChange={(placement) => {
                        set({ placement })
                        // La branche de la racine d'office : c'est celle où il tournera tout de suite.
                        if (placement === 'branch' && !state.pinnedBranch && repo?.current) set({ pinnedBranch: repo.current })
                      }}
                      branch={state.pinnedBranch}
                      onBranch={(pinnedBranch) => { set({ pinnedBranch }); touch('branch') }}
                      branches={repo?.branches ?? []}
                      rootBranch={repo?.current ?? null}
                      url={state.url}
                    />
                  </FieldRow>
                ) : null}

                {isService ? <LinkField value={state.url} error={shown('url')} onChange={(url) => set({ url })} onBlur={() => touch('url')} /> : null}

                <TryCommand projectId={projectId} conversationId={conversationId} state={state} subdirOk={!problems.subdir} />
              </>
            ) : (
              <>
                <FieldRow label={t('actionEditor.field.cli')}>
                  <span className="flex flex-wrap gap-1.5" role="group" aria-label={t('actionEditor.field.cli')}>
                    {agentKindSchema.options.map((agent) => (
                      <button
                        key={agent}
                        type="button"
                        aria-pressed={state.agent === agent}
                        onClick={() => set({ agent })}
                        className={cx(
                          'inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-sm transition-colors',
                          state.agent === agent ? 'border-accent bg-accent-wash/40 text-ink' : 'border-line text-ink-soft hover:border-line-strong hover:text-ink',
                        )}
                      >
                        <AgentIcon agent={agent} size={13} /> {AGENT_LABELS[agent]}
                      </button>
                    ))}
                  </span>
                </FieldRow>
                {catalogError ? <Banner tone="caution">{t('composer.catalog.unavailable')}</Banner> : null}
                <div className="grid gap-4 @min-[30rem]/action:grid-cols-2">
                  {groups
                    .filter((group) => group.key === 'model' || group.key === 'effort')
                    .map((group) => (
                      <FieldRow key={group.key} label={t(group.key === 'model' ? 'actionEditor.field.model' : 'actionEditor.field.effort')}>
                        {/* L'effort en segments tant qu'ils tiennent ; au-delà, une liste. */}
                        {group.key === 'effort' && group.options.length <= MAX_EFFORT_SEGMENTS ? (
                          <SegmentedControl
                            label={group.label}
                            className="flex"
                            value={group.value}
                            onChange={group.onChange}
                            segments={group.options.map((option) => ({ value: option.value, label: option.label }))}
                          />
                        ) : (
                          <Select placeholder={group.label} value={group.value} options={group.options} onChange={group.onChange} />
                        )}
                      </FieldRow>
                    ))}
                </div>
                <FieldRow label={t('actionEditor.field.prompt')} error={shown('prompt')} hint={t('actionEditor.field.promptHint')}>
                  <textarea
                    aria-label={t('actionEditor.field.prompt')}
                    value={state.prompt}
                    maxLength={MAX_SCHEDULE_PROMPT_CHARS}
                    onChange={(event) => set({ prompt: event.target.value })}
                    onBlur={() => touch('prompt')}
                    rows={6}
                    placeholder={t('actionEditor.field.promptPlaceholder')}
                    className={cx(INPUT, 'leading-relaxed', shown('prompt') && INPUT_BAD)}
                  />
                </FieldRow>
                <FieldRow label={t('actionEditor.field.where')}>
                  <ChoiceCards
                    label={t('actionEditor.field.where')}
                    size="sm"
                    columns={2}
                    value={state.worktreeMode}
                    onChange={(worktreeMode) => set({ worktreeMode })}
                    options={[
                      { value: 'root', label: t('actionEditor.where.root'), hint: t('actionEditor.where.rootHint'), icon: <Folder size={14} /> },
                      { value: 'new', label: t('actionEditor.where.worktree'), hint: t('actionEditor.where.worktreeHint'), icon: <FolderGit2 size={14} /> },
                    ]}
                  />
                  {environments ? (
                    <div className="mt-2">
                      <AutonomousConfinementSelect
                        value={state.confined}
                        inherited={environments.autonomousConfined}
                        onChange={(confined) => set({ confined })}
                      />
                    </div>
                  ) : null}
                </FieldRow>
                <AgentOptions
                  open={optionsOpen}
                  onOpen={setOptionsOpen}
                  state={state}
                  groups={groups.filter((group) => group.key !== 'model' && group.key !== 'effort')}
                  confined={state.confined ?? environments?.autonomousConfined ?? false}
                  durationError={shown('duration')}
                  onChange={set}
                  onBlurDuration={() => touch('duration')}
                />
                <CheckSection
                  projectId={projectId}
                  taskId={from?.source.kind === 'task' ? from.source.task.id : undefined}
                  script={state.checkScript}
                  timeout={state.checkTimeout}
                  onScriptChange={(checkScript) => set({ checkScript, checkEdited: true })}
                  onTimeoutChange={(checkTimeout) => set({ checkTimeout })}
                />
              </>
            )}

            <div className="grid gap-4 @min-[30rem]/action:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <FieldRow label={t('actionEditor.field.label')} error={shown('label')} counter={`${state.label.trim().length}/${labelMax(state)}`}>
                <input
                  aria-label={t('actionEditor.field.label')}
                  value={state.label}
                  onChange={(event) => set({ label: event.target.value })}
                  onBlur={() => touch('label')}
                  maxLength={labelMax(state) + 10}
                  placeholder={t(state.what === 'command' ? 'actionEditor.field.labelPlaceholderCommand' : 'actionEditor.field.labelPlaceholderAgent')}
                  className={cx(INPUT, shown('label') && INPUT_BAD)}
                />
              </FieldRow>
              {state.what === 'command' ? (
                <FieldRow label={t('actionEditor.field.description')} optional>
                  <input
                    aria-label={t('actionEditor.field.description')}
                    value={state.description}
                    maxLength={MAX_ACTION_DESCRIPTION_CHARS}
                    onChange={(event) => set({ description: event.target.value })}
                    placeholder={t('actionEditor.field.descriptionPlaceholder')}
                    className={INPUT}
                  />
                </FieldRow>
              ) : null}
            </div>
            <ButtonPreview state={state} />
          </Step>

          {/* ------------------------------------------------------------ 2 · Quand */}
          <div ref={whenRef} className="scroll-mt-4">
            <Step number={2} title={t('actionEditor.step.when')}>
              <CheckCards
                label={t('actionEditor.when.label')}
                columns={2}
                values={[...(state.onDemand ? ['demand' as const] : []), ...(state.scheduled ? ['scheduled' as const] : [])]}
                onChange={(values) => {
                  set({ onDemand: values.includes('demand'), scheduled: values.includes('scheduled') })
                  touch('when')
                }}
                options={[
                  { value: 'demand', label: t('actionEditor.when.demand'), hint: t('actionEditor.when.demandHint'), icon: <Hand size={15} /> },
                  { value: 'scheduled', label: t('actionEditor.when.scheduled'), hint: t('actionEditor.when.scheduledHint'), icon: <AlarmClock size={15} /> },
                ]}
              />
              {/* Rien de coché ne s'enregistre pas : on le dit tout de suite. */}
              {problems.when ? <ErrorLine text={t(problems.when)} /> : null}

              {state.scheduled ? (
                isService ? (
                  <div className="flex flex-col gap-1.5 rounded-md bg-caution/10 px-3.5 py-3" data-service-schedule>
                    <span className="flex items-center gap-1.5 text-xs font-medium text-caution">
                      <TriangleAlert size={12} aria-hidden /> {t('actionEditor.when.serviceLimit')}
                    </span>
                    <span className="text-xs text-ink-soft">{t('actionEditor.when.serviceLimitHint')}</span>
                    {problems.serviceSchedule ? <ErrorLine text={t(problems.serviceSchedule)} /> : null}
                  </div>
                ) : (
                  <div className="flex flex-col gap-1.5">
                    <ScheduleBuilder
                      key={from?.id ?? 'new'}
                      initial={state.cadence}
                      onChange={(cadence: ScheduleCadence | null, words: string | null) => {
                        set({ cadence })
                        setSentence(words)
                      }}
                    />
                    {shown('cadence') ? <ErrorLine text={shown('cadence')} /> : null}
                  </div>
                )
              ) : null}
            </Step>
          </div>

          {saveError ? <Banner>{saveError}</Banner> : null}
        </div>
      </div>

      <ActionFooter
        left={<span className="min-w-0 truncate text-xs text-ink-faint" data-editor-summary>{summaryOf(state, sentence, cliLabel, t)}</span>}
        right={
          <>
            <Button size="sm" variant="ghost" onClick={onBack ?? onClose}>
              {t('actionEditor.footer.cancel')}
            </Button>
            <SaveButton
              missing={blocking.length ? t('actionEditor.footer.missing', { problems: blocking.join(' ') }) : null}
              busy={saving}
              onSave={() => void save()}
            />
          </>
        }
      />
    </div>
  )
}

/* ------------------------------------------------------------------ morceaux */

function Step({ number, title, hint, children }: { number: number; title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <header className="flex items-baseline gap-2.5">
        <span className="grid size-6 shrink-0 place-items-center rounded-full bg-surface-high text-xs font-semibold tabular-nums text-ink">{number}</span>
        <h3 className="text-base font-semibold text-ink">{title}</h3>
        {hint ? <span className="text-xs text-ink-faint">{hint}</span> : null}
      </header>
      <div className="flex flex-col gap-5 pl-[34px]">{children}</div>
    </section>
  )
}

function FieldRow({
  label,
  hint,
  error,
  optional,
  counter,
  children,
}: {
  label: string
  hint?: ReactNode
  error?: string
  optional?: boolean
  counter?: string
  children: ReactNode
}) {
  const t = useTranslate()
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="flex items-baseline gap-2 text-xs">
        <span className="font-medium text-ink-soft">{label}</span>
        {optional ? <span className="text-ink-faint">{t('actionEditor.field.optional')}</span> : null}
        {counter ? <span className="ml-auto tabular-nums text-ink-faint">{counter}</span> : null}
      </span>
      {children}
      {error ? <ErrorLine text={error} /> : hint ? <span className="text-xs text-ink-faint">{hint}</span> : null}
    </div>
  )
}

function ErrorLine({ text }: { text?: string }) {
  if (!text) return null
  return (
    <span role="alert" className="text-xs text-critical">
      {text}
    </span>
  )
}

/** Commande ou agent ; en modification, la nature est figée (Q5) : seule la sienne reste. */
function WhatCards({ value, frozen, onChange }: { value: What; frozen: boolean; onChange: (what: What) => void }) {
  const t = useTranslate()
  const options = [
    { value: 'command' as const, label: t('actionEditor.what.command'), hint: t('actionEditor.what.commandHint'), icon: <SquareTerminal size={16} /> },
    { value: 'agent' as const, label: t('actionEditor.what.agent'), hint: t('actionEditor.what.agentHint'), icon: <Bot size={16} /> },
  ]
  return (
    <div className="flex flex-col gap-1.5">
      <ChoiceCards<What>
        label={t('actionEditor.what.label')}
        columns={2}
        value={value}
        onChange={onChange}
        options={frozen ? options.filter((option) => option.value === value) : options}
      />
      {frozen ? <span className="text-xs text-ink-faint">{t('actionEditor.what.frozen')}</span> : null}
    </div>
  )
}

/** « Trouvé dans le dépôt · un clic remplit tout » (EDI-4). Rien tant que le dépôt ne propose rien. */
function Suggestions({ projectId, picked, onPick }: { projectId: string; picked: string | null; onPick: (suggestion: ActionSuggestion) => void }) {
  const t = useTranslate()
  const { data } = useActionSuggestions(projectId)
  if (!data?.length) return null
  return (
    <div className="flex flex-col gap-2" data-suggestions>
      <span className="flex items-baseline gap-2 text-xs text-ink-faint">
        <span className="font-medium text-ink-soft">{t('actionEditor.found.title')}</span>
        <span>{t('actionEditor.found.hint')}</span>
      </span>
      <span className="flex flex-wrap gap-1.5">
        {data.map((suggestion) => {
          const key = `${suggestion.source}:${suggestion.name}`
          const label = suggestionDraft(suggestion, t).label
          return (
            <Tooltip key={key} label={suggestionWhy(suggestion, t)}>
              <button
                type="button"
                onClick={() => onPick(suggestion)}
                aria-pressed={picked === key}
                className={cx(
                  'inline-flex h-8 max-w-full items-center gap-1.5 rounded-md border px-2.5 text-xs transition-colors',
                  picked === key ? 'border-accent bg-accent-wash/40 text-ink' : 'border-line text-ink-soft hover:border-line-strong hover:text-ink',
                )}
              >
                {suggestion.kind === 'service' ? <Server size={12} className="shrink-0 text-ink-faint" aria-hidden /> : <SquareTerminal size={12} className="shrink-0 text-ink-faint" aria-hidden />}
                <span className="shrink-0">{label}</span>
                <code className="min-w-0 truncate font-mono text-[11px] text-ink-faint">{suggestion.command}</code>
              </button>
            </Tooltip>
          )
        })}
      </span>
    </div>
  )
}

/** « $ » et la commande, une à quatre lignes (EDI-6). */
function CommandField({ value, error, onChange, onBlur }: { value: string; error?: string; onChange: (value: string) => void; onBlur: () => void }) {
  const t = useTranslate()
  return (
    <FieldRow label={t('actionEditor.field.command')} error={error}>
      <span
        className={cx(
          'flex items-start gap-2 rounded-md border bg-canvas px-2.5 py-2 transition-colors focus-within:border-accent hover:border-line-strong',
          error ? INPUT_BAD : 'border-line',
        )}
      >
        <span aria-hidden className="select-none font-mono text-sm text-ink-faint">
          $
        </span>
        <textarea
          aria-label={t('actionEditor.field.command')}
          value={value}
          maxLength={MAX_ACTION_COMMAND_CHARS}
          onChange={(event) => onChange(event.target.value)}
          onBlur={onBlur}
          rows={Math.min(4, Math.max(1, value.split('\n').length))}
          placeholder={t('actionEditor.field.commandPlaceholder')}
          spellCheck={false}
          className="min-w-0 flex-1 resize-none bg-transparent font-mono text-sm text-ink outline-none placeholder:italic placeholder:text-ink-faint/55"
        />
      </span>
    </FieldRow>
  )
}

/** Le lien d'un service, `{port}` résolu en exemple, et l'alerte `localhost` à distance (EDI-9). */
function LinkField({ value, error, onChange, onBlur }: { value: string; error?: string; onChange: (value: string) => void; onBlur: () => void }) {
  const t = useTranslate()
  const trimmed = value.trim()
  const hint = trimmed
    ? t('actionEditor.field.linkResolved', { port: EXAMPLE_PORT, url: resolveActionUrl(trimmed, [EXAMPLE_PORT]) ?? '' })
    : t('actionEditor.field.linkHint', PORT_TOKEN)
  const host = trimmed.match(/^https?:\/\/([^/:?#]+|\[[^\]]+\])/i)?.[1] ?? 'localhost'
  return (
    <FieldRow label={t('actionEditor.field.link')} optional error={error} hint={hint}>
      <input
        aria-label={t('actionEditor.field.link')}
        value={value}
        maxLength={MAX_ACTION_URL_CHARS}
        inputMode="url"
        spellCheck={false}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
        placeholder={t('actionEditor.field.linkPlaceholder', PORT_TOKEN)}
        className={cx(INPUT, 'font-mono', error && INPUT_BAD)}
      />
      {linkIsLocalOnly(value, location.hostname) ? (
        <p className="flex items-start gap-1.5 text-xs text-caution" data-link-remote>
          <TriangleAlert size={12} className="mt-0.5 shrink-0" aria-hidden /> {t('actionEditor.field.linkRemote', { host })}
        </p>
      ) : null}
    </FieldRow>
  )
}

/**
 * Le dossier, choisi dans la vraie arborescence du projet (EDI-7) : un niveau à la fois,
 * déplié à la demande, dossiers seulement.
 */
function FolderPicker({ projectId, value, onChange }: { projectId: string; value: string; onChange: (next: string) => void }) {
  const t = useTranslate()
  const [open, setOpen] = useState(false)
  const pick = (path: string) => {
    onChange(path)
    setOpen(false)
  }
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      label={t('actionEditor.field.folderPick')}
      side="bottom"
      align="start"
      className="max-h-80 w-72 overflow-y-auto p-1"
      trigger={
        <button
          type="button"
          aria-label={t('actionEditor.field.folderCurrent', { path: value || t('actionEditor.field.folderRoot') })}
          className="inline-flex h-[38px] w-full min-w-0 items-center gap-2 rounded-md border border-line bg-canvas px-2.5 text-left text-sm text-ink transition-colors hover:border-line-strong"
        >
          <Folder size={14} className="shrink-0 text-ink-faint" aria-hidden />
          <span className={cx('min-w-0 flex-1 truncate', value ? 'font-mono' : '')}>{value || t('actionEditor.field.folderRoot')}</span>
          <ChevronDown size={14} className="shrink-0 text-ink-faint" aria-hidden />
        </button>
      }
    >
      <ul className="flex flex-col py-0.5" role="tree" aria-label={t('actionEditor.field.folderList')}>
        <li role="none">
          <FolderRow name={t('actionEditor.field.folderRoot')} path="" depth={0} selected={value === ''} onPick={pick} />
        </li>
        {open ? <FolderLevel projectId={projectId} path="" depth={1} value={value} onPick={pick} /> : null}
      </ul>
    </Popover>
  )
}

function FolderLevel({ projectId, path, depth, value, onPick }: { projectId: string; path: string; depth: number; value: string; onPick: (path: string) => void }) {
  const t = useTranslate()
  const { data, isPending } = useTreeLevel(projectScope(projectId), path, true)
  const folders = (data?.entries ?? []).filter((entry) => entry.isDirectory && entry.name !== '.git')
  if (isPending) return null
  if (!folders.length) {
    return depth > 1 ? (
      <li role="none" className="py-1 text-xs text-ink-faint" style={{ paddingLeft: 8 + depth * 16 }}>
        {t('actionEditor.field.folderEmpty')}
      </li>
    ) : null
  }
  return (
    <>
      {folders.map((entry) => (
        <FolderBranch key={entry.path} projectId={projectId} name={entry.name} path={entry.path} depth={depth} value={value} onPick={onPick} />
      ))}
    </>
  )
}

function FolderBranch({ projectId, name, path, depth, value, onPick }: { projectId: string; name: string; path: string; depth: number; value: string; onPick: (path: string) => void }) {
  // Déplié d'office sur le chemin du dossier choisi : on le retrouve en rouvrant.
  const [expanded, setExpanded] = useState(() => value.startsWith(`${path}/`))
  return (
    <li role="none">
      <FolderRow name={name} path={path} depth={depth} selected={value === path} expanded={expanded} onToggle={() => setExpanded((open) => !open)} onPick={onPick} />
      {expanded ? (
        <ul role="group">
          <FolderLevel projectId={projectId} path={path} depth={depth + 1} value={value} onPick={onPick} />
        </ul>
      ) : null}
    </li>
  )
}

function FolderRow({
  name,
  path,
  depth,
  selected,
  expanded,
  onToggle,
  onPick,
}: {
  name: string
  path: string
  depth: number
  selected: boolean
  expanded?: boolean
  onToggle?: () => void
  onPick: (path: string) => void
}) {
  const t = useTranslate()
  return (
    <span className="flex items-center" style={{ paddingLeft: Math.max(0, depth - 1) * 16 }}>
      {onToggle ? (
        <button
          type="button"
          aria-label={t('actionEditor.field.folderOpen', { name })}
          aria-expanded={expanded}
          onClick={onToggle}
          className="grid size-6 shrink-0 place-items-center rounded text-ink-faint hover:bg-surface-high hover:text-ink"
        >
          {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </button>
      ) : (
        <span className="size-6 shrink-0" />
      )}
      <button
        type="button"
        role="treeitem"
        aria-selected={selected}
        onClick={() => onPick(path)}
        className={cx(
          'flex min-w-0 flex-1 items-center gap-2 rounded px-1.5 py-1.5 text-left text-sm hover:bg-surface-high',
          selected ? 'text-accent' : 'text-ink-soft',
        )}
      >
        {expanded ? <FolderOpen size={13} className="shrink-0 text-ink-faint" aria-hidden /> : <Folder size={13} className="shrink-0 text-ink-faint" aria-hidden />}
        <span className={cx('min-w-0 truncate', path ? 'font-mono text-xs' : '')}>{name}</span>
        {selected ? <Check size={13} className="ml-auto shrink-0" aria-hidden /> : null}
      </button>
    </span>
  )
}

/**
 * « Essayer » (EDI-10) : un terminal d'essai, sans rien enregistrer ; sa sortie se lit
 * dessous. Toute modification de la commande l'efface.
 */
function TryCommand({
  projectId,
  conversationId,
  state,
  subdirOk,
}: {
  projectId: string
  conversationId?: string
  state: EditorState
  /** Un dossier refusé ne s'essaie pas : le serveur le refuserait aussi. */
  subdirOk: boolean
}) {
  const t = useTranslate()
  const attempt = useTryAction(projectId)
  const [tried, setTried] = useState<{ terminalId: string; command: string; subdir: string } | null>(null)
  const output = useTerminalOutput(projectId, tried?.terminalId ?? null, true)
  const stale = tried !== null && (tried.command !== state.command || tried.subdir !== state.subdir)
  const command = state.command.trim()
  return (
    <div className="flex flex-col gap-2" data-try>
      <span className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="secondary"
          icon={<Play size={13} />}
          disabled={!command || !subdirOk || attempt.isPending}
          onClick={() =>
            attempt.mutate(
              { command, subdir: state.subdir.trim(), label: state.label, conversationId },
              { onSuccess: (terminal) => setTried({ terminalId: terminal.id, command: state.command, subdir: state.subdir }) },
            )
          }
        >
          {t('actionEditor.try.button')}
        </Button>
        <span className="text-xs text-ink-faint">{t(command ? 'actionEditor.try.hint' : 'actionEditor.try.needCommand')}</span>
      </span>
      {attempt.isError ? <Banner>{attempt.error.message}</Banner> : null}
      {tried && !stale ? (
        output.unreadable ? (
          <p className="text-xs text-ink-faint">{t('actionEditor.try.unreadable')}</p>
        ) : (
          <TerminalOutput
            label={t('actionEditor.try.output')}
            follow
            className="max-h-48"
            text={output.text === null || output.text === '' ? t('actionEditor.try.running') : screenText(output.text)}
          />
        )
      ) : null}
    </div>
  )
}

/**
 * Les réglages d'un agent que le prototype taisait (Q2), repliés sous le prompt :
 * permissions et autres catégories du CLI, durée maximale, chevauchement.
 */
function AgentOptions({
  open,
  onOpen,
  state,
  groups,
  confined,
  durationError,
  onChange,
  onBlurDuration,
}: {
  open: boolean
  onOpen: (open: boolean) => void
  state: EditorState
  groups: ReturnType<typeof useAgentSettings>['groups']
  confined: boolean
  durationError?: string
  onChange: (patch: Partial<EditorState>) => void
  onBlurDuration: () => void
}) {
  const t = useTranslate()
  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        aria-expanded={open || Boolean(durationError)}
        onClick={() => onOpen(!open)}
        className="inline-flex w-fit items-center gap-1 text-sm text-ink-soft hover:text-ink"
      >
        {open || durationError ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
        {t('actionEditor.options.toggle')} <span className="text-xs text-ink-faint">{t('actionEditor.options.hint')}</span>
      </button>
      {open || durationError ? (
        <div className="flex flex-col gap-4 border-l border-line pl-3.5" data-agent-options>
          <div className="grid gap-4 @min-[30rem]/action:grid-cols-2">
            {groups.map((group) => (
              <Select key={group.key} label={group.label} value={group.value} options={group.options} onChange={group.onChange} />
            ))}
          </div>
          <Banner tone="info">{t(confined ? 'schedule.form.unattended.confined' : 'schedule.form.unattended')}</Banner>
          <div className="grid gap-4 @min-[30rem]/action:grid-cols-2">
            <Field
              label={t('schedule.form.maxDuration')}
              hint={t('schedule.form.maxDurationHint')}
              error={durationError}
              type="number"
              min={MIN_SCHEDULE_DURATION_MINUTES}
              max={MAX_SCHEDULE_DURATION_MINUTES}
              value={state.maxDuration}
              onChange={(event) => onChange({ maxDuration: event.target.value })}
              onBlur={onBlurDuration}
            />
            <Select
              label={t('schedule.form.overlap')}
              value={state.overlapPolicy}
              onChange={(overlapPolicy) => onChange({ overlapPolicy })}
              options={[
                { value: 'skip', label: t('schedule.form.overlap.skip'), hint: t('schedule.form.overlap.skipHint') },
                { value: 'wait', label: t('schedule.form.overlap.wait'), hint: t('schedule.form.overlap.waitHint') },
              ]}
            />
          </div>
        </div>
      ) : null}
    </div>
  )
}

/** Le bouton tel qu'il apparaîtra dans le lanceur et la liste (EDI-16). */
function ButtonPreview({ state }: { state: EditorState }) {
  const t = useTranslate()
  const label = state.label.trim()
  const description = state.what === 'command' ? state.description.trim() : ''
  return (
    <div className="flex flex-col gap-1.5" data-button-preview>
      <span className="text-xs text-ink-faint">{t('actionEditor.preview.title')}</span>
      <div className="flex max-w-md items-center gap-2.5 rounded-md border border-dashed border-line px-3 py-2" aria-hidden>
        <span className="grid size-7 shrink-0 place-items-center rounded-md bg-surface-high">
          <NatureIcon nature={{ what: state.what, kind: state.kind, agent: state.agent }} size={13} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className={cx('truncate text-sm', label ? 'text-ink' : 'text-ink-faint/60 italic')}>{label || t('actionEditor.preview.labelPlaceholder')}</span>
          <span className="truncate text-xs text-ink-faint">
            {description || t(isServiceState(state) ? 'actionEditor.preview.stopped' : 'actionEditor.preview.neverRun')}
          </span>
        </span>
        <span className="inline-flex h-7 items-center gap-1 rounded-md border border-line px-2 text-xs text-ink-soft">
          <Play size={11} /> {t('actionEditor.preview.launch')}
        </span>
      </div>
    </div>
  )
}

/**
 * « Enregistrer », grisé tant qu'un problème bloque, sa raison en infobulle (EDI-20). Un
 * clic dessus quand même marque tous les champs touchés : chacun montre son erreur.
 */
function SaveButton({ missing, busy, onSave }: { missing: string | null; busy: boolean; onSave: () => void }) {
  const t = useTranslate()
  if (!missing) {
    return (
      <Button size="sm" disabled={busy} onClick={onSave}>
        {t('actionEditor.footer.save')}
      </Button>
    )
  }
  // Grisé, le vrai bouton se tait : c'est son enveloppe qu'on atteint et qu'on annonce,
  // un bouton désactivé ne recevant ni le clic ni le focus.
  const button = (
    <Button size="sm" disabled tabIndex={-1} aria-hidden className="pointer-events-none">
      {t('actionEditor.footer.save')}
    </Button>
  )
  return (
    <Tooltip label={missing}>
      <span
        role="button"
        tabIndex={0}
        aria-disabled
        onClick={onSave}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return
          event.preventDefault()
          onSave()
        }}
        aria-label={t('actionEditor.footer.saveBlocked', { problems: missing })}
        className="inline-flex rounded-md"
        data-save-blocked
      >
        {button}
      </span>
    </Tooltip>
  )
}

