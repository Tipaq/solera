import { stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { badRequest } from '../http/errors.js'

/**
 * Le chemin d'un design system, prêt à être lié à un projet.
 *
 * Pour Solera, un DS est un dossier qui porte un `.storybook/` : rien d'autre n'est
 * exigé, ni dépôt git ni nom de paquet, pour qu'un sous-dossier d'un dépôt de DS vaille
 * autant que la racine d'un dépôt dédié. Le chemin est absolu parce que le DS vit hors
 * du dépôt du projet : relatif, il ne saurait pas à quoi se rapporter. `~` est accepté,
 * et déplié ici pour que la base ne garde que des chemins que le serveur peut ouvrir.
 */
export async function assertDesignSystemDir(path: string): Promise<string> {
  const expanded = path === '~' || path.startsWith('~/') ? join(homedir(), path.slice(1)) : path
  if (!isAbsolute(expanded)) {
    throw badRequest('design_system_not_absolute', 'The design system path must be absolute.')
  }

  const resolved = resolve(expanded)
  const info = await stat(resolved).catch(() => null)
  if (!info) {
    throw badRequest('design_system_missing', 'Directory {path} does not exist.', {
      path: resolved,
    })
  }
  if (!info.isDirectory()) {
    throw badRequest('design_system_not_a_directory', '{path} is not a directory.', {
      path: resolved,
    })
  }

  const storybook = await stat(join(resolved, '.storybook')).catch(() => null)
  if (!storybook?.isDirectory()) {
    throw badRequest('design_system_no_storybook', 'Directory {path} has no .storybook folder.', {
      path: resolved,
    })
  }

  return resolved
}
