import { statfsSync } from 'node:fs'
import { chromium } from 'playwright'

/**
 * Le Chromium des suites d'interface.
 *
 * Playwright le lance avec `--disable-dev-shm-usage`, pensé pour les conteneurs où
 * `/dev/shm` ne fait que 64 Mo : Chromium loge alors sa mémoire partagée dans `$TMPDIR`,
 * en fichiers effacés aussitôt créés, donc invisibles à `ls`. Chaque réponse en vol en
 * prend un tampon, et le serveur de dev de Vite en sert plus de trois cents d'un coup.
 * Sur un `/tmp` en tmpfs presque plein, une partie des tampons ne se crée pas : les
 * modules échouent en `net::ERR_INSUFFICIENT_RESOURCES`, React ne monte pas, et la suite
 * casse plus loin sur une page blanche, à une étape qui change d'un essai à l'autre
 * (carte #98). Reproduit avec un tmpfs de 16 Mo comme `$TMPDIR` du navigateur.
 *
 * Quand `/dev/shm` a de la place, on la lui rend : c'est l'endroit fait pour, et il ne
 * dépend plus de ce que les autres process laissent dans `/tmp`.
 */
export function launchBrowser(options = {}) {
  return chromium.launch({
    channel: 'chromium',
    chromiumSandbox: true,
    ignoreDefaultArgs: roomyDevShm() ? ['--disable-dev-shm-usage'] : [],
    ...options,
  })
}

const minimumDevShm = 512 * 1024 * 1024

function roomyDevShm() {
  try {
    const stats = statfsSync('/dev/shm')
    return stats.bavail * stats.bsize >= minimumDevShm
  } catch {
    return false
  }
}
