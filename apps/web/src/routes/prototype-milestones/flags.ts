/* PROTOTYPE — jetable (branche proto/page-projet). Ne pas fusionner dans main. */
import { useSyncExternalStore } from 'react'
import type { CardDto } from '@solera/protocol'

/**
 * Le drapeau « jalon » d'une carte (décidé le 2026-11-10) : coché d'office dès qu'elle a
 * des enfants, cochable à la main avant. C'est lui qui fait exister la maturité *Idée*.
 *
 * SIMULÉ : rien côté serveur. Les cartes réelles le gardent dans ce navigateur
 * (localStorage), les cartes de démo le reçoivent du jeu de démo.
 */
const KEY = 'proto-milestone-flags'
const demoFlagged = new Set<string>()
let stored: Set<string> = load()
let version = 0
const listeners = new Set<() => void>()

function load(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(KEY) ?? '[]') as string[])
  } catch {
    return new Set()
  }
}

/** Le jeu de démo pose le drapeau sur ses idées de jalons. */
export function flagDemoCard(id: string) {
  demoFlagged.add(id)
}

export function isFlaggedMilestone(card: Pick<CardDto, 'id' | 'children'>): boolean {
  return card.children.length > 0 || demoFlagged.has(card.id) || stored.has(card.id)
}

export function setMilestoneFlag(id: string, on: boolean) {
  stored = new Set(stored)
  if (on) stored.add(id)
  else stored.delete(id)
  if (!on) demoFlagged.delete(id)
  localStorage.setItem(KEY, JSON.stringify([...stored]))
  version += 1
  listeners.forEach((listener) => listener())
}

/** Change à chaque drapeau posé ou retiré : à mettre dans les dépendances d'un calcul. */
export function useMilestoneFlagsVersion(): number {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => version,
  )
}
