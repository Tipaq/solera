/* PROTOTYPE — jetable (branche proto/page-projet). Ne pas fusionner dans main.
 *
 * Les petites pièces que les quatre variantes de style se partagent. Elles ne décident
 * d'aucune mise en page : une pastille, une dérive, un anneau, une bande de vagues.
 */
import { Check, GitPullRequest } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import type { PullRequestBadgeState } from '@solera/protocol'
import { cx } from '@solera/ui'
import { openInboxItem } from '../../../components/prototype/AskInbox'
import { AgentIcon } from '../../../components/AgentIcon'
import { STATE_DOT } from '../../prototype-milestones/model'
import { MATURITY_LABEL, type Maturity } from '../../prototype-milestones/maturity'
import type { SessionTone, V2Ask, V2Session, V2Wave } from './data'

/* ------------------------------------------------------------------ libellés */

export const PR_LABEL: Record<PullRequestBadgeState, string> = {
  draft: 'Brouillon',
  checks: 'CI en cours',
  failing: 'CI rouge',
  ready: 'Prête',
  merged: 'Fusionnée',
}

export const PR_TEXT: Record<PullRequestBadgeState, string> = {
  draft: 'text-ink-faint',
  checks: 'text-ink-soft',
  failing: 'text-critical',
  ready: 'text-positive',
  merged: 'text-ink-faint',
}

export const SESSION_DOT: Record<SessionTone, string> = {
  running: 'bg-accent',
  awaiting: 'bg-caution',
  broken: 'bg-critical',
  quiet: 'bg-line-strong',
}

export const SESSION_WORD: Record<SessionTone, string> = {
  running: 'tourne',
  awaiting: "t'attend",
  broken: 'en erreur',
  quiet: 'au repos',
}

export const ASK_DOT: Record<V2Ask['kind'], string> = {
  awaiting: 'bg-caution',
  broken: 'bg-critical',
  'review-card': 'bg-accent',
  'review-pr': 'bg-positive',
}

/** La teinte du texte d'une maturité : une seule couleur par étape, et sobre. */
export const MATURITY_TEXT: Record<Maturity, string> = {
  idea: 'text-ink-faint',
  refine: 'text-caution',
  split: 'text-ink-soft',
  ready: 'text-positive',
  launched: 'text-accent',
  delivered: 'text-positive',
}

export const MATURITY_DOT: Record<Maturity, string> = {
  idea: 'bg-line-strong',
  refine: 'bg-caution',
  split: 'bg-ink-faint',
  ready: 'bg-positive',
  launched: 'bg-accent',
  delivered: 'bg-positive',
}

/* ------------------------------------------------------------------ pièces */

/** Un lien interne ou externe, sans habillage : la ligne qui le porte décide. */
export function Go({ to, external, className, children, title }: { to: string; external?: boolean; className?: string; children: ReactNode; title?: string }) {
  if (external) {
    return (
      <a href={to} target="_blank" rel="noreferrer" className={className} title={title}>
        {children}
      </a>
    )
  }
  return (
    <Link to={to} className={className} title={title}>
      {children}
    </Link>
  )
}

/** La maturité en texte, précédée de son point : lisible sans pastille pleine. */
export function MaturityTag({ maturity, className }: { maturity: Maturity; className?: string }) {
  return (
    <span className={cx('inline-flex items-center gap-1.5 text-xs font-medium', MATURITY_TEXT[maturity], className)}>
      <span aria-hidden className={cx('size-1.5 rounded-full', MATURITY_DOT[maturity])} />
      {MATURITY_LABEL[maturity]}
    </span>
  )
}

/** ↑ en avance, ↓ en retard sur la branche par défaut, ● fichiers modifiés. */
export function Drift({ ahead, behind, dirty, conflicts }: { ahead: number; behind: number; dirty: number; conflicts: boolean }) {
  const parts: ReactNode[] = []
  if (ahead) parts.push(<span key="a" title={`${ahead} commit(s) d'avance`}>↑{ahead}</span>)
  if (behind) parts.push(<span key="b" title={`${behind} commit(s) de retard`} className={behind > 2 ? 'text-caution' : undefined}>↓{behind}</span>)
  if (dirty) parts.push(<span key="d" title={`${dirty} fichier(s) modifié(s)`}>●{dirty}</span>)
  if (conflicts) parts.push(<span key="c" className="text-critical">conflit</span>)
  if (parts.length === 0) return <span className="text-ink-faint">à jour</span>
  return <span className="inline-flex gap-2 tabular-nums">{parts}</span>
}

/** Une PR en une ligne : l'icône, le numéro, l'état en toutes lettres. */
export function PrTag({ pr }: { pr: { number: number; url: string; state: PullRequestBadgeState } | null }) {
  if (!pr) return <span className="text-xs text-ink-faint">pas de PR</span>
  return (
    <a
      href={pr.url}
      target="_blank"
      rel="noreferrer"
      onClick={(event) => event.stopPropagation()}
      className={cx('inline-flex items-center gap-1 text-xs hover:underline', PR_TEXT[pr.state])}
    >
      <GitPullRequest size={12} className="shrink-0" />
      <span className="tabular-nums">#{pr.number}</span>
      <span>{PR_LABEL[pr.state]}</span>
    </a>
  )
}

/** Les sessions d'une ligne : l'agent, avec le point de son état en exposant. */
export function SessionStack({ sessions, max = 3 }: { sessions: V2Session[]; max?: number }) {
  if (sessions.length === 0) return null
  return (
    <span className="inline-flex items-center gap-1">
      {sessions.slice(0, max).map((session) => (
        <Link
          key={session.id}
          to={session.to}
          title={`${session.title} — ${SESSION_WORD[session.tone]}`}
          onClick={(event) => event.stopPropagation()}
          className="relative inline-flex size-6 items-center justify-center rounded-full bg-surface-high hover:bg-line"
        >
          <AgentIcon agent={session.agent} size={13} decorative />
          <span
            aria-hidden
            className={cx(
              'absolute -top-0.5 -right-0.5 size-2 rounded-full ring-2 ring-canvas',
              SESSION_DOT[session.tone],
              session.tone === 'running' && 'animate-pulse',
            )}
          />
        </Link>
      ))}
      {sessions.length > max ? <span className="text-meta text-ink-faint">+{sessions.length - max}</span> : null}
    </span>
  )
}

/** Un anneau d'avancement, en `currentColor` pour suivre le thème. */
export function Ring({ value, size = 64, stroke = 6, children }: { value: number; size?: number; stroke?: number; children?: ReactNode }) {
  const radius = (size - stroke) / 2
  const length = 2 * Math.PI * radius
  return (
    <span className="relative inline-flex shrink-0 items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" strokeWidth={stroke} className="stroke-surface-high" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${length * value} ${length}`}
          className="stroke-accent transition-[stroke-dasharray]"
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center">{children}</span>
    </span>
  )
}

/** Une barre d'avancement fine. */
export function Bar({ value, className }: { value: number; className?: string }) {
  return (
    <div className={cx('h-1 overflow-hidden rounded-full bg-surface-high', className)}>
      <div className="h-full rounded-full bg-accent" style={{ width: `${Math.round(value * 100)}%` }} />
    </div>
  )
}

/**
 * Les vagues d'un jalon, résumées : une colonne par vague, un carré par carte, de la
 * couleur de son état. Un survol nomme la carte ; un clic ouvre sa session.
 */
export function WaveStrip({ waves, size = 'md', labels = true }: { waves: V2Wave[]; size?: 'sm' | 'md' | 'lg'; labels?: boolean }) {
  if (waves.length === 0) return <span className="text-xs text-ink-faint">Pas encore découpé</span>
  const cell = size === 'lg' ? 'size-4' : size === 'md' ? 'size-3' : 'size-2'
  return (
    <div className="flex items-end gap-4">
      {waves.map((wave, index) => (
        <div key={wave.index} className="flex items-end gap-4">
          <div className="flex flex-col items-start gap-1.5">
            <div className="flex max-w-[7rem] flex-wrap gap-1">
              {wave.cards.map(({ card, state, to }) => (
                <Link
                  key={card.id}
                  to={to}
                  title={`#${card.number} ${card.title}`}
                  className={cx(cell, 'rounded-[3px] transition-transform hover:scale-125', STATE_DOT[state], state === 'running' && 'animate-pulse')}
                />
              ))}
            </div>
            {labels ? <span className="text-meta text-ink-faint tabular-nums">V{index + 1}</span> : null}
          </div>
          {index < waves.length - 1 ? <span aria-hidden className="mb-5 h-px w-4 bg-line-strong" /> : null}
        </div>
      ))}
    </div>
  )
}

/** Le calme : rien n'attend. Une ligne, pas une tuile vide. */
export function Calm({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm text-ink-faint">
      <Check size={14} className="text-positive" />
      {children}
    </span>
  )
}

/**
 * Une ligne entièrement cliquable qui contient d'autres liens (sessions, PR) : un `<a>`
 * ne peut pas en contenir un autre, donc la ligne navigue par un clic et par Entrée.
 */
export function ClickRow({ to, external, className, children }: { to: string; external?: boolean; className?: string; children: ReactNode }) {
  const navigate = useNavigate()
  const go = () => (external ? window.open(to, '_blank', 'noreferrer') : navigate(to))
  return (
    <div
      role="link"
      tabIndex={0}
      onClick={go}
      onKeyDown={(event) => {
        if (event.key === 'Enter') go()
      }}
      className={cx('cursor-pointer focus-visible:outline-2 focus-visible:outline-accent', className)}
    >
      {children}
    </div>
  )
}

/**
 * Le repère d'un jalon qui attend Tim : un point ambre et « N t'attend ». Il ne redit pas
 * la demande — elle vit dans « Ce qui t'attend » — il y mène et la déplie.
 */
export function WaitingMark({ waiting, className }: { waiting: { count: number; key: string }; className?: string }) {
  return (
    <button
      type="button"
      onClick={() => openInboxItem(waiting.key)}
      className={cx('inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium text-caution ring-1 ring-caution/40 transition-colors ring-inset hover:bg-caution/10', className)}
    >
      <span aria-hidden className="size-1.5 rounded-full bg-caution" />
      {waiting.count} t'attend
    </button>
  )
}
