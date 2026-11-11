/* PROTOTYPE — jetable (branche proto/page-projet). Ne pas fusionner dans main.
 *
 * Flux v2 : l'affinage d'un jalon vit dans sa page, comme une conversation — le fil de la
 * session d'affinage (ce que l'agent lit, ses questions, tes réponses en place), puis le
 * brouillon de cartes (`propose_cards`) qu'on corrige et qu'on valide. La vraie session
 * reste à un lien ; on n'a pas besoin de quitter la page.
 */
import { ArrowDown, ArrowUp, ArrowUpRight, Bot, Check, CornerDownLeft, Loader, Plus, Sparkles, X } from 'lucide-react'
import { useState } from 'react'
import { Button, cx } from '@solera/ui'
import {
  acceptAddition,
  addDraftCard,
  answerQuestion,
  dismissAddition,
  moveDraftCard,
  removeDraftCard,
  renameDraftCard,
  startRefineV2,
  toggleDraftAfter,
  validateDraft,
  type DemoRefine,
  type DraftCard,
} from './demo-store'
import type { HorizonMilestone } from './maturity'

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

export function RefineThread({
  entry,
  refine,
  demo,
  onSimulate,
  sessionHref,
}: {
  entry: HorizonMilestone
  refine: DemoRefine | undefined
  demo: boolean
  onSimulate: (text: string) => void
  /** La session d'affinage : celle de la carte, ou un brouillon qui invoque le skill. */
  sessionHref: (intent: 'refine' | 'split') => string
}) {
  const thread = refine?.thread ?? []
  const pending = (refine?.questions ?? []).filter((question) => question.answer === null)
  const draft = refine?.draft ?? null
  const addition = refine?.addition ?? null
  const idle = !refine || (thread.length === 0 && !draft && !pending.length && !addition)

  // L'état de la session d'affinage, d'après ce que le fil en dit : elle attend tes
  // réponses, elle travaille (elle lit, elle découpe), ou elle a fini (brouillon validé).
  const lastActivity = [...thread].reverse().find((message) => message.from === 'activity')
  const state: 'waiting' | 'working' | 'done' | 'none' = idle
    ? entry.cards.length > 0 ? 'done' : 'none'
    : pending.length > 0 || draft || addition
      ? 'waiting'
      : 'working'
  const STATE = {
    waiting: { word: 't’attend', dot: 'bg-caution' },
    working: { word: 'travaille', dot: 'bg-accent animate-pulse' },
    done: { word: 'terminée', dot: 'bg-positive' },
    none: { word: 'pas encore lancée', dot: 'bg-line-strong' },
  }[state]
  const [answering, setAnswering] = useState<string | null>(null)

  return (
    <section className="flex flex-col gap-3">
      {/* La session d'affinage en résumé : son état, ce qu'elle demande, et la session
          elle-même en geste principal. Le fil complet vit dans la session. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h3 className="text-sm font-semibold">Session d’affinage</h3>
        <span className="inline-flex items-center gap-1.5 text-xs text-ink-soft">
          <span aria-hidden className={cx('size-1.5 rounded-full', STATE.dot)} />
          {STATE.word}
          {refine?.mode ? <span className="text-ink-faint">· {refine.mode === 'brief' ? 'découpage direct' : 'questions d’abord'}</span> : null}
        </span>
        <span className="ml-auto flex items-center gap-2">
          {state === 'none' ? (
            <>
              <a href={sessionHref('split')} className="text-xs text-ink-faint hover:text-ink hover:underline">Découper directement</a>
              <Button size="sm" icon={<Sparkles size={14} />} onClick={() => { if (demo) startRefineV2(entry.card.id); window.location.assign(sessionHref('refine')) }}>
                Affiner avec un agent
              </Button>
            </>
          ) : (
            <a
              href={sessionHref('refine')}
              className="inline-flex h-11 items-center gap-1.5 rounded-md bg-accent px-3 text-sm font-medium text-accent-ink transition-colors hover:bg-accent/90 md:h-9 pointer-coarse:h-11"
            >
              Ouvrir la session <ArrowUpRight size={14} />
            </a>
          )}
        </span>
      </div>

      {state === 'none' ? (
        <p className="text-sm text-ink-faint">
          Une session lit le projet et ce que porte ce jalon (skill <code className="text-xs">/affiner-un-jalon</code>), pose ses questions ou propose directement un découpage.
        </p>
      ) : state === 'done' && !draft ? (
        <p className="text-sm text-ink-faint">Le jalon est découpé. « Ajouter au jalon » relance l’agent sur ce que tu ajoutes.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line rounded-lg border border-line">
          {lastActivity && state === 'working' ? (
            <li className="flex min-h-9 items-center gap-2 px-3 text-xs text-ink-faint italic">
              <Loader size={12} className="shrink-0" />
              <span className="min-w-0 truncate">{lastActivity.text}</span>
            </li>
          ) : null}
          {pending.map((question) => (
            <li key={question.id} className="flex flex-col gap-1.5 px-3 py-2">
              <span className="flex items-start gap-2 text-sm">
                <Bot size={15} className="mt-0.5 shrink-0 text-caution" />
                <span className="min-w-0 flex-1 text-ink">{question.text}</span>
                {answering === question.id ? null : (
                  <button type="button" onClick={() => setAnswering(question.id)} className="shrink-0 text-xs text-ink-faint hover:text-ink hover:underline">
                    Répondre ici
                  </button>
                )}
              </span>
              {answering === question.id ? (
                <QuestionLine
                  text=""
                  bare
                  onAnswer={(text) => {
                    setAnswering(null)
                    if (demo) answerQuestion(entry.card.id, question.id, text)
                    else onSimulate('Simulé : la réponse partirait à la session d’affinage.')
                  }}
                />
              ) : null}
            </li>
          ))}
          {!pending.length && draft ? (
            <li className="flex min-h-9 items-center gap-2 px-3 text-sm text-ink-soft">
              <Bot size={15} className="shrink-0 text-accent" />
              Un découpage attend ta validation, ci-dessous ou dans la session.
            </li>
          ) : null}
        </ul>
      )}

      {draft ? <DraftEditor milestoneId={entry.card.id} draft={draft} blocked={pending.length > 0} demo={demo} onSimulate={onSimulate} /> : null}

      {addition ? (
        <div className="flex flex-col gap-2 rounded-lg border border-accent/40 bg-accent-wash/20 px-3.5 py-3 text-sm">
          <span className="font-medium">
            {addition.kind === 'subtask' ? `Ranger dans #${addition.cardNumber}, en sous-tâche` : `${addition.cards?.length ?? 0} nouvelle(s) carte(s) dans le jalon`}
          </span>
          {addition.kind === 'cards' ? (
            <ul className="flex flex-col gap-1 text-ink-soft">
              {addition.cards?.map((card) => (
                <li key={card.title} className="flex items-center gap-2">
                  <span className="size-1.5 shrink-0 rounded-full bg-ink-faint" />
                  <span className="min-w-0 truncate">{card.title}</span>
                  <span className="shrink-0 text-xs text-ink-faint">{card.afterNumber ? `après #${card.afterNumber}` : 'peut partir tout de suite'}</span>
                </li>
              ))}
            </ul>
          ) : (
            <span className="text-ink-soft">« {addition.text.split('\n')[0]} »</span>
          )}
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => dismissAddition(entry.card.id)}>Laisser tel quel</Button>
            <Button size="sm" icon={<Check size={14} />} onClick={() => acceptAddition(entry.card.id)}>
              {addition.kind === 'subtask' ? 'Ajouter la sous-tâche' : 'Créer les cartes'}
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  )
}

function QuestionLine({ text, onAnswer, bare = false }: { text: string; onAnswer: (text: string) => void; bare?: boolean }) {
  const [value, setValue] = useState('')
  const send = () => {
    if (!value.trim()) return
    onAnswer(value.trim())
    setValue('')
  }
  const form = (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        send()
      }}
      className="ml-6 flex h-9 items-center gap-2 rounded-md border border-line px-2.5 focus-within:border-line-strong"
    >
      <input autoFocus={bare} value={value} onChange={(event) => setValue(event.target.value)} placeholder="Ta réponse" className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-ink-faint" />
      <button type="submit" aria-label="Envoyer" disabled={!value.trim()} className="text-ink-faint hover:text-ink disabled:opacity-40">
        <CornerDownLeft size={14} />
      </button>
    </form>
  )
  // Sans sa question : la ligne de la session la porte déjà.
  if (bare) return form
  return (
    <li className="flex flex-col gap-1.5">
      <span className="flex items-start gap-2 text-sm">
        <Bot size={15} className="mt-0.5 shrink-0 text-caution" />
        <span className="min-w-0 text-ink">{text}</span>
      </span>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          send()
        }}
        className="ml-6 flex h-9 items-center gap-2 rounded-md border border-line px-2.5 focus-within:border-line-strong"
      >
        <input value={value} onChange={(event) => setValue(event.target.value)} placeholder="Ta réponse" className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-ink-faint" />
        <button type="submit" aria-label="Envoyer" disabled={!value.trim()} className="text-ink-faint hover:text-ink disabled:opacity-40">
          <CornerDownLeft size={14} />
        </button>
      </form>
    </li>
  )
}

/** Le brouillon `propose_cards`, en ligne : renommer, réordonner, lier, retirer, valider. */
function DraftEditor({
  milestoneId,
  draft,
  blocked,
  demo,
  onSimulate,
}: {
  milestoneId: string
  draft: DraftCard[]
  blocked: boolean
  demo: boolean
  onSimulate: (text: string) => void
}) {
  const [adding, setAdding] = useState('')
  const letterOf = (key: string) => LETTERS[draft.findIndex((card) => card.key === key)] ?? '?'
  const guard = (run: () => void) => (demo ? run() : onSimulate('Simulé : corrigerait le brouillon de la session.'))

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline gap-2">
        <span className="text-xs font-medium tracking-wide text-ink-faint uppercase">Découpage proposé</span>
        <span className="text-xs text-ink-faint">{draft.length} carte{draft.length > 1 ? 's' : ''} · corrige, puis valide</span>
      </div>
      <ol className="flex flex-col divide-y divide-line rounded-lg border border-line">
        {draft.map((card, index) => (
          <li key={card.key} className="flex flex-col gap-1.5 px-3 py-2">
            <div className="flex min-w-0 items-center gap-2">
              <span className="grid size-6 shrink-0 place-items-center rounded-md bg-surface-high text-xs font-medium tabular-nums">{LETTERS[index]}</span>
              <input
                defaultValue={card.title}
                onBlur={(event) => event.target.value.trim() && event.target.value !== card.title && guard(() => renameDraftCard(milestoneId, card.key, event.target.value.trim()))}
                className="min-w-0 flex-1 rounded bg-transparent px-1 py-0.5 text-sm outline-none hover:bg-surface-high/50 focus:bg-surface-high/50"
              />
              <span className="flex shrink-0 items-center">
                <button type="button" aria-label="Monter" disabled={index === 0} onClick={() => guard(() => moveDraftCard(milestoneId, card.key, -1))} className="grid size-7 place-items-center rounded text-ink-faint hover:bg-surface-high hover:text-ink disabled:opacity-30">
                  <ArrowUp size={13} />
                </button>
                <button type="button" aria-label="Descendre" disabled={index === draft.length - 1} onClick={() => guard(() => moveDraftCard(milestoneId, card.key, 1))} className="grid size-7 place-items-center rounded text-ink-faint hover:bg-surface-high hover:text-ink disabled:opacity-30">
                  <ArrowDown size={13} />
                </button>
                <button type="button" aria-label="Retirer" onClick={() => guard(() => removeDraftCard(milestoneId, card.key))} className="grid size-7 place-items-center rounded text-ink-faint hover:bg-surface-high hover:text-critical">
                  <X size={13} />
                </button>
              </span>
            </div>
            {/* Les dépendances : une pastille par carte au-dessus, allumée si celle-ci l'attend. */}
            {index > 0 ? (
              <div className="ml-8 flex flex-wrap items-center gap-1 text-xs text-ink-faint">
                <span>après</span>
                {draft.slice(0, index).map((other) => (
                  <button
                    key={other.key}
                    type="button"
                    onClick={() => guard(() => toggleDraftAfter(milestoneId, card.key, other.key))}
                    title={other.title}
                    className={cx(
                      'h-6 min-w-6 rounded px-1.5 font-medium tabular-nums transition-colors',
                      card.after.includes(other.key) ? 'bg-accent/15 text-accent' : 'border border-dashed border-line hover:border-line-strong',
                    )}
                  >
                    {letterOf(other.key)}
                  </button>
                ))}
                {card.after.length === 0 ? <span className="italic">rien : part tout de suite</span> : null}
              </div>
            ) : (
              <span className="ml-8 text-xs text-ink-faint italic">part tout de suite</span>
            )}
            {card.subtasks?.length ? (
              <ul className="ml-8 flex flex-col gap-0.5 text-xs text-ink-soft">
                {card.subtasks.map((line) => (
                  <li key={line} className="flex items-center gap-1.5">
                    <span className="size-3 shrink-0 rounded-sm border border-line" />
                    <span className="min-w-0 truncate">{line}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
        <li className="px-3 py-1.5">
          <form
            onSubmit={(event) => {
              event.preventDefault()
              if (!adding.trim()) return
              guard(() => addDraftCard(milestoneId, adding.trim()))
              setAdding('')
            }}
            className="flex items-center gap-2"
          >
            <Plus size={14} className="shrink-0 text-ink-faint" />
            <input value={adding} onChange={(event) => setAdding(event.target.value)} placeholder="Ajouter une carte au brouillon" className="h-8 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-ink-faint" />
          </form>
        </li>
      </ol>
      <div className="flex items-center justify-end gap-2">
        {blocked ? <span className="text-xs text-caution">Réponds d’abord à la question ouverte.</span> : null}
        <Button size="sm" icon={<Check size={14} />} disabled={blocked} onClick={() => guard(() => validateDraft(milestoneId))}>
          Valider le découpage
        </Button>
      </div>
    </div>
  )
}
