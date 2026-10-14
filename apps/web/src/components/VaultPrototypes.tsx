/*
 * MAQUETTE JETABLE — le contexte Savoir (carte #15).
 *
 * Ce qui est déjà arrêté et qu'on ne rouvre pas ici : le lieu *Savoir* dans la colonne
 * (un état, pas un arbre), la page centrée sur le vault et non sur ce que l'IA propose,
 * les trois droits par dossier, le vault comme dépôt git local.
 *
 * Ce qu'on choisit dans ce premier tour, et rien d'autre :
 *   1. **ce que la page du vault met en premier** — trois partis (A, B, C) ;
 *   2. **les vues du panneau droit en contexte Savoir** — trois bandes (P1, P2, P3).
 *
 * Les libellés sont en clair, contrairement à la règle de `t()` : rien d'ici ne part en
 * production. À supprimer avec `scripts/vault-prototypes.mjs`.
 */
import {
  BookOpen,
  Bookmark,
  Bot,
  Combine,
  Check,
  ChevronRight,
  CalendarClock,
  CornerDownRight,
  ChevronDown,
  Clock,
  ArrowUpDown,
  Ellipsis,
  FilePlus2,
  FileText,
  Folder,
  FolderOpen,
  FolderTree,
  History,
  Inbox,
  Link2,
  Link2Off,
  MessagesSquare,
  MoreHorizontal,
  PanelLeftClose,
  PanelRight,
  Pencil,
  Plus,
  Search,
  Shield,
  SquareKanban,
  Star,
  SlidersHorizontal,
  Layers,
  LayoutList,
  ListFilter,
  PenLine,
  Pin,
  SquarePen,
  Table2,
  TriangleAlert,
  Waypoints,
  X,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { cx } from '@solera/ui'
import { AgentIcon } from './AgentIcon'

/* ---------------------------------------------------------------- données ---- */

type Droit = 'lecture' | 'propose' | 'ecrit'

const DOSSIERS: { label: string; count: number; droit: Droit; quand: string }[] = [
  { label: 'Journal', count: 128, droit: 'lecture', quand: 'il y a 5 min' },
  { label: 'Idées', count: 34, droit: 'lecture', quand: 'hier' },
  { label: 'Veille', count: 61, droit: 'propose', quand: 'il y a 2 h' },
  { label: 'Boîte des agents', count: 2, droit: 'ecrit', quand: 'il y a 2 h' },
]

const PROPOSITIONS = [
  { titre: 'Veille agents — mémoire longue', dossier: 'Veille', plus: 48, moins: 0, agent: 'claude' as const, quand: 'il y a 2 h' },
  { titre: 'Solera, positionnement', dossier: 'Idées', plus: 12, moins: 3, agent: 'codex' as const, quand: 'hier' },
]

const REPRENDRE = [
  { titre: '2026-10-11 — la colonne de gauche', dossier: 'Journal', extrait: 'Les trois lieux, et ce qu’un clic sur un lieu fait vraiment : loupe ou destination.', quand: 'il y a 5 min', par: 'toi' },
  { titre: 'Mémoire des agents — état de l’art', dossier: 'Veille', extrait: 'Ce que font Letta, Zep et mem0, et ce qui ne tient pas à l’échelle d’un vault.', quand: 'hier', par: 'Claude' },
  { titre: 'Vault : git plutôt que Drive', dossier: 'Idées', extrait: 'Sortir de Drive, versionner, pousser sur un dépôt privé — et ce que ça coûte.', quand: 'hier', par: 'toi' },
  { titre: 'Solera — carnet de bord', dossier: 'Journal', extrait: 'La note carrefour : 41 notes y mènent, elle n’est plus relue depuis trois semaines.', quand: 'mercredi', par: 'toi' },
]

const CARREFOURS = [
  { label: 'Solera — carnet de bord', liens: 41 },
  { label: 'Mémoire & contexte', liens: 28 },
  { label: 'Vault — décisions', liens: 19 },
]

/** Le flux d'écriture du vault : ce qui s'est passé, et par qui. */
const FLUX = [
  {
    jour: 'Aujourd’hui',
    lignes: [
      { titre: '2026-10-11 — la colonne de gauche', dossier: 'Journal', quoi: '+86 −4', par: 'toi' as const, quand: '9 h 12' },
      { titre: 'Veille agents — mémoire longue', dossier: 'Veille', quoi: 'proposée, à relire', par: 'claude' as const, quand: '8 h 40', attente: true },
      { titre: 'Vault : git plutôt que Drive', dossier: 'Idées', quoi: '3 liens ajoutés', par: 'toi' as const, quand: '8 h 05' },
    ],
  },
  {
    jour: 'Hier',
    lignes: [
      { titre: 'Solera, positionnement', dossier: 'Idées', quoi: 'proposée, à relire', par: 'codex' as const, quand: '18 h 30', attente: true },
      { titre: 'Mémoire des agents — état de l’art', dossier: 'Veille', quoi: 'créée · +240', par: 'claude' as const, quand: '17 h 02' },
      { titre: '2026-10-10 — coque et panneau', dossier: 'Journal', quoi: '+52 −11', par: 'toi' as const, quand: '21 h 44' },
    ],
  },
  {
    jour: 'Jeudi 9',
    lignes: [
      { titre: 'Trois contextes, une coque', dossier: 'Idées', quoi: 'créée · +118', par: 'toi' as const, quand: '14 h 20' },
      { titre: 'Xérès — la solera', dossier: 'Veille', quoi: '+17 −0', par: 'toi' as const, quand: '11 h 55' },
    ],
  },
]

const LIENS_ENTRANTS = [
  { titre: 'Solera — carnet de bord', dossier: 'Journal', phrase: 'La décision du vault est posée dans [[Vault : git plutôt que Drive]], et rien ne l’a rouverte depuis.' },
  { titre: '2026-10-09 — premières notes', dossier: 'Journal', phrase: 'Reste à trancher où vit le vault — voir [[Vault : git plutôt que Drive]].' },
  { titre: 'Mémoire & contexte', dossier: 'Veille', phrase: 'Un index dérivé, jamais la vérité : [[Vault : git plutôt que Drive]] l’explique mieux.' },
]

const VOISINES = [
  { titre: 'Mémoire & contexte', partage: '4 liens en commun' },
  { titre: 'Solera — carnet de bord', partage: '3 liens en commun' },
  { titre: 'Indexation du vault', partage: '3 liens en commun' },
  { titre: 'Trois contextes, une coque', partage: '2 liens en commun' },
]

/* ---------------------------------------------------------------- briques ---- */

function Bloc({ id, titre, note, largeur = 'w-[54rem]', children }: {
  id: string
  titre: string
  note: string
  largeur?: string
  children: ReactNode
}) {
  return (
    <section data-proto={id} data-shot={id} className={cx('flex flex-col gap-1.5', largeur)}>
      <h2 className="text-sm font-semibold text-ink">{titre}</h2>
      <div className="surface overflow-hidden rounded-xl border border-line shadow-float">{children}</div>
      <p className="text-micro leading-relaxed text-ink-faint">{note}</p>
    </section>
  )
}

function Bouclier({ droit, size = 12 }: { droit: Droit; size?: number }) {
  if (droit === 'ecrit') return <Pencil size={size} className="shrink-0 text-accent" />
  if (droit === 'propose') return <Inbox size={size} className="shrink-0 text-caution" />
  return <Shield size={size} className="shrink-0 text-ink-faint" />
}

const DROIT_MOT: Record<Droit, string> = {
  lecture: 'lecture seule',
  propose: 'propose dans la boîte',
  ecrit: 'écrit directement',
}

function Ico({ children }: { children: ReactNode }) {
  return <span className="flex size-7 shrink-0 items-center justify-center rounded-md text-ink-faint">{children}</span>
}

function Count({ tone = 'neutral', children }: { tone?: 'accent' | 'caution' | 'neutral' | 'critical'; children: ReactNode }) {
  return (
    <span className={cx(
      'flex shrink-0 items-center rounded-full px-1.5 py-0.5 text-micro font-semibold tabular-nums',
      tone === 'accent' && 'bg-accent-wash text-accent',
      tone === 'caution' && 'bg-caution/10 text-caution',
      tone === 'critical' && 'bg-critical/10 text-critical',
      tone === 'neutral' && 'bg-surface-high text-ink-soft',
    )}>
      {children}
    </span>
  )
}

/** L'en-tête de la page, identique dans les trois partis : il n'est pas en jeu. */
function Entete() {
  return (
    <div className="mb-4 flex items-center gap-2.5">
      <BookOpen size={18} className="text-ink-faint" />
      <span className="text-lg font-semibold tracking-tight text-ink">Savoir</span>
      <span className="text-micro text-ink-faint">264 notes · 1 240 liens</span>
      <span className="ml-auto flex items-center gap-1">
        <span className="flex h-7 items-center gap-1.5 rounded-md border border-line px-2 text-xs text-ink-soft"><Search size={13} />Chercher</span>
        <span className="flex h-7 items-center gap-1.5 rounded-md border border-line px-2 text-xs text-ink-soft"><Plus size={13} />Note</span>
        <Ico><MoreHorizontal size={15} /></Ico>
      </span>
    </div>
  )
}

function TitreSection({ icone, children, action }: { icone: ReactNode; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-2 flex items-center gap-2">
      <span className="text-ink-faint">{icone}</span>
      <span className="flex-1 text-xs font-medium text-ink-soft">{children}</span>
      {action}
    </div>
  )
}

/** La colonne de côté : les agents proposent, ils n'occupent pas. */
function Propositions({ compact = false }: { compact?: boolean }) {
  return (
    <>
      <div className="mb-2 flex items-center gap-1.5">
        <Inbox size={13} className="text-caution" />
        <span className="flex-1 text-xs font-medium text-ink-soft">Proposé par les agents</span>
        <Count tone="caution">2</Count>
      </div>
      <div className="mb-4 flex flex-col gap-1.5">
        {PROPOSITIONS.map((entree) => (
          <div key={entree.titre} className="rounded-lg border border-caution/40 bg-caution/5 px-2.5 py-2">
            <div className="truncate text-xs font-medium text-ink">{entree.titre}</div>
            <div className="mt-1 flex items-center gap-1.5 text-micro text-ink-faint">
              <AgentIcon agent={entree.agent} size={10} />
              {entree.dossier}
              <span className="text-positive">+{entree.plus}</span>
              <span className="text-critical">−{entree.moins}</span>
            </div>
            {compact ? null : (
              <div className="mt-2 flex items-center gap-1">
                <span className="flex h-6 items-center gap-1 rounded-md bg-accent px-2 text-micro font-medium text-on-accent"><Check size={11} />Accepter</span>
                <span className="flex h-6 items-center rounded-md border border-line px-2 text-micro text-ink-soft">Diff</span>
                <span className="ml-auto flex size-6 items-center justify-center rounded-md text-ink-faint"><X size={12} /></span>
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  )
}

function ARanger() {
  return (
    <>
      <div className="mb-2 text-xs font-medium text-ink-soft">À ranger</div>
      <div className="flex flex-col gap-0.5">
        {[
          { icone: <SquarePen size={12} />, label: 'Ébauches', n: '5', tone: 'ink-faint' },
          { icone: <Link2Off size={12} />, label: 'Sans lien entrant', n: '9', tone: 'ink-faint' },
          { icone: <Link2 size={12} />, label: 'Liens cassés', n: '2', tone: 'critical' },
        ].map((ligne) => (
          <div key={ligne.label} className="flex h-7 items-center gap-2 rounded-md pr-1.5 pl-1.5 text-sm text-ink-soft">
            <span className="flex size-4 shrink-0 items-center justify-center text-ink-faint">{ligne.icone}</span>
            <span className="min-w-0 flex-1 truncate text-xs">{ligne.label}</span>
            <span className={cx('text-micro tabular-nums', ligne.tone === 'critical' ? 'text-critical' : 'text-ink-faint')}>{ligne.n}</span>
          </div>
        ))}
      </div>
    </>
  )
}

/** Les dossiers en liste compacte, avec leur droit — plus dense que les tuiles du v3. */
function DossiersCompacts() {
  return (
    <>
      <div className="mt-4 mb-2 flex items-center gap-2">
        <FolderTree size={13} className="text-ink-faint" />
        <span className="flex-1 text-xs font-medium text-ink-soft">Dossiers</span>
      </div>
      <div className="flex flex-col gap-0.5">
        {DOSSIERS.map((dossier) => (
          <div key={dossier.label} className="flex h-7 items-center gap-2 rounded-md px-1.5 text-sm">
            <ChevronRight size={12} className="shrink-0 text-ink-faint" />
            <span className="min-w-0 flex-1 truncate text-xs text-ink-soft">{dossier.label}</span>
            <Bouclier droit={dossier.droit} />
            <span className="text-micro tabular-nums text-ink-faint">{dossier.count}</span>
          </div>
        ))}
      </div>
    </>
  )
}

/* ============================================================== parti A ======
 *
 * « Ce qui s'est écrit » — la page est le flux du vault, daté. Elle répond à
 * « qu'est-ce qui a bougé depuis que j'ai fermé ? », ce qu'un dépôt git rend
 * naturel : chaque écriture est un commit, le vault a donc un journal.
 */

function LigneFlux({ ligne }: { ligne: typeof FLUX[number]['lignes'][number] }) {
  return (
    <div className={cx(
      'flex items-center gap-2.5 rounded-lg px-2 py-2',
      ligne.attente ? 'border border-caution/30 bg-caution/5' : 'border border-transparent',
    )}>
      <FileText size={13} className="shrink-0 text-ink-faint" />
      <span className="min-w-0 max-w-[22rem] flex-1 truncate text-sm font-medium text-ink">{ligne.titre}</span>
      <span className="flex h-5 shrink-0 items-center rounded-full bg-surface-high px-2 text-micro text-ink-soft">{ligne.dossier}</span>
      <span className="shrink-0 text-micro text-ink-faint">{ligne.quoi}</span>
      <span className="ml-auto flex shrink-0 items-center gap-1.5 text-micro text-ink-faint">
        {ligne.par === 'toi' ? <span>toi</span> : <><AgentIcon agent={ligne.par} size={11} /><span>{ligne.par === 'claude' ? 'Claude' : 'Codex'}</span></>}
        <span className="tabular-nums">{ligne.quand}</span>
      </span>
    </div>
  )
}

function PartiA() {
  return (
    <Bloc
      id="page-a-flux"
      titre="A · « Ce qui s’est écrit » — la page est le journal du vault"
      note="Le vault est un dépôt git : chaque écriture est datée et signée, la page le montre tel quel. Elle répond à « qu’est-ce qui a bougé depuis hier ? » plutôt qu’à « qu’est-ce que je possède ? ». Les deux propositions d’agents apparaissent dans le flux, à leur date, soulignées — et restent actionnables dans la colonne de côté."
    >
      <div className="px-5 py-4">
        <Entete />
        <div className="flex gap-5">
          <div className="min-w-0 flex-1">
            {FLUX.map((groupe) => (
              <div key={groupe.jour} className="mb-3">
                <div className="mb-1 flex items-center gap-2">
                  <span className="text-xs font-medium text-ink-soft">{groupe.jour}</span>
                  <span className="h-px flex-1 bg-line" />
                  <span className="text-micro text-ink-faint">{groupe.lignes.length} notes</span>
                </div>
                <div className="flex flex-col gap-0.5">
                  {groupe.lignes.map((ligne) => <LigneFlux key={ligne.titre + ligne.quand} ligne={ligne} />)}
                </div>
              </div>
            ))}
            <div className="mt-1 flex h-7 items-center gap-1.5 px-2 text-micro text-ink-faint">
              <History size={12} />tout l’historique du vault
            </div>
          </div>
          <div className="w-[15rem] shrink-0">
            <Propositions />
            <ARanger />
            <DossiersCompacts />
          </div>
        </div>
      </div>
    </Bloc>
  )
}

/* ============================================================== parti B ======
 *
 * « Reprendre » — le v3 corrigé plutôt que remplacé. La semaine en sept cases
 * disparaît (elle inventorie), les trois cartes tronquées deviennent des lignes
 * pleines, les tuiles de dossiers deviennent des lignes qui disent le droit en
 * toutes lettres. Ce qui reste : les notes à reprendre, en premier et en grand.
 */

function LigneReprendre({ note }: { note: typeof REPRENDRE[number] }) {
  return (
    <div className="flex items-start gap-2.5 rounded-lg border border-line px-3 py-2.5">
      <FileText size={14} className="mt-0.5 shrink-0 text-ink-faint" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-ink">{note.titre}</div>
        <div className="mt-0.5 truncate text-micro leading-relaxed text-ink-faint">{note.extrait}</div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5 text-micro text-ink-faint">
        <span className="flex h-5 items-center rounded-full bg-surface-high px-2 text-ink-soft">{note.dossier}</span>
        {note.par === 'toi' ? null : <AgentIcon agent="claude" size={11} />}
        <span className="w-[4.5rem] text-right">{note.quand}</span>
      </div>
    </div>
  )
}

function PartiB() {
  return (
    <Bloc
      id="page-b-reprendre"
      titre="B · « Reprendre » — le v3 corrigé : des lignes, pas des cartes tronquées"
      note="Même parti que le v3 — la table des matières du vault — mais sans ce qui l’abîmait : la semaine en sept cases inventorie au lieu de réclamer, les cartes coupaient les titres à six mots, les tuiles de dossiers affichaient « 128 » en grand sans rien en dire. Ici le droit s’écrit en toutes lettres, et les carrefours disent où le vault se noue."
    >
      <div className="px-5 py-4">
        <Entete />
        <div className="flex gap-5">
          <div className="min-w-0 flex-1">
            <TitreSection icone={<Clock size={13} />} action={<span className="text-micro text-ink-faint">8 notes touchées cette semaine</span>}>
              Reprendre
            </TitreSection>
            <div className="mb-4 flex flex-col gap-1.5">
              {REPRENDRE.map((note) => <LigneReprendre key={note.titre} note={note} />)}
            </div>

            <TitreSection icone={<FolderTree size={13} />} action={<span className="text-micro text-ink-faint">tout parcourir ↗</span>}>
              Dossiers
            </TitreSection>
            <div className="mb-4 flex flex-col gap-0.5">
              {DOSSIERS.map((dossier) => (
                <div key={dossier.label} className="flex h-9 items-center gap-2.5 rounded-lg px-3 hover:bg-surface-high">
                  <ChevronRight size={13} className="shrink-0 text-ink-faint" />
                  <span className="min-w-0 flex-1 truncate text-sm text-ink">{dossier.label}</span>
                  <span className="flex shrink-0 items-center gap-1.5 text-micro text-ink-faint">
                    <Bouclier droit={dossier.droit} />{DROIT_MOT[dossier.droit]}
                  </span>
                  <span className="w-12 shrink-0 text-right text-micro tabular-nums text-ink-faint">{dossier.count}</span>
                  <span className="w-[4.5rem] shrink-0 text-right text-micro text-ink-faint">{dossier.quand}</span>
                </div>
              ))}
            </div>

            <TitreSection icone={<Waypoints size={13} />}>Carrefours</TitreSection>
            <div className="flex flex-col gap-0.5">
              {CARREFOURS.map((hub) => (
                <div key={hub.label} className="flex h-7 items-center gap-2.5 rounded-md px-3 text-sm">
                  <span className="min-w-0 flex-1 truncate text-xs text-ink-soft">{hub.label}</span>
                  <span className="text-micro tabular-nums text-ink-faint">{hub.liens} liens entrants</span>
                </div>
              ))}
            </div>
          </div>
          <div className="w-[15rem] shrink-0">
            <Propositions />
            <ARanger />
          </div>
        </div>
      </div>
    </Bloc>
  )
}

/* ============================================================== parti C ======
 *
 * « La page écrit » — Savoir n'est pas un tableau de bord, c'est l'endroit où l'on
 * écrit. La page ouvre sur la note du jour, en saisie, curseur posé ; l'état du vault
 * tient en dessous et sur le côté. Le geste premier n'est pas de consulter.
 */

function NoteDuJour() {
  return (
    <div className="rounded-xl border border-line bg-sunken/40 px-4 py-3">
      <div className="mb-2 flex items-center gap-2">
        <FileText size={13} className="text-ink-faint" />
        <span className="text-sm font-semibold text-ink">2026-10-12</span>
        <span className="flex h-5 items-center rounded-full bg-surface-high px-2 text-micro text-ink-soft">Journal</span>
        <span className="text-micro text-ink-faint">note du jour · créée à 9 h 12</span>
        <span className="ml-auto flex items-center gap-1.5 text-micro text-ink-faint"><Shield size={11} />lecture seule pour les agents</span>
      </div>
      <div className="flex flex-col gap-1.5 text-sm leading-relaxed text-ink">
        <p>La page Savoir, troisième essai. Ce qui coinçait au v3 : elle inventoriait.</p>
        <p className="text-ink-soft">
          Le flux daté vient du dépôt git — voir <span className="rounded bg-accent-wash px-1 text-accent">[[Vault : git plutôt que Drive]]</span>.
        </p>
        <p className="text-ink-soft">
          Reste à décider si une conversation qui écrit est une capacité ou un rattachement<span className="ml-px inline-block h-4 w-px translate-y-0.5 bg-accent" />
        </p>
      </div>
      <div className="mt-3 flex items-center gap-2 border-t border-line pt-2 text-micro text-ink-faint">
        <span>142 mots</span><span>·</span><span>3 liens sortants</span><span>·</span><span>enregistrée il y a 12 s</span>
        <span className="ml-auto flex items-center gap-1"><Link2 size={11} />lier une note</span>
      </div>
    </div>
  )
}

function PartiC() {
  return (
    <Bloc
      id="page-c-ecrit"
      titre="C · « La page écrit » — le vault ouvre sur la note du jour"
      note="Un PKM n’est pas un tableau de bord : le geste du matin est d’écrire, pas de consulter. La page pose le curseur dans la note du jour — créée si elle n’existe pas — et range l’état du vault autour. Ce que ça coûte : on ne voit plus d’un coup d’œil ce qui a bougé, il faut descendre. Ce que ça gagne : le lieu *Savoir* a une action par défaut, les deux autres partis n’en ont pas."
    >
      <div className="px-5 py-4">
        <Entete />
        <div className="flex gap-5">
          <div className="min-w-0 flex-1">
            <NoteDuJour />
            <div className="mt-4">
              <TitreSection icone={<Clock size={13} />} action={<span className="text-micro text-ink-faint">8 notes touchées cette semaine</span>}>
                Reprendre
              </TitreSection>
              <div className="flex flex-col gap-0.5">
                {REPRENDRE.slice(0, 3).map((note) => (
                  <div key={note.titre} className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-surface-high">
                    <FileText size={13} className="shrink-0 text-ink-faint" />
                    <span className="min-w-0 max-w-[20rem] flex-1 truncate text-sm text-ink">{note.titre}</span>
                    <span className="min-w-0 flex-1 truncate text-micro text-ink-faint">{note.extrait}</span>
                    <span className="shrink-0 text-micro text-ink-faint">{note.dossier} · {note.quand}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="w-[15rem] shrink-0">
            <Propositions compact />
            <ARanger />
            <DossiersCompacts />
          </div>
        </div>
      </div>
    </Bloc>
  )
}

/* ========================================================= le panneau droit ==
 *
 * En contexte Travail la bande est arrêtée : Fichiers · Recherche · Git · Terminaux |
 * Agent. En contexte Savoir elle change — et la question est : **combien de vues**, et
 * est-ce que « le chat du vault » en est une.
 */

type Vue = { label: string; icone: ReactNode }

function Bande({ vues, apart, actif, compact = false, fin }: {
  vues: Vue[]
  apart: Vue
  actif: string
  /** Sous 30 rem la règle de la coque fait tomber les noms, toutes les vues ensemble. */
  compact?: boolean
  fin?: ReactNode
}) {
  const boite = (vue: Vue) => (
    <span key={vue.label} className={cx(
      'flex h-8 shrink-0 items-center gap-1.5 rounded-md text-xs',
      compact ? 'w-8 justify-center' : 'px-2.5',
      vue.label === actif ? 'bg-accent-wash font-medium text-accent' : 'text-ink-soft',
    )}>
      {vue.icone}{compact ? null : vue.label}
    </span>
  )
  return (
    <div className="flex h-11 shrink-0 items-center gap-1 border-b border-line px-2">
      {vues.map(boite)}
      <span className="mx-1 h-5 w-px shrink-0 bg-line" />
      {boite(apart)}
      {fin}
    </div>
  )
}

function Panneau({ id, titre, note, bande, children }: {
  id: string
  titre: string
  note: string
  bande: ReactNode
  children: ReactNode
}) {
  return (
    <section data-proto={id} data-shot={id} className="flex w-[30rem] flex-col gap-1.5">
      <h2 className="text-sm font-semibold text-ink">{titre}</h2>
      <div className="surface flex h-[26rem] flex-col overflow-hidden rounded-xl border border-line shadow-float">
        {bande}
        <div className="min-h-0 flex-1 overflow-hidden px-3 py-2.5">{children}</div>
      </div>
      <p className="text-micro leading-relaxed text-ink-faint">{note}</p>
    </section>
  )
}

function ListeLiensEntrants() {
  return (
    <>
      <div className="mb-2 text-micro font-semibold tracking-wide text-ink-faint uppercase">3 notes mènent ici</div>
      <div className="flex flex-col gap-1.5">
        {LIENS_ENTRANTS.map((lien) => (
          <div key={lien.titre} className="rounded-lg border border-line px-2.5 py-2">
            <div className="flex items-center gap-1.5">
              <FileText size={11} className="shrink-0 text-ink-faint" />
              <span className="min-w-0 flex-1 truncate text-xs font-medium text-ink">{lien.titre}</span>
              <span className="shrink-0 text-micro text-ink-faint">{lien.dossier}</span>
            </div>
            <p className="mt-1 line-clamp-2 text-micro leading-relaxed text-ink-faint">{lien.phrase}</p>
          </div>
        ))}
      </div>
    </>
  )
}

function ListeVoisines({ titre = 'Voisines' }: { titre?: string }) {
  return (
    <>
      <div className="mt-3 mb-2 text-micro font-semibold tracking-wide text-ink-faint uppercase">{titre}</div>
      <div className="flex flex-col gap-0.5">
        {VOISINES.map((voisine) => (
          <div key={voisine.titre} className="flex h-7 items-center gap-2 rounded-md px-1.5">
            <Waypoints size={11} className="shrink-0 text-ink-faint" />
            <span className="min-w-0 flex-1 truncate text-xs text-ink-soft">{voisine.titre}</span>
            <span className="shrink-0 text-micro text-ink-faint">{voisine.partage}</span>
          </div>
        ))}
      </div>
    </>
  )
}

function P1() {
  return (
    <Panneau
      id="bande-p1-symetrie"
      titre="P1 · quatre vues, comme en Travail"
      note="La bande garde la forme du contexte Travail : trois vues du vault, un trait, puis Agent — la vue qui dit ce que l’agent a écrit, et qui est la même partout. *Liens* et *Voisines* restent séparées parce qu’elles répondent à deux questions : « qui me cite » est un fait du texte, « qui me ressemble » est un calcul de l’index."
      bande={<Bande
        actif="Liens"
        vues={[
          { label: 'Liens', icone: <Link2 size={14} /> },
          { label: 'Voisines', icone: <Waypoints size={14} /> },
          { label: 'Historique', icone: <History size={14} /> },
        ]}
        apart={{ label: 'Agent', icone: <Bot size={14} /> }}
      />}
    >
      <ListeLiensEntrants />
    </Panneau>
  )
}

function P2() {
  return (
    <Panneau
      id="bande-p2-autour"
      titre="P2 · deux vues : « Autour », et l’histoire"
      note="*Liens* et *Voisines* fusionnent : les deux répondent à « qu’est-ce qui touche cette note », et les séparer oblige à un aller-retour pour une réponse unique. La bande tombe à deux vues plus Agent — assez courte pour tenir nommée dans un panneau étroit, là où P1 et P3 passent en icônes."
      bande={<Bande
        actif="Autour"
        vues={[
          { label: 'Autour', icone: <Waypoints size={14} /> },
          { label: 'Historique', icone: <History size={14} /> },
        ]}
        apart={{ label: 'Agent', icone: <Bot size={14} /> }}
      />}
    >
      <ListeLiensEntrants />
      <ListeVoisines />
    </Panneau>
  )
}

function P3() {
  return (
    <Panneau
      id="bande-p3-chat"
      titre="P3 · et si le chat du vault était une vue ?"
      note="Cinq vues : on parle à son vault sans quitter la note. Mais c’est un second domicile pour les conversations — or une conversation vit au centre, et écrire dans le vault est une capacité accordée à un fil, pas un chat à part. La bande tient tout juste à 30 rem ; en dessous, la règle de la coque fait tomber les cinq noms d’un coup."
      bande={<Bande
        actif="Chat"
        vues={[
          { label: 'Liens', icone: <Link2 size={14} /> },
          { label: 'Voisines', icone: <Waypoints size={14} /> },
          { label: 'Chat', icone: <MessagesSquare size={14} /> },
          { label: 'Historique', icone: <History size={14} /> },
        ]}
        apart={{ label: 'Agent', icone: <Bot size={14} /> }}
      />}
    >
      <div className="flex h-full flex-col">
        <div className="flex min-h-0 flex-1 flex-col gap-2.5">
          <div className="self-end rounded-lg bg-accent-wash px-2.5 py-1.5 text-xs text-ink">Qu’est-ce que j’ai écrit sur la mémoire longue ?</div>
          <div className="flex gap-2">
            <AgentIcon agent="claude" size={13} />
            <p className="min-w-0 flex-1 text-xs leading-relaxed text-ink-soft">
              Trois notes : <span className="text-accent">[[Mémoire des agents]]</span>, <span className="text-accent">[[Mémoire &amp; contexte]]</span> et le journal du 9. La première conclut que Letta ne tient pas à l’échelle d’un vault.
            </p>
          </div>
        </div>
        <div className="flex h-9 shrink-0 items-center gap-2 rounded-lg border border-line px-2.5 text-xs text-ink-faint">
          <span className="flex-1">Demander au vault…</span>
          <PanelRight size={12} />
        </div>
      </div>
    </Panneau>
  )
}

/* ---------------------------------------------------------------- planche ---- */

export function VaultTour1() {
  return (
    <div className="flex flex-wrap items-start gap-7 p-4">
      <PartiA />
      <PartiB />
      <PartiC />
      <P1 />
      <P2 />
      <P3 />
    </div>
  )
}

/* ================================================================== tour 2 ===
 *
 * Correction de cap, de Tim : le vault n'est pas une archive qu'on consulte, c'est
 * **un atelier d'écriture**. Ce qu'il attend de l'IA n'est pas qu'elle écrive des notes
 * à sa place, mais qu'elle **mette en corrélation ce que lui a déjà écrit** — l'idée
 * qu'Obsidian a remise en circulation, et que l'index d'un vault rend calculable.
 *
 * Ça déclasse A (le flux daté : de l'administration) et B (la table des matières : de
 * l'inventaire), et ça fait de C le bon parti — mais C tel que dessiné est trop maigre :
 * il ouvre la note du jour et s'arrête là.
 *
 * L'objet neuf de ce tour est donc le **rapprochement** : une raison écrite en clair, les
 * notes concernées avec leur extrait, et un geste qui produit quelque chose.
 */

type TypeRappro = 'echo' | 'reponse' | 'carrefour' | 'contradiction'

const RAPPRO_MOT: Record<TypeRappro, { mot: string; icone: ReactNode; tone: string }> = {
  echo: { mot: 'Tu l’as écrit deux fois', icone: <Layers size={13} />, tone: 'text-accent' },
  reponse: { mot: 'Une note ancienne te répond', icone: <CornerDownRight size={13} />, tone: 'text-positive' },
  carrefour: { mot: 'Il manque la note qui les tient', icone: <FilePlus2 size={13} />, tone: 'text-caution' },
  contradiction: { mot: 'Tu dis l’inverse ailleurs', icone: <TriangleAlert size={13} />, tone: 'text-critical' },
}

const RAPPROCHEMENTS: {
  type: TypeRappro
  phrase: string
  notes: { titre: string; dossier: string; quand: string; extrait: string }[]
  gestes: string[]
}[] = [
  {
    type: 'echo',
    phrase: 'Tu as écrit deux fois que l’index n’est qu’un dérivé — hier, et le 12 mars.',
    notes: [
      { titre: 'Vault : git plutôt que Drive', dossier: 'Idées', quand: 'hier', extrait: 'Les fichiers sont la vérité ; ce que Solera indexe n’est qu’un dérivé, qu’on peut jeter et refaire.' },
      { titre: 'Mémoire & contexte', dossier: 'Veille', quand: '12 mars', extrait: 'Un index qui devient la source finit par mentir : il faut qu’il soit reconstructible à tout moment.' },
    ],
    gestes: ['Lier', 'Fusionner'],
  },
  {
    type: 'reponse',
    phrase: 'La question que tu laisses ouverte ici, une note d’août y répond déjà.',
    notes: [
      { titre: '2026-10-12 — note du jour', dossier: 'Journal', quand: 'à l’instant', extrait: '« Comment éviter que l’index dérive quand le vault change hors de Solera ? » — à creuser.' },
      { titre: 'Indexation incrémentale', dossier: 'Veille', quand: '23 août', extrait: 'Surveiller le dossier plutôt que réindexer : un watcher, et un plein passage la nuit.' },
    ],
    gestes: ['Lier', 'Ouvrir'],
  },
  {
    type: 'carrefour',
    phrase: 'Cinq notes tournent autour de la mémoire longue, aucune ne les tient ensemble.',
    notes: [
      { titre: 'Mémoire des agents — état de l’art', dossier: 'Veille', quand: 'hier', extrait: 'Letta, Zep, mem0 — et ce qui ne tient pas à l’échelle d’un vault.' },
      { titre: 'Mémoire & contexte', dossier: 'Veille', quand: '12 mars', extrait: 'Ce qu’un agent doit retenir d’une session à l’autre, et ce qu’il doit oublier.' },
    ],
    gestes: ['Écrire la note', 'Voir les cinq'],
  },
  {
    type: 'contradiction',
    phrase: 'Tu écris ici que le vault n’est pas un répertoire de travail ; en juillet, l’inverse.',
    notes: [
      { titre: 'Trois contextes, une coque', dossier: 'Idées', quand: 'jeudi', extrait: 'Le vault est une ressource partagée, comme un service — pas un répertoire de travail.' },
      { titre: 'Un projet par dossier', dossier: 'Idées', quand: '4 juillet', extrait: 'Au fond le vault est un projet comme un autre : un dossier, du git, des sessions.' },
    ],
    gestes: ['Trancher', 'Ignorer'],
  },
]

/* ------------------------------------------- le rapprochement, trois écritures */

function Geste({ children, premier = false }: { children: ReactNode; premier?: boolean }) {
  return (
    <span className={cx(
      'flex h-6 shrink-0 items-center rounded-md px-2 text-micro font-medium',
      premier ? 'bg-accent text-on-accent' : 'border border-line text-ink-soft',
    )}>
      {children}
    </span>
  )
}

function TeteRappro({ type }: { type: TypeRappro }) {
  const mot = RAPPRO_MOT[type]
  return (
    <span className={cx('flex items-center gap-1.5 text-micro font-semibold tracking-wide uppercase', mot.tone)}>
      {mot.icone}{mot.mot}
    </span>
  )
}

/** R1 — les deux extraits face à face : on juge le rapprochement sur pièces. */
function R1() {
  const rappro = RAPPROCHEMENTS[0]!
  return (
    <Bloc
      id="rappro-r1-face-a-face"
      titre="R1 · face à face — les deux extraits, et on tranche sur pièces"
      note="Le rapprochement se juge sur le texte, pas sur la promesse : les deux passages sont là, datés, avec leur dossier. C’est la seule écriture où « Fusionner » est un geste honnête — on voit ce qu’on fusionne. Elle coûte de la place : trois rapprochements remplissent déjà une page."
      largeur="w-[38rem]"
    >
      <div className="px-4 py-3">
        <TeteRappro type={rappro.type} />
        <p className="mt-1.5 text-sm leading-relaxed text-ink">{rappro.phrase}</p>
        <div className="mt-3 flex gap-2.5">
          {rappro.notes.map((note) => (
            <div key={note.titre} className="min-w-0 flex-1 rounded-lg border border-line bg-sunken/40 px-2.5 py-2">
              <div className="flex items-center gap-1.5">
                <FileText size={11} className="shrink-0 text-ink-faint" />
                <span className="min-w-0 flex-1 truncate text-xs font-medium text-ink">{note.titre}</span>
              </div>
              <p className="mt-1.5 text-micro leading-relaxed text-ink-soft">« {note.extrait} »</p>
              <div className="mt-1.5 text-micro text-ink-faint">{note.dossier} · {note.quand}</div>
            </div>
          ))}
        </div>
        <div className="mt-3 flex items-center gap-1.5">
          <Geste premier>{rappro.gestes[0]}</Geste>
          <Geste>{rappro.gestes[1]}</Geste>
          <span className="ml-auto flex items-center gap-1 text-micro text-ink-faint"><X size={11} />pas un rapprochement</span>
        </div>
      </div>
    </Bloc>
  )
}

/** R2 — la phrase d'abord : on lit l'idée, les notes ne sont que la preuve. */
function R2() {
  return (
    <Bloc
      id="rappro-r2-la-phrase"
      titre="R2 · la phrase d’abord — l’idée, puis la preuve en dessous"
      note="Ce qui compte est la phrase : elle dit l’idée que les deux notes partagent, pas le fait qu’elles se ressemblent. Les notes passent en puces, l’extrait n’apparaît qu’au survol. Deux fois plus de rapprochements tiennent dans la même hauteur — au prix qu’on accepte un peu sur parole."
      largeur="w-[38rem]"
    >
      <div className="flex flex-col divide-y divide-line">
        {RAPPROCHEMENTS.slice(0, 3).map((rappro) => (
          <div key={rappro.phrase} className="px-4 py-3">
            <TeteRappro type={rappro.type} />
            <p className="mt-1.5 text-sm leading-relaxed text-ink">{rappro.phrase}</p>
            <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1">
              {rappro.notes.map((note) => (
                <span key={note.titre} className="flex items-center gap-1.5 text-micro text-ink-soft">
                  <FileText size={10} className="text-ink-faint" />
                  <span className="underline decoration-line underline-offset-2">{note.titre}</span>
                  <span className="text-ink-faint">{note.quand}</span>
                </span>
              ))}
              <span className="ml-auto flex items-center gap-1.5">
                <Geste premier>{rappro.gestes[0]}</Geste>
                <Ellipsis size={13} className="text-ink-faint" />
              </span>
            </div>
          </div>
        ))}
      </div>
    </Bloc>
  )
}

/** R3 — la liste : dix rapprochements d'un coup, le détail au clic. */
function R3() {
  return (
    <Bloc
      id="rappro-r3-la-liste"
      titre="R3 · la liste — en voir dix, en ouvrir un"
      note="Une ligne par rapprochement : le type en icône, la phrase tronquée, le geste au survol. On balaie, on ouvre ce qui accroche — et le rapprochement déplié prend la forme R1. C’est l’écriture qui tient dans une colonne de côté ; les deux autres demandent la pleine largeur."
      largeur="w-[38rem]"
    >
      <div className="flex flex-col px-2 py-2">
        {RAPPROCHEMENTS.map((rappro, index) => (
          <div key={rappro.phrase} className={cx(
            'flex items-center gap-2.5 rounded-lg px-2.5 py-2',
            index === 1 && 'bg-surface-high',
          )}>
            <span className={cx('shrink-0', RAPPRO_MOT[rappro.type].tone)}>{RAPPRO_MOT[rappro.type].icone}</span>
            <span className="min-w-0 flex-1 truncate text-sm text-ink">{rappro.phrase}</span>
            {index === 1
              ? <span className="flex shrink-0 items-center gap-1.5"><Geste premier>{rappro.gestes[0]}</Geste><Ellipsis size={13} className="text-ink-faint" /></span>
              : <span className="shrink-0 text-micro text-ink-faint">{rappro.notes.length} notes</span>}
          </div>
        ))}
      </div>
    </Bloc>
  )
}

/* --------------------------------------- la page du vault, atelier d'écriture */

/** Le bloc d'écriture, commun aux trois pages : c'est lui qui tient le centre. */
function Ecriture({ hauteur = '' }: { hauteur?: string }) {
  return (
    <div className={cx('rounded-xl border border-line bg-sunken/40 px-4 py-3', hauteur)}>
      <div className="mb-2 flex items-center gap-2">
        <FileText size={13} className="text-ink-faint" />
        <span className="text-sm font-semibold text-ink">2026-10-12</span>
        <span className="flex h-5 items-center rounded-full bg-surface-high px-2 text-micro text-ink-soft">Journal</span>
        <span className="ml-auto flex items-center gap-1.5 text-micro text-ink-faint"><Shield size={11} />lecture seule pour les agents</span>
      </div>
      <div className="flex flex-col gap-1.5 text-sm leading-relaxed text-ink">
        <p>Le vault n’est pas une archive : c’est l’atelier. Ce que j’attends de l’IA, c’est qu’elle relie ce que j’ai déjà écrit.</p>
        <p className="text-ink-soft">
          Les fichiers sont la vérité, l’index n’est qu’un dérivé — voir <span className="rounded bg-accent-wash px-1 text-accent">[[Vault : git plutôt que Drive]]</span>.
        </p>
        <p className="text-ink-soft">
          Comment éviter que l’index dérive quand le vault change hors de Solera ?<span className="ml-px inline-block h-4 w-px translate-y-0.5 bg-accent" />
        </p>
      </div>
    </div>
  )
}

/** D1 — les rapprochements arrivent sous la note, déclenchés par ce qu'on écrit. */
function D1() {
  return (
    <Bloc
      id="page-d1-pendant-que-tu-ecris"
      titre="D1 · « Pendant que tu écris » — les rapprochements montent sous la note"
      note="L’IA réagit à la phrase en cours : le mot « index » réveille deux notes, la question laissée ouverte en réveille une autre. Les rapprochements sont **datés de maintenant** — ils changent pendant la frappe. Ce que ça demande : une indexation qui répond en moins d’une seconde, sinon la bande arrive après que la pensée est passée."
    >
      <div className="px-5 py-4">
        <Entete />
        <div className="flex gap-5">
          <div className="min-w-0 flex-1">
            <Ecriture />
            <div className="mt-3 mb-2 flex items-center gap-2">
              <Waypoints size={13} className="text-accent" />
              <span className="flex-1 text-xs font-medium text-ink-soft">Pendant que tu écris</span>
              <span className="text-micro text-ink-faint">d’après les deux derniers paragraphes</span>
            </div>
            <div className="flex gap-2.5">
              {RAPPROCHEMENTS.slice(0, 2).map((rappro) => (
                <div key={rappro.phrase} className="min-w-0 flex-1 rounded-lg border border-line px-3 py-2.5">
                  <TeteRappro type={rappro.type} />
                  <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-ink">{rappro.phrase}</p>
                  <div className="mt-2 flex items-center gap-1.5">
                    <Geste premier>{rappro.gestes[0]}</Geste>
                    <span className="ml-auto text-micro text-ink-faint">{rappro.notes[1]!.quand}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="w-[14rem] shrink-0">
            <div className="mb-2 flex items-center gap-1.5">
              <Clock size={13} className="text-ink-faint" />
              <span className="flex-1 text-xs font-medium text-ink-soft">Reprendre</span>
            </div>
            <div className="mb-4 flex flex-col gap-0.5">
              {REPRENDRE.slice(0, 3).map((note) => (
                <div key={note.titre} className="flex h-7 items-center gap-2 rounded-md px-1.5">
                  <FileText size={11} className="shrink-0 text-ink-faint" />
                  <span className="min-w-0 flex-1 truncate text-xs text-ink-soft">{note.titre}</span>
                </div>
              ))}
            </div>
            <div className="mb-2 flex items-center gap-1.5">
              <Inbox size={13} className="text-caution" />
              <span className="flex-1 text-xs font-medium text-ink-soft">Boîte des agents</span>
              <Count tone="caution">2</Count>
            </div>
            <div className="mb-4 flex flex-col gap-0.5">
              {PROPOSITIONS.map((entree) => (
                <div key={entree.titre} className="flex h-7 items-center gap-2 rounded-md px-1.5">
                  <AgentIcon agent={entree.agent} size={11} />
                  <span className="min-w-0 flex-1 truncate text-xs text-ink-soft">{entree.titre}</span>
                </div>
              ))}
            </div>
            <ARanger />
          </div>
        </div>
      </div>
    </Bloc>
  )
}

/** D2 — l'atelier : écrire à gauche, la pile des rapprochements à droite. */
function D2() {
  return (
    <Bloc
      id="page-d2-atelier"
      titre="D2 · « L’atelier » — l’écriture à gauche, la pile des rapprochements à droite"
      note="La colonne de côté change de métier : elle ne porte plus ce que les agents veulent écrire, mais ce qu’ils ont **trouvé dans ce que tu as écrit**. Elle passe de 15 à 19 rem, parce qu’un rapprochement a besoin d’une phrase entière pour se dire. La boîte des agents redescend en bas, à sa vraie importance."
    >
      <div className="px-5 py-4">
        <Entete />
        <div className="flex gap-5">
          <div className="min-w-0 flex-1">
            <Ecriture />
            <div className="mt-3 mb-2 flex items-center gap-2">
              <Clock size={13} className="text-ink-faint" />
              <span className="flex-1 text-xs font-medium text-ink-soft">Reprendre</span>
              <span className="text-micro text-ink-faint">8 notes touchées cette semaine</span>
            </div>
            <div className="flex flex-col gap-0.5">
              {REPRENDRE.slice(0, 3).map((note) => (
                <div key={note.titre} className="flex items-center gap-2.5 rounded-lg px-2 py-1.5">
                  <FileText size={13} className="shrink-0 text-ink-faint" />
                  <span className="min-w-0 max-w-[16rem] flex-1 truncate text-sm text-ink">{note.titre}</span>
                  <span className="min-w-0 flex-1 truncate text-micro text-ink-faint">{note.extrait}</span>
                  <span className="shrink-0 text-micro text-ink-faint">{note.quand}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="w-[19rem] shrink-0">
            <div className="mb-2 flex items-center gap-1.5">
              <Waypoints size={13} className="text-accent" />
              <span className="flex-1 text-xs font-medium text-ink-soft">Rapprochements</span>
              <Count tone="accent">4</Count>
            </div>
            <div className="mb-4 flex flex-col gap-1.5">
              {RAPPROCHEMENTS.map((rappro) => (
                <div key={rappro.phrase} className="rounded-lg border border-line px-2.5 py-2">
                  <TeteRappro type={rappro.type} />
                  <p className="mt-1 text-xs leading-relaxed text-ink">{rappro.phrase}</p>
                  <div className="mt-2 flex items-center gap-1.5">
                    <Geste premier>{rappro.gestes[0]}</Geste>
                    <Geste>{rappro.gestes[1]}</Geste>
                    <span className="ml-auto text-micro text-ink-faint"><X size={11} /></span>
                  </div>
                </div>
              ))}
            </div>
            <div className="mb-2 flex items-center gap-1.5">
              <Inbox size={13} className="text-caution" />
              <span className="flex-1 text-xs font-medium text-ink-soft">Boîte des agents</span>
              <Count tone="caution">2</Count>
            </div>
            <ARanger />
          </div>
        </div>
      </div>
    </Bloc>
  )
}

/** D3 — le chantier : le vault a des sujets en cours, pas seulement des notes. */
const CHANTIERS = [
  {
    titre: 'Mémoire longue des agents',
    question: 'Qu’est-ce qu’un agent doit retenir d’une session à l’autre, et à quel prix ?',
    notes: 5,
    manque: 'personne ne relie ces cinq notes',
    quand: 'touché hier',
    actif: true,
  },
  { titre: 'Le vault comme atelier', question: 'En quoi écrire avec une IA change la façon de ranger.', notes: 3, manque: '2 questions sans réponse', quand: 'touché jeudi', actif: false },
  { titre: 'Solera — positionnement', question: 'À qui ça parle, et contre quoi ça se compare.', notes: 7, manque: 'une contradiction à trancher', quand: 'touché le 4 juillet', actif: false },
]

function D3() {
  const chantier = CHANTIERS[0]!
  return (
    <Bloc
      id="page-d3-chantiers"
      titre="D3 · « Les chantiers » — le vault a des sujets en cours, pas que des notes"
      note="Un objet neuf, et c’est ce qu’il faut peser : le **chantier** — une question ouverte, les notes qui y répondent déjà, ce qui manque encore. C’est la note-carrefour d’Obsidian (la *map of content*), mais tenue par l’index plutôt qu’à la main. Ce que ça gagne : l’IA a enfin un but, pas seulement des ressemblances à signaler. Ce que ça coûte : un troisième objet à comprendre, après la note et le dossier."
    >
      <div className="px-5 py-4">
        <Entete />
        <div className="flex gap-5">
          <div className="min-w-0 flex-1">
            <div className="mb-2 flex items-center gap-2">
              <Combine size={13} className="text-accent" />
              <span className="flex-1 text-xs font-medium text-ink-soft">Chantier en cours</span>
            </div>
            <div className="rounded-xl border border-accent/40 bg-accent-wash/30 px-4 py-3">
              <div className="text-sm font-semibold text-ink">{chantier.titre}</div>
              <p className="mt-1 text-xs leading-relaxed text-ink-soft">« {chantier.question} »</p>
              <div className="mt-3 flex flex-col gap-0.5">
                {[RAPPROCHEMENTS[2]!.notes[0]!, RAPPROCHEMENTS[2]!.notes[1]!, RAPPROCHEMENTS[1]!.notes[1]!].map((note) => (
                  <div key={note.titre} className="flex items-center gap-2 rounded-md px-1.5 py-1">
                    <FileText size={11} className="shrink-0 text-ink-faint" />
                    <span className="min-w-0 max-w-[16rem] flex-1 truncate text-xs text-ink">{note.titre}</span>
                    <span className="min-w-0 flex-1 truncate text-micro text-ink-faint">{note.extrait}</span>
                    <span className="shrink-0 text-micro text-ink-faint">{note.quand}</span>
                  </div>
                ))}
                <div className="flex items-center gap-2 rounded-md px-1.5 py-1 text-micro text-ink-faint">
                  <Plus size={11} />2 autres notes rattachées
                </div>
              </div>
              <div className="mt-3 flex items-center gap-1.5 border-t border-line pt-2.5">
                <Geste premier><PenLine size={11} className="mr-1" />Écrire la note qui les tient</Geste>
                <Geste>Voir les rapprochements (4)</Geste>
                <span className="ml-auto text-micro text-caution">{chantier.manque}</span>
              </div>
            </div>

            <div className="mt-4 mb-2 flex items-center gap-2">
              <Combine size={13} className="text-ink-faint" />
              <span className="flex-1 text-xs font-medium text-ink-soft">Autres chantiers</span>
            </div>
            <div className="flex flex-col gap-0.5">
              {CHANTIERS.slice(1).map((autre) => (
                <div key={autre.titre} className="flex items-center gap-2.5 rounded-lg px-2 py-1.5">
                  <Combine size={12} className="shrink-0 text-ink-faint" />
                  <span className="min-w-0 max-w-[14rem] flex-1 truncate text-sm text-ink">{autre.titre}</span>
                  <span className="min-w-0 flex-1 truncate text-micro text-ink-faint">{autre.manque}</span>
                  <span className="shrink-0 text-micro text-ink-faint">{autre.notes} notes · {autre.quand}</span>
                </div>
              ))}
            </div>

            <div className="mt-4 mb-2 flex items-center gap-2">
              <FileText size={13} className="text-ink-faint" />
              <span className="flex-1 text-xs font-medium text-ink-soft">Hors chantier</span>
              <span className="text-micro text-ink-faint">note du jour, journal, notes libres</span>
            </div>
            <div className="flex flex-col gap-0.5">
              {REPRENDRE.slice(0, 2).map((note) => (
                <div key={note.titre} className="flex items-center gap-2.5 rounded-lg px-2 py-1.5">
                  <FileText size={13} className="shrink-0 text-ink-faint" />
                  <span className="min-w-0 max-w-[16rem] flex-1 truncate text-sm text-ink-soft">{note.titre}</span>
                  <span className="shrink-0 text-micro text-ink-faint">{note.dossier} · {note.quand}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="w-[14rem] shrink-0">
            <div className="mb-2 flex items-center gap-1.5">
              <Waypoints size={13} className="text-accent" />
              <span className="flex-1 text-xs font-medium text-ink-soft">Rapprochements</span>
              <Count tone="accent">4</Count>
            </div>
            <div className="mb-4 flex flex-col gap-0.5">
              {RAPPROCHEMENTS.map((rappro) => (
                <div key={rappro.phrase} className="flex items-start gap-2 rounded-md px-1.5 py-1.5">
                  <span className={cx('mt-px shrink-0', RAPPRO_MOT[rappro.type].tone)}>{RAPPRO_MOT[rappro.type].icone}</span>
                  <span className="min-w-0 flex-1 line-clamp-2 text-micro leading-relaxed text-ink-soft">{rappro.phrase}</span>
                </div>
              ))}
            </div>
            <div className="mb-2 flex items-center gap-1.5">
              <Inbox size={13} className="text-caution" />
              <span className="flex-1 text-xs font-medium text-ink-soft">Boîte des agents</span>
              <Count tone="caution">2</Count>
            </div>
            <ARanger />
          </div>
        </div>
      </div>
    </Bloc>
  )
}

export function VaultTour2() {
  return (
    <div className="flex flex-wrap items-start gap-7 p-4">
      <D1 />
      <D2 />
      <D3 />
      <R1 />
      <R2 />
      <R3 />
    </div>
  )
}

/* ================================================================== tour 3 ===
 *
 * Tim a pris **D2** (l'atelier : écriture au centre, pile des rapprochements à côté) et
 * **R3** pour la liste, R1 pour le détail. Reste à dire *où* R1 se déplie — ni la colonne
 * de D2 (19 rem) ni le panneau droit (20 rem) ne logent un face-à-face qui demande 38 rem.
 * C'est la première question de ce tour ; les deux autres sont l'éditeur lui-même et
 * l'arrivée d'un passage proposé par un fil.
 */

const CANDIDATS_LIEN = [
  { titre: 'Mémoire des agents — état de l’art', dossier: 'Veille', liens: 12 },
  { titre: 'Mémoire & contexte', dossier: 'Veille', liens: 28 },
  { titre: 'Mémoire longue — chantier', dossier: 'Idées', liens: 5 },
  { titre: '2026-03-12 — mémoire', dossier: 'Journal', liens: 2 },
]

/** La barre du haut en contexte Savoir : elle est arrêtée (coque, `02-v-barre-contextes`). */
function BarreNote({ lecture = false }: { lecture?: boolean }) {
  return (
    <div className="flex h-[var(--header-height)] shrink-0 items-center gap-2.5 border-b border-line px-3">
      <FileText size={16} className="shrink-0 text-ink-faint" />
      <span className="min-w-0">
        <span className="flex items-center gap-1 text-micro text-ink-faint"><BookOpen size={10} />Journal</span>
        <span className="block truncate text-sm font-medium text-ink">2026-10-12</span>
      </span>
      <span className="ml-auto flex items-center gap-1.5">
        {lecture
          ? <span className="flex h-6 items-center gap-1.5 rounded-full bg-caution/10 px-2 text-micro font-medium text-caution"><Inbox size={11} />proposée, pas encore acceptée</span>
          : <span className="flex h-6 items-center gap-1.5 rounded-full bg-surface-high px-2 text-micro text-ink-soft"><Shield size={11} />lecture seule pour les agents</span>}
        <span className="flex h-6 items-center gap-1.5 rounded-full bg-surface-high px-2 text-micro text-ink-soft"><Link2 size={11} />3 liens entrants</span>
        <Ico><PanelRight size={15} /></Ico>
      </span>
    </div>
  )
}

/** Le corps de la note, en largeur de lecture. */
function CorpsNote({ selecteur = false, enfants }: { selecteur?: boolean; enfants?: ReactNode }) {
  return (
    <div className="min-h-0 flex-1 overflow-hidden px-8 py-5">
      <div className="mx-auto flex max-w-[34rem] flex-col gap-3 text-sm leading-relaxed text-ink">
        <h3 className="text-lg font-semibold tracking-tight">Le vault comme atelier</h3>
        <p>Le vault n’est pas une archive : c’est l’atelier. Ce que j’attends de l’IA, c’est qu’elle relie ce que j’ai déjà écrit.</p>
        <p>
          Les fichiers sont la vérité, l’index n’est qu’un dérivé — voir <span className="rounded bg-accent-wash px-1 text-accent">[[Vault : git plutôt que Drive]]</span>.
        </p>
        {enfants}
        {selecteur ? (
          <>
            <p className="text-ink">
              Ce qu’il reste à relier, c’est tout ce que j’ai écrit sur la <span className="rounded bg-accent-wash px-1 text-accent">[[mém</span><span className="ml-px inline-block h-4 w-px translate-y-0.5 bg-accent" />
            </p>
            <div className="w-[21rem] overflow-hidden rounded-lg border border-line bg-surface shadow-float">
              {CANDIDATS_LIEN.map((candidat, index) => (
                <div key={candidat.titre} className={cx('flex items-center gap-2 px-2.5 py-1.5', index === 0 && 'bg-accent-wash')}>
                  <FileText size={11} className="shrink-0 text-ink-faint" />
                  <span className="min-w-0 flex-1 truncate text-xs text-ink">{candidat.titre}</span>
                  <span className="shrink-0 text-micro text-ink-faint">{candidat.dossier}</span>
                  <span className="w-6 shrink-0 text-right text-micro tabular-nums text-ink-faint">{candidat.liens}</span>
                </div>
              ))}
              <div className="flex items-center gap-2 border-t border-line px-2.5 py-1.5">
                <Plus size={11} className="shrink-0 text-ink-faint" />
                <span className="min-w-0 flex-1 truncate text-xs text-ink-soft">Créer « mém… »</span>
                <span className="shrink-0 text-micro text-ink-faint">↵ lier</span>
              </div>
            </div>
          </>
        ) : (
          <p className="text-ink">Ce qu’il reste à relier, c’est tout ce que j’ai écrit sur la mémoire longue depuis mars.<span className="ml-px inline-block h-4 w-px translate-y-0.5 bg-accent" /></p>
        )}
      </div>
    </div>
  )
}

/** La bande du panneau en contexte Savoir — P1, « Voisines » devenue « Rapprochements ». */
function BandeSavoir({ actif = 'Rapprochements', compact = true, fin }: { actif?: string; compact?: boolean; fin?: ReactNode }) {
  return (
    <Bande
      actif={actif}
      compact={compact}
      fin={fin}
      vues={[
        { label: 'Rapprochements', icone: <Waypoints size={14} /> },
        { label: 'Liens', icone: <Link2 size={14} /> },
        { label: 'Historique', icone: <History size={14} /> },
      ]}
      apart={{ label: 'Agent', icone: <Bot size={14} /> }}
    />
  )
}

/** La liste R3, telle qu'elle tient dans une colonne étroite. */
function ListeR3({ ouvert = -1 }: { ouvert?: number }) {
  return (
    <div className="flex flex-col gap-0.5">
      {RAPPROCHEMENTS.map((rappro, index) => (
        index === ouvert ? (
          <div key={rappro.phrase} className="rounded-lg border border-accent/40 bg-accent-wash/20 px-2.5 py-2">
            <TeteRappro type={rappro.type} />
            <p className="mt-1 text-xs leading-relaxed text-ink">{rappro.phrase}</p>
            <div className="mt-2 flex flex-col gap-1.5">
              {rappro.notes.map((note) => (
                <div key={note.titre} className="rounded-md border border-line bg-surface px-2 py-1.5">
                  <div className="flex items-center gap-1.5">
                    <FileText size={10} className="shrink-0 text-ink-faint" />
                    <span className="min-w-0 flex-1 truncate text-micro font-medium text-ink">{note.titre}</span>
                    <span className="shrink-0 text-micro text-ink-faint">{note.quand}</span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-micro leading-relaxed text-ink-soft">« {note.extrait} »</p>
                </div>
              ))}
            </div>
            <div className="mt-2 flex items-center gap-1.5">
              <Geste premier>{rappro.gestes[0]}</Geste>
              <Geste>{rappro.gestes[1]}</Geste>
              <span className="ml-auto text-micro text-ink-faint"><X size={11} /></span>
            </div>
          </div>
        ) : (
          <div key={rappro.phrase} className="flex items-start gap-2 rounded-md px-1.5 py-1.5">
            <span className={cx('mt-px shrink-0', RAPPRO_MOT[rappro.type].tone)}>{RAPPRO_MOT[rappro.type].icone}</span>
            <span className="min-w-0 flex-1 line-clamp-2 text-micro leading-relaxed text-ink-soft">{rappro.phrase}</span>
          </div>
        )
      ))}
    </div>
  )
}

function PanneauSavoir({ ouvert = -1 }: { ouvert?: number }) {
  return (
    <div className="flex w-[20rem] shrink-0 flex-col border-l border-line">
      <BandeSavoir />
      <div className="min-h-0 flex-1 overflow-hidden px-2.5 py-2">
        <div className="mb-1.5 flex items-center gap-1.5 px-1.5">
          <span className="flex-1 text-micro font-semibold tracking-wide text-ink-faint uppercase">Depuis cette note</span>
          <Count tone="accent">4</Count>
        </div>
        <ListeR3 ouvert={ouvert} />
      </div>
    </div>
  )
}

function CadreEcran({ id, titre, note, largeur = 'w-[58rem]', hauteur = 'h-[30rem]', children }: {
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
      <div className={cx('surface flex overflow-hidden rounded-xl border border-line shadow-float', hauteur)}>{children}</div>
      <p className="text-micro leading-relaxed text-ink-faint">{note}</p>
    </section>
  )
}

/* ------------------------------------------------------- 1 · l'éditeur ------ */

function EditeurEcriture() {
  return (
    <CadreEcran
      id="editeur-ecriture"
      titre="1 · L’éditeur en écriture — « [[ » ouvre le sélecteur, le panneau suit"
      note="La colonne de gauche n’est pas dessinée : elle est arrêtée. Le texte tient dans une largeur de lecture de 34 rem plutôt que toute la place ; « [[ » ouvre le sélecteur de note, classé par nombre de liens entrants — les carrefours d’abord, parce que c’est là qu’on veut accrocher. La dernière ligne crée la note absente sans quitter la frappe. À droite, la bande du Savoir : *Voisines* du tour 1 est devenue **Rapprochements**, puisque c’est le même calcul vu depuis une note. À 20 rem la règle de la coque a fait tomber les noms — c’est le cas courant, et il rend l’icône de chaque vue décisive."
    >
      <div className="flex min-w-0 flex-1 flex-col"><BarreNote /><CorpsNote selecteur /></div>
      <PanneauSavoir />
    </CadreEcran>
  )
}

/* ----------------------------- 2 et 3 · où un rapprochement se déplie ------- */

function X1DansLaColonne() {
  return (
    <CadreEcran
      id="ouvrir-x1-dans-la-colonne"
      titre="2 · X1 — le rapprochement se déplie sur place, extraits empilés"
      note="Rien ne bouge autour : la ligne s’ouvre, les deux extraits s’empilent faute de largeur, les gestes apparaissent. On reste dans son texte, on peut déplier trois rapprochements de suite et les comparer en descendant. Ce qu’on perd : le face-à-face: deux extraits l’un sous l’autre se comparent moins bien que côte à côte, et « Fusionner » redevient un pari."
    >
      <div className="flex min-w-0 flex-1 flex-col"><BarreNote /><CorpsNote /></div>
      <PanneauSavoir ouvert={0} />
    </CadreEcran>
  )
}

function X2EnModale() {
  const rappro = RAPPROCHEMENTS[0]!
  return (
    <CadreEcran
      id="ouvrir-x2-en-modale"
      titre="3 · X2 — le rapprochement s’ouvre en modale, face à face"
      note="R1 tel qu’il a été dessiné, à ses 38 rem : les deux passages côte à côte, datés, et « Fusionner » devient un geste qu’on peut tenir. Le prix est celui de toute modale — elle couvre la note d’où l’on vient, et on n’en déplie qu’un à la fois. Le compromis raisonnable : X1 par défaut, et X2 au second clic, quand on s’apprête à fusionner ou à trancher une contradiction."
    >
      <div className="relative flex min-w-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col opacity-40"><BarreNote /><CorpsNote /></div>
        <div className="w-[20rem] shrink-0 border-l border-line opacity-40"><BandeSavoir /></div>
        <div className="absolute inset-0 flex items-center justify-center bg-ink/10">
          <div className="surface w-[38rem] rounded-xl border border-line px-4 py-3 shadow-float">
            <div className="flex items-center">
              <TeteRappro type={rappro.type} />
              <span className="ml-auto text-ink-faint"><X size={14} /></span>
            </div>
            <p className="mt-1.5 text-sm leading-relaxed text-ink">{rappro.phrase}</p>
            <div className="mt-3 flex gap-2.5">
              {rappro.notes.map((note) => (
                <div key={note.titre} className="min-w-0 flex-1 rounded-lg border border-line bg-sunken/40 px-2.5 py-2">
                  <div className="flex items-center gap-1.5">
                    <FileText size={11} className="shrink-0 text-ink-faint" />
                    <span className="min-w-0 flex-1 truncate text-xs font-medium text-ink">{note.titre}</span>
                  </div>
                  <p className="mt-1.5 text-micro leading-relaxed text-ink-soft">« {note.extrait} »</p>
                  <div className="mt-1.5 text-micro text-ink-faint">{note.dossier} · {note.quand}</div>
                </div>
              ))}
            </div>
            <div className="mt-3 flex items-center gap-1.5">
              <Geste premier>{rappro.gestes[0]}</Geste>
              <Geste>{rappro.gestes[1]}</Geste>
              <span className="ml-auto flex items-center gap-1 text-micro text-ink-faint"><X size={11} />pas un rapprochement</span>
            </div>
          </div>
        </div>
      </div>
    </CadreEcran>
  )
}

/* ------------------- 4 et 5 · un passage proposé par un fil arrive ---------- */

const PASSAGE = 'Trois familles s’affrontent : la mémoire par résumé (Letta), par graphe (Zep) et par extraction de faits (mem0). Aucune ne survit telle quelle à un vault où les fichiers sont la vérité.'

function E1EnLigne() {
  return (
    <CadreEcran
      id="insertion-e1-en-ligne"
      titre="4 · E1 — le passage arrive en ligne, à l’endroit du curseur"
      largeur="w-[46rem]"
      note="Le fil a écrit un paragraphe, il se pose où l’on était. Teinté, il n’est pas encore dans le fichier : tant qu’on n’a pas accepté, rien n’est commité. On lit à sa place, dans son contexte — c’est le seul moyen de juger si le ton colle. Ce que ça demande : qu’un fil puisse viser une position dans une note, pas seulement un fichier."
    >
      <div className="flex min-w-0 flex-1 flex-col">
        <BarreNote />
        <CorpsNote enfants={
          <div className="rounded-lg border border-accent/40 bg-accent-wash/30 px-3 py-2">
            <div className="mb-1.5 flex items-center gap-1.5 text-micro text-ink-faint">
              <AgentIcon agent="claude" size={11} />
              <span className="flex-1">proposé depuis « Mémoire longue des agents »</span>
              <span className="text-ink-faint">il y a 1 min</span>
            </div>
            <p className="text-sm leading-relaxed text-ink">{PASSAGE}</p>
            <div className="mt-2 flex items-center gap-1.5">
              <Geste premier><Check size={11} className="mr-1" />Insérer</Geste>
              <Geste>Voir le fil</Geste>
              <span className="ml-auto text-micro text-ink-faint"><X size={11} /></span>
            </div>
          </div>
        } />
      </div>
    </CadreEcran>
  )
}

function E2ParLaBoite() {
  return (
    <CadreEcran
      id="insertion-e2-par-la-boite"
      titre="5 · E2 — le passage attend dans la boîte, on choisit où le poser"
      note="Même chemin que toute écriture d’agent : la proposition va dans la boîte, et c’est l’éditeur qui vient la chercher. Le texte montre seulement le point d’insertion visé, en filet. Ce que ça gagne : un seul chemin pour tout ce qu’un agent produit, et on peut déplacer le point avant d’insérer. Ce que ça perd : on ne lit pas le passage dans son contexte, donc on juge moins bien."
    >
      <div className="flex min-w-0 flex-1 flex-col">
        <BarreNote />
        <CorpsNote enfants={
          <div className="flex items-center gap-2 py-1">
            <span className="h-px flex-1 bg-accent/50" />
            <span className="shrink-0 text-micro text-accent">point d’insertion visé</span>
            <span className="h-px w-8 bg-accent/50" />
          </div>
        } />
      </div>
      <div className="flex w-[20rem] shrink-0 flex-col border-l border-line">
        <Bande
          actif="Agent"
          compact
          vues={[
            { label: 'Rapprochements', icone: <Waypoints size={14} /> },
            { label: 'Liens', icone: <Link2 size={14} /> },
            { label: 'Historique', icone: <History size={14} /> },
          ]}
          apart={{ label: 'Agent', icone: <Bot size={14} /> }}
        />
        <div className="min-h-0 flex-1 px-2.5 py-2">
          <div className="mb-1.5 flex items-center gap-1.5 px-1.5">
            <Inbox size={12} className="text-caution" />
            <span className="flex-1 text-micro font-semibold tracking-wide text-ink-faint uppercase">Proposé pour cette note</span>
            <Count tone="caution">1</Count>
          </div>
          <div className="rounded-lg border border-caution/40 bg-caution/5 px-2.5 py-2">
            <div className="flex items-center gap-1.5 text-micro text-ink-faint">
              <AgentIcon agent="claude" size={11} />
              <span className="flex-1 truncate">Mémoire longue des agents</span>
              <span>1 min</span>
            </div>
            <p className="mt-1.5 line-clamp-4 text-micro leading-relaxed text-ink-soft">{PASSAGE}</p>
            <div className="mt-2 flex items-center gap-1.5">
              <Geste premier>Insérer ici</Geste>
              <Geste>Voir le fil</Geste>
              <span className="ml-auto text-micro text-ink-faint"><X size={11} /></span>
            </div>
          </div>
        </div>
      </div>
    </CadreEcran>
  )
}

/* ---------------------------------------------- 6 · la note en lecture seule */

function LectureSeule() {
  return (
    <CadreEcran
      id="editeur-lecture-seule"
      titre="6 · Lecture seule — une note proposée, pas encore acceptée"
      largeur="w-[46rem]"
      note="Le seul cas où l’on ne peut pas écrire : une note qu’un agent a proposée et qu’on n’a pas acceptée. Pas de curseur, pas de « [[ » — on lit, on compare, on décide. Le bandeau porte les quatre gestes de la boîte, et le diff s’ouvre à côté. **Refuser** n’efface rien : le commit de l’agent est révoqué (`git revert`), la note revient à son état d’avant, et la proposition part dans *Refusées* où elle reste sept jours — un refus doit pouvoir se défaire comme le reste."
    >
      <div className="flex min-w-0 flex-1 flex-col">
        <BarreNote lecture />
        <div className="flex h-9 shrink-0 items-center gap-2 border-b border-line bg-caution/5 px-3">
          <AgentIcon agent="claude" size={12} />
          <span className="flex-1 text-micro text-ink-soft">Claude a écrit cette note il y a 2 h · <span className="text-positive">+48</span> <span className="text-critical">−0</span> · dossier <span className="text-ink">Veille</span></span>
          <Geste premier><Check size={11} className="mr-1" />Accepter</Geste>
          <Geste>Voir le diff</Geste>
          <Geste>Refuser</Geste>
          <Ico><Ellipsis size={14} /></Ico>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden px-8 py-5">
          <div className="mx-auto flex max-w-[34rem] flex-col gap-3 text-sm leading-relaxed text-ink-soft">
            <h3 className="text-lg font-semibold tracking-tight text-ink">Veille agents — mémoire longue</h3>
            <p>{PASSAGE}</p>
            <p>
              Ce que ça implique pour Solera est écrit ailleurs : <span className="rounded bg-accent-wash px-1 text-accent">[[Vault : git plutôt que Drive]]</span> pose que l’index est dérivé, donc jetable.
            </p>
            <p className="text-ink-faint italic">— trois sources citées, listées en pied de note.</p>
          </div>
        </div>
      </div>
    </CadreEcran>
  )
}

export function VaultTour3() {
  return (
    <div className="flex flex-wrap items-start gap-7 p-4">
      <EditeurEcriture />
      <X1DansLaColonne />
      <X2EnModale />
      <E1EnLigne />
      <E2ParLaBoite />
      <LectureSeule />
    </div>
  )
}

/* ================================================================== tour 4 ===
 *
 * Idée de Tim, en cours de tour : **le panneau droit peut aussi porter des vues
 * qu'on se fabrique**. C'est ce qui a fait Obsidian — le panneau latéral y est un
 * emplacement, pas une liste fermée.
 *
 * Ça n'entre pas en conflit avec la coque : la règle arrêtée est « les vues portent leur
 * nom tant qu'il y a la place », pas « il y a cinq vues ». Mais ça pose trois questions
 * neuves : **où** les vues faites maison se posent dans la bande, **à quoi** elles sont
 * attachées (partout, au contexte, à la note), et **d'où** elles naissent.
 */

const VUES_CUSTOM = [
  { label: 'Idées orphelines', icone: <ListFilter size={14} />, detail: 'Idées · sans lien entrant · > 30 j', n: 7 },
  { label: 'Mémoire longue', icone: <Pin size={14} />, detail: 'chantier épinglé · 5 notes', n: 5 },
  { label: 'Veille à trier', icone: <Table2 size={14} />, detail: 'Veille · tableau par source', n: 23 },
]

const ORPHELINES = [
  { titre: 'Un projet par dossier', quand: '4 juillet', mots: 320 },
  { titre: 'Trois contextes, une coque', quand: 'jeudi', mots: 540 },
  { titre: 'Xérès — la solera', quand: '11 h 55', mots: 180 },
  { titre: 'Nommer les lieux', quand: '2 septembre', mots: 210 },
  { titre: 'Ce que coûte un index', quand: '18 août', mots: 95 },
]

function CadrePanneau({ id, titre, note, largeur = 'w-[22rem]', hauteur = 'h-[26rem]', children }: {
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

/** C1 — les vues faites maison s'ajoutent à la bande, après un second trait. */
function C1ALaSuite() {
  return (
    <CadrePanneau
      id="vues-c1-a-la-suite"
      titre="C1 · à la suite — un second trait, puis les vues à soi"
      note="La bande se lit en trois temps : les vues du contexte, Agent, puis ce qu’on s’est fabriqué. Un seul clic pour chacune, et le `+` au bout en ajoute. Ce que ça coûte : sept icônes dans 22 rem, et rien n’empêche d’en poser douze — la bande déborderait sans qu’on l’ait décidé."
    >
      <BandeSavoir actif="Idées orphelines" fin={<>
        <span className="mx-1 h-5 w-px shrink-0 bg-line" />
        {VUES_CUSTOM.map((vue) => (
          <span key={vue.label} className={cx(
            'flex size-8 shrink-0 items-center justify-center rounded-md',
            vue.label === 'Idées orphelines' ? 'bg-accent-wash text-accent' : 'text-ink-soft',
          )}>{vue.icone}</span>
        ))}
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md text-ink-faint"><Plus size={14} /></span>
      </>} />
      <div className="min-h-0 flex-1 px-2.5 py-2">
        <div className="mb-1.5 flex items-center gap-1.5 px-1.5">
          <ListFilter size={12} className="text-ink-faint" />
          <span className="flex-1 truncate text-micro font-semibold tracking-wide text-ink-faint uppercase">Idées orphelines</span>
          <Count>7</Count>
        </div>
        <div className="mb-2 px-1.5 text-micro text-ink-faint">Idées · sans lien entrant · pas touchées depuis 30 j</div>
        <div className="flex flex-col gap-0.5">
          {ORPHELINES.map((note) => (
            <div key={note.titre} className="flex h-7 items-center gap-2 rounded-md px-1.5">
              <FileText size={11} className="shrink-0 text-ink-faint" />
              <span className="min-w-0 flex-1 truncate text-xs text-ink-soft">{note.titre}</span>
              <span className="shrink-0 text-micro tabular-nums text-ink-faint">{note.quand}</span>
            </div>
          ))}
        </div>
      </div>
    </CadrePanneau>
  )
}

/** C2 — une seule vue de plus, « Vues », qui contient toutes les autres. */
function C2MenuVues() {
  return (
    <CadrePanneau
      id="vues-c2-menu-vues"
      titre="C2 · une porte — « Vues » les contient toutes"
      note="Une icône de plus, et jamais davantage : on entre dans *Vues*, on choisit, la vue prend le panneau et une flèche ramène à la liste. Ça tient avec trois vues comme avec trente, et la bande ne bouge plus jamais. Ce que ça coûte : un clic à chaque fois, pour celles qu’on ouvre dix fois par jour."
    >
      <BandeSavoir actif="Vues" fin={<>
        <span className="mx-1 h-5 w-px shrink-0 bg-line" />
        <span className="flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-accent-wash px-2.5 text-xs font-medium text-accent"><LayoutList size={14} />Vues</span>
      </>} />
      <div className="min-h-0 flex-1 px-2.5 py-2">
        <div className="mb-1.5 flex items-center gap-1.5 px-1.5">
          <span className="flex-1 text-micro font-semibold tracking-wide text-ink-faint uppercase">Mes vues</span>
          <Plus size={12} className="text-ink-faint" />
        </div>
        <div className="flex flex-col gap-0.5">
          {VUES_CUSTOM.map((vue) => (
            <div key={vue.label} className="flex items-center gap-2 rounded-md px-1.5 py-1.5">
              <span className="shrink-0 text-ink-faint">{vue.icone}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium text-ink">{vue.label}</span>
                <span className="block truncate text-micro text-ink-faint">{vue.detail}</span>
              </span>
              <span className="shrink-0 text-micro tabular-nums text-ink-faint">{vue.n}</span>
            </div>
          ))}
        </div>
        <div className="mt-3 mb-1.5 px-1.5 text-micro font-semibold tracking-wide text-ink-faint uppercase">Partagées par le projet</div>
        <div className="flex items-center gap-2 rounded-md px-1.5 py-1.5">
          <Table2 size={14} className="shrink-0 text-ink-faint" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-medium text-ink">Décisions à relire</span>
            <span className="block truncate text-micro text-ink-faint">tag #décision · sans relecture</span>
          </span>
          <span className="shrink-0 text-micro tabular-nums text-ink-faint">4</span>
        </div>
      </div>
    </CadrePanneau>
  )
}

/** C3 — la bande porte les épinglées ; le reste vit dans le « + ». */
function C3Epinglees() {
  return (
    <CadrePanneau
      id="vues-c3-epinglees"
      titre="C3 · épinglées — deux au plus dans la bande, le reste dans le « + »"
      note="Le compromis, et le modèle d’un navigateur : ce qu’on ouvre tout le temps est épinglé et coûte un clic ; le reste est à deux clics dans le `+`, qui sert aussi à créer. La borne est explicite — deux épingles — donc la bande ne peut pas enfler toute seule, ce que C1 ne garantit pas."
    >
      <BandeSavoir actif="Idées orphelines" fin={<>
        <span className="mx-1 h-5 w-px shrink-0 bg-line" />
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-accent-wash text-accent"><ListFilter size={14} /></span>
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md text-ink-soft"><Pin size={14} /></span>
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md text-ink-faint"><Plus size={14} /></span>
      </>} />
      <div className="relative min-h-0 flex-1 px-2.5 py-2">
        <div className="mb-1.5 flex items-center gap-1.5 px-1.5">
          <ListFilter size={12} className="text-ink-faint" />
          <span className="flex-1 truncate text-micro font-semibold tracking-wide text-ink-faint uppercase">Idées orphelines</span>
          <Count>7</Count>
        </div>
        <div className="flex flex-col gap-0.5 opacity-40">
          {ORPHELINES.slice(0, 3).map((note) => (
            <div key={note.titre} className="flex h-7 items-center gap-2 rounded-md px-1.5">
              <FileText size={11} className="shrink-0 text-ink-faint" />
              <span className="min-w-0 flex-1 truncate text-xs text-ink-soft">{note.titre}</span>
            </div>
          ))}
        </div>
        <div className="absolute top-1 right-2 w-[16rem] overflow-hidden rounded-lg border border-line bg-surface shadow-float">
          <div className="px-2.5 py-1.5 text-micro font-semibold tracking-wide text-ink-faint uppercase">Vues à soi</div>
          {VUES_CUSTOM.map((vue) => (
            <div key={vue.label} className="flex items-center gap-2 px-2.5 py-1.5">
              <span className="shrink-0 text-ink-faint">{vue.icone}</span>
              <span className="min-w-0 flex-1 truncate text-xs text-ink">{vue.label}</span>
              <Pin size={11} className={cx('shrink-0', vue.label === 'Veille à trier' ? 'text-ink-faint/40' : 'text-accent')} />
            </div>
          ))}
          <div className="flex items-center gap-2 border-t border-line px-2.5 py-1.5">
            <Plus size={12} className="shrink-0 text-ink-faint" />
            <span className="min-w-0 flex-1 truncate text-xs text-ink-soft">Nouvelle vue…</span>
          </div>
        </div>
      </div>
    </CadrePanneau>
  )
}

/** Ce qu'une vue est vraiment : une requête enregistrée, et son résultat. */
function VueRequete() {
  return (
    <CadrePanneau
      id="vue-requete"
      titre="4 · Ce qu’une vue contient — une requête, et son résultat"
      note="Une vue est une **recherche enregistrée** : dossier, état de l’index, âge, tag. Elle se relit en une ligne au-dessus du résultat, et le `⚙` la rouvre. C’est aussi ce qui la rend sûre : une vue ne stocke rien, elle recalcule — l’index étant dérivé, une vue l’est aussi, et aucune ne peut mentir sur l’état du vault."
    >
      <BandeSavoir actif="Idées orphelines" fin={<>
        <span className="mx-1 h-5 w-px shrink-0 bg-line" />
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-accent-wash text-accent"><ListFilter size={14} /></span>
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md text-ink-faint"><Plus size={14} /></span>
      </>} />
      <div className="min-h-0 flex-1 px-2.5 py-2">
        <div className="mb-1.5 flex items-center gap-1.5 px-1.5">
          <span className="flex-1 truncate text-xs font-semibold text-ink">Idées orphelines</span>
          <Count>7</Count>
          <SlidersHorizontal size={12} className="text-ink-faint" />
        </div>
        <div className="mb-2 flex flex-wrap gap-1 px-1.5">
          {['dossier : Idées', 'sans lien entrant', 'âge > 30 j'].map((critere) => (
            <span key={critere} className="flex h-5 items-center rounded-full bg-surface-high px-2 text-micro text-ink-soft">{critere}</span>
          ))}
        </div>
        <div className="flex flex-col gap-0.5">
          {ORPHELINES.map((note) => (
            <div key={note.titre} className="flex items-center gap-2 rounded-md px-1.5 py-1.5">
              <FileText size={11} className="shrink-0 text-ink-faint" />
              <span className="min-w-0 flex-1 truncate text-xs text-ink">{note.titre}</span>
              <span className="shrink-0 text-micro tabular-nums text-ink-faint">{note.mots} mots</span>
              <span className="w-[4rem] shrink-0 text-right text-micro text-ink-faint">{note.quand}</span>
            </div>
          ))}
        </div>
        <div className="mt-2 flex items-center gap-1.5 px-1.5">
          <Geste premier>Tout lier à un chantier</Geste>
          <Geste>Exporter</Geste>
        </div>
      </div>
    </CadrePanneau>
  )
}

/** La vue la plus demandée : lire une note pendant qu'on en écrit une autre. */
function VueNoteEpinglee() {
  return (
    <CadreEcran
      id="vue-note-epinglee"
      titre="5 · La vue qu’on veut vraiment — lire une note en en écrivant une autre"
      note="C’est l’usage qui a fait le panneau latéral d’Obsidian, et il ne demande aucune mécanique de requête : on épingle une note dans le panneau, et on écrit contre elle. Conséquence à assumer : le panneau doit savoir afficher une note, donc il hérite d’une partie de l’éditeur — en lecture, sans curseur, mais avec les `[[liens]]` cliquables."
    >
      <div className="flex min-w-0 flex-1 flex-col"><BarreNote /><CorpsNote /></div>
      <div className="flex w-[22rem] shrink-0 flex-col border-l border-line">
        <BandeSavoir actif="épinglée" fin={<>
          <span className="mx-1 h-5 w-px shrink-0 bg-line" />
          <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-accent-wash text-accent"><Pin size={14} /></span>
          <span className="flex size-8 shrink-0 items-center justify-center rounded-md text-ink-faint"><Plus size={14} /></span>
        </>} />
        <div className="min-h-0 flex-1 overflow-hidden px-3 py-2.5">
          <div className="mb-2 flex items-center gap-1.5">
            <FileText size={12} className="shrink-0 text-ink-faint" />
            <span className="min-w-0 flex-1 truncate text-xs font-semibold text-ink">Mémoire des agents — état de l’art</span>
            <Pin size={11} className="shrink-0 text-accent" />
          </div>
          <div className="flex flex-col gap-2 text-micro leading-relaxed text-ink-soft">
            <p>{PASSAGE}</p>
            <p>Letta résume à chaque tour : court et faux dès que le sujet se ramifie.</p>
            <p>Zep tient un graphe d’entités — proche de ce que <span className="text-accent">[[Vault : git plutôt que Drive]]</span> appelle un index dérivé.</p>
            <p>mem0 extrait des faits ; reste la question de qui les révoque.</p>
          </div>
          <div className="mt-3 flex items-center gap-1.5 border-t border-line pt-2 text-micro text-ink-faint">
            <BookOpen size={11} />Veille · hier<span className="ml-auto">ouvrir au centre ↗</span>
          </div>
        </div>
      </div>
    </CadreEcran>
  )
}

/** D'où une vue naît : de la recherche, jamais d'un formulaire vide. */
function VueCreer() {
  return (
    <CadrePanneau
      id="vue-creer"
      titre="6 · D’où une vue naît — on cherche, puis on enregistre"
      largeur="w-[30rem]"
      hauteur="h-[22rem]"
      note="Aucun formulaire vide : on cherche dans le vault, on affine, et quand la recherche sert deux fois on l’enregistre. C’est le chemin de Linear et de Mail, et il évite d’avoir à expliquer ce qu’est une vue — on en a déjà une sous les yeux avant de la nommer. La modale ne demande que trois choses : un nom, une icône, et où la vue vit."
    >
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line px-3">
        <Search size={14} className="shrink-0 text-ink-faint" />
        <span className="flex-1 text-xs text-ink">dossier:Idées sans-lien-entrant âge&gt;30j</span>
        <span className="flex h-6 items-center gap-1.5 rounded-md border border-line px-2 text-micro text-ink-soft"><Bookmark size={11} />Enregistrer comme vue</span>
      </div>
      <div className="relative min-h-0 flex-1 px-3 py-2.5">
        <div className="flex flex-col gap-0.5 opacity-40">
          {ORPHELINES.slice(0, 4).map((note) => (
            <div key={note.titre} className="flex h-7 items-center gap-2 rounded-md px-1.5">
              <FileText size={11} className="shrink-0 text-ink-faint" />
              <span className="min-w-0 flex-1 truncate text-xs text-ink-soft">{note.titre}</span>
            </div>
          ))}
        </div>
        <div className="absolute inset-0 flex items-center justify-center bg-ink/10">
          <div className="surface w-[22rem] rounded-xl border border-line px-4 py-3 shadow-float">
            <div className="flex items-center gap-2">
              <Bookmark size={14} className="text-ink-faint" />
              <span className="flex-1 text-sm font-semibold text-ink">Enregistrer comme vue</span>
              <X size={13} className="text-ink-faint" />
            </div>
            <div className="mt-3 flex items-center gap-2">
              <span className="flex size-8 items-center justify-center rounded-md border border-line text-ink-soft"><ListFilter size={14} /></span>
              <span className="flex h-8 flex-1 items-center rounded-md border border-line px-2.5 text-xs text-ink">Idées orphelines</span>
            </div>
            <div className="mt-3 text-micro font-semibold tracking-wide text-ink-faint uppercase">Où elle vit</div>
            <div className="mt-1.5 flex flex-col gap-1">
              {[
                { label: 'Dans le Savoir', detail: 'présente dès qu’une note est ouverte', actif: true },
                { label: 'Partout', detail: 'aussi dans un projet et sur un fil libre', actif: false },
                { label: 'Sur cette note', detail: 'elle s’en va quand on la ferme', actif: false },
              ].map((choix) => (
                <div key={choix.label} className={cx(
                  'flex items-center gap-2 rounded-md px-2 py-1.5',
                  choix.actif && 'bg-accent-wash',
                )}>
                  <span className={cx('size-3 shrink-0 rounded-full border', choix.actif ? 'border-accent bg-accent' : 'border-line')} />
                  <span className="min-w-0 flex-1">
                    <span className={cx('block truncate text-xs', choix.actif ? 'font-medium text-ink' : 'text-ink-soft')}>{choix.label}</span>
                    <span className="block truncate text-micro text-ink-faint">{choix.detail}</span>
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-3 flex items-center gap-1.5">
              <Geste premier>Enregistrer</Geste>
              <Geste>Annuler</Geste>
            </div>
          </div>
        </div>
      </div>
    </CadrePanneau>
  )
}

export function VaultTour4() {
  return (
    <div className="flex flex-wrap items-start gap-7 p-4">
      <C1ALaSuite />
      <C2MenuVues />
      <C3Epinglees />
      <VueRequete />
      <VueNoteEpinglee />
      <VueCreer />
    </div>
  )
}

/* ================================================================== tour 5 ===
 *
 * Trois décisions de Tim, et une demande neuve :
 *   — **pas de modale** : le rapprochement se déplie sur place (X1), pas en modale (X2) ;
 *   — **le passage proposé reste dans le panneau** (E2), pas en ligne dans le texte ;
 *   — **C1** pour les vues à soi : à la suite dans la bande, après un second trait ;
 *   — les vues partagées entre un projet et le Savoir : **non**, on verra au besoin.
 *
 * La demande neuve : **créer d'autres notes, et parcourir le vault**. La colonne de
 * gauche est arrêtée sur un état, pas un arbre — « l'arbre complet reste atteignable, il
 * n'est pas la porte d'entrée ». Reste à dire *par où*, et le panneau est le candidat
 * évident : en Travail il porte déjà *Fichiers*, l'arbre du dépôt.
 */

const ARBRE_IDEES = [
  { titre: 'Vault : git plutôt que Drive', liens: 6, quand: 'hier' },
  { titre: 'Trois contextes, une coque', liens: 3, quand: 'jeudi' },
  { titre: 'Un projet par dossier', liens: 0, quand: '4 juillet' },
  { titre: 'Mémoire longue — chantier', liens: 5, quand: 'hier' },
]

const PARCOURIR = [
  { titre: 'Vault : git plutôt que Drive', dossier: 'Idées', entrants: 6, mots: 740, quand: 'hier' },
  { titre: 'Mémoire des agents — état de l’art', dossier: 'Veille', entrants: 12, mots: 1840, quand: 'hier' },
  { titre: 'Mémoire & contexte', dossier: 'Veille', entrants: 28, mots: 960, quand: '12 mars' },
  { titre: 'Trois contextes, une coque', dossier: 'Idées', entrants: 3, mots: 540, quand: 'jeudi' },
  { titre: 'Solera — carnet de bord', dossier: 'Journal', entrants: 41, mots: 2300, quand: 'mercredi' },
  { titre: 'Un projet par dossier', dossier: 'Idées', entrants: 0, mots: 320, quand: '4 juillet' },
]

/** La vue *Notes* : l'arbre du vault dans le panneau, comme *Fichiers* en Travail. */
function VueNotes({ creation = false }: { creation?: boolean }) {
  return (
    <div className="min-h-0 flex-1 overflow-hidden px-2 py-2">
      <div className="mb-2 flex items-center gap-1.5">
        <span className="flex h-7 flex-1 items-center gap-1.5 rounded-md border border-line px-2 text-micro text-ink-faint"><Search size={11} />Chercher une note</span>
        <span className="flex size-7 items-center justify-center rounded-md text-ink-faint"><Plus size={13} /></span>
      </div>
      <div className="mb-1 px-1.5 text-micro font-semibold tracking-wide text-ink-faint uppercase">Récentes</div>
      {REPRENDRE.slice(0, 2).map((note) => (
        <div key={note.titre} className="flex h-7 items-center gap-2 rounded-md px-1.5">
          <FileText size={11} className="shrink-0 text-ink-faint" />
          <span className="min-w-0 flex-1 truncate text-xs text-ink-soft">{note.titre}</span>
        </div>
      ))}
      <div className="mt-2 mb-1 px-1.5 text-micro font-semibold tracking-wide text-ink-faint uppercase">Tout le vault</div>
      {DOSSIERS.map((dossier) => (
        <div key={dossier.label}>
          <div className={cx('flex h-7 items-center gap-1.5 rounded-md px-1.5', dossier.label === 'Idées' && 'bg-surface-high')}>
            {dossier.label === 'Idées'
              ? <><ChevronDown size={12} className="shrink-0 text-ink-faint" /><FolderOpen size={12} className="shrink-0 text-ink-faint" /></>
              : <><ChevronRight size={12} className="shrink-0 text-ink-faint" /><Folder size={12} className="shrink-0 text-ink-faint" /></>}
            <span className="min-w-0 flex-1 truncate text-xs text-ink">{dossier.label}</span>
            <Bouclier droit={dossier.droit} size={11} />
            <span className="shrink-0 text-micro tabular-nums text-ink-faint">{dossier.count}</span>
          </div>
          {dossier.label === 'Idées' ? (
            <>
              {creation ? (
                <div className="my-0.5 ml-5 flex h-7 items-center gap-2 rounded-md border border-accent bg-accent-wash/40 px-1.5">
                  <FileText size={11} className="shrink-0 text-accent" />
                  <span className="min-w-0 flex-1 truncate text-xs text-ink">Mémoire longue — ce qui manque<span className="ml-px inline-block h-3.5 w-px translate-y-0.5 bg-accent" /></span>
                  <span className="shrink-0 text-micro text-ink-faint">↵</span>
                </div>
              ) : null}
              {ARBRE_IDEES.map((note) => (
                <div key={note.titre} className="ml-5 flex h-7 items-center gap-2 rounded-md px-1.5">
                  <FileText size={11} className="shrink-0 text-ink-faint" />
                  <span className="min-w-0 flex-1 truncate text-xs text-ink-soft">{note.titre}</span>
                  {note.liens === 0 ? <Link2Off size={10} className="shrink-0 text-ink-faint" /> : null}
                  <span className="shrink-0 text-micro tabular-nums text-ink-faint">{note.liens}</span>
                </div>
              ))}
            </>
          ) : null}
        </div>
      ))}
    </div>
  )
}

/** La bande du Savoir une fois *Notes* ajoutée : quatre vues, Agent, puis les vues à soi. */
function BandeComplete({ actif, custom = 3, replie = false }: { actif: string; custom?: number; replie?: boolean }) {
  const vues: Vue[] = [
    { label: 'Notes', icone: <FolderTree size={14} /> },
    { label: 'Rapprochements', icone: <Waypoints size={14} /> },
    { label: 'Liens', icone: <Link2 size={14} /> },
    { label: 'Historique', icone: <History size={14} /> },
  ]
  return (
    <Bande
      actif={actif}
      compact
      vues={vues}
      apart={{ label: 'Agent', icone: <Bot size={14} /> }}
      fin={<>
        <span className="mx-1 h-5 w-px shrink-0 bg-line" />
        {replie ? (
          <span className="flex h-8 shrink-0 items-center gap-0.5 rounded-md px-1.5 text-micro text-ink-soft"><Star size={13} />{custom}<ChevronDown size={11} /></span>
        ) : (
          VUES_CUSTOM.slice(0, custom).map((vue) => (
            <span key={vue.label} className={cx(
              'flex size-8 shrink-0 items-center justify-center rounded-md',
              vue.label === actif ? 'bg-accent-wash text-accent' : 'text-ink-soft',
            )}>{vue.icone}</span>
          ))
        )}
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md text-ink-faint"><Plus size={14} /></span>
      </>}
    />
  )
}

function N1PanneauNotes() {
  return (
    <CadrePanneau
      id="naviguer-n1-vue-notes"
      titre="1 · N1 — parcourir depuis le panneau, comme *Fichiers* en Travail"
      hauteur="h-[30rem]"
      note="La grammaire existe déjà : en Travail le panneau porte l’arbre du dépôt, en Savoir il porte celui du vault. Chaque dossier montre son droit, chaque note son nombre de liens entrants — et zéro s’affiche en icône barrée, parce que c’est la seule valeur qui demande une action. Le `+` crée dans le dossier ouvert. La colonne de gauche reste ce qu’elle est : un état, pas un arbre."
    >
      <BandeComplete actif="Notes" replie />
      <VueNotes />
    </CadrePanneau>
  )
}

function N2PageParcourir() {
  return (
    <Bloc
      id="naviguer-n2-page-parcourir"
      titre="2 · N2 — parcourir au centre, quand on range plutôt qu’on écrit"
      note="L’arbre d’un panneau de 20 rem ne montre qu’un titre tronqué ; ranger deux cents notes demande des colonnes qu’on trie. Cette page est ce que « tout parcourir ↗ » ouvre depuis la page du vault. Les deux ne s’opposent pas : le panneau sert pendant qu’on écrit, la page quand on fait le ménage — et c’est la même distinction qu’entre l’arbre des fichiers et une recherche en Travail."
    >
      <div className="px-5 py-4">
        <div className="mb-3 flex items-center gap-2.5">
          <BookOpen size={16} className="text-ink-faint" />
          <span className="text-sm text-ink-faint">Savoir</span>
          <ChevronRight size={13} className="text-ink-faint" />
          <span className="text-sm font-semibold text-ink">Parcourir</span>
          <span className="text-micro text-ink-faint">264 notes</span>
          <span className="ml-auto flex items-center gap-1">
            <span className="flex h-7 items-center gap-1.5 rounded-md border border-line px-2 text-xs text-ink-soft"><ArrowUpDown size={12} />Liens entrants</span>
            <span className="flex h-7 items-center gap-1.5 rounded-md border border-line px-2 text-xs text-ink-soft"><ListFilter size={12} />Filtrer</span>
            <span className="flex h-7 items-center gap-1.5 rounded-md border border-line px-2 text-xs text-ink-soft"><Plus size={13} />Note</span>
          </span>
        </div>
        <div className="flex h-7 items-center gap-3 border-b border-line px-2 text-micro font-semibold tracking-wide text-ink-faint uppercase">
          <span className="flex-1">Note</span>
          <span className="w-20">Dossier</span>
          <span className="w-20 text-right">Entrants</span>
          <span className="w-16 text-right">Mots</span>
          <span className="w-24 text-right">Touchée</span>
        </div>
        {PARCOURIR.map((note) => (
          <div key={note.titre} className="flex h-9 items-center gap-3 rounded-md px-2 text-sm hover:bg-surface-high">
            <span className="flex min-w-0 flex-1 items-center gap-2">
              <FileText size={12} className="shrink-0 text-ink-faint" />
              <span className="min-w-0 truncate text-ink">{note.titre}</span>
            </span>
            <span className="w-20 truncate text-micro text-ink-soft">{note.dossier}</span>
            <span className={cx('w-20 text-right text-micro tabular-nums', note.entrants === 0 ? 'text-caution' : 'text-ink-faint')}>{note.entrants}</span>
            <span className="w-16 text-right text-micro tabular-nums text-ink-faint">{note.mots}</span>
            <span className="w-24 text-right text-micro text-ink-faint">{note.quand}</span>
          </div>
        ))}
      </div>
    </Bloc>
  )
}

/* -------------------------------------------- créer une note, deux chemins -- */

function CreerDansLArbre() {
  return (
    <CadrePanneau
      id="creer-k1-dans-l-arbre"
      titre="3 · K1 — créer dans un dossier : le titre se tape dans l’arbre"
      hauteur="h-[30rem]"
      note="On sait où l’on range avant d’écrire : le `+` crée dans le dossier ouvert, le titre se tape sur place, `↵` ouvre la note au centre. C’est le chemin de celui qui range en écrivant — et il hérite du droit du dossier sans qu’on ait à y penser."
    >
      <BandeComplete actif="Notes" replie />
      <VueNotes creation />
    </CadrePanneau>
  )
}

function CreerEbauche() {
  return (
    <CadreEcran
      id="creer-k2-ebauche"
      titre="4 · K2 — créer sans ranger : la note naît en ébauche"
      largeur="w-[46rem]"
      hauteur="h-[24rem]"
      note="Le pendant exact du fil sans projet : on écrit d’abord, on range après — et **ne jamais ranger reste valable**. La note vit dans *Ébauches*, que la page du vault compte déjà, et son bandeau porte le seul geste qui manque : lui donner un dossier, donc un droit. Tant qu’elle est là, aucun agent ne la voit : une ébauche est à soi."
    >
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-[var(--header-height)] shrink-0 items-center gap-2.5 border-b border-line px-3">
          <FileText size={16} className="shrink-0 text-ink-faint" />
          <span className="min-w-0">
            <span className="flex items-center gap-1 text-micro text-ink-faint"><SquarePen size={10} />Ébauche</span>
            <span className="block truncate text-sm font-medium text-ink">Sans titre</span>
          </span>
          <span className="ml-auto flex items-center gap-1.5">
            <span className="flex h-6 items-center gap-1.5 rounded-full bg-surface-high px-2 text-micro text-ink-soft"><FolderTree size={11} />Ranger…</span>
            <Ico><PanelRight size={15} /></Ico>
          </span>
        </div>
        <div className="flex h-8 shrink-0 items-center gap-2 border-b border-line bg-surface-high/50 px-3 text-micro text-ink-faint">
          <SquarePen size={11} />
          <span className="flex-1">Ébauche — dans aucun dossier, donc invisible aux agents. Elle le restera tant qu’on ne la range pas.</span>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden px-8 py-5">
          <div className="mx-auto flex max-w-[34rem] flex-col gap-3 text-sm leading-relaxed">
            <h3 className="text-lg font-semibold tracking-tight text-ink-faint">Sans titre</h3>
            <p className="text-ink">Ce qui manque entre les cinq notes sur la mémoire longue, c’est la question elle-même : qu’est-ce qu’un agent doit oublier ?<span className="ml-px inline-block h-4 w-px translate-y-0.5 bg-accent" /></p>
          </div>
        </div>
      </div>
    </CadreEcran>
  )
}

/* ------------------------------ la bande C1 une fois tout le monde dedans --- */

function BandeQuiDeborde() {
  return (
    <section data-proto="bande-c1-la-place" data-shot="bande-c1-la-place" className="flex w-[34rem] flex-col gap-1.5">
      <h2 className="text-sm font-semibold text-ink">5 · C1 à l’épreuve de la place — et ce qui se replie en premier</h2>
      <div className="flex flex-col gap-3">
        {[
          { label: 'Panneau à 26 rem — tout tient : quatre vues, Agent, trois vues à soi, le « + »', largeur: 'w-[26rem]', replie: false, custom: 3 },
          { label: 'Panneau à 20 rem — les vues à soi se replient sous un bouton, jamais les vues du contexte', largeur: 'w-[20rem]', replie: true, custom: 3 },
        ].map((cas) => (
          <div key={cas.label} className="flex flex-col gap-1">
            <span className="text-micro text-ink-faint">{cas.label}</span>
            <div className={cx('surface overflow-hidden rounded-xl border border-line shadow-float', cas.largeur)}>
              <BandeComplete actif="Rapprochements" custom={cas.custom} replie={cas.replie} />
              <div className="flex flex-col gap-1.5 px-3 py-2.5">
                {[1, 0.75, 0.9].map((part, index) => (
                  <span key={index} className="h-2 rounded-full bg-surface-high" style={{ width: `${part * 100}%` }} />
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
      <p className="text-micro leading-relaxed text-ink-faint">
        C1 est retenu, mais la bande compte désormais quatre vues du contexte plus Agent, et les vues à soi s’ajoutent après. À 26 rem tout tient ; en dessous, **ce sont les vues à soi qui se replient**, sous un bouton qui dit leur nombre — jamais les vues du contexte, qui sont les mêmes pour tout le monde et doivent rester au même endroit. C’est la mécanique du « Plus » de la colonne (tour 10) : elle n’apparaît que si la liste déborde.
      </p>
    </section>
  )
}

/* ------------------------------------------- l'écran entier, une fois posé -- */

function LigneColonne({ icone, children, actif = false, fin, retrait = false }: {
  icone?: ReactNode
  children: ReactNode
  actif?: boolean
  fin?: ReactNode
  retrait?: boolean
}) {
  return (
    <div className={cx(
      'flex h-8 items-center gap-2 rounded-md pr-1 text-sm',
      retrait ? 'pl-5' : 'pl-1.5',
      actif ? 'bg-accent-wash text-ink' : 'text-ink-soft',
    )}>
      {icone ? <span className="flex size-4 shrink-0 items-center justify-center text-ink-faint">{icone}</span> : null}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {fin}
    </div>
  )
}

function EcranEntier() {
  return (
    <section data-proto="ecran-savoir-entier" data-shot="ecran-savoir-entier" className="flex w-[76rem] flex-col gap-1.5">
      <h2 className="text-sm font-semibold text-ink">6 · L’écran entier — une fois tout posé, sans modale</h2>
      <div className="surface flex h-[34rem] overflow-hidden rounded-xl border border-line shadow-float">
        <div className="flex w-[17rem] shrink-0 flex-col border-r border-line">
          <div className="flex h-[var(--header-height)] shrink-0 items-center gap-2 border-b border-line px-3">
            <span className="size-5 rounded-full bg-accent" />
            <span className="flex-1 text-sm font-semibold text-ink">Solera</span>
            <Ico><PanelLeftClose size={15} /></Ico>
          </div>
          <div className="shrink-0 px-1 py-1">
            <LigneColonne icone={<Search size={14} />} fin={<span className="rounded border border-line px-1 text-micro text-ink-faint">Ctrl K</span>}>Rechercher</LigneColonne>
            <LigneColonne icone={<Plus size={15} />}>Nouvelle conversation</LigneColonne>
          </div>
          <div className="shrink-0 border-y border-line px-1 py-1">
            <LigneColonne icone={<MessagesSquare size={15} />} fin={<span className="pr-1 text-micro tabular-nums text-ink-faint">12</span>}>Fils</LigneColonne>
            <LigneColonne icone={<SquareKanban size={15} />}>Projets</LigneColonne>
            <LigneColonne icone={<BookOpen size={15} />} actif fin={<Count tone="caution">2</Count>}>Savoir</LigneColonne>
            <LigneColonne icone={<CalendarClock size={15} />} fin={<span className="pr-1 text-micro tabular-nums text-ink-faint">4</span>}>Planifiées</LigneColonne>
          </div>
          <div className="min-h-0 flex-1 overflow-hidden p-1">
            <LigneColonne icone={<Inbox size={14} />} fin={<Count tone="caution">2</Count>}>Boîte des agents</LigneColonne>
            <LigneColonne icone={<SquarePen size={13} />} fin={<span className="pr-1 text-micro tabular-nums text-ink-faint">5</span>}>Ébauches</LigneColonne>
            <LigneColonne icone={<Link2Off size={13} />} fin={<span className="pr-1 text-micro tabular-nums text-ink-faint">9</span>}>Sans lien entrant</LigneColonne>
            <div className="mt-1 flex h-8 items-center gap-1 pr-1 pl-1.5">
              <ChevronDown size={13} className="shrink-0 text-ink-faint" />
              <span className="flex-1 text-meta font-semibold tracking-wide text-ink-faint uppercase">Récentes</span>
            </div>
            {REPRENDRE.slice(0, 3).map((note) => (
              <LigneColonne key={note.titre} icone={<FileText size={13} />} retrait>{note.titre}</LigneColonne>
            ))}
            <div className="mt-1 flex h-8 items-center gap-1 pr-1 pl-1.5">
              <ChevronDown size={13} className="shrink-0 text-ink-faint" />
              <span className="flex-1 text-meta font-semibold tracking-wide text-ink-faint uppercase">Dossiers</span>
            </div>
            {DOSSIERS.map((dossier) => (
              <LigneColonne
                key={dossier.label}
                icone={<ChevronRight size={13} />}
                retrait
                fin={<span className="flex shrink-0 items-center gap-1.5 pr-1"><Bouclier droit={dossier.droit} /><span className="text-micro tabular-nums text-ink-faint">{dossier.count}</span></span>}
              >
                {dossier.label}
              </LigneColonne>
            ))}
          </div>
          <div className="flex h-11 shrink-0 items-center gap-2 border-t border-line px-3">
            <span className="flex size-5 items-center justify-center rounded-full bg-accent-wash text-micro font-semibold text-accent">T</span>
            <span className="flex-1 text-sm text-ink-soft">Tim</span>
            <ChevronDown size={13} className="text-ink-faint" />
          </div>
        </div>
        <div className="flex min-w-0 flex-1 flex-col"><BarreNote /><CorpsNote /></div>
        <div className="flex w-[26rem] shrink-0 flex-col border-l border-line">
          <BandeComplete actif="Rapprochements" />
          <div className="min-h-0 flex-1 overflow-hidden px-2.5 py-2">
            <div className="mb-1.5 flex items-center gap-1.5 px-1.5">
              <span className="flex-1 text-micro font-semibold tracking-wide text-ink-faint uppercase">Depuis cette note</span>
              <Count tone="accent">4</Count>
            </div>
            <ListeR3 ouvert={0} />
          </div>
        </div>
      </div>
      <p className="text-micro leading-relaxed text-ink-faint">
        Un écran entier, une fois seulement : pour vérifier que les trois zones tiennent ensemble. La colonne est celle du tour 11 et ne change pas. Le centre est la note, en largeur de lecture. Le panneau porte les rapprochements, le premier déplié **sur place** — aucune modale nulle part, ni ici ni pour un passage proposé, qui attend lui aussi dans le panneau.
      </p>
    </section>
  )
}

export function VaultTour5() {
  return (
    <div className="flex flex-wrap items-start gap-7 p-4">
      <N1PanneauNotes />
      <N2PageParcourir />
      <CreerDansLArbre />
      <CreerEbauche />
      <BandeQuiDeborde />
      <EcranEntier />
    </div>
  )
}

/* ================================================================== tour 6 ===
 *
 * La question laissée ouverte depuis le tour 9 de la carte #8 : une conversation qui
 * écrit dans le vault, **capacité** (α) ou **rattachement** (β) ? Tim penche pour β.
 *
 * Elle se repose mieux aujourd'hui qu'alors, parce que le Savoir a gagné entre-temps une
 * page, un panneau et une zone basse : il y a maintenant un endroit où montrer des fils
 * du vault **sans leur donner un domicile**. D'où une troisième lecture, γ.
 */

const FILS_VAULT = [
  { titre: 'Comparer deux formats de vault', agent: 'claude' as const, etat: 'tourne' },
  { titre: 'Fact-check — solera et xérès', agent: 'claude' as const, etat: 'lu' },
]

const FIL_MIXTE = { titre: 'Indexation du vault — niveau 2', agent: 'codex' as const }

function ColonneCadre({ id, titre, note, children }: { id: string; titre: string; note: string; children: ReactNode }) {
  return (
    <section data-proto={id} data-shot={id} className="flex w-[21rem] flex-col gap-1.5">
      <h2 className="text-sm font-semibold text-ink">{titre}</h2>
      <div className="surface flex flex-col overflow-hidden rounded-xl border border-line shadow-float">{children}</div>
      <p className="text-micro leading-relaxed text-ink-faint">{note}</p>
    </section>
  )
}

function TitreGroupe({ children, fin }: { children: ReactNode; fin?: ReactNode }) {
  return (
    <div className="flex h-8 items-center gap-1 pr-1 pl-1.5">
      <ChevronDown size={13} className="shrink-0 text-ink-faint" />
      <span className="flex-1 truncate text-meta font-semibold tracking-wide text-ink-faint uppercase">{children}</span>
      {fin}
    </div>
  )
}

function FilLigne({ titre, agent, vault = false, actif = false }: {
  titre: string
  agent: 'claude' | 'codex'
  vault?: boolean
  actif?: boolean
}) {
  return (
    <div className={cx('flex h-8 items-center gap-2 rounded-md pr-1 pl-5 text-sm', actif ? 'bg-accent-wash text-ink' : 'text-ink-soft')}>
      <AgentIcon agent={agent} size={13} />
      <span className="min-w-0 flex-1 truncate">{titre}</span>
      {vault ? <Inbox size={11} className="shrink-0 text-caution" /> : null}
    </div>
  )
}

/** α — la capacité : un droit dans la barre du fil, et aucun domicile neuf. */
function AlphaCapacite() {
  return (
    <ColonneCadre
      id="alpha-la-capacite"
      titre="α · une capacité — le droit est dans la barre, le fil ne bouge pas"
      note="Écrire dans le vault est un droit accordé à ce fil, écrit dans sa barre et révocable d’un clic. Le fil reste où il est — sans projet, ou dans son projet. Dans la liste, la capacité n’est qu’une icône en bout de ligne. Ce que ça laisse sans réponse : avec vingt fils, rien ne rassemble ceux qui travaillent le vault."
    >
      <div className="flex h-[var(--header-height)] items-center gap-2.5 border-b border-line px-3">
        <AgentIcon agent="claude" size={15} />
        <span className="min-w-0 flex-1">
          <span className="block text-micro text-ink-faint">Sans projet</span>
          <span className="block truncate text-sm font-medium text-ink">Comparer deux formats de vault</span>
        </span>
        <span className="flex h-6 shrink-0 items-center gap-1.5 rounded-full bg-caution/10 px-2 text-micro font-medium text-caution"><Inbox size={11} />Veille</span>
      </div>
      <div className="p-1">
        <TitreGroupe fin={<span className="pr-1.5 text-micro tabular-nums text-ink-faint">2</span>}>Sans projet</TitreGroupe>
        {FILS_VAULT.map((fil, index) => <FilLigne key={fil.titre} titre={fil.titre} agent={fil.agent} vault actif={index === 0} />)}
        <TitreGroupe fin={<span className="pr-1.5 text-micro tabular-nums text-ink-faint">3</span>}>Solera</TitreGroupe>
        <FilLigne titre={FIL_MIXTE.titre} agent={FIL_MIXTE.agent} vault />
        <FilLigne titre="Dessiner le contexte Savoir" agent="claude" />
        <FilLigne titre="Largeur des conteneurs" agent="codex" />
      </div>
    </ColonneCadre>
  )
}

/** β — le rattachement : les fils du vault font leur groupe dans l'onglet Fils. */
function BetaGroupe() {
  return (
    <ColonneCadre
      id="beta-le-groupe"
      titre="β · un rattachement — un groupe « Savoir » dans les fils"
      note="Les fils du vault se rassemblent, et c’est exactement ce qu’on veut quand il y en a vingt. Le prix est une question sans bonne réponse, surlignée ici : un fil qui travaille le code de Solera **et** prend des notes appartient à deux groupes. Le mettre dans les deux casse le compte ; choisir pour lui, c’est deviner."
    >
      <div className="p-1">
        <TitreGroupe fin={<span className="pr-1.5 text-micro tabular-nums text-ink-faint">2</span>}>Savoir</TitreGroupe>
        {FILS_VAULT.map((fil, index) => <FilLigne key={fil.titre} titre={fil.titre} agent={fil.agent} actif={index === 0} />)}
        <div className="my-1 rounded-md border border-dashed border-caution/60 bg-caution/5 px-1.5 py-1">
          <div className="flex items-center gap-2 text-sm text-ink-soft">
            <AgentIcon agent={FIL_MIXTE.agent} size={13} />
            <span className="min-w-0 flex-1 truncate">{FIL_MIXTE.titre}</span>
            <TriangleAlert size={11} className="shrink-0 text-caution" />
          </div>
          <div className="mt-0.5 text-micro leading-relaxed text-caution">touche au dépôt Solera et écrit dans le vault — ici, ou dans Solera ?</div>
        </div>
        <TitreGroupe fin={<span className="pr-1.5 text-micro tabular-nums text-ink-faint">2</span>}>Sans projet</TitreGroupe>
        <FilLigne titre="Pourquoi mon DNS ne résout pas" agent="codex" />
        <FilLigne titre="Idées de nom pour la bague" agent="claude" />
        <TitreGroupe fin={<span className="pr-1.5 text-micro tabular-nums text-ink-faint">2</span>}>Solera</TitreGroupe>
        <FilLigne titre="Dessiner le contexte Savoir" agent="claude" />
        <FilLigne titre="Largeur des conteneurs" agent="codex" />
      </div>
    </ColonneCadre>
  )
}

/** γ — α pour le modèle, et les fils du vault montrés là où le vault vit. */
function GammaFilsDuVault() {
  return (
    <ColonneCadre
      id="gamma-fils-du-vault"
      titre="γ · le modèle de α, le rassemblement de β — dans le lieu Savoir"
      note="Le fil garde son domicile (α), et le lieu *Savoir* montre ceux qui l’écrivent — comme la section Activité montre les sessions qui tournent sans être leur domicile. Le fil mixte n’a plus à choisir : il est listé ici **et** dans son projet, sans que ce soit une contradiction, parce que cette liste n’est pas un classement mais une vue. C’est ce que α promettait et n’avait jamais montré."
    >
      <div className="flex h-9 items-center gap-2 border-b border-line px-3">
        <BookOpen size={14} className="text-ink-faint" />
        <span className="flex-1 text-xs font-medium text-ink">Savoir</span>
        <Count tone="caution">2</Count>
      </div>
      <div className="p-1">
        <LigneColonne icone={<Inbox size={14} />} fin={<Count tone="caution">2</Count>}>Boîte des agents</LigneColonne>
        <LigneColonne icone={<SquarePen size={13} />} fin={<span className="pr-1 text-micro tabular-nums text-ink-faint">5</span>}>Ébauches</LigneColonne>
        <LigneColonne icone={<Link2Off size={13} />} fin={<span className="pr-1 text-micro tabular-nums text-ink-faint">9</span>}>Sans lien entrant</LigneColonne>
        <TitreGroupe fin={<span className="pr-1.5 text-micro tabular-nums text-ink-faint">3</span>}>Fils du vault</TitreGroupe>
        {FILS_VAULT.map((fil) => (
          <div key={fil.titre} className="flex h-8 items-center gap-2 rounded-md pr-1 pl-5 text-sm text-ink-soft">
            <AgentIcon agent={fil.agent} size={13} />
            <span className="min-w-0 flex-1 truncate">{fil.titre}</span>
            {fil.etat === 'tourne' ? <span className="size-1.5 shrink-0 rounded-full bg-accent" /> : null}
          </div>
        ))}
        <div className="flex h-8 items-center gap-2 rounded-md pr-1 pl-5 text-sm text-ink-soft">
          <AgentIcon agent={FIL_MIXTE.agent} size={13} />
          <span className="min-w-0 flex-1 truncate">{FIL_MIXTE.titre}</span>
          <span className="flex h-4 shrink-0 items-center rounded-full bg-surface-high px-1.5 text-micro text-ink-faint">Solera</span>
        </div>
        <TitreGroupe>Récentes</TitreGroupe>
        {REPRENDRE.slice(0, 2).map((note) => (
          <LigneColonne key={note.titre} icone={<FileText size={13} />} retrait>{note.titre}</LigneColonne>
        ))}
        <TitreGroupe>Dossiers</TitreGroupe>
        {DOSSIERS.slice(0, 2).map((dossier) => (
          <LigneColonne
            key={dossier.label}
            icone={<ChevronRight size={13} />}
            retrait
            fin={<span className="flex shrink-0 items-center gap-1.5 pr-1"><Bouclier droit={dossier.droit} /><span className="text-micro tabular-nums text-ink-faint">{dossier.count}</span></span>}
          >
            {dossier.label}
          </LigneColonne>
        ))}
      </div>
    </ColonneCadre>
  )
}

export function VaultTour6() {
  return (
    <div className="flex flex-wrap items-start gap-7 p-4">
      <AlphaCapacite />
      <BetaGroupe />
      <GammaFilsDuVault />
    </div>
  )
}
