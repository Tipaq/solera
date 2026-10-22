import { existsSync } from 'node:fs'
import type { UpdateChannel } from '@solera/protocol'
import { INSTANCE_PROFILE } from '../instance/profile.js'

/**
 * L'unité systemd générée par install.sh pose SOLERA_INSTALL_DIR, l'image
 * Docker pose SOLERA_UPDATE_CHANNEL=docker. Le test /.dockerenv couvre une
 * image dérivée qui aurait perdu la variable. Tout le reste (checkout de dev,
 * layout inconnu) ne doit jamais permettre de mise à jour intégrée : on
 * écraserait des fichiers qu'on ne gère pas.
 */
export function detectChannel(): UpdateChannel {
  // L'application de bureau se remplace par sa nouvelle version : le serveur qu'elle
  // embarque ne touche jamais à ses propres fichiers.
  if (INSTANCE_PROFILE === 'desktop') return 'desktop'
  if (process.env.SOLERA_UPDATE_CHANNEL === 'docker' || existsSync('/.dockerenv')) {
    return 'docker'
  }
  if (process.env.SOLERA_INSTALL_DIR) return 'installer'
  return 'none'
}

/** Racine du layout installeur (contient releases/ et le lien current). */
export function installDir(): string {
  const dir = process.env.SOLERA_INSTALL_DIR
  if (!dir) throw new Error('SOLERA_INSTALL_DIR non défini')
  return dir
}
