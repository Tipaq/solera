import { Check, Copy, Download, KeyRound, RefreshCw } from 'lucide-react'
import type { ReactNode } from 'react'
import type { AgentAuthDto, AgentAvailabilityDto, AgentKind } from '@solera/protocol'
import { Badge, Banner, Button, Card, CardBody, CardHeader } from '@solera/ui'
import { useInstallAgent, versionMismatch } from '../../lib/agents'
import { useCopy } from '../../lib/clipboard'
import { useTranslate, type MessageKey } from '../../lib/i18n'
import { AGENT_LABELS } from '../AgentIcon'
import { AgentInstallProgress, installProgress } from '../AgentInstallRow'

/**
 * Les deux premiers blocs d'un onglet de la section Agents : le CLI est-il là, et
 * est-il connecté. Ce sont les deux questions qu'on se pose avant de régler un modèle,
 * et chacune avait jusqu'ici sa réponse ailleurs — l'installation sur l'écran d'une
 * conversation neuve, la connexion nulle part.
 */

/**
 * La commande de connexion de chaque CLI, à lancer sur la machine du serveur. Relevées
 * dans `docs/accounts.md`, `docs/windows.md`, `docs/OPENCODE.md` et `docs/GROK.md` :
 * Grok passe par le code d'appareil, sans quoi il attend un navigateur local.
 */
export const LOGIN_COMMANDS: Record<AgentKind, string> = {
  claude: 'claude auth login',
  codex: 'codex login',
  opencode: 'opencode auth login',
  grok: 'grok login --device-auth',
}

/** Deux lignes qui pulsent, à la place de ce qui va venir (Gabarits › États). */
function Pending() {
  return (
    <div className="flex flex-col gap-2" aria-hidden>
      <div className="h-3 w-2/3 animate-pulse rounded bg-surface-high" />
      <div className="h-3 w-1/3 animate-pulse rounded bg-surface-high" />
    </div>
  )
}

/** Une paire intitulé-valeur, dans la grille des deux cartes. */
function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-ink-faint">{label}</dt>
      <dd className="min-w-0 break-words text-ink">{children}</dd>
    </>
  )
}

/**
 * Installation : la version présente face à celle que Solera vise, et de quoi poser
 * celle-ci quand le CLI manque ou qu'elle n'est pas compatible. Un CLI désactivé par la
 * configuration le dit et ne propose rien : l'installer ne le rendrait pas disponible.
 */
export function AgentInstallCard({ entry }: { entry: AgentAvailabilityDto | undefined }) {
  const t = useTranslate()
  const install = useInstallAgent()

  return (
    <Card>
      <CardHeader title={t('settings.agents.install.title')} icon={<Download size={16} />} />
      <CardBody className="flex flex-col gap-3">
        {entry ? <InstallBody entry={entry} pending={install.isPending} onInstall={() => install.mutate(entry.agent)} /> : <Pending />}
      </CardBody>
    </Card>
  )
}

function InstallBody({ entry, pending, onInstall }: { entry: AgentAvailabilityDto; pending: boolean; onInstall: () => void }) {
  const t = useTranslate()
  const label = AGENT_LABELS[entry.agent]

  if (entry.reason === 'disabled') {
    return (
      <div className="flex flex-col items-start gap-2">
        <Badge>{t('settings.agents.install.disabled')}</Badge>
        <p className="text-sm text-ink-faint">{t('agent.unavailable.disabled')}</p>
      </div>
    )
  }

  const progress = installProgress(entry, pending)
  if (progress) return <AgentInstallProgress label={label} version={progress.version} progress={progress} />

  const mismatch = versionMismatch(entry)
  const failed = entry.install.status === 'failed' ? entry.install.error : null
  // Proposée quand elle change quelque chose : un CLI absent, une version incompatible,
  // ou un essai qui a échoué. Une version compatible n'a rien à gagner à être remplacée.
  const offer = !entry.installed || mismatch !== null || failed !== null

  return (
    <>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
        <Fact label={t('settings.agents.install.state')}>
          {entry.installed ? (
            <Badge tone={mismatch ? 'caution' : 'positive'}>
              {mismatch ? t('settings.agents.install.outdated') : t('settings.agents.install.ready')}
            </Badge>
          ) : (
            <Badge tone="caution">{t('settings.agents.install.missing')}</Badge>
          )}
        </Fact>
        {entry.installed ? (
          <Fact label={t('settings.agents.install.version')}>{entry.version ?? t('settings.agents.unknown')}</Fact>
        ) : null}
        <Fact label={t('settings.agents.install.preferred')}>{entry.preferredVersion}</Fact>
        {entry.installed && entry.path ? (
          <Fact label={entry.managed ? t('settings.agents.install.managed') : t('settings.agents.install.system')}>
            <code className="break-all font-mono text-xs">{entry.path}</code>
          </Fact>
        ) : null}
      </dl>
      {!entry.installed ? <p className="text-sm text-ink-faint">{t('agent.install.missing', { label })}</p> : null}
      {mismatch ? <Banner tone="caution">{mismatch}</Banner> : null}
      {failed ? <Banner>{failed}</Banner> : null}
      {offer ? (
        <div>
          <Button size="sm" variant="secondary" onClick={onInstall}>
            {failed
              ? t('agent.install.retry')
              : entry.installed
                ? t('settings.agents.install.update', { version: entry.preferredVersion })
                : t('agent.install.action', { version: entry.preferredVersion })}
          </Button>
        </div>
      ) : null}
    </>
  )
}

const STATUS: Record<AgentAuthDto['status'], { tone: 'positive' | 'caution' | 'neutral'; key: MessageKey }> = {
  ready: { tone: 'positive', key: 'settings.agents.auth.status.ready' },
  logged_out: { tone: 'caution', key: 'settings.agents.auth.status.loggedOut' },
  unknown: { tone: 'neutral', key: 'settings.agents.auth.status.unknown' },
}

/**
 * Connexion : celle que le CLI tient lui-même, hors des comptes supplémentaires. Solera
 * ne la mène pas — elle se fait au terminal, sur le serveur —, il dit seulement où elle
 * en est et quelle commande la fait. « Vérifier » relit sans attendre la minute du cache,
 * pour qui revient du terminal.
 */
export function AgentAuthCard({
  agent,
  auth,
  error,
  checking,
  onCheck,
}: {
  agent: AgentKind
  /** `undefined` pendant la lecture ; `null` quand le serveur ne dit rien de ce CLI. */
  auth: AgentAuthDto | null | undefined
  error: boolean
  checking: boolean
  onCheck: () => void
}) {
  const t = useTranslate()
  const status = STATUS[auth?.status ?? 'unknown']

  return (
    <Card>
      <CardHeader
        title={t('settings.agents.auth.title')}
        icon={<KeyRound size={16} />}
        actions={
          <Button size="sm" variant="ghost" icon={<RefreshCw size={14} className={checking ? 'animate-spin' : undefined} />} disabled={checking} onClick={onCheck}>
            {t('settings.agents.auth.check')}
          </Button>
        }
      />
      <CardBody className="flex flex-col gap-3">
        {error ? <Banner>{t('settings.agents.auth.error')}</Banner> : null}
        {auth === undefined && !error ? (
          <Pending />
        ) : (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
            <Fact label={t('settings.agents.auth.state')}>
              <Badge tone={status.tone}>{t(status.key)}</Badge>
            </Fact>
            {auth?.method ? <Fact label={t('settings.agents.auth.method')}>{auth.method}</Fact> : null}
            {auth?.plan ? <Fact label={t('settings.agents.auth.plan')}>{auth.plan}</Fact> : null}
            {auth?.identity ? <Fact label={t('settings.agents.auth.identity')}>{auth.identity}</Fact> : null}
          </dl>
        )}
        {auth && auth.status !== 'ready' ? (
          <div className="flex flex-col gap-1.5">
            <p className="text-sm text-ink-faint">
              {t(auth.status === 'logged_out' ? 'settings.agents.auth.howTo' : 'settings.agents.auth.howToUnknown')}
            </p>
            <CommandLine value={LOGIN_COMMANDS[agent]} />
          </div>
        ) : null}
      </CardBody>
    </Card>
  )
}

/** Une commande à recopier dans un terminal, et son bouton de copie. */
function CommandLine({ value }: { value: string }) {
  const t = useTranslate()
  const { state, copy } = useCopy()
  return (
    <div className="flex items-center gap-2">
      <code className="min-w-0 flex-1 break-all rounded-md bg-sunken px-3 py-2 font-mono text-xs text-ink">{value}</code>
      <Button size="sm" variant="secondary" icon={state === 'copied' ? <Check size={14} /> : <Copy size={14} />} onClick={() => copy(value)}>
        {state === 'copied' ? t('common.copied') : state === 'failed' ? t('common.failed') : t('common.copy')}
      </Button>
    </div>
  )
}
