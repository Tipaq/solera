// @ts-check
import { isAbsolute, join, relative, sep } from 'node:path'

/**
 * Ce que Solera ajoute au Storybook d'un design system qu'il lance (carte #63).
 *
 * Le DS ne porte qu'une ligne, à la fin de son `.storybook/main.ts` :
 *
 *   export default process.env.SOLERA_STORYBOOK ? (await import(process.env.SOLERA_STORYBOOK)).default(config) : config
 *
 * Une ligne qui charge ce module plutôt que la configuration elle-même : ce dont Solera
 * a besoin peut changer sans qu'on retouche chaque DS. Hors de Solera, la variable est
 * absente et le Storybook du DS reste le sien.
 *
 * Trois ajouts, lus dans l'environnement que pose `design-system/storybooks.ts` :
 *
 * - **les prototypes** (`SOLERA_PROTOTYPES`) : un dossier de stories hors du dépôt du
 *   projet et de celui du DS, un sous-dossier par projet ;
 * - **le préfixe** (`SOLERA_STORYBOOK_BASE`) : l'aperçu est relayé par Solera sous
 *   `/ds/<jeton>/`, pour être joignable là où Solera l'est, téléphone compris. Vite
 *   doit donc servir ses modules sous ce chemin ;
 * - **la résolution** des imports d'un prototype : un fichier hors du dépôt ne trouve
 *   aucun `node_modules` en remontant. Ses imports nus sont résolus comme s'ils
 *   venaient du DS, ce qui leur donne les mêmes paquets, et le même React.
 *
 * Écrit en `.mjs` sans dépendance : il est chargé par le Storybook du DS, depuis le
 * dossier de Solera, où ni `vite` ni `storybook` ne se résolvent.
 */
export default function withSolera(config) {
  const prototypes = process.env.SOLERA_PROTOTYPES
  const base = process.env.SOLERA_STORYBOOK_BASE
  if (!prototypes) return config

  // Le Storybook est lancé depuis le dossier du DS (`cwd`) : c'est de là que ses
  // propres imports se résolvent.
  const anchor = join(process.cwd(), '.storybook', 'main.ts')
  const inside = (file) => {
    const path = relative(prototypes, file.split('?')[0])
    return path !== '' && !path.startsWith('..') && !isAbsolute(path)
  }

  /** @type {any} */
  const plugin = {
    name: 'solera:prototypes',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      if (!importer || !inside(importer)) return null
      if (source.startsWith('.') || source.startsWith('/') || source.startsWith('\0')) return null
      if (source.includes(':')) return null
      return this.resolve(source, anchor, { ...options, skipSelf: true })
    },
    // Tailwind v4 ne génère que les classes qu'il a vues dans ses sources, et le dossier
    // des prototypes n'en est pas : une mise en page qui n'emploie que l'échelle du DS
    // resterait sans style. Ajouté à la feuille qui importe Tailwind, et à elle seule.
    transform(code, id) {
      if (!/\.css(?:$|\?)/.test(id)) return null
      if (!/@import\s+['"]tailwindcss['"]/.test(code)) return null
      return { code: `${code}\n@source ${JSON.stringify(prototypes)};\n`, map: null }
    },
  }

  return {
    ...config,
    stories: async (entries, options) => {
      const own =
        typeof config.stories === 'function' ? await config.stories(entries, options) : (config.stories ?? [])
      return [...own, { directory: prototypes, files: '**/*.stories.@(ts|tsx|js|jsx)', titlePrefix: 'Prototypes' }]
    },
    viteFinal: async (vite, options) => {
      const own = config.viteFinal ? await config.viteFinal(vite, options) : vite
      return {
        ...own,
        ...(base ? { base } : {}),
        plugins: [plugin, ...(own.plugins ?? [])],
        server: {
          ...own.server,
          // Storybook donne au client HMR le port de son propre serveur. Derrière le
          // relais, ce port n'est joignable que de la machine : sans lui, le client
          // prend celui de la page, donc celui de Solera.
          ...(base && own.server?.hmr && typeof own.server.hmr === 'object'
            ? { hmr: { ...own.server.hmr, port: undefined } }
            : {}),
          fs: {
            ...own.server?.fs,
            // Ajouté seulement si le DS a déjà sa liste : la poser de rien retirerait à
            // Vite sa règle par défaut, la racine de l'espace de travail.
            ...(own.server?.fs?.allow ? { allow: [...own.server.fs.allow, prototypes + sep] } : {}),
          },
        },
      }
    },
  }
}
