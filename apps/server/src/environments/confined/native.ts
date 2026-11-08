import type { Backend, Unavailable } from './backend.js'
import { bwrapBackend, probeBwrap } from './bwrap.js'
import { probeSeatbelt, seatbeltBackend } from './seatbelt.js'

export type NativeConfinement = { backend: Backend } | { unavailable: Unavailable }

/** La plateforme a-t-elle un confinement natif, réussi ou non : Windows n'en a pas (#145). */
export function hasNativeConfinement(platform: NodeJS.Platform = process.platform): boolean {
  return platform === 'linux' || platform === 'darwin'
}

let usable: Backend | null = null

/**
 * Le confinement natif de cette machine, ou pourquoi il ne peut pas démarrer.
 *
 * Seul un succès est retenu : après un refus, l'utilisateur installe bwrap ou pose le
 * profil AppArmor, et l'essai suivant doit le voir sans redémarrer Solera. L'essai coûte
 * un processus, rien à côté d'un CLI d'agent.
 */
export function nativeConfinement(): NativeConfinement {
  if (usable) return { backend: usable }
  if (!hasNativeConfinement()) return { unavailable: { code: 'confinement_platform' } }
  const backend = process.platform === 'darwin' ? seatbeltBackend : bwrapBackend
  const unavailable = process.platform === 'darwin' ? probeSeatbelt() : probeBwrap()
  if (unavailable) return { unavailable }
  usable = backend
  return { backend }
}
