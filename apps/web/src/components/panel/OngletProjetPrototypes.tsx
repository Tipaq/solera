/*
 * MAQUETTE JETABLE — l'onglet « Projet » du panneau droit (carte #27, tour 1).
 *
 * Demande de Tim, le 2026-10-17 : depuis une conversation de projet, voir les tâches du
 * projet, et d'abord la carte que la session traite. La carte #27 avait commencé un
 * onglet *Carte* qui ne montrait que celle-ci (`wip/carte-panneau`) ; on l'élargit.
 *
 * Ce qui est déjà arrêté et qu'on ne rouvre pas : la bande du panneau, le trait qui
 * sépare les vues du répertoire de celles de la session, `CardDetail` comme contenu
 * d'une carte ouverte — édition comprise.
 *
 * Ce qu'on choisit ici : **comment l'onglet partage la place entre la carte de la
 * session et le reste du projet** — quatre partis (A, B, C, D), puis trois états du
 * premier pour voir s'il tient (sans carte, carte ouverte, panneau étroit).
 *
 * **Tour 2** (même jour) : Tim garde B — deux segments, *cette session* et *le projet* —
 * parce qu'il veut y lire aussi ce que la session est en train de faire. Côté projet, il
 * reprend de C le voisinage de la carte et « dans le projet, maintenant ». Sans carte, il
 * veut une manière simple d'en choisir une.
 *
 * **Tour 3** : Tim retient S2 (la carte en tête, l'activité en bande), P (le projet en
 * trois étages) avec un bouton vers le board, et K2 (une proposition, le reste à la
 * demande). On ouvre la fiche d'une carte, qu'elle soit lue dans le panneau ou dans le
 * tiroir du board : une seule fiche pour les deux.
 *
 * Libellés en clair, contrairement à la règle de `t()` : rien d'ici ne part en
 * production. À supprimer avec `scripts/onglet-projet-prototypes.mjs`.
 */
import {
  ArrowLeft,
  CircleCheck,
  FilePen,
  GitBranch,
  ListChecks,
  Loader,
  Sparkles,
  TriangleAlert,
  Ban,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  CircleDot,
  Eye,
  FileCode,
  Flag,
  GitCompare,
  Link2,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Pin,
  Plus,
  Search,
  SquareKanban,
  SquareTerminal,
  Unlink,
  ArrowUpRight,
  CalendarDays,
  Paperclip,
  Play,
  Trash2,
  X,
} from 'lucide-react'
import type { ReactNode } from 'react'
import type { AgentKind } from '@solera/protocol'
import { cx } from '@solera/ui'
import { AgentIcon } from '../AgentIcon'

/* ---------------------------------------------------------------- données ---- */

type Colonne = 'todo' | 'in_progress' | 'review' | 'done'

const DOT: Record<Colonne, string> = {
  todo: 'bg-ink-faint', in_progress: 'bg-accent', review: 'bg-caution', done: 'bg-positive',
}
const MOT: Record<Colonne, string> = {
  todo: 'À faire', in_progress: 'En cours', review: 'En revue', done: 'Terminé',
}

const CARTE = {
  numero: 27,
  titre: 'Lire la carte traitée sans quitter la session',
  colonne: 'in_progress' as Colonne,
  jalon: { numero: 42, titre: 'Gestion de projet' },
  bloque: [{ numero: 21, titre: 'Cliquer « Fils » ouvre une conversation neuve' }],
  bloqueePar: [] as { numero: number; titre: string }[],
  cases: [
    { label: 'Rebaser `wip/carte-panneau` sur main', fait: true },
    { label: 'typecheck, lint, board-ui', fait: true },
    { label: 'Élargir l’onglet aux tâches du projet', fait: false },
    { label: 'Stories de CardDetail et CardPane', fait: false },
    { label: 'Relire la marge du bundle', fait: false },
  ],
  sessions: [
    { agent: 'claude' as AgentKind, titre: 'Onglet projet du panneau', ici: true, etat: 'en cours' },
    { agent: 'claude' as AgentKind, titre: 'Card display dans le right panel', ici: false, etat: 'archivée' },
  ],
  notes: 2,
  description: 'La carte qu’une session traite n’était qu’une puce `#27` dans le bandeau, et la suivre renvoyait au board — donc hors de la session — pour lire l’énoncé du travail en cours.',
}

type Ligne = { numero: number; titre: string; agent?: AgentKind; vivant?: boolean; quand?: string; cases?: [number, number]; ici?: boolean }

const EN_REVUE: Ligne[] = [
  { numero: 57, titre: 'Vue Git : trois dettes relevées à la relecture du lot 4', agent: 'codex', quand: 'attend depuis 2 h' },
  { numero: 54, titre: 'Quatre familles d’autorisation', agent: 'claude', quand: 'attend depuis hier' },
]
const EN_COURS: Ligne[] = [
  { numero: 27, titre: 'Lire la carte traitée sans quitter la session', agent: 'claude', vivant: true, cases: [2, 5], ici: true },
  { numero: 1, titre: 'Rendre le design system vérifiable', agent: 'claude', vivant: true, cases: [6, 9] },
  { numero: 19, titre: 'Porter le contexte Savoir', agent: 'codex', quand: 'au repos depuis 3 h', cases: [11, 14] },
]
const A_FAIRE: Ligne[] = [
  { numero: 21, titre: 'Cliquer « Fils » devrait ouvrir une conversation neuve' },
  { numero: 40, titre: 'Dire toujours quelle branche le serveur de dev sert' },
  { numero: 41, titre: 'Un CLI introuvable tue le tir en silence' },
  { numero: 56, titre: 'Les modales ouvrent une infobulle non demandée' },
  { numero: 58, titre: 'Une demande d’accord reste orpheline' },
]
const A_FAIRE_TOTAL = 21
const TERMINE_7J = 6

/* ---------------------------------------------------------------- briques ---- */

function Planche({ id, titre, note, largeur = 'w-[34rem]', hauteur = 'h-[44rem]', children }: {
  id: string
  titre: string
  note: string
  largeur?: string
  hauteur?: string
  children: ReactNode
}) {
  return (
    <section data-proto={id} data-shot={id} className={cx('flex flex-col gap-1.5', largeur)}>
      <h2 className="text-sm font-semibold text-ink">{titre}</h2>
      <div className={cx('surface flex flex-col overflow-hidden rounded-xl border border-line shadow-float', hauteur)}>{children}</div>
      <p className="text-micro leading-relaxed text-ink-faint">{note}</p>
    </section>
  )
}

/** La bande réelle du panneau, avec la sixième vue après *Agent*. */
function Bande({ compact = false }: { compact?: boolean }) {
  const vue = (icone: ReactNode, label: string, actif = false, badge?: number) => (
    <span key={label} className={cx(
      'flex h-8 shrink-0 items-center gap-1.5 rounded-md text-xs font-medium',
      compact && !actif ? 'w-8 justify-center' : 'px-2',
      actif ? 'bg-accent-wash text-ink' : 'text-ink-faint',
    )}>
      {icone}{compact && !actif ? null : label}
      {badge ? <span className="flex size-4 items-center justify-center rounded-full bg-caution text-micro font-semibold text-accent-ink">{badge}</span> : null}
    </span>
  )
  return (
    <div className="flex h-11 shrink-0 items-center gap-0.5 border-b border-line px-2">
      {vue(<FileCode size={15} />, 'Fichiers')}
      {vue(<Search size={15} />, 'Recherche')}
      {vue(<GitCompare size={15} />, 'Git')}
      {vue(<SquareTerminal size={15} />, 'Terminaux')}
      <span className="mx-1 h-5 w-px shrink-0 bg-line" />
      {vue(<Bot size={15} />, 'Agent')}
      {vue(<SquareKanban size={15} />, 'Projet', true, 2)}
    </div>
  )
}

function Dot({ colonne }: { colonne: Colonne }) {
  return <span className={cx('size-2 shrink-0 rounded-full', DOT[colonne])} />
}

function Num({ n }: { n: number }) {
  return <span className="shrink-0 text-micro font-medium tabular-nums text-ink-faint">#{n}</span>
}

function Count({ tone = 'neutral', children }: { tone?: 'accent' | 'caution' | 'neutral'; children: ReactNode }) {
  return (
    <span className={cx(
      'flex shrink-0 items-center rounded-full px-1.5 py-0.5 text-micro font-semibold tabular-nums',
      tone === 'accent' && 'bg-accent-wash text-accent',
      tone === 'caution' && 'bg-caution/10 text-caution',
      tone === 'neutral' && 'bg-surface-high text-ink-soft',
    )}>{children}</span>
  )
}

function Avancement({ fait, total, large = false }: { fait: number; total: number; large?: boolean }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={cx('overflow-hidden rounded-full bg-surface-high', large ? 'h-1.5 w-24' : 'h-1 w-10')}>
        <span className="block h-full rounded-full bg-accent" style={{ width: `${(fait / total) * 100}%` }} />
      </span>
      <span className="text-micro tabular-nums text-ink-faint">{fait}/{total}</span>
    </span>
  )
}

function Vivant() {
  return <span className="relative flex size-2 shrink-0"><span className="absolute inset-0 animate-ping rounded-full bg-accent/50" /><span className="relative size-2 rounded-full bg-accent" /></span>
}

function Section({ colonne, titre, compte, tone, children, replie = false, fin }: {
  colonne: Colonne
  titre: string
  compte: number
  tone?: 'accent' | 'caution' | 'neutral'
  children?: ReactNode
  replie?: boolean
  fin?: ReactNode
}) {
  return (
    <div className="flex flex-col">
      <div className="flex h-7 items-center gap-2 px-1.5">
        {replie ? <ChevronRight size={12} className="text-ink-faint" /> : <ChevronDown size={12} className="text-ink-faint" />}
        <Dot colonne={colonne} />
        <span className="flex-1 text-micro font-semibold tracking-wide text-ink-faint uppercase">{titre}</span>
        {fin}
        <Count tone={tone}>{compte}</Count>
      </div>
      {replie ? null : <div className="flex flex-col gap-px">{children}</div>}
    </div>
  )
}

function LigneCarte({ ligne, colonne }: { ligne: Ligne; colonne: Colonne }) {
  return (
    <div className={cx(
      'flex min-h-8 items-center gap-2 rounded-md px-1.5 py-1',
      ligne.ici && 'bg-accent-wash/60',
    )}>
      <Num n={ligne.numero} />
      <span className={cx('min-w-0 flex-1 truncate text-xs', colonne === 'todo' ? 'text-ink-soft' : 'text-ink')}>{ligne.titre}</span>
      {ligne.ici ? <span className="shrink-0 text-micro font-medium text-accent">ici</span> : null}
      {ligne.cases ? <Avancement fait={ligne.cases[0]} total={ligne.cases[1]} /> : null}
      {ligne.quand ? <span className="shrink-0 text-micro text-ink-faint">{ligne.quand}</span> : null}
      {ligne.agent ? (
        <span className="flex shrink-0 items-center gap-1">
          {ligne.vivant ? <Vivant /> : null}
          <AgentIcon agent={ligne.agent} size={12} decorative />
        </span>
      ) : null}
    </div>
  )
}

function Cases({ max = 5, cliquable = true }: { max?: number; cliquable?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      {CARTE.cases.slice(0, max).map((tache) => (
        <div key={tache.label} className="flex min-h-7 items-center gap-2 rounded-md px-1">
          <span className={cx(
            'flex size-3.5 shrink-0 items-center justify-center rounded border',
            tache.fait ? 'border-accent bg-accent text-accent-ink' : 'border-line-strong',
            !cliquable && 'opacity-60',
          )}>{tache.fait ? <Check size={10} strokeWidth={3} /> : null}</span>
          <span className={cx('min-w-0 flex-1 truncate text-xs', tache.fait ? 'text-ink-faint line-through' : 'text-ink')}>{tache.label}</span>
        </div>
      ))}
    </div>
  )
}

function Bouton({ icone, children, primaire = false }: { icone?: ReactNode; children: ReactNode; primaire?: boolean }) {
  return (
    <span className={cx(
      'flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs font-medium',
      primaire ? 'bg-accent text-accent-ink' : 'border border-line text-ink-soft',
    )}>{icone}{children}</span>
  )
}

function SelectColonne({ colonne }: { colonne: Colonne }) {
  return (
    <span className="flex h-6 items-center gap-1.5 rounded-full border border-line px-2 text-micro font-medium text-ink-soft">
      <Dot colonne={colonne} />{MOT[colonne]}<ChevronDown size={11} className="text-ink-faint" />
    </span>
  )
}

/** La carte de la session, résumée : ce qu'il faut pour se remettre dans le travail. */
function CarteSession({ ouvrable = true }: { ouvrable?: boolean }) {
  const fait = CARTE.cases.filter((tache) => tache.fait).length
  return (
    <div className="rounded-lg border border-accent/40 bg-accent-wash/30 p-2.5">
      <div className="mb-1 flex items-center gap-2">
        <span className="flex items-center gap-1 text-micro font-semibold tracking-wide text-accent uppercase"><Pin size={11} />Cette session traite</span>
        <span className="flex-1" />
        <MoreHorizontal size={14} className="text-ink-faint" />
      </div>
      <div className="mb-2 flex items-start gap-2">
        <span className="pt-px text-xs font-medium tabular-nums text-ink-faint">#{CARTE.numero}</span>
        <span className="flex-1 text-sm leading-snug font-medium text-ink">{CARTE.titre}</span>
      </div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <SelectColonne colonne={CARTE.colonne} />
        <Avancement fait={fait} total={CARTE.cases.length} large />
        <span className="flex items-center gap-1 text-micro text-ink-faint"><Flag size={11} />#{CARTE.jalon.numero}</span>
      </div>
      <Cases />
      {ouvrable ? (
        <div className="mt-1.5 flex items-center gap-1 border-t border-line/70 pt-1.5 text-micro text-ink-faint">
          <MessageSquare size={11} />{CARTE.notes} notes
          <span className="mx-1">·</span>
          <AgentIcon agent="claude" size={11} decorative />{CARTE.sessions.length} sessions
          <span className="flex-1" />
          <span className="flex items-center gap-0.5 font-medium text-accent">Ouvrir la carte<ChevronRight size={12} /></span>
        </div>
      ) : null}
    </div>
  )
}

/* ------------------------------------------------------------------ A ---- */

function ListeProjet({ resteRepli = true, ici = true }: { resteRepli?: boolean; ici?: boolean }) {
  return (
    <div className="flex flex-col gap-2">
      <Section colonne="review" titre="Attend ta relecture" compte={EN_REVUE.length} tone="caution">
        {EN_REVUE.map((ligne) => <LigneCarte key={ligne.numero} ligne={ligne} colonne="review" />)}
      </Section>
      <Section colonne="in_progress" titre="En cours" compte={EN_COURS.length} tone="accent">
        {EN_COURS.map((ligne) => <LigneCarte key={ligne.numero} ligne={ici ? ligne : { ...ligne, ici: false }} colonne="in_progress" />)}
      </Section>
      <Section colonne="todo" titre="À faire" compte={A_FAIRE_TOTAL} fin={<Plus size={13} className="text-ink-faint" />}>
        {A_FAIRE.slice(0, 4).map((ligne) => <LigneCarte key={ligne.numero} ligne={ligne} colonne="todo" />)}
        <span className="px-1.5 py-1 text-micro text-ink-faint">{A_FAIRE_TOTAL - 4} de plus · voir le board</span>
      </Section>
      {resteRepli ? <Section colonne="done" titre="Terminé cette semaine" compte={TERMINE_7J} replie /> : null}
    </div>
  )
}

function A() {
  return (
    <Planche
      id="a-pile"
      titre="A · la pile — la carte de la session, puis le projet par urgence"
      note="Une seule colonne qui défile. En tête, la carte de la session, résumée mais vivante : colonne modifiable, cases cochables. Dessous, le projet dans l’ordre du tableau de bord — ce qui t’attend, ce qui tourne, ce qui reste. La ligne « ici » marque la session dans la liste. Un clic sur n’importe quelle carte l’ouvre en place (voir A·ouverte)."
    >
      <Bande />
      <div className="min-h-0 flex-1 overflow-hidden px-2.5 py-2.5">
        <CarteSession />
        <div className="mt-3" />
        <ListeProjet />
      </div>
    </Planche>
  )
}

function AOuverte() {
  return (
    <Planche
      id="a-carte-ouverte"
      titre="A · ouverte — une carte du projet, lue dans le panneau"
      note="Le clic sur #57 empile la carte par-dessus la liste, avec un retour en haut. Le contenu est `CardDetail` tel que le tiroir du board le montre — édition, notes, sessions — rien de plus à écrire. « Lancer une session » ouvre un fil neuf rattaché ; « Rattacher ici » change la carte de cette session."
    >
      <Bande />
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-line px-2.5">
        <ArrowLeft size={15} className="text-ink-soft" />
        <span className="text-xs text-ink-soft">Projet</span>
        <span className="flex-1" />
        <Bouton icone={<Link2 size={12} />}>Rattacher ici</Bouton>
        <Bouton icone={<Plus size={12} />} primaire>Lancer une session</Bouton>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden px-3.5 py-3">
        <div className="mb-2 flex items-center gap-2"><Num n={57} /><SelectColonne colonne="review" /></div>
        <div className="mb-3 text-base leading-snug font-semibold text-ink">Vue Git : trois dettes relevées à la relecture du lot 4</div>
        <div className="mb-3 flex gap-4 border-b border-line text-xs">
          <span className="border-b-2 border-accent pb-1.5 font-medium text-ink">Détails</span>
          <span className="pb-1.5 text-ink-faint">Activité <Count>3</Count></span>
          <span className="pb-1.5 text-ink-faint">Sessions <Count>1</Count></span>
        </div>
        <p className="mb-3 text-xs leading-relaxed text-ink-soft">Relevées par la relecture de la PR #6 (`feat/vue-git-lot-4`), §6 et §7. Aucune n’est un défaut de sûreté — les cinq graves ont été corrigés avant la fusion — mais trois choses restent à reprendre avant que la vue ne grossisse encore.</p>
        <div className="mb-1 text-micro font-semibold tracking-wide text-ink-faint uppercase">Sous-tâches</div>
        <div className="mb-3 flex flex-col gap-0.5">
          {['Le diff des fichiers binaires', 'La pagination du journal', 'Le message d’erreur du push refusé'].map((label, index) => (
            <div key={label} className="flex min-h-7 items-center gap-2 px-1">
              <span className={cx('flex size-3.5 items-center justify-center rounded border', index === 0 ? 'border-accent bg-accent text-accent-ink' : 'border-line-strong')}>{index === 0 ? <Check size={10} strokeWidth={3} /> : null}</span>
              <span className={cx('text-xs', index === 0 ? 'text-ink-faint line-through' : 'text-ink')}>{label}</span>
            </div>
          ))}
        </div>
        <div className="mb-1 text-micro font-semibold tracking-wide text-ink-faint uppercase">Citée par</div>
        <div className="flex items-center gap-2 px-1 text-xs text-ink-soft"><Num n={29} />Développer la vue Git du panneau</div>
      </div>
    </Planche>
  )
}

function ASansCarte() {
  return (
    <Planche
      id="a-sans-carte"
      titre="A · sans carte — la session n’en traite aucune"
      note="Le cas ordinaire. La place de la carte devient une invitation discrète, pas un état vide plein écran : rattacher une carte existante (les en-cours et à-faire en premier, plus une recherche), ou en créer une depuis le titre de la session. Le projet reste lisible dessous — c’est souvent là qu’on trouve la carte à rattacher."
    >
      <Bande />
      <div className="min-h-0 flex-1 overflow-hidden px-2.5 py-2.5">
        <div className="rounded-lg border border-dashed border-line-strong p-2.5">
          <div className="mb-1 flex items-center gap-1.5 text-micro font-semibold tracking-wide text-ink-faint uppercase"><Unlink size={11} />Aucune carte pour cette session</div>
          <p className="mb-2 text-xs leading-relaxed text-ink-soft">Rattacher une carte la garde en tête ici, et laisse la trace de la session sur le board.</p>
          <div className="flex flex-wrap gap-1.5">
            <Bouton icone={<Link2 size={12} />}>Rattacher une carte…</Bouton>
            <Bouton icone={<Plus size={12} />}>Créer « Onglet projet du panneau »</Bouton>
          </div>
        </div>
        <div className="mt-3" />
        <ListeProjet ici={false} />
      </div>
    </Planche>
  )
}

function AEtroit() {
  return (
    <Planche
      id="a-etroit"
      largeur="w-[22rem]"
      titre="A · étroit — le panneau accolé à 22 rem"
      note="Les noms de la bande tombent ensemble, l’actif garde le sien. La carte de la session se resserre : les cases cochées se replient en « 2 faites », les avancements de la liste disparaissent avant les titres."
    >
      <Bande compact />
      <div className="min-h-0 flex-1 overflow-hidden px-2 py-2">
        <div className="rounded-lg border border-accent/40 bg-accent-wash/30 p-2">
          <div className="mb-1 flex items-start gap-1.5">
            <span className="pt-px text-xs tabular-nums text-ink-faint">#27</span>
            <span className="flex-1 text-xs leading-snug font-medium text-ink">{CARTE.titre}</span>
          </div>
          <div className="mb-1.5 flex items-center gap-2"><SelectColonne colonne="in_progress" /><Avancement fait={2} total={5} /></div>
          <div className="px-1 pb-0.5 text-micro text-ink-faint">✓ 2 faites</div>
          {CARTE.cases.filter((tache) => !tache.fait).map((tache) => (
            <div key={tache.label} className="flex min-h-6 items-center gap-1.5 px-1">
              <span className="size-3 shrink-0 rounded border border-line-strong" />
              <span className="min-w-0 flex-1 truncate text-xs text-ink">{tache.label}</span>
            </div>
          ))}
        </div>
        <div className="mt-2.5 flex flex-col gap-2">
          <Section colonne="review" titre="Relecture" compte={2} tone="caution">
            {EN_REVUE.map((ligne) => (
              <div key={ligne.numero} className="flex min-h-7 items-center gap-1.5 px-1.5"><Num n={ligne.numero} /><span className="min-w-0 flex-1 truncate text-xs text-ink">{ligne.titre}</span></div>
            ))}
          </Section>
          <Section colonne="in_progress" titre="En cours" compte={3} tone="accent">
            {EN_COURS.map((ligne) => (
              <div key={ligne.numero} className={cx('flex min-h-7 items-center gap-1.5 rounded-md px-1.5', ligne.ici && 'bg-accent-wash/60')}>
                <Num n={ligne.numero} /><span className="min-w-0 flex-1 truncate text-xs text-ink">{ligne.titre}</span>{ligne.vivant ? <Vivant /> : null}
              </div>
            ))}
          </Section>
          <Section colonne="todo" titre="À faire" compte={A_FAIRE_TOTAL} replie />
        </div>
      </div>
    </Planche>
  )
}

/* ------------------------------------------------------------------ B ---- */

function Segments({ actif }: { actif: 'session' | 'projet' }) {
  const seg = (cle: 'session' | 'projet', label: string, badge?: ReactNode) => (
    <span className={cx(
      'flex h-7 flex-1 items-center justify-center gap-1.5 rounded-md text-xs font-medium',
      actif === cle ? 'surface text-ink shadow-sm' : 'text-ink-faint',
    )}>{label}{badge}</span>
  )
  return (
    <div className="flex gap-0.5 rounded-lg bg-surface-high p-0.5">
      {seg('session', '#27 · cette session')}
      {seg('projet', 'Le projet', <Count tone="caution">2</Count>)}
    </div>
  )
}

function BSession() {
  return (
    <Planche
      id="b-segments-session"
      titre="B · deux temps — « cette session » : la carte entière, à plat"
      note="Un sélecteur en tête partage l’onglet en deux, et chacun a toute la hauteur. Côté session, la carte n’est pas résumée : description, cases, liens, sessions, notes — c’est `CardDetail` sans ses onglets internes, tout d’un tenant, parce qu’on la lit en travaillant."
    >
      <Bande />
      <div className="min-h-0 flex-1 overflow-hidden px-3 py-2.5">
        <Segments actif="session" />
        <div className="mt-3 mb-1.5 flex items-center gap-2"><SelectColonne colonne="in_progress" /><span className="flex items-center gap-1 text-micro text-ink-faint"><Flag size={11} />#42 Gestion de projet</span><span className="flex-1" /><Pencil size={13} className="text-ink-faint" /></div>
        <div className="mb-2 text-base leading-snug font-semibold text-ink">{CARTE.titre}</div>
        <p className="mb-3 text-xs leading-relaxed text-ink-soft">{CARTE.description}</p>
        <div className="mb-1 flex items-center gap-2"><span className="text-micro font-semibold tracking-wide text-ink-faint uppercase">Sous-tâches</span><Avancement fait={2} total={5} /></div>
        <Cases />
        <div className="mt-3 mb-1 text-micro font-semibold tracking-wide text-ink-faint uppercase">Bloque</div>
        <div className="flex items-center gap-2 px-1 text-xs text-ink-soft"><Ban size={12} className="text-caution" /><Num n={21} />{CARTE.bloque[0]!.titre}</div>
        <div className="mt-3 mb-1 text-micro font-semibold tracking-wide text-ink-faint uppercase">Sessions</div>
        {CARTE.sessions.map((session) => (
          <div key={session.titre} className="flex min-h-7 items-center gap-2 px-1 text-xs">
            <AgentIcon agent={session.agent} size={12} decorative />
            <span className={cx('flex-1 truncate', session.ici ? 'text-ink' : 'text-ink-faint')}>{session.titre}</span>
            <span className="text-micro text-ink-faint">{session.ici ? 'celle-ci' : session.etat}</span>
          </div>
        ))}
        <div className="mt-3 mb-1 text-micro font-semibold tracking-wide text-ink-faint uppercase">Notes · 2</div>
        <div className="rounded-md border border-line px-2.5 py-2 text-xs text-ink-soft">Rebase fait, deux conflits dans les catalogues i18n, réglés en ajout de clés.</div>
      </div>
    </Planche>
  )
}

function BProjet() {
  return (
    <Planche
      id="b-segments-projet"
      titre="B · deux temps — « le projet » : un board replié en liste"
      note="L’autre moitié montre le projet entier, avec un filtre et une recherche, et les cinq colonnes en sections repliables. Le badge du segment dit qu’on t’attend quelque part. Ce que ça coûte : on ne voit jamais la carte et le projet ensemble, et le geste le plus fréquent — cocher une case — demande d’être du bon côté."
    >
      <Bande />
      <div className="min-h-0 flex-1 overflow-hidden px-2.5 py-2.5">
        <Segments actif="projet" />
        <div className="mt-2.5 mb-2.5 flex items-center gap-1.5">
          <span className="flex h-7 flex-1 items-center gap-1.5 rounded-md border border-line px-2 text-xs text-ink-faint"><Search size={12} />Filtrer les cartes</span>
          <Bouton>Les miennes</Bouton>
          <Bouton icone={<Plus size={12} />}>Carte</Bouton>
        </div>
        <ListeProjet resteRepli />
      </div>
    </Planche>
  )
}

/* ------------------------------------------------------------------ C ---- */

function Voisine({ icone, mot, numero, titre, colonne }: { icone: ReactNode; mot: string; numero: number; titre: string; colonne: Colonne }) {
  return (
    <div className="flex min-h-8 items-center gap-2 rounded-md px-1.5">
      <span className="flex w-20 shrink-0 items-center gap-1 text-micro text-ink-faint">{icone}{mot}</span>
      <Dot colonne={colonne} /><Num n={numero} />
      <span className="min-w-0 flex-1 truncate text-xs text-ink">{titre}</span>
    </div>
  )
}

function C() {
  return (
    <Planche
      id="c-voisinage"
      titre="C · le voisinage — la carte au centre, le projet vu depuis elle"
      note="Le projet n’est pas une liste de plus : il n’apparaît que par ce qui touche la carte — son jalon, ce qu’elle bloque, ce qui la cite — puis par ce qui bouge à côté maintenant (les autres sessions vivantes, la file de relecture). Le reste du board est à un lien. Plus calme, mais on ne voit pas « ce qu’il reste à faire » sans quitter la session."
    >
      <Bande />
      <div className="min-h-0 flex-1 overflow-hidden px-2.5 py-2.5">
        <CarteSession ouvrable={false} />
        <div className="mt-3 mb-1 px-1.5 text-micro font-semibold tracking-wide text-ink-faint uppercase">Autour de #27</div>
        <Voisine icone={<Flag size={11} />} mot="jalon" numero={42} titre="Gestion de projet — 4 cartes sur 7" colonne="in_progress" />
        <Voisine icone={<Ban size={11} />} mot="bloque" numero={21} titre={CARTE.bloque[0]!.titre} colonne="todo" />
        <Voisine icone={<Link2 size={11} />} mot="citée par" numero={29} titre="Développer la vue Git du panneau" colonne="done" />
        <Voisine icone={<Link2 size={11} />} mot="cite" numero={23} titre="Un agent déclare un projet" colonne="done" />

        <div className="mt-3 mb-1 px-1.5 text-micro font-semibold tracking-wide text-ink-faint uppercase">Dans le projet, maintenant</div>
        <div className="flex min-h-8 items-center gap-2 rounded-md px-1.5">
          <Vivant /><AgentIcon agent="claude" size={12} decorative />
          <span className="min-w-0 flex-1 truncate text-xs text-ink"><span className="text-ink-faint">#1</span> Rendre le design system vérifiable</span>
          <span className="text-micro text-ink-faint">écrit</span>
        </div>
        <div className="flex min-h-8 items-center gap-2 rounded-md px-1.5">
          <span className="size-2 rounded-full bg-caution" /><Eye size={12} className="text-caution" />
          <span className="min-w-0 flex-1 truncate text-xs text-ink">2 cartes attendent ta relecture</span>
          <ChevronRight size={12} className="text-ink-faint" />
        </div>
        <div className="flex min-h-8 items-center gap-2 rounded-md px-1.5">
          <span className="size-2 rounded-full bg-ink-faint" /><CircleDot size={12} className="text-ink-faint" />
          <span className="min-w-0 flex-1 truncate text-xs text-ink-soft">21 à faire · 6 terminées cette semaine</span>
          <span className="flex items-center gap-0.5 text-micro font-medium text-accent">Board<ChevronRight size={12} /></span>
        </div>
      </div>
    </Planche>
  )
}

/* ------------------------------------------------------------------ D ---- */

function Tuile({ ligne, colonne }: { ligne: Ligne; colonne: Colonne }) {
  return (
    <div className={cx('rounded-md border bg-surface px-2 py-1.5', ligne.ici ? 'border-accent ring-1 ring-accent/40' : 'border-line')}>
      <div className="mb-0.5 flex items-center gap-1"><Num n={ligne.numero} /><span className="flex-1" />{ligne.vivant ? <Vivant /> : null}{ligne.agent ? <AgentIcon agent={ligne.agent} size={11} decorative /> : null}</div>
      <div className={cx('line-clamp-2 text-xs leading-snug', colonne === 'todo' ? 'text-ink-soft' : 'text-ink')}>{ligne.titre}</div>
      {ligne.cases ? <div className="mt-1"><Avancement fait={ligne.cases[0]} total={ligne.cases[1]} /></div> : null}
    </div>
  )
}

function D() {
  const colonnes: { colonne: Colonne; lignes: Ligne[]; total: number }[] = [
    { colonne: 'todo', lignes: A_FAIRE.slice(0, 3), total: A_FAIRE_TOTAL },
    { colonne: 'in_progress', lignes: EN_COURS, total: 3 },
    { colonne: 'review', lignes: EN_REVUE, total: 2 },
  ]
  return (
    <Planche
      id="d-mini-board"
      titre="D · le mini-board — les colonnes, en petit, et la carte épinglée en bas"
      note="Le board lui-même, réduit au panneau : trois colonnes côte à côte (Terminé hors champ, à droite par défilement), la carte de la session cerclée là où elle est. En bas, une barre fixe rappelle la carte de la session et ses cases, toujours à portée. Familier, et on peut y glisser une carte d’une colonne à l’autre — mais à 34 rem les titres tiennent sur deux lignes au mieux."
    >
      <Bande />
      <div className="flex min-h-0 flex-1 gap-2 overflow-hidden px-2.5 py-2.5">
        {colonnes.map(({ colonne, lignes, total }) => (
          <div key={colonne} className="flex w-[10rem] shrink-0 flex-col gap-1.5 rounded-lg bg-surface-high/60 p-1.5">
            <div className="flex items-center gap-1.5 px-0.5"><Dot colonne={colonne} /><span className="flex-1 text-micro font-semibold text-ink-soft">{MOT[colonne]}</span><Count tone={colonne === 'review' ? 'caution' : 'neutral'}>{total}</Count></div>
            {lignes.map((ligne) => <Tuile key={ligne.numero} ligne={ligne} colonne={colonne} />)}
            {total > lignes.length ? <span className="px-1 text-micro text-ink-faint">+ {total - lignes.length}</span> : null}
          </div>
        ))}
      </div>
      <div className="shrink-0 border-t border-line bg-accent-wash/30 px-3 py-2">
        <div className="mb-1 flex items-center gap-2">
          <Pin size={12} className="text-accent" /><Num n={27} />
          <span className="min-w-0 flex-1 truncate text-xs font-medium text-ink">{CARTE.titre}</span>
          <Avancement fait={2} total={5} /><ChevronDown size={13} className="text-ink-faint" />
        </div>
        <Cases max={3} />
      </div>
    </Planche>
  )
}

/* -------------------------------------------------------------- planche ---- */

export function OngletProjetTour1() {
  return (
    <div className="flex flex-col gap-10 bg-canvas p-8">
      <A />
      <B />
      <C />
      <D />
      <ASansCarte />
      <AOuverte />
      <AEtroit />
    </div>
  )
}

function B() {
  return (
    <div className="flex gap-6">
      <BSession />
      <BProjet />
    </div>
  )
}

/* =============================================================== tour 2 ==== */

const PLAN = [
  { label: 'Lire la carte #27 et la branche wip', etat: 'fait' as const },
  { label: 'Rebaser sur main, régler les catalogues i18n', etat: 'fait' as const },
  { label: 'Écrire les maquettes de l’onglet Projet', etat: 'fait' as const },
  { label: 'Tour 2 : segments session / projet', etat: 'en_cours' as const },
  { label: 'Porter dans CardPane', etat: 'a_faire' as const },
  { label: 'Stories et suite board-ui', etat: 'a_faire' as const },
]

/** Le sélecteur de B, avec ce que chaque moitié annonce sans qu'on l'ouvre. */
function Segments2({ actif, carte = true }: { actif: 'session' | 'projet'; carte?: boolean }) {
  const seg = (cle: 'session' | 'projet', contenu: ReactNode) => (
    <span className={cx(
      'flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md text-xs font-medium',
      actif === cle ? 'surface text-ink shadow-sm' : 'text-ink-faint',
    )}>{contenu}</span>
  )
  return (
    <div className="flex gap-0.5 rounded-lg bg-surface-high p-0.5">
      {seg('session', <><Vivant />Cette session{carte ? <span className="font-normal text-ink-faint">· #27</span> : <span className="font-normal text-caution">· sans carte</span>}</>)}
      {seg('projet', <>Le projet<Count tone="caution">2</Count></>)}
    </div>
  )
}

function Titre({ icone, children, fin }: { icone?: ReactNode; children: ReactNode; fin?: ReactNode }) {
  return (
    <div className="mt-3 mb-1 flex items-center gap-1.5 px-1">
      {icone ? <span className="text-ink-faint">{icone}</span> : null}
      <span className="flex-1 text-micro font-semibold tracking-wide text-ink-faint uppercase">{children}</span>
      {fin}
    </div>
  )
}

/** Ce que la session fait en ce moment : l'état, le geste, le plan de l'agent. */
function Activite({ plan = true }: { plan?: boolean }) {
  return (
    <>
      <div className="rounded-lg border border-line p-2.5">
        <div className="mb-1.5 flex items-center gap-2">
          <Loader size={13} className="shrink-0 animate-spin text-accent" />
          <span className="flex-1 text-xs font-medium text-ink">Écrit depuis 4 min</span>
          <AgentIcon agent="claude" size={12} decorative />
          <span className="text-micro text-ink-faint">opus-5.5 · contexte 38 %</span>
        </div>
        <div className="flex items-center gap-2 rounded-md bg-surface-high/70 px-2 py-1.5">
          <FilePen size={12} className="shrink-0 text-ink-faint" />
          <span className="min-w-0 flex-1 truncate font-mono text-micro text-ink-soft">Edit · panel/OngletProjetPrototypes.tsx</span>
          <span className="text-micro text-ink-faint">à l’instant</span>
        </div>
        <div className="mt-1.5 flex items-center gap-3 text-micro text-ink-faint">
          <span className="flex items-center gap-1"><GitBranch size={11} />main</span>
          <span className="flex items-center gap-1"><FilePen size={11} />3 fichiers <span className="text-positive">+534</span> <span className="text-critical">−2</span></span>
          <span className="flex items-center gap-1"><Bot size={11} />1 sous-agent</span>
        </div>
      </div>
      {plan ? (
        <>
          <Titre icone={<ListChecks size={12} />} fin={<Avancement fait={3} total={PLAN.length} />}>Le plan de l’agent</Titre>
          <div className="flex flex-col gap-px">
            {PLAN.map((etape) => (
              <div key={etape.label} className={cx('flex min-h-6 items-center gap-2 rounded-md px-1.5', etape.etat === 'en_cours' && 'bg-accent-wash/60')}>
                {etape.etat === 'fait' ? <CircleCheck size={12} className="shrink-0 text-positive" />
                  : etape.etat === 'en_cours' ? <Loader size={12} className="shrink-0 animate-spin text-accent" />
                  : <span className="size-3 shrink-0 rounded-full border border-line-strong" />}
                <span className={cx('min-w-0 flex-1 truncate text-xs', etape.etat === 'fait' ? 'text-ink-faint' : 'text-ink')}>{etape.label}</span>
              </div>
            ))}
          </div>
        </>
      ) : null}
    </>
  )
}

/** La carte, côté session : ce qu'elle demande, et la main pour avancer. */
function CarteDansSession({ deplie = false, cases = true }: { deplie?: boolean; cases?: boolean }) {
  return (
    <>
      <Titre icone={<SquareKanban size={12} />} fin={<span className="flex items-center gap-0.5 text-micro font-medium text-accent">Ouvrir<ChevronRight size={11} /></span>}>La carte traitée</Titre>
      <div className="rounded-lg border border-accent/40 bg-accent-wash/30 p-2.5">
        <div className="mb-1.5 flex items-start gap-2">
          <span className="pt-px text-xs tabular-nums text-ink-faint">#27</span>
          <span className="flex-1 text-sm leading-snug font-medium text-ink">{CARTE.titre}</span>
          <MoreHorizontal size={14} className="text-ink-faint" />
        </div>
        <div className="mb-1.5 flex flex-wrap items-center gap-2">
          <SelectColonne colonne="in_progress" />
          <Avancement fait={2} total={5} large />
          <span className="flex items-center gap-1 text-micro text-ink-faint"><Flag size={11} />#42</span>
        </div>
        {deplie ? <p className="mb-1.5 px-1 text-xs leading-relaxed text-ink-soft">{CARTE.description}</p> : null}
        {cases ? <Cases /> : null}
        <div className="mt-1.5 flex items-center gap-1 border-t border-line/70 pt-1.5 text-micro text-ink-faint">
          <MessageSquare size={11} />2 notes<span className="mx-1">·</span>
          <Ban size={11} className="text-caution" />bloque #21<span className="mx-1">·</span>
          1 autre session
        </div>
      </div>
    </>
  )
}

function S1() {
  return (
    <Planche
      id="t2-s1-session-d-abord"
      titre="S1 · cette session — l’activité en tête, la carte dessous"
      note="On ouvre l’onglet pour savoir où en est la session : l’état et le dernier geste en premier, puis le plan que l’agent s’est donné (sa liste de tâches, mise à jour à chaque tour), puis la carte qu’elle sert — cochable sur place. Le badge vivant du segment dit que ça tourne même quand on regarde le projet. Le détail des sous-agents et des écritures reste à l’onglet Agent : on n’en montre ici que le compte."
    >
      <Bande />
      <div className="min-h-0 flex-1 overflow-hidden px-2.5 py-2.5">
        <Segments2 actif="session" />
        <div className="mt-2.5" />
        <Activite />
        <CarteDansSession />
      </div>
    </Planche>
  )
}

function S2() {
  return (
    <Planche
      id="t2-s2-carte-d-abord"
      titre="S2 · cette session — la carte en tête, l’activité en bande"
      note="L’inverse : la carte est le contrat, elle passe devant, description comprise. L’activité tient en une bande tout en haut, et le plan de l’agent se lit à côté des cases de la carte — on voit d’un coup si les deux listes racontent la même chose. Plus de place pour la carte, moins pour ce qui se passe."
    >
      <Bande />
      <div className="min-h-0 flex-1 overflow-hidden px-2.5 py-2.5">
        <Segments2 actif="session" />
        <div className="mt-2.5 flex items-center gap-2 rounded-md bg-surface-high/70 px-2 py-1.5">
          <Loader size={12} className="shrink-0 animate-spin text-accent" />
          <span className="min-w-0 flex-1 truncate text-xs text-ink-soft"><span className="font-medium text-ink">Écrit depuis 4 min</span> · Edit OngletProjetPrototypes.tsx</span>
          <span className="text-micro text-ink-faint">38 %</span>
        </div>
        <CarteDansSession deplie cases={false} />
        <div className="mt-3 grid grid-cols-2 gap-2">
          <div>
            <Titre icone={<SquareKanban size={12} />}>La carte demande</Titre>
            <Cases />
          </div>
          <div>
            <Titre icone={<ListChecks size={12} />}>L’agent prévoit</Titre>
            {PLAN.slice(2).map((etape) => (
              <div key={etape.label} className="flex min-h-7 items-center gap-1.5 px-1">
                {etape.etat === 'fait' ? <CircleCheck size={12} className="shrink-0 text-positive" />
                  : etape.etat === 'en_cours' ? <Loader size={12} className="shrink-0 text-accent" />
                  : <span className="size-3 shrink-0 rounded-full border border-line-strong" />}
                <span className={cx('min-w-0 flex-1 truncate text-xs', etape.etat === 'fait' ? 'text-ink-faint' : 'text-ink')}>{etape.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Planche>
  )
}

function P() {
  return (
    <Planche
      id="t2-p-projet"
      titre="P · le projet — autour de moi, puis maintenant, puis le reste"
      note="Trois étages, du plus proche au plus loin. Autour de #27 : ce qui touche la carte (jalon, ce qu’elle bloque, ce qui la cite). Maintenant : les autres sessions vivantes du projet, et la file qui t’attend — c’est elle que compte le badge. Le reste du board en sections repliées, pour ne pas devoir sortir quand on cherche une carte. Un clic sur une carte l’ouvre en place, avec un retour."
    >
      <Bande />
      <div className="min-h-0 flex-1 overflow-hidden px-2.5 py-2.5">
        <Segments2 actif="projet" />
        <Titre icone={<Pin size={12} />}>Autour de #27</Titre>
        <Voisine icone={<Flag size={11} />} mot="jalon" numero={42} titre="Gestion de projet — 4 cartes sur 7" colonne="in_progress" />
        <Voisine icone={<Ban size={11} />} mot="bloque" numero={21} titre={CARTE.bloque[0]!.titre} colonne="todo" />
        <Voisine icone={<Link2 size={11} />} mot="citée par" numero={29} titre="Développer la vue Git du panneau" colonne="done" />

        <Titre icone={<Sparkles size={12} />}>Dans le projet, maintenant</Titre>
        {[
          { agent: 'claude' as AgentKind, n: 1, t: 'Rendre le design system vérifiable', d: 'écrit · 12 min', vivant: true },
          { agent: 'codex' as AgentKind, n: 19, t: 'Porter le contexte Savoir', d: 'au repos · 3 h', vivant: false },
        ].map((ligne) => (
          <div key={ligne.n} className="flex min-h-8 items-center gap-2 rounded-md px-1.5">
            {ligne.vivant ? <Vivant /> : <span className="size-2 rounded-full bg-line-strong" />}
            <AgentIcon agent={ligne.agent} size={12} decorative /><Num n={ligne.n} />
            <span className="min-w-0 flex-1 truncate text-xs text-ink">{ligne.t}</span>
            <span className="text-micro text-ink-faint">{ligne.d}</span>
          </div>
        ))}
        {EN_REVUE.map((ligne) => (
          <div key={ligne.numero} className="flex min-h-8 items-center gap-2 rounded-md bg-caution/5 px-1.5">
            <Eye size={12} className="shrink-0 text-caution" /><Num n={ligne.numero} />
            <span className="min-w-0 flex-1 truncate text-xs text-ink">{ligne.titre}</span>
            <span className="text-micro text-caution">à relire · {ligne.quand?.replace('attend depuis ', '')}</span>
          </div>
        ))}

        <Titre icone={<SquareKanban size={12} />} fin={<span className="flex items-center gap-0.5 text-micro font-medium text-accent">Board<ChevronRight size={11} /></span>}>Le reste du board</Titre>
        <div className="flex flex-col gap-1">
          <Section colonne="todo" titre="À faire" compte={A_FAIRE_TOTAL} replie fin={<Plus size={13} className="text-ink-faint" />} />
          <Section colonne="in_progress" titre="En cours" compte={3} tone="accent" replie />
          <Section colonne="done" titre="Terminé cette semaine" compte={TERMINE_7J} replie />
        </div>
      </div>
    </Planche>
  )
}

/** Ce que Solera sait proposer sans rien demander : la session a un titre et un fil. */
const SUGGESTIONS = [
  { n: 27, t: 'Lire la carte traitée sans quitter la session', pourquoi: 'citée 3 fois dans ce fil', colonne: 'todo' as Colonne },
  { n: 21, t: 'Cliquer « Fils » devrait ouvrir une conversation neuve', pourquoi: 'titre proche', colonne: 'todo' as Colonne },
  { n: 43, t: 'Replier les écarts d’interface de la gestion de projet', pourquoi: 'mêmes fichiers touchés', colonne: 'todo' as Colonne },
]

function K1() {
  return (
    <Planche
      id="t2-k1-choisir-en-place"
      titre="K1 · sans carte — le choix est le contenu du segment"
      note="Sans carte, le segment session ne fait pas semblant : sous l’activité (qui reste), il devient un choisisseur. Une recherche, puis ce que Solera devine — les cartes citées dans le fil, celles au titre proche, celles qui touchent les mêmes fichiers — chacune avec sa raison. Un clic rattache. En bas, créer la carte à partir du titre de la session, colonne « En cours » d’office."
    >
      <Bande />
      <div className="min-h-0 flex-1 overflow-hidden px-2.5 py-2.5">
        <Segments2 actif="session" carte={false} />
        <div className="mt-2.5" />
        <Activite plan={false} />
        <Titre icone={<Link2 size={12} />}>Rattacher cette session à une carte</Titre>
        <span className="mb-1.5 flex h-8 items-center gap-1.5 rounded-md border border-accent px-2 text-xs text-ink-faint ring-2 ring-accent/20"><Search size={13} />Chercher par titre ou #numéro</span>
        <div className="mb-0.5 px-1 text-micro text-ink-faint">Suggérées</div>
        {SUGGESTIONS.map((carte, index) => (
          <div key={carte.n} className={cx('flex min-h-9 items-center gap-2 rounded-md px-1.5', index === 0 && 'bg-accent-wash/60')}>
            <Dot colonne={carte.colonne} /><Num n={carte.n} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs text-ink">{carte.t}</span>
              <span className="block text-micro text-ink-faint">{carte.pourquoi}</span>
            </span>
            {index === 0 ? <Bouton icone={<Link2 size={12} />}>Rattacher</Bouton> : null}
          </div>
        ))}
        <div className="mt-1 mb-0.5 px-1 text-micro text-ink-faint">En cours, sans session</div>
        <div className="flex min-h-8 items-center gap-2 rounded-md px-1.5"><Dot colonne="in_progress" /><Num n={19} /><span className="min-w-0 flex-1 truncate text-xs text-ink">Porter le contexte Savoir</span></div>
        <div className="mt-2 flex items-center gap-2 rounded-md border border-dashed border-line-strong px-2 py-1.5">
          <Plus size={13} className="text-ink-faint" />
          <span className="min-w-0 flex-1 truncate text-xs text-ink-soft">Créer « Onglet projet du panneau »</span>
          <span className="text-micro text-ink-faint">en cours</span>
        </div>
      </div>
    </Planche>
  )
}

function K2() {
  return (
    <Planche
      id="t2-k2-une-proposition"
      titre="K2 · sans carte — une proposition, et le reste à la demande"
      note="Plus retenu : une seule ligne en tête du segment, la meilleure devinette, avec « Rattacher » et « Autre… ». « Autre… » ouvre le choisisseur de K1 en feuille. La session garde sa place pour l’activité et le plan. Le risque : une devinette fausse affichée en permanence, qu’on finit par ne plus lire — d’où le ✕ qui l’écarte pour la session."
    >
      <Bande />
      <div className="min-h-0 flex-1 overflow-hidden px-2.5 py-2.5">
        <Segments2 actif="session" carte={false} />
        <div className="mt-2.5 rounded-lg border border-dashed border-caution/60 bg-caution/5 p-2.5">
          <div className="mb-1.5 flex items-center gap-1.5 text-micro font-semibold tracking-wide text-caution uppercase"><TriangleAlert size={11} />Cette session ne traite aucune carte</div>
          <div className="mb-2 flex items-center gap-2">
            <Dot colonne="todo" /><Num n={27} />
            <span className="min-w-0 flex-1 truncate text-xs font-medium text-ink">Lire la carte traitée sans quitter la session</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="flex-1 text-micro text-ink-faint">citée 3 fois dans ce fil</span>
            <Bouton icone={<Link2 size={12} />} primaire>Rattacher</Bouton>
            <Bouton>Autre…</Bouton>
            <Bouton icone={<Plus size={12} />}>Créer</Bouton>
          </div>
        </div>
        <div className="mt-2.5" />
        <Activite />
      </div>
    </Planche>
  )
}

function S1Etroit() {
  return (
    <Planche
      id="t2-s1-etroit"
      largeur="w-[22rem]"
      titre="S1 · étroit — 22 rem"
      note="Les segments perdent leur sous-titre, l’activité passe sur deux lignes, le plan replie ce qui est fait en « 3 faites »."
    >
      <Bande compact />
      <div className="min-h-0 flex-1 overflow-hidden px-2 py-2">
        <div className="flex gap-0.5 rounded-lg bg-surface-high p-0.5">
          <span className="surface flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md text-xs font-medium text-ink shadow-sm"><Vivant />Session</span>
          <span className="flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md text-xs font-medium text-ink-faint">Projet<Count tone="caution">2</Count></span>
        </div>
        <div className="mt-2 rounded-lg border border-line p-2">
          <div className="flex items-center gap-1.5"><Loader size={12} className="animate-spin text-accent" /><span className="flex-1 text-xs font-medium text-ink">Écrit depuis 4 min</span><span className="text-micro text-ink-faint">38 %</span></div>
          <div className="mt-1 truncate font-mono text-micro text-ink-faint">Edit · OngletProjetPrototypes.tsx</div>
        </div>
        <Titre icone={<ListChecks size={12} />} fin={<Avancement fait={3} total={6} />}>Plan</Titre>
        <div className="px-1.5 pb-0.5 text-micro text-ink-faint">✓ 3 faites</div>
        {PLAN.slice(3).map((etape) => (
          <div key={etape.label} className={cx('flex min-h-6 items-center gap-1.5 rounded-md px-1.5', etape.etat === 'en_cours' && 'bg-accent-wash/60')}>
            {etape.etat === 'en_cours' ? <Loader size={11} className="text-accent" /> : <span className="size-2.5 rounded-full border border-line-strong" />}
            <span className="min-w-0 flex-1 truncate text-xs text-ink">{etape.label}</span>
          </div>
        ))}
        <Titre icone={<SquareKanban size={12} />}>Carte</Titre>
        <div className="rounded-lg border border-accent/40 bg-accent-wash/30 p-2">
          <div className="mb-1 text-xs leading-snug font-medium text-ink"><span className="text-ink-faint">#27 </span>{CARTE.titre}</div>
          <div className="mb-1 flex items-center gap-2"><SelectColonne colonne="in_progress" /><Avancement fait={2} total={5} /></div>
          {CARTE.cases.filter((tache) => !tache.fait).map((tache) => (
            <div key={tache.label} className="flex min-h-6 items-center gap-1.5 px-1">
              <span className="size-3 shrink-0 rounded border border-line-strong" />
              <span className="min-w-0 flex-1 truncate text-xs text-ink">{tache.label}</span>
            </div>
          ))}
        </div>
      </div>
    </Planche>
  )
}

export function OngletProjetTour2() {
  return (
    <div className="flex flex-col gap-10 bg-canvas p-8">
      <S1 />
      <S2 />
      <P />
      <K1 />
      <K2 />
      <S1Etroit />
    </div>
  )
}

/* =============================================================== tour 3 ==== */

function P2() {
  return (
    <Planche
      id="t3-p-avec-board"
      titre="P · le projet — avec la porte du board"
      note="Le bouton « Board » vit sur la ligne du projet, sous les segments : toujours au même endroit, visible sans défiler. Il ouvre le board du projet au centre ; le panneau reste ouvert sur la session. Le lien du bas disparaît, il faisait doublon."
    >
      <Bande />
      <div className="min-h-0 flex-1 overflow-hidden px-2.5 py-2.5">
        <Segments2 actif="projet" />
        <div className="mt-2.5 flex items-center gap-2 px-1">
          <span className="flex size-5 items-center justify-center rounded bg-accent text-micro font-bold text-accent-ink">S</span>
          <span className="flex-1 text-xs font-medium text-ink">Solera <span className="font-normal text-ink-faint">· 40 cartes</span></span>
          <Bouton icone={<Plus size={12} />}>Carte</Bouton>
          <Bouton icone={<SquareKanban size={12} />}>Board<ArrowUpRight size={11} /></Bouton>
        </div>
        <Titre icone={<Pin size={12} />}>Autour de #27</Titre>
        <Voisine icone={<Flag size={11} />} mot="jalon" numero={42} titre="Gestion de projet — 4 cartes sur 7" colonne="in_progress" />
        <Voisine icone={<Ban size={11} />} mot="bloque" numero={21} titre={CARTE.bloque[0]!.titre} colonne="todo" />
        <Voisine icone={<Link2 size={11} />} mot="citée par" numero={29} titre="Développer la vue Git du panneau" colonne="done" />
        <Titre icone={<Sparkles size={12} />}>Dans le projet, maintenant</Titre>
        <div className="flex min-h-8 items-center gap-2 rounded-md px-1.5">
          <Vivant /><AgentIcon agent="claude" size={12} decorative /><Num n={1} />
          <span className="min-w-0 flex-1 truncate text-xs text-ink">Rendre le design system vérifiable</span>
          <span className="text-micro text-ink-faint">écrit · 12 min</span>
        </div>
        {EN_REVUE.map((ligne) => (
          <div key={ligne.numero} className="flex min-h-8 items-center gap-2 rounded-md bg-caution/5 px-1.5">
            <Eye size={12} className="shrink-0 text-caution" /><Num n={ligne.numero} />
            <span className="min-w-0 flex-1 truncate text-xs text-ink">{ligne.titre}</span>
            <span className="text-micro text-caution">à relire</span>
          </div>
        ))}
        <Titre icone={<SquareKanban size={12} />}>Le reste</Titre>
        <div className="flex flex-col gap-1">
          <Section colonne="todo" titre="À faire" compte={A_FAIRE_TOTAL} replie />
          <Section colonne="in_progress" titre="En cours" compte={3} tone="accent" replie />
          <Section colonne="done" titre="Terminé cette semaine" compte={TERMINE_7J} replie />
        </div>
      </div>
    </Planche>
  )
}

/* La fiche d'une carte. Mêmes données dans les trois : #57, en revue, une session. */

const FICHE = {
  numero: 57,
  titre: 'Vue Git : trois dettes relevées à la relecture du lot 4',
  description: 'Relevées par la relecture de la PR #6 (`feat/vue-git-lot-4`), §6 et §7. Aucune n’est un défaut de sûreté — les cinq graves ont été corrigés avant la fusion — mais trois choses restent à reprendre avant que la vue ne grossisse encore.',
  cases: [
    { label: 'Le diff des fichiers binaires', fait: true },
    { label: 'La pagination du journal', fait: false },
    { label: 'Le message d’erreur du push refusé', fait: false },
  ],
}

const FIL = [
  { qui: 'codex', quoi: 'session', texte: 'Lot 4 : trois dettes', quand: 'hier 18 h' },
  { qui: 'codex', quoi: 'note', texte: 'Le diff binaire passe par `git diff --numstat` ; la pagination demande un curseur côté serveur, pas un offset.', quand: 'hier 19 h' },
  { qui: 'toi', quoi: 'colonne', texte: 'En cours → En revue', quand: 'il y a 2 h' },
] as const

function TeteFiche({ fermer = false }: { fermer?: boolean }) {
  return (
    <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line px-3">
      {fermer ? null : <ArrowLeft size={15} className="text-ink-soft" />}
      <Num n={FICHE.numero} />
      <SelectColonne colonne="review" />
      <span className="flex-1" />
      <Bouton icone={<Play size={12} />}>Reprendre</Bouton>
      <Bouton icone={<Plus size={12} />} primaire>Session</Bouton>
      <MoreHorizontal size={15} className="text-ink-faint" />
      {fermer ? <X size={15} className="text-ink-faint" /> : null}
    </div>
  )
}

function CasesFiche() {
  return (
    <div className="flex flex-col gap-0.5">
      {FICHE.cases.map((tache) => (
        <div key={tache.label} className="flex min-h-7 items-center gap-2 px-1">
          <span className={cx('flex size-3.5 items-center justify-center rounded border', tache.fait ? 'border-accent bg-accent text-accent-ink' : 'border-line-strong')}>{tache.fait ? <Check size={10} strokeWidth={3} /> : null}</span>
          <span className={cx('text-xs', tache.fait ? 'text-ink-faint line-through' : 'text-ink')}>{tache.label}</span>
        </div>
      ))}
      <span className="flex min-h-7 items-center gap-2 px-1 text-xs text-ink-faint"><Plus size={12} />Ajouter une sous-tâche</span>
    </div>
  )
}

function Proprietes({ colonne = false }: { colonne?: boolean }) {
  const ligne = (icone: ReactNode, mot: string, valeur: ReactNode) => (
    <div className={cx('flex min-h-8 items-center gap-2', colonne ? '' : 'px-1')}>
      <span className={cx('flex shrink-0 items-center gap-1.5 text-micro text-ink-faint', colonne ? 'w-20' : 'w-24')}>{icone}{mot}</span>
      <span className="min-w-0 flex-1 text-xs text-ink">{valeur}</span>
    </div>
  )
  return (
    <div className="flex flex-col">
      {colonne ? ligne(<CircleDot size={12} />, 'Colonne', <SelectColonne colonne="review" />) : null}
      {ligne(<Flag size={12} />, 'Jalon', <span className="flex items-center gap-1.5"><Num n={29} />Vue Git du panneau</span>)}
      {ligne(<CalendarDays size={12} />, 'Échéance', <span className="text-ink-faint">Aucune</span>)}
      {ligne(<Ban size={12} />, 'Bloque', <span className="flex items-center gap-1.5"><Num n={28} />PR, tickets et équipes</span>)}
      {ligne(<Link2 size={12} />, 'Citée par', <span className="flex items-center gap-1.5"><Num n={29} /><Num n={30} /></span>)}
      {ligne(<Paperclip size={12} />, 'Fichiers', <span className="text-ink-faint">Déposer ou parcourir</span>)}
    </div>
  )
}

function Fil() {
  return (
    <div className="flex flex-col">
      {FIL.map((evenement, index) => (
        <div key={index} className="relative flex gap-2.5 pb-3 pl-1">
          <span className="relative z-10 mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border border-line bg-surface">
            {evenement.qui === 'toi' ? <span className="text-micro font-semibold text-ink-soft">T</span> : <AgentIcon agent="codex" size={11} decorative />}
          </span>
          {index < FIL.length - 1 ? <span className="absolute top-6 bottom-0 left-[0.875rem] w-px bg-line" /> : null}
          <div className="min-w-0 flex-1">
            <div className="text-micro text-ink-faint">
              <span className="font-medium text-ink-soft">{evenement.qui === 'toi' ? 'Tim' : 'Codex'}</span>{' '}
              {evenement.quoi === 'session' ? 'a ouvert une session' : evenement.quoi === 'note' ? 'a laissé une note' : 'a déplacé la carte'} · {evenement.quand}
            </div>
            {evenement.quoi === 'note'
              ? <div className="mt-1 rounded-md border border-line px-2.5 py-1.5 text-xs leading-relaxed text-ink-soft">{evenement.texte}</div>
              : evenement.quoi === 'session'
                ? <div className="mt-1 flex items-center gap-1.5 text-xs text-ink"><MessageSquare size={11} className="text-ink-faint" />{evenement.texte}<ChevronRight size={11} className="text-ink-faint" /></div>
                : <div className="mt-0.5 text-xs text-ink-soft">{evenement.texte}</div>}
          </div>
        </div>
      ))}
      <span className="ml-8 flex h-8 items-center rounded-md border border-line px-2.5 text-xs text-ink-faint">Laisser une note…</span>
    </div>
  )
}

function F1() {
  return (
    <Planche
      id="t3-f1-onglets"
      titre="F1 · onglets, resserrés — Détails, Fil, Sessions"
      note="La fiche d’aujourd’hui, remise d’aplomb plutôt que refaite. Les actions passent dans la tête (colonne, reprendre, nouvelle session, ⋯ pour modifier et supprimer) : le gros bouton violet et la bande « Créée par » du bas disparaissent. « Activité » devient « Fil ». Le titre s’édite en cliquant dessus, la description aussi — plus de bouton « Modifier la carte ». Ce qui reste caché : les notes et les sessions sont à un onglet."
    >
      <Bande />
      <TeteFiche />
      <div className="min-h-0 flex-1 overflow-hidden px-3.5 py-3">
        <div className="mb-3 text-base leading-snug font-semibold text-ink">{FICHE.titre}</div>
        <div className="mb-3 flex gap-4 border-b border-line text-xs">
          <span className="border-b-2 border-accent pb-1.5 font-medium text-ink">Détails</span>
          <span className="flex items-center gap-1 pb-1.5 text-ink-faint">Fil <Count>3</Count></span>
          <span className="flex items-center gap-1 pb-1.5 text-ink-faint">Sessions <Count>1</Count></span>
        </div>
        <p className="mb-3 text-xs leading-relaxed text-ink-soft">{FICHE.description}</p>
        <div className="mb-1 flex items-center gap-2"><span className="text-micro font-semibold tracking-wide text-ink-faint uppercase">Sous-tâches</span><Avancement fait={1} total={3} /></div>
        <CasesFiche />
        <div className="mt-3 border-t border-line pt-2"><Proprietes /></div>
      </div>
    </Planche>
  )
}

function F2() {
  return (
    <Planche
      id="t3-f2-un-tenant"
      hauteur="h-[58rem]"
      titre="F2 · d’un seul tenant — propriétés, énoncé, fil"
      note="Pas d’onglets : la fiche se lit de haut en bas, comme un ticket. Les propriétés en tableau sous le titre (jalon, échéance, liens, fichiers), puis l’énoncé et ses cases, puis un fil unique où se mêlent notes, sessions et changements de colonne, dans l’ordre du temps. On voit tout en défilant ; c’est plus long, mais rien n’est derrière une porte."
    >
      <Bande />
      <TeteFiche />
      <div className="min-h-0 flex-1 overflow-hidden px-3.5 py-3">
        <div className="mb-2 text-base leading-snug font-semibold text-ink">{FICHE.titre}</div>
        <Proprietes />
        <div className="my-3 h-px bg-line" />
        <p className="mb-3 text-xs leading-relaxed text-ink-soft">{FICHE.description}</p>
        <div className="mb-1 flex items-center gap-2"><span className="text-micro font-semibold tracking-wide text-ink-faint uppercase">Sous-tâches</span><Avancement fait={1} total={3} /></div>
        <CasesFiche />
        <div className="my-3 h-px bg-line" />
        <div className="mb-2 text-micro font-semibold tracking-wide text-ink-faint uppercase">Fil</div>
        <Fil />
      </div>
    </Planche>
  )
}

function F3() {
  return (
    <Planche
      id="t3-f3-tiroir-du-board"
      largeur="w-[54rem]"
      hauteur="h-[40rem]"
      titre="F3 · le tiroir du board, large — F2 en deux colonnes"
      note="La même fiche que F2 quand la place le permet : l’énoncé et le fil à gauche, les propriétés à droite, colonne comprise. Sous ~40 rem (le panneau accolé, le téléphone), elle se replie d’elle-même en F2. Une fiche, deux largeurs — pas deux composants."
    >
      <TeteFiche fermer />
      <div className="flex min-h-0 flex-1">
        <div className="min-h-0 flex-1 overflow-hidden px-5 py-4">
          <div className="mb-3 text-lg leading-snug font-semibold text-ink">{FICHE.titre}</div>
          <p className="mb-3 text-sm leading-relaxed text-ink-soft">{FICHE.description}</p>
          <div className="mb-1 flex items-center gap-2"><span className="text-micro font-semibold tracking-wide text-ink-faint uppercase">Sous-tâches</span><Avancement fait={1} total={3} /></div>
          <CasesFiche />
          <div className="my-3 h-px bg-line" />
          <div className="mb-2 text-micro font-semibold tracking-wide text-ink-faint uppercase">Fil</div>
          <Fil />
        </div>
        <div className="w-[17rem] shrink-0 border-l border-line bg-surface-high/30 px-3.5 py-4">
          <Proprietes colonne />
          <div className="mt-3 mb-1 text-micro font-semibold tracking-wide text-ink-faint uppercase">Sessions</div>
          <div className="flex min-h-7 items-center gap-2 text-xs text-ink"><AgentIcon agent="codex" size={12} decorative /><span className="flex-1 truncate">Lot 4 : trois dettes</span><span className="text-micro text-ink-faint">au repos</span></div>
          <div className="mt-4 flex items-center gap-1.5 border-t border-line pt-3 text-micro text-ink-faint">Créée par Tim · 15 oct.<span className="flex-1" /><Trash2 size={12} /></div>
        </div>
      </div>
    </Planche>
  )
}

export function OngletProjetTour3() {
  return (
    <div className="flex flex-col gap-10 bg-canvas p-8">
      <P2 />
      <F1 />
      <F2 />
      <F3 />
    </div>
  )
}
