import type {
  CardBranchPrDto,
  CardDto,
  MilestoneBlockReason,
  MilestoneCardStatus,
  MilestoneRunDto,
  ProjectEnvironmentsDto,
} from '@solera/protocol'
import { awaitsMe, isOpen, liveSessions, loadedStatus, type StatusOf } from './card-state'
import type { MessageKey, MessageParams } from './i18n'
import { launchEnvironments } from './milestone-launch'
import type { MilestoneEntry } from './milestone-model'

/*
 * Le suivi d'un jalon lancé (#198, spec jalons RUN-1..12) : ce que dit chaque carte, quand
 * « Lancer » s'offre à la main, le confinement des prochaines sessions et la PR finale.
 * Pur, sans React ni réseau : `RunPanel` le rend.
 */

/** Le titre du suivi (RUN-1) : la pause l'emporte sur le mode. */
export function runTitle(run: Pick<MilestoneRunDto, 'state' | 'mode'>): 'paused' | 'auto' | 'manual' {
  return run.state === 'paused' ? 'paused' : run.mode
}

/**
 * Ce que dit une carte du suivi (RUN-5), plus grossier que le pilotage : qui se lance
 * travaille déjà, et la fusion dans la branche du jalon fait partie de la revue.
 */
export type RunCardStatus = 'waiting' | 'queued' | 'working' | 'review' | 'merged' | 'blocked' | 'abandoned' | 'failed'

const RUN_STATUS: Record<MilestoneCardStatus, RunCardStatus> = {
  waiting: 'waiting',
  queued: 'queued',
  launching: 'working',
  working: 'working',
  reviewing: 'review',
  merging: 'review',
  blocked: 'blocked',
  done: 'merged',
  abandoned: 'abandoned',
  failed: 'failed',
}

export interface RunRow {
  card: CardDto
  status: RunCardStatus
  /** Pourquoi elle t'attend : l'infobulle de « t'attend ». */
  blockReason: MilestoneBlockReason | null
  /** Pourquoi son lancement a échoué. */
  error: string | null
  /** À la main, « ▶ Lancer » : en file, acceptée, sans session vivante. */
  launch: boolean
}

/**
 * Une ligne par enfant du jalon, dans l'ordre de la page. Le statut est celui du pilotage ;
 * une carte qu'il n'a pas encore adoptée (ajoutée depuis son dernier tour, RUN-11) se
 * déduit de la carte. Une session qui attend passe « t'attend » dès que le socket le dit,
 * sans attendre que le pilotage la relise : c'est le repère ambre de la page.
 */
export function runRowsOf(entry: MilestoneEntry, run: MilestoneRunDto, statusOf: StatusOf = loadedStatus): RunRow[] {
  const piloted = new Map(run.cards.map((card) => [card.cardId, card]))
  return entry.children.map((card) => {
    const pilot = piloted.get(card.id)
    let status = pilot ? RUN_STATUS[pilot.status] : fallbackStatus(card, statusOf)
    let blockReason = pilot?.blockReason ?? null
    if (status !== 'blocked' && isOpen(card) && awaitsMe(card, statusOf)) {
      status = 'blocked'
      blockReason = 'awaiting_input'
    }
    return {
      card,
      status,
      blockReason: status === 'blocked' ? blockReason : null,
      error: pilot?.error ?? null,
      launch:
        run.mode === 'manual' && status === 'queued' && card.acceptedAt !== null && liveSessions(card, statusOf).length === 0,
    }
  })
}

function fallbackStatus(card: CardDto, statusOf: StatusOf): RunCardStatus {
  if (card.column === 'done') return 'merged'
  if (card.column === 'abandoned') return 'abandoned'
  if (liveSessions(card, statusOf).length) return 'working'
  return card.blockedBy.some(isOpen) ? 'waiting' : 'queued'
}

/**
 * Le confinement des prochaines sessions (RUN-4) : celui du pilotage, sinon celui des
 * sessions autonomes du projet, comme le serveur le résout. `null` avant de les avoir lus.
 */
export function runConfined(run: Pick<MilestoneRunDto, 'confined'>, environments: ProjectEnvironmentsDto | undefined): boolean | null {
  if (run.confined !== null) return run.confined
  return environments ? environments.autonomousConfined : null
}

/** Confiner n'a de sens que si l'emplacement du projet le permet (spec §2.6-2). */
export function canConfine(environments: ProjectEnvironmentsDto): boolean {
  return launchEnvironments(environments).some((choice) => choice.confined)
}

type Translate = (key: MessageKey, params?: MessageParams) => string

/** « Fusionner dans {base} » (RUN-12) ; la branche par défaut tant que la base n'est pas relevée. */
export function runMergeLabel(pr: Pick<CardBranchPrDto, 'base'>, t: Translate): string {
  return pr.base ? t('milestone.run.merge', { base: pr.base }) : t('milestone.run.mergeDefault')
}
