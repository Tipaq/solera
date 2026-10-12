import * as Dialog from '@radix-ui/react-dialog'
import { PlugZap, X } from 'lucide-react'
import { IconButton } from '@solera/ui'
import { useTranslate } from '../../lib/i18n'
import { setMcpRegistryOpen, useMcpRegistryOpen } from '../../lib/mcp-registry'
import { McpRegistry } from './McpRegistry'

/**
 * Le registre des serveurs MCP, en modale.
 *
 * C'est le seul endroit où l'on **écrit** une commande, une variable ou une adresse.
 * La liste du « + » du composer, elle, ne fait que lire et allumer : elle répond à
 * « avec quels outils cet agent travaille », pas à « comment ce serveur se lance ».
 *
 * Montée par la coque et non par le composer : elle s'ouvre depuis un menu, et un
 * dialogue rendu dans un menu disparaît avec lui au moment même où on le demande.
 */
export function McpRegistryDialog() {
  const t = useTranslate()
  const open = useMcpRegistryOpen()

  return (
    <Dialog.Root open={open} onOpenChange={setMcpRegistryOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="scrim z-40" />
        <Dialog.Content
          aria-describedby={undefined}
          className="surface fixed top-1/2 left-1/2 z-50 flex max-h-[90dvh] w-[min(52rem,94vw)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border border-line shadow-pop"
        >
          <div className="flex shrink-0 items-center gap-2 border-b border-line px-4 py-3">
            <PlugZap size={16} className="shrink-0 text-ink-faint" />
            {/* « Gérer les serveurs MCP » et non « Serveurs MCP » : la vue du « + »
                porte déjà ce nom, et deux surfaces homonymes à l'écran en même temps
                ne se distinguent ni à l'œil ni à un lecteur d'écran. */}
            <Dialog.Title className="min-w-0 flex-1 truncate text-sm font-semibold">
              {t('mcp.registry.title')}
            </Dialog.Title>
            <Dialog.Close asChild>
              <IconButton label={t('common.close')}><X size={16} /></IconButton>
            </Dialog.Close>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            <McpRegistry />
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
