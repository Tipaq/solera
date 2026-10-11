/*
 * MAQUETTE JETABLE — à supprimer une fois la disposition portée dans le composer.
 *
 * Troisième tour. La rangée retenue est celle-ci, dans cet ordre :
 *
 *   [ + ] [ micro ]  ———————————  [ ◆ sonnet-5 · Élevé ▾ ] [ jauge 19 % ] [ ↑ ]
 *
 * Le nom du modèle perd son préfixe de marque et son icône générique : la marque du
 * CLI la remplace, ce qui dit la même chose en deux fois moins de place. La jauge
 * devient un bouton, qui ouvre le détail du contexte.
 *
 * Tout ce qui quitte la rangée doit se retrouver dans un menu : ils sont donc tous
 * dessinés ouverts, sous-menus compris, parce qu'une capture ne déroule rien.
 *
 * Les libellés sont écrits en clair, contrairement à la règle : rien de ceci ne part
 * en production, et passer par `t()` obligerait à inventer des clés à retirer ensuite.
 */
import { ArrowUp, BookOpen, Check, ChevronDown, ChevronRight, Clock, Mic, Paperclip, Plus, PlugZap, Search, SlidersHorizontal, Square, X, Zap } from 'lucide-react'
import type { ReactNode } from 'react'
import { IconButton, cx } from '@solera/ui'
import { AgentIcon } from '../AgentIcon'
import { ContextMeter } from './ContextMeter'

const CONTEXT = { usedTokens: 38_000, maxTokens: 200_000, ratio: 0.19 }

/* ------------------------------------------------------------------ rangée ---- */

/**
 * `dot` : la pastille que porte aujourd'hui le bouton à curseurs. Elle doit remonter
 * ici, sinon un réglage qui sort du défaut — approbations coupées, isolation stricte —
 * devient invisible une fois les réglages rangés dans le menu.
 */
function PlusButton({ dot }: { dot?: 'accent' | 'caution' }) {
  return (
    <span className="relative inline-flex">
      <IconButton label="Joindre, skills, serveurs, réglages" size="sm"><Plus size={16} /></IconButton>
      {dot ? <span aria-hidden className={cx('pointer-events-none absolute top-1.5 right-1.5 size-1.5 rounded-full', dot === 'caution' ? 'bg-caution' : 'bg-accent')} /> : null}
    </span>
  )
}

function Dictate() {
  return <IconButton label="Dicter" size="sm"><Mic size={16} /></IconButton>
}

/** Un mode qui change ce que l'agent a le droit de faire se lit sans ouvrir un menu. */
function ModeBadge({ children }: { children: ReactNode }) {
  return (
    <span className="flex min-h-11 shrink-0 items-center rounded-md border border-caution/40 bg-caution/10 px-2 text-xs font-medium text-caution md:min-h-9 pointer-coarse:min-h-11">
      {children}
    </span>
  )
}

/** Arrêter le tour. */
function StopButton() {
  return (
    <span className="flex size-11 shrink-0 items-center justify-center rounded-full border border-line bg-surface-high text-ink md:size-9 pointer-coarse:size-11">
      <Square size={16} fill="currentColor" />
    </span>
  )
}

/**
 * Déclencheur du menu du modèle : marque du CLI, nom court, effort, chevron.
 *
 * « claude-sonnet-5 » devient « sonnet-5 » : le préfixe répète la marque que l'icône
 * porte déjà, et c'est lui qui faisait déborder la puce au téléphone.
 */
function ModelTrigger() {
  return (
    <button type="button" className={cx(
      'flex min-h-11 min-w-0 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-ink',
      'hover:bg-surface-high md:min-h-9 pointer-coarse:min-h-11',
    )}>
      <AgentIcon agent="claude" size={14} />
      <span className="min-w-0 truncate">sonnet-5</span>
      <span className="hidden shrink-0 font-normal text-ink-faint @min-[26rem]:inline">· Élevé</span>
      <ChevronDown size={14} className="shrink-0 text-ink-faint" />
    </button>
  )
}

/** La jauge devient un bouton : le clic ouvre le détail du contexte. */
function ContextButton({ context = CONTEXT }: { context?: typeof CONTEXT }) {
  return (
    <button type="button" aria-label="Contexte, voir le détail"
      className="flex min-h-11 shrink-0 items-center rounded-md px-1.5 hover:bg-surface-high md:min-h-9 pointer-coarse:min-h-11">
      <ContextMeter context={context} />
    </button>
  )
}

/**
 * `queued` : le même bouton quand la mise en file est préférée aux inflexions. La
 * pastille d'horloge est le seul signe visible que l'envoi attendra la fin du tour —
 * sans elle, deux comportements opposés auraient exactement la même tête.
 */
function SendButton({ queued = false }: { queued?: boolean }) {
  return (
    <span className="relative inline-flex shrink-0">
      <button type="submit" className={cx(
        'flex size-11 shrink-0 items-center justify-center rounded-full md:size-9 pointer-coarse:size-11',
        'gradient-accent text-accent-ink',
      )}>
        <ArrowUp size={16} strokeWidth={2.5} />
      </button>
      {queued ? (
        <span aria-hidden className="pointer-events-none absolute top-0 right-0 flex size-4 items-center justify-center rounded-full border border-surface bg-surface-high text-ink-soft">
          <Clock size={10} />
        </span>
      ) : null}
    </span>
  )
}

/* ------------------------------------------------------------------- menus ---- */

/** Le cadre d'un menu Radix, dessiné ouvert. Mêmes classes que `Menu`. */
function MenuPanel({ shot, title, children, width = 'w-64' }: { shot: string; title: string; children: ReactNode; width?: string }) {
  return (
    <div data-shot={shot} className="flex flex-col gap-1.5">
      <p className="text-meta text-ink-faint">{title}</p>
      <div className={cx('surface overflow-hidden rounded-lg border border-line p-1 shadow-pop', width)}>
        {children}
      </div>
    </div>
  )
}

function Item({ icon, children, submenu = false, checked = false, hint, value }: {
  icon?: ReactNode
  children: ReactNode
  submenu?: boolean
  checked?: boolean
  hint?: string
  /** Valeur en vigueur, alignée à droite : un réglage se lit sans l'ouvrir. */
  value?: string
}) {
  return (
    <div className={cx(
      'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm',
      checked ? 'bg-accent-wash text-ink' : 'text-ink-soft',
    )}>
      {icon ? <span className="shrink-0">{icon}</span> : null}
      <span className="min-w-0 flex-1">
        {children}
        {hint ? <span className="block text-meta text-ink-faint">{hint}</span> : null}
      </span>
      {value ? <span className="shrink-0 text-xs text-ink-faint">{value}</span> : null}
      {checked ? <Check size={16} className="shrink-0 text-accent" /> : null}
      {submenu ? <ChevronRight size={14} className="shrink-0 text-ink-faint" /> : null}
    </div>
  )
}

/** Interrupteur de menu, pour un réglage à deux états. */
function Toggle({ icon, children, hint, on }: { icon?: ReactNode; children: ReactNode; hint?: string; on: boolean }) {
  return (
    <div className="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-ink-soft">
      {icon ? <span className="shrink-0">{icon}</span> : null}
      <span className="min-w-0 flex-1">
        {children}
        {hint ? <span className="block text-meta text-ink-faint">{hint}</span> : null}
      </span>
      <span className={cx('flex h-5 w-9 shrink-0 items-center rounded-full p-0.5', on ? 'bg-accent' : 'bg-line-strong')}>
        <span className={cx('size-4 rounded-full bg-surface', on && 'translate-x-4')} />
      </span>
    </div>
  )
}

function Label({ children }: { children: ReactNode }) {
  return <p className="px-2.5 pt-1.5 pb-1 text-meta font-semibold tracking-wide text-ink-faint uppercase">{children}</p>
}

function Separator() {
  return <div className="my-1 h-px bg-line" />
}

/** Rail segmenté de l'effort, dans le menu du modèle. */
function EffortRail() {
  return (
    <div className="flex gap-1 px-1.5 pb-1">
      {['Faible', 'Moyen', 'Élevé'].map((level) => (
        <span key={level} className={cx(
          'flex min-h-9 flex-1 items-center justify-center rounded-md border px-2 text-xs',
          level === 'Élevé' ? 'border-accent/50 bg-accent-wash font-medium text-ink' : 'border-line text-ink-soft',
        )}>
          {level}
        </span>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ cadres ---- */

function Frame({ id, title, note, typed, children }: {
  id: string
  title: string
  note: string
  /** Texte déjà saisi : c'est lui qui décide si le bouton envoie ou arrête. */
  typed?: string
  children: ReactNode
}) {
  return (
    <section data-proto={id} data-shot={id} className="flex flex-col gap-1.5">
      <h2 className="text-sm font-semibold text-ink">{title}</h2>
      <p className="text-xs text-ink-faint">{note}</p>
      <div className="@container">
        <div data-proto-card className="surface flex flex-col gap-1 rounded-xl border border-line p-1.5 shadow-float">
          <p className={cx('px-2 py-2 text-heading leading-relaxed', typed ? 'text-ink' : 'text-ink-faint')}>
            {typed ?? 'Écris ton message...'}
          </p>
          {children}
        </div>
        <div className="flex items-center gap-2 px-1 pt-1 text-meta text-ink-faint">
          <span>Claude Code</span><span>·</span><span>Session au repos</span><span>·</span><span>Connecté</span>
        </div>
      </div>
    </section>
  )
}

export function ComposerRowPrototypes() {
  return (
    <div className="flex flex-col gap-8 p-4">
      <Frame
        id="rangee-au-repos"
        title="H′ · La rangée retenue"
        note="« + », dictée, puis le modèle, la jauge et l’envoi. La marque Claude remplace l’icône générique et le préfixe du nom : « sonnet-5 » au lieu de « claude-sonnet-5 »."
      >
        <div data-proto-row className="flex items-center gap-1.5">
          <PlusButton /><Dictate />
          <span className="ml-auto flex min-w-0 items-center gap-1.5">
            <ModelTrigger /><ContextButton /><SendButton />
          </span>
        </div>
      </Frame>

      <Frame
        id="reglage-hors-defaut"
        title="H′ · un réglage sort du défaut"
        note="La pastille du bouton à curseurs remonte sur « + » : sans elle, des approbations coupées deviendraient invisibles une fois les réglages rangés dans le menu. Un mode qui change ce que l’agent a le droit de faire — Plan — garde une étiquette dans la rangée."
      >
        <div data-proto-row className="flex items-center gap-1.5">
          <PlusButton dot="caution" /><Dictate />
          <span className="ml-auto flex min-w-0 items-center gap-1.5">
            <ModeBadge>Plan</ModeBadge><ModelTrigger /><ContextButton /><SendButton />
          </span>
        </div>
      </Frame>

      <Frame
        id="tour-rien-tape"
        title="H′ pendant un tour · rien de tapé"
        note="Un seul bouton rond : arrêter. Tant qu’il n’y a rien à envoyer, l’envoi n’a pas à occuper une place."
      >
        <div data-proto-row className="flex items-center gap-1.5">
          <PlusButton /><Dictate />
          <span className="ml-auto flex min-w-0 items-center gap-1.5">
            <ModelTrigger />
            <ContextButton context={{ usedTokens: 148_000, maxTokens: 200_000, ratio: 0.74 }} />
            <StopButton />
          </span>
        </div>
      </Frame>

      <Frame
        id="tour-message-tape"
        title="H′ pendant un tour · un message tapé, infléchir par défaut"
        note="Le bouton bascule : dès qu’il y a du texte, arrêter laisse la place à envoyer, et l’envoi pousse le message dans le tour en cours. Conséquence assumée : pour arrêter avec un brouillon en cours, il faut vider le champ."
        typed="Plutôt en TypeScript, et garde le test existant."
      >
        <div data-proto-row className="flex items-center gap-1.5">
          <PlusButton /><Dictate />
          <span className="ml-auto flex min-w-0 items-center gap-1.5">
            <ModelTrigger />
            <ContextButton context={{ usedTokens: 148_000, maxTokens: 200_000, ratio: 0.74 }} />
            <SendButton />
          </span>
        </div>
      </Frame>

      <Frame
        id="tour-mise-en-file"
        title="H′ pendant un tour · avec la mise en file choisie"
        note="Là, les deux boutons coexistent : le message attend la fin du tour, donc arrêter reste accessible pendant qu’on écrit. Une horloge sur l’envoi dit que le départ est différé."
        typed="Plutôt en TypeScript, et garde le test existant."
      >
        <div data-proto-row className="flex items-center gap-1.5">
          <PlusButton /><Dictate />
          <span className="ml-auto flex min-w-0 items-center gap-1.5">
            <ModelTrigger />
            <ContextButton context={{ usedTokens: 148_000, maxTokens: 200_000, ratio: 0.74 }} />
            <StopButton /><SendButton queued />
          </span>
        </div>
      </Frame>

      {/* Tous les menus, dépliés : c'est là que vit ce qui a quitté la rangée. */}
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-ink">Le menu « + », et ses sous-menus</h2>
        <div className="flex flex-wrap items-start gap-4">
          <MenuPanel shot="menu-plus" title="« + »">
            <Item icon={<Paperclip size={16} />}>Joindre un fichier</Item>
            <Item icon={<BookOpen size={16} />} submenu value="4">Skills et commandes</Item>
            <Item icon={<PlugZap size={16} />} submenu value="1 / 3">Serveurs MCP</Item>
            <Separator />
            <Item icon={<SlidersHorizontal size={16} />} submenu>Réglages de la session</Item>
          </MenuPanel>

          <MenuPanel shot="menu-plus-skills" title="« + » › Skills et commandes" width="w-80">
            <div className="mx-1 mt-1 mb-1.5 flex items-center gap-2 rounded-md border border-line bg-sunken px-2.5">
              <Search size={14} className="shrink-0 text-ink-faint" />
              <span className="h-9 flex-1 content-center text-sm text-ink-faint">Chercher un skill…</span>
            </div>
            <Label>Dans la bibliothèque</Label>
            <Toggle on hint="Graphiques et palettes">dataviz</Toggle>
            <Toggle on hint="Revue du diff courant">code-review</Toggle>
            <Toggle on={false} hint="Rédaction de documents">docs</Toggle>
            <Separator />
            <Label>Dans la session</Label>
            <Item hint="Déclarée par le CLI">/compact</Item>
            <Separator />
            <Item icon={<BookOpen size={16} />}>Gérer la bibliothèque…</Item>
          </MenuPanel>

          <MenuPanel shot="menu-plus-mcp" title="« + » › Serveurs MCP" width="w-72">
            <Toggle on hint="Cartes, sessions, historique">Serveur Solera</Toggle>
            <Separator />
            <Toggle on={false} hint="12 outils">docs</Toggle>
            <Toggle on={false} hint="8 outils">playwright</Toggle>
            <Separator />
            <Toggle on={false} hint="Rien d’autre que les serveurs déclarés">Isolation stricte</Toggle>
          </MenuPanel>

          <MenuPanel shot="menu-plus-reglages" title="« + » › Réglages de la session" width="w-72">
            <Item submenu value="Demander">Permissions</Item>
            <Item submenu value="Standard">Vitesse</Item>
            <Item submenu value="Par défaut">Style de réponse</Item>
            <Item submenu value="Aucun">Conseiller</Item>
            <Separator />
            <Toggle on={false} hint="Attendre la fin du tour au lieu d’y pousser le message">Mettre les messages en file</Toggle>
            <Toggle on={false} hint="Plusieurs agents en parallèle">Ultracode</Toggle>
            <Toggle on hint="Les skills de Solera sont proposés">Bibliothèque de skills</Toggle>
            <Separator />
            <Item icon={<SlidersHorizontal size={16} />}>Tous les réglages…</Item>
          </MenuPanel>

          <MenuPanel shot="menu-plus-permissions" title="« + » › Réglages › Permissions" width="w-80">
            <Item checked hint="Chaque outil est soumis à ton accord">Demander</Item>
            <Item hint="Claude décide, demande en cas de doute">Automatique</Item>
            <Item hint="Les écritures passent sans demande">Éditions acceptées</Item>
            <Item hint="Analyse seule, aucune modification">Plan</Item>
            <Item hint="Aucune demande, aucun garde-fou">Tout autoriser</Item>
          </MenuPanel>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-ink">Le menu du modèle, et son sous-menu</h2>
        <div className="flex flex-wrap items-start gap-4">
          <MenuPanel shot="menu-modele" title="Puce du modèle" width="w-72">
            <Label>Modèle</Label>
            <Item icon={<AgentIcon agent="claude" size={16} />} hint="Le plus capable">opus-5</Item>
            <Item icon={<AgentIcon agent="claude" size={16} />} hint="Équilibré" checked>sonnet-5</Item>
            <Item icon={<AgentIcon agent="claude" size={16} />} hint="Le plus rapide">haiku-4.5</Item>
            <Item submenu hint="Tout le catalogue du CLI">Plus de modèles…</Item>
            <Separator />
            <Label>Effort de réflexion</Label>
            <EffortRail />
            <Separator />
            <Toggle icon={<Zap size={16} />} on={false} hint="Même modèle, sortie accélérée">Mode rapide</Toggle>
          </MenuPanel>

          <MenuPanel shot="menu-modele-plus" title="Puce du modèle › Plus de modèles…" width="w-80">
            <Item hint="Le CLI choisit selon la tâche">Par défaut du CLI</Item>
            <Separator />
            <Label>Claude 5</Label>
            <Item hint="Contexte 1 M">opus-5</Item>
            <Item hint="Contexte 200 k" checked>sonnet-5</Item>
            <Separator />
            <Label>Générations précédentes</Label>
            <Item hint="Contexte 200 k">opus-4.8</Item>
            <Item hint="Contexte 200 k">sonnet-4.5</Item>
            <Item hint="Contexte 200 k">haiku-4.5</Item>
          </MenuPanel>
        </div>
      </section>

      {/* Ce que le clic sur la jauge ouvre. Le détail par source n'y figure pas : les
          CLI donnent un total, pas sa composition. Mieux vaut ne rien inventer. */}
      <section data-shot="modale-contexte" className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-ink">La modale de contexte</h2>
        <p className="text-xs text-ink-faint">Ouverte par la jauge. Elle dit où en est la fenêtre, ce que la compaction ferait, et la déclenche.</p>
        <div className="surface w-[min(28rem,100%)] overflow-hidden rounded-xl border border-line shadow-pop">
          <div className="flex items-start justify-between gap-3 px-5 pt-4 pb-3">
            <div>
              <p className="text-heading font-semibold text-ink">Contexte de la conversation</p>
              <p className="mt-1 text-xs text-ink-faint">Ce que le modèle garde sous les yeux à chaque tour.</p>
            </div>
            <span className="flex size-11 shrink-0 items-center justify-center rounded-md text-ink-soft"><X size={16} /></span>
          </div>

          <div className="flex flex-col gap-3 px-5 pb-4">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-sm text-ink">38 k sur 200 k tokens</span>
              <span className="text-sm font-medium tabular-nums text-accent">19 %</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-surface-high">
              <div className="h-full w-[19%] rounded-full bg-accent" />
            </div>

            <dl className="mt-1 flex flex-col gap-1.5 text-xs">
              <div className="flex justify-between gap-3"><dt className="text-ink-faint">Modèle</dt><dd className="text-ink">claude-sonnet-5</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-ink-faint">Tours</dt><dd className="tabular-nums text-ink">12</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-ink-faint">Journal</dt><dd className="tabular-nums text-ink">1,2 Mo</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-ink-faint">Dernière compaction</dt><dd className="text-ink">aucune</dd></div>
            </dl>

            <p className="mt-1 text-xs text-ink-faint">
              Compacter résume les tours anciens et garde les décisions : la conversation continue, mais
              l’agent ne pourra plus citer le détail de ce qui a été résumé.
            </p>
            <p className="text-meta text-ink-faint">
              Le détail par source — système, outils, fichiers lus — n’est pas affiché : les CLI donnent
              un total, pas sa composition.
            </p>
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">
            <span className="flex min-h-11 items-center rounded-md px-3 text-sm text-ink-soft">Fermer</span>
            <span className="flex min-h-11 items-center rounded-md border border-line px-3 text-sm font-medium text-ink">Compacter le contexte</span>
          </div>
        </div>
      </section>
    </div>
  )
}
