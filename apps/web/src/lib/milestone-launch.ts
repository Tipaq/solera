import {
  MILESTONE_QUOTA_WARNING,
  sameEnvironment,
  type CardConversationDto,
  type CardDto,
  type ExecutionEnvironment,
  type MilestoneRunMode,
  type ProjectEnvironmentsDto,
} from '@solera/protocol'
import { liveSessions, loadedStatus, type StatusOf } from './card-state'
import { pluralOf } from './code-model'
import type { MessageKey, MessageParams } from './i18n'
import type { MilestoneEntry } from './milestone-model'

/*
 * Le panneau Lancer d'un jalon, avant son lancement (#197, spec jalons LCH-1..12) : ce
 * qu'il montre selon l'étape, ce qu'il vérifie avant de partir, et l'environnement des
 * sessions. Pur, sans React ni réseau : `LaunchPanel` le rend.
 */

/**
 * Ce que montre le panneau (LCH-1, LCH-2) : un jalon livré, un jalon sans cartes, un jalon
 * déjà lancé (le suivi, #198), ou le lancement lui-même.
 */
export type LaunchStage = 'delivered' | 'empty' | 'launched' | 'before'

export function launchStage(entry: MilestoneEntry): LaunchStage {
  if (entry.maturity === 'delivered') return 'delivered'
  if (entry.maturity === 'launched') return 'launched'
  return entry.children.length === 0 ? 'empty' : 'before'
}

/* ------------------------------------------------------------------ vérifications */

/** Une vérification avant de partir (LCH-11), en données : `launchCheckText` en fait une ligne. */
export type LaunchCheck =
  | { kind: 'clear'; ok: boolean; count: number }
  | { kind: 'accepted'; ok: boolean; count: number }
  | { kind: 'noCycle'; ok: boolean; cards: number[] }
  | { kind: 'startable'; ok: boolean }
  | { kind: 'concurrency'; ok: true; count: number }

/**
 * Les vérifications du lancement autonome, **les échecs d'abord** : c'est ce qu'on vient
 * lire ici. Les questions ouvertes de l'affinage comptent chacune, un brouillon à valider
 * pour un point : le prototype les additionnait sans le brouillon, et disait « 0 point ».
 */
export function launchChecks(entry: MilestoneEntry, concurrency: number): LaunchCheck[] {
  const clear = entry.toClarify.length + (entry.questions?.items.length ?? 0) + (entry.draft ? 1 : 0)
  const checks: LaunchCheck[] = [
    { kind: 'clear', ok: clear === 0, count: clear },
    { kind: 'accepted', ok: entry.notAccepted.length === 0, count: entry.notAccepted.length },
    { kind: 'noCycle', ok: entry.cycle.length === 0, cards: entry.cycle.map((card) => card.number) },
    { kind: 'startable', ok: entry.startable.length > 0 },
    { kind: 'concurrency', ok: true, count: concurrency },
  ]
  // Un tri stable : chaque groupe garde l'ordre de la liste.
  return checks.sort((a, b) => Number(a.ok) - Number(b.ok))
}

export function launchReady(checks: readonly LaunchCheck[]): boolean {
  return checks.every((check) => check.ok)
}

type Translate = (key: MessageKey, params?: MessageParams) => string

export function launchCheckText(check: LaunchCheck, t: Translate): string {
  switch (check.kind) {
    case 'clear':
    case 'accepted':
      return check.ok
        ? t(`milestone.launch.check.${check.kind}`)
        : t(`milestone.launch.check.${check.kind}.fail.${pluralOf(check.count)}`, { count: check.count })
    case 'noCycle':
      return check.ok
        ? t('milestone.launch.check.noCycle')
        : t('milestone.launch.check.noCycle.fail', { cards: check.cards.map((number) => `#${number}`).join(', ') })
    case 'startable':
      return t(check.ok ? 'milestone.launch.check.startable' : 'milestone.launch.check.startable.fail')
    case 'concurrency':
      return t('milestone.launch.check.concurrency', { count: check.count })
  }
}

/** Au-delà de ce nombre à la fois, le quota fond d'autant plus vite (LCH-9). */
export function quotaWarning(concurrency: number): boolean {
  return concurrency > MILESTONE_QUOTA_WARNING
}

/* ------------------------------------------------------------------ environnement */

/**
 * Les environnements que le lancement propose (LCH-5, spec §2.6-2) : l'emplacement suit
 * le projet, le lancement ne règle que le confinement. Le libre d'abord.
 */
export function launchEnvironments(environments: ProjectEnvironmentsDto): ExecutionEnvironment[] {
  return environments.choices
    .filter((choice) => choice.where === environments.default.where)
    .sort((a, b) => Number(a.confined) - Number(b.confined))
}

/** On part du réglage du projet ; s'il n'est pas proposé, du premier qui l'est. */
export function initialLaunchEnvironment(environments: ProjectEnvironmentsDto): ExecutionEnvironment {
  const choices = launchEnvironments(environments)
  return choices.find((choice) => sameEnvironment(choice, environments.default)) ?? choices[0] ?? environments.default
}

/**
 * Passer en autonome confine d'office (LCH-6, #146) : le confinement est son garde-fou, et
 * une session confinée tourne sans demander d'autorisation. Revenir à la main ne déconfine
 * pas : c'est un choix qu'on a vu se faire.
 */
export function environmentForMode(
  mode: MilestoneRunMode,
  environment: ExecutionEnvironment,
  choices: readonly ExecutionEnvironment[],
): ExecutionEnvironment {
  if (mode === 'manual' || environment.confined) return environment
  return choices.find((choice) => choice.where === environment.where && choice.confined) ?? environment
}

/* ------------------------------------------------------------------ à la main */

/**
 * Ce qu'offre une carte ouverte, à la main (LCH-7) : ses sessions qui vivent, « Lancer »
 * si elle peut partir et qu'elle est acceptée, ou « attend ».
 */
export type ManualRow = { kind: 'live'; sessions: CardConversationDto[] } | { kind: 'launch' } | { kind: 'waits' }

export function manualRowOf(card: CardDto, entry: MilestoneEntry, statusOf: StatusOf = loadedStatus): ManualRow {
  const sessions = liveSessions(card, statusOf)
  if (sessions.length) return { kind: 'live', sessions }
  const startable = entry.startable.some((candidate) => candidate.id === card.id)
  return startable && card.acceptedAt !== null ? { kind: 'launch' } : { kind: 'waits' }
}
