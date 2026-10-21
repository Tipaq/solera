import { execSync } from 'node:child_process'
import { statSync } from 'node:fs'
import { join } from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

const SERVER_PORT = process.env.SOLERA_PORT ?? '7417'

/**
 * Le budget du chunk d'entrée, en octets non compressés.
 *
 * Workbox refuse de précacher un fichier plus gros que cette valeur, et
 * `vite-plugin-pwa` traite ce refus comme une erreur fatale : au-delà, le build
 * **échoue**, il ne ralentit pas. Les 2 Mio sont la valeur par défaut de Workbox, pas
 * une limite du navigateur — on la garde comme budget parce qu'un précache plus lourd
 * se paie à la première visite et à chaque mise à jour du service worker, sur une
 * connexion qu'on ne choisit pas.
 *
 * C'est donc un chiffre qu'on peut décider de relever, pas une fatalité. Mais il se
 * relève en sachant ce qu'on achète, d'où le garde ci-dessous plutôt qu'un échec muet.
 *
 * Mesuré au 2026-10-14 : 1 542 309 octets, soit 74 % du budget. L'audit des postes et
 * de ce qui reste découpable est dans `docs/audits/2026-10-14-bundle-web/`.
 */
const PRECACHE_BUDGET_BYTES = 2 * 1024 * 1024

/** Au-delà, on prévient sans échouer : il reste de la place, mais plus beaucoup. */
const PRECACHE_WARN_RATIO = 0.9

function formatBytes(value: number): string {
  return value.toLocaleString('fr-FR').replace(/ | /g, ' ')
}

/**
 * Dit la taille du chunk d'entrée, et ce qu'on peut en faire.
 *
 * Sans lui, dépasser le budget produit « Assets exceeding the limit » au milieu d'une
 * pile d'appels de Workbox, qui ne nomme ni le fichier, ni la limite, ni le commit qui
 * vient de la franchir. Celui qui ajoute un écran et casse le build n'a aucun moyen de
 * relier les deux.
 *
 * Il est placé **avant** `VitePWA` dans `plugins` : les hooks de sortie s'exécutent dans
 * l'ordre du tableau, donc ce message arrive à la place de celui de Workbox et non
 * après lui.
 *
 * Ce qu'il ne fait pas : réclamer un découpage. Un budget qui ne propose que « découpe
 * quelque chose » finit par faire découper la route la plus visitée, et on paie en
 * latence sur l'écran principal ce qu'on gagne au démarrage — l'audit conclut
 * explicitement qu'il ne faut pas découper `ConversationPage`. Relever le budget est
 * une réponse légitime, le message le dit.
 */
function precacheBudget(): Plugin {
  /*
   * La mesure se prend en `writeBundle`, mais le verdict tombe en `closeBundle`.
   *
   * Une exception levée depuis `writeBundle` est avalée par Vite : le build continue, et
   * c'est Workbox qui finit par échouer avec son message illisible — exactement ce que
   * ce garde existe pour éviter. `closeBundle` s'exécute assez tard pour que l'erreur
   * remonte, et assez tôt — avant celui de `VitePWA`, qui suit dans `plugins` — pour
   * que ce soit nous qu'on lise.
   */
  const entries: { fileName: string; size: number }[] = []

  return {
    name: 'solera:precache-budget',
    apply: 'build',
    writeBundle(options, bundle) {
      const dir = options.dir ?? 'dist'
      for (const [fileName, chunk] of Object.entries(bundle)) {
        if (chunk.type !== 'chunk' || !chunk.isEntry) continue
        entries.push({ fileName, size: statSync(join(dir, fileName)).size })
      }
    },
    closeBundle() {
      for (const { fileName, size } of entries) {
        const share = size / PRECACHE_BUDGET_BYTES
        const summary =
          `${fileName} : ${formatBytes(size)} octets, ` +
          `${Math.round(share * 100)} % du budget de précache ` +
          `(${formatBytes(PRECACHE_BUDGET_BYTES)})`

        if (size > PRECACHE_BUDGET_BYTES) {
          throw new Error(
            `Budget de précache dépassé.\n\n  ${summary}\n` +
              `  Dépassement : ${formatBytes(size - PRECACHE_BUDGET_BYTES)} octets.\n\n` +
              'Workbox va refuser de précacher ce fichier, et vite-plugin-pwa en fera une\n' +
              "erreur fatale. Trois réponses, et le choix n'est pas évident :\n\n" +
              '  1. Charger à la demande un écran rare — le geste déjà appliqué au panneau\n' +
              "     du Travail, à la visionneuse 3D et à l'éditeur de skill.\n" +
              "  2. Relever PRECACHE_BUDGET_BYTES dans ce fichier. C'est permis : les 2 Mio\n" +
              "     sont un défaut de Workbox, pas une limite du navigateur. Ça se paie à la\n" +
              '     première visite et à chaque mise à jour du service worker.\n' +
              "  3. Corriger un import trop large — c'est ce qui a rendu 150 Ko sur cronstrue.\n\n" +
              'À ne pas faire : découper la chaîne de conversation. Elle est dans le chunk\n' +
              "d'entrée parce que c'est la route la plus visitée de l'application ; l'en sortir\n" +
              "déplace le coût sur l'écran principal au lieu de le supprimer.\n\n" +
              'Les postes du bundle, chiffrés et classés, avec ce qui reste découpable et ce\n' +
              'qui est structurel : docs/audits/2026-10-14-bundle-web/',
          )
        }

        if (share >= PRECACHE_WARN_RATIO) {
          this.warn(
            `Budget de précache bientôt atteint — ${summary}. ` +
              `Reste ${formatBytes(PRECACHE_BUDGET_BYTES - size)} octets. ` +
              'Voir docs/audits/2026-10-14-bundle-web/ avant d\'ajouter au tronc commun.',
          )
        }
      }
    },
  }
}

// Même résolution que apps/server/tsup.config.ts : tag fourni par la CI de
// release, describe git en build local, `dev` hors dépôt.
function resolveVersion(): string {
  if (process.env.SOLERA_VERSION) return process.env.SOLERA_VERSION.replace(/^v/, '')
  try {
    return execSync('git describe --tags --always --dirty', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim()
  } catch {
    return 'dev'
  }
}

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // Avant `VitePWA`, pour que le dépassement soit expliqué par le garde plutôt que
    // par le « Assets exceeding the limit » de Workbox.
    precacheBudget(),
    VitePWA({
      /*
       * `prompt` et non `autoUpdate`.
       *
       * `autoUpdate` fait bien prendre le contrôle au nouveau service worker, mais la
       * page déjà chargée continue de tourner sur l'ancien code : rien ne la prévient,
       * rien ne la recharge. Sur une PWA installée qui reprend depuis la mémoire au
       * lieu de naviguer, elle restait indéfiniment sur un build périmé, et une
       * correction déployée n'atteignait jamais l'écran.
       *
       * En mode `prompt`, l'application est notifiée et propose le rechargement. Le
       * faire d'autorité perdrait un message en cours de saisie.
       */
      registerType: 'prompt',
      // L'enregistrement se fait depuis l'application, qui a besoin du retour de
      // `useRegisterSW` pour afficher l'invite.
      injectRegister: null,
      // `push-sw.js` doit être copié tel quel : il n'est pas importé par le bundle,
      // c'est le service worker qui le charge à l'exécution.
      includeAssets: ['apple-touch-icon.png', 'favicon.svg', 'push-sw.js'],
      manifest: {
        name: 'Solera',
        short_name: 'Solera',
        description: 'Plateforme de développement agentique self-hosted et multi-CLI',
        lang: 'fr',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait-primary',
        background_color: '#0b0d1c',
        theme_color: '#0b0d1c',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          // `maskable` réserve la zone rognée par les masques d'Android : sans cette
          // entrée, l'icône est recadrée dans le cercle et le motif disparaît.
          { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Écrit, et non laissé au défaut, parce que c'est ce chiffre qui décide si le
        // build passe. Le garde `solera:precache-budget` partage la même constante et
        // s'exécute avant, donc en pratique c'est lui qu'on lit ; cette ligne est là
        // pour que le plafond soit visible là où il s'applique.
        maximumFileSizeToCacheInBytes: PRECACHE_BUDGET_BYTES,
        // Nos écouteurs push sont chargés dans le service worker généré, plutôt que
        // d'écrire celui-ci entièrement à la main : le précache reste géré par Workbox.
        importScripts: ['/push-sw.js'],
        // La coque applicative est précachée, jamais les réponses d'API : les mettre
        // en cache produirait un fil incohérent avec le journal (invariant I2).
        globPatterns: ['**/*.{js,css,html,woff2}'],
        navigateFallback: '/index.html',
        // `/ds/` : les Storybook relayés de la vue Web, qui ne sont pas l'application.
        navigateFallbackDenylist: [/^\/api\//, /^\/ds\//],
        runtimeCaching: [{ urlPattern: /^\/api\//, handler: 'NetworkOnly' }],
        cleanupOutdatedCaches: true,
      },
      devOptions: { enabled: false },
    }),
  ],
  server: {
    port: 5417,
    // Comme le serveur en production (`frame-guard.ts`) : l'interface ne s'affiche dans
    // le cadre de personne, y compris celui du mode Direct de la vue Web.
    headers: { 'content-security-policy': "frame-ancestors 'none'" },
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${SERVER_PORT}`,
        changeOrigin: true,
        ws: true,
      },
      // Les Storybook relayés des design systems liés, websockets de HMR comprises.
      '/ds/': {
        target: `http://127.0.0.1:${SERVER_PORT}`,
        changeOrigin: true,
        ws: true,
      },
    },
  },
  /**
   * Identifiant du build, affiché dans les réglages.
   *
   * Sans lui, « je ne vois pas la correction » ne se tranche pas : rien à l'écran ne
   * dit quelle version tourne réellement.
   */
  define: {
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
    __APP_VERSION__: JSON.stringify(resolveVersion()),
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
})
