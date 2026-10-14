import { ChevronDown, GitBranch, Pencil, Play, Plus, Trash2 } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { CARD_COLUMNS, type CardColumn, type CardDto } from '@solera/protocol'
import { useCardSaving, useDeleteCard, useUpdateCard } from '../../lib/cards'
import { useCardDraft } from '../../lib/card-drafts'
import { useCurrentUser } from '../../lib/session'
import { translate, useTranslate } from '../../lib/i18n'
import { Markdown } from '../chat/Markdown'
import { AgentIcon } from '../AgentIcon'
import { Badge, Button, IconButton, Menu, MenuItem, Tabs, cx } from '@solera/ui'
import { CardAttachments } from './CardAttachments'
import { CardEditor } from './CardEditor'
import { CardNotes } from './CardNotes'
import { COLUMN_TONES, columnLabel } from './columns'

/**
 * Le contenu d'une carte, sans le tiroir qui le porte.
 *
 * Séparé du tiroir du board parce qu'il a deux logements : à côté des colonnes, et dans
 * l'onglet *Carte* du panneau d'une session. Les deux montrent la même carte et doivent
 * l'éditer de la même façon ; en tenir deux rendus en accord ferait deux cartes
 * différentes au bout d'un mois.
 */
export function CardDetail({
  card,
  projectId,
  onSelectCard,
  headerActions,
  onDeleted,
  currentConversationId,
}: {
  card: CardDto
  projectId: string
  onSelectCard: (number: number) => void
  /** Posé au bout de la première rangée : la fermeture du tiroir, là où il y en a un. */
  headerActions?: ReactNode
  /** La carte vient d'être supprimée : il n'y a plus rien à afficher ici. */
  onDeleted?: () => void
  /**
   * Session d'où l'on regarde la carte, quand on la regarde depuis une.
   *
   * Elle ne se propose pas d'être reprise : on y est déjà, et un bouton *Reprendre* qui
   * ramène où l'on se trouve se lit comme une panne.
   */
  currentConversationId?: string
}) {
  const t = useTranslate()
  const navigate = useNavigate()
  const updateCard = useUpdateCard(projectId)
  const deleteCard = useDeleteCard(projectId)
  const saving = useCardSaving(card.id)
  const latestSession = card.conversations
    .filter((session) => !session.archivedAt && session.id !== currentConversationId)
    .sort((a, b) => b.createdAt - a.createdAt)[0]

  const { data: user } = useCurrentUser()
  const { draft, setDraft, acknowledge } = useCardDraft(user?.id ?? '', card.id)
  const title = draft?.title ?? card.title
  const description = draft?.description ?? card.description
  const [editing, setEditing] = useState(false)
  const [tab, setTab] = useState<'details' | 'activity' | 'sessions'>('details')
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
    // La promesse continue même si le panneau est fermé pendant l'enregistrement.
    void updateCard.mutateAsync({ id: card.id, title: title.trim(), description })
      .then(() => { acknowledge(draft); setEditing(false) })
      .catch(() => { /* L'erreur est affichée et le brouillon reste intact. */ })
  }

  return (
    <div
      className="flex min-h-0 min-w-0 flex-1 flex-col"
      onKeyDown={(event) => {
        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && editVisible) {
          event.preventDefault()
          save()
        }
      }}
    >
      <header className="flex shrink-0 items-center gap-2 border-b border-line px-5 py-3">
        <span className="text-xs font-medium text-ink-faint">#{card.number}</span>
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
        {headerActions}
      </header>

      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line bg-sunken/50 px-5 py-3">
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{card.title}</span>
        {latestSession ? <Button size="sm" variant="secondary" icon={<Play size={14} />} onClick={() => navigate(`/p/${projectId}/c/${latestSession.id}`)}>{t('board.card.resume')}</Button> : null}
        <Button size="sm" disabled={dirty || saving} title={dirty ? t('board.editor.saveBeforeLaunch') : undefined} icon={<Plus size={14} />} onClick={() => navigate(`/p/${projectId}/c/new?card=${card.id}`)}>
          {t(latestSession ? 'board.card.newSession' : 'board.card.launch')}
        </Button>
        {dirty ? <p className="w-full text-xs text-ink-faint">{t('board.editor.saveBeforeLaunch')}</p> : null}
      </div>
      <Tabs label={t('board.card.sections')} value={tab} onChange={setTab} className="px-5" tabs={[
        { value: 'details', label: t('board.card.details') },
        { value: 'activity', label: t('board.card.activity'), count: card.noteCount },
        { value: 'sessions', label: t('board.card.sessions.title'), count: card.conversations.length },
      ]} />
      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-5 sm:p-6">
        {tab === 'details' ? <>
        <div className="flex flex-col gap-4">
          {editVisible ? <CardEditor title={title} description={description} onChange={setDraft} /> : <>
            <div className="flex flex-col items-start gap-3 sm:flex-row">
              <h2 className="min-w-0 flex-1 break-words text-lg font-semibold leading-snug tracking-tight text-ink">{card.title}</h2>
              <Button variant="secondary" size="sm" icon={<Pencil size={14} />} onClick={() => setEditing(true)}>{t('board.card.edit')}</Button>
            </div>
            <div className="rounded-xl border border-line p-4">
              <h3 className="mb-3 text-sm font-semibold text-ink-soft">{t('board.card.description')}</h3>
              {card.description ? <div className="min-w-0 break-words text-sm leading-relaxed text-ink-soft"><Markdown text={card.description} /></div> :
                <button type="button" onClick={() => setEditing(true)} className="w-full py-6 text-left text-sm text-ink-faint hover:text-accent">{t('board.editor.addDescription')}</button>}
            </div>
          </>}
          {updateCard.isError ? <p role="alert" className="text-sm text-critical">{t('board.card.saveError')}</p> : null}
        </div>
        <CardAttachments key={card.id} cardId={card.id} projectId={projectId} />
        <CardLinkList title={t('board.card.references')} links={card.references} onSelect={onSelectCard} />
        <CardLinkList title={t('board.card.referencedBy')} links={card.referencedBy} onSelect={onSelectCard} />
        </> : null}
        {tab === 'activity' ? <CardNotes projectId={projectId} cardId={card.id} /> : null}
        {tab === 'sessions' ? (
        <div className="flex flex-col gap-1.5">
          <h3 className="text-xs font-medium tracking-wide text-ink-faint uppercase">
            {t('board.card.sessions.title')}
          </h3>
          {card.conversations.length === 0 ? (
            <p className="text-sm text-ink-faint">{t('board.card.sessions.none')}</p>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {card.conversations.map((session) => (
                <li key={session.id}>
                  <Link
                    to={`/p/${projectId}/c/${session.id}`}
                    aria-current={session.id === currentConversationId ? 'page' : undefined}
                    className={cx(
                      'flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-surface-high',
                      // Celle d'où l'on regarde est marquée : sans quoi la liste des
                      // sessions d'une carte ne dit pas où l'on se trouve dedans.
                      session.id === currentConversationId && 'bg-accent-wash',
                    )}
                  >
                    <AgentIcon agent={session.agent} size={14} />
                    <span
                      className={cx(
                        'min-w-0 flex-1 truncate text-sm',
                        session.archivedAt ? 'text-ink-faint' : 'text-ink-soft',
                      )}
                    >
                      {session.title}
                    </span>
                    {session.worktreeName ? (
                      <span className="flex shrink-0 items-center gap-1 font-mono text-meta text-ink-faint">
                        <GitBranch size={11} />
                        {session.worktreeName}
                      </span>
                    ) : null}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
        ) : null}
      </div>

      <footer className="flex shrink-0 flex-wrap items-center gap-2 border-t border-line bg-sunken/40 px-5 py-3">
        {editVisible ? <>
          <p className="min-w-0 flex-1 text-xs text-ink-faint" role="status">{t(dirty ? 'board.card.draft' : 'board.editor.saved')}</p>
          <Button size="sm" variant="ghost" disabled={saving} onClick={() => { setDraft(null); setEditing(false) }}>{t('board.card.cancel')}</Button>
          <Button size="sm" disabled={!dirty || !title.trim() || saving} onClick={save}>{t(saving ? 'board.card.saving' : 'board.card.save')}</Button>
        </> : <>
          <p className="min-w-0 flex-1 text-xs text-ink-faint">{t('board.card.author', { name: card.createdByName })}</p>
          <IconButton label={t('board.card.remove')} size="sm" disabled={deleteCard.isPending} onClick={() => {
            if (!confirm(translate('board.card.remove.confirm', { number: card.number }))) return
            deleteCard.mutate(card.id, { onSuccess: onDeleted })
          }}><Trash2 size={14} /></IconButton>
        </>}
        {deleteCard.isError ? <p role="alert" className="w-full text-sm text-critical">{t('board.files.error')}</p> : null}
      </footer>
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

/** L'état d'une carte citée, sans le poids d'une pastille pleine dans une liste. */
function ColumnDot({ column }: { column: CardColumn }) {
  const tone = COLUMN_TONES[column]
  return (
    <span
      title={columnLabel(column)}
      className={cx(
        'size-1.5 shrink-0 rounded-full',
        tone === 'accent' && 'bg-accent',
        tone === 'caution' && 'bg-caution',
        tone === 'positive' && 'bg-positive',
        tone === 'neutral' && 'bg-line-strong',
      )}
    />
  )
}
