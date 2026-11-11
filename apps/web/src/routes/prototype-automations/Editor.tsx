/* PROTOTYPE — jetable (branche proto/page-projet). Ne pas fusionner dans main.
 *
 * L'éditeur unifié d'une action : **1 · Quoi** (une commande ou un agent), puis
 * **2 · Quand** (à la demande et/ou planifiée). Il reprend ce que l'ancien éditeur des
 * actions savait faire — suggestions du dépôt, arborescence, lien `{port}`, « Essayer »
 * — et y ajoute l'agent et la planification.
 *
 * Trois règles de forme, d'après le retour de Tim sur la version précédente :
 * - un exemple de saisie se lit comme un exemple (« ex. … », encre très pâle, italique),
 *   jamais comme une valeur déjà là ;
 * - une erreur s'affiche sous son champ, quand on le quitte, et non en phrase au pied ;
 * - les deux étapes sont des blocs numérotés, chacun avec son choix principal en cartes.
 *
 * Aucune écriture : Enregistrer et Essayer sont simulés.
 */
import {
  AlarmClock,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  Folder,
  FolderOpen,
  Hand,
  Play,
  Server,
  SquareTerminal,
  TriangleAlert,
  Zap,
} from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { MAX_ACTION_LABEL_CHARS, resolveActionUrl, type AgentKind, type ScheduleCadence } from '@solera/protocol'
import { Button, Popover, cx } from '@solera/ui'
import { AgentIcon } from '../../components/AgentIcon'
import { ActionFooter, ActionHeader, Chip, useActionPad, whenWords } from './DrawerParts'
import { ScheduleBuilder } from './ScheduleBuilder'
import { REPO_TREE, SUGGESTIONS, fakeOutput, soleraIsRemote, type Suggestion } from '../prototype-actions/data'
import type { Automation, What } from './model'
import { PlacementField, type ServicePlacement } from './served'

export interface EditorSeed {
  from?: Automation
  /** « Planifier » : ouvre l'éditeur avec la planification cochée. */
  schedule?: boolean
  /** « + Nouveau service / commande / agent » : la nature choisie d'avance. */
  preset?: { what: What; kind?: 'task' | 'service' }
  /** « En faire une action » (un travail lancé par une session) : les champs pré-remplis. */
  prefill?: { label?: string; command?: string; url?: string; description?: string }
}

type Kind = 'task' | 'service'
type Where = 'root' | 'worktree' | 'confined'
type Field = 'label' | 'command' | 'prompt' | 'subdir' | 'url' | 'when' | 'cron'

const AGENTS: { kind: AgentKind; label: string; models: string[] }[] = [
  { kind: 'claude', label: 'Claude', models: ['Par défaut du projet', 'Opus 5.5', 'Sonnet 5.5', 'Haiku 5.5'] },
  { kind: 'codex', label: 'Codex', models: ['Par défaut du projet', 'gpt-5.5-codex', 'gpt-5.5-mini'] },
  { kind: 'grok', label: 'Grok', models: ['Par défaut du projet', 'grok-5', 'grok-5-mini'] },
  { kind: 'opencode', label: 'OpenCode', models: ['Par défaut du projet'] },
]
const EFFORTS = ['Bas', 'Moyen', 'Élevé'] as const

/** Un exemple se lit comme un exemple : pâle et penché, jamais comme une valeur. */
const INPUT =
  'w-full rounded-md border border-line bg-canvas px-2.5 py-2 text-sm text-ink outline-none transition-colors placeholder:italic placeholder:text-ink-faint/55 hover:border-line-strong focus:border-accent'
const INPUT_BAD = 'border-critical/60 focus:border-critical'

export function ActionEditorBody({ seed, onClose, onBack, simulate }: {
  seed: EditorSeed
  /** ✕ : ferme le tiroir. */
  onClose: () => void
  /** Annuler : revient au détail quand on en vient, sinon ferme. */
  onBack?: () => void
  simulate: (text: string) => void
}) {
  const pad = useActionPad()
  const from = seed.from
  const [what, setWhat] = useState<What>(from?.what ?? seed.preset?.what ?? 'command')
  const [kind, setKind] = useState<Kind>(from?.commandKind ?? seed.preset?.kind ?? 'task')
  const [label, setLabel] = useState(from?.label ?? seed.prefill?.label ?? '')
  const [description, setDescription] = useState(from?.description ?? seed.prefill?.description ?? '')
  const [command, setCommand] = useState(from?.command ?? seed.prefill?.command ?? '')
  const [subdir, setSubdir] = useState(from?.subdir ?? '')
  const [url, setUrl] = useState(from?.action?.url ?? seed.prefill?.url ?? '')
  /* SIMULÉ : où tourne un service. Le serveur ne connaît que « là d'où on le lance ». */
  const [placement, setPlacement] = useState<ServicePlacement>('follow')
  const [pinnedBranch, setPinnedBranch] = useState('main')
  const [agent, setAgent] = useState<AgentKind>(from?.agent ?? 'claude')
  const [model, setModel] = useState('Par défaut du projet')
  const [effort, setEffort] = useState<(typeof EFFORTS)[number]>('Moyen')
  const [prompt, setPrompt] = useState(from?.prompt ?? '')
  const [where, setWhere] = useState<Where>('worktree')
  const [checkOpen, setCheckOpen] = useState(Boolean(from?.task?.check))
  const [check, setCheck] = useState(from?.task?.check?.script ?? '')
  const [onDemand, setOnDemand] = useState(from?.onDemand ?? true)
  const [scheduled, setScheduled] = useState(Boolean(from?.schedule) || Boolean(seed.schedule))
  /* La cadence vient du ScheduleBuilder : il la produit, et la phrase en clair avec. */
  const [cadence, setCadence] = useState<ScheduleCadence | null>(from?.schedule?.cadence ?? null)
  const [human, setHuman] = useState<string | null>(null)
  const [, setStopCadence] = useState<ScheduleCadence | null>(null)
  const whenRef = useRef<HTMLDivElement>(null)
  /* « Planifier » ou « Modifier » la cadence : on arrive directement sur Quand. */
  useEffect(() => {
    if (seed.schedule) whenRef.current?.scrollIntoView({ block: 'start' })
  }, [seed.schedule])
  const [touched, setTouched] = useState<ReadonlySet<Field>>(() => new Set())
  const [tried, setTried] = useState<string[] | null>(null)
  const [picked, setPicked] = useState<string | null>(null)

  const touch = (field: Field) => setTouched((current) => new Set(current).add(field))
  const isService = what === 'command' && kind === 'service'

  /* Les problèmes, champ par champ ; affichés sous le champ une fois quitté. */
  const subdirTrim = subdir.trim()
  const problems: Partial<Record<Field, string>> = {}
  if (!label.trim()) problems.label = 'Un libellé court : c’est le texte du bouton.'
  else if (label.trim().length > MAX_ACTION_LABEL_CHARS) problems.label = `${MAX_ACTION_LABEL_CHARS} caractères au plus.`
  if (what === 'command' && !command.trim()) problems.command = 'La commande à lancer.'
  if (what === 'agent' && !prompt.trim()) problems.prompt = 'Ce que l’agent doit faire.'
  if (what === 'command' && subdirTrim.startsWith('/')) problems.subdir = 'Un chemin relatif au worktree : l’action suit le worktree d’où on la lance.'
  else if (what === 'command' && subdirTrim.split(/[\\/]/).includes('..')) problems.subdir = 'Sans « .. » : on reste dans le projet.'
  if (isService && url.trim() && !/^https?:\/\/[^\s/?#]+(?:[/?#]\S*)?$/i.test(url.trim().replaceAll('{port}', '1'))) problems.url = 'Une adresse http(s), avec {port} si tu veux.'
  if (!onDemand && !scheduled) problems.when = 'Au moins un des deux : à la demande, ou planifiée.'
  if (scheduled && !cadence) problems.cron = 'La planification est incomplète.'
  const blocking = Object.values(problems)
  const shown = (field: Field) => (touched.has(field) ? problems[field] : undefined)

  const pick = (suggestion: Suggestion) => {
    setPicked(suggestion.command)
    setLabel(suggestion.label)
    setKind(suggestion.kind)
    setCommand(suggestion.command)
    setSubdir(suggestion.subdir)
    setUrl(suggestion.url ?? '')
    setTried(null)
  }

  const summary = [
    what === 'command' ? `Commande · ${kind === 'service' ? 'service' : 'tâche'}` : `Agent · ${AGENTS.find((entry) => entry.kind === agent)!.label}`,
    [onDemand ? 'à la demande' : null, scheduled ? (human ?? 'planifiée') : null].filter(Boolean).join(' + ') || 'jamais',
  ]

  const save = () => {
    setTouched(new Set<Field>(['label', 'command', 'prompt', 'subdir', 'url', 'when', 'cron']))
    if (blocking.length) return
    simulate(`enregistrer « ${label.trim()} »`)
    ;(onBack ?? onClose)()
  }

  return (
    <>
      <ActionHeader
        nature={{ what, kind, agent }}
        title={label.trim() || (from ? from.label : 'Nouvelle action')}
        when={whenWords(onDemand, scheduled ? cadence : null)}
        extra={<Chip>{from ? 'modification' : 'nouvelle'}</Chip>}
        onClose={onClose}
      />

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className={cx('flex flex-col gap-8 py-5', pad)}>
          {/* ------------------------------------------------------------ 1 · Quoi */}
          <Step number={1} title="Quoi" hint="Ce que le bouton lance.">
            <div className="grid gap-2 @min-[30rem]/action:grid-cols-2">
              <BigChoice active={what === 'command'} onClick={() => setWhat('command')} icon={<SquareTerminal size={16} />} title="Une commande" text="Un script du dépôt. Pas d’agent, pas de jetons." />
              <BigChoice active={what === 'agent'} onClick={() => setWhat('agent')} icon={<Bot size={16} />} title="Un agent" text="Un prompt confié à un CLI, dans une session que tu relis." />
            </div>

            {what === 'command' ? (
              <>
                <div className="flex flex-col gap-2">
                  <span className="flex items-baseline gap-2 text-xs text-ink-faint">
                    <span className="font-medium text-ink-soft">Trouvé dans le dépôt</span>
                    <span>un clic remplit tout</span>
                    <SimTag />
                  </span>
                  <span className="flex flex-wrap gap-1.5">
                    {SUGGESTIONS.map((suggestion) => (
                      <button
                        key={suggestion.command}
                        type="button"
                        onClick={() => pick(suggestion)}
                        title={`${suggestion.source} — ${suggestion.why}`}
                        className={cx(
                          'inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs transition-colors',
                          picked === suggestion.command ? 'border-accent bg-accent-wash/40 text-ink' : 'border-line text-ink-soft hover:border-line-strong hover:text-ink',
                        )}
                      >
                        {suggestion.kind === 'service' ? <Server size={12} className="text-ink-faint" /> : <SquareTerminal size={12} className="text-ink-faint" />}
                        {suggestion.label}
                        <code className="font-mono text-[11px] text-ink-faint">{suggestion.command}</code>
                      </button>
                    ))}
                  </span>
                </div>

                <FieldRow label="Nature">
                  <div className="grid gap-2 @min-[30rem]/action:grid-cols-2">
                    <SmallChoice active={kind === 'task'} onClick={() => setKind('task')} icon={<SquareTerminal size={14} />} title="Tâche" text="se termine, avec un code de sortie" />
                    <SmallChoice active={kind === 'service'} onClick={() => setKind('service')} icon={<Server size={14} />} title="Service" text="tourne en continu, a un port" />
                  </div>
                </FieldRow>

                <FieldRow label="Commande" error={shown('command')}>
                  <span className={cx('flex items-start gap-2 rounded-md border bg-canvas px-2.5 py-2 transition-colors focus-within:border-accent hover:border-line-strong', shown('command') ? INPUT_BAD : 'border-line')}>
                    <span aria-hidden className="select-none font-mono text-sm text-ink-faint">$</span>
                    <textarea
                      value={command}
                      onChange={(event) => { setCommand(event.target.value); setTried(null) }}
                      onBlur={() => touch('command')}
                      rows={Math.min(4, Math.max(1, command.split('\n').length))}
                      placeholder="ex. pnpm test"
                      spellCheck={false}
                      className="min-w-0 flex-1 resize-none bg-transparent font-mono text-sm text-ink outline-none placeholder:italic placeholder:text-ink-faint/55"
                    />
                  </span>
                </FieldRow>

                <FieldRow label="Dossier" error={shown('subdir')} hint={<>s'exécutera dans <code className="font-mono text-ink-soft">&lt;worktree&gt;{subdirTrim ? `/${subdirTrim}` : ''}</code>, celui de la conversation d'où l'on clique, sinon la racine du projet</>}>
                  <FolderPicker value={subdir} onChange={(next) => { setSubdir(next); touch('subdir') }} />
                </FieldRow>

                {isService ? (
                  <FieldRow label="Où tourne-t-il" hint={<>une seule unité par action ; aujourd'hui elle sert le premier arbre d'où on l'a lancée, sans le dire <SimTag /></>}>
                    <PlacementField value={placement} onChange={setPlacement} branch={pinnedBranch} onBranch={setPinnedBranch} url={url} />
                  </FieldRow>
                ) : null}

                {isService ? (
                  <FieldRow
                    label="Lien du service"
                    optional
                    error={shown('url')}
                    hint={
                      url.trim() ? (
                        <>quand il écoute sur :5173, le lien sera <code className="font-mono text-ink-soft">{resolveActionUrl(url.trim(), [5173])}</code></>
                      ) : (
                        <>« Ouvrir » dans ⚡ mène là ; <code className="font-mono">{'{port}'}</code> est remplacé par le port sur lequel il écoute</>
                      )
                    }
                  >
                    <input value={url} onChange={(event) => setUrl(event.target.value)} onBlur={() => touch('url')} placeholder="ex. http://localhost:{port}" className={cx(INPUT, 'font-mono', shown('url') && INPUT_BAD)} />
                    {soleraIsRemote() && url.includes('localhost') ? (
                      <p className="flex items-start gap-1.5 text-xs text-caution">
                        <TriangleAlert size={12} className="mt-0.5 shrink-0" /> Solera est ouvert depuis une autre machine : <code className="font-mono">localhost</code> désignerait la tienne, pas le serveur.
                      </p>
                    ) : null}
                  </FieldRow>
                ) : null}

                <div className="flex flex-col gap-2">
                  <span className="flex items-center gap-2">
                    <Button size="sm" variant="secondary" icon={<Play size={13} />} disabled={!command.trim()} onClick={() => setTried(fakeOutput({ label, description, kind, command, subdir, url }))}>
                      Essayer
                    </Button>
                    <span className="text-xs text-ink-faint">{command.trim() ? 'Lance une fois, sans enregistrer.' : 'Une commande d’abord.'}</span>
                    <SimTag />
                  </span>
                  {tried ? (
                    <pre className="max-h-48 overflow-auto rounded-md bg-black/80 px-3 py-2.5 font-mono text-[12px] leading-relaxed text-white/85">{tried.join('\n')}</pre>
                  ) : null}
                </div>
              </>
            ) : (
              <>
                <FieldRow label="CLI">
                  <span className="flex flex-wrap gap-1.5">
                    {AGENTS.map((entry) => (
                      <button
                        key={entry.kind}
                        type="button"
                        aria-pressed={agent === entry.kind}
                        onClick={() => { setAgent(entry.kind); setModel('Par défaut du projet') }}
                        className={cx(
                          'inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-sm transition-colors',
                          agent === entry.kind ? 'border-accent bg-accent-wash/40 text-ink' : 'border-line text-ink-soft hover:border-line-strong hover:text-ink',
                        )}
                      >
                        <AgentIcon agent={entry.kind} size={13} /> {entry.label}
                      </button>
                    ))}
                  </span>
                </FieldRow>
                <div className="grid gap-4 @min-[30rem]/action:grid-cols-2">
                  <FieldRow label="Modèle">
                    <select value={model} onChange={(event) => setModel(event.target.value)} className={INPUT}>
                      {AGENTS.find((entry) => entry.kind === agent)!.models.map((entry) => (
                        <option key={entry}>{entry}</option>
                      ))}
                    </select>
                  </FieldRow>
                  <FieldRow label="Effort">
                    <span className="inline-flex h-[38px] rounded-md border border-line p-0.5">
                      {EFFORTS.map((entry) => (
                        <button key={entry} type="button" onClick={() => setEffort(entry)} className={cx('flex-1 rounded px-3 text-sm', effort === entry ? 'bg-surface-high font-medium text-ink' : 'text-ink-faint hover:text-ink')}>
                          {entry}
                        </button>
                      ))}
                    </span>
                  </FieldRow>
                </div>
                <FieldRow label="Prompt" error={shown('prompt')} hint="Ce qu’on écrirait à l’agent en ouvrant la session. Il ne connaîtra rien d’autre.">
                  <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} onBlur={() => touch('prompt')} rows={6} placeholder="ex. Passe en revue les dépendances du dépôt et ouvre une PR par mise à jour sûre." className={cx(INPUT, 'leading-relaxed', shown('prompt') && INPUT_BAD)} />
                </FieldRow>
                <FieldRow label="Où il tourne">
                  <div className="grid gap-2 @min-[34rem]/action:grid-cols-3">
                    <SmallChoice active={where === 'root'} onClick={() => setWhere('root')} icon={<Folder size={14} />} title="Racine" text="le dossier du projet" />
                    <SmallChoice active={where === 'worktree'} onClick={() => setWhere('worktree')} icon={<FolderOpen size={14} />} title="Nouveau worktree" text="une branche à lui" />
                    <SmallChoice active={where === 'confined'} onClick={() => setWhere('confined')} icon={<Server size={14} />} title="Confiné" text="sans demandes d’autorisation" />
                  </div>
                </FieldRow>
                <div className="flex flex-col gap-2">
                  <button type="button" onClick={() => setCheckOpen((value) => !value)} className="inline-flex w-fit items-center gap-1 text-sm text-ink-soft hover:text-ink">
                    {checkOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    Script de vérification <span className="text-xs text-ink-faint">facultatif — s’il sort en 0, le passage n’a pas lieu</span>
                  </button>
                  {checkOpen ? (
                    <textarea value={check} onChange={(event) => setCheck(event.target.value)} rows={3} spellCheck={false} placeholder="ex. git fetch -q && test -n &quot;$(git log HEAD..origin/main --oneline)&quot;" className={cx(INPUT, 'font-mono text-xs')} />
                  ) : null}
                </div>
              </>
            )}

            <div className="grid gap-4 @min-[30rem]/action:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <FieldRow label="Libellé" error={shown('label')} counter={`${label.trim().length}/${MAX_ACTION_LABEL_CHARS}`}>
                <input value={label} onChange={(event) => setLabel(event.target.value)} onBlur={() => touch('label')} maxLength={MAX_ACTION_LABEL_CHARS + 10} placeholder={what === 'command' ? 'ex. Sauvegarde de la base' : 'ex. Revue des dépendances'} className={cx(INPUT, shown('label') && INPUT_BAD)} />
              </FieldRow>
              <FieldRow label="Description" optional>
                <input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="ex. Garde les 4 dernières sauvegardes" className={INPUT} />
              </FieldRow>
            </div>
            <ButtonPreview what={what} kind={kind} label={label} description={description} agent={agent} />
          </Step>

          {/* ------------------------------------------------------------ 2 · Quand */}
          <div ref={whenRef} className="scroll-mt-4">
          <Step number={2} title="Quand">
            <div className="grid gap-2 @min-[30rem]/action:grid-cols-2">
              <CheckCard checked={onDemand} onChange={setOnDemand} icon={<Hand size={15} />} title="À la demande" text="Un clic, ou un agent" />
              <CheckCard checked={scheduled} onChange={setScheduled} icon={<AlarmClock size={15} />} title="Planifiée" text="Part seule, à sa cadence" />
            </div>
            {shown('when') || (!onDemand && !scheduled) ? <ErrorLine text={problems.when} /> : null}

            {scheduled ? (
              <div className="flex flex-col gap-4">
                <ScheduleBuilder
                  key={from?.id ?? 'new'}
                  initial={from?.schedule?.cadence ?? null}
                  label={isService ? 'Démarrer' : undefined}
                  onChange={(next, sentence) => { setCadence(next); setHuman(sentence) }}
                />
                {isService ? (
                  <div className="flex flex-col gap-3 rounded-md bg-caution/10 px-3.5 py-3">
                    <span className="flex items-center gap-1.5 text-xs font-medium text-caution"><TriangleAlert size={12} /> Cas limite : un service planifié</span>
                    <span className="text-xs text-ink-soft">Il démarre à la cadence ci-dessus ; pour qu'il s'arrête de lui-même, une seconde planification.</span>
                    <ScheduleBuilder label="Arrêter" initial={{ kind: 'cron', expression: '0 19 * * 1-5' }} onChange={(next) => setStopCadence(next)} />
                  </div>
                ) : what === 'command' ? (
                  <p className="text-[11px] text-ink-faint">Simulé : le serveur ne planifie pas encore de commande.</p>
                ) : null}
              </div>
            ) : null}
          </Step>
          </div>
        </div>
      </div>

      <ActionFooter
        left={<span className="min-w-0 truncate text-xs text-ink-faint">{summary.join(' · ')}</span>}
        right={
          <>
            <Button size="sm" variant="ghost" onClick={onBack ?? onClose}>Annuler</Button>
            <span title={blocking.length ? `À compléter : ${blocking.join(' ')}` : undefined}>
              <Button size="sm" disabled={blocking.length > 0} onClick={save}>Enregistrer</Button>
            </span>
          </>
        }
      />
    </>
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

function FieldRow({ label, hint, error, optional, counter, children }: { label: string; hint?: ReactNode; error?: string; optional?: boolean; counter?: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="flex items-baseline gap-2 text-xs">
        <span className="font-medium text-ink-soft">{label}</span>
        {optional ? <span className="text-ink-faint">facultatif</span> : null}
        {counter ? <span className="ml-auto tabular-nums text-ink-faint">{counter}</span> : null}
      </span>
      {children}
      {error ? <ErrorLine text={error} /> : hint ? <span className="text-xs text-ink-faint">{hint}</span> : null}
    </div>
  )
}

function ErrorLine({ text }: { text?: string }) {
  if (!text) return null
  return <span role="alert" className="text-xs text-critical">{text}</span>
}

function BigChoice({ active, onClick, icon, title, text }: { active: boolean; onClick: () => void; icon: ReactNode; title: string; text: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cx('flex items-center gap-3 rounded-md border px-3 py-2.5 text-left transition-colors', active ? 'border-accent bg-accent-wash/40' : 'border-line hover:border-line-strong')}
    >
      <span className={cx('grid size-8 shrink-0 place-items-center rounded-md', active ? 'bg-accent/15 text-accent' : 'bg-surface-high text-ink-soft')}>{icon}</span>
      <span className="flex min-w-0 flex-col">
        <span className="text-sm font-medium text-ink">{title}</span>
        <span className="text-xs text-ink-faint">{text}</span>
      </span>
      {active ? <Check size={15} className="ml-auto shrink-0 text-accent" /> : null}
    </button>
  )
}

function SmallChoice({ active, onClick, icon, title, text }: { active: boolean; onClick: () => void; icon: ReactNode; title: string; text: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cx('flex items-center gap-2 rounded-md border px-2.5 py-2 text-left transition-colors', active ? 'border-accent bg-accent-wash/40' : 'border-line hover:border-line-strong')}
    >
      <span className={cx('shrink-0', active ? 'text-accent' : 'text-ink-faint')}>{icon}</span>
      <span className="flex min-w-0 flex-col">
        <span className="text-sm text-ink">{title}</span>
        <span className="truncate text-xs text-ink-faint">{text}</span>
      </span>
    </button>
  )
}

function CheckCard({ checked, onChange, icon, title, text }: { checked: boolean; onChange: (next: boolean) => void; icon: ReactNode; title: string; text: string }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cx('flex h-11 items-center gap-2.5 rounded-md border px-3 text-left transition-colors', checked ? 'border-accent bg-accent-wash/40' : 'border-line hover:border-line-strong')}
    >
      <span className={cx('grid size-4 shrink-0 place-items-center rounded border', checked ? 'border-accent bg-accent text-accent-ink' : 'border-line-strong')}>
        {checked ? <Check size={11} /> : null}
      </span>
      <span className="text-ink-faint">{icon}</span>
      <span className="text-sm font-medium text-ink">{title}</span>
      <span className="min-w-0 truncate text-xs text-ink-faint">{text}</span>
    </button>
  )
}

function FolderPicker({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <span className="flex gap-2">
      <Popover
        open={open}
        onOpenChange={setOpen}
        label="Choisir le dossier"
        side="bottom"
        align="start"
        className="w-72 p-1"
        trigger={
          <button type="button" className="inline-flex h-[38px] min-w-0 flex-1 items-center gap-2 rounded-md border border-line bg-canvas px-2.5 text-left text-sm text-ink transition-colors hover:border-line-strong">
            <Folder size={14} className="shrink-0 text-ink-faint" />
            <span className={cx('min-w-0 flex-1 truncate', value ? 'font-mono' : '')}>{value || 'Racine du worktree'}</span>
            <ChevronDown size={14} className="shrink-0 text-ink-faint" />
          </button>
        }
      >
        <ul className="flex flex-col py-0.5" role="listbox" aria-label="Dossiers du dépôt">
          {REPO_TREE.map((entry) => (
            <li key={entry.path || 'root'}>
              <button
                type="button"
                role="option"
                aria-selected={value === entry.path}
                onClick={() => { onChange(entry.path); setOpen(false) }}
                className={cx('flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-surface-high', value === entry.path ? 'text-accent' : 'text-ink-soft')}
                style={{ paddingLeft: 8 + entry.depth * 16 }}
              >
                <Folder size={13} className="shrink-0 text-ink-faint" />
                <span className={entry.path ? 'font-mono text-xs' : ''}>{entry.path ? entry.path.split('/').pop() : 'Racine du worktree'}</span>
                {value === entry.path ? <Check size={13} className="ml-auto" /> : null}
              </button>
            </li>
          ))}
        </ul>
        <p className="border-t border-line px-2 py-1.5 text-[11px] text-ink-faint">Arborescence simulée.</p>
      </Popover>
    </span>
  )
}

/** Le bouton tel qu'il apparaîtra dans ⚡ et dans la liste. */
function ButtonPreview({ what, kind, label, description, agent }: { what: What; kind: Kind; label: string; description: string; agent: AgentKind }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="flex items-center gap-1.5 text-xs text-ink-faint"><Zap size={12} /> Dans le lanceur</span>
      <div className="flex max-w-md items-center gap-2.5 rounded-md border border-dashed border-line px-3 py-2">
        <span className="grid size-7 shrink-0 place-items-center rounded-md bg-surface-high text-ink-soft">
          {what === 'agent' ? <AgentIcon agent={agent} size={13} /> : kind === 'service' ? <Server size={13} /> : <SquareTerminal size={13} />}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className={cx('truncate text-sm', label.trim() ? 'text-ink' : 'italic text-ink-faint/60')}>{label.trim() || 'Libellé du bouton'}</span>
          <span className="truncate text-xs text-ink-faint">{description.trim() || (kind === 'service' && what === 'command' ? 'arrêté' : 'jamais lancée')}</span>
        </span>
        <span className="inline-flex h-7 items-center gap-1 rounded-md border border-line px-2 text-xs text-ink-soft"><Play size={11} /> Lancer</span>
      </div>
    </div>
  )
}

function SimTag() {
  return <span className="rounded bg-fuchsia-500/15 px-1 text-[10px] font-medium tracking-wide text-fuchsia-700 uppercase dark:text-fuchsia-300">simulé</span>
}
