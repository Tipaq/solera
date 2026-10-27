import { Download, KeyRound, Loader2, X } from 'lucide-react'
import type { AgentAvailabilityDto, AgentKind, UsagePeekDto } from '@solera/protocol'
import { agentKindSchema } from '@solera/protocol'
import { cx } from '@solera/ui'
import { AGENT_LABELS, AGENT_META, AgentIcon } from '../AgentIcon'
import { hiddenAgent, useInstallAgent } from '../../lib/agents'
import { useTranslate } from '../../lib/i18n'
import { openSettings } from '../../lib/settings-dialog'
import { peekOf, peekSummary, type PeekTone } from '../../lib/usage-peek'

/**
 * Le choix du CLI d'une conversation pas encore créée, avec ce qui manque à chacun.
 *
 * Une carte par CLI, quel que soit son état, parce que c'est ici qu'on découvre qu'il
 * en faut un autre : prêt, il se choisit et dit où en est sa consommation ; sans
 * connexion, la carte mène à l'onglet des réglages qui la fait ; absent, elle l'installe
 * sur place. Les trois se lisent d'un coup d'œil, au lieu d'un CLI grisé sans raison et
 * d'une ligne d'installation par absent.
 *
 * Un CLI désactivé par la configuration du serveur n'a pas de carte : rien ne se règle
 * d'ici. Un absent que le compte a masqué non plus — les réglages le proposent encore.
 */

const TONES: Record<PeekTone, string> = {
  neutral: 'text-ink-faint',
  caution: 'text-caution',
  critical: 'text-critical',
}

const CARD = 'relative flex min-h-14 flex-col justify-center gap-0.5 rounded-lg border px-3 py-2 text-left transition-colors'

export type AgentState = 'ready' | 'loggedOut' | 'missing'

export function DraftAgentPicker({
  value,
  onChange,
  availability,
  stateOf,
  accountOf,
  peek,
  hidden,
  onHide,
}: {
  value: AgentKind
  onChange: (agent: AgentKind) => void
  availability: AgentAvailabilityDto[] | undefined
  stateOf: (agent: AgentKind) => AgentState
  /** Le compte dont l'aperçu s'affiche : celui retenu pour le CLI choisi, la connexion sinon. */
  accountOf: (agent: AgentKind) => string | null
  peek: UsagePeekDto[] | undefined
  hidden: AgentKind[]
  onHide: (agent: AgentKind) => void
}) {
  const t = useTranslate()
  const install = useInstallAgent()

  const shown = agentKindSchema.options.filter((kind) => {
    const entry = availability?.find((candidate) => candidate.agent === kind)
    return entry?.reason !== 'disabled' && !hiddenAgent(entry, hidden)
  })

  return (
    <fieldset>
      <legend className="sr-only">{t('draft.cli.legend')}</legend>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {shown.map((kind) => {
          const entry = availability?.find((candidate) => candidate.agent === kind)
          const state = stateOf(kind)
          const name = (
            <span className="flex min-w-0 items-center gap-2">
              <AgentIcon agent={kind} size={14} />
              <span className="truncate text-sm font-medium text-ink">{AGENT_LABELS[kind]}</span>
            </span>
          )

          if (state === 'missing') {
            const job = entry?.install
            const running = job?.status === 'running'
            return (
              <div key={kind} className="relative">
                <button
                  type="button"
                  disabled={running || install.isPending}
                  onClick={() => install.mutate(kind)}
                  className={cx(CARD, 'w-full border-dashed border-line hover:border-line-strong hover:bg-surface-high disabled:cursor-progress')}
                >
                  {name}
                  <span className="flex items-center gap-1 text-meta text-ink-faint">
                    {running ? <Loader2 size={11} className="animate-spin" /> : <Download size={11} />}
                    {running
                      ? t('draft.agent.installing')
                      : job?.status === 'failed' ? t('draft.agent.installFailed') : t('draft.agent.installShort')}
                  </span>
                </button>
                {/* Pour qui n'en veut pas : la carte disparaît tant qu'il manque. */}
                {running ? null : (
                  <button
                    type="button"
                    aria-label={t('agent.install.dismiss')}
                    title={t('agent.install.dismiss')}
                    onClick={() => onHide(kind)}
                    className="absolute top-1 right-1 flex size-6 items-center justify-center rounded text-ink-faint hover:bg-surface-high hover:text-ink"
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
            )
          }

          if (state === 'loggedOut') {
            return (
              <button
                key={kind}
                type="button"
                onClick={() => openSettings('agents', kind)}
                className={cx(CARD, 'border-line hover:border-line-strong hover:bg-surface-high')}
              >
                {name}
                <span className="flex items-center gap-1 text-meta text-caution">
                  <KeyRound size={11} />
                  {t('draft.agent.signIn')}
                </span>
              </button>
            )
          }

          const selected = kind === value
          const summary = peekSummary(peekOf(peek, kind, accountOf(kind)))
          return (
            <label
              key={kind}
              title={AGENT_META[kind].blurb}
              className={cx(
                CARD,
                'cursor-pointer has-focus-visible:ring-2 has-focus-visible:ring-accent',
                selected ? 'border-accent bg-accent-wash' : 'border-line hover:border-line-strong hover:bg-surface-high',
              )}
            >
              <input
                type="radio"
                name="draft-agent"
                value={kind}
                aria-label={AGENT_LABELS[kind]}
                checked={selected}
                onChange={() => onChange(kind)}
                className="sr-only"
              />
              {name}
              <span className={cx('truncate text-meta tabular-nums', summary ? TONES[summary.tone] : 'text-ink-faint')}>
                {summary?.text ?? t('draft.agent.ready')}
              </span>
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}
