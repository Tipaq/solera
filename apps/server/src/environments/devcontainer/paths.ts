import { posix, win32 } from 'node:path'

/**
 * Où un dossier de l'hôte se monte dans un conteneur Linux (#151).
 *
 * Sous Linux et macOS, au même chemin : rien n'est à traduire. Sous Windows natif, un
 * chemin `C:\…` n'existe pas dans un conteneur Linux ; il y devient `/mnt/c/…`, comme
 * sous WSL. Le préfixe garde la disposition relative des dossiers d'un même lecteur :
 * c'est ce qui permet aux liens relatifs d'un worktree de rester valides dedans.
 *
 * Un chemin UNC (`\\serveur\partage`) n'a pas de traduction : null.
 */
export function containerPathOf(hostPath: string, platform: NodeJS.Platform = process.platform): string | null {
  if (platform !== 'win32') return hostPath
  const resolved = win32.resolve(hostPath)
  const drive = /^([A-Za-z]):\\?(.*)$/.exec(resolved)
  if (!drive) return null
  const rest = drive[2]!.split('\\').filter(Boolean)
  return posix.join('/mnt', drive[1]!.toLowerCase(), ...rest)
}

/** L'inverse de `containerPathOf` : un chemin du conteneur, rendu à l'hôte ; null hors de `/mnt/<lecteur>`. */
export function hostPathOf(insidePath: string, platform: NodeJS.Platform = process.platform): string | null {
  if (platform !== 'win32') return insidePath
  const mounted = /^\/mnt\/([a-z])(?:\/(.*))?$/.exec(posix.normalize(insidePath))
  if (!mounted) return null
  return win32.join(`${mounted[1]!.toUpperCase()}:\\`, ...(mounted[2] ?? '').split('/').filter(Boolean))
}
