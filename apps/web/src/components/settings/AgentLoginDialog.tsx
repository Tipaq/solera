import * as Dialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { useEffect, useRef, type ReactNode } from 'react'
import type { AgentAvailabilityDto, ClaudeLoginStatusDto } from '@solera/protocol'
import { Banner, Button, IconButton } from '@solera/ui'
import {
  useAgentDeviceLogin,
  useCancelAgentLogin,
  useStartAgentLogin,
  type AgentLoginStart,
  type DeviceLoginStatusDto,
} from '../../lib/agent-login'
import { ApiRequestError } from '../../lib/api'
import { useCancelClaudeLogin, useClaudeLoginStatus } from '../../lib/claude-accounts'
import { useTranslate } from '../../lib/i18n'
import { AGENT_LABELS } from '../AgentIcon'
import { CommandLine, loginCommand } from './AgentPanels'
import { ClaudeCodeSteps, DeviceCodeSteps } from './LoginSteps'

/**
 * Connecter un CLI sans terminal : Solera lance sa connexion côté serveur et l'écran en
 * montre les étapes — la page à ouvrir, puis le code à coller (Claude) ou à saisir sur
 * la page du fournisseur (Codex, Grok). C'est la connexion propre du CLI, celle des
 * sessions sans compte : réservée à l'administrateur, elle vaut pour toute l'instance.
 *
 * La commande au terminal reste en bas, en secours : un CLI qui change son dialogue ne
 * doit pas laisser quelqu'un sans moyen de se connecter.
 */
export function AgentLoginDialog({
  agent,
  entry,
  open,
  onClose,
  onDone,
  started: given,
}: {
  agent: 'claude' | 'codex' | 'grok'
  /** Où vit le CLI, pour la commande de secours. */
  entry?: AgentAvailabilityDto
  open: boolean
  onClose: () => void
  /** Appelé une fois, quand le CLI se dit connecté. */
  onDone?: () => void
  /** Une connexion déjà lancée ; sans elle, le dialogue la lance à l'ouverture. */
  started?: AgentLoginStart
}) {
  const t = useTranslate()
  const start = useStartAgentLogin()
  const label = AGENT_LABELS[agent]
  const started = given ?? start.data
  const cancelClaude = useCancelClaudeLogin()
  const cancelDevice = useCancelAgentLogin()
  // Un seul lancement par ouverture : le double montage du mode strict en lancerait deux.
  const launched = useRef(false)
  const finished = useRef(false)

  useEffect(() => {
    if (!open) {
      launched.current = false
      finished.current = false
      start.reset()
      return
    }
    if (given || launched.current) return
    launched.current = true
    start.mutate(agent)
    // `start` change à chaque rendu ; seule l'ouverture relance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, agent, given])

  const failure = start.error instanceof ApiRequestError ? start.error.message : start.error ? String(start.error) : null

  const done = () => {
    finished.current = true
    onDone?.()
  }
  /**
   * Fermer avant la fin abandonne la connexion côté serveur : le CLI qui attend un code
   * n'a plus personne pour le lui donner, inutile qu'il attende ses quinze minutes.
   */
  const close = () => {
    if (started && !finished.current) {
      if (started.agent === 'claude') cancelClaude.mutate(started.status.loginId)
      else cancelDevice.mutate(started.agent)
    }
    onClose()
  }

  return (
    <Dialog.Root open={open} onOpenChange={(next) => { if (!next) close() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="scrim z-40" />
        <Dialog.Content
          aria-describedby={undefined}
          className="surface fixed inset-x-0 bottom-0 z-50 flex max-h-[90dvh] flex-col rounded-t-xl border border-line shadow-pop sm:inset-x-auto sm:top-1/2 sm:bottom-auto sm:left-1/2 sm:w-[min(560px,calc(100vw-2rem))] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl"
        >
          <header className="flex items-center justify-between border-b border-line px-5 py-4">
            <Dialog.Title className="text-lg font-semibold">{t('agentLogin.title', { label })}</Dialog.Title>
            <IconButton label={t('common.close')} onClick={close}>
              <X size={16} />
            </IconButton>
          </header>
          <div className="flex min-h-0 flex-col gap-4 overflow-y-auto p-5">
            <p className="text-sm text-ink-faint">{t('agentLogin.shared')}</p>
            {failure ? (
              <>
                <Banner>{failure}</Banner>
                <div>
                  <Button size="sm" variant="secondary" onClick={() => start.mutate(agent)}>
                    {t('agentLogin.retry')}
                  </Button>
                </div>
              </>
            ) : !started ? (
              <p className="text-sm text-ink-faint">{t('agentLogin.starting')}</p>
            ) : started.agent === 'claude' ? (
              <ClaudeLogin key={started.status.loginId} initial={started.status} label={label} onClose={close} onDone={done} />
            ) : (
              <DeviceLogin
                agent={started.agent}
                initial={started.status}
                label={label}
                onClose={close}
                onDone={done}
                onRetry={() => start.mutate(agent)}
              />
            )}
            <div className="flex flex-col gap-1.5 border-t border-line pt-4">
              <p className="text-meta text-ink-faint">{t('settings.agents.auth.terminal')}</p>
              <CommandLine value={loginCommand(agent, entry)} />
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

/** Prévient une seule fois de la réussite, au rendu qui la découvre. */
function useOnDone(done: boolean, onDone: () => void) {
  const told = useRef(false)
  useEffect(() => {
    if (done && !told.current) {
      told.current = true
      onDone()
    }
  }, [done, onDone])
}

function Done({ label, onClose }: { label: string; onClose: () => void }) {
  const t = useTranslate()
  return (
    <>
      <Banner tone="positive">{t('agentLogin.done', { label })}</Banner>
      <div>
        <Button onClick={onClose}>{t('common.close')}</Button>
      </div>
    </>
  )
}

function ClaudeLogin({
  initial,
  label,
  onClose,
  onDone,
}: {
  initial: ClaudeLoginStatusDto
  label: string
  onClose: () => void
  onDone: () => void
}) {
  const { data: polled } = useClaudeLoginStatus(initial.loginId)
  // L'envoi d'un code pose sa réponse dans la même relecture : c'est elle qui fait foi.
  const status = polled ?? initial
  useOnDone(status.state === 'done', onDone)

  if (status.state === 'done') return <Done label={label} onClose={onClose} />
  return <ClaudeCodeSteps status={status} onCancel={onClose} />
}

function DeviceLogin({
  agent,
  initial,
  label,
  onClose,
  onDone,
  onRetry,
}: {
  agent: 'codex' | 'grok'
  initial: DeviceLoginStatusDto
  label: string
  onClose: () => void
  onDone: () => void
  onRetry: () => void
}) {
  const t = useTranslate()
  const { data: polled } = useAgentDeviceLogin(agent, true)
  const status = polled ?? initial
  useOnDone(status.state === 'done', onDone)

  let body: ReactNode
  if (status.state === 'done') {
    body = <Done label={label} onClose={onClose} />
  } else if (status.state === 'pending') {
    body = (
      <DeviceCodeSteps
        agent={agent}
        userCode={status.userCode}
        verificationUrl={status.verificationUrl}
        onCancel={onClose}
      />
    )
  } else {
    // Échec, ou attente abandonnée côté serveur : le motif, et de quoi relancer.
    body = (
      <>
        <Banner>{status.error ?? t('agentLogin.stopped')}</Banner>
        <div>
          <Button size="sm" variant="secondary" onClick={onRetry}>
            {t('agentLogin.retry')}
          </Button>
        </div>
      </>
    )
  }
  return <>{body}</>
}
