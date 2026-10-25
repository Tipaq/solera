import { BrowserWindow, Menu, ipcMain, type BrowserWindowConstructorOptions, type IpcMainInvokeEvent } from 'electron'
import { WINDOW_CHANNELS } from './ipc'

/** La hauteur de la barre de titre, que l'interface réserve aussi (`--window-bar`). */
const BAR_HEIGHT = 36

/**
 * Une seule barre en haut de la fenêtre, dessinée par l'interface aux couleurs du thème,
 * au lieu de la barre de titre et de la barre de menus natives empilées. Les contrôles de
 * la fenêtre restent ceux du système : les feux de macOS, et hors de macOS la surcouche
 * (`titleBarOverlay`) dont l'interface recolore le fond et les symboles.
 */
export function windowChromeOptions(background: string): BrowserWindowConstructorOptions {
  return {
    titleBarStyle: 'hidden',
    autoHideMenuBar: true,
    titleBarOverlay: { height: BAR_HEIGHT, color: background, symbolColor: '#e1e3ef' },
    ...(process.platform === 'darwin' ? { trafficLightPosition: { x: 14, y: 11 } } : {}),
  }
}

/**
 * Le menu de l'app, que le bouton de la barre ouvre hors de macOS, et les couleurs du
 * thème courant. Seule la page de l'app, et pas un cadre qu'elle contiendrait, pilote sa
 * propre fenêtre.
 */
export function setupWindowChrome(isAppUrl: (url: string) => boolean): void {
  const windowFor = (event: IpcMainInvokeEvent) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win || event.senderFrame !== event.sender.mainFrame || !isAppUrl(event.senderFrame.url)) {
      throw new Error('refused')
    }
    return win
  }
  ipcMain.handle(WINDOW_CHANNELS.menu, (event) => {
    Menu.getApplicationMenu()?.popup({ window: windowFor(event) })
  })
  ipcMain.handle(WINDOW_CHANNELS.colors, (event, background: unknown, foreground: unknown) => {
    const win = windowFor(event)
    if (!isHexColor(background) || !isHexColor(foreground)) throw new Error('invalid colors')
    if (process.platform !== 'darwin') win.setTitleBarOverlay({ color: background, symbolColor: foreground })
    win.setBackgroundColor(background)
  })
}

function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)
}
