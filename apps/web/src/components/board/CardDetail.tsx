import { CalendarDays, ChevronDown, Flag, MoreHorizontal, Pencil, Play, Plus, Trash2 } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { CARD_COLUMNS, parseSubtasks, type CardDto } from '@solera/protocol'
import { useCardSaving, useDeleteCard, useToggleSubtask, useUpdateCard } from '../../lib/cards'
import { useCardDraft } from '../../lib/card-drafts'
import { useCurrentUser } from '../../lib/session'
import { locale, translate, useTranslate } from '../../lib/i18n'
import { Markdown } from '../chat/Markdown'
import { Badge, Button, IconButton, Menu, MenuItem, cx } from '@solera/ui'
import { CardAttachments } from './CardAttachments'
import { CardBlocks } from './CardBlocks'
import { CardEditor } from './CardEditor'
import { CardDue, CardMilestone } from './CardMeta'
import { CardProgress } from './CardProgress'
import { CardThread } from './CardThread'
import { ColumnDot } from './ColumnDot'
import { COLUMN_TONES, columnLabel } from './columns'

/**
 * La fiche d'une carte, où qu'on la lise : le tiroir du board, le panneau d'une session.
 *
 * Une seule fiche et pas deux, décidé le 2026-10-17 (`docs/audits/2026-10-17-onglet-projet`,
 * maquettes F2 et F3). Elle se lit d'un seul tenant, sans onglets — propriétés, énoncé,
 * puis le fil — parce que les notes et les sessions cachées derrière un onglet étaient
 * précisément ce qu'on venait chercher en ouvrant la carte depuis une session.
 *
 * Sa mise en page suit **sa** largeur et non celle de la fenêtre : le même composant vit
 * dans un tiroir de 44 rem et dans un panneau accolé de 22. Au-delà de 42 rem les
 * propriétés passent dans une colonne à droite ; en deçà elles se rangent après
 * l'énoncé et avant le fil — à l'étroit, c'est ce qu'il y a à faire qu'on cherche
 * d'abord, et les propriétés le repoussaient sous la ligne de flottaison.
 *
 * Les actions sont dans la tête : la colonne, reprendre, lancer une session, et le reste
 * dans « ⋯ ». Le titre et l'énoncé se modifient en cliquant dessus.
 */
export function CardDetail({
  card,
  projectId,
  onSelectCard,
  onDeleted,
  lead,
  close,
  currentConversationId,
  afterSubtasks,
}: {
  card: CardDto
  projectId: string
  onSelectCard: (number: number) => void
  /** Appelé une fois la carte supprimée : celui qui l'affiche doit la quitter. */
  onDeleted: () => void
  /** Ce qui précède le numéro dans la tête — un retour, dans le panneau. */
  lead?: ReactNode
  /** Ce qui ferme la fiche, en bout de tête. */
  close?: ReactNode
  /**
   * La session depuis laquelle on lit la carte. On ne la propose pas de la reprendre,
   * on y est déjà, et le fil la désigne au lieu d'en faire un lien.
   */
  currentConversationId?: string
  /** Ce qui se lit juste après l'énoncé : le plan de l'agent, côté session. */
  afterSubtasks?: ReactNode
}) {
  const t = useTranslate()
  const navigate = useNavigate()
  const updateCard = useUpdateCard(projectId)
  const deleteCard = useDeleteCard(projectId)
  const toggleSubtask = useToggleSubtask(projectId, card.id)
  const saving = useCardSaving(card.id)
  const latestSession = card.conversations.filter((session) => !session.archivedAt)
    .sort((a, b) => b.createdAt - a.createdAt)[0]
  const resumable = latestSession && latestSession.id !== currentConversationId ? latestSession : undefined

  const { data: user } = useCurrentUser()
  const { draft, setDraft, acknowledge } = useCardDraft(user?.id ?? '', card.id)
  const title = draft?.title ?? card.title
  const description = draft?.description ?? card.description
  const [editing, setEditing] = useState(false)
  const editVisible = editing || draft !== null

  const dirty = title !== card.title || description !== card.description
  // Après un rechargement pendant la requête, le serveur peut déjà avoir reçu
  // le texte. Ne pas laisser ce brouillon masquer ses futures mises à jour.
  useEffect(() => {
    if (draft && !dirty) acknowledge(draft)
  }, [draft, dirty, acknowledge])

  const save = () => {
    if (!title.trim() || !dirty || saving) return
    if (!draft) return
    // La promesse continue même si la fiche est fermée pendant l'enregistrement.
    void updateCard.mutateAsync({ id: card.id, title: title.trim(), description })
      .then(() => { acknowledge(draft); setEditing(false) })
      .catch(() => { /* L'erreur est affichée et le brouillon reste intact. */ })
  }

  /**
   * Cocher une case réécrit la description, et c'est le seul endroit de ce chantier où
   * du texte de l'utilisateur peut se perdre. Deux garde-fous, et ils sont volontaires :
   *
   * - tant qu'un brouillon est ouvert, les cases ne se cochent pas. La description
   *   affichée n'est alors plus celle qui est en base, et cocher écrirait par-dessus
   *   une saisie en cours ou réécrirait la ligne d'un texte que le serveur ne connaît
   *   pas encore ;
   * - le clic n'envoie que le rang de la case et ce qu'elle dit, jamais la description
   *   entière : une autre session peut l'avoir changée entre l'affichage et le clic, et
   *   le serveur refuse plutôt que de cocher une ligne que personne n'a visée.
   */
  const subtasks = parseSubtasks(card.description)
  const checkSubtask = editVisible
    ? undefined
    : (index: number, checked: boolean) => {
        const task = subtasks[index]
        if (!task || toggleSubtask.isPending) return
        toggleSubtask.mutate({ index, checked, label: task.label })
      }

  const remove = () => {
    if (!confirm(translate('board.card.remove.confirm', { number: card.number }))) return
    deleteCard.mutate(card.id, { onSuccess: onDeleted })
  }

  return (
    <div
      className="@container flex min-h-0 flex-1 flex-col"
      onKeyDown={(event) => {
        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && editVisible) {
          event.preventDefault()
          save()
        }
      }}
    >
      <header className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-line px-3 py-2 @min-[42rem]:px-5">
        {lead}
        <span className="text-xs font-medium tabular-nums text-ink-faint">#{card.number}</span>
        <Menu align="start" trigger={
          <button type="button" disabled={saving} aria-label={t('board.card.changeColumn', { column: columnLabel(card.column) })}
            className="flex min-h-11 items-center gap-1 rounded-md px-1 text-ink-faint hover:bg-surface-high md:min-h-9 pointer-coarse:min-h-11">
            <Badge tone={COLUMN_TONES[card.column]}>{columnLabel(card.column)}</Badge>
            <ChevronDown size={14} />
          </button>
        }>
          {CARD_COLUMNS.map((column) => (
            <MenuItem key={column} icon={<span aria-hidden><ColumnDot column={column} /></span>} disabled={column === card.column}
              onSelect={() => updateCard.mutate({ id: card.id, column })}>
              {columnLabel(column)}
            </MenuItem>
          ))}
        </Menu>
        <div className="flex-1" />
        {resumable ? (
          <Button size="sm" variant="secondary" icon={<Play size={14} />} onClick={() => navigate(`/p/${projectId}/c/${resumable.id}`)}>
            {t('card.detail.resume')}
          </Button>
        ) : null}
        <Button size="sm" disabled={dirty || saving} title={dirty ? t('board.editor.saveBeforeLaunch') : t('board.card.launch')}
          icon={<Plus size={14} />} onClick={() => navigate(`/p/${projectId}/c/new?card=${card.id}`)}>
          {t('card.detail.session')}
        </Button>
        <Menu trigger={
          <IconButton label={t('card.detail.more')} size="sm"><MoreHorizontal size={15} /></IconButton>
        }>
          <MenuItem icon={<Pencil size={14} />} onSelect={() => setEditing(true)}>{t('board.card.edit')}</MenuItem>
          <MenuItem icon={<Trash2 size={14} />} tone="critical" disabled={deleteCard.isPending} onSelect={remove}>
            {t('board.card.remove')}
          </MenuItem>
        </Menu>
        {close}
      </header>

      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
        <div
          className={cx(
            'grid gap-x-6 px-4 py-4 @min-[42rem]:px-6 @min-[42rem]:py-5',
            "[grid-template-areas:'title'_'desc'_'props'_'thread']",
            '@min-[42rem]:grid-cols-[minmax(0,1fr)_minmax(0,18rem)] @min-[42rem]:grid-rows-[auto_auto_1fr]',
            "@min-[42rem]:[grid-template-areas:'title_props'_'desc_props'_'thread_props']",
          )}
        >
          {editVisible ? (
            <div className="flex min-w-0 flex-col gap-3 [grid-area:title]">
              <CardEditor title={title} description={description} onChange={setDraft} />
              <div className="flex flex-wrap items-center gap-2">
                <p className="min-w-0 flex-1 text-xs text-ink-faint" role="status">{t(dirty ? 'board.card.draft' : 'board.editor.saved')}</p>
                <Button size="sm" variant="ghost" disabled={saving} onClick={() => { setDraft(null); setEditing(false) }}>{t('board.card.cancel')}</Button>
                <Button size="sm" disabled={!dirty || !title.trim() || saving} onClick={save}>{t(saving ? 'board.card.saving' : 'board.card.save')}</Button>
              </div>
              {updateCard.isError ? <p role="alert" className="text-sm text-critical">{t('board.card.saveError')}</p> : null}
            </div>
          ) : (
            <h2 className="[grid-area:title] mb-3 min-w-0 break-words text-lg leading-snug font-semibold tracking-tight text-ink">
              <button type="button" onClick={() => setEditing(true)} title={t('board.card.edit')}
                className="cursor-text rounded-sm text-left outline-offset-2 hover:text-ink-soft">
                {card.title}
              </button>
            </h2>
          )}

          <aside
            aria-label={t('card.detail.properties')}
            className="flex min-w-0 flex-col gap-4 [grid-area:props] @max-[42rem]:mb-5 @max-[42rem]:border-y @max-[42rem]:border-line @max-[42rem]:py-4 @min-[42rem]:self-start @min-[42rem]:border-l @min-[42rem]:border-line @min-[42rem]:pl-5"
          >
            <dl className="flex flex-col gap-0.5">
              <Property icon={<Flag size={13} />} label={t('card.detail.milestone')}>
                <CardMilestone card={card} projectId={projectId} onSelectCard={onSelectCard} />
              </Property>
              <Property icon={<CalendarDays size={13} />} label={t('board.card.due')}>
                <CardDue card={card} projectId={projectId} />
              </Property>
            </dl>
            <CardBlocks card={card} projectId={projectId} onSelectCard={onSelectCard} />
            <CardLinkList title={t('board.card.references')} links={card.references} onSelect={onSelectCard} />
            <CardLinkList title={t('board.card.referencedBy')} links={card.referencedBy} onSelect={onSelectCard} />
            <CardAttachments key={card.id} cardId={card.id} projectId={projectId} />
            <p className="text-meta text-ink-faint">
              {t('card.detail.author', {
                name: card.createdByName,
                date: new Date(card.createdAt).toLocaleDateString(locale(), { day: 'numeric', month: 'short' }),
              })}
            </p>
          </aside>

          <div className="flex min-w-0 flex-col gap-5 pb-5 [grid-area:desc]">
            {editVisible ? null : (
              <div className="flex flex-col gap-2">
                {card.description ? (
                  <div className="min-w-0 break-words text-sm leading-relaxed text-ink-soft">
                    <Markdown text={card.description} onToggleTask={checkSubtask} />
                  </div>
                ) : (
                  <button type="button" onClick={() => setEditing(true)} className="py-2 text-left text-sm text-ink-faint hover:text-accent">
                    {t('board.editor.addDescription')}
                  </button>
                )}
                <CardProgress subtasks={subtasks} />
                {toggleSubtask.isError ? <p role="alert" className="text-sm text-critical">{t('board.card.subtasks.error')}</p> : null}
              </div>
            )}
            {afterSubtasks}
          </div>

          <div className="flex min-w-0 flex-col gap-5 [grid-area:thread]">
            <CardThread projectId={projectId} card={card} currentConversationId={currentConversationId} />
            {deleteCard.isError ? <p role="alert" className="text-sm text-critical">{t('board.files.error')}</p> : null}
          </div>
        </div>
      </div>
    </div>
  )
}

/** Une ligne du tableau des propriétés : le nom à gauche, la valeur réglable à droite. */
function Property({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-9 items-center gap-2">
      <dt className="flex w-24 shrink-0 items-center gap-1.5 text-meta text-ink-faint">
        <span aria-hidden>{icon}</span>{label}
      </dt>
      <dd className="min-w-0 flex-1">{children}</dd>
    </div>
  )
}

function CardLinkList({
  title,
  links,
  onSelect,
}: {
  title: string
  links: CardDto['references']
  onSelect: (number: number) => void
}) {
  if (links.length === 0) return null
  return (
    <div className="flex flex-col gap-1.5">
      <h3 className="text-xs font-medium tracking-wide text-ink-faint uppercase">{title}</h3>
      <ul className="flex flex-col gap-0.5">
        {links.map((link) => (
          <li key={link.id}>
            <button
              type="button"
              onClick={() => onSelect(link.number)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm text-ink-soft hover:bg-surface-high hover:text-ink"
            >
              <span className="shrink-0 text-meta text-ink-faint">#{link.number}</span>
              <span className="min-w-0 flex-1 truncate">{link.title}</span>
              <ColumnDot column={link.column} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
