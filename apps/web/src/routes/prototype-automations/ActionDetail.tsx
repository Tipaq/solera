/* PROTOTYPE — jetable (branche proto/page-projet). Ne pas fusionner dans main.
 *
 * Le détail d'une action, dans le tiroir commun : l'état en une phrase et le geste
 * principal en tête ; puis Quoi, Quand, Passages, Origine ; le pied collant porte
 * Dupliquer et Supprimer à gauche, le geste principal à droite. « Modifier » bascule le
 * **même** tiroir en édition (voir `ActionsPage`). Une action à relire montre sa
 * commande (et ce qui a changé) avec Valider / Refuser. Tout est simulé.
 */
import { AlarmClock, ArrowUpRight, Check, ChevronDown, ChevronRight, Copy, Pause, Pencil, Play, ShieldQuestion, Square, SquareTerminal, Trash2, X } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Button, cx } from '@solera/ui'
import { AgentIcon } from '../../components/AgentIcon'
import { formatDateTime } from '../../lib/schedules'
import { DEMO_PREVIOUS_COMMAND } from '../prototype-actions/data'
import { formatDuration } from '../prototype-schedules/data'
import { RUN_FILL, RUN_WORD } from '../prototype-schedules/shared'
import { ActionBlock, ActionBody, ActionFooter, ActionHeader, Chip, cadenceWord, natureOf, whenWords } from './DrawerParts'
import type { EditorSeed } from './Editor'
import { LaunchButton } from './LaunchButton'
import { ago, type Automation, type UnifiedRun } from './model'
import { upcoming } from './ScheduleBuilder'
import { ServedBlock, useServedOf, useServiceSwitch } from './served'

export function ActionDetail({
  item,
  projectId,
  simulate,
  onEdit,
  onClose,
  launchWhere,
  focusReview = false,
}: {
  item: Automation
  projectId: string
  simulate: (text: string) => void
  onEdit: (seed: EditorSeed) => void
  onClose: () => void
  /**
   * Où partirait un lancement, quand le contexte le fixe : depuis une conversation, son
   * worktree. Sans lui, le bouton propose la racine ou un worktree (l'onglet du projet).
   */
  launchWhere?: string
  /** Ouvert par « Relire » : le tiroir se place sur le bloc de relecture. */
  focusReview?: boolean
}) {
  const [paused, setPaused] = useState(item.schedule ? !item.schedule.enabled : false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const nature = natureOf(item)
  const primary = primaryGesture(item, projectId, simulate, launchWhere)
  const served = useServedOf(item)
  const { ask, dialog: switchDialog } = useServiceSwitch(simulate)
  useEffect(() => {
    if (!focusReview || !item.review) return
    const frame = requestAnimationFrame(() => document.getElementById('relecture')?.scrollIntoView({ block: 'start' }))
    return () => cancelAnimationFrame(frame)
  }, [focusReview, item.review])

  return (
    <>
      <ActionHeader
        nature={nature}
        title={item.label}
        when={whenWords(item.onDemand, item.schedule?.cadence ?? null, paused)}
        extra={
          <>
            {item.review ? <Chip tone="caution">à relire</Chip> : null}
            {item.simulated ? <Chip tone="sim">simulé</Chip> : null}
          </>
        }
        onClose={onClose}
      />

      <ActionBody>
        {/* L'état en une phrase, et ce qu'on peut faire tout de suite. */}
        <div className={cx('flex flex-wrap items-center gap-3 rounded-md px-3.5 py-3', item.review ? 'bg-caution/10' : item.failStreak >= 2 ? 'bg-critical/10' : 'bg-surface/70')}>
          <span className={cx('size-2 shrink-0 rounded-full', stateDot(item))} />
          <span className="min-w-0 flex-1 text-sm text-ink">{stateSentence(item, paused)}</span>
          <span className="flex shrink-0 items-center gap-1.5">{primary}</span>
        </div>

        {item.review ? <ReviewBlock item={item} simulate={simulate} onClose={onClose} /> : null}

        {served ? (
          <ActionBlock title="Ce qu'il sert">
            <ServedBlock
              projectId={projectId}
              served={served}
              onSwitch={(tree) => ask(served, { name: tree.name, branch: tree.root ? `la racine (${tree.branch ?? '?'})` : tree.branch })}
            />
          </ActionBlock>
        ) : null}
        {switchDialog}

        <ActionBlock title="Quoi" aside={<Button size="sm" variant="ghost" icon={<Pencil size={13} />} onClick={() => onEdit({ from: item })}>Modifier</Button>}>
          {item.what === 'agent' ? (
            <div className="flex flex-col gap-2">
              <span className="flex items-center gap-2 text-sm text-ink-soft"><AgentIcon agent={item.agent ?? 'claude'} size={14} /> {agentName(item)} reçoit ce prompt, dans une session neuve :</span>
              <p className="rounded-md bg-surface-high/50 px-3 py-2.5 text-sm leading-relaxed whitespace-pre-wrap text-ink">{item.prompt}</p>
              {item.task?.check ? (
                <Fact label="Vérification">
                  <code className="font-mono text-xs text-ink-soft">{item.task.check.script}</code>
                  {item.task.check.approved ? null : <Chip tone="caution">à valider</Chip>}
                </Fact>
              ) : null}
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <code className="flex gap-2 rounded-md bg-surface-high/50 px-3 py-2.5 font-mono text-sm text-ink">
                <span aria-hidden className="select-none text-ink-faint">$</span>
                <span className="min-w-0 break-all whitespace-pre-wrap">{item.command}</span>
              </code>
              <Fact label="Dossier"><code className="font-mono text-xs text-ink-soft">&lt;worktree&gt;{item.subdir ? `/${item.subdir}` : ''}</code><span className="text-xs text-ink-faint">celui d'où on la lance</span></Fact>
              {item.commandKind === 'service' && item.action?.url ? (
                <Fact label="Lien"><code className="font-mono text-xs text-ink-soft">{item.action.url}</code></Fact>
              ) : null}
              {item.description ? <Fact label="Note"><span className="text-sm text-ink-soft">{item.description}</span></Fact> : null}
            </div>
          )}
        </ActionBlock>

        <ActionBlock
          title="Quand"
          aside={
            item.schedule ? (
              <>
                <Button size="sm" variant="ghost" icon={paused ? <Play size={13} /> : <Pause size={13} />} onClick={() => { setPaused(!paused); simulate(paused ? `reprendre « ${item.label} »` : `mettre « ${item.label} » en pause`) }}>
                  {paused ? 'Reprendre' : 'Mettre en pause'}
                </Button>
                <Button size="sm" variant="ghost" icon={<Pencil size={13} />} onClick={() => onEdit({ from: item, schedule: true })}>Modifier</Button>
              </>
            ) : (
              <Button size="sm" variant="ghost" icon={<AlarmClock size={13} />} onClick={() => onEdit({ from: item, schedule: true })}>Planifier</Button>
            )
          }
        >
          <ul className="flex flex-col gap-2 text-sm">
            <li className="flex items-center gap-2 text-ink-soft">
              <span className={cx('size-1.5 shrink-0 rounded-full', item.onDemand ? 'bg-positive' : 'bg-line-strong')} />
              {item.onDemand ? 'À la demande : un clic ici ou dans ⚡, ou un agent par run_action.' : 'Pas à la demande : elle ne part qu’à sa cadence.'}
            </li>
            <li className="flex items-start gap-2 text-ink-soft">
              <span className={cx('mt-1.5 size-1.5 shrink-0 rounded-full', item.schedule && !paused ? 'bg-positive' : 'bg-line-strong')} />
              {item.schedule ? (
                <span className="flex flex-col gap-1">
                  <span className="text-ink first-letter:uppercase">{cadenceWord(item.schedule.cadence)}{paused ? ' — en pause' : ''}</span>
                  {!paused ? (
                    <span className="flex flex-col text-xs text-ink-faint tabular-nums">
                      {upcoming(item.schedule.cadence, 3).map((at, index) => <span key={at}>{index === 0 ? 'Prochain passage : ' : 'puis '}{formatDateTime(at)}</span>)}
                    </span>
                  ) : null}
                </span>
              ) : (
                'Pas planifiée.'
              )}
            </li>
          </ul>
        </ActionBlock>

        <ActionBlock title="Passages" aside={item.runs.length ? <span className="text-xs text-ink-faint tabular-nums">{item.runs.length} connus</span> : null}>
          <Runs item={item} projectId={projectId} />
        </ActionBlock>

        <ActionBlock title="Origine">
          <Origin item={item} projectId={projectId} />
        </ActionBlock>
      </ActionBody>

      <ActionFooter
        left={
          confirmDelete ? (
            <span className="flex items-center gap-2 text-sm text-ink">
              Supprimer « {item.label} » ?
              <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>Annuler</Button>
              <Button size="sm" variant="danger" onClick={() => { simulate(`supprimer « ${item.label} »`); onClose() }}>Supprimer</Button>
            </span>
          ) : (
            <>
              <Button size="sm" variant="ghost" icon={<Copy size={13} />} onClick={() => onEdit({ from: { ...item, id: `${item.id}-copie`, label: `${item.label} (copie)` } })}>Dupliquer</Button>
              <Button size="sm" variant="ghost" icon={<Trash2 size={13} />} onClick={() => setConfirmDelete(true)}>Supprimer</Button>
            </>
          )
        }
        right={confirmDelete ? null : primary}
      />
    </>
  )
}

/* ------------------------------------------------------------------ état et geste */

function stateDot(item: Automation): string {
  if (item.review) return 'bg-caution'
  if (item.live) return 'animate-pulse bg-positive'
  if (item.failStreak >= 2 || item.runs[0]?.status === 'failed') return 'bg-critical'
  return 'bg-line-strong'
}

function stateSentence(item: Automation, paused: boolean): string {
  if (item.review) return `À relire avant son premier lancement : ${item.review}.`
  if (item.live) {
    if (item.live.kind === 'service') return `Le service tourne — ${item.live.text.replace(/^service · /, '')}.`
    if (item.live.kind === 'session') return `Un passage est en cours : ${item.live.text.replace(/^passage en cours /, '')}.`
    return 'La commande tourne dans un terminal du panneau.'
  }
  const last = item.runs[0]
  if (item.failStreak >= 2) return `${item.failStreak} échecs d’affilée — dernier il y a ${last ? ago(last.startedAt) : '?'}.`
  if (item.commandKind === 'service') return 'Le service est arrêté.'
  if (paused && item.schedule) return 'Planification en pause : elle ne part qu’à la main.'
  if (last) return `Dernier passage ${RUN_WORD[last.status]} il y a ${ago(last.startedAt)}${last.exitCode != null ? ` (code ${last.exitCode})` : ''}.`
  return 'Jamais lancée.'
}

function primaryGesture(item: Automation, projectId: string, simulate: (text: string) => void, launchWhere?: string): ReactNode {
  if (item.review) {
    return <Button size="sm" icon={<ShieldQuestion size={13} />} onClick={() => document.getElementById('relecture')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>Relire</Button>
  }
  if (item.live?.kind === 'service') {
    return (
      <>
        {item.live.href ? (
          <a href={item.live.href} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center gap-1 rounded-md px-2.5 text-sm text-accent hover:bg-surface-high">Ouvrir <ArrowUpRight size={13} /></a>
        ) : null}
        <Button size="sm" variant="secondary" icon={<Square size={12} />} onClick={() => simulate(`arrêter « ${item.label} »`)}>Arrêter</Button>
      </>
    )
  }
  if (item.live?.kind === 'session' && item.live.href) {
    return <Link to={item.live.href} className="inline-flex h-9 items-center gap-1 rounded-md bg-accent px-3 text-sm font-medium text-accent-ink hover:opacity-90">Session <ArrowUpRight size={13} /></Link>
  }
  if (item.live) return <Button size="sm" variant="secondary" icon={<SquareTerminal size={13} />} onClick={() => simulate('ouvrir le terminal de la commande dans le panneau')}>Terminal</Button>
  if (item.commandKind === 'service') return <Button size="sm" icon={<Play size={13} />} onClick={() => simulate(`démarrer « ${item.label} »${launchWhere ? ` ${launchWhere}` : ''}`)}>Démarrer</Button>
  if (launchWhere) {
    return (
      <Button size="sm" icon={<Play size={13} />} title={`Lancer ${launchWhere}`} onClick={() => simulate(item.what === 'agent' ? `lancer « ${item.label} » dans une nouvelle session` : `lancer « ${item.label} » ${launchWhere}`)}>
        Lancer
      </Button>
    )
  }
  return <LaunchButton projectId={projectId} item={item} simulate={simulate} />
}

/* ------------------------------------------------------------------ relecture */

function ReviewBlock({ item, simulate, onClose }: { item: Automation; simulate: (text: string) => void; onClose: () => void }) {
  const previous = item.action ? DEMO_PREVIOUS_COMMAND[item.action.id] : undefined
  const isScript = item.what === 'agent'
  return (
    <section id="relecture" className="flex scroll-mt-4 flex-col gap-2.5 rounded-md border border-caution/40 px-3.5 py-3">
      <span className="flex items-center gap-2 text-sm font-medium text-caution"><ShieldQuestion size={15} /> Relecture</span>
      <p className="text-sm text-ink-soft">
        {isScript
          ? 'Ce script tourne avant chaque passage, sans agent : relis-le avant de le laisser partir seul.'
          : 'Un agent a écrit cette commande. Elle ne part pas d’un clic tant que tu ne l’as pas validée.'}
      </p>
      {previous ? (
        <div className="flex flex-col gap-1 font-mono text-xs">
          <span className="rounded bg-critical/10 px-2 py-1 text-critical line-through decoration-critical/50">- {previous}</span>
          <span className="rounded bg-positive/10 px-2 py-1 text-positive">+ {item.command}</span>
        </div>
      ) : (
        <code className="rounded bg-surface-high/50 px-2 py-1.5 font-mono text-xs text-ink">{isScript ? item.task?.check?.script : item.command}</code>
      )}
      <span className="flex gap-2">
        <Button size="sm" icon={<Check size={13} />} onClick={() => { simulate(`valider « ${item.label} »`); onClose() }}>Valider</Button>
        <Button size="sm" variant="ghost" icon={<X size={13} />} onClick={() => { simulate(`refuser « ${item.label} »`); onClose() }}>Refuser</Button>
      </span>
    </section>
  )
}

/* ------------------------------------------------------------------ passages */

function Runs({ item, projectId }: { item: Automation; projectId: string }) {
  const [openRun, setOpenRun] = useState<string | null>(item.runs[0]?.excerpt ? item.runs[0].id : null)
  if (item.runs.length === 0) {
    return (
      <p className="text-sm text-ink-faint">
        {item.what === 'command' ? 'Aucun passage connu : aujourd’hui, le serveur ne garde que le dernier, tant que son terminal est ouvert.' : 'Aucun passage pour l’instant.'}
      </p>
    )
  }
  const strip = item.runs.slice(0, 20).reverse()
  return (
    <div className="flex flex-col gap-3">
      {/* La frise : les plus anciens à gauche, le dernier à droite. */}
      <span className="flex items-end gap-1" aria-label="Derniers passages">
        {strip.map((run, index) => (
          <span
            key={run.id}
            title={`${formatDateTime(run.startedAt)} · ${RUN_WORD[run.status]}${run.exitCode != null ? ` · code ${run.exitCode}` : ''}`}
            // Étroit (le panneau d'une conversation) : les 10 derniers seulement.
            className={cx('h-5 w-2.5 rounded-sm', RUN_FILL[run.status], index < strip.length - 10 && 'hidden @min-[28rem]/action:block')}
          />
        ))}
        <span className="ml-1.5 hidden text-xs text-ink-faint @min-[28rem]/action:inline">le plus récent à droite</span>
      </span>
      <ul className="flex flex-col divide-y divide-line rounded-md border border-line">
        {item.runs.slice(0, 12).map((run) => (
          <RunLine key={run.id} run={run} projectId={projectId} open={openRun === run.id} onToggle={() => setOpenRun(openRun === run.id ? null : run.id)} />
        ))}
      </ul>
      {item.simulated ? <p className="text-xs text-ink-faint">Passages simulés : une commande planifiée demandera au serveur de garder chaque passage (code, durée, extrait).</p> : null}
    </div>
  )
}

function RunLine({ run, projectId, open, onToggle }: { run: UnifiedRun; projectId: string; open: boolean; onToggle: () => void }) {
  const expandable = Boolean(run.excerpt?.length || run.error)
  const verdict = run.exitCode != null ? `code ${run.exitCode}` : RUN_WORD[run.status]
  return (
    <li className="flex flex-col">
      <div className="flex min-h-10 items-center gap-2.5 px-3 text-sm">
        <button type="button" disabled={!expandable} onClick={onToggle} className={cx('flex min-w-0 flex-1 items-center gap-2.5 text-left', expandable ? 'cursor-pointer' : 'cursor-default')}>
          {expandable ? (open ? <ChevronDown size={13} className="shrink-0 text-ink-faint" /> : <ChevronRight size={13} className="shrink-0 text-ink-faint" />) : <span className="w-[13px] shrink-0" />}
          <span className={cx('size-2 shrink-0 rounded-full', RUN_FILL[run.status])} />
          <span className="w-36 shrink-0 tabular-nums text-ink-soft">{formatDateTime(run.startedAt)}</span>
          <span className="w-16 shrink-0 text-xs tabular-nums text-ink-faint">{run.finishedAt ? formatDuration(run.finishedAt - run.startedAt) : '—'}</span>
          <span className={cx('min-w-0 truncate text-xs', run.status === 'failed' ? 'text-critical' : 'text-ink-faint')}>{verdict}</span>
        </button>
        {run.conversationId ? (
          <Link to={`/p/${projectId}/c/${run.conversationId}`} className="shrink-0 text-xs text-ink-soft hover:text-ink hover:underline">Session ↗</Link>
        ) : null}
      </div>
      {open && expandable ? (
        <div className="px-3 pb-3 pl-[46px]">
          {run.error ? <p className="pb-1 text-xs text-critical">{run.error}</p> : null}
          {run.excerpt ? <pre className="overflow-x-auto rounded bg-black/80 px-2.5 py-2 font-mono text-[11px] leading-relaxed text-white/85">{run.excerpt.join('\n')}</pre> : null}
        </div>
      ) : null}
    </li>
  )
}

/* ------------------------------------------------------------------ origine */

function Origin({ item, projectId }: { item: Automation; projectId: string }) {
  const action = item.action
  const createdAt = action?.createdAt ?? item.task?.createdAt ?? null
  if (action?.agentConversationId) {
    return (
      <p className="text-sm text-ink-soft">
        Proposée par un agent dans{' '}
        <Link to={`/p/${projectId}/c/${action.agentConversationId}`} className="text-ink hover:underline">« {action.agentConversationTitle ?? 'une session supprimée'} »</Link>
        {createdAt ? <span className="text-ink-faint"> · {formatDateTime(createdAt)}</span> : null}
      </p>
    )
  }
  return (
    <p className="text-sm text-ink-soft">
      Créée par toi{createdAt ? <span className="text-ink-faint"> · {formatDateTime(createdAt)}</span> : null}
      {item.simulated ? <span className="text-ink-faint"> · exemple de démo</span> : null}
    </p>
  )
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="flex flex-wrap items-baseline gap-2">
      <span className="w-20 shrink-0 text-xs text-ink-faint">{label}</span>
      {children}
    </span>
  )
}

function agentName(item: Automation): string {
  const names: Record<string, string> = { claude: 'Claude', codex: 'Codex', grok: 'Grok', opencode: 'OpenCode' }
  return names[item.agent ?? 'claude'] ?? 'L’agent'
}
