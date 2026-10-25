/**
 * Les canaux entre le processus principal et le preload. Dans un module à part : le
 * preload n'embarque qu'eux, et non electron-updater avec le reste de `updates.ts`.
 */
export const UPDATE_CHANNELS = {
  state: 'solera:updates:state',
  check: 'solera:updates:check',
  install: 'solera:updates:install',
  changed: 'solera:updates:changed',
} as const

export const WINDOW_CHANNELS = {
  menu: 'solera:window:menu',
  colors: 'solera:window:colors',
} as const
