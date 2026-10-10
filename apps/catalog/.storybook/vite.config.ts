import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

/**
 * Config Vite du catalogue, distincte de celle de l'application.
 *
 * Celle de l'application porte le plugin PWA, le proxy d'API et le manifeste : rien de
 * tout ça n'a de sens dans un catalogue, et le service worker viendrait mettre en cache
 * une coque qui n'est pas celle de Solera.
 *
 * Il ne reste donc que ce dont les composants ont réellement besoin : JSX et Tailwind.
 * Les deux `define` sont là parce que certains modules les lisent à la compilation —
 * sans eux, importer l'un d'eux depuis une story casse le build sur un identifiant
 * inconnu.
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Lus à la compilation par quelques modules de l'application : sans eux, importer
  // l'un d'eux depuis une story casse le build sur un identifiant inconnu.
  define: {
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
    __APP_VERSION__: JSON.stringify('catalogue'),
  },
})
