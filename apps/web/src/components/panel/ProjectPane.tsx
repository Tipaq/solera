import { ArrowLeft, ChevronRight, Circle, CircleCheck, CircleDot, Eye, Link2, Loader, Plus, SquareKanban, Unlink } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import type { CardDto, CardLinkDto } from '@solera/protocol'
import { useCards, useCreateCard } from '../../lib/cards'
import type { ChatItem } from '../../lib/chat-fold'
import { useAttachCard } from '../../lib/conversations'
import { useTranslate } from '../../lib/i18n'
import { latestAgentPlan, projectOverview, suggestCard, type AgentPlanStep } from '../../lib/project-pane'
import { useProjects } from '../../lib/projects'
import { AgentIcon } from '../AgentIcon'
import { CardChooser } from '../board/CardChooser'
import { CardDetail } from '../board/CardDetail'
import { ColumnDot } from '../board/ColumnDot'
import { columnLabel } from '../board/columns'
import { NewCardDialog } from '../board/NewCardDialog'
import { Button, IconButton, SegmentedControl, cx } from '@solera/ui'

/** Ce que la vue lit de la session, tenu par la page de la conversation. */
export interface ProjectPaneSession {
  title: string
  /** La carte rattachée, telle que la conversation la connaît. */
  card: CardLinkDto | null
  items: ChatItem[]
  running: boolean
  /** Ce que fait l'agent en ce moment, dit comme sous le fil ; null au repos. */
  activity: string | null
  model: string | null
  /** Part de la fenêtre de contexte occupée, de 0 à 1, quand le CLI la donne. */
  contextRatio: number | null
}

/**
 * La vue *Projet* du panneau : la session et sa carte, puis le projet autour.
 *
 * Arrêtée avec Tim le 2026-10-17 (`docs/audits/2026-10-17-onglet-projet`) : deux
 * segments, parce qu'il voulait y lire **aussi ce que la session est en train de
 * faire**, et pas seulement le travail qu'elle sert.
 *
 * - *Cette session* : l'activité en une bande, puis la fiche de la carte en entier, le
 *   plan de l'agent juste après ses cases — on voit d'un coup si les deux listes
 *   racontent la même chose. Sans carte, une proposition et de quoi en choisir une.
 * - *Le projet* : ce qui touche la carte, ce qui bouge maintenant, et le reste replié.
 *
 * Une carte ouverte depuis l'un ou l'autre s'empile par-dessus, avec un retour : on ne
 * quitte pas la session pour lire la voisine.
 */
export function ProjectPane({
  projectId,
  conversationId,
  session,
}: {
  projectId: string
  conversationId: string
  session: ProjectPaneSession
}) {
  const t = useTranslate()
  const [segment, setSegment] = useState<'session' | 'project'>('session')
  const [opened, setOpened] = useState<number | null>(null)
  const { data: cards, isPending } = useCards(projectId)
  const current = session.card ? cards?.find((card) => card.id === session.card?.id) ?? null : null
  const reviewCount = cards?.filter((card) => card.column === 'review').length ?? 0
  const openedCard = opened !== null ? cards?.find((card) => card.number === opened) : undefined

  if (openedCard) {
    return (
      <div className="flex min-h-0 flex-1 flex-col pb-safe">
        <CardDetail
          card={openedCard}
          projectId={projectId}
          currentConversationId={conversationId}
          onSelectCard={setOpened}
          onDeleted={() => setOpened(null)}
          lead={
            <IconButton label={t('project.pane.back')} size="sm" onClick={() => setOpened(null)}>
              <ArrowLeft size={15} />
            </IconButton>
          }
        />
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col pb-safe">
      <div className="shrink-0 px-2.5 pt-2.5">
        <SegmentedControl
          label={t('project.pane.segments')}
          value={segment}
          onChange={setSegment}
          className="flex w-full"
          segments={[
            {
              value: 'session',
              label: session.card ? t('project.pane.sessionCard', { number: session.card.number }) : t('project.pane.session'),
              icon: session.running ? <Live /> : undefined,
            },
            {
              value: 'project',
              label: reviewCount > 0 ? t('project.pane.projectCount', { count: reviewCount }) : t('project.pane.project'),
            },
          ]}
        />
      </div>
      {segment === 'session' ? (
        <SessionSegment
          projectId={projectId}
          conversationId={conversationId}
          session={session}
          cards={cards}
          current={current}
          loading={isPending}
          onOpen={setOpened}
        />
      ) : (
        <ProjectSegment projectId={projectId} cards={cards ?? []} current={current} loading={isPending} onOpen={setOpened} />
      )}
    </div>
  )
}

function Live() {
  return (
    <span className="relative flex size-2 shrink-0" aria-hidden>
      <span className="absolute inset-0 animate-ping rounded-full bg-accent/50 motion-reduce:animate-none" />
      <span className="relative size-2 rounded-full bg-accent" />
    </span>
  )
}

/* ------------------------------------------------------------ la session ---- */

function SessionSegment({
  projectId,
  conversationId,
  session,
  cards,
  current,
  loading,
  onOpen,
}: {
  projectId: string
  conversationId: string
  session: ProjectPaneSession
  cards: CardDto[] | undefined
  current: CardDto | null
  loading: boolean
  onOpen: (number: number) => void
}) {
  const t = useTranslate()
  const plan = latestAgentPlan(session.items)
  const attach = useAttachCard(projectId)

  if (session.card && current) {
    return (
      <>
        <ActivityBand session={session} />
        <div className="mt-2 flex min-h-0 flex-1 flex-col border-t border-line">
          <CardDetail
            card={current}
            projectId={projectId}
            currentConversationId={conversationId}
            onSelectCard={onOpen}
            onDeleted={() => undefined}
            afterSubtasks={plan ? <AgentPlan steps={plan} /> : null}
          />
        </div>
      </>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <ActivityBand session={session} />
      <div className="flex flex-col gap-4 px-2.5 py-3">
        {session.card ? (
          // Rattachée mais introuvable : le board n'est pas encore là, ou la carte a été
          // supprimée depuis, la conversation lui survivant.
          loading ? (
            <p className="px-1 text-sm text-ink-faint">{t('project.pane.loading')}</p>
          ) : (
            <div className="flex items-center gap-2 rounded-lg border border-line px-3 py-2.5">
              <p className="min-w-0 flex-1 text-sm text-ink-soft">{t('project.pane.cardGone')}</p>
              <Button size="sm" variant="ghost" icon={<Unlink size={14} />} disabled={attach.isPending}
                onClick={() => attach.mutate({ id: conversationId, cardId: null })}>
                {t('project.pane.detach')}
              </Button>
            </div>
          )
        ) : (
          <NoCard projectId={projectId} conversationId={conversationId} session={session} cards={cards ?? []} />
        )}
        {plan ? <AgentPlan steps={plan} /> : null}
      </div>
    </div>
  )
}

/** Ce que fait la session, en une ligne : l'état, le geste, le modèle et sa fenêtre. */
function ActivityBand({ session }: { session: ProjectPaneSession }) {
  const t = useTranslate()
  const details = [
    session.model,
    session.contextRatio !== null ? t('project.pane.context', { percent: Math.round(session.contextRatio * 100) }) : null,
  ].filter(Boolean).join(' · ')
  return (
    <div className="mx-2.5 mt-2.5 flex shrink-0 items-center gap-2 rounded-md bg-surface-high/70 px-2.5 py-1.5" role="status">
      {session.running
        ? <Loader size={13} className="shrink-0 animate-spin text-accent motion-reduce:animate-none" aria-hidden />
        : <span aria-hidden className="size-2 shrink-0 rounded-full bg-line-strong" />}
      <span className="min-w-0 flex-1 truncate text-xs text-ink-soft">
        <span className="font-medium text-ink">{session.running ? t('project.pane.running') : t('project.pane.idle')}</span>
        {session.running && session.activity ? <> · {session.activity}</> : null}
      </span>
      {details ? <span className="shrink-0 text-micro tabular-nums text-ink-faint">{details}</span> : null}
    </div>
  )
}

/** Le plan que l'agent s'est donné, lu à côté de ce que la carte demande. */
function AgentPlan({ steps }: { steps: AgentPlanStep[] }) {
  const t = useTranslate()
  const done = steps.filter((step) => step.status === 'completed').length
  return (
    <section aria-label={t('project.pane.plan')} className="flex flex-col gap-1">
      <h3 className="flex items-center gap-2 text-micro font-semibold tracking-wide text-ink-faint uppercase">
        <span className="flex-1">{t('project.pane.plan')}</span>
        <span className="font-normal tabular-nums">{done}/{steps.length}</span>
      </h3>
      <ul className="flex flex-col gap-px">
        {steps.map((step, index) => {
          const Icon = step.status === 'completed' ? CircleCheck : step.status === 'in_progress' ? CircleDot : Circle
          return (
            <li key={index} className={cx('flex items-start gap-2 rounded-md px-1.5 py-1 text-sm', step.status === 'in_progress' && 'bg-accent-wash/60')}>
              <Icon size={14} aria-label={t(`plan.progress.${step.status}`)}
                className={cx('mt-0.5 shrink-0', step.status === 'completed' ? 'text-positive' : step.status === 'in_progress' ? 'text-accent' : 'text-ink-faint')} />
              <span className={cx('min-w-0 break-words', step.status === 'completed' ? 'text-ink-faint line-through' : 'text-ink')}>{step.text}</span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/**
 * Sans carte : une proposition, et le reste à la demande (maquette K2).
 *
 * Une seule devinette, avec sa raison écrite, plutôt qu'une liste : la liste est derrière
 * « Autre… ». Créer prend le titre de la session et pose la carte en cours, puisque
 * quelqu'un y travaille déjà.
 */
function NoCard({ projectId, conversationId, session, cards }: {
  projectId: string
  conversationId: string
  session: ProjectPaneSession
  cards: CardDto[]
}) {
  const t = useTranslate()
  const attach = useAttachCard(projectId)
  const create = useCreateCard(projectId)
  const suggestion = suggestCard(session.items, cards)
  const busy = attach.isPending || create.isPending
  const attachTo = (cardId: string) => attach.mutate({ id: conversationId, cardId })

  return (
    <div className="rounded-lg border border-dashed border-line-strong p-3">
      <p className="mb-1 flex items-center gap-1.5 text-micro font-semibold tracking-wide text-ink-faint uppercase">
        <Unlink size={12} aria-hidden />{t('project.pane.noCard')}
      </p>
      <p className="mb-3 text-xs leading-relaxed text-ink-soft">{t('project.pane.noCard.hint')}</p>
      {suggestion ? (
        <div className="mb-3 flex items-center gap-2 rounded-md bg-accent-wash/50 px-2 py-1.5">
          <ColumnDot column={suggestion.card.column} />
          <span className="shrink-0 text-meta tabular-nums text-ink-faint">#{suggestion.card.number}</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm text-ink">{suggestion.card.title}</span>
            <span className="block text-micro text-ink-faint">{t('project.pane.suggestion', { count: suggestion.mentions })}</span>
          </span>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-1.5">
        {suggestion ? (
          <Button size="sm" icon={<Link2 size={14} />} disabled={busy} onClick={() => attachTo(suggestion.card.id)}>
            {t('project.pane.attach')}
          </Button>
        ) : null}
        <CardChooser
          projectId={projectId}
          label={t('project.pane.other')}
          excludeIds={suggestion ? [suggestion.card.id] : []}
          onPick={(picked) => attachTo(picked.id)}
          trigger={
            <Button size="sm" variant={suggestion ? 'secondary' : 'primary'} icon={suggestion ? undefined : <Link2 size={14} />} disabled={busy}>
              {suggestion ? t('project.pane.other') : t('project.pane.attach')}
            </Button>
          }
        />
        <Button size="sm" variant="ghost" icon={<Plus size={14} />} disabled={busy} title={t('project.pane.create.title')}
          onClick={() => create.mutate(
            { title: session.title, column: 'in_progress' },
            { onSuccess: (card) => attachTo(card.id) },
          )}>
          {t('project.pane.create')}
        </Button>
      </div>
      {attach.isError || create.isError ? <p role="alert" className="mt-2 text-sm text-critical">{t('project.pane.attachError')}</p> : null}
    </div>
  )
}

/* ------------------------------------------------------------- le projet ---- */

function ProjectSegment({ projectId, cards, current, loading, onOpen }: {
  projectId: string
  cards: CardDto[]
  current: CardDto | null
  loading: boolean
  onOpen: (number: number) => void
}) {
  const t = useTranslate()
  const navigate = useNavigate()
  const [creating, setCreating] = useState(false)
  const { data: projects } = useProjects()
  const project = projects?.find((entry) => entry.id === projectId)
  const view = projectOverview(cards, current)

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="flex shrink-0 items-center gap-1.5 px-3.5 pt-3">
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">
          {project?.name}
          <span className="font-normal text-ink-faint"> · {t('project.pane.cards', { count: cards.length })}</span>
        </span>
        <Button size="sm" variant="secondary" icon={<Plus size={14} />} onClick={() => setCreating(true)}>{t('project.pane.newCard')}</Button>
        <Button size="sm" variant="secondary" icon={<SquareKanban size={14} />} onClick={() => navigate(`/p/${projectId}/board`)}>
          {t('project.pane.board')}
        </Button>
      </div>

      {loading ? (
        <p className="px-3.5 py-3 text-sm text-ink-faint">{t('project.pane.loading')}</p>
      ) : cards.length === 0 ? (
        <p className="px-3.5 py-3 text-sm text-ink-faint">{t('project.pane.empty')}</p>
      ) : (
        <div className="flex flex-col gap-4 px-2 py-3">
          {current && view.around.length > 0 ? (
            <Group title={t('project.pane.around', { number: current.number })}>
              {view.around.map(({ relation, card }) => (
                <CardRow key={card.id} card={card} onOpen={onOpen}
                  lead={<span className="w-20 shrink-0 truncate text-micro text-ink-faint">{t(`project.pane.relation.${relation}`)}</span>} />
              ))}
            </Group>
          ) : null}

          <Group title={t('project.pane.now')}>
            {view.review.length === 0 && view.active.length === 0 ? (
              <p className="px-1.5 py-1 text-sm text-ink-faint">{t('project.pane.quiet')}</p>
            ) : null}
            {view.review.map((card) => (
              <CardRow key={card.id} card={card} onOpen={onOpen} tone="caution" dot={false}
                lead={<Eye size={13} className="shrink-0 text-caution" aria-hidden />}
                trail={<span className="shrink-0 text-micro text-caution">{t('project.pane.toReview')}</span>} />
            ))}
            {view.active.map((card) => {
              const live = card.conversations.find((entry) => !entry.archivedAt && entry.status !== 'idle')
              return (
                <CardRow key={card.id} card={card} onOpen={onOpen} dot={false}
                  lead={<Live />}
                  trail={live ? <AgentIcon agent={live.agent} size={12} decorative /> : null} />
              )
            })}
          </Group>

          <Group title={t('project.pane.rest')}>
            <Fold label={columnLabel('todo')} cards={view.todo} onOpen={onOpen} />
            <Fold label={columnLabel('in_progress')} cards={view.inProgress} onOpen={onOpen} />
            <Fold label={t('project.pane.doneThisWeek')} cards={view.doneThisWeek} onOpen={onOpen} />
          </Group>
        </div>
      )}

      {creating ? (
        <NewCardDialog projectId={projectId} open onClose={() => setCreating(false)}
          onCreated={(card) => { setCreating(false); onOpen(card.number) }} />
      ) : null}
    </div>
  )
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-px">
      <h3 className="px-1.5 pb-1 text-micro font-semibold tracking-wide text-ink-faint uppercase">{title}</h3>
      {children}
    </section>
  )
}

/** Une colonne repliée : on l'ouvre pour chercher une carte, pas pour la surveiller. */
function Fold({ label, cards, onOpen }: { label: string; cards: CardDto[]; onOpen: (number: number) => void }) {
  if (cards.length === 0) return null
  return (
    <details className="group/fold">
      <summary className="flex min-h-9 cursor-pointer list-none items-center gap-2 rounded-md px-1.5 text-sm text-ink-soft hover:bg-surface-high [&::-webkit-details-marker]:hidden">
        <ChevronRight size={13} className="shrink-0 text-ink-faint transition-transform group-open/fold:rotate-90" aria-hidden />
        <span className="flex-1">{label}</span>
        <span className="text-micro tabular-nums text-ink-faint">{cards.length}</span>
      </summary>
      <div className="flex flex-col gap-px pl-4">
        {cards.map((card) => <CardRow key={card.id} card={card} onOpen={onOpen} />)}
      </div>
    </details>
  )
}

function CardRow({ card, onOpen, lead, trail, tone, dot = true }: {
  card: CardDto
  onOpen: (number: number) => void
  lead?: ReactNode
  trail?: ReactNode
  tone?: 'caution'
  /** La pastille de colonne, retirée quand la ligne dit déjà où en est la carte. */
  dot?: boolean
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(card.number)}
      className={cx(
        'flex min-h-9 w-full items-center gap-2 rounded-md px-1.5 text-left hover:bg-surface-high md:min-h-8 pointer-coarse:min-h-11',
        tone === 'caution' && 'bg-caution/5',
      )}
    >
      {lead}
      {dot ? <ColumnDot column={card.column} /> : null}
      <span className="shrink-0 text-meta tabular-nums text-ink-faint">#{card.number}</span>
      <span className="min-w-0 flex-1 truncate text-sm text-ink">{card.title}</span>
      {trail}
    </button>
  )
}
