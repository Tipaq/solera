import * as Dialog from '@radix-ui/react-dialog'
import { RefreshCw, X } from 'lucide-react'
import { useMemo } from 'react'
import type { AgentAuthDto, AgentKind, UsageLiveWindowDto } from '@solera/protocol'
import { AGENT_LABELS, AgentIcon } from './AgentIcon'
import { locale, useTranslate } from '../lib/i18n'
import { useAgentAuth, useAgentAvailability } from '../lib/agents'
import { openSettings } from '../lib/settings-dialog'
import { liveLabel, peekOf, resetMoment, useUsagePeek } from '../lib/usage-peek'
import { useClaudeAccounts } from '../lib/claude-accounts'
import { useCodexAccounts } from '../lib/codex-accounts'
import { useAccountUsage, useRefreshUsage, type AccountUsageEntry, type UsageTarget } from '../lib/usage'
import { Banner, Button, IconButton, cx } from '@solera/ui'
import { UsageBar, readAge } from './chat/UsageBar'

/**
 * Consommation du compte, l'équivalent de `/usage`.
 *
 * Elle appartient au compte et non au fil : le quota d'une fenêtre de 5 h est le même
 * quelle que soit la conversation ouverte. Ce qui est propre à une conversation — son
 * coût, ses tokens, son contexte — se lit dans la conversation, et pas ici.
 *
 * Le panneau ne connaît aucune fenêtre à l'avance : il affiche ce que le CLI déclare,
 * dans l'ordre reçu. C'est ce qui a permis à la jauge Fable d'apparaître sans que rien
 * ne soit écrit à son sujet, et ce qui fera apparaître la suivante.
 *
 * Il ne connaît pas davantage ses CLI à l'avance : une section par CLI que le serveur
 * dit savoir lancer, toutes lues en parallèle à l'ouverture. Un CLI absent est un état
 * normal depuis que Solera ne transporte plus les binaires — il ne laisse pas de
 * place vide, il n'a simplement pas de section.
 *
 * Un CLI peut porter plusieurs comptes : sa connexion, puis chaque compte
 * supplémentaire qui sait lire son forfait (voir `docs/accounts.md`), chacun dans sa
 * section, parce que chacun a sa propre limite.
 */

const NO_LIVE: UsageLiveWindowDto[] = []

/** Deux barres grises le temps qu'un CLI réponde : la section garde sa place. */
function UsageSkeleton() {
  return (
    <div className="flex animate-pulse flex-col gap-3.5" aria-hidden>
      {[0, 1].map((row) => (
        <div key={row} className="flex flex-col gap-1">
          <div className="h-3.5 w-28 rounded bg-surface-high" />
          <div className="h-1.5 rounded-full bg-surface-high" />
        </div>
      ))}
    </div>
  )
}

/**
 * Un CLI et ses fenêtres. Présentation seule : la lecture est menée une fois pour
 * toutes par la modale, qui sait combien de CLI elle a et depuis quand.
 */
function UsageSection({ entry, accountLabel, auth, live }: {
  entry: AccountUsageEntry
  accountLabel?: string
  /** La connexion du CLI telle que le serveur l'a lue ; absente pour un compte supplémentaire. */
  auth?: AgentAuthDto
  /** Ce que les tours ont dit de la limite, plus frais que la sonde quand une session tourne. */
  live: UsageLiveWindowDto[]
}) {
  const t = useTranslate()
  const { agent, account, usage, error, isPending } = entry
  // Un compte Claude supplémentaire n'a pas de jauge, mais pas pour la même raison
  // selon sa nature : une clé API n'a pas de forfait, un jeton de setup-token en a un
  // qu'il n'a pas le droit de lire. Le message doit dire lequel.
  const { data: claudeAccounts } = useClaudeAccounts(agent === 'claude' && account !== null)
  const accountKind = claudeAccounts?.accounts.find((candidate) => candidate.id === account)?.kind ?? null
  const noLimitsMessage = accountKind === 'oauth' ? t('usage.noLimits.token') : t('usage.noLimits')

  return (
    <section
      // Le squelette est un ornement, invisible aux lecteurs d'écran : sans ça, la
      // section annoncerait son titre puis plus rien pendant que le CLI répond.
      aria-busy={isPending}
      className="flex flex-col gap-3 border-b border-line px-3 py-3.5 last:border-b-0"
    >
      <h3 className="flex items-center gap-2 text-sm font-medium text-ink">
        {/* Muette : le nom du CLI suit immédiatement. */}
        <AgentIcon agent={agent} size={14} decorative />
        <span className="min-w-0 flex-1 truncate">
          {AGENT_LABELS[agent]}
          {/* Le compte suit le CLI : deux sections Claude ne se distinguent que par lui. */}
          {accountLabel ? <span className="text-ink-faint"> · {accountLabel}</span> : null}
        </span>
        {/* Le forfait en puce plutôt qu'en ligne : c'est une étiquette du CLI nommé à
            sa gauche, pas une information de plus à lire sous lui. */}
        {usage?.plan ? (
          <span className="shrink-0 rounded-full bg-surface-high px-1.5 py-px text-micro text-ink-soft">
            {/* « max » seul ne dit pas de quoi il est le nom : la puce se lit dans le
                dessin, elle doit s'entendre dans la voix. */}
            <span className="sr-only">{t('usage.plan')} </span>
            {usage.plan}
          </span>
        ) : null}
      </h3>

      {/* Qui consomme : l'identité et la méthode de connexion, ce que `/status` dit
          dans le CLI. Deux connexions sur la même machine ne se distinguent que par là. */}
      {auth && (auth.identity || auth.method) ? (
        <p className="-mt-1.5 truncate text-meta text-ink-faint">
          {[auth.identity, auth.method].filter(Boolean).join(' · ')}
        </p>
      ) : null}

      <LiveNotice live={live} />

      {isPending ? <UsageSkeleton /> : null}

      {error ? <Banner>{error.message || t('usage.error')}</Banner> : null}

      {usage ? (
        <>
          {!usage.limitsAvailable ? (
            <p className="text-sm text-ink-faint">{noLimitsMessage}</p>
          ) : (
            <div className="flex flex-col gap-3.5">
              {usage.windows.map((window) => (
                <UsageBar key={window.id} window={window} />
              ))}
            </div>
          )}

          {usage.credits ? (
            <div className="flex flex-col gap-1">
              <div className="flex items-baseline gap-2 text-sm">
                <span className="min-w-0 flex-1 truncate text-ink-soft">{usage.credits.label}</span>
                <span className="shrink-0 text-meta text-ink-faint">
                  {usage.credits.enabled ? t('usage.credits.enabled') : t('usage.credits.disabled')}
                </span>
              </div>
              {usage.credits.utilization !== null ? (
                <div className="h-1.5 overflow-hidden rounded-full bg-surface-high">
                  <div
                    className={cx('h-full rounded-full', usage.credits.utilization >= 0.9 ? 'bg-critical' : usage.credits.utilization >= 0.75 ? 'bg-caution' : 'bg-accent')}
                    style={{ width: `${Math.min(Math.round(usage.credits.utilization * 100), 100)}%` }}
                  />
                </div>
              ) : null}
              {usage.credits.detail ? (
                <p className="text-meta text-ink-faint">{usage.credits.detail}</p>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  )
}

/**
 * Une limite atteinte, ou presque, pendant un tour : la sonde peut dater de cinq
 * minutes, le CLI vient de le dire. Rien quand tout va bien — la jauge le dit déjà.
 */
function LiveNotice({ live }: { live: UsageLiveWindowDto[] }) {
  const t = useTranslate()
  const alert = live.find((window) => window.status === 'rejected') ?? live.find((window) => window.status === 'allowed_warning')
  if (!alert) return null
  const at = alert.resetsAt ? resetMoment(alert.resetsAt) : null
  return (
    <p className={cx('text-sm', alert.status === 'rejected' ? 'text-critical' : 'text-caution')}>
      {alert.status === 'rejected'
        ? (at ? t('usage.live.blockedUntil', { window: liveLabel(alert), at }) : t('usage.live.blocked', { window: liveLabel(alert) }))
        : t('usage.live.warning', { window: liveLabel(alert) })}
    </p>
  )
}

/** Un CLI installé sans connexion : rien à sonder, un chemin pour la faire. */
function LoggedOutSection({ agent, onNavigate }: { agent: AgentKind; onNavigate: () => void }) {
  const t = useTranslate()
  return (
    <section className="flex items-center gap-2 border-b border-line px-3 py-3.5 last:border-b-0">
      <AgentIcon agent={agent} size={14} decorative />
      <span className="min-w-0 flex-1 truncate text-sm text-ink">
        {AGENT_LABELS[agent]}
        <span className="text-ink-faint"> · {t('usage.loggedOut')}</span>
      </span>
      <Button size="sm" variant="ghost" onClick={() => { onNavigate(); openSettings('agents', agent) }}>
        {t('usage.connect')}
      </Button>
    </section>
  )
}

/**
 * Les CLI lançables, et leur consommation.
 *
 * `agent` est le CLI mis en tête : celui du fil d'où l'on ouvre. Il est toujours
 * montré, même absent de la liste des disponibles — il vient d'une conversation qui
 * tourne avec lui, et refuser d'en lire la consommation serait incompréhensible.
 */
function UsageDialog({ agent, account, onClose }: { agent?: AgentKind; account: string | null; onClose: () => void }) {
  const t = useTranslate()
  const { data: availability, isPending: listing } = useAgentAvailability()
  const { data: auth } = useAgentAuth()
  const { data: peek } = useUsagePeek()
  const authOf = (kind: AgentKind) => auth?.entries.find((entry) => entry.agent === kind && entry.account === null)

  const installed = useMemo(
    () => (availability?.agents ?? []).filter((a) => a.installed).map((a) => a.agent),
    [availability],
  )
  // Sonder un CLI dont la connexion manque ne rapporterait qu'une erreur, au prix d'un
  // process : il a sa ligne à part, qui mène à la connexion.
  const loggedOut = useMemo(
    () => new Set(auth?.entries.filter((entry) => entry.account === null && entry.status === 'logged_out').map((entry) => entry.agent)),
    [auth],
  )
  const { data: claudeList } = useClaudeAccounts(installed.includes('claude'))
  const { data: codexList } = useCodexAccounts(installed.includes('codex'))

  // Les comptes supplémentaires qui ont une jauge, chacun en section : un abonnement
  // de plus a sa propre limite, et c'est elle qu'on vient lire avant de choisir sur
  // lequel lancer. Un jeton sans jauge et une clé API n'ont rien à montrer ici ; la
  // modale ne les sonde pas, la page des comptes dit pourquoi.
  const extra = useMemo(
    () => [
      ...(installed.includes('claude') ? (claudeList?.accounts ?? []) : [])
        .filter((entry) => entry.kind === 'oauth' && entry.gauge)
        .map((entry) => ({ agent: 'claude' as const, account: entry.id, label: entry.label })),
      ...(installed.includes('codex') ? (codexList?.accounts ?? []) : [])
        .filter((entry) => entry.status === 'ready' && entry.authMode === 'chatgpt')
        .map((entry) => ({ agent: 'codex' as const, account: entry.id, label: entry.label })),
    ],
    [installed, claudeList, codexList],
  )
  const accountLabels = useMemo(() => {
    const labels = new Map<string, string>()
    for (const entry of claudeList?.accounts ?? []) labels.set(entry.id, entry.label)
    for (const entry of codexList?.accounts ?? []) labels.set(entry.id, entry.label)
    return labels
  }, [claudeList, codexList])

  // Chaque CLI sur sa propre connexion, suivi de ses comptes. Le fil d'où l'on ouvre
  // passe en tête, sur le compte qu'il utilise, et n'est pas répété plus bas.
  const targets = useMemo<UsageTarget[]>(() => {
    const ordered: UsageTarget[] = installed.flatMap((kind) => [
      ...(loggedOut.has(kind) ? [] : [{ agent: kind, account: null }]),
      ...extra
        .filter((entry) => entry.agent === kind)
        .map((entry) => ({ agent: entry.agent, account: entry.account })),
    ])
    if (!agent) return ordered
    const lead = { agent, account }
    return [lead, ...ordered.filter((target) => target.agent !== agent || target.account !== account)]
  }, [installed, extra, agent, account, loggedOut])

  const { entries, fetchedAt, isFetching } = useAccountUsage(targets)
  const refresh = useRefreshUsage(targets)
  // Les deux chemins de lecture : les queries à l'ouverture, la mutation au bouton. La
  // relecture forcée ne passe pas par une query, donc `isFetching` seul laisserait le
  // bouton vif et muet pendant qu'il lance un process CLI par agent.
  const busy = isFetching || refresh.isPending

  return (
    <>
      <header className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2 pt-safe">
        <Dialog.Title className="flex-1 text-sm font-semibold">
          {t('usage.account.title')}
        </Dialog.Title>
        <IconButton
          label={t('usage.refresh')}
          onClick={() => refresh.mutate()}
          disabled={busy || targets.length === 0}
        >
          <RefreshCw size={16} className={cx(busy && 'animate-spin')} />
        </IconButton>
        <Dialog.Close asChild>
          <IconButton label={t('usage.close')}>
            <X size={16} />
          </IconButton>
        </Dialog.Close>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto pb-safe">
        {entries.map((entry) => (
          <UsageSection
            key={`${entry.agent}:${entry.account ?? ''}`}
            entry={entry}
            accountLabel={entry.account ? accountLabels.get(entry.account) : undefined}
            auth={entry.account === null ? authOf(entry.agent) : undefined}
            live={peekOf(peek, entry.agent, entry.account)?.live ?? NO_LIVE}
          />
        ))}
        {installed.filter((kind) => loggedOut.has(kind)).map((kind) => (
          <LoggedOutSection key={`logged-out:${kind}`} agent={kind} onNavigate={onClose} />
        ))}

        {/* La liste des CLI arrive après le premier rendu : tant qu'elle manque, il n'y
            a pas encore de section à poser, et dire « aucun CLI » serait prématuré. */}
        {targets.length === 0 && !listing ? (
          <p className="px-3 py-3.5 text-sm text-ink-faint">{t('usage.noAgent')}</p>
        ) : null}
      </div>

      {/* Une seule ancienneté, celle de la plus ancienne lecture affichée : répétée
          sous chaque section, elle dirait trois fois la même chose à une seconde près. */}
      {fetchedAt === null ? null : (
        <footer
          className="shrink-0 border-t border-line px-3 py-2 text-meta text-ink-faint"
          title={new Date(fetchedAt).toLocaleString(locale())}
        >
          {t('usage.readAt', { age: readAge(fetchedAt) })}
        </footer>
      )}
    </>
  )
}

export function UsagePanel({
  agent,
  account = null,
  open,
  onOpenChange,
}: {
  /** CLI mis en tête. Omis depuis le compte, qui n'en privilégie aucun. */
  agent?: AgentKind
  /** Compte Claude supplémentaire du fil, dont on lit la consommation à la place de celle du CLI. */
  account?: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="scrim z-40" />
        {/* Monté à l'ouverture, démonté à la fermeture par le portail de Radix : c'est
            ce qui fait qu'ouvrir relit, sans dépendre d'une durée de fraîcheur côté
            client. */}
        <Dialog.Content
          className={cx(
            'surface fixed z-50 flex flex-col overflow-hidden border-line shadow-pop',
            'inset-0 border-0',
            'sm:inset-auto sm:top-1/2 sm:left-1/2 sm:max-h-[90dvh] sm:w-[min(26rem,92vw)]',
            'sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-lg sm:border',
          )}
        >
          <UsageDialog agent={agent} account={account} onClose={() => onOpenChange(false)} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
