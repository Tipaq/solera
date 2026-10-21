import type { StorybookConfig } from '@storybook/react-vite'

/**
 * Catalogue du design system de Solera.
 *
 * Son propre espace de travail, et non une page de l'application : c'est un outil de
 * conception, rien n'en part dans le produit. `apps/web` ne porte plus aucune
 * dépendance Storybook.
 *
 * Les stories, elles, restent **à côté de ce qu'elles montrent** — celles des primitives
 * dans `packages/ui`, celles des composants d'application dans `apps/web`. C'est la
 * convention, et elle a une raison : une primitive renommée casse sa story au
 * `typecheck`, ce qu'un dossier de stories tenu à part n'aurait jamais vu venir.
 *
 * Le catalogue ne fait donc que les rassembler, et porter la documentation.
 */
const config: StorybookConfig = {
  stories: [
    // La documentation et les motifs, qui n'appartiennent à aucun des deux autres.
    '../src/**/*.mdx',
    '../src/**/*.stories.@(ts|tsx)',
    // Le design system lui-même.
    '../../../packages/ui/src/**/*.stories.@(ts|tsx)',
    // Les composants d'application : ils ne sont pas le design system, mais c'est là
    // que les variantes divergent, et un catalogue qui ne les montrerait pas laisserait
    // la moitié de l'interface sans référence.
    '../../web/src/**/*.stories.@(ts|tsx)',
  ],
  addons: ['@storybook/addon-docs'],
  // Dépôt privé, outil interne : rien ne part chez Storybook.
  core: { disableTelemetry: true },
  features: { componentsManifest: true },

  framework: {
    name: '@storybook/react-vite',
    options: { builder: { viteConfigPath: '.storybook/vite.config.ts' } },
  },
}

export default config
