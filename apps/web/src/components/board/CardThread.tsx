import { GitBranch, Trash2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { CardConversationDto, CardDto, CardNoteDto } from '@solera/protocol'
import { useAddCardNote, useCardNotes, useCardNoteSaving, useDeleteCardNote } from '../../lib/cards'
import { useCardNoteDraft } from '../../lib/card-drafts'
import { useCurrentUser } from '../../lib/session'
import { locale, translate, useTranslate } from '../../lib/i18n'
import { AgentIcon } from '../AgentIcon'
import { Button, IconButton, cx } from '@solera/ui'

/**
 * Le fil d'une carte : les sessions qui l'ont prise, et ce qu'elles y ont laissé.
 *
 * Une seule chronologie, la plus ancienne en haut, et la saisie au bout — on lit
 * l'histoire dans l'ordre où elle s'est faite, et on y ajoute la suite. Les sessions y
 * sont des jalons plutôt qu'une liste à part : une note se lit mieux sous la session
 * qui l'a écrite, et c'est là qu'on cherche la seconde quand on lit la première.
 *
 * Cet écran est ce qui rend l'écriture des agents acceptable. Une note qu'aucun humain
 * ne voit est exactement le magasin de mémoire refusé ailleurs dans la roadmap : elle
 * vieillit sans contradicteur et finit par tromper avec l'autorité d'une note. Ici elle
 * est signée, datée, et se supprime d'un clic.
 */
export function CardThread({
  projectId,
  card,
  currentConversationId,
}: {
  projectId: string
  card: CardDto
  /** La session depuis laquelle on lit, désignée plutôt que proposée en lien. */
  currentConversationId?: string
}) {
  const t = useTranslate()
  const cardId = card.id
  const { data: notes, isPending, isError, refetch } = useCardNotes(cardId)
  const addNote = useAddCardNote(projectId, cardId)
  const saving = useCardNoteSaving(cardId)
  const { data: user } = useCurrentUser()
  const { draft, setDraft, acknowledge } = useCardNoteDraft(user?.id ?? '', cardId)
  const body = draft?.body ?? ''

  const events: ThreadEvent[] = [
    ...card.conversations.map((session) => ({ kind: 'session' as const, at: session.createdAt, session })),
    ...(notes ?? []).map((note) => ({ kind: 'note' as const, at: note.createdAt, note })),
  ].sort((a, b) => a.at - b.at)

  const submit = () => {
    if (!draft || !body.trim() || saving) return
    void addNote.mutateAsync(body.trim())
      .then(() => acknowledge(draft))
      .catch(() => { /* Le message d'erreur reste près de la saisie. */ })
  }

  return (
    <section className="flex flex-col gap-2" aria-label={t('card.thread.title')}>
      <h3 className="text-micro font-semibold tracking-wide text-ink-faint uppercase">{t('card.thread.title')}</h3>

      {isError ? (
        <div role="alert">
          <p className="text-sm text-critical">{t('board.card.notes.loadError')}</p>
          <Button variant="ghost" size="sm" onClick={() => void refetch()}>{t('agent.install.retry')}</Button>
        </div>
      ) : null}
      {events.length > 0 ? (
        <ol className="flex flex-col">
          {events.map((event, index) => (
            <li key={event.kind === 'note' ? event.note.id : event.session.id} className="relative flex gap-2.5 pb-3">
              {/* Le trait relie les pastilles : c'est lui qui fait d'une liste un fil. */}
              {index < events.length - 1 ? <span aria-hidden className="absolute top-6 bottom-0 left-2.5 w-px bg-line" /> : null}
              {event.kind === 'note'
                ? <Note note={event.note} projectId={projectId} cardId={cardId} />
                : <Session session={event.session} projectId={projectId} current={event.session.id === currentConversationId} />}
            </li>
          ))}
        </ol>
      ) : isPending ? (
        <p className="text-sm text-ink-faint">{t('board.card.notes.loading')}</p>
      ) : (
        <p className="text-sm text-ink-faint">{t('card.thread.none')}</p>
      )}

      <textarea
        value={body}
        rows={2}
        aria-label={t('board.card.notes.add')}
        placeholder={t('board.card.notes.placeholder')}
        maxLength={8000}
        onChange={(event) => setDraft(event.target.value ? { body: event.target.value } : null)}
        className="w-full resize-y rounded-md border border-line bg-sunken px-2.5 py-2 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-line-strong"
      />
      {body.trim() ? (
        <>
          <Button size="sm" className="self-start" disabled={saving} onClick={submit}>
            {t(saving ? 'board.card.saving' : 'board.card.notes.add')}
          </Button>
          <p className="text-xs text-ink-faint">{t('board.card.notes.draft')}</p>
        </>
      ) : null}
      {addNote.isError ? <p role="alert" className="text-sm text-critical">{t('board.card.notes.saveError')}</p> : null}
    </section>
  )
}

type ThreadEvent =
  | { kind: 'note'; at: number; note: CardNoteDto }
  | { kind: 'session'; at: number; session: CardConversationDto }

function when(at: number): string {
  return new Date(at).toLocaleString(locale(), { dateStyle: 'short', timeStyle: 'short' })
}

function Dot({ children }: { children: ReactNode }) {
  return (
    <span className="relative z-10 mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border border-line bg-surface">
      {children}
    </span>
  )
}

function Session({ session, projectId, current }: { session: CardConversationDto; projectId: string; current: boolean }) {
  const t = useTranslate()
  return (
    <>
      <Dot><AgentIcon agent={session.agent} size={11} decorative /></Dot>
      <div className="min-w-0 flex-1">
        <p className="text-meta text-ink-faint">{t('card.thread.session', { when: when(session.createdAt) })}</p>
        {current ? (
          <p className="flex min-w-0 items-center gap-1.5 text-sm text-ink">
            <span className="min-w-0 truncate">{session.title}</span>
            <span className="shrink-0 text-meta text-accent">{t('card.thread.thisSession')}</span>
          </p>
        ) : (
          <Link
            to={`/p/${projectId}/c/${session.id}`}
            className={cx('flex min-w-0 items-center gap-1.5 text-sm hover:text-ink', session.archivedAt ? 'text-ink-faint' : 'text-ink-soft')}
          >
            <span className="min-w-0 truncate">{session.title}</span>
            {session.worktreeName ? (
              <span className="flex shrink-0 items-center gap-1 font-mono text-meta text-ink-faint">
                <GitBranch size={11} />{session.worktreeName}
              </span>
            ) : null}
          </Link>
        )}
      </div>
    </>
  )
}

function Note({
  note,
  projectId,
  cardId,
}: {
  note: CardNoteDto
  projectId: string
  cardId: string
}) {
  const t = useTranslate()
  const remove = useDeleteCardNote(projectId, cardId)

  return (
    <>
      <Dot>
        {note.author.kind === 'agent'
          ? <AgentIcon agent={note.author.agent} size={11} decorative />
          : <span className="text-micro font-semibold text-ink-soft">{note.author.name.slice(0, 1).toUpperCase()}</span>}
      </Dot>
      <div className="group/note min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-meta text-ink-faint">
          {note.author.kind === 'agent' ? (
            // Le lien tombe avec la conversation supprimée ; la note, elle, reste.
            note.author.conversationId ? (
              <Link to={`/p/${projectId}/c/${note.author.conversationId}`} className="min-w-0 truncate hover:text-ink">
                {note.author.conversationTitle}
              </Link>
            ) : (
              <span className="min-w-0 truncate">{t('board.card.notes.goneSession')}</span>
            )
          ) : (
            <span className="min-w-0 truncate">{note.author.name}</span>
          )}
          <span aria-hidden>·</span>
          <span className="shrink-0">{when(note.createdAt)}</span>
          <div className="flex-1" />
          <IconButton
            label={t('board.card.notes.remove')}
            size="sm"
            className="opacity-0 group-hover/note:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100"
            disabled={remove.isPending}
            onClick={() => {
              if (!confirm(translate('board.card.notes.removeConfirm'))) return
              remove.mutate(note.id)
            }}
          >
            <Trash2 size={14} />
          </IconButton>
        </div>
        <p className="mt-0.5 rounded-md border border-line bg-sunken px-2.5 py-2 text-sm leading-relaxed whitespace-pre-wrap text-ink-soft">{note.body}</p>
        {remove.isError ? <p role="alert" className="mt-1 text-sm text-critical">{t('board.card.notes.removeError')}</p> : null}
      </div>
    </>
  )
}
