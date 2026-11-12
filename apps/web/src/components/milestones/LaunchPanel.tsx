import { Check, CircleAlert, GitMerge, Hand, Laptop, Play } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  MAX_MILESTONE_CONCURRENCY,
  environmentKey,
  type ExecutionEnvironment,
  type MilestoneRunMode,
} from '@solera/protocol'
import { Banner, Button, ChoiceCards, Tooltip, cx } from '@solera/ui'
import { AgentIcon } from '../AgentIcon'
import { CardInfoButton } from '../cards/CardInfoButton'
import { MilestoneCardLink } from './MilestoneCardLink'
import { STATE_DOT } from '../gantt/tones'
import { awaitsMe, cardState, isOpen, loadedStatus, type StatusOf } from '../../lib/card-state'
import { pluralOf } from '../../lib/code-model'
import { useTranslate } from '../../lib/i18n'
import {
  environmentForMode,
  initialLaunchEnvironment,
  launchCheckText,
  launchChecks,
  launchEnvironments,
  launchReady,
  launchStage,
  manualRowOf,
  quotaWarning,
} from '../../lib/milestone-launch'
import type { MilestoneEntry } from '../../lib/milestone-model'
import { useLaunchMilestone, useLaunchMilestoneCard, useMilestonePlan } from '../../lib/milestones'
import { useProjectDevcontainer, useProjectEnvironments } from '../../lib/projects'

/**
 * **Lancer** un jalon (#197, spec jalons LCH-1..12) : à la main, carte par carte, ou en
 * autonome, le serveur lançant les cartes prêtes vague par vague. L'emplacement des
 * sessions suit le projet ; le lancement n'en règle que le confinement.
 *
 * La concurrence vit dans la page : les vagues la montrent aussi (VAG-1). Un jalon lancé
 * n'a plus ce panneau, mais son suivi (#198).
 */
export function LaunchPanel({
  projectId,
  entry,
  concurrency,
  onConcurrency,
  statusOf = loadedStatus,
}: {
  projectId: string
  entry: MilestoneEntry
  concurrency: number
  onConcurrency: (value: number) => void
  statusOf?: StatusOf
}) {
  const t = useTranslate()
  const stage = launchStage(entry)

  if (stage === 'delivered') {
    return (
      <section
        aria-label={t('milestone.launch.delivered')}
        className="flex flex-col gap-2 rounded-xl border border-positive/40 bg-positive/5 p-4"
      >
        <h3 className="flex items-center gap-2 text-sm font-semibold text-ink">
          <GitMerge size={15} aria-hidden className="text-positive" />
          {t('milestone.launch.delivered')}
        </h3>
        <p className="text-sm text-ink-soft">
          {t(`milestone.launch.deliveredText.${pluralOf(entry.done)}`, { count: entry.done })}
          {entry.card.branchPr?.mergedAt ? ` ${t('milestone.launch.deliveredPr')}` : null}
        </p>
      </section>
    )
  }

  if (stage === 'empty') {
    return (
      <section aria-label={t('milestone.launch.title')} className="flex flex-col gap-2 rounded-xl border border-line p-4">
        <h3 className="text-sm font-semibold text-ink">{t('milestone.launch.title')}</h3>
        <p className="text-sm text-ink-faint">{t('milestone.launch.nothingYet')}</p>
      </section>
    )
  }

  if (stage === 'launched') return null
  return <Launcher projectId={projectId} entry={entry} concurrency={concurrency} onConcurrency={onConcurrency} statusOf={statusOf} />
}

function Launcher({
  projectId,
  entry,
  concurrency,
  onConcurrency,
  statusOf,
}: {
  projectId: string
  entry: MilestoneEntry
  concurrency: number
  onConcurrency: (value: number) => void
  statusOf: StatusOf
}) {
  const t = useTranslate()
  const { data: environments } = useProjectEnvironments(projectId)
  const { data: plan } = useMilestonePlan(entry.card.id, true)
  const launch = useLaunchMilestone(projectId, entry.card.id)
  const launchCard = useLaunchMilestoneCard(projectId, entry.card.id)
  const [mode, setMode] = useState<MilestoneRunMode>('manual')
  // Choisi à la main ; tant que rien ne l'est, le réglage du projet, confiné d'office en
  // autonome. Déduit plutôt que posé au clic : les environnements peuvent arriver après.
  const [picked, setPicked] = useState<ExecutionEnvironment | null>(null)
  const choices = environments ? launchEnvironments(environments) : []
  const environment = picked ?? (environments ? environmentForMode(mode, initialLaunchEnvironment(environments), choices) : null)
  // `null` tant que les environnements ne sont pas lus : rien ne part avant.
  const confined = environment?.confined ?? null

  const pickMode = (next: MilestoneRunMode) => {
    setMode(next)
    // Le refus d'un geste de l'autre mode ne concerne plus celui-ci.
    launch.reset()
    launchCard.reset()
    if (picked) setPicked(environmentForMode(next, picked, choices))
  }

  const checks = launchChecks(entry, concurrency)
  const ready = launchReady(checks)
  const failures = checks.filter((check) => !check.ok).length
  const busy = launch.isPending || launchCard.isPending
  const error = launch.error ?? launchCard.error
  const picker =
    environments && environment ? (
      <EnvironmentPicker projectId={projectId} choices={choices} value={environment} onChange={setPicked} />
    ) : null

  return (
    <section aria-label={t('milestone.launch.title')} className="flex flex-col gap-4 rounded-xl border border-line p-4">
      <div className="flex items-baseline gap-2">
        <h3 className="text-sm font-semibold text-ink">{t('milestone.launch.title')}</h3>
        <span className="text-xs text-ink-faint">{t('milestone.launch.subtitle')}</span>
      </div>

      <ChoiceCards<MilestoneRunMode>
        label={t('milestone.launch.modeAria')}
        value={mode}
        onChange={pickMode}
        options={[
          { value: 'manual', label: t('milestone.launch.manual'), hint: t('milestone.launch.manualHint'), icon: <Hand size={16} /> },
          { value: 'auto', label: t('milestone.launch.auto'), hint: t('milestone.launch.autoHint'), icon: <Laptop size={16} /> },
        ]}
      />

      {mode === 'manual' ? (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-ink-faint">{t('milestone.launch.manualIntro')}</p>
          {picker}
          <ul aria-label={t('milestone.launch.cards')} className="flex flex-col divide-y divide-line rounded-lg border border-line">
            {entry.children.filter(isOpen).map((card) => {
              const row = manualRowOf(card, entry, statusOf)
              const asking = awaitsMe(card, statusOf)
              return (
                <li key={card.id} className={cx('flex min-w-0 items-center gap-2 px-2.5 py-2 text-sm', asking && 'bg-caution/10')}>
                  <span aria-hidden className={cx('size-2 shrink-0 rounded-full', asking ? 'bg-caution' : STATE_DOT[cardState(card)])} />
                  <MilestoneCardLink projectId={projectId} card={card} statusOf={statusOf} />
                  <CardInfoButton card={card} />
                  {row.kind === 'live' ? (
                    <span className="flex shrink-0 gap-1">
                      {row.sessions.map((session) => (
                        <Tooltip
                          key={session.id}
                          label={t(statusOf(session) === 'awaiting_input' ? 'milestone.waves.awaiting' : 'milestone.waves.running')}
                        >
                          <span className="inline-flex">
                            <AgentIcon agent={session.agent} size={13} />
                          </span>
                        </Tooltip>
                      ))}
                    </span>
                  ) : row.kind === 'launch' ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={<Play size={13} />}
                      aria-label={t('milestone.launch.launchCardAria', { number: card.number })}
                      disabled={busy || confined === null}
                      onClick={() => launchCard.mutate({ childId: card.id, confined })}
                    >
                      {t('milestone.launch.launchCard')}
                    </Button>
                  ) : (
                    <span className="shrink-0 text-xs text-ink-faint">{t('milestone.launch.waits')}</span>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-xs text-ink-faint">{t('milestone.launch.autoIntro')}</p>
          <Row label={t('milestone.launch.concurrency')} wrap>
            <ConcurrencyPicker label={t('milestone.launch.concurrency')} value={concurrency} onChange={onConcurrency} />
          </Row>
          {quotaWarning(concurrency) ? (
            <Banner tone="caution">{t('milestone.launch.quota', { count: concurrency })}</Banner>
          ) : null}
          <Row label={t('milestone.launch.branch')}>
            <code className="block truncate text-xs">{plan?.branch ?? entry.card.branch ?? '…'}</code>
          </Row>
          <Row label={t('milestone.launch.cli')}>
            <span className="text-xs text-ink-soft">{t('milestone.launch.cliValue')}</span>
          </Row>
          {picker}
          {environment?.where === 'devcontainer' && environment.confined ? <ServicesRow projectId={projectId} /> : null}
          {environment && !environment.confined ? (
            <Banner tone="caution">{t('milestone.launch.notConfined')}</Banner>
          ) : null}

          <div
            role="group"
            aria-label={t('milestone.launch.checks')}
            className={cx(
              'flex flex-col gap-2 rounded-lg border p-3',
              ready ? 'border-positive/40 bg-positive/5' : 'border-caution/40 bg-caution/5',
            )}
          >
            <span className={cx('text-sm font-medium', ready ? 'text-positive' : 'text-caution')}>
              {ready ? t('milestone.launch.ready') : t(`milestone.launch.toSettle.${pluralOf(failures)}`, { count: failures })}
            </span>
            <ul className="flex flex-col gap-1.5">
              {checks.map((check) => (
                <li
                  key={check.kind}
                  className={cx('flex items-start gap-2 text-sm', check.ok ? 'text-ink-soft' : 'font-medium text-ink')}
                >
                  {check.ok ? (
                    <Check size={14} aria-hidden className="mt-0.5 shrink-0 text-positive" />
                  ) : (
                    <CircleAlert size={14} aria-hidden className="mt-0.5 shrink-0 text-caution" />
                  )}
                  {launchCheckText(check, t)}
                </li>
              ))}
            </ul>
          </div>
          <p className="text-xs text-ink-faint">{t('milestone.launch.onlyBlocks')}</p>
          <Button
            icon={<Play size={14} />}
            disabled={!ready || busy || confined === null}
            onClick={() => launch.mutate({ mode: 'auto', concurrency, confined })}
          >
            {t('milestone.launch.launchAuto')}
          </Button>
        </div>
      )}

      {error ? (
        <p role="alert" className="text-sm text-critical">
          {t('milestone.launch.failed', { error: error.message })}
        </p>
      ) : null}
    </section>
  )
}

/**
 * Le confinement des sessions, à l'emplacement du projet (LCH-5, spec §2.6-2) : changer
 * d'emplacement se fait dans les réglages du projet, pas au lancement.
 */
function EnvironmentPicker({
  projectId,
  choices,
  value,
  onChange,
}: {
  projectId: string
  choices: ExecutionEnvironment[]
  value: ExecutionEnvironment
  onChange: (value: ExecutionEnvironment) => void
}) {
  const t = useTranslate()
  const key = environmentKey(value)
  return (
    <Row label={t('milestone.launch.environment')}>
      <div className="flex flex-col gap-1.5">
        <ChoiceCards
          label={t('milestone.launch.environment')}
          value={key}
          onChange={(next) => onChange(choices.find((choice) => environmentKey(choice) === next) ?? value)}
          options={choices.map((choice) => {
            const option = environmentKey(choice)
            return { value: option, label: t(`environment.${option}`), hint: t(`milestone.launch.environment.hint.${option}`) }
          })}
        />
        <p className="text-xs text-ink-faint">
          {t('milestone.launch.whereFromProject')} <SettingsLink projectId={projectId} />
        </p>
      </div>
    </Row>
  )
}

/** Les services d'un dev container confiné : un réglage du projet, lu ici (spec §2.6-3). */
function ServicesRow({ projectId }: { projectId: string }) {
  const t = useTranslate()
  const { data: devcontainer } = useProjectDevcontainer(projectId)
  if (!devcontainer?.compose) return null
  return (
    <Row label={t('milestone.launch.services')}>
      <span className="text-xs text-ink-soft">
        {t(`milestone.launch.servicesValue.${devcontainer.confinedServices}`)} · <SettingsLink projectId={projectId} />
      </span>
    </Row>
  )
}

/** Les réglages du projet : l'emplacement et les services s'y changent, pas au lancement. */
function SettingsLink({ projectId }: { projectId: string }) {
  const t = useTranslate()
  return (
    <Link to={`/p/${projectId}/settings`} className="text-accent hover:underline">
      {t('milestone.launch.settings')}
    </Link>
  )
}

/** Combien de sessions à la fois, de 1 à 6 (LCH-9) : le choisi en accent. */
function ConcurrencyPicker({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex gap-1">
      {Array.from({ length: MAX_MILESTONE_CONCURRENCY }, (_, index) => index + 1).map((option) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={option === value}
          onClick={() => onChange(option)}
          className={cx(
            // 44 px au doigt (Gabarits/Tactile), 28 à la souris.
            'size-11 shrink-0 rounded-md text-xs tabular-nums transition-colors md:size-7 md:shrink pointer-coarse:size-11 pointer-coarse:shrink-0',
            'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
            option === value ? 'bg-accent text-accent-ink' : 'border border-line text-ink-soft hover:border-line-strong',
          )}
        >
          {option}
        </button>
      ))}
    </div>
  )
}

/**
 * Un champ du panneau : le libellé à gauche, sur 112 px, la valeur à droite. `wrap` : au
 * doigt, une valeur faite de cibles de 44 px qui n'y tiennent pas passe dessous ; à la
 * souris, elle reste à côté et se resserre, comme au prototype.
 */
function Row({ label, wrap = false, children }: { label: string; wrap?: boolean; children: ReactNode }) {
  return (
    <div className={cx('flex items-center gap-x-3', wrap && 'flex-wrap gap-y-1.5 md:flex-nowrap pointer-coarse:flex-wrap')}>
      <span className="w-28 shrink-0 text-xs text-ink-faint">{label}</span>
      {/* Sa largeur propre, pour que la ligne sache quand la passer dessous. */}
      <div className={wrap ? 'shrink-0 md:min-w-0 md:flex-1 pointer-coarse:flex-none' : 'min-w-0 flex-1'}>{children}</div>
    </div>
  )
}
