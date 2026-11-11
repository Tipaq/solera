/* PROTOTYPE — jetable (branche proto/page-projet). Ne pas fusionner dans main.
 *
 * Variante `combo`, retenue par Tim le 2026-11-11 : le phare en tuile — anneau, vagues
 * nommées, sessions, l'action en bouton, la file à sa droite —, et tout le reste en
 * lignes denses. Une seule surface teintée sur la page : c'est elle qu'on regarde en
 * premier.
 *
 * Chaque bloc a une largeur de lecture : la page reste alignée sur la rangée d'onglets,
 * à gauche, mais rien ne s'étire sur toute la largeur d'un grand écran — c'est ce qui
 * rejetait sessions, PR et gestes loin de la ligne qu'ils servent.
 */
import { ArrowRight, ArrowUpRight, Check } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { Button, cx } from '@solera/ui'
import { relativeDate } from '../../../lib/dates'
import { STATE_DOT, STATE_LABEL, useProtoHref } from '../../prototype-milestones/model'
import type { V2Data, V2Milestone, V2Session, V2Wave } from './data'
import { Events } from './Dense'
import { AskInbox } from '../../../components/prototype/AskInbox'
import { ProjectActionsBlock } from '../../../components/prototype/ProjectActions'
import { CodeGraph } from './CodeGraph'
import { MaturityTag, Ring, SESSION_DOT, SESSION_WORD, WaitingMark } from './parts'
import { AgentIcon } from '../../../components/AgentIcon'

export function Combo({ data }: { data: V2Data }) {
  return (
    <div className="h-full overflow-y-auto">
      <div className="flex flex-col gap-10 p-4 md:p-6">
        <AskInbox items={data.inbox} />
        <Phare data={data} />
        <div className="grid gap-10 xl:grid-cols-[minmax(0,1fr)_24rem]">
          <section className="flex min-w-0 flex-col gap-3">
            <h2 className="text-xs font-medium text-ink-faint">Code en cours</h2>
            <CodeGraph data={data} />
          </section>
          <div className="flex min-w-0 flex-col gap-10">
            <ProjectActionsBlock projectId={data.projectId} />
            <Events data={data} />
          </div>
        </div>
      </div>
    </div>
  )
}

function Phare({ data }: { data: V2Data }) {
  const href = useProtoHref()
  const timeline = href(`/p/${data.projectId}/timeline`)
  if (!data.current) {
    return (
      <section className="rounded-2xl bg-surface p-6">
        <p className="text-sm text-ink-faint">Aucun jalon ouvert. Lance une idée dans une conversation : « idée : … ».</p>
      </section>
    )
  }
  return (
    <section className="grid gap-8 rounded-2xl bg-surface p-6 lg:grid-cols-[minmax(0,1fr)_17rem]">
      <Current milestone={data.current} />
      <aside className="flex flex-col gap-6 lg:border-l lg:border-line lg:pl-8">
        <Queue title="Ensuite" items={data.next} />
        <Queue title="Plus tard" items={data.later} />
        <Link to={timeline} className="mt-auto inline-flex items-center gap-1 text-xs text-ink-faint hover:text-ink">
          Tous les jalons{data.delivered ? ` · ${data.delivered} livrés` : ''}
          <ArrowUpRight size={12} />
        </Link>
      </aside>
    </section>
  )
}

function Current({ milestone }: { milestone: V2Milestone }) {
  const navigate = useNavigate()
  const { entry, waves, sessions, action, progress, to, waiting } = milestone
  return (
    <div className="flex min-w-0 flex-col gap-6">
      {/* L'identité du jalon : l'anneau, puis ce qu'il est, où il en est, et qui y travaille. */}
      <div className="flex items-start gap-5">
        <Ring value={progress} size={88} stroke={8}>
          <span className="flex flex-col items-center">
            <span className="text-heading font-semibold tabular-nums">{Math.round(progress * 100)}%</span>
            <span className="text-meta text-ink-faint tabular-nums">{entry.done}/{entry.cards.length}</span>
          </span>
        </Ring>
        <div className="flex min-w-0 flex-col gap-1.5 pt-1">
          <span className="flex items-center gap-3">
            <span className="text-xs font-medium text-ink-faint">Jalon en cours</span>
            <MaturityTag maturity={entry.maturity} />
          </span>
          <Link to={to} className="truncate text-lg font-semibold tracking-tight hover:text-accent">
            {entry.card.title}
          </Link>
          <span className="text-xs text-ink-faint">
            #{entry.card.number} · {entry.card.dueAt ? `échéance ${relativeDate(entry.card.dueAt)}` : 'sans échéance'}
            {entry.addedSinceLaunch.length ? ` · +${entry.addedSinceLaunch.length} depuis le lancement` : ''}
          </span>
          <Sessions sessions={sessions} />
        </div>
      </div>

      <Waves waves={waves} concurrency={milestone.concurrency} />

      {/* Le geste suivant. Une demande en attente ne se redit pas ici : le repère y mène. */}
      {waiting ? (
        <div className="flex flex-wrap items-center gap-3">
          <WaitingMark waiting={waiting} />
          <span className="text-sm text-ink-soft">Le jalon reprend dès ta réponse.</span>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm" icon={<ArrowRight size={14} />} onClick={() => navigate(to)}>
            {action.label}
          </Button>
          <span className="text-sm text-ink-faint">{action.detail}</span>
        </div>
      )}
    </div>
  )
}

/**
 * Les sessions vivantes du jalon, groupées sous son titre : « 2 sessions », chaque agent
 * avec le point de son état, et le mot de la plus pressante.
 */
function Sessions({ sessions }: { sessions: V2Session[] }) {
  if (sessions.length === 0) return <span className="text-xs text-ink-faint">Aucune session ne tourne.</span>
  const awaiting = sessions.filter((session) => session.tone === 'awaiting').length
  return (
    <span className="flex flex-wrap items-center gap-2 text-xs text-ink-soft">
      <span>
        {sessions.length} session{sessions.length > 1 ? 's' : ''}
        {awaiting ? <span className="text-caution"> · {awaiting} t'attend</span> : null}
      </span>
      <span className="flex items-center gap-1">
        {sessions.slice(0, 6).map((session) => (
          <Link
            key={session.id}
            to={session.to}
            title={`${session.title} — ${SESSION_WORD[session.tone]}`}
            className="inline-flex h-6 items-center gap-1.5 rounded-full bg-canvas px-2 ring-1 ring-line hover:ring-line-strong"
          >
            <AgentIcon agent={session.agent} size={12} decorative />
            <span aria-hidden className={cx('size-1.5 rounded-full', SESSION_DOT[session.tone], session.tone === 'running' && 'animate-pulse')} />
            <span className="max-w-[9rem] truncate">{session.title.replace(/^#\d+\s*/, '')}</span>
          </Link>
        ))}
        {sessions.length > 6 ? <span className="text-ink-faint">+{sessions.length - 6}</span> : null}
      </span>
    </span>
  )
}

/**
 * Les vagues du jalon, lisibles : chacune nommée et comptée (« Vague 2 · 1/3 »), ses
 * cartes en pastilles de la couleur de leur état, le numéro au survol. La vague en cours
 * — la première qui a encore du travail — est mise en avant ; les livrées s'effacent.
 */
function Waves({ waves, concurrency }: { waves: V2Wave[]; concurrency: number }) {
  if (waves.length === 0) return <p className="text-sm text-ink-faint">Pas encore découpé en cartes.</p>
  const current = waves.findIndex((wave) => wave.open > 0)
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs text-ink-faint">
        {waves.length} vague{waves.length > 1 ? 's' : ''} · {concurrency} carte{concurrency > 1 ? 's' : ''} à la fois au plus
      </span>
      <ol className="flex flex-wrap items-stretch gap-2">
        {waves.map((wave, index) => {
          const total = wave.cards.length
          const done = total - wave.open
          const isCurrent = index === current
          const finished = wave.open === 0
          return (
            <li key={wave.index} className="flex items-center gap-2">
              <div
                className={cx(
                  'flex min-w-[7.5rem] flex-col gap-2 rounded-xl px-3 py-2.5',
                  isCurrent ? 'bg-canvas ring-1 ring-accent/50' : 'ring-1 ring-line',
                  finished && 'opacity-60',
                )}
              >
                <span className={cx('flex items-center gap-1.5 text-xs', isCurrent ? 'font-medium text-ink' : 'text-ink-faint')}>
                  {finished ? <Check size={12} className="text-positive" /> : null}
                  Vague {index + 1}
                  <span className="tabular-nums text-ink-faint">· {done}/{total}</span>
                  {isCurrent ? <span className="text-accent">en cours</span> : null}
                </span>
                <span className="flex flex-wrap gap-1.5">
                  {wave.cards.map(({ card, state, to }) => (
                    <Link
                      key={card.id}
                      to={to}
                      title={`#${card.number} ${card.title} — ${STATE_LABEL[state]}`}
                      className={cx(
                        'size-3.5 rounded-full ring-2 ring-transparent transition-transform hover:scale-125 hover:ring-line-strong',
                        STATE_DOT[state],
                        state === 'running' && 'animate-pulse',
                      )}
                    />
                  ))}
                </span>
              </div>
              {index < waves.length - 1 ? <ArrowRight aria-hidden size={14} className="shrink-0 text-ink-faint" /> : null}
            </li>
          )
        })}
      </ol>
    </div>
  )
}

function Queue({ title, items }: { title: string; items: V2Milestone[] }) {
  return (
    <div className="flex flex-col gap-1">
      <h3 className="text-xs font-medium text-ink-faint">
        {title} <span className="tabular-nums">· {items.length}</span>
      </h3>
      {items.length === 0 ? (
        <p className="py-1 text-sm text-ink-faint">Rien pour l’instant.</p>
      ) : (
        <ul className="flex flex-col">
          {items.slice(0, 4).map((item) => (
            <li key={item.entry.card.id}>
              <Link to={item.to} className="-mx-2 flex h-8 items-center gap-3 rounded-md px-2 text-sm hover:bg-surface-high">
                <span className="min-w-0 flex-1 truncate">{item.entry.card.title}</span>
                {item.waiting ? <span aria-label={`${item.waiting.count} t'attend`} title={`${item.waiting.count} t'attend : voir « Ce qui t'attend »`} className="size-1.5 shrink-0 rounded-full bg-caution" /> : null}
                <MaturityTag maturity={item.entry.maturity} />
              </Link>
            </li>
          ))}
          {items.length > 4 ? <li className="px-0 pt-1 text-xs text-ink-faint">+{items.length - 4} autres</li> : null}
        </ul>
      )}
    </div>
  )
}
