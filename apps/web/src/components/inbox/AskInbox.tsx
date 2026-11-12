import {
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronDown,
  Flag,
  GitMerge,
  GitPullRequest,
  ListTree,
  MessageCircleQuestion,
  TriangleAlert,
} from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Button, cx } from '@solera/ui'
import { AgentIcon } from '../AgentIcon'
import { SessionRequestBody } from '../project/SessionRequestPreview'
import { elapsed } from '../../lib/dates'
import { useTranslate } from '../../lib/i18n'
import {
  inboxSummary,
  isHeavy,
  type HeavyInboxItem,
  type InboxItem,
  type InboxMilestone,
  type LightInboxItem,
} from '../../lib/inbox'
import { requestSummary } from '../../lib/session-request-summary'

/** Lignes visibles avant « N de plus ». */
const SHOWN = 3

const OPEN_EVENT = 'solera:inbox-open'

/**
 * Déplie une demande depuis ailleurs — le repère « 1 t'attend » d'un jalon (INB-13) : la
 * liste s'ouvre, montre tout s'il le faut, déplie la ligne et la fait défiler au centre.
 * La règle « une seule liste » veut que le jalon montre un repère, pas une seconde boîte.
 */
export function openInboxItem(key: string): void {
  window.dispatchEvent(new CustomEvent<string>(OPEN_EVENT, { detail: key }))
}

/**
 * « Ce qui t'attend » (#163) : une ligne par demande, la réponse sur place.
 *
 * Une seule réponse dépliée à la fois, trois lignes visibles avant « N de plus ». Le bloc
 * ne se teinte pas : un point ambre par ligne suffit. `bare` la pose sans en-tête, pour
 * une tuile qui porte déjà son titre.
 *
 * Une ligne se replie selon la largeur de la liste, pas de l'écran : posée dans une
 * colonne étroite (la vue « Par état »), elle ne garde que son titre et son geste.
 */
export function AskInbox({ items, bare = false, className }: { items: InboxItem[]; bare?: boolean; className?: string }) {
  const t = useTranslate()
  const [folded, setFolded] = useState(false)
  const [all, setAll] = useState(false)
  const [open, setOpen] = useState<string | null>(null)

  // Le constructeur range déjà les lourdes avant les légères ; la liste le garantit
  // pour des éléments venus d'ailleurs.
  const ordered = [...items.filter(isHeavy), ...items.filter((item) => !isHeavy(item))]

  useEffect(() => {
    const onOpen = (event: Event) => {
      const key = (event as CustomEvent<string>).detail
      const index = ordered.findIndex((item) => item.key === key)
      if (index < 0) return
      setFolded(false)
      if (index >= SHOWN) setAll(true)
      setOpen(key)
      requestAnimationFrame(() =>
        document.getElementById(rowId(key))?.scrollIntoView({ block: 'center', behavior: 'smooth' }),
      )
    }
    window.addEventListener(OPEN_EVENT, onOpen)
    return () => window.removeEventListener(OPEN_EVENT, onOpen)
  })

  if (items.length === 0) {
    return (
      <section aria-label={t('inbox.title')} className={className}>
        <p className="flex items-center gap-2 text-sm text-ink-faint">
          <span className="flex size-5 items-center justify-center rounded-full bg-positive/15 text-positive">
            <Check size={12} aria-hidden />
          </span>
          {t('inbox.empty')}
        </p>
      </section>
    )
  }

  const { requests, review } = inboxSummary(ordered)
  const summary = [
    requests ? t(requests > 1 ? 'inbox.summary.requests.many' : 'inbox.summary.requests.one', { count: requests }) : null,
    review ? t('inbox.summary.review', { count: review }) : null,
  ]
    .filter(Boolean)
    .join(t('inbox.summary.joiner'))
  // Une ligne dépliée au-delà des trois premières reste visible, sous les trois.
  const openIndex = ordered.findIndex((item) => item.key === open)
  const visible = all
    ? ordered
    : [...ordered.slice(0, SHOWN), ...(openIndex >= SHOWN ? [ordered[openIndex]!] : [])]
  const hidden = ordered.length - visible.length

  return (
    <section aria-label={t('inbox.title')} className={cx('@container flex flex-col gap-1.5', className)}>
      {bare ? null : (
        <button
          type="button"
          onClick={() => setFolded((value) => !value)}
          aria-expanded={!folded}
          className="group flex items-center gap-2 self-start rounded-md text-left"
        >
          <span className="text-xs font-medium text-ink-faint group-hover:text-ink-soft">{t('inbox.title')}</span>
          <span className="inline-flex items-center gap-1.5 text-xs text-ink-soft tabular-nums">
            {requests ? <span aria-hidden className="size-1.5 rounded-full bg-caution" /> : null}
            {summary}
          </span>
          <ChevronDown
            size={13}
            aria-hidden
            className={cx('text-ink-faint transition-transform group-hover:text-ink', folded && '-rotate-90')}
          />
        </button>
      )}
      {folded ? null : (
        <>
          <ul className="flex flex-col">
            {visible.map((item) => (
              <li key={item.key} id={rowId(item.key)} className="scroll-mt-24">
                {item.kind === 'light' ? (
                  <LightRow item={item} />
                ) : (
                  <HeavyRow
                    item={item}
                    open={open === item.key}
                    onToggle={() => setOpen((current) => (current === item.key ? null : item.key))}
                    onDone={() => setOpen(null)}
                  />
                )}
              </li>
            ))}
          </ul>
          {hidden > 0 || all ? (
            <button
              type="button"
              onClick={() => setAll((value) => !value)}
              className="self-start rounded px-2 text-xs text-ink-faint hover:text-ink pointer-coarse:min-h-11"
            >
              {all ? t('inbox.less') : t('inbox.more', { count: hidden })}
            </button>
          ) : null}
        </>
      )}
    </section>
  )
}

function rowId(key: string): string {
  return `inbox-${key}`
}

/* ------------------------------------------------------------------ une ligne */

const ROW = 'group -mx-2 flex min-h-10 min-w-0 items-center gap-2.5 rounded-lg px-2'

function MilestoneChip({ milestone }: { milestone: InboxMilestone | null }) {
  const t = useTranslate()
  if (!milestone) return null
  return (
    <Link
      to={milestone.to}
      title={milestone.title}
      // L'étiquette mène au jalon : elle n'ouvre pas la ligne.
      onClick={(event) => event.stopPropagation()}
      className="hidden shrink-0 items-center gap-1 rounded-full bg-surface-high px-1.5 py-0.5 text-meta text-ink-soft hover:bg-line hover:text-ink @sm:inline-flex"
    >
      <Flag size={10} aria-hidden />
      {t('inbox.milestone', { number: milestone.number })}
    </Link>
  )
}

function Age({ at }: { at: number | null }) {
  if (!at) return null
  return <span className="hidden shrink-0 text-xs text-ink-faint tabular-nums @sm:inline">{elapsed(at)}</span>
}

function withProject(t: ReturnType<typeof useTranslate>, project: string | null, title: string): string {
  return project ? t('inbox.withProject', { project, title }) : title
}

/** Ce que la ligne dit d'une demande : son signe, son titre, son indice en gris, son geste. */
function describe(
  item: HeavyInboxItem,
  t: ReturnType<typeof useTranslate>,
): { icon: ReactNode; title: string; hint: string; gesture: string; since: number | null } {
  switch (item.kind) {
    case 'session': {
      const title = item.cardNumber !== null ? t('inbox.cardTitle', { number: item.cardNumber, title: item.title }) : item.title
      return {
        icon: (
          <span className="relative shrink-0">
            <AgentIcon agent={item.agent} size={14} decorative />
            <span
              aria-hidden
              className={cx(
                'absolute -right-0.5 -bottom-0.5 size-1.5 rounded-full ring-2 ring-canvas',
                item.tone === 'broken' ? 'bg-critical' : 'bg-caution',
              )}
            />
          </span>
        ),
        title: withProject(t, item.project, title),
        // La question elle-même, quand le journal la dit (INB-7).
        hint:
          item.tone === 'broken'
            ? t('inbox.hint.stopped')
            : item.request
              ? requestSummary(item.request, t)
              : t('inbox.hint.awaiting'),
        gesture: t(item.tone === 'broken' ? 'inbox.gesture.see' : 'inbox.gesture.reply'),
        since: item.since,
      }
    }
    case 'refine':
      return {
        icon: <MessageCircleQuestion size={14} aria-hidden className="shrink-0 text-caution" />,
        title: t(item.questions.length > 1 ? 'inbox.refine.title.many' : 'inbox.refine.title.one', {
          count: item.questions.length,
        }),
        hint: item.questions[0]?.text ?? '',
        gesture: t('inbox.gesture.reply'),
        since: null,
      }
    case 'draft':
      return {
        icon: <ListTree size={14} aria-hidden className="shrink-0 text-accent" />,
        title: t('inbox.draft.title', { count: item.cards.length }),
        hint: item.cards.map((card) => card.title).join(t('inbox.summary.joiner')),
        gesture: t('inbox.gesture.examine'),
        since: null,
      }
    case 'merge':
      return {
        icon: <GitMerge size={14} aria-hidden className="shrink-0 text-positive" />,
        title: t('inbox.merge.title'),
        hint: t('inbox.merge.hint', { branch: item.branch, base: item.base }),
        gesture: t('inbox.gesture.merge'),
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
  item: HeavyInboxItem
  open: boolean
  onToggle: () => void
  onDone: () => void
}) {
  const t = useTranslate()
  const line = describe(item, t)
  return (
    <div className={cx('flex flex-col rounded-lg', open && 'bg-surface')}>
      <div className={cx(ROW, !open && 'hover:bg-surface')}>
        {/* Pas de `flex-1` sur l'indice : il prendrait toute la largeur et rejetterait
            l'étiquette et le geste au bord de l'écran, loin de la ligne qu'ils servent. */}
        <button type="button" onClick={onToggle} aria-expanded={open} className="flex min-w-0 items-center gap-2.5 text-left">
          {line.icon}
          <span className="min-w-0 max-w-[18rem] truncate @xl:shrink-0 text-sm text-ink">{line.title}</span>
          <span className="hidden min-w-0 truncate text-sm text-ink-faint @xl:block">{line.hint}</span>
        </button>
        <MilestoneChip milestone={item.milestone} />
        <Age at={line.since} />
        {/* Nu, comme le titre : le geste déplie la même ligne, il n'est pas une action à
            part. Au doigt, il garde la cible de 44 px. */}
        <button
          type="button"
          onClick={onToggle}
          className={cx(
            'shrink-0 rounded-md px-2 py-1 text-xs font-medium transition-colors pointer-coarse:min-h-11',
            open ? 'text-ink-faint hover:text-ink' : 'text-accent hover:bg-accent-wash/50',
          )}
        >
          {open ? t('inbox.gesture.close') : line.gesture}
        </button>
      </div>
      {open ? (
        <div className="flex flex-col gap-3 px-2 pt-1 pb-3 @sm:pl-8">
          <Reply item={item} onDone={onDone} />
        </div>
      ) : null}
    </div>
  )
}

/** Ce qui se déplie : de quoi trancher sans ouvrir le fil. */
function Reply({ item, onDone }: { item: HeavyInboxItem; onDone: () => void }) {
  const t = useTranslate()
  switch (item.kind) {
    case 'session': {
      const thread = (
        <Link to={item.threadPath} className="inline-flex items-center gap-1 self-start text-xs text-ink-faint hover:text-ink">
          {t('inbox.openThread')} <ArrowRight size={12} aria-hidden />
        </Link>
      )
      if (item.tone === 'broken' || !item.request) {
        return (
          <>
            <p className="flex items-center gap-2 text-sm text-ink-soft">
              <TriangleAlert size={14} aria-hidden className="shrink-0 text-critical" />
              {t(item.tone === 'broken' ? 'inbox.stopped.body' : 'inbox.awaiting.body')}
            </p>
            {thread}
          </>
        )
      }
      // La vraie réponse, par les routes du fil : la ligne disparaît d'elle-même quand le
      // journal dit la demande levée.
      return (
        <>
          <SessionRequestBody
            conversationId={item.conversationId}
            request={item.request}
            canDecide={item.canDecide}
            onAnswered={onDone}
          />
          {thread}
        </>
      )
    }
    case 'refine':
      return (
        <ul className="flex flex-col gap-3">
          {item.questions.map((question, index) => (
            <li key={question.id} className="flex flex-col gap-1.5">
              <p className="text-sm text-ink">{question.text}</p>
              <ReplyField
                label={question.text}
                autoFocus={index === 0}
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
                    {t('inbox.draft.after', {
                      list: card.after.map((key) => item.cards.findIndex((entry) => entry.key === key) + 1).join(', '),
                    })}
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
              {t('inbox.draft.validate')}
            </Button>
            <Link to={item.milestone.to} className="text-xs text-ink-faint hover:text-ink">
              {t('inbox.draft.fix')}
            </Link>
          </div>
        </>
      )
    case 'merge':
      return (
        <>
          <p className="text-sm text-ink-soft">
            {t('inbox.merge.bodyBefore')} <code className="text-code">{item.branch}</code>
            {t('inbox.merge.bodyAfter')}
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
              {t('inbox.merge.action', { base: item.base })}
            </Button>
          </div>
        </>
      )
  }
}

/** Un champ d'une ligne qui s'agrandit, Entrée pour envoyer, Maj+Entrée pour aller à la ligne (INB-11). */
function ReplyField({ label, autoFocus, onSend }: { label: string; autoFocus: boolean; onSend: (text: string) => void }) {
  const t = useTranslate()
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
        // Le champ paraît au geste qui le demande : la saisie va d'elle-même au premier.
        autoFocus={autoFocus}
        value={text}
        aria-label={label}
        placeholder={t('inbox.reply.placeholder')}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault()
            send()
          }
        }}
        className="field-sizing-content max-h-32 min-h-9 min-w-0 flex-1 resize-none rounded-lg border border-line bg-canvas px-3 py-2 text-sm outline-none placeholder:text-ink-faint focus:border-accent"
      />
      <Button size="sm" disabled={!text.trim()} onClick={send}>
        {t('inbox.send')}
      </Button>
    </div>
  )
}

/* ------------------------------------------------------------------ un coup d'œil */

function LightRow({ item }: { item: LightInboxItem }) {
  const t = useTranslate()
  const pr = item.tone === 'review-pr'
  const body = (
    <>
      {pr ? (
        <GitPullRequest size={14} aria-hidden className="shrink-0 text-positive" />
      ) : (
        <span aria-hidden className="mx-[3.5px] size-[7px] shrink-0 rounded-full bg-accent" />
      )}
      <span className="min-w-0 max-w-[18rem] truncate @xl:shrink-0 text-sm text-ink">{withProject(t, item.project, item.title)}</span>
      <span className="hidden min-w-0 truncate text-sm text-ink-faint @xl:block">
        {t(pr ? 'inbox.pr.ready' : 'inbox.card.review', { number: item.number })}
      </span>
      <span className="flex shrink-0 items-center gap-3">
        <Age at={item.since} />
        <span className="inline-flex items-center gap-1 px-2 text-xs font-medium text-ink-soft group-hover:text-ink">
          {t(pr ? 'inbox.light.openPr' : 'inbox.light.review')}
          {item.external ? <ArrowUpRight size={12} aria-hidden /> : <ArrowRight size={12} aria-hidden />}
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
