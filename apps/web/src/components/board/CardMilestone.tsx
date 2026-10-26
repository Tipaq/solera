import * as Dialog from '@radix-ui/react-dialog'
import { ArrowUpRight, GitBranch, Pause, Play, Rocket, Square, X } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  DEFAULT_MILESTONE_CONCURRENCY,
  MAX_MILESTONE_CONCURRENCY,
  MILESTONE_QUOTA_WARNING,
  agentKindSchema,
  type AgentConfig,
  type AgentKind,
  type CardDto,
  type MilestoneBlockerDto,
  type MilestoneCardStatus,
  type MilestonePlanCardDto,
  type MilestoneRunCardDto,
  type MilestoneRunDto,
} from '@solera/protocol'
import { Badge, Banner, Button, IconButton, Menu, MenuRadioGroup, MenuRadioItem, Select } from '@solera/ui'
import { AGENT_LABELS, AgentIcon } from '../AgentIcon'
import { useAgentSettings } from '../chat/agent-settings'
import { useTranslate, type MessageKey } from '../../lib/i18n'
import { useLaunchMilestone, useMilestonePlan, useMilestoneRun, useUpdateMilestone } from '../../lib/milestones'
import { useProjects } from '../../lib/projects'
import { inheritedConfigFor, useUserSettings } from '../../lib/user-settings'

type Tone = 'neutral' | 'accent' | 'positive' | 'caution' | 'critical'

const STATUS_TONES: Record<MilestoneCardStatus, Tone> = {
  waiting: 'neutral',
  queued: 'neutral',
  launching: 'accent',
  working: 'accent',
  reviewing: 'accent',
  merging: 'accent',
  blocked: 'caution',
  done: 'positive',
  abandoned: 'neutral',
  failed: 'critical',
}

const CONCURRENCY_OPTIONS = Array.from({ length: MAX_MILESTONE_CONCURRENCY }, (_, index) => String(index + 1))

/**
 * Le jalon d'une carte parente (#72) : le lancer, puis voir qui travaille où.
 *
 * C'est le serveur qui pilote ; cette section n'en est que la vue et la télécommande.
 * Avant le lancement, un bouton ouvre l'aperçu ; après, la liste des cartes par étage du
 * graphe dit ce que chacune fait, ce qu'elle attend, et mène à sa session.
 */
export function CardMilestone({
  card,
  projectId,
  onSelectCard,
}: {
  card: CardDto
  projectId: string
  onSelectCard: (number: number) => void
}) {
  const t = useTranslate()
  const { data: run } = useMilestoneRun(card.id, true)
  const [previewing, setPreviewing] = useState(false)
  const live = run && (run.state === 'running' || run.state === 'paused')

  return (
    <section aria-label={t('milestone.heading')} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold text-ink">{t('milestone.heading')}</h3>
        {run ? <Badge tone={run.state === 'running' ? 'accent' : run.state === 'paused' ? 'caution' : 'neutral'}>{t(`milestone.state.${run.state}`)}</Badge> : null}
        <div className="flex-1" />
        {live ? null : (
          <Button size="sm" variant={run ? 'secondary' : 'primary'} icon={<Rocket size={14} />} onClick={() => setPreviewing(true)}>
            {t(run ? 'milestone.relaunch' : 'milestone.launch')}
          </Button>
        )}
      </div>
      {run ? <MilestoneRun run={run} cardId={card.id} projectId={projectId} onSelectCard={onSelectCard} /> : (
        <p className="text-sm text-ink-faint">{t('milestone.intro')}</p>
      )}
      {previewing ? <LaunchDialog card={card} projectId={projectId} onClose={() => setPreviewing(false)} /> : null}
    </section>
  )
}

function MilestoneRun({ run, cardId, projectId, onSelectCard }: { run: MilestoneRunDto; cardId: string; projectId: string; onSelectCard: (number: number) => void }) {
  const t = useTranslate()
  const update = useUpdateMilestone(cardId)
  const live = run.state === 'running' || run.state === 'paused'

  const stop = () => {
    if (!confirm(t('milestone.stop.confirm'))) return
    update.mutate({ state: 'stopped' })
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-faint">
        <span>{t('milestone.busy', { busy: run.busy, concurrency: run.concurrency })}</span>
        <span className="inline-flex items-center gap-1"><GitBranch size={12} />{run.branch}</span>
        <span className="inline-flex items-center gap-1"><AgentIcon agent={run.agent} size={12} decorative />{run.model}</span>
      </p>
      {live ? (
        <div className="flex flex-wrap items-center gap-2">
          {run.state === 'running' ? (
            <Button size="sm" variant="secondary" icon={<Pause size={14} />} disabled={update.isPending} onClick={() => update.mutate({ state: 'paused' })}>
              {t('milestone.pause')}
            </Button>
          ) : (
            <Button size="sm" variant="secondary" icon={<Play size={14} />} disabled={update.isPending} onClick={() => update.mutate({ state: 'running' })}>
              {t('milestone.resume')}
            </Button>
          )}
          <Button size="sm" variant="ghost" icon={<Square size={14} />} disabled={update.isPending} onClick={stop}>
            {t('milestone.stop')}
          </Button>
          <Menu trigger={<Button size="sm" variant="ghost">{t('milestone.concurrency.value', { count: run.concurrency })}</Button>}>
            <MenuRadioGroup value={String(run.concurrency)} onValueChange={(value) => update.mutate({ concurrency: Number(value) })}>
              {CONCURRENCY_OPTIONS.map((value) => (
                <MenuRadioItem key={value} value={value}>{value}</MenuRadioItem>
              ))}
            </MenuRadioGroup>
          </Menu>
        </div>
      ) : null}
      {update.isError ? <p role="alert" className="text-sm text-critical">{update.error.message}</p> : null}
      <ol className="flex flex-col gap-1">
        {run.cards.map((entry) => (
          <RunRow key={entry.cardId} entry={entry} projectId={projectId} onSelectCard={onSelectCard} />
        ))}
      </ol>
    </div>
  )
}

function RunRow({ entry, projectId, onSelectCard }: { entry: MilestoneRunCardDto; projectId: string; onSelectCard: (number: number) => void }) {
  const t = useTranslate()
  const navigate = useNavigate()
  const detail =
    entry.status === 'blocked' && entry.blockReason
      ? t(`milestone.block.${entry.blockReason}`)
      : entry.status === 'waiting'
        ? waitingOn(t, entry.blockedBy)
        : entry.status === 'failed'
          ? entry.error
          : entry.worktreeName
  return (
    <li className="flex min-w-0 items-start gap-2 rounded-md py-1">
      <span className="w-6 shrink-0 pt-0.5 text-right text-meta tabular-nums text-ink-faint">{entry.layer >= 0 ? entry.layer + 1 : '–'}</span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <button type="button" onClick={() => onSelectCard(entry.number)} className="min-w-0 truncate text-left text-sm text-ink hover:text-accent">
          <span className="text-ink-faint tabular-nums">#{entry.number}</span> {entry.title}
        </button>
        {detail ? <span className="min-w-0 truncate text-xs text-ink-faint">{detail}</span> : null}
      </div>
      <Badge tone={STATUS_TONES[entry.status]}>{t(`milestone.status.${entry.status}`)}</Badge>
      {entry.conversationId ? (
        <IconButton size="sm" label={t('milestone.openSession')} onClick={() => navigate(`/p/${projectId}/c/${entry.conversationId}`)}>
          <ArrowUpRight size={14} />
        </IconButton>
      ) : null}
    </li>
  )
}

function waitingOn(t: ReturnType<typeof useTranslate>, blockers: MilestoneBlockerDto[]): string {
  return t('milestone.waitingOn', {
    cards: blockers
      .map((blocker) => `#${blocker.number}${blocker.abandoned ? ` (${t('milestone.blocker.abandoned')})` : blocker.outside ? ` (${t('milestone.blocker.outside')})` : ''}`)
      .join(', '),
  })
}

/**
 * L'aperçu avant le lancement : ce qui part, ce qui attend, ce qui est écarté, puis la
 * concurrence et la configuration du jalon. Chaque carte peut prendre un autre CLI que
 * celui du jalon, avec les réglages par défaut de ce CLI.
 */
function LaunchDialog({ card, projectId, onClose }: { card: CardDto; projectId: string; onClose: () => void }) {
  const t = useTranslate()
  const { data: plan, error: planError } = useMilestonePlan(card.id, true)
  const launch = useLaunchMilestone(projectId, card.id)
  const { data: projects } = useProjects()
  const { data: userSettings } = useUserSettings()
  const project = projects?.find((entry) => entry.id === projectId)
  const defaultsFor = (agent: AgentKind): AgentConfig => inheritedConfigFor(agent, userSettings, project)

  const [concurrency, setConcurrency] = useState(String(DEFAULT_MILESTONE_CONCURRENCY))
  const [agent, setAgent] = useState<AgentKind>('claude')
  const [edited, setEdited] = useState<AgentConfig | null>(null)
  const config = edited?.agent === agent ? edited : defaultsFor(agent)
  const { groups, catalogError } = useAgentSettings({ config, onConfigChange: setEdited })
  const [overrides, setOverrides] = useState<Record<string, AgentKind>>({})

  const sections: { key: MessageKey; cards: MilestonePlanCardDto[] }[] = plan
    ? [
        { key: 'milestone.plan.ready', cards: plan.cards.filter((entry) => entry.status === 'ready') },
        { key: 'milestone.plan.waiting', cards: plan.cards.filter((entry) => entry.status === 'waiting') },
        { key: 'milestone.plan.running', cards: plan.cards.filter((entry) => entry.status === 'running') },
        { key: 'milestone.plan.excluded', cards: plan.cards.filter((entry) => entry.status === 'excluded') },
      ]
    : []
  const launchable = plan ? plan.cards.some((entry) => entry.status === 'ready' || entry.status === 'waiting') : false
  const blocked = !plan || plan.cycle.length > 0 || !launchable

  const submit = () => {
    if (blocked || launch.isPending) return
    const cards = Object.fromEntries(Object.entries(overrides).map(([id, kind]) => [id, defaultsFor(kind)]))
    launch.mutate({ concurrency: Number(concurrency), config, cards }, { onSuccess: onClose })
  }

  return (
    <Dialog.Root open onOpenChange={(next) => { if (!next && !launch.isPending) onClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="scrim z-40" />
        <Dialog.Content
          aria-describedby={undefined}
          className="surface fixed inset-x-0 bottom-0 z-50 flex max-h-[90dvh] flex-col rounded-t-xl border border-line shadow-pop sm:inset-x-auto sm:top-1/2 sm:bottom-auto sm:left-1/2 sm:w-[min(640px,calc(100vw-2rem))] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl"
        >
          <header className="flex items-center justify-between border-b border-line px-5 py-4">
            <Dialog.Title className="text-lg font-semibold">{t('milestone.dialog.title', { number: card.number })}</Dialog.Title>
            <IconButton label={t('common.close')} disabled={launch.isPending} onClick={onClose}>
              <X size={16} />
            </IconButton>
          </header>

          <div className="flex min-h-0 flex-col gap-5 overflow-y-auto p-5 sm:p-6">
            {planError ? <Banner tone="critical">{planError.message}</Banner> : null}
            {plan ? <p className="text-sm text-ink-soft">{t('milestone.dialog.intro', { branch: plan.branch })}</p> : null}
            {plan && plan.cycle.length > 0 ? (
              <Banner tone="critical">{t('milestone.dialog.cycle', { cards: plan.cycle.map((n) => `#${n}`).join(', ') })}</Banner>
            ) : null}
            {sections.map((section) =>
              section.cards.length === 0 ? null : (
                <div key={section.key} className="flex flex-col gap-1.5">
                  <h3 className="text-xs font-medium text-ink-faint">{t(section.key, { count: section.cards.length })}</h3>
                  <ul className="flex flex-col gap-1">
                    {section.cards.map((entry) => (
                      <li key={entry.cardId} className="flex min-w-0 items-center gap-2">
                        <span className="min-w-0 flex-1 truncate text-sm text-ink">
                          <span className="text-ink-faint tabular-nums">#{entry.number}</span> {entry.title}
                          {entry.status === 'waiting' ? <span className="text-xs text-ink-faint"> · {waitingOn(t, entry.blockedBy)}</span> : null}
                          {entry.excludedReason ? <span className="text-xs text-ink-faint"> · {t(`milestone.excluded.${entry.excludedReason}`)}</span> : null}
                        </span>
                        {entry.status === 'ready' || entry.status === 'waiting' ? (
                          <Menu trigger={
                            <Button size="sm" variant="ghost" icon={<AgentIcon agent={overrides[entry.cardId] ?? agent} size={14} decorative />}>
                              {overrides[entry.cardId] ? AGENT_LABELS[overrides[entry.cardId]!] : t('milestone.dialog.sameCli')}
                            </Button>
                          }>
                            <MenuRadioGroup
                              value={overrides[entry.cardId] ?? ''}
                              onValueChange={(value) =>
                                setOverrides((current) => {
                                  const next = { ...current }
                                  const parsed = agentKindSchema.safeParse(value)
                                  if (parsed.success) next[entry.cardId] = parsed.data
                                  else delete next[entry.cardId]
                                  return next
                                })
                              }
                            >
                              <MenuRadioItem value="">{t('milestone.dialog.sameCli')}</MenuRadioItem>
                              {agentKindSchema.options.map((kind) => (
                                <MenuRadioItem key={kind} value={kind}>{AGENT_LABELS[kind]}</MenuRadioItem>
                              ))}
                            </MenuRadioGroup>
                          </Menu>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ),
            )}

            <Select
              label={t('milestone.concurrency')}
              value={concurrency}
              onChange={setConcurrency}
              options={CONCURRENCY_OPTIONS.map((value) => ({ value, label: value }))}
            />
            {Number(concurrency) > MILESTONE_QUOTA_WARNING ? <Banner tone="caution">{t('milestone.quotaWarning', { count: Number(concurrency) })}</Banner> : null}

            <Select
              label={t('draft.cli.legend')}
              value={agent}
              onChange={setAgent}
              options={agentKindSchema.options.map((value) => ({ value, label: AGENT_LABELS[value], icon: <AgentIcon agent={value} size={16} /> }))}
            />
            {catalogError ? <Banner tone="caution">{t('composer.catalog.unavailable')}</Banner> : null}
            {groups.map((group) => (
              <Select key={group.key} label={group.label} value={group.value} options={group.options} onChange={group.onChange} />
            ))}
            {launch.isError ? <Banner tone="critical">{launch.error.message}</Banner> : null}
          </div>

          <footer className="flex justify-end gap-2 border-t border-line px-5 py-4">
            <Button variant="ghost" disabled={launch.isPending} onClick={onClose}>{t('board.card.cancel')}</Button>
            <Button icon={<Rocket size={14} />} disabled={blocked || launch.isPending} onClick={submit}>
              {t(launch.isPending ? 'milestone.launching' : 'milestone.launch')}
            </Button>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
