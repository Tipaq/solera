import { useTranslate } from '../lib/i18n'
import { openSettings } from '../lib/settings-dialog'
import { McpRegistry } from '../components/mcp/McpRegistry'
import { SectionHeader } from '../components/settings/SectionHeader'

/**
 * La section *Serveurs MCP* des réglages.
 *
 * Elle ne fait que poser son titre : le registre lui-même vit dans un composant
 * partagé, parce que la modale du « + » du composer montre exactement la même chose
 * et qu'une seconde copie aurait divergé dès le premier champ ajouté.
 */
export function McpSettingsPage() {
  const t = useTranslate()
  return (
    <div className="flex flex-col gap-4">
      <SectionHeader title={t('mcp.section.title')} description={t('mcp.section.description')} />
      {/* Deux sens du même mot : ici, des serveurs que Solera donne aux agents ; sous
          « API et MCP », celui que Solera expose lui-même. Le dire évite de chercher ici
          comment brancher un outil extérieur. Hors du registre, que le « + » du
          composer montre aussi et où ce renvoi n'aurait rien à faire. */}
      <p className="text-sm text-ink-faint">
        {t('mcp.ownServer')}{' '}
        <button type="button" onClick={() => openSettings('api')} className="text-accent hover:underline">
          {t('mcp.ownServer.link')}
        </button>
      </p>
      <McpRegistry />
    </div>
  )
}
