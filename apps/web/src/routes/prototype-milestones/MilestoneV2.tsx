/* PROTOTYPE — jetable (branche proto/page-projet). Ne pas fusionner dans main. */
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CircleAlert,
  Flag,
  GitMerge,
  GitPullRequest,
  Hand,
  Laptop,
  MessageCircleQuestion,
  Pause,
  Play,
  Plus,
  Sparkles,
  Square,
  X,
} from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import type { CardDto } from '@solera/protocol'
import { DEFAULT_MILESTONE_CONCURRENCY, MAX_MILESTONE_CONCURRENCY } from '@solera/protocol'
import { Badge, Button, EmptyState, cx } from '@solera/ui'
import { AgentIcon } from '../../components/AgentIcon'
import { elapsed, formatDay, relativeDate } from '../../lib/dates'
import { useMilestonePlan } from '../../lib/milestones'
import { DemoNotice } from './gantt'
import { WaveGraph } from './waves'
import { DemoToggle, MaturityPill } from './HorizonVariant'
import { ExplainedSteps } from './MaturityExplain'
import { MATURITIES, MATURITY_LABEL, horizonOf, nextAction, type HorizonMilestone } from './maturity'
import { STATE_DOT, awaitsMe, isOpen, liveSessions, stateOf, useProtoData, useProtoHref } from './model'
import { cardDestination } from './destination'
import { CardInfoButton } from './CardDrawer'
import { DemoControls } from './DemoControls'
import { useMilestoneFlagsVersion } from './flags'
import { AddToMilestoneDrawer } from './MilestoneComposer'
import { RefineThread } from './RefineThread'
import { refinePrompt, refineSessionPath } from './refineSession'
import {
  acceptCard,
  addCardToMilestone,
  answerBlock,
  answerQuestion,
  clarifyCard,
  launchMilestone,
  mergeMilestonePr,
  removeBlock,
  removeDraftCard,
  renameDraftCard,
  runStatusOf,
  setPaused,
  setRunConfined,
  setRunMode,
  startCard,
  startRefine,
  startRefineV2,
  validateDraft,
  type DemoRun,
  type DraftCard,
  type RunStatus,
} from './demo-store'

type Mode = 'manual' | 'auto'

/*
  Le vrai modèle de main (#140–#146, `packages/protocol/src/environments.ts`) : deux axes,
  où tourne la session (hôte ou dev container) et si elle y est confinée. Une session
  confinée tourne sans demandes d'autorisation, et c'est ce qui rend l'autonome autonome.
  Le proto liste les quatre ; le vrai panneau ne montrera que ceux que le serveur sait
  lancer (`/api/projects/:id/environments`), et partira du réglage du projet.
*/
type Env = 'host' | 'host.confined' | 'devcontainer' | 'devcontainer.confined'
const ENVS: { key: Env; label: string; hint: string }[] = [
  { key: 'host', label: 'Hôte', hint: 'Sur cette machine, comme aujourd’hui' },
  { key: 'host.confined', label: 'Hôte confiné', hint: 'Cette machine, sous bwrap : son worktree seulement' },
  { key: 'devcontainer', label: 'Dev container', hint: 'Le conteneur du projet, partagé par les sessions' },
  { key: 'devcontainer.confined', label: 'Dev container confiné', hint: 'Un conteneur éphémère par session, son worktree monté' },
]
const confinedEnv = (env: Env) => env.endsWith('.confined')

/**
 * La vue d'un jalon, v2 : sa maturité et l'action qu'elle appelle, son graphe en vagues
 * de parallélisme, son affinage, et le panneau **Lancer** — à la main ou autonome.
 *
 * En démo (`?demo=1`), chaque geste agit sur le magasin à états (`demo-store.ts`) : on
 * peut faire le parcours entier d'un jalon, de l'idée à la PR fusionnée. Hors démo, les
 * gestes restent des stubs.
 */
/**
 * `flux="v3"` (PROTOTYPE, variante `jalon-v3`) : l'affinage en fil de conversation
 * (`RefineThread`) et « Ajouter au jalon » ; le reste de la page est le même.
 */
export function MilestoneV2({ flux }: { flux?: 'v3' } = {}) {
  const { projectId, number } = useParams()
  const href = useProtoHref()
  const data = useProtoData(projectId)
  useMilestoneFlagsVersion()
  // Une idée (drapeau jalon, pas d'enfants) a aussi sa page : c'est d'ici qu'on l'affine.
  const entry = useMemo(() => horizonOf(data).find((candidate) => String(candidate.card.number) === number) ?? null, [data, number])
  const { data: plan } = useMilestonePlan(entry?.card.id ?? '', Boolean(entry) && !data.demo && (entry?.cards.length ?? 0) > 0)
  const [concurrency, setConcurrency] = useState(data.runConcurrency.get(entry?.card.id ?? '') ?? DEFAULT_MILESTONE_CONCURRENCY)
  const [adding, setAdding] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const navigate = useNavigate()
  const v3 = flux === 'v3'

  if (data.isPending) return null
  if (!projectId || !entry) {
    return <EmptyState icon={<Flag size={22} />} title={`#${number} n’est pas un jalon`} description={data.demo ? '' : 'Avec ?demo=1, essaie /timeline/901, 909, 919 ou 923.'} />
  }

  const action = nextAction(entry)
  const open = entry.cards.filter(isOpen)
  const branch = plan?.branch ?? `jalon/${entry.card.number}-${slug(entry.card.title)}`
  const refine = data.refine[entry.card.id]
  const pending =
    entry.questions.length + entry.toClarify.length + entry.notAccepted.length + entry.cycle.length > 0 ||
    entry.draft !== null ||
    entry.run?.blocked != null ||
    (v3 && (Boolean(refine?.addition) || (entry.cards.length === 0 && entry.maturity === 'idea')))
  const refineBlock = v3 ? (
    <div className="flex flex-col gap-5">
      <RefineThread
        entry={entry}
        refine={refine}
        demo={data.demo}
        onSimulate={setNotice}
        sessionHref={(intent) => href(refineSessionPath(projectId ?? '', entry.card, refinePrompt({ number: entry.card.number, intent, brief: entry.card.description })))}
      />
      <Refine entry={entry} demo={data.demo} rest />
    </div>
  ) : (
    <Refine entry={entry} demo={data.demo} />
  )

  const go = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  const act = () => {
    switch (entry.maturity) {
      case 'idea':
        if (v3) {
          // Flux v3 : l'affinage part en session, sur la carte du jalon, avec le skill.
          if (data.demo) startRefineV2(entry.card.id)
          navigate(href(refineSessionPath(projectId, entry.card, refinePrompt({ number: entry.card.number, intent: 'refine', brief: entry.card.description }))))
          return
        }
        if (data.demo) startRefine(entry.card.id)
        else window.location.assign(href(cardDestination(projectId, entry.card)))
        return
      case 'refine':
      case 'split':
        return go('affinage')
      case 'ready':
        return go('lancer')
      case 'launched':
        if (entry.run?.prOpen && data.demo) return mergeMilestonePr(entry.card.id)
        return go(entry.run?.blocked ? 'affinage' : 'lancer')
      case 'delivered':
        return
    }
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="flex flex-col gap-5 p-4 md:p-6">
        <div className="flex flex-wrap items-center gap-3">
          <Link to={href(`/p/${projectId}/timeline?variant=${v3 ? 'flux-v2' : 'horizon'}`)} className="inline-flex items-center gap-1 rounded text-xs text-ink-faint hover:text-ink">
            <ArrowLeft size={13} /> Jalons
          </Link>
          <span className="ml-auto flex flex-wrap items-center gap-2">
            <DemoControls />
            <DemoNotice demo={data.demo} />
            <DemoToggle demo={data.demo} />
          </span>
        </div>

        <header className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          <Flag size={18} className={cx('shrink-0', entry.maturity === 'launched' ? 'text-accent' : 'text-ink-faint')} />
          <h2 className="min-w-0 text-lg leading-snug font-semibold">
            <span className="text-ink-faint tabular-nums">#{entry.card.number}</span> {entry.card.title}
          </h2>
          <CardInfoButton card={entry.card} />
          <MaturityPill maturity={entry.maturity} />
          <span className="text-sm text-ink-soft">
            {entry.card.dueAt === null ? 'sans échéance' : `échéance ${formatDay(entry.card.dueAt)} · ${relativeDate(entry.card.dueAt)}`}
          </span>
          {entry.addedSinceLaunch.length ? (
            <Badge tone="caution">+{entry.addedSinceLaunch.length} depuis le lancement</Badge>
          ) : null}
          {v3 && entry.maturity !== 'delivered' ? (
            <span className="ml-auto">
              <Button size="sm" variant="secondary" icon={<Plus size={14} />} onClick={() => setAdding(true)}>Ajouter au jalon</Button>
            </span>
          ) : null}
        </header>

        {notice ? (
          <p className="flex items-center gap-2 rounded-md bg-fuchsia-500/10 px-3 py-2 text-sm text-fuchsia-700 dark:text-fuchsia-300">
            <span className="min-w-0 flex-1">{notice}</span>
            <button type="button" onClick={() => setNotice(null)} className="text-xs hover:underline">Fermer</button>
          </p>
        ) : null}
        {v3 ? (
          <AddToMilestoneDrawer open={adding} onClose={() => setAdding(false)} milestoneId={entry.card.id} title={`#${entry.card.number} ${entry.card.title}`} demo={data.demo} onSimulate={setNotice} cards={data.cards} />
        ) : null}

        {data.demo ? <Journey entry={entry} /> : null}

        <MaturityBand entry={entry} action={action} onAct={entry.maturity === 'delivered' ? null : act} explain={v3} />

        {/* Une colonne au téléphone — affinage en attente, vagues, Lancer, puis le reste —,
            et Lancer à droite au large, collé en haut pendant qu'on lit le graphe. */}
        <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
          {pending ? <div id="affinage" className="min-w-0 scroll-mt-4 xl:col-start-1">{refineBlock}</div> : null}
          <div className="min-w-0 xl:col-start-1">
            <Waves projectId={projectId} cards={entry.cards} concurrency={entry.run?.concurrency ?? concurrency} href={href} launchedAt={entry.launchedAt} />
          </div>
          <div id="lancer" className="min-w-0 scroll-mt-4 xl:sticky xl:top-0 xl:col-start-2 xl:row-span-3 xl:row-start-1">
            <LaunchPanel
              entry={entry}
              open={open}
              branch={branch}
              concurrency={concurrency}
              setConcurrency={setConcurrency}
              projectId={projectId}
              href={href}
              demo={data.demo}
            />
          </div>
          {pending ? null : <div id="affinage" className="min-w-0 scroll-mt-4 xl:col-start-1">{refineBlock}</div>}
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ parcours */

const JOURNEY = [
  { key: 'add', label: 'Ajouter', hint: '« + Jalon » dans l’horizon : il arrive en Idée.' },
  { key: 'refine', label: 'Affiner', hint: 'L’agent pose ses questions ; tu réponds dans Affinage.' },
  { key: 'split', label: 'Découper', hint: 'L’agent propose des cartes : corrige le brouillon, puis valide.' },
  { key: 'clarify', label: 'Préciser', hint: 'Réponds aux cartes à préciser, accepte, défais un cycle.' },
  { key: 'launch', label: 'Lancer', hint: 'À la main ou autonome, confiné ou non : panneau Lancer.' },
  { key: 'run', label: 'Suivre', hint: 'Les cartes avancent par vagues ; réponds aux blocages, ajoute, mets en pause.' },
  { key: 'merge', label: 'Livrer', hint: 'La PR du jalon vers main est ouverte : fusionne-la.' },
] as const

function journeyStep(entry: HorizonMilestone): number {
  switch (entry.maturity) {
    case 'idea':
      return 1
    case 'refine':
      return entry.draft ? 2 : 1
    case 'split':
      return 3
    case 'ready':
      return 4
    case 'launched':
      return entry.run?.prOpen ? 6 : 5
    case 'delivered':
      return 7
  }
}

/** La frise du parcours (démo) : où on en est, et le geste suivant. */
function Journey({ entry }: { entry: HorizonMilestone }) {
  const at = journeyStep(entry)
  const step = JOURNEY[Math.min(at, JOURNEY.length - 1)]!
  return (
    <section className="flex flex-col gap-2 rounded-xl border border-dashed border-fuchsia-500/50 bg-fuchsia-500/[0.04] px-3.5 py-3">
      <div className="flex items-center gap-2 text-xs">
        <span className="font-medium text-fuchsia-700 dark:text-fuchsia-300">Parcours de démo</span>
        <span className="text-ink-faint">
          {at >= JOURNEY.length ? 'Terminé : le jalon est livré. « Réinitialiser la démo » pour recommencer.' : `Étape ${at + 1}/${JOURNEY.length} · ${step.hint}`}
        </span>
      </div>
      <ol className="flex flex-wrap items-center gap-1 text-xs">
        {JOURNEY.map((entryStep, index) => (
          <li key={entryStep.key} className="flex items-center gap-1">
            <span
              className={cx(
                'inline-flex items-center gap-1 rounded-full px-2 py-0.5',
                index < at ? 'text-ink-soft' : index === at ? 'bg-fuchsia-500/15 font-semibold text-ink' : 'text-ink-faint',
              )}
            >
              {index < at ? <Check size={11} className="text-positive" /> : <span className="tabular-nums">{index + 1}</span>}
              {entryStep.label}
            </span>
            {index < JOURNEY.length - 1 ? <ArrowRight size={11} className="text-ink-faint/60" /> : null}
          </li>
        ))}
      </ol>
    </section>
  )
}

/* ------------------------------------------------------------------ maturité */

function MaturityBand({ entry, action, onAct, explain = false }: { entry: HorizonMilestone; action: { label: string; detail: string }; onAct: (() => void) | null; explain?: boolean }) {
  const at = MATURITIES.indexOf(entry.maturity)
  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-accent/30 bg-accent-wash/25 p-4 md:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-xs font-medium tracking-wide text-accent uppercase">Prochaine action</span>
          <p className="text-lg leading-snug font-semibold text-ink md:text-xl">{action.detail}</p>
        </div>
        {onAct ? <Button className="shrink-0 self-start sm:self-center" onClick={onAct}>{action.label}</Button> : null}
      </div>
      {/* Flux v3 : chaque étape s'ouvre sur sa fiche (pourquoi ici, comment passer à la suivante). */}
      {explain ? <ExplainedSteps entry={entry} action={action} onAct={onAct} /> : (
      /* Les six étapes. Au doigt, six libellés se marchaient dessus : les barres seules,
          et l'étape courante écrite en clair au-dessous. */
      <div className="flex flex-col gap-1.5">
        <ol className="grid grid-cols-6 gap-1">
          {MATURITIES.map((step, index) => (
            <li key={step} className="flex min-w-0 flex-col gap-1.5">
              <span className={cx('h-1.5 rounded-full', index < at ? 'bg-accent/50' : index === at ? 'bg-accent' : 'bg-surface-high')} />
              <span className={cx('hidden items-center gap-1 truncate text-xs sm:flex', index === at ? 'font-semibold text-ink' : index < at ? 'text-ink-soft' : 'text-ink-faint')}>
                {index < at ? <Check size={11} className="shrink-0 text-accent" /> : null}
                {MATURITY_LABEL[step]}
              </span>
            </li>
          ))}
        </ol>
        <span className="text-xs text-ink-soft sm:hidden">
          Étape {at + 1}/6 · <span className="font-semibold text-ink">{MATURITY_LABEL[entry.maturity]}</span>
        </span>
      </div>
      )}
    </section>
  )
}

/* ------------------------------------------------------------------ vagues */

/**
 * Le graphe en couches, surmonté de l'en-tête de ses vagues : combien de cartes partent
 * ensemble, et en combien de passes à la concurrence choisie.
 */
function Waves({
  projectId,
  cards,
  concurrency,
  href,
  launchedAt,
}: {
  projectId: string
  cards: CardDto[]
  concurrency: number
  href: (path: string) => string
  launchedAt: number | null
}) {
  const shown = cards.filter((card) => card.column !== 'abandoned')

  return (
    <section className="flex min-w-0 flex-col gap-2">
      <div className="flex items-baseline gap-2">
        <h3 className="text-sm font-semibold">Vagues</h3>
        <span className="text-xs text-ink-faint">ce qui part ensemble, de gauche à droite · {concurrency} à la fois</span>
      </div>
      {shown.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line px-3.5 py-4 text-sm text-ink-faint">
          Pas encore découpé. L'affinage proposera des cartes et leur ordre.
        </p>
      ) : (
        <div className="rounded-xl border border-line p-3 md:p-4">
          <WaveGraph projectId={projectId} cards={shown} concurrency={concurrency} href={href} launchedAt={launchedAt} />
        </div>
      )}
    </section>
  )
}

/* ------------------------------------------------------------------ affinage */

/**
 * Tout ce qui attend une réponse : les questions de l'agent, son brouillon de découpage,
 * les cartes à préciser ou à accepter, un cycle à défaire, et la session bloquée d'un
 * jalon lancé. En démo chaque réponse agit ; hors démo, elle se marque seulement.
 */
function Refine({ entry, demo, rest = false }: { entry: HorizonMilestone; demo: boolean; rest?: boolean }) {
  const [answered, setAnswered] = useState<ReadonlySet<string>>(() => new Set())
  const mark = (id: string) => setAnswered((current) => new Set(current).add(id))
  const blocked = entry.run?.blocked ?? null
  const cycleLinks = entry.cycle.flatMap((card) =>
    card.blockedBy.filter((blocker) => entry.cycle.some((other) => other.id === blocker.id)).map((blocker) => ({ card, blocker })),
  )
  const questions = rest ? [] : entry.questions
  const draftShown = rest ? null : entry.draft
  const items = questions.length + entry.toClarify.length + entry.notAccepted.length + (draftShown ? 1 : 0) + (blocked ? 1 : 0) + (cycleLinks.length ? 1 : 0)
  // Dans le flux v3, le fil porte les questions et le brouillon : ce bloc ne dit que le reste, et se tait s'il n'y a rien.
  if (rest && items === 0) return null

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-baseline gap-2">
        <h3 className="text-sm font-semibold">{rest ? 'À régler avant de partir' : 'Affinage'}</h3>
        <span className="text-xs text-ink-faint">
          {items === 0 ? 'rien en attente' : `${items} point${items > 1 ? 's' : ''} en attente`}
        </span>
      </div>
      {items === 0 ? (
        <p className="text-sm text-ink-faint">Aucune question, aucune carte à préciser.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line overflow-hidden rounded-xl border border-line">
          {blocked ? (
            <Answerable
              key={`blocked-${blocked.cardId}`}
              icon={<MessageCircleQuestion size={14} className="text-caution" />}
              title={blocked.question}
              meta="une session du jalon t'attend"
              tone="caution"
              done={false}
              onDone={(text) => answerBlock(entry.card.id, text)}
              placeholder="Ta réponse à la session"
              cta="Répondre"
            />
          ) : null}
          {questions.map((question) => (
            <Answerable
              key={question.id}
              icon={<MessageCircleQuestion size={14} className="text-caution" />}
              title={question.text}
              meta={`${question.askedBy} · il y a ${elapsed(question.at)}`}
              done={answered.has(question.id)}
              onDone={(text) => (demo ? answerQuestion(entry.card.id, question.id, text) : mark(question.id))}
              placeholder="Ta réponse"
              cta="Répondre"
            />
          ))}
          {draftShown ? <DraftBlock milestoneId={entry.card.id} draft={draftShown} /> : null}
          {entry.toClarify.map((card) => (
            <Answerable
              key={card.id}
              icon={<CircleAlert size={14} className="text-caution" />}
              title={`#${card.number} ${card.title}`}
              meta={`à préciser depuis ${card.toClarifySince ? elapsed(card.toClarifySince) : '?'}`}
              done={answered.has(card.id)}
              onDone={(text) => (demo ? clarifyCard(card.id, text) : mark(card.id))}
              placeholder="La précision attendue"
              cta="Préciser"
            />
          ))}
          {entry.notAccepted.map((card) => (
            <li key={card.id} className="flex items-center gap-2 px-3 py-2.5 text-sm">
              <CircleAlert size={14} className="shrink-0 text-ink-faint" />
              <span className="min-w-0 flex-1 truncate">#{card.number} {card.title}</span>
              <span className="text-xs text-ink-faint">pas encore acceptée</span>
              {answered.has(card.id) ? (
                <Badge tone="positive">acceptée (stub)</Badge>
              ) : (
                <Button size="sm" variant="secondary" onClick={() => (demo ? acceptCard(card.id) : mark(card.id))}>Accepter</Button>
              )}
            </li>
          ))}
          {cycleLinks.length ? (
            <li className="flex flex-col gap-1.5 px-3 py-2.5 text-sm">
              <span className="flex items-center gap-2">
                <CircleAlert size={14} className="shrink-0 text-critical" />
                Cycle de blocages : aucune de ces cartes ne peut partir.
              </span>
              {cycleLinks.map(({ card, blocker }) => (
                <span key={`${card.id}-${blocker.id}`} className="flex items-center gap-2 pl-6 text-xs text-ink-soft">
                  #{blocker.number} bloque #{card.number}
                  <Button size="sm" variant="ghost" onClick={() => (demo ? removeBlock(card.id, blocker.id) : alert('Stub'))}>retirer ce lien</Button>
                </span>
              ))}
            </li>
          ) : null}
        </ul>
      )}
    </section>
  )
}

/** Le brouillon `propose_cards` de l'agent : corriger (renommer, retirer), puis valider. */
function DraftBlock({ milestoneId, draft }: { milestoneId: string; draft: DraftCard[] }) {
  return (
    <li className="flex flex-col gap-2.5 bg-accent-wash/20 px-3 py-3">
      <span className="flex items-center gap-2 text-sm">
        <Sparkles size={14} className="text-accent" />
        <span className="font-medium">Découpage proposé par l'agent</span>
        <span className="text-xs text-ink-faint">corrige, puis valide : c'est ton clic qui crée les cartes</span>
      </span>
      <ol className="flex flex-col gap-1.5 pl-6">
        {draft.map((card, index) => (
          <li key={card.key} className="flex items-center gap-2">
            <span className="w-4 shrink-0 text-xs text-ink-faint tabular-nums">{index + 1}</span>
            <input
              value={card.title}
              onChange={(event) => renameDraftCard(milestoneId, card.key, event.target.value)}
              className="min-w-0 flex-1 rounded-md border border-line bg-canvas px-2 py-1 text-sm outline-none focus:border-accent"
            />
            <span className="shrink-0 text-xs text-ink-faint">
              {card.after.length ? `après ${card.after.map((key) => draft.findIndex((entry) => entry.key === key) + 1).join(', ')}` : 'part tout de suite'}
            </span>
            <button type="button" aria-label="Retirer" onClick={() => removeDraftCard(milestoneId, card.key)} className="rounded p-1 text-ink-faint hover:text-critical">
              <X size={13} />
            </button>
          </li>
        ))}
      </ol>
      <div className="flex justify-end pl-6">
        <Button size="sm" icon={<Check size={14} />} disabled={draft.length === 0} onClick={() => validateDraft(milestoneId)}>
          Valider : créer {draft.length} carte{draft.length > 1 ? 's' : ''}
        </Button>
      </div>
    </li>
  )
}

function Answerable({
  icon,
  title,
  meta,
  done,
  onDone,
  placeholder,
  cta,
  tone,
}: {
  icon: ReactNode
  title: string
  meta: string
  done: boolean
  onDone: (text: string) => void
  placeholder: string
  cta: string
  tone?: 'caution'
}) {
  const [text, setText] = useState('')
  const [sent, setSent] = useState('')
  return (
    <li className={cx('flex flex-col gap-2 px-3 py-2.5', tone === 'caution' && 'bg-caution/[0.06]')}>
      <div className="flex flex-wrap items-start gap-x-2 gap-y-0.5 text-sm">
        <span className="mt-0.5 shrink-0">{icon}</span>
        <span className="min-w-0 flex-1 basis-48">{title}</span>
        <span className="shrink-0 pl-6 text-xs text-ink-faint sm:pl-0">{meta}</span>
      </div>
      {done ? (
        <p className="pl-6 text-xs text-positive">Envoyé à l'agent (stub) : « {sent} »</p>
      ) : (
        <form
          className="flex gap-2 pl-6"
          onSubmit={(event) => {
            event.preventDefault()
            if (!text.trim()) return
            setSent(text.trim())
            onDone(text.trim())
            setText('')
          }}
        >
          <input
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder={placeholder}
            className="min-w-0 flex-1 rounded-lg border border-line bg-canvas px-2.5 py-1.5 text-sm outline-none focus:border-accent"
          />
          <Button size="sm" variant="secondary" type="submit" disabled={!text.trim()}>{cta}</Button>
        </form>
      )}
    </li>
  )
}

/* ------------------------------------------------------------------ lancer */

const RUN_STATUS_LABEL: Record<RunStatus, string> = {
  waiting: 'attend ses bloqueurs',
  queued: 'en file',
  working: 'au travail',
  review: 'en revue',
  merged: 'fusionnée',
  blocked: "t'attend",
}

const RUN_STATUS_DOT: Record<RunStatus, string> = {
  waiting: 'bg-surface-high',
  queued: 'bg-ink-faint/50',
  working: 'bg-accent animate-pulse',
  review: 'bg-caution',
  merged: 'bg-positive',
  blocked: 'bg-critical',
}

function LaunchPanel({
  entry,
  open,
  branch,
  concurrency,
  setConcurrency,
  projectId,
  href,
  demo,
}: {
  entry: HorizonMilestone
  open: CardDto[]
  branch: string
  concurrency: number
  setConcurrency: (value: number) => void
  projectId: string
  href: (path: string) => string
  demo: boolean
}) {
  const [mode, setMode] = useState<Mode>('manual')
  // SIMULÉ : le défaut viendrait du projet (`environment`, `autonomousConfined`).
  const [env, setEnv] = useState<Env>('host')
  const [services, setServices] = useState<'shared' | 'copy'>('shared')
  const pickMode = (next: Mode) => {
    setMode(next)
    // Une session autonome est confinée par défaut (#146) : le confinement est son garde-fou.
    if (next === 'auto' && !confinedEnv(env)) setEnv(env === 'devcontainer' ? 'devcontainer.confined' : 'host.confined')
  }
  const [launched, setLaunched] = useState<ReadonlySet<string>>(() => new Set())

  if (entry.maturity === 'delivered') {
    return (
      <aside className="flex flex-col gap-2 rounded-xl border border-positive/40 bg-positive/5 p-4">
        <h3 className="flex items-center gap-2 text-sm font-semibold"><GitMerge size={15} className="text-positive" /> Livré</h3>
        <p className="text-sm text-ink-soft">{entry.done} cartes fusionnées, PR du jalon fusionnée dans main.</p>
      </aside>
    )
  }

  if (entry.maturity === 'idea' || (entry.maturity === 'refine' && entry.cards.length === 0)) {
    return (
      <aside className="flex flex-col gap-2 rounded-xl border border-line p-4">
        <h3 className="text-sm font-semibold">Lancer</h3>
        <p className="text-sm text-ink-faint">Rien à lancer tant que le jalon n'est pas découpé en cartes.</p>
      </aside>
    )
  }

  if (entry.maturity === 'launched') {
    const run = entry.run
    if (!run || !demo) {
      const live = entry.cards.reduce((sum, card) => sum + liveSessions(card).length, 0)
      return (
        <aside className="flex flex-col gap-3 rounded-xl border border-accent/50 bg-accent-wash/20 p-4">
          <div className="flex items-center gap-2">
            <span className="size-2 animate-pulse rounded-full bg-accent" />
            <h3 className="text-sm font-semibold">Lancé en autonome</h3>
            <span className="ml-auto text-xs text-ink-faint">{entry.launchedAt ? `depuis ${elapsed(entry.launchedAt)}` : ''}</span>
          </div>
          <p className="text-sm text-ink-soft">{Math.min(live, concurrency)}/{concurrency} places occupées · branche <code className="text-xs">{branch}</code></p>
          <div className="flex gap-1.5">
            <Button size="sm" variant="secondary" icon={<Pause size={14} />} onClick={() => alert('Stub')}>Pause</Button>
            <Button size="sm" variant="ghost" icon={<Square size={14} />} onClick={() => alert('Stub')}>Arrêter</Button>
          </div>
        </aside>
      )
    }
    return <RunPanel entry={entry} run={run} branch={branch} projectId={projectId} href={href} />
  }

  const checks = [
    { ok: entry.toClarify.length === 0 && entry.questions.length === 0 && !entry.draft, label: 'Rien à préciser', fail: `${entry.toClarify.length + entry.questions.length} point(s) d'affinage en attente` },
    { ok: entry.notAccepted.length === 0, label: 'Toutes les cartes acceptées', fail: `${entry.notAccepted.length} carte(s) à accepter` },
    { ok: entry.cycle.length === 0, label: 'Pas de cycle de blocages', fail: `Cycle : ${entry.cycle.map((card) => `#${card.number}`).join(', ')}` },
    { ok: entry.startable.length > 0, label: 'Au moins une carte peut partir', fail: 'Aucune carte ne peut partir' },
    { ok: true, label: `Concurrence : ${concurrency} à la fois`, fail: '' },
  ]
  const ready = checks.every((check) => check.ok)
  const envPicker = (
    <Field label="Environnement">
      <div className="flex flex-col gap-1">
        {ENVS.map((option) => (
          <label key={option.key} className={cx('flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 text-sm', env === option.key ? 'bg-accent-wash/40' : 'hover:bg-surface-high')}>
            <input type="radio" name="env" className="mt-1" checked={env === option.key} onChange={() => setEnv(option.key)} />
            <span className="flex min-w-0 flex-col">
              <span>{option.label}</span>
              <span className="text-xs text-ink-faint">{option.hint}</span>
            </span>
          </label>
        ))}
      </div>
    </Field>
  )

  /* À la main : lancer une carte ouvre le pilotage en mode manuel, pour que la carte
     livre dans la branche du jalon comme en autonome (décidé le 2026-11-10). */
  const startByHand = (card: CardDto) => {
    if (!demo) return setLaunched((current) => new Set(current).add(card.id))
    launchMilestone(entry.card.id, { mode: 'manual', confined: confinedEnv(env), concurrency })
    startCard(card.id)
  }

  return (
    <aside className="flex flex-col gap-4 rounded-xl border border-line p-4">
      <div className="flex items-baseline gap-2">
        <h3 className="text-sm font-semibold">Lancer</h3>
        <span className="text-xs text-ink-faint">à la main ou autonome, au choix</span>
      </div>

      <div role="radiogroup" aria-label="Mode de lancement" className="flex flex-col gap-1.5">
        <ModeButton active={mode === 'manual'} onClick={() => pickMode('manual')} icon={<Hand size={16} />} label="À la main" hint="Tu lances chaque carte quand tu veux" />
        <ModeButton active={mode === 'auto'} onClick={() => pickMode('auto')} icon={<Laptop size={16} />} label="Autonome" hint="Solera lance, fait relire et fusionne, vague par vague" />
      </div>

      {mode === 'manual' ? (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-ink-faint">Une session par carte, livrée dans la branche du jalon comme en autonome. Pas de pilotage, donc pas de vérification.</p>
          {envPicker}
          <ul className="flex flex-col divide-y divide-line rounded-lg border border-line">
            {open.map((card) => {
              const can = entry.startable.includes(card) && card.acceptedAt !== null
              const live = liveSessions(card)
              return (
                <li key={card.id} className={cx('flex items-center gap-2 px-2.5 py-2 text-sm', awaitsMe(card) && 'bg-caution/10')}>
                  <span className={cx('size-2 shrink-0 rounded-full', awaitsMe(card) ? 'bg-caution' : STATE_DOT[stateOf(card)])} />
                  <Link to={href(cardDestination(projectId, card))} className="min-w-0 flex-1 truncate hover:text-accent">
                    <span className="text-xs text-ink-faint tabular-nums">#{card.number}</span> {card.title}
                  </Link>
                  <CardInfoButton card={card} />
                  {live.length ? (
                    <span className="flex gap-1">{live.map((session) => <AgentIcon key={session.id} agent={session.agent} size={13} />)}</span>
                  ) : launched.has(card.id) ? (
                    <Badge tone="accent">lancée (stub)</Badge>
                  ) : can ? (
                    <Button size="sm" variant="ghost" icon={<Play size={13} />} onClick={() => startByHand(card)}>Lancer</Button>
                  ) : (
                    <span className="text-xs text-ink-faint">attend</span>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-xs text-ink-faint">
            Le serveur lance les cartes prêtes, chacune dans son worktree, les fait relire et les fusionne dans la branche du jalon.
          </p>

          <Field label="Concurrence">
            <ConcurrencyPicker value={concurrency} onChange={setConcurrency} />
          </Field>
          <Field label="Branche du jalon"><code className="truncate text-xs">{branch}</code></Field>
          <Field label="CLI">
            <span className="text-xs text-ink-soft">comme une session neuve de ce projet</span>
          </Field>
          {envPicker}
          {env === 'devcontainer.confined' ? (
            <Field label="Services">
              <select value={services} onChange={(event) => setServices(event.target.value as 'shared' | 'copy')} className="rounded-md border border-line bg-canvas px-2 py-1 text-xs">
                <option value="shared">ceux du projet, partagés</option>
                <option value="copy">une copie par session</option>
              </select>
            </Field>
          ) : null}
          {!confinedEnv(env) ? (
            <p className="rounded-md bg-caution/10 px-2.5 py-2 text-xs text-caution">
              Non confinée, chaque session te demandera ses autorisations : les cartes concernées attendront ta réponse.
            </p>
          ) : null}

          <div className={cx('flex flex-col gap-2 rounded-lg border p-3', ready ? 'border-positive/40 bg-positive/5' : 'border-caution/40 bg-caution/5')}>
            <span className={cx('text-sm font-medium', ready ? 'text-positive' : 'text-caution')}>
              {ready ? 'Prêt à partir' : `Avant de partir : ${checks.filter((check) => !check.ok).length} point(s) à régler`}
            </span>
            <ul className="flex flex-col gap-1.5">
              {/* Ce qui bloque d'abord : c'est ce qu'on vient lire ici. */}
              {[...checks].sort((a, b) => Number(a.ok) - Number(b.ok)).map((check) => (
                <li key={check.label} className={cx('flex items-start gap-2 text-sm', check.ok ? 'text-ink-soft' : 'font-medium text-ink')}>
                  {check.ok ? <Check size={14} className="mt-0.5 shrink-0 text-positive" /> : <CircleAlert size={14} className="mt-0.5 shrink-0 text-caution" />}
                  {check.ok ? check.label : check.fail}
                </li>
              ))}
            </ul>
          </div>
          <p className="text-xs text-ink-faint">En autonome, seuls les blocages te reviennent.</p>
          <Button
            disabled={!ready}
            icon={<Play size={14} />}
            onClick={() => (demo ? launchMilestone(entry.card.id, { mode: 'auto', confined: confinedEnv(env), concurrency }) : alert('Stub : rien ne se lance.'))}
          >
            Lancer en autonome
          </Button>
        </div>
      )}
    </aside>
  )
}

function ConcurrencyPicker({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  return (
    <div className="flex gap-1">
      {Array.from({ length: MAX_MILESTONE_CONCURRENCY }, (_, index) => index + 1).map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => onChange(option)}
          className={cx(
            'size-7 rounded-md text-xs tabular-nums',
            option === value ? 'bg-accent text-accent-ink' : 'border border-line text-ink-soft hover:border-line-strong',
          )}
        >
          {option}
        </button>
      ))}
    </div>
  )
}

/**
 * Le suivi d'un jalon lancé (démo) : où en est chaque carte, la bascule à la main ↔
 * autonome, le confinement, la pause, une carte à ajouter, et la PR finale.
 */
function RunPanel({
  entry,
  run,
  branch,
  projectId,
  href,
}: {
  entry: HorizonMilestone
  run: DemoRun
  branch: string
  projectId: string
  href: (path: string) => string
}) {
  const [title, setTitle] = useState('')
  const data = useProtoData(projectId)
  const busy = entry.cards.filter((card) => {
    const status = runStatusOf(data.store, card)
    return status === 'working' || status === 'review'
  }).length

  if (run.prOpen) {
    return (
      <aside className="flex flex-col gap-3 rounded-xl border border-positive/50 bg-positive/5 p-4">
        <h3 className="flex items-center gap-2 text-sm font-semibold"><GitPullRequest size={15} className="text-positive" /> PR du jalon ouverte</h3>
        <p className="text-sm text-ink-soft">
          Toutes les cartes sont fusionnées dans <code className="text-xs">{branch}</code>. Solera a ouvert la PR vers <code className="text-xs">main</code> : relis-la, puis fusionne.
        </p>
        <Button icon={<GitMerge size={14} />} onClick={() => mergeMilestonePr(entry.card.id)}>Fusionner dans main</Button>
      </aside>
    )
  }

  return (
    <aside className="flex flex-col gap-3.5 rounded-xl border border-accent/50 bg-accent-wash/20 p-4">
      <div className="flex items-center gap-2">
        <span className={cx('size-2 rounded-full', run.paused ? 'bg-caution' : 'animate-pulse bg-accent')} />
        <h3 className="text-sm font-semibold">{run.paused ? 'En pause' : run.mode === 'auto' ? 'Lancé en autonome' : 'Lancé à la main'}</h3>
        <span className="ml-auto text-xs text-ink-faint">depuis {elapsed(run.startedAt)}</span>
      </div>

      <div role="radiogroup" aria-label="Mode" className="inline-flex self-start rounded-lg border border-line p-0.5 text-xs">
        {(['manual', 'auto'] as const).map((value) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={run.mode === value}
            onClick={() => setRunMode(entry.card.id, value)}
            className={cx('rounded-md px-2.5 py-1', run.mode === value ? 'bg-surface-high font-medium text-ink' : 'text-ink-faint hover:text-ink')}
          >
            {value === 'manual' ? 'À la main' : 'Autonome'}
          </button>
        ))}
      </div>

      <p className="text-xs text-ink-soft">
        {run.mode === 'auto' ? `${busy}/${run.concurrency} places occupées` : 'Tu lances les cartes ; les sessions avancent seules'} · branche <code>{branch}</code>
      </p>
      <label className="flex items-center gap-2 text-xs text-ink-soft">
        <input type="checkbox" checked={run.confined} onChange={(event) => setRunConfined(entry.card.id, event.target.checked)} />
        Sessions confinées, sans demandes d'autorisation (pour les prochaines)
      </label>

      <ul className="flex flex-col divide-y divide-line overflow-hidden rounded-lg border border-line bg-canvas">
        {entry.cards.map((card) => {
          const status = runStatusOf(data.store, card) ?? 'merged'
          return (
            <li key={card.id} className="flex items-center gap-2 px-2.5 py-1.5 text-sm">
              <span className={cx('size-2 shrink-0 rounded-full', RUN_STATUS_DOT[status])} />
              <Link to={href(cardDestination(projectId, card))} className="min-w-0 flex-1 truncate hover:text-accent">
                <span className="text-xs text-ink-faint tabular-nums">#{card.number}</span> {card.title}
              </Link>
              <CardInfoButton card={card} />
              {run.mode === 'manual' && status === 'queued' && card.acceptedAt !== null ? (
                <Button size="sm" variant="ghost" icon={<Play size={12} />} onClick={() => startCard(card.id)}>Lancer</Button>
              ) : (
                <span className={cx('shrink-0 text-xs', status === 'blocked' ? 'font-medium text-critical' : 'text-ink-faint')}>{RUN_STATUS_LABEL[status]}</span>
              )}
            </li>
          )
        })}
      </ul>

      <form
        className="flex gap-1.5"
        onSubmit={(event) => {
          event.preventDefault()
          if (!title.trim()) return
          addCardToMilestone(entry.card.id, title.trim())
          setTitle('')
        }}
      >
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Ajouter une carte au jalon"
          className="min-w-0 flex-1 rounded-lg border border-line bg-canvas px-2.5 py-1.5 text-sm outline-none focus:border-accent"
        />
        <Button size="sm" variant="secondary" type="submit" icon={<Plus size={13} />} disabled={!title.trim()}>Ajouter</Button>
      </form>

      <div className="flex gap-1.5">
        {run.paused ? (
          <Button size="sm" variant="secondary" icon={<Play size={14} />} onClick={() => setPaused(entry.card.id, false)}>Reprendre</Button>
        ) : (
          <Button size="sm" variant="secondary" icon={<Pause size={14} />} onClick={() => setPaused(entry.card.id, true)}>Pause</Button>
        )}
      </div>
      <p className="text-xs text-ink-faint">Seuls les blocages te reviennent : ils s'affichent dans Affinage et dans « Ce qui t'attend ».</p>
    </aside>
  )
}

function ModeButton({ active, onClick, icon, label, hint }: { active: boolean; onClick: () => void; icon: ReactNode; label: string; hint: string }) {
  return (
    <button
      type="button"
      role="radio"
      onClick={onClick}
      aria-checked={active}
      className={cx(
        'flex items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors',
        active ? 'border-accent bg-accent-wash/40' : 'border-line hover:border-line-strong',
      )}
    >
      <span className={cx('shrink-0', active ? 'text-accent' : 'text-ink-faint')}>{icon}</span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className={cx('text-sm', active ? 'font-semibold text-ink' : 'text-ink-soft')}>{label}</span>
        <span className="truncate text-xs text-ink-faint">{hint}</span>
      </span>
      <span className={cx('size-3.5 shrink-0 rounded-full border-2', active ? 'border-accent bg-accent' : 'border-line-strong')} />
    </button>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-28 shrink-0 text-xs text-ink-faint">{label}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}

function slug(title: string): string {
  return title
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 32)
}
