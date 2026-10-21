import type { StorybookConfig } from '@storybook/react-vite'

/**
 * Catalogue des composants d'application de Solera.
 *
 * Le design system n'est plus ici : il vit dans son propre dépôt, avec son propre
 * Storybook, et Solera l'installe comme n'importe quelle dépendance. Ce catalogue-ci ne
 * montre que ce que le design system ne peut pas connaître — les composants qui savent ce
 * qu'est un CLI, un projet ou une conversation — et compose celui du design system par
 * `refs`, pour qu'on parcoure les deux dans une seule fenêtre.
 *
 * C'est un outil de conception, et non une page de l'application : rien n'en part dans le
 * produit, et `apps/web` ne porte aucune dépendance Storybook.
 *
 * Les stories restent **à côté de ce qu'elles montrent**, dans `apps/web` : un composant
 * renommé casse sa story au `typecheck`, ce qu'un dossier de stories tenu à part n'aurait
 * jamais vu venir. Le catalogue ne fait que les rassembler.
 */
const config: StorybookConfig = {
  stories: ['../src/**/*.mdx', '../src/**/*.stories.@(ts|tsx)', '../../web/src/**/*.stories.@(ts|tsx)'],
  // Le Storybook du design system, lancé à part (`pnpm dev` dans son dépôt). Éteint, sa
  // section affiche une erreur et le reste du catalogue marche.
  refs: {
    ds: {
      title: 'Design system',
      url: process.env.SOLERA_DS_STORYBOOK_URL ?? 'http://localhost:6418',
    },
  },
  addons: ['@storybook/addon-docs'],
  // Dépôt privé, outil interne : rien ne part chez Storybook.
  core: { disableTelemetry: true },
  features: { componentsManifest: true },

  framework: {
    name: '@storybook/react-vite',
    options: { builder: { viteConfigPath: '.storybook/vite.config.ts' } },
  },
}

// Lancé par Solera, le catalogue reçoit en plus les prototypes de ses agents (carte #63).
export default process.env.SOLERA_STORYBOOK ? (await import(process.env.SOLERA_STORYBOOK)).default(config) : config
