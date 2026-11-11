/* PROTOTYPE — jetable (branche proto/page-projet). Ne pas fusionner dans main.
 *
 * « Ce qui t'attend », réponse sur place (décidé le 2026-11-11) : une seule liste pour
 * toutes les sessions qui ont besoin de Tim, étiquetées par leur jalon, avec de quoi
 * trancher sans ouvrir le fil. Les vraies sessions répondent par les mêmes routes que
 * l'Activité (`SessionRequestBody`) ; en démo, par le magasin.
 *
 * Resserrée le 2026-11-11 (« trop gros par rapport au reste ») : une ligne par demande,
 * la réponse ne se déplie qu'au geste, une à la fois, trois lignes visibles avant
 * « N de plus ». Le bloc ne se teinte pas : un point ambre par ligne suffit.
 */
import { ArrowRight, ArrowUpRight, Check, ChevronDown, Flag, GitMerge, GitPullRequest, ListTree, MessageCircleQuestion, TriangleAlert } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { AgentKind } from '@solera/protocol'
import { Button, cx } from '@solera/ui'
import { AgentIcon } from '../AgentIcon'
import { SessionRequestBody } from '../project/SessionRequestPreview'
import { elapsed } from '../../lib/dates'
import type { SessionRequest } from '../../lib/session-requests'

export interface InboxMilestone {
  number: number
  title: string
  to: string
}

export type InboxReply =
  | { type: 'real'; conversationId: string; request: SessionRequest | null; canDecide: boolean }
  | { type: 'demo'; question: string; onAnswer: (text: string) => void }

export type InboxItem =
  | {
      kind: 'session'
      key: string
      title: string
      agent: AgentKind
      tone: 'awaiting' | 'broken'
      since: number | null
      milestone: InboxMilestone | null
      cardNumber: number | null
      /** Le fil de la session. */
      open: string
      reply: InboxReply
    }
  | {
      kind: 'refine'
      key: string
      milestone: InboxMilestone
      questions: { id: string; text: string }[]
      onAnswer: (id: string, text: string) => void
    }
  | {
      kind: 'draft'
      key: string
      milestone: InboxMilestone
      cards: { key: string; title: string; after: string[] }[]
      onValidate: () => void
    }
  | { kind: 'merge'; key: string; milestone: InboxMilestone; branch: string; onMerge: () => void }
  | {
      kind: 'light'
      key: string
      tone: 'review-card' | 'review-pr'
      title: string
      detail: string
      to: string
      external: boolean
      since: number | null
    }

/** Lignes visibles avant « N de plus ». */
const SHOWN = 3

const OPEN_EVENT = 'proto-inbox-open'

/**
 * Déplie une demande depuis ailleurs (le repère « 1 t'attend » d'un jalon) : la liste
 * s'ouvre, fait défiler jusqu'à la ligne et la déplie. La règle « une seule liste »
 * veut que le jalon montre un repère, pas une seconde boîte de réponse.
 */
export function openInboxItem(key: string) {
  window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: key }))
}

/** Le jalon d'une demande, pour compter ce qui attend dans chacun. */
export function inboxMilestoneNumber(item: InboxItem): number | null {
  if (item.kind === 'light') return null
  return item.milestone?.number ?? null
}

/** Ce qui demande une réponse, par opposition à ce qui demande un coup d'œil. */
function isHeavy(item: InboxItem): boolean {
  return item.kind !== 'light'
}

/**
 * La liste. `bare` la pose sans titre, pour une tuile qui porte déjà le sien.
 * Repliée, elle tient en une ligne qui dit combien et quoi.
 */
export function AskInbox({ items, bare = false, className }: { items: InboxItem[]; bare?: boolean; className?: string }) {
  const [folded, setFolded] = useState(false)
  const [all, setAll] = useState(false)
  // Une seule réponse dépliée à la fois.
  const [open, setOpen] = useState<string | null>(null)

  // Les lourdes d'abord : ce qui demande une réponse passe avant ce qui demande un œil.
  const ordered = [...items.filter(isHeavy), ...items.filter((item) => !isHeavy(item))]
  const heavy = ordered.filter(isHeavy).length
  const light = ordered.length - heavy

  useEffect(() => {
    const onOpen = (event: Event) => {
      const key = (event as CustomEvent<string>).detail
      const index = ordered.findIndex((item) => item.key === key)
      if (index < 0) return
      setFolded(false)
      if (index >= SHOWN) setAll(true)
      setOpen(key)
      requestAnimationFrame(() => document.getElementById(`inbox-${key}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }))
    }
    window.addEventListener(OPEN_EVENT, onOpen)
    return () => window.removeEventListener(OPEN_EVENT, onOpen)
  })

  if (items.length === 0) {
    return (
      <p className={cx('flex items-center gap-2 text-sm text-ink-faint', className)}>
        <span className="flex size-5 items-center justify-center rounded-full bg-positive/15 text-positive">
          <Check size={12} />
        </span>
        Rien ne t'attend.
      </p>
    )
  }

  const summary = [
    heavy ? `${heavy} ${heavy > 1 ? 'demandes' : 'demande'}` : null,
    light ? `${light} à relire` : null,
  ]
    .filter(Boolean)
    .join(' · ')
  // Une ligne dépliée au-delà des trois premières reste visible.
  const openIndex = ordered.findIndex((item) => item.key === open)
  const visible = all || openIndex >= SHOWN ? ordered : ordered.slice(0, SHOWN)
  const hidden = ordered.length - visible.length

  return (
    <section aria-label="Ce qui t'attend" className={cx('flex flex-col gap-1.5', className)}>
      {bare ? null : (
        <button
          type="button"
          onClick={() => setFolded((value) => !value)}
          aria-expanded={!folded}
          className="group flex items-center gap-2 self-start rounded-md text-left"
        >
          <span className="text-xs font-medium text-ink-faint group-hover:text-ink-soft">Ce qui t'attend</span>
          <span className="inline-flex items-center gap-1.5 text-xs text-ink-soft tabular-nums">
            {heavy ? <span aria-hidden className="size-1.5 rounded-full bg-caution" /> : null}
            {summary}
          </span>
          <ChevronDown size={13} className={cx('text-ink-faint transition-transform group-hover:text-ink', folded && '-rotate-90')} />
        </button>
      )}
      {folded ? null : (
        <>
          <ul className="flex flex-col">
            {visible.map((item) => (
              <li key={item.key} id={`inbox-${item.key}`} className="scroll-mt-24">
                {item.kind === 'light' ? (
                  <LightRow item={item} />
                ) : (
                  <HeavyRow item={item} open={open === item.key} onToggle={() => setOpen((current) => (current === item.key ? null : item.key))} onDone={() => setOpen(null)} />
                )}
              </li>
            ))}
          </ul>
          {hidden > 0 || all ? (
            <button
              type="button"
              onClick={() => setAll((value) => !value)}
              className="self-start rounded px-2 text-xs text-ink-faint hover:text-ink"
            >
              {all ? 'Montrer moins' : `${hidden} de plus`}
            </button>
          ) : null}
        </>
      )}
    </section>
  )
}

/* ------------------------------------------------------------------ une ligne */

const ROW = 'group flex min-h-10 min-w-0 items-center gap-2.5 rounded-lg px-2 -mx-2'

function MilestoneChip({ milestone }: { milestone: InboxMilestone | null }) {
  if (!milestone) return null
  return (
    <Link
      to={milestone.to}
      title={milestone.title}
      onClick={(event) => event.stopPropagation()}
      className="hidden shrink-0 items-center gap-1 rounded-full bg-surface-high px-1.5 py-0.5 text-meta text-ink-soft hover:bg-line hover:text-ink sm:inline-flex"
    >
      <Flag size={10} />
      Jalon #{milestone.number}
    </Link>
  )
}

function Age({ at }: { at: number | null }) {
  if (!at) return null
  return <span className="hidden shrink-0 text-xs text-ink-faint tabular-nums sm:inline">{elapsed(at)}</span>
}

/** Ce que la ligne dit d'une demande : son signe, son titre, sa question en gris, son geste. */
function describe(item: Exclude<InboxItem, { kind: 'light' }>): { icon: ReactNode; title: string; hint: string; gesture: string; milestone: InboxMilestone | null; since: number | null } {
  switch (item.kind) {
    case 'session':
      return {
        icon: (
          <span className="relative shrink-0">
            <AgentIcon agent={item.agent} size={14} decorative />
            <span aria-hidden className={cx('absolute -right-0.5 -bottom-0.5 size-1.5 rounded-full ring-2 ring-canvas', item.tone === 'broken' ? 'bg-critical' : 'bg-caution')} />
          </span>
        ),
        title: item.cardNumber !== null ? `#${item.cardNumber} ${item.title}` : item.title,
        hint:
          item.tone === 'broken'
            ? 'La session s’est arrêtée'
            : item.reply.type === 'demo'
              ? item.reply.question
              : 'Elle attend ta réponse',
        gesture: item.tone === 'broken' ? 'Voir' : 'Répondre',
        milestone: item.milestone,
        since: item.since,
      }
    case 'refine':
      return {
        icon: <MessageCircleQuestion size={14} className="shrink-0 text-caution" />,
        title: `${item.questions.length} question${item.questions.length > 1 ? 's' : ''} d'affinage`,
        hint: item.questions[0]?.text ?? '',
        gesture: 'Répondre',
        milestone: item.milestone,
        since: null,
      }
    case 'draft':
      return {
        icon: <ListTree size={14} className="shrink-0 text-accent" />,
        title: `Découpage proposé : ${item.cards.length} cartes`,
        hint: item.cards.map((card) => card.title).join(' · '),
        gesture: 'Examiner',
        milestone: item.milestone,
        since: null,
      }
    case 'merge':
      return {
        icon: <GitMerge size={14} className="shrink-0 text-positive" />,
        title: 'PR du jalon prête',
        hint: `${item.branch} → main`,
        gesture: 'Fusionner',
        milestone: item.milestone,
        since: null,
      }
  }
}

function HeavyRow({
  item,
  open,
  onToggle,
  onDone,
}: {
  item: Exclude<InboxItem, { kind: 'light' }>
  open: boolean
  onToggle: () => void
  onDone: () => void
}) {
  const line = describe(item)
  return (
    <div className={cx('flex flex-col rounded-lg', open && 'bg-surface')}>
      <div className={cx(ROW, !open && 'hover:bg-surface')}>
        {/* Pas de `flex-1` sur l'indice : il prendrait toute la largeur et rejetterait
            l'étiquette et le geste au bord de l'écran, loin de la ligne qu'ils servent. */}
        <button type="button" onClick={onToggle} aria-expanded={open} className="flex min-w-0 items-center gap-2.5 text-left">
          {line.icon}
          <span className="max-w-[18rem] shrink-0 truncate text-sm text-ink">{line.title}</span>
          <span className="hidden min-w-0 truncate text-sm text-ink-faint md:block">{line.hint}</span>
        </button>
        <MilestoneChip milestone={line.milestone} />
        <Age at={line.since} />
        <button
          type="button"
          onClick={onToggle}
          className={cx(
            'shrink-0 rounded-md px-2 py-1 text-xs font-medium transition-colors',
            open ? 'text-ink-faint hover:text-ink' : 'text-accent hover:bg-accent-wash/50',
          )}
        >
          {open ? 'Fermer' : line.gesture}
        </button>
      </div>
      {open ? (
        <div className="flex flex-col gap-3 px-2 pt-1 pb-3 sm:pl-8">
          <Reply item={item} onDone={onDone} />
        </div>
      ) : null}
    </div>
  )
}

/** Ce qui se déplie : de quoi trancher sans ouvrir le fil. */
function Reply({ item, onDone }: { item: Exclude<InboxItem, { kind: 'light' }>; onDone: () => void }) {
  switch (item.kind) {
    case 'session': {
      const { reply } = item
      const open = (
        <Link to={item.open} className="inline-flex items-center gap-1 self-start text-xs text-ink-faint hover:text-ink">
          Ouvrir le fil <ArrowRight size={12} />
        </Link>
      )
      if (reply.type === 'demo') {
        return (
          <>
            <p className="text-sm text-ink">{reply.question}</p>
            <ReplyField
              placeholder="Répondre à la session…"
              onSend={(text) => {
                reply.onAnswer(text)
                onDone()
              }}
            />
            {open}
          </>
        )
      }
      if (item.tone === 'broken' || !reply.request) {
        return (
          <>
            <p className="flex items-center gap-2 text-sm text-ink-soft">
              <TriangleAlert size={14} className="shrink-0 text-critical" />
              {item.tone === 'broken' ? 'La session s’est arrêtée. Ouvre-la pour la relancer.' : 'Elle attend dans son fil.'}
            </p>
            {open}
          </>
        )
      }
      // La vraie réponse : la ligne disparaît d'elle-même quand la demande est levée.
      return (
        <>
          <SessionRequestBody conversationId={reply.conversationId} request={reply.request} canDecide={reply.canDecide} />
          {open}
        </>
      )
    }
    case 'refine':
      return (
        <ul className="flex flex-col gap-3">
          {item.questions.map((question) => (
            <li key={question.id} className="flex flex-col gap-1.5">
              <p className="text-sm text-ink">{question.text}</p>
              <ReplyField
                placeholder="Ta réponse…"
                onSend={(text) => {
                  item.onAnswer(question.id, text)
                  // La dernière question répondue referme la ligne ; avant, on enchaîne.
                  if (item.questions.length === 1) onDone()
                }}
              />
            </li>
          ))}
        </ul>
      )
    case 'draft':
      return (
        <>
          <ol className="flex flex-col gap-1 text-sm">
            {item.cards.map((card, index) => (
              <li key={card.key} className="flex min-w-0 items-baseline gap-2">
                <span className="w-4 shrink-0 text-right text-xs text-ink-faint tabular-nums">{index + 1}</span>
                <span className="min-w-0 truncate text-ink">{card.title}</span>
                {card.after.length ? (
                  <span className="shrink-0 text-xs text-ink-faint">
                    après {card.after.map((key) => item.cards.findIndex((entry) => entry.key === key) + 1).join(', ')}
                  </span>
                ) : null}
              </li>
            ))}
          </ol>
          <div className="flex items-center gap-3">
            <Button
              size="sm"
              icon={<Check size={14} />}
              onClick={() => {
                item.onValidate()
                onDone()
              }}
            >
              Valider
            </Button>
            <Link to={item.milestone.to} className="text-xs text-ink-faint hover:text-ink">
              Corriger dans le jalon
            </Link>
          </div>
        </>
      )
    case 'merge':
      return (
        <>
          <p className="text-sm text-ink-soft">
            Toutes les cartes sont fusionnées dans <code className="text-code">{item.branch}</code>. Il reste à la fusionner dans la branche par défaut.
          </p>
          <div>
            <Button
              size="sm"
              icon={<GitMerge size={14} />}
              onClick={() => {
                item.onMerge()
                onDone()
              }}
            >
              Fusionner dans main
            </Button>
          </div>
        </>
      )
  }
}

/** Un champ d'une ligne qui s'agrandit, Entrée pour envoyer, Maj+Entrée pour aller à la ligne. */
function ReplyField({ placeholder, onSend }: { placeholder: string; onSend: (text: string) => void }) {
  const [text, setText] = useState('')
  const send = () => {
    const value = text.trim()
    if (!value) return
    onSend(value)
    setText('')
  }
  return (
    <div className="flex items-end gap-2">
      <textarea
        rows={1}
        autoFocus
        value={text}
        placeholder={placeholder}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault()
            send()
          }
        }}
        className="field-sizing-content max-h-32 min-h-9 min-w-0 flex-1 resize-none rounded-lg border border-line bg-canvas px-3 py-2 text-sm outline-none placeholder:text-ink-faint focus:border-accent"
      />
      <Button size="sm" disabled={!text.trim()} onClick={send}>
        Envoyer
      </Button>
    </div>
  )
}

/* ------------------------------------------------------------------ un coup d'œil */

function LightRow({ item }: { item: Extract<InboxItem, { kind: 'light' }> }) {
  const body = (
    <>
      {item.tone === 'review-pr' ? (
        <GitPullRequest size={14} className="shrink-0 text-positive" />
      ) : (
        <span aria-hidden className="mx-[3.5px] size-[7px] shrink-0 rounded-full bg-accent" />
      )}
      <span className="max-w-[18rem] shrink-0 truncate text-sm text-ink">{item.title}</span>
      <span className="hidden min-w-0 truncate text-sm text-ink-faint md:block">{item.detail}</span>
      <span className="flex shrink-0 items-center gap-3">
        <Age at={item.since} />
        <span className="inline-flex items-center gap-1 px-2 text-xs font-medium text-ink-soft group-hover:text-ink">
          {item.tone === 'review-pr' ? 'Ouvrir la PR' : 'Relire'}
          {item.external ? <ArrowUpRight size={12} /> : <ArrowRight size={12} />}
        </span>
      </span>
    </>
  )
  const shape = cx(ROW, 'hover:bg-surface')
  return item.external ? (
    <a href={item.to} target="_blank" rel="noreferrer" className={shape}>
      {body}
    </a>
  ) : (
    <Link to={item.to} className={shape}>
      {body}
    </Link>
  )
}
