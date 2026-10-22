import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TooltipProvider, UiLabelsProvider } from '@solera/ui'
import { App } from './App'
import { initLocale, translate } from './lib/i18n'
import { watchThemeColor } from './lib/theme'
import './styles/index.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: true,
      retry: 1,
    },
  },
})

watchThemeColor()

const container = document.getElementById('root')
if (!container) throw new Error('Élément #root absent du document.')

// Le catalogue de la langue retenue arrive avant le premier rendu : rendre d'abord
// ferait clignoter l'interface en anglais le temps de le télécharger. `initLocale` ne
// rejette jamais (repli sur l'anglais), et un `then` plutôt qu'un `await` de premier
// niveau évite d'exiger cette syntaxe des navigateurs ciblés.
void initLocale().then(() => {
  createRoot(container).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        {/* Les deux libellés que les primitives portent elles-mêmes. Le design system
            ne connaît pas le catalogue de traduction : c'est l'application qui les lui
            donne, une fois. */}
        <UiLabelsProvider
          labels={{
            cancel: translate('dialog.cancel'),
            selectPlaceholder: translate('common.select.placeholder'),
          }}
        >
          <TooltipProvider><App /></TooltipProvider>
        </UiLabelsProvider>
      </QueryClientProvider>
    </StrictMode>,
  )
})
