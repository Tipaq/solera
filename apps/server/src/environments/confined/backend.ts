import type { ConfinementPlan } from './plan.js'

/** Le home et le tmp privés d'un bac à sable, sur l'hôte. Effacés à sa fermeture. */
export interface PrivateDirs {
  root: string
  home: string
  tmp: string
}

/** Un lancement, tel que l'appelant le demande, avec l'environnement déjà filtré. */
export interface Launch {
  command: string
  args: string[]
  cwd?: string
  env: Record<string, string>
  /** Dans un pseudo-terminal : il garde sa session et son terminal de contrôle. */
  pty: boolean
}

/** Pourquoi le confinement natif ne peut pas démarrer ici, et quoi lancer pour y remédier. */
export interface Unavailable {
  /** Le code d'erreur, traduit par l'interface. */
  code:
    | 'confinement_platform'
    | 'confinement_bwrap_missing'
    | 'confinement_userns_blocked'
    | 'confinement_macos_too_old'
    | 'confinement_seatbelt_nested'
    | 'confinement_failed'
  /** La commande à lancer, ou le paquet à installer. */
  fix?: string
  /** Ce que l'outil a dit. */
  detail?: string
}

/** Le moteur d'un confinement natif : bwrap sous Linux et WSL, seatbelt sous macOS. */
export interface Backend {
  name: 'bwrap' | 'seatbelt'
  /** Déjà lisibles dans tout bac à sable : la chaîne d'outils les ignore. */
  coveredRoots: readonly string[]
  /** Toujours cachés, même nommés par le `PATH`. */
  deniedRoots: readonly string[]
  /** Le home privé, vu de l'intérieur. */
  home(dirs: PrivateDirs): string
  /** Le tmp privé, vu de l'intérieur. */
  tmp(dirs: PrivateDirs): string
  /**
   * La commande qui lance `launch` confiné. `extraReadable` : les racines
   * d'installation des exécutables de ce lancement. `detached` : le processus a son
   * propre groupe, que la fermeture tue en entier.
   */
  wrap(
    plan: ConfinementPlan,
    dirs: PrivateDirs,
    launch: Launch,
    extraReadable: readonly string[],
  ): { command: string; args: string[]; detached: boolean }
}
