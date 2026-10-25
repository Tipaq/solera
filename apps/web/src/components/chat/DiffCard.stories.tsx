import type { Meta, StoryObj } from '@storybook/react-vite'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
import { DiffCard } from './DiffCard'

const PATCH = `--- a/src/index.ts
+++ b/src/index.ts
@@ -1,3 +1,4 @@
 import { start } from './server'
+import { log } from './log'
 
 start()`

/**
 * Un client amorcé avec le corps du patch : le catalogue n'a pas de serveur, et la
 * carte ouverte lit sa référence dans ce cache au lieu de la demander.
 */
function Seeded({ children }: { children: ReactNode }) {
  const [client] = useState(() => {
    const seeded = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
    seeded.setQueryData(['event-body', 'catalogue', 12, 'patch', undefined], { value: PATCH })
    return seeded
  })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

const meta = {
  title: "Composants d'application/DiffCard",
  component: DiffCard,
  parameters: {
    docs: {
      description: {
        component:
          "Le diff d'un tour, dans le fil.\n\nLa liste des fichiers voyage avec le fil ; le patch, lui, reste au serveur quand il est volumineux, et ne se demande qu'à l'ouverture de la carte. La refermer le libère.",
      },
    },
  },
  render: (args) => (
    <Seeded>
      <div className="w-full max-w-xl">
        <DiffCard {...args} />
      </div>
    </Seeded>
  ),
  args: {
    conversationId: 'catalogue',
    item: {
      kind: 'diff',
      id: 'diff-1',
      files: [
        { path: 'src/index.ts', added: 1, removed: 0 },
        { path: 'src/log.ts', added: 24, removed: 3 },
      ],
      patch: PATCH,
    },
  },
} satisfies Meta<typeof DiffCard>

export default meta
type Story = StoryObj<typeof meta>

/** Un petit patch, arrivé avec le fil. */
export const Leger: Story = {}

/** Un patch volumineux resté au serveur : seule sa référence voyage avec le fil. */
export const Reference: Story = {
  args: {
    item: {
      kind: 'diff',
      id: 'diff-2',
      files: [{ path: 'src/index.ts', added: 1, removed: 0 }],
      patch: '',
      patchRef: { seq: 12, field: 'patch' },
    },
  },
}
