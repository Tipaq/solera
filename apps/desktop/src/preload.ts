import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { DesktopBridge, DesktopPlatform, DesktopUpdateState } from '@solera/protocol'
import { UPDATE_CHANNELS, WINDOW_CHANNELS } from './ipc'

/**
 * Le pont entre la fenêtre et le processus principal, seul passage de l'une à l'autre
 * (la fenêtre n'a ni Node ni `ipcRenderer`). Il porte la mise à jour de l'app, que
 * l'écran « À propos » montre et déclenche, et la barre de titre que l'interface dessine.
 */
const bridge: DesktopBridge = {
  updates: {
    state: () => ipcRenderer.invoke(UPDATE_CHANNELS.state) as Promise<DesktopUpdateState>,
    subscribe(listener) {
      const forward = (_event: IpcRendererEvent, state: DesktopUpdateState) => listener(state)
      ipcRenderer.on(UPDATE_CHANNELS.changed, forward)
      return () => {
        ipcRenderer.removeListener(UPDATE_CHANNELS.changed, forward)
      }
    },
    check: () => ipcRenderer.invoke(UPDATE_CHANNELS.check) as Promise<void>,
    install: () => ipcRenderer.invoke(UPDATE_CHANNELS.install) as Promise<void>,
  },
  window: {
    platform: process.platform as DesktopPlatform,
    menu: () => ipcRenderer.invoke(WINDOW_CHANNELS.menu) as Promise<void>,
    colors: (background, foreground) =>
      ipcRenderer.invoke(WINDOW_CHANNELS.colors, background, foreground) as Promise<void>,
  },
}

contextBridge.exposeInMainWorld('soleraDesktop', bridge)
