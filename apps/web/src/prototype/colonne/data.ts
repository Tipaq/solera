/**
 * PROTOTYPE JETABLE (#121, #51) — données factices de la colonne. Rien n'est lu du
 * serveur : la question est « à quoi ça ressemble », pas « est-ce que ça marche ».
 */

export interface Project {
  id: string
  name: string
  color: string
}

export const PROJECTS: Project[] = [
  { id: 'solera', name: 'Solera', color: 'var(--sg-accent)' },
  { id: 'ds', name: 'solera-ds', color: '#4fb3c9' },
  { id: 'site', name: 'Site Tipaq', color: '#3fa37b' },
  { id: 'notes', name: 'Carnet de lecture', color: '#b45fc7' },
]

export type ThreadDot = 'working' | 'unread' | 'awaiting' | null

export interface Thread {
  id: string
  projectId: string | null
  title: string
  agent: 'claude' | 'codex'
  dot: ThreadDot
  age: string
}

/** Les conversations de chaque projet, telles que l'arbre et le mode projet les listent. */
export const THREADS: Thread[] = [
  { id: 't1', projectId: 'solera', title: 'Historique de la conversation', agent: 'claude', dot: 'working', age: '2 min' },
  { id: 't2', projectId: 'solera', title: 'Réglages et permissions à trois niveaux', agent: 'claude', dot: null, age: '11 min' },
  { id: 't3', projectId: 'solera', title: 'Tri des nouveautés de Sillage', agent: 'claude', dot: null, age: '11 min' },
  { id: 't4', projectId: 'solera', title: 'Répondre à une session depuis l’Activité', agent: 'claude', dot: 'unread', age: '3 min' },
  { id: 't5', projectId: 'solera', title: 'Aperçu d’un projet : le bloc « En ce moment »', agent: 'claude', dot: null, age: '9 min' },
  { id: 't6', projectId: 'solera', title: 'Prototype : la section unique des demandes', agent: 'claude', dot: 'working', age: 'à l’instant' },
  { id: 't7', projectId: 'solera', title: 'Badge de PR sur la ligne de session', agent: 'codex', dot: null, age: '1 h' },
  { id: 't8', projectId: 'ds', title: 'Dessiner l’onglet Agents à la manière de Claude Code', agent: 'claude', dot: null, age: '17 min' },
  { id: 't9', projectId: 'ds', title: 'Jetons du thème contrasté', agent: 'codex', dot: 'working', age: '5 min' },
  { id: 't10', projectId: 'ds', title: 'Page Gabarits/Colonne', agent: 'claude', dot: null, age: '2 j' },
  { id: 't11', projectId: 'site', title: 'Tourner le film de la page d’accueil', agent: 'claude', dot: null, age: '3 j' },
  { id: 't12', projectId: 'site', title: 'Réécrire « Where Solera comes from »', agent: 'claude', dot: 'unread', age: '1 h' },
  { id: 't13', projectId: 'notes', title: 'Fiches de « La Montagne magique »', agent: 'claude', dot: null, age: '4 j' },
  { id: 't14', projectId: null, title: 'Pourquoi WSL coupe Tailscale', agent: 'claude', dot: null, age: '1 j' },
  { id: 't15', projectId: null, title: 'Comparer deux offres de box', agent: 'codex', dot: null, age: '2 j' },
]

/**
 * Une demande, dans les trois rangs de la section : ce qui **bloque** un fil (le CLI
 * attend : permission, question, plan), ce qui est **à décider** (request_decision, avec
 * son échéance), ce qui est **à accorder** (cartes, brouillons, conversation à ranger).
 */
export type Demand =
  | { id: string; tier: 'blocked'; kind: 'permission' | 'question' | 'plan'; threadId: string; ask: string; age: string }
  | { id: string; tier: 'decision'; threadId: string; ask: string; due: string; age: string }
  | { id: string; tier: 'grant'; kind: 'cards' | 'drafts' | 'move'; threadId: string; ask: string; age: string }

const ALL: Demand[] = [
  { id: 'd1', tier: 'blocked', kind: 'permission', threadId: 't2', ask: 'Lancer pnpm test:places-ui', age: '4 min' },
  { id: 'd2', tier: 'blocked', kind: 'question', threadId: 't8', ask: 'Garder la barre d’onglets en haut ?', age: '12 min' },
  { id: 'd3', tier: 'blocked', kind: 'plan', threadId: 't3', ask: 'Plan en 4 étapes à valider', age: '25 min' },
  { id: 'd4', tier: 'decision', threadId: 't5', ask: 'Fusionner #69 avant ou après la revue ?', due: '2 h', age: '30 min' },
  { id: 'd5', tier: 'decision', threadId: 't9', ask: 'Quel contraste viser pour le texte faible ?', due: '22 min', age: '1 h' },
  { id: 'd6', tier: 'decision', threadId: 't12', ask: 'Signer la note de ton nom ou de Tipaq ?', due: '1 j', age: '1 h' },
  { id: 'd7', tier: 'grant', kind: 'cards', threadId: 't1', ask: '3 cartes à ranger', age: '2 min' },
  { id: 'd8', tier: 'grant', kind: 'drafts', threadId: 't4', ask: '2 cartes à créer', age: '8 min' },
  { id: 'd9', tier: 'grant', kind: 'move', threadId: 't14', ask: 'Ranger dans « Solera »', age: '1 j' },
]

const pick = (...ids: string[]) => ids.map((id) => ALL.find((entry) => entry.id === id)!)

export type Scenario = 'empty' | 'one' | 'mixed' | 'many'

export const SCENARIOS: { id: Scenario; label: string }[] = [
  { id: 'empty', label: 'Vide' },
  { id: 'one', label: 'Un fil bloqué' },
  { id: 'mixed', label: 'Types mélangés' },
  { id: 'many', label: 'Plus de 5' },
]

export const DEMANDS: Record<Scenario, Demand[]> = {
  empty: [],
  one: pick('d1'),
  mixed: pick('d1', 'd2', 'd4', 'd5', 'd7'),
  many: ALL,
}

export const threadOf = (id: string) => THREADS.find((thread) => thread.id === id)!
export const projectOf = (id: string | null) => PROJECTS.find((project) => project.id === id)

/**
 * Le point d'un fil selon le scénario : un fil bloqué dans le scénario attend, sinon il
 * garde son point de base. C'est ce que l'arbre et le mode projet montrent.
 */
export function dotOf(thread: Thread, demands: Demand[]): ThreadDot {
  if (demands.some((demand) => demand.tier === 'blocked' && demand.threadId === thread.id)) return 'awaiting'
  return thread.dot
}

const TIER_RANK = { blocked: 0, decision: 1, grant: 2 } as const

/**
 * L'ordre de la section : bloqué → à décider → à accorder, quel que soit le projet
 * (Q37 : un agent bloqué ne passe jamais derrière un accord) ; en mode projet, le
 * projet courant passe devant **dans chaque rang**.
 */
export function orderDemands(demands: Demand[], currentProject: string | null | undefined): Demand[] {
  const here = (demand: Demand) =>
    currentProject !== undefined && threadOf(demand.threadId).projectId === currentProject ? 0 : 1
  return [...demands].sort((a, b) => TIER_RANK[a.tier] - TIER_RANK[b.tier] || here(a) - here(b))
}
