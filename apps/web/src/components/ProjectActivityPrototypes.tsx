/*
 * MAQUETTE JETABLE — la page d'un projet : l'activité, les worktrees, le jalon lancé
 * (carte #73).
 *
 * Ce que Tim a déjà tranché au premier échange, et qu'on ne rouvre pas ici :
 *   - on ouvre sur l'**Aperçu enrichi**, qui renvoie vers un onglet Activité complet ;
 *   - **une** vue Activité, deux regroupements (par état, par worktree) — pas d'onglets
 *     Worktrees et Branches à part ;
 *   - la vue tous projets confondus vit dans le **portefeuille** ;
 *   - le jalon lancé se voit **aux trois endroits** : en tête de l'Activité, dans sa
 *     propre vue, et dans la Chronologie.
 *
 * Les libellés sont en clair, contrairement à la règle de `t()` : rien d'ici ne part en
 * production. À supprimer avec `scripts/projet-prototypes.mjs`.
 */
import {
  ArrowRight,
  CalendarClock,
  Check,
  ChevronDown,
  ChevronRight,
  CircleDot,
  Flag,
  FolderGit2,
  GitBranch,
  GitMerge,
  GitPullRequest,
  GitPullRequestDraft,
  History,
  Layers,
  ListFilter,
  Lock,
  MessageCircleQuestion,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  ShieldQuestion,
  SquareKanban,
  Target,
  Trash2,
  TriangleAlert,
  Waypoints,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { cx } from '@solera/ui'
import { AgentIcon } from './AgentIcon'

/* ---------------------------------------------------------------- données ---- */

type Etat = 'attend' | 'relire' | 'cours' | 'finie' | 'erreur'
type Pr = { n: number; etat: 'checks' | 'ok' | 'echec' | 'fusionnee' | 'brouillon' }

interface Session {
  nom: string
  resume: string
  etat: Etat
  agent: 'claude' | 'codex'
  carte?: number
  worktree: string | null // null : la racine du projet
  branche: string
  pr?: Pr
  age: string
  projet?: string
  /** Une carte qui réclame quelqu'un sans qu'aucune session la porte : ce que montrait Travail. */
  carteSeule?: boolean
  question?: { texte: string; depuis: string; choix?: string[]; permission?: string }
}

const SESSIONS: Session[] = [
  {
    nom: 'Dessiner la page projet',
    resume: 'Le jalon lancé : un bandeau, une vue, ou la chronologie ?',
    etat: 'attend', agent: 'claude', carte: 73, worktree: 'design__page-projet', branche: 'design/page-projet', age: '42 min',
    question: {
      texte: 'Le jalon lancé (#72), où le voit-on sur la page projet ?',
      depuis: '3 min',
      choix: ['En tête de l’Activité', 'Un onglet Jalon', 'Dans la Chronologie'],
    },
  },
  {
    nom: 'Tri des nouveautés de Sillage',
    resume: 'Demande à lancer pnpm install dans le worktree',
    etat: 'attend', agent: 'claude', carte: 65, worktree: 'feat__tri-sillage', branche: 'feat/tri-sillage', age: '1 h 05',
    question: { texte: 'Autoriser une commande', depuis: '12 min', permission: 'pnpm install --ignore-scripts' },
  },
  {
    nom: 'Vue Git, lot 3',
    resume: 'Interrompue : le serveur de dev a redémarré pendant le tour',
    etat: 'erreur', agent: 'codex', carte: 50, worktree: 'feat__vue-git-lot-3', branche: 'feat/vue-git-lot-3', age: '2 h',
  },
  {
    nom: 'Lier un design system au projet',
    resume: 'PR ouverte : 9 fichiers, tests verts, relecture demandée',
    etat: 'relire', agent: 'claude', carte: 62, worktree: 'feat__ds-lie-au-projet', branche: 'feat/ds-lie-au-projet', age: '55 min',
    pr: { n: 17, etat: 'ok' },
  },
  {
    nom: 'Flow de projet, cards et jalons',
    resume: 'Rédige les cartes #66 à #74 du jalon',
    etat: 'cours', agent: 'claude', worktree: null, branche: 'main', age: '50 min',
  },
  {
    nom: 'Worktree disparu',
    resume: 'Écrit le bandeau Archiver / Continuer à la racine',
    etat: 'cours', agent: 'claude', carte: 61, worktree: 'fix__worktree-disparu', branche: 'fix/worktree-disparu', age: '18 min',
    pr: { n: 18, etat: 'checks' },
  },
  {
    nom: 'Relecture de la PR #18',
    resume: 'Lit le diff du composer, 2 remarques pour l’instant',
    etat: 'cours', agent: 'codex', carte: 61, worktree: 'fix__worktree-disparu', branche: 'fix/worktree-disparu', age: '4 min',
    pr: { n: 18, etat: 'checks' },
  },
  {
    nom: 'Réutilisation du design system',
    resume: 'Trois composants remontés dans @solera/ui',
    etat: 'finie', agent: 'claude', worktree: null, branche: 'main', age: '5 h',
  },
  {
    nom: 'Relecture PR #16 — onglet Projet',
    resume: 'Fusionnée après deux tours de revue',
    etat: 'finie', agent: 'claude', carte: 31, worktree: 'feat__onglet-projet', branche: 'feat/onglet-projet', age: '1 j',
    pr: { n: 16, etat: 'fusionnee' },
  },
  {
    nom: 'Sessions inachevées et worktrees',
    resume: 'Diagnostic rendu, carte #61 ouverte',
    etat: 'finie', agent: 'claude', worktree: null, branche: 'main', age: '1 j',
  },
]

const GROUPES: { etat: Etat[]; titre: string; ton: string }[] = [
  { etat: ['attend', 'erreur'], titre: 'Te demande quelque chose', ton: 'bg-caution' },
  { etat: ['relire'], titre: 'Prête à relire', ton: 'bg-positive' },
  { etat: ['cours'], titre: 'En cours', ton: 'bg-accent' },
  { etat: ['finie'], titre: 'Terminées', ton: 'bg-ink-faint' },
]

/* ---------------------------------------------------------------- briques ---- */

function Bloc({ id, titre, note, largeur = 'w-[74rem]', children }: {
  id: string
  titre: string
  note: string
  largeur?: string
  children: ReactNode
}) {
  return (
    <section data-proto={id} data-shot={id} className={cx('flex flex-col gap-1.5 p-3', largeur)}>
      <h2 className="text-sm font-semibold text-ink">{titre}</h2>
      <div className="surface overflow-hidden rounded-xl border border-line shadow-float">{children}</div>
      <p className="text-meta leading-relaxed text-ink-faint">{note}</p>
    </section>
  )
}

function Bande() {
  return (
    <div className="flex h-12 items-center gap-2 border-b border-line px-3">
      <span className="size-5 shrink-0 rounded-md bg-accent/70" />
      <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">Solera</span>
      <span className="flex items-center gap-1 rounded-md border border-line px-1.5 py-0.5 text-meta text-ink-soft"><GitBranch size={11} />main</span>
      <span className="flex h-7 items-center gap-1.5 rounded-md bg-accent px-2.5 text-xs font-medium text-accent-ink"><Plus size={14} />Nouvelle conversation</span>
      <span className="flex size-7 items-center justify-center text-ink-faint"><MoreHorizontal size={16} /></span>
    </div>
  )
}

type Onglet = 'apercu' | 'activite' | 'board' | 'planifiees' | 'jalons' | 'journal'

function Onglets({ actif, action }: { actif: Onglet; action?: ReactNode }) {
  const tabs: { id: Onglet; label: string; icon: ReactNode; count?: number; caution?: boolean }[] = [
    { id: 'apercu', label: 'Aperçu', icon: <Target size={15} /> },
    { id: 'activite', label: 'Activité', icon: <Layers size={15} />, count: 3, caution: true },
    { id: 'board', label: 'Board', icon: <SquareKanban size={15} />, count: 21 },
    { id: 'planifiees', label: 'Planifiées', icon: <CalendarClock size={15} />, count: 2 },
    { id: 'jalons', label: 'Jalons', icon: <Flag size={15} /> },
    { id: 'journal', label: 'Journal', icon: <History size={15} /> },
  ]
  return (
    <div className="flex items-center gap-5 border-b border-line px-4">
      {tabs.map((tab) => (
        <span
          key={tab.id}
          className={cx(
            'flex min-h-11 items-center gap-2 border-b-2 px-1 text-sm whitespace-nowrap',
            tab.id === actif ? 'border-accent text-ink' : 'border-transparent text-ink-faint',
          )}
        >
          <span className="text-ink-faint">{tab.icon}</span>
          {tab.label}
          {tab.count ? (
            <span className={cx('rounded px-1.5 py-0.5 text-xs tabular-nums', tab.caution ? 'bg-caution/15 text-caution' : 'bg-surface-high text-ink-faint')}>{tab.count}</span>
          ) : null}
        </span>
      ))}
      {action ? <span className="ml-auto flex items-center gap-1.5 py-1.5">{action}</span> : null}
    </div>
  )
}

function Point({ etat }: { etat: Etat }) {
  return (
    <span className={cx(
      'block size-2 shrink-0 rounded-full',
      etat === 'attend' && 'bg-caution',
      etat === 'erreur' && 'bg-critical',
      etat === 'relire' && 'bg-positive',
      etat === 'cours' && 'bg-accent animate-pulse',
      etat === 'finie' && 'bg-ink-faint/50',
    )} />
  )
}

function Carte({ n }: { n: number }) {
  return <span className="shrink-0 rounded bg-surface-high px-1 py-px text-meta tabular-nums text-ink-soft">#{n}</span>
}

function Branche({ s, court = false }: { s: Pick<Session, 'worktree' | 'branche'>; court?: boolean }) {
  return (
    <span className={cx('flex min-w-0 items-center gap-1 text-meta', s.worktree ? 'text-ink-soft' : 'text-ink-faint')}>
      {s.worktree ? <FolderGit2 size={12} className="shrink-0" /> : <GitBranch size={12} className="shrink-0" />}
      <span className="truncate font-mono">{s.worktree ? s.branche : court ? 'racine' : 'racine · main'}</span>
    </span>
  )
}

function PrBadge({ pr }: { pr: Pr }) {
  const styles: Record<Pr['etat'], { cls: string; icon: ReactNode; mot: string }> = {
    checks: { cls: 'bg-caution/12 text-caution', icon: <GitPullRequest size={11} />, mot: 'checks…' },
    echec: { cls: 'bg-critical/12 text-critical', icon: <GitPullRequest size={11} />, mot: 'échec' },
    ok: { cls: 'bg-positive/12 text-positive', icon: <GitPullRequest size={11} />, mot: 'prête' },
    fusionnee: { cls: 'bg-loop/12 text-loop', icon: <GitMerge size={11} />, mot: 'fusionnée' },
    brouillon: { cls: 'bg-surface-high text-ink-faint', icon: <GitPullRequestDraft size={11} />, mot: 'brouillon' },
  }
  const s = styles[pr.etat]
  return (
    <span className={cx('flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-meta font-medium tabular-nums', s.cls)}>
      {s.icon}#{pr.n}<span className="font-normal opacity-80">{s.mot}</span>
    </span>
  )
}

function Projet({ nom }: { nom: string }) {
  const teinte: Record<string, string> = { Solera: 'bg-accent/70', Vault: 'bg-positive/70', 'Site perso': 'bg-caution/70' }
  return (
    <span className="flex shrink-0 items-center gap-1 text-meta text-ink-soft">
      <span className={cx('size-2 rounded-sm', teinte[nom] ?? 'bg-ink-faint')} />{nom}
    </span>
  )
}

/** La ligne de session : une ligne au large, toujours dans le même ordre. */
function Ligne({ s, colonneProjet = false, sansBranche = false, ouverte = false }: { s: Session; colonneProjet?: boolean; sansBranche?: boolean; ouverte?: boolean }) {
  return (
    <div className={cx('flex h-10 items-center gap-3 px-4', ouverte && 'bg-accent-wash/60')}>
      <Point etat={s.etat} />
      {s.carteSeule ? <SquareKanban size={14} className="shrink-0 text-ink-faint" /> : <AgentIcon agent={s.agent} size={14} />}
      {colonneProjet && s.projet ? <span className="w-20 shrink-0"><Projet nom={s.projet} /></span> : null}
      <span className={cx('w-60 shrink-0 truncate text-sm', s.etat === 'finie' ? 'text-ink-soft' : 'font-medium text-ink')}>{s.nom}</span>
      <span className={cx('min-w-0 flex-1 truncate text-xs', s.etat === 'attend' ? 'text-caution' : s.etat === 'erreur' ? 'text-critical' : 'text-ink-faint')}>
        {s.etat === 'attend' && s.question ? <span className="font-medium">Attend {s.question.depuis} · </span> : null}
        {s.resume}
      </span>
      {s.carte ? <Carte n={s.carte} /> : <span className="w-7 shrink-0" />}
      {sansBranche ? null : <span className="w-44 shrink-0">{s.carteSeule ? <span className="text-meta text-ink-faint">aucune session</span> : <Branche s={s} />}</span>}
      {sansBranche ? null : <span className="flex w-28 shrink-0 justify-end">{s.pr ? <PrBadge pr={s.pr} /> : null}</span>}
      <span className="w-12 shrink-0 text-right text-meta tabular-nums text-ink-faint">{s.age}</span>
    </div>
  )
}

function EnteteGroupe({ titre, ton, n, plie = false }: { titre: string; ton: string; n: number; plie?: boolean }) {
  return (
    <div className="flex items-center gap-2 border-y border-line bg-sunken/60 px-4 py-1.5 first:border-t-0">
      {plie ? <ChevronRight size={13} className="text-ink-faint" /> : <ChevronDown size={13} className="text-ink-faint" />}
      <span className={cx('size-2 rounded-full', ton)} />
      <span className="text-xs font-medium text-ink-soft">{titre}</span>
      <span className="rounded-md bg-surface-high px-1.5 text-meta tabular-nums text-ink-faint">{n}</span>
    </div>
  )
}

function Compteurs({ demandent = 3, relire = 1 }: { demandent?: number; relire?: number }) {
  return (
    <span className="flex items-center gap-1.5 text-xs text-ink-soft">
      <span className="font-medium text-caution">{demandent} te demandent</span>·
      <span>{relire} à relire</span>·
      <span>3 en cours</span>·
      <span className="text-ink-faint">11 terminées</span>
    </span>
  )
}

function Bascule({ actif, options = ['État', 'Worktree'] }: { actif: string; options?: string[] }) {
  return (
    <span className="flex rounded-md border border-line p-0.5 text-xs">
      {options.map((o) => (
        <span key={o} className={cx('rounded px-2 py-0.5', o === actif ? 'bg-surface-high font-medium text-ink' : 'text-ink-faint')}>{o}</span>
      ))}
    </span>
  )
}

function BarreActivite({ actif, options, compteurs }: { actif: string; options?: string[]; compteurs?: { demandent: number; relire: number } }) {
  return (
    <div className="flex items-center gap-3 px-4 py-2.5">
      <Compteurs {...compteurs} />
      <span className="ml-auto flex items-center gap-2">
        <span className="flex h-7 w-52 items-center gap-1.5 rounded-md border border-line px-2 text-xs text-ink-faint"><Search size={13} />Filtrer : s:attend, #61…</span>
        <span className="text-meta text-ink-faint">Grouper par</span>
        <Bascule actif={actif} options={options} />
      </span>
    </div>
  )
}

/** L'aperçu d'une question en attente, déplié sous sa ligne. */
function Apercu({ s }: { s: Session }) {
  const q = s.question!
  return (
    <div className="border-y border-caution/30 bg-caution/5 px-4 py-3 pl-[3.25rem]">
      <div className="flex items-center gap-2 text-xs text-caution">
        {q.permission ? <ShieldQuestion size={14} /> : <MessageCircleQuestion size={14} />}
        <span className="font-medium">{q.permission ? 'Permission demandée' : 'Question'}</span>
        <span className="text-ink-faint">· attend depuis {q.depuis}</span>
        <span className="ml-auto flex items-center gap-1 text-ink-faint">Ouvrir le fil <ArrowRight size={12} /></span>
      </div>
      <p className="mt-1.5 text-sm text-ink">{q.texte}</p>
      {q.permission ? (
        <div className="mt-2 flex items-center gap-2">
          <code className="rounded-md bg-sunken px-2 py-1 font-mono text-code text-ink">{q.permission}</code>
          <span className="ml-auto flex gap-1.5">
            <span className="rounded-md border border-line px-2.5 py-1 text-xs text-ink-soft">Refuser</span>
            <span className="rounded-md border border-line px-2.5 py-1 text-xs text-ink-soft">Toujours dans ce worktree</span>
            <span className="rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-accent-ink">Autoriser</span>
          </span>
        </div>
      ) : (
        <>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {q.choix?.map((c, i) => (
              <span key={c} className="flex items-center gap-1.5 rounded-md border border-line bg-surface px-2.5 py-1 text-xs text-ink-soft">
                <span className="text-meta tabular-nums text-ink-faint">{i + 1}</span>{c}
              </span>
            ))}
          </div>
          <div className="mt-2 flex h-8 items-center rounded-md border border-line bg-surface px-2.5 text-xs text-ink-faint">
            Répondre sans ouvrir le fil…<span className="ml-auto text-meta">Entrée pour envoyer</span>
          </div>
        </>
      )}
    </div>
  )
}

function ListeParEtat({ sessions, colonneProjet = false, ouvrir }: { sessions: Session[]; colonneProjet?: boolean; ouvrir?: string }) {
  return (
    <div>
      {GROUPES.map((g) => {
        const items = sessions.filter((s) => g.etat.includes(s.etat))
        if (items.length === 0) return null
        return (
          <div key={g.titre}>
            <EnteteGroupe titre={g.titre} ton={g.ton} n={g.etat.includes('finie') ? 11 : items.length} />
            <div className="divide-y divide-line/60">
              {items.map((s) => (
                <div key={s.nom}>
                  <Ligne s={s} colonneProjet={colonneProjet} ouverte={ouvrir === s.nom} />
                  {ouvrir === s.nom ? <Apercu s={s} /> : null}
                </div>
              ))}
              {g.etat.includes('finie') ? (
                <div className="px-4 py-2 pl-[3.25rem] text-xs text-ink-faint">… 8 de plus, cette semaine</div>
              ) : null}
            </div>
          </div>
        )
      })}
    </div>
  )
}

/* ------------------------------------------------- le jalon lancé, en bandeau ---- */

type EtatCarte = 'fusionnee' | 'revue' | 'cours' | 'file' | 'attente' | 'bloquee'

const CARTES_JALON: { n: number; titre: string; etat: EtatCarte; par: number[]; vague: number; session?: string }[] = [
  { n: 65, titre: 'Trier et porter Sillage', etat: 'cours', par: [], vague: 1, session: 'attend 12 min' },
  { n: 66, titre: 'Ce qu’un agent fait avec les cartes', etat: 'file', par: [65], vague: 2 },
  { n: 68, titre: 'PR, revue en boucle, fusion', etat: 'file', par: [65], vague: 2 },
  { n: 73, titre: 'Dessiner la page projet', etat: 'cours', par: [65], vague: 2, session: 'attend 3 min' },
  { n: 67, titre: 'Colonne « À préciser »', etat: 'attente', par: [66], vague: 3 },
  { n: 70, titre: 'Découper depuis une dictée', etat: 'attente', par: [66], vague: 3 },
  { n: 71, titre: 'Promouvoir une sous-tâche', etat: 'attente', par: [66], vague: 3 },
  { n: 74, titre: 'Onglet Agents façon Claude Code', etat: 'attente', par: [65, 73], vague: 3 },
  { n: 69, titre: 'Clore une carte finie', etat: 'attente', par: [66, 68], vague: 3 },
  { n: 72, titre: 'Lancer un jalon', etat: 'attente', par: [66, 67, 68], vague: 4 },
]

const TON_CARTE: Record<EtatCarte, string> = {
  fusionnee: 'bg-loop',
  revue: 'bg-positive',
  cours: 'bg-accent',
  file: 'bg-ink-faint/60',
  attente: 'bg-line-strong',
  bloquee: 'bg-critical',
}

const MOT_CARTE: Record<EtatCarte, string> = {
  fusionnee: 'fusionnée',
  revue: 'en revue',
  cours: 'en cours',
  file: 'prête, en file',
  attente: 'attend ses dépendances',
  bloquee: 'bloquée',
}

function Segments({ grand = false }: { grand?: boolean }) {
  return (
    <span className={cx('flex gap-0.5', grand ? 'w-full' : 'w-56')}>
      {CARTES_JALON.map((c) => (
        <span key={c.n} title={`#${c.n}`} className={cx('flex-1 rounded-sm', grand ? 'h-2' : 'h-1.5', TON_CARTE[c.etat], c.etat === 'cours' && 'animate-pulse')} />
      ))}
    </span>
  )
}

function BandeauJalon() {
  return (
    <div className="mx-4 my-3 rounded-xl border border-accent/30 bg-accent-wash/40 px-4 py-3">
      <div className="flex items-center gap-2.5">
        <Flag size={15} className="text-accent" />
        <span className="text-sm font-semibold text-ink">#75 Orchestrer le travail par cartes</span>
        <span className="rounded bg-accent px-1.5 py-0.5 text-meta font-medium text-accent-ink">lancé</span>
        <span className="flex items-center gap-1 text-meta text-ink-soft"><GitBranch size={11} /><span className="font-mono">jalon/orchestrer</span></span>
        <span className="ml-auto flex items-center gap-1 text-xs text-accent">Voir le jalon <ArrowRight size={12} /></span>
      </div>
      <div className="mt-2.5 flex items-center gap-4">
        <Segments />
        <span className="text-xs tabular-nums text-ink-soft"><b className="font-semibold text-ink">0</b>/10 fusionnées</span>
        <span className="text-xs text-ink-soft">2/3 sessions occupées</span>
        <span className="text-xs text-ink-soft">2 prêtes en file</span>
        <span className="text-xs text-ink-faint">6 attendent leurs dépendances</span>
        <span className="ml-auto text-xs font-medium text-caution">2 te demandent quelque chose</span>
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------- planches ---- */

/** A1 — l'Aperçu actuel, plus un bloc « En ce moment » sous les tuiles. */
function A1() {
  const vivantes = SESSIONS.filter((s) => s.etat === 'attend' || s.etat === 'erreur' || s.etat === 'cours' || s.etat === 'relire')
  return (
    <Bloc
      id="a1-apercu-tuiles-et-en-ce-moment"
      titre="A1 · L’Aperçu garde ses tuiles, et gagne « En ce moment »"
      note="Les quatre tuiles d’aujourd’hui ne bougent pas. Dessous, les sessions vivantes en lignes courtes — ce qui te demande quelque chose d’abord, avec la question en clair — et un lien vers l’onglet Activité, qui porte le reste. Le bandeau du jalon lancé se glisse entre les deux. Les tuiles comptent et la liste nomme : la redite est acceptée, pour garder les tuiles qu’on connaît (retenu contre A2)."
    >
      <Bande />
      <Onglets actif="apercu" />
      <div className="flex flex-col gap-4 p-5">
        <div className="grid grid-cols-4 gap-3">
          {[
            { ton: 'caution', icone: <MessageCircleQuestion size={14} />, label: 'Te demandent', n: 3, d: 'depuis 12 min' },
            { ton: 'caution', icone: <Pencil size={14} />, label: 'À vérifier', n: 1, d: 'carte #62' },
            { ton: 'neutral', icone: <GitBranch size={14} />, label: 'Non commités', n: 3, d: 'sur main' },
            { ton: 'accent', icone: <span className="block size-1.5 rounded-full bg-accent" />, label: 'En cours', n: 3, d: 'depuis 50 min' },
          ].map((t) => (
            <div key={t.label} className={cx('rounded-xl border px-3.5 py-3', t.ton === 'caution' ? 'border-caution/30 bg-caution/5' : t.ton === 'accent' ? 'border-accent/30 bg-accent-wash/40' : 'border-line')}>
              <div className={cx('flex items-center gap-1.5 text-xs', t.ton === 'caution' ? 'text-caution' : t.ton === 'accent' ? 'text-accent' : 'text-ink-soft')}>{t.icone}{t.label}</div>
              <div className="mt-1 flex items-baseline gap-2"><span className="text-lg font-semibold tabular-nums text-ink">{t.n}</span><span className="text-meta text-ink-faint">{t.d}</span></div>
            </div>
          ))}
        </div>
        <div className="-mx-4"><BandeauJalon /></div>
        <section className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2 px-1">
            <CircleDot size={14} className="text-ink-faint" />
            <span className="flex-1 text-sm text-ink-soft">En ce moment</span>
            <span className="flex items-center gap-1 text-xs text-accent">Toute l’activité <ArrowRight size={12} /></span>
          </div>
          <div className="divide-y divide-line/60 rounded-xl border border-line">
            {vivantes.map((s) => <Ligne key={s.nom} s={s} />)}
          </div>
        </section>
        <div className="grid grid-cols-3 gap-3 opacity-60">
          {['Jalon courant', 'Échéances', 'Journal'].map((t) => (
            <div key={t} className="h-20 rounded-xl border border-dashed border-line px-3.5 py-3 text-xs text-ink-faint">{t} — inchangé</div>
          ))}
        </div>
      </div>
    </Bloc>
  )
}

/** A2 — « En ce moment » remplace les tuiles : une seule lecture de l'état. */
function A2() {
  const attendent = SESSIONS.filter((s) => s.etat === 'attend' || s.etat === 'erreur')
  const cours = SESSIONS.filter((s) => s.etat === 'cours' || s.etat === 'relire')
  return (
    <Bloc
      id="a2-apercu-en-ce-moment-remplace-les-tuiles"
      titre="A2 · « En ce moment » prend la place des tuiles"
      note="Les tuiles disparaissent : chaque demande devient sa ligne, la question en clair et le bouton à côté. Ce qui tourne se lit en puces, avec le worktree. Plus dense que A1, et plus de redite ; mais « 3 non commités sur main » perd sa tuile et passe en pied de bloc. Le bandeau du jalon reste sous le bloc."
    >
      <Bande />
      <Onglets actif="apercu" />
      <div className="flex flex-col gap-4 p-5">
        <section className="rounded-xl border border-line">
          <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
            <CircleDot size={14} className="text-ink-faint" />
            <span className="text-sm font-medium text-ink">En ce moment</span>
            <Compteurs />
            <span className="ml-auto flex items-center gap-1 text-xs text-accent">Toute l’activité <ArrowRight size={12} /></span>
          </div>
          <div className="divide-y divide-line/60">
            {attendent.map((s) => (
              <div key={s.nom} className="flex items-center gap-3 px-4 py-2.5">
                <Point etat={s.etat} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-ink">{s.nom}</span>
                    {s.carte ? <Carte n={s.carte} /> : null}
                    <Branche s={s} />
                  </div>
                  <div className={cx('mt-0.5 truncate text-xs', s.etat === 'erreur' ? 'text-critical' : 'text-caution')}>
                    {s.question ? (s.question.permission ? <>Autoriser <code className="font-mono">{s.question.permission}</code> ?</> : s.question.texte) : s.resume}
                    {s.question ? <span className="text-ink-faint"> · depuis {s.question.depuis}</span> : null}
                  </div>
                </div>
                <span className={cx('shrink-0 rounded-md px-2.5 py-1 text-xs font-medium', s.etat === 'erreur' ? 'border border-line text-ink-soft' : 'bg-accent text-accent-ink')}>
                  {s.etat === 'erreur' ? 'Reprendre' : s.question?.permission ? 'Autoriser' : 'Répondre'}
                </span>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-2.5">
            {cours.map((s) => (
              <span key={s.nom} className="flex items-center gap-1.5 rounded-full border border-line py-1 pl-2 pr-2.5 text-xs text-ink-soft">
                <Point etat={s.etat} />{s.nom}<span className="text-ink-faint">·</span><Branche s={s} court />
              </span>
            ))}
            <span className="ml-auto flex items-center gap-1 text-meta text-ink-faint"><GitBranch size={11} />3 fichiers non commités sur main</span>
          </div>
        </section>
        <div className="-mx-4 -my-3"><BandeauJalon /></div>
        <div className="grid grid-cols-3 gap-3 opacity-60">
          {['Jalon courant', 'Échéances', 'Journal'].map((t) => (
            <div key={t} className="h-20 rounded-xl border border-dashed border-line px-3.5 py-3 text-xs text-ink-faint">{t} — inchangé</div>
          ))}
        </div>
      </div>
    </Bloc>
  )
}

function B1() {
  return (
    <Bloc
      id="b1-activite-par-etat"
      titre="B1 · Onglet Activité, groupé par état"
      note="Le parti de l’agent view, en colonnes fixes pour que l’œil descende : état, agent, nom, résumé d’une ligne, carte, worktree et branche, PR, âge. Une session en erreur monte avec celles qui te demandent quelque chose : dans les deux cas c’est à toi de jouer. « Prête à relire » = une PR ouverte ou une carte en À vérifier (suppose #68 pour la PR). Les terminées se plient après trois."
    >
      <Bande />
      <Onglets actif="activite" />
      <BarreActivite actif="État" />
      <ListeParEtat sessions={SESSIONS} />
    </Bloc>
  )
}

function B2() {
  return (
    <Bloc
      id="b2-question-depliee"
      titre="B2 · La question dépliée sous sa ligne, et la réponse sans ouvrir le fil"
      note="Un clic sur la ligne déplie l’aperçu en place (Espace au clavier, ↑ ↓ pour passer à la suivante sans refermer). Choix numérotés, champ libre, et pour une permission les trois mêmes boutons que dans le fil. Ouvrir le fil reste à droite. Pas de tiroir latéral : il cacherait les colonnes worktree et PR qu’on est venu lire."
    >
      <Onglets actif="activite" />
      <BarreActivite actif="État" />
      <EnteteGroupe titre="Te demande quelque chose" ton="bg-caution" n={3} />
      <Ligne s={SESSIONS[0]!} ouverte />
      <Apercu s={SESSIONS[0]!} />
      <Ligne s={SESSIONS[1]!} ouverte />
      <Apercu s={SESSIONS[1]!} />
      <Ligne s={SESSIONS[2]!} />
    </Bloc>
  )
}

/* ------------------------------------------------- regroupement par worktree ---- */

interface Arbre {
  nom: string
  branche: string
  avance: string
  sale?: number
  pr?: Pr
  etat: 'actif' | 'racine'
}

const ARBRES: Arbre[] = [
  { nom: 'Racine du projet', branche: 'main', avance: 'branche par défaut', sale: 3, etat: 'racine' },
  { nom: 'design__page-projet', branche: 'design/page-projet', avance: 'à jour avec main', etat: 'actif' },
  { nom: 'feat__tri-sillage', branche: 'feat/tri-sillage', avance: '+4 sur main', sale: 7, etat: 'actif' },
  { nom: 'feat__ds-lie-au-projet', branche: 'feat/ds-lie-au-projet', avance: '+6 sur main', pr: { n: 17, etat: 'ok' }, etat: 'actif' },
  { nom: 'fix__worktree-disparu', branche: 'fix/worktree-disparu', avance: '+2 sur main', sale: 3, pr: { n: 18, etat: 'checks' }, etat: 'actif' },
  { nom: 'feat__vue-git-lot-3', branche: 'feat/vue-git-lot-3', avance: '+9 · −14 derrière main', etat: 'actif' },
]

const ORPHELINS: { branche: string; quoi: string; ton: 'fusionnee' | 'travail' | 'disparu'; age: string }[] = [
  { branche: 'feat/onglet-projet', quoi: 'fusionnée par #16', ton: 'fusionnee', age: '1 j' },
  { branche: 'feat/gestion-de-projet', quoi: 'fusionnée par #12', ton: 'fusionnee', age: '5 j' },
  { branche: 'feat/journal', quoi: 'fusionnée (squash)', ton: 'fusionnee', age: '6 j' },
  { branche: 'feat/vue-git', quoi: 'fusionnée par #9', ton: 'fusionnee', age: '5 j' },
  { branche: 'integration/colonne', quoi: 'fusionnée', ton: 'fusionnee', age: '9 j' },
  { branche: 'port/savoir', quoi: '+11 sur main · 2 fichiers modifiés', ton: 'travail', age: '8 j' },
  { branche: 'audit/bundle-web', quoi: '+3 sur main · propre', ton: 'travail', age: '7 j' },
  { branche: 'fix/tir-planifie', quoi: 'dossier absent du disque', ton: 'disparu', age: '4 j' },
]

function EnteteArbre({ a, n }: { a: Arbre; n: number }) {
  return (
    <div className="flex items-center gap-2.5 border-y border-line bg-sunken/60 px-4 py-2 first:border-t-0">
      <ChevronDown size={13} className="text-ink-faint" />
      {a.etat === 'racine' ? <GitBranch size={14} className="text-ink-faint" /> : <FolderGit2 size={14} className="text-ink-soft" />}
      <span className="font-mono text-xs font-medium text-ink">{a.etat === 'racine' ? 'main' : a.branche}</span>
      {a.etat === 'racine' ? <span className="text-meta text-ink-faint">racine du projet</span> : null}
      <span className="text-meta text-ink-faint">{a.avance}</span>
      {a.sale ? (
        <span className="flex items-center gap-1 text-meta text-caution"><span className="size-1.5 rounded-full bg-caution" />{a.sale} modifiés</span>
      ) : a.etat === 'actif' ? (
        <span className="flex items-center gap-1 text-meta text-ink-faint"><Check size={11} />propre</span>
      ) : null}
      <span className="ml-auto flex items-center gap-2">
        {a.pr ? <PrBadge pr={a.pr} /> : null}
        <span className="rounded-md bg-surface-high px-1.5 text-meta tabular-nums text-ink-faint">{n}</span>
      </span>
    </div>
  )
}

function B3() {
  return (
    <Bloc
      id="b3-activite-par-worktree"
      titre="B3 · La même liste, groupée par worktree : qui travaille où"
      note="Un groupe par worktree, la racine en tête. L’en-tête dit la branche, l’écart avec main, propre ou sale, la PR. Les lignes perdent leurs colonnes branche et PR, que l’en-tête porte. Sous les worktrees habités, ceux que plus aucune session n’occupe : c’est la place du nettoyage (b3afaca juge « fusionnée » sur le contenu, squash compris). Les vraies données de ce dépôt : 19 worktrees, dont 5 fusionnés et un dossier disparu (#61)."
    >
      <Onglets actif="activite" />
      <BarreActivite actif="Worktree" />
      {ARBRES.map((a) => {
        const items = SESSIONS.filter((s) => (a.etat === 'racine' ? s.worktree === null : s.branche === a.branche))
        return (
          <div key={a.nom}>
            <EnteteArbre a={a} n={items.length} />
            <div className="divide-y divide-line/60">
              {items.map((s) => <Ligne key={s.nom} s={s} sansBranche />)}
            </div>
          </div>
        )
      })}
      <div className="flex items-center gap-2.5 border-y border-line bg-sunken/60 px-4 py-2">
        <ChevronDown size={13} className="text-ink-faint" />
        <FolderGit2 size={14} className="text-ink-faint" />
        <span className="text-xs font-medium text-ink-soft">Sans session</span>
        <span className="text-meta text-ink-faint">8 worktrees · 5 fusionnés · 1 disparu</span>
        <span className="ml-auto flex items-center gap-1.5 rounded-md border border-line px-2 py-0.5 text-xs text-ink-soft"><Trash2 size={12} />Nettoyer les 5 fusionnés</span>
      </div>
      <div className="divide-y divide-line/60">
        {ORPHELINS.map((o) => (
          <div key={o.branche} className="flex h-9 items-center gap-3 px-4 pl-10">
            {o.ton === 'fusionnee' ? <GitMerge size={13} className="text-loop" /> : o.ton === 'disparu' ? <TriangleAlert size={13} className="text-critical" /> : <FolderGit2 size={13} className="text-ink-faint" />}
            <span className="w-64 truncate font-mono text-xs text-ink-soft">{o.branche}</span>
            <span className={cx('flex-1 text-xs', o.ton === 'disparu' ? 'text-critical' : 'text-ink-faint')}>{o.quoi}</span>
            <span className="text-meta text-ink-faint">dernière session il y a {o.age}</span>
            <span className="w-24 text-right text-xs text-ink-soft">{o.ton === 'travail' ? 'Reprendre' : o.ton === 'disparu' ? 'Oublier' : 'Nettoyer'}</span>
          </div>
        ))}
        <div className="flex h-9 items-center gap-3 px-4 pl-10 text-xs text-ink-faint">
          <GitBranch size={13} />14 branches sans worktree, dont 12 fusionnées<span className="ml-auto text-ink-soft">Voir</span>
        </div>
      </div>
    </Bloc>
  )
}

function B4() {
  const s = SESSIONS[5]!
  return (
    <Bloc
      id="b4-anatomie-de-la-ligne"
      titre="B4 · Anatomie de la ligne de session"
      largeur="w-[60rem]"
      note="Huit colonnes, toujours à la même place, qu’on lise une ou trente lignes. Le point suit la charte de la colonne (accent qui pulse, ambre, rouge, encre) avec un vert en plus pour « prête à relire ». Le badge de PR reprend les quatre couleurs de l’agent view ; « fusionnée » prend le ton de la boucle : pas de jeton de plus."
    >
      <div className="py-3">
        <Ligne s={s} />
        <div className="mt-1 flex gap-3 px-4 text-micro text-ink-faint">
          <span className="w-2">①</span><span className="w-[14px]">②</span><span className="w-60">③ nom</span><span className="flex-1">④ résumé d’une ligne, ou la question</span><span className="w-7">⑤</span><span className="w-44">⑥ worktree · branche</span><span className="w-28 text-right">⑦ PR</span><span className="w-12 text-right">⑧ âge</span>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line px-4 pt-3">
          <span className="text-meta text-ink-faint">Les états de PR :</span>
          <PrBadge pr={{ n: 18, etat: 'brouillon' }} />
          <PrBadge pr={{ n: 18, etat: 'checks' }} />
          <PrBadge pr={{ n: 18, etat: 'echec' }} />
          <PrBadge pr={{ n: 17, etat: 'ok' }} />
          <PrBadge pr={{ n: 16, etat: 'fusionnee' }} />
          <span className="ml-4 text-meta text-ink-faint">Branche :</span>
          <Branche s={s} />
          <Branche s={{ worktree: null, branche: 'main' }} />
        </div>
      </div>
    </Bloc>
  )
}

/* ---------------------------------------------------------------- le jalon ---- */

function C1() {
  const dujalon = SESSIONS.filter((s) => s.carte === 65 || s.carte === 73)
  const autres = SESSIONS.filter((s) => !(s.carte === 65 || s.carte === 73))
  return (
    <Bloc
      id="c1-jalon-en-tete-de-l-activite"
      titre="C1 · Le jalon lancé, en tête de l’Activité"
      note="Le bandeau dit l’essentiel d’un coup d’œil : un segment par carte (fusionnée, en revue, en cours, en file, attend ses dépendances), les places occupées sur les trois, et ce qui te demande quelque chose. Les sessions des cartes du jalon se rangent dans un groupe à lui, avant les autres groupes d’état. Sans jalon lancé, ni bandeau ni groupe."
    >
      <Onglets actif="activite" />
      <BarreActivite actif="État" />
      <BandeauJalon />
      <EnteteGroupe titre="Jalon #75 · ses sessions" ton="bg-accent" n={dujalon.length} />
      <div className="divide-y divide-line/60">{dujalon.map((s) => <Ligne key={s.nom} s={s} />)}</div>
      <ListeParEtat sessions={autres.filter((s) => s.etat !== 'finie')} />
    </Bloc>
  )
}

function C2() {
  const vagues = [1, 2, 3, 4]
  return (
    <Bloc
      id="c2-la-vue-du-jalon"
      titre="C2 · La vue du jalon : ses cartes, par vague de dépendances"
      note="Atteinte par « Voir le jalon » du bandeau ou d’un clic dans l’onglet Jalons (l’actuel « Chronologie », renommé : il ne gagne pas un septième onglet). Les colonnes sont les vagues que dictent les liens « bloque » : une carte part quand sa colonne de gauche est fusionnée. Chaque carte dit son état et, si une session la porte, ce qu’elle fait. En pied, la file : ce qui partira quand une place se libère."
    >
      <Onglets actif="jalons" action={<span className="flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1 text-xs text-ink-soft"><Lock size={12} />Mettre en pause</span>} />
      <div className="flex items-center gap-3 px-5 pt-4">
        <Flag size={16} className="text-accent" />
        <span className="text-heading font-semibold text-ink">#75 Orchestrer le travail par cartes</span>
        <span className="rounded bg-accent px-1.5 py-0.5 text-meta font-medium text-accent-ink">lancé il y a 50 min</span>
        <span className="flex items-center gap-1 text-meta text-ink-soft"><GitBranch size={11} /><span className="font-mono">jalon/orchestrer</span> · 0 fusion</span>
        <span className="ml-auto text-xs text-ink-soft">2/3 sessions · <span className="text-ink-faint">pas d’échéance</span></span>
      </div>
      <div className="px-5 pt-3"><Segments grand /></div>
      <div className="grid grid-cols-4 gap-3 p-5">
        {vagues.map((v) => (
          <div key={v} className="flex flex-col gap-2">
            <div className="text-meta font-medium uppercase tracking-wide text-ink-faint">Vague {v}{v === 1 ? ' · sans dépendance' : ''}</div>
            {CARTES_JALON.filter((c) => c.vague === v).map((c) => (
              <div key={c.n} className={cx('rounded-lg border px-3 py-2', c.etat === 'cours' ? 'border-accent/40 bg-accent-wash/30' : c.etat === 'file' ? 'border-line' : 'border-dashed border-line')}>
                <div className="flex items-center gap-1.5">
                  <span className={cx('size-2 rounded-full', TON_CARTE[c.etat], c.etat === 'cours' && 'animate-pulse')} />
                  <span className="text-meta tabular-nums text-ink-faint">#{c.n}</span>
                  <span className="truncate text-xs font-medium text-ink">{c.titre}</span>
                </div>
                <div className="mt-1 flex items-center gap-1.5 text-meta text-ink-faint">
                  <span>{MOT_CARTE[c.etat]}</span>
                  {c.session ? <span className="text-caution">· {c.session}</span> : null}
                </div>
                {c.par.length ? (
                  <div className="mt-1 flex items-center gap-1 text-micro text-ink-faint"><Waypoints size={10} />après {c.par.map((p) => `#${p}`).join(', ')}</div>
                ) : null}
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2 border-t border-line px-5 py-2.5 text-xs text-ink-soft">
        <ListFilter size={13} className="text-ink-faint" />
        <span>File : <b className="font-medium text-ink">#66</b>, puis <b className="font-medium text-ink">#68</b></span>
        <span className="text-ink-faint">— la prochaine place libre part sur #66, qui en débloque quatre.</span>
      </div>
    </Bloc>
  )
}

function C3() {
  const semaines = ['6 oct.', '13 oct.', '20 oct.', '27 oct.', '3 nov.', '10 nov.']
  return (
    <Bloc
      id="c3-le-jalon-dans-la-chronologie"
      titre="C3 · Dans l’onglet Jalons, la frise : la ligne du jalon dit qu’il tourne"
      note="Aucun changement de forme : la ligne du jalon lancé reçoit sa pastille « lancé », ses segments et un compte de sessions ; les barres de ses cartes prennent la couleur d’exécution (accent qui pulse en cours, gris en file, pointillé en attente). C’est la vue du temps, pas de la manœuvre : un clic sur la ligne mène à C2."
    >
      <Onglets actif="jalons" action={<span className="flex items-center gap-1.5 rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-accent-ink"><Plus size={13} />Jalon</span>} />
      <div className="px-5 py-4">
        <div className="ml-72 grid grid-cols-6 border-b border-line pb-1.5 text-xs text-ink-faint">
          {semaines.map((s) => <span key={s}>{s}</span>)}
        </div>
        <div className="flex border-b border-line py-3">
          <div className="w-72 shrink-0 pr-3">
            <div className="flex items-center gap-1.5 text-sm text-ink"><Flag size={14} className="text-ink-faint" />v0.2 — la gestion de projet</div>
            <div className="ml-5 text-meta text-ink-faint">fusionné le 16 oct. · 11/11</div>
          </div>
          <div className="relative h-8 flex-1">
            <span className="absolute left-[18%] top-1 h-6 w-[22%] rounded-md bg-positive/20" />
          </div>
        </div>
        <div className="flex py-3">
          <div className="w-72 shrink-0 pr-3">
            <div className="flex items-center gap-1.5 text-sm font-medium text-ink"><Flag size={14} className="text-accent" />#75 Orchestrer le travail…</div>
            <div className="ml-5 mt-1 flex items-center gap-1.5 text-meta text-ink-soft">
              <span className="rounded bg-accent px-1 text-micro font-medium text-accent-ink">lancé</span>
              2 sessions · 0/10
            </div>
            <div className="ml-5 mt-1.5"><span className="block w-40"><Segments /></span></div>
          </div>
          <div className="relative flex-1">
            <span className="absolute bottom-0 left-[37%] top-0 w-px bg-accent" />
            {CARTES_JALON.slice(0, 6).map((c, i) => (
              <span
                key={c.n}
                className={cx(
                  'absolute flex h-6 items-center truncate rounded-md px-2 text-meta',
                  c.etat === 'cours' ? 'bg-accent/25 text-ink' : c.etat === 'file' ? 'bg-ink-faint/15 text-ink-soft' : 'border border-dashed border-line text-ink-faint',
                )}
                style={{ left: `${30 + c.vague * 8}%`, width: '30%', top: `${i * 30}px` }}
              >
                {c.etat === 'cours' ? <span className="mr-1.5 size-1.5 shrink-0 animate-pulse rounded-full bg-accent" /> : null}
                <span className="truncate">#{c.n} {c.titre}</span>
              </span>
            ))}
            <span className="block h-44" />
          </div>
        </div>
      </div>
    </Bloc>
  )
}

/* --------------------------------------------------------------- portefeuille ---- */

const GLOBAL: Session[] = [
  { ...SESSIONS[0]!, projet: 'Solera' },
  { ...SESSIONS[1]!, projet: 'Solera' },
  { nom: 'Relire les notes de veille', resume: 'Propose de fusionner deux notes sur la mémoire longue', etat: 'attend', agent: 'claude', worktree: null, branche: 'main', age: '2 h', projet: 'Vault', question: { texte: 'Fusionner ?', depuis: '40 min' } },
  { ...SESSIONS[2]!, projet: 'Solera' },
  { ...SESSIONS[3]!, projet: 'Solera' },
  { nom: 'Index des liens du vault', resume: 'Carte en À vérifier depuis 2 j — la session qui l’a faite est archivée', etat: 'relire', agent: 'claude', carte: 41, worktree: null, branche: 'main', age: '2 j', projet: 'Vault', carteSeule: true },
  { nom: 'Page d’accueil', resume: 'Retouche le hero, aperçu déployé', etat: 'relire', agent: 'codex', worktree: 'feat__hero', branche: 'feat/hero', age: '3 h', projet: 'Site perso', pr: { n: 4, etat: 'ok' } },
  { ...SESSIONS[4]!, projet: 'Solera' },
  { ...SESSIONS[5]!, projet: 'Solera' },
  { ...SESSIONS[6]!, projet: 'Solera' },
  { ...SESSIONS[7]!, projet: 'Solera' },
  { ...SESSIONS[8]!, projet: 'Solera' },
  { ...SESSIONS[9]!, projet: 'Site perso' },
]

function D1() {
  const tabs = ['Projets', 'Activité', 'Board', 'Jalons', 'Journal']
  return (
    <Bloc
      id="d1-portefeuille-activite"
      titre="D1 · Le portefeuille : l’Activité tous projets confondus"
      note="Même liste, même ligne, une colonne Projet en plus ; la bascule propose État ou Projet (Worktree n’a pas de sens d’un projet à l’autre). Activité prend la place de Travail, qui s’y fond : une carte qui réclame quelqu’un sans qu’aucune session la porte y entre comme une ligne de carte (icône du board, « aucune session »), dans le groupe de ce qu’elle demande. Le portefeuille garde cinq onglets, et Chronologie y devient Jalons comme dans un projet."
    >
      <div className="flex h-12 items-center gap-2 border-b border-line px-3">
        <Layers size={16} className="text-ink-faint" />
        <span className="flex-1 text-sm font-medium text-ink">Projets</span>
        <span className="flex h-7 items-center gap-1.5 rounded-md bg-accent px-2.5 text-xs font-medium text-accent-ink"><Plus size={14} />Nouveau projet</span>
      </div>
      <div className="flex items-center gap-5 border-b border-line px-4">
        {tabs.map((t) => (
          <span key={t} className={cx('flex min-h-11 items-center gap-2 border-b-2 px-1 text-sm', t === 'Activité' ? 'border-accent text-ink' : 'border-transparent text-ink-faint')}>
            {t}{t === 'Activité' ? <span className="rounded bg-caution/15 px-1.5 py-0.5 text-xs tabular-nums text-caution">4</span> : null}
          </span>
        ))}
      </div>
      <BarreActivite actif="État" options={['État', 'Projet']} compteurs={{ demandent: 4, relire: 3 }} />
      <ListeParEtat sessions={GLOBAL} colonneProjet />
    </Bloc>
  )
}

/* ---------------------------------------------------------------- téléphone ---- */

function E1() {
  return (
    <Bloc
      id="e1-activite-au-telephone"
      titre="E1 · Au téléphone, 390 px"
      largeur="w-[26rem]"
      note="La ligne passe sur deux étages : nom et âge, puis résumé, worktree et PR. La carte tombe (elle est dans le nom de la branche le plus souvent). Les compteurs remontent dans la rangée de la bascule. La question se déplie de même."
    >
      <div className="flex items-center gap-2 border-b border-line px-3 py-2.5">
        <span className="text-xs font-medium text-caution">3 te demandent</span>
        <span className="text-xs text-ink-faint">· 3 en cours</span>
        <span className="ml-auto"><Bascule actif="État" /></span>
      </div>
      {GROUPES.map((g) => {
        const items = SESSIONS.filter((s) => g.etat.includes(s.etat)).slice(0, 3)
        return (
          <div key={g.titre}>
            <EnteteGroupe titre={g.titre} ton={g.ton} n={items.length} plie={g.etat.includes('finie')} />
            {g.etat.includes('finie') ? null : items.map((s) => (
              <div key={s.nom} className="flex gap-2.5 border-b border-line/60 px-3 py-2">
                <span className="pt-1.5"><Point etat={s.etat} /></span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-ink">{s.nom}</span>
                    <span className="ml-auto shrink-0 text-meta text-ink-faint">{s.age}</span>
                  </div>
                  <div className={cx('truncate text-xs', s.etat === 'attend' ? 'text-caution' : s.etat === 'erreur' ? 'text-critical' : 'text-ink-faint')}>{s.resume}</div>
                  <div className="mt-1 flex items-center gap-2"><Branche s={s} />{s.pr ? <PrBadge pr={s.pr} /> : null}</div>
                </div>
              </div>
            ))}
          </div>
        )
      })}
    </Bloc>
  )
}

/** Le jeu arrêté : A2 écarté, Travail fondu dans l'Activité du portefeuille. */
export function ProjetFinal() {
  return (
    <div className="flex flex-col gap-8 bg-canvas p-4">
      <A1 />
      <B1 />
      <B2 />
      <B3 />
      <B4 />
      <C1 />
      <C2 />
      <C3 />
      <D1 />
      <E1 />
    </div>
  )
}

export function ProjetTour1() {
  return (
    <div className="flex flex-col gap-8 bg-canvas p-4">
      <A1 />
      <A2 />
      <B1 />
      <B2 />
      <B3 />
      <B4 />
      <C1 />
      <C2 />
      <C3 />
      <D1 />
      <E1 />
    </div>
  )
}
