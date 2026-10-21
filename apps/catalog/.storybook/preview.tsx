import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Decorator, Preview } from '@storybook/react-vite'
import { useEffect, type ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { addons } from 'storybook/preview-api'
import { TooltipProvider, UiLabelsProvider } from '@solera/ui'
import { LOCALES, setLocale, translate, type Locale } from '../../web/src/lib/i18n'
import { SYNTAX_THEMES } from '../../web/src/lib/syntax-theme'
import { THEMES } from '../../web/src/lib/theme'
import '../src/styles.css'

/**
 * Contexte du catalogue.
 *
 * Il rejoue ce que `main.tsx` installe autour de l'application, et rien de plus. Un
 * composant monté sans ce contexte échouerait pour des raisons qui n'ont rien à voir
 * avec lui : une infobulle sans son `Provider`, un `NavLink` sans routeur.
 *
 * C'est la différence qui compte entre un catalogue et une vitrine : ici, un composant
 * qui ne tient que parce qu'un parent lointain lui fournit quelque chose se voit tout
 * de suite, puisque ce parent n'est pas là.
 */

// Un client par session de catalogue, sans reprise ni rafraîchissement : aucune story
// ne doit dépendre du réseau, et un `retry` masquerait une story qui en dépend par
// accident.
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
})

/**
 * Thème et palette, posés sur `<html>` comme dans l'application. Leurs listes sont
 * celles du design system, que `theme.ts` et `syntax-theme.ts` réexportent.
 *
 * Sur la racine du document et non sur un conteneur de story : les jetons sont définis
 * par `:root[data-theme]`, et tout ce qui part en portail — dialogue, menu, infobulle —
 * se rend hors de l'arbre de la story. Par le canal des globals et non par le
 * décorateur : un décorateur n'enveloppe que les stories, et une page MDX sans story
 * resterait sans thème.
 */
function applyTheme(globals: Record<string, unknown>) {
  const root = document.documentElement
  root.dataset.theme = String(globals.theme ?? 'dark')
  const syntax = String(globals.syntax ?? 'solera')
  if (syntax === 'solera') delete root.dataset.syntax
  else root.dataset.syntax = syntax
}

const channel = addons.getChannel()
channel.on('setGlobals', ({ globals }: { globals: Record<string, unknown> }) => applyTheme(globals))
channel.on('globalsUpdated', ({ globals }: { globals: Record<string, unknown> }) => applyTheme(globals))

/**
 * Le cadre d'une story : la langue, et les providers de l'application.
 *
 * Un composant nommé plutôt que le corps du décorateur : un décorateur *est* un rendu
 * de composant, donc il appelle des hooks — et `react-hooks/rules-of-hooks` refuse,
 * avec raison, qu'on appelle un hook depuis une fonction dont le nom n'annonce pas un
 * composant.
 */
function CatalogueFrame({ locale, children }: { locale: string; children: ReactNode }) {
  // La langue compte pour la mise en page, pas seulement pour la lecture : le français
  // est plus long que l'anglais, et c'est lui qui fait déborder un libellé de bouton ou
  // tronquer une ligne de liste. Un catalogue monolingue ne le montrerait jamais.
  useEffect(() => {
    setLocale(locale as Locale)
  }, [locale])

  return (
    <QueryClientProvider client={queryClient}>
      <UiLabelsProvider
        labels={{
          cancel: translate('dialog.cancel'),
          selectPlaceholder: translate('common.select.placeholder'),
        }}
      >
        <TooltipProvider>
          <MemoryRouter>{children}</MemoryRouter>
        </TooltipProvider>
      </UiLabelsProvider>
    </QueryClientProvider>
  )
}

const withTheme: Decorator = (Story, context) => (
  <CatalogueFrame locale={String(context.globals.locale)}>
    <Story />
  </CatalogueFrame>
)

const preview: Preview = {
  decorators: [withTheme],

  globalTypes: {
    theme: {
      description: 'Thème de Solera',
      toolbar: {
        title: 'Thème',
        icon: 'paintbrush',
        items: THEMES.map((value) => ({ value, title: value })),
        dynamicTitle: true,
      },
    },
    locale: {
      description: "Langue de l'interface",
      toolbar: {
        title: 'Langue',
        icon: 'globe',
        items: LOCALES.map((value) => ({ value, title: value })),
        dynamicTitle: true,
      },
    },
    syntax: {
      description: 'Palette de coloration syntaxique',
      toolbar: {
        title: 'Syntaxe',
        icon: 'markup',
        items: SYNTAX_THEMES.map((value) => ({ value, title: value })),
        dynamicTitle: true,
      },
    },
  },

  initialGlobals: { theme: 'dark', syntax: 'solera', locale: 'fr' },

  parameters: {
    // Le fond du canevas suit le thème : un fond fixe aurait menti sur le contraste
    // dans deux thèmes sur trois.
    backgrounds: { disable: true },
    controls: { expanded: true },
    options: {
      // Les règles et les primitives sont dans la section du design system, composée.
      storySort: {
        order: ["Composants d'application", 'Onglet projet du panneau'],
      },
    },
  },
}

export default preview
