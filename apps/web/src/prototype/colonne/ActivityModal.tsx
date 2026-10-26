/**
 * PROTOTYPE JETABLE (#121) — la modale d'Activité, et ce qu'il se passe quand on clique
 * une demande : elle se **déplie sur place**, avec de quoi y répondre sans ouvrir le fil
 * (le geste de #112, ramené dans la modale). Répondre la fait partir de la liste et des
 * comptes de la colonne ; « Ouvrir le fil » ferme la modale et ouvre la conversation.
 *
 * Gabarit de dialogue du §9 : feuille en bas au doigt, boîte centrée au large — comme
 * `ActivityDialog` aujourd'hui.
 */
import * as Dialog from '@radix-ui/react-dialog'
import { Activity, ArrowUpRight, Check, ChevronDown, Hourglass, MessagesSquare, X } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { Button, cx, IconButton } from '@solera/ui'
import { Avatar, Dot, KIND_ICON } from './Column'
import { DETAILS } from './details'
import { orderDemands, projectOf, threadOf, THREADS, type Demand } from './data'

type Filter = 'demands' | 'unread' | 'running' | 'all'

const TIER_LABEL = { blocked: 'Bloqué', decision: 'Décision', grant: 'Accord' } as const
const KIND_LABEL: Record<string, string> = {
  permission: 'Permission demandée',
  question: 'Question',
  plan: 'Plan à valider',
  decision: 'Décision',
  cards: 'Cartes à ranger',
  drafts: 'Cartes à créer',
  move: 'Conversation à ranger',
}

export function ActivityModal({ open, onOpenChange, focus, demands, onAnswer, onOpenThread, current, projectMode }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** La demande cliquée dans la colonne : la modale s'ouvre dépliée sur elle. */
  focus?: string
  demands: Demand[]
  onAnswer: (id: string) => void
  onOpenThread: (id: string) => void
  current: string | null
  projectMode: boolean
}) {
  const blocked = new Set(demands.filter((demand) => demand.tier === 'blocked').map((demand) => demand.threadId))
  const live = THREADS.filter((thread) => !blocked.has(thread.id) && thread.dot !== null)
  const unread = live.filter((thread) => thread.dot === 'unread')
  const running = live.filter((thread) => thread.dot === 'working')
  const [filter, setFilter] = useState<Filter>('demands')
  const [expanded, setExpanded] = useState<string | undefined>(focus)
  /** La réponse vient d'être donnée : la ligne la dit une seconde avant de partir. */
  const [answered, setAnswered] = useState<Record<string, string>>({})

  // Le filtre d'ouverture est le premier groupe non vide, comme aujourd'hui.
  useEffect(() => {
    if (!open) return
    setFilter(demands.length > 0 ? 'demands' : unread.length > 0 ? 'unread' : running.length > 0 ? 'running' : 'all')
    setExpanded(focus)
    setAnswered({})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, focus])

  const answer = (id: string, verdict: string) => {
    setAnswered((previous) => ({ ...previous, [id]: verdict }))
    setTimeout(() => {
      onAnswer(id)
      setExpanded((value) => (value === id ? undefined : value))
    }, 1100)
  }
  const goTo = (threadId: string) => {
    onOpenChange(false)
    onOpenThread(threadId)
  }

  const ordered = orderDemands(demands, projectMode ? current : undefined)
  const filters: { value: Filter; label: string; count: number; tone?: 'caution' }[] = [
    { value: 'demands', label: 'Pour toi', count: demands.length, tone: 'caution' },
    { value: 'unread', label: 'Non lues', count: unread.length },
    { value: 'running', label: 'En cours', count: running.length },
    { value: 'all', label: 'Tout', count: demands.length + unread.length + running.length },
  ]
  const showDemands = filter === 'demands' || filter === 'all'
  const sessions = filter === 'unread' ? unread : filter === 'running' ? running : filter === 'all' ? [...unread, ...running] : []

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="scrim z-40" />
        <Dialog.Content
          data-shot="modale"
          className="surface fixed inset-x-0 bottom-0 z-50 flex max-h-[90dvh] flex-col overflow-hidden rounded-t-xl border border-line shadow-pop sm:inset-x-auto sm:top-1/2 sm:bottom-auto sm:left-1/2 sm:w-[min(672px,calc(100vw-2rem))] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl"
        >
          <div className="flex shrink-0 items-start justify-between gap-3 px-5 pt-4 pb-3">
            <div>
              <Dialog.Title className="flex items-center gap-2 text-heading font-semibold">
                <Activity size={16} className="text-ink-faint" />Activité
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-xs text-ink-faint">
                Ce qui t’attend, puis ce qui tourne, dans tous tes projets.
              </Dialog.Description>
            </div>
            <Dialog.Close asChild><IconButton label="Fermer"><X size={16} /></IconButton></Dialog.Close>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-line px-4 pb-3">
            {filters.map((entry) => (
              <button
                key={entry.value}
                type="button"
                onClick={() => setFilter(entry.value)}
                aria-pressed={filter === entry.value}
                className={cx(
                  'flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm transition-colors pointer-coarse:h-11',
                  filter === entry.value ? 'bg-accent-wash font-medium text-ink' : 'text-ink-soft hover:bg-surface-high hover:text-ink',
                )}
              >
                {entry.label}
                <span className={cx('tabular-nums', entry.tone === 'caution' && entry.count > 0 ? 'text-caution' : 'text-ink-faint')}>
                  {entry.count}
                </span>
              </button>
            ))}
            <span className="ml-auto hidden sm:block">
              <button type="button" className="flex h-8 items-center gap-2 rounded-md border border-line px-2.5 text-sm text-ink-soft">
                Tous les projets <ChevronDown size={13} />
              </button>
            </span>
          </div>

          <div className="min-h-0 overflow-y-auto p-2">
            {showDemands && ordered.length === 0 && filter === 'demands' ? (
              <p className="px-2 py-8 text-center text-sm text-ink-faint">Rien ne t’attend. Les agents avancent seuls.</p>
            ) : null}
            <ul className="divide-y divide-line/50">
              {showDemands ? ordered.map((demand) => (
                <DemandItem
                  key={demand.id}
                  demand={demand}
                  open={expanded === demand.id}
                  verdict={answered[demand.id]}
                  onToggle={() => setExpanded((value) => (value === demand.id ? undefined : demand.id))}
                  onAnswer={(verdict) => answer(demand.id, verdict)}
                  onOpenThread={() => goTo(demand.threadId)}
                />
              )) : null}
              {sessions.map((thread) => {
                const project = projectOf(thread.projectId)
                return (
                  <li key={thread.id}>
                    <button
                      type="button"
                      onClick={() => goTo(thread.id)}
                      className="flex min-h-11 w-full items-center gap-3 rounded-md px-2 py-2 text-left transition-colors hover:bg-surface-high"
                    >
                      <Avatar project={project} className="size-3.5" />
                      <span className={cx('min-w-0 flex-1 truncate text-sm text-ink', thread.dot === 'unread' && 'font-medium')}>{thread.title}</span>
                      <span className="hidden shrink-0 text-xs text-ink-soft sm:block">{project?.name ?? 'Sans projet'}</span>
                      <span className="w-12 shrink-0 text-right text-meta tabular-nums text-ink-faint">{thread.age}</span>
                      <Dot state={thread.dot} />
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

/**
 * Une demande : **ce qui est demandé** en titre, le fil et son projet dessous. Un clic la
 * déplie ; une seule à la fois, pour que la liste reste une liste.
 */
function DemandItem({ demand, open, verdict, onToggle, onAnswer, onOpenThread }: {
  demand: Demand
  open: boolean
  verdict?: string
  onToggle: () => void
  onAnswer: (verdict: string) => void
  onOpenThread: () => void
}) {
  const thread = threadOf(demand.threadId)
  const project = projectOf(thread.projectId)
  const kind = demand.tier === 'decision' ? 'decision' : demand.kind
  const Icon = KIND_ICON[kind]!
  const blocked = demand.tier === 'blocked'

  if (verdict) {
    return (
      <li data-shot="repondu" className="flex min-h-14 items-center gap-3 rounded-md bg-positive/10 px-3 py-2 text-sm text-positive">
        <Check size={15} className="shrink-0" />
        <span className="min-w-0 flex-1 truncate">{verdict} — {thread.title}</span>
      </li>
    )
  }

  return (
    <li data-shot={open ? 'depliee' : undefined} className={cx('rounded-md', open && 'bg-sunken/60')}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex min-h-14 w-full items-center gap-3 rounded-md px-2 py-2 text-left transition-colors hover:bg-surface-high"
      >
        <Icon size={15} className={cx('shrink-0', blocked ? 'text-caution' : 'text-ink-faint')} />
        <span className="min-w-0 flex-1">
          <span className={cx('block truncate text-sm', blocked ? 'font-medium text-ink' : 'text-ink')}>{demand.ask}</span>
          <span className="mt-0.5 flex items-center gap-1.5 text-xs text-ink-faint">
            {project ? <Avatar project={project} className="size-3" /> : <MessagesSquare size={11} />}
            <span className="truncate">{thread.title}</span>
          </span>
        </span>
        <span className={cx(
          'shrink-0 rounded-full px-1.5 py-px text-meta',
          blocked ? 'bg-caution/12 text-caution' : 'bg-surface-high text-ink-faint',
        )}>
          {TIER_LABEL[demand.tier]}
        </span>
        <span className="hidden w-14 shrink-0 items-center justify-end gap-0.5 text-meta tabular-nums text-ink-faint sm:flex">
          {demand.tier === 'decision' ? <><Hourglass size={10} />{demand.due}</> : demand.age}
        </span>
        <ChevronDown size={14} className={cx('shrink-0 text-ink-faint transition-transform', open && 'rotate-180')} />
      </button>

      {open ? (
        <div className="px-3 pb-3 sm:pl-[2.6rem]">
          <p className="mb-2 flex items-center gap-1.5 text-xs">
            <span className={blocked ? 'text-caution' : 'text-ink-soft'}>{KIND_LABEL[kind]}</span>
            <span className="text-ink-faint">· attend depuis {demand.age}</span>
            {blocked ? <span className="text-ink-faint">· l’agent est à l’arrêt</span> : null}
            <button type="button" onClick={onOpenThread} className="ml-auto flex items-center gap-1 text-ink-soft hover:text-ink">
              Ouvrir le fil <ArrowUpRight size={12} />
            </button>
          </p>
          <Answer demand={demand} onAnswer={onAnswer} onOpenThread={onOpenThread} />
        </div>
      ) : null}
    </li>
  )
}

function Actions({ children }: { children: ReactNode }) {
  return <div className="mt-3 flex flex-wrap justify-end gap-2">{children}</div>
}

/** Ce qu'il faut pour trancher, selon le genre — les mêmes boutons que dans le fil. */
function Answer({ demand, onAnswer, onOpenThread }: {
  demand: Demand
  onAnswer: (verdict: string) => void
  onOpenThread: () => void
}) {
  const detail = DETAILS[demand.id]
  const [draft, setDraft] = useState('')
  if (!detail) return null
  const kind = demand.tier === 'decision' ? 'decision' : demand.kind

  if (kind === 'permission') {
    return (
      <>
        <p className="text-sm text-ink-soft">{detail.lead}</p>
        <pre className="mt-2 overflow-x-auto rounded-md border border-line bg-canvas px-3 py-2 font-mono text-xs text-ink">{detail.body}</pre>
        <Actions>
          <Button variant="ghost" size="sm" onClick={() => onAnswer('Refusé')}>Refuser</Button>
          <Button variant="secondary" size="sm" onClick={() => onAnswer('Autorisé pour la session')}>Autoriser pour la session</Button>
          <Button size="sm" onClick={() => onAnswer('Autorisé')}>Autoriser</Button>
        </Actions>
      </>
    )
  }

  if (kind === 'question' || kind === 'decision') {
    return (
      <>
        <p className="text-sm text-ink">{detail.lead}</p>
        {detail.body ? <p className="mt-1 text-xs text-ink-soft">{detail.body}</p> : null}
        <div className="mt-3 grid gap-1.5">
          {detail.options!.map((option, index) => (
            <button
              key={option}
              type="button"
              onClick={() => onAnswer(`Répondu « ${option} »`)}
              className="flex min-h-11 items-center gap-3 rounded-md border border-line bg-surface px-3 text-left text-sm text-ink transition-colors hover:border-accent md:min-h-9"
            >
              <span className="w-4 shrink-0 text-meta tabular-nums text-ink-faint">{index + 1}</span>
              <span className="flex-1">{option}</span>
              {detail.fallback === option ? <span className="text-meta text-ink-faint">par défaut</span> : null}
            </button>
          ))}
        </div>
        {kind === 'question' ? (
          <label className="mt-2 flex min-h-11 items-center gap-3 rounded-md border border-line bg-surface px-3 focus-within:border-accent md:min-h-9">
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter' && draft.trim()) onAnswer(`Répondu « ${draft.trim()} »`) }}
              placeholder="Répondre sans ouvrir le fil…"
              className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-faint"
            />
          </label>
        ) : (
          <p className="mt-2 text-xs text-ink-faint">
            L’agent a continué avec « {detail.fallback} ». Sans réponse dans {demand.tier === 'decision' ? demand.due : ''}, c’est ce choix qui reste.
          </p>
        )}
      </>
    )
  }

  if (kind === 'plan') {
    return (
      <>
        <ol className="list-decimal space-y-1 pl-5 text-sm text-ink-soft">
          {detail.items!.map((item) => <li key={item}>{item}</li>)}
        </ol>
        <p className="mt-2 text-xs text-ink-faint">Un plan se relit en entier : il se valide dans le fil.</p>
        <Actions>
          <Button size="sm" onClick={onOpenThread}>Lire et valider dans le fil</Button>
        </Actions>
      </>
    )
  }

  // Les trois accords : ce qui changera, puis refuser ou accorder.
  const accept = kind === 'cards' ? 'Ranger les 3 cartes' : kind === 'drafts' ? 'Créer les 2 cartes' : 'Ranger dans Solera'
  return (
    <>
      <p className="text-sm text-ink-soft">{detail.lead}</p>
      <ul className="mt-2 space-y-1">
        {detail.items!.map((item) => (
          <li key={item} className="rounded-md border border-line bg-surface px-3 py-1.5 text-sm text-ink">{item}</li>
        ))}
      </ul>
      <Actions>
        <Button variant="ghost" size="sm" onClick={() => onAnswer('Refusé')}>Refuser</Button>
        <Button size="sm" onClick={() => onAnswer(kind === 'move' ? 'Rangé' : kind === 'drafts' ? 'Cartes créées' : 'Cartes rangées')}>{accept}</Button>
      </Actions>
    </>
  )
}
