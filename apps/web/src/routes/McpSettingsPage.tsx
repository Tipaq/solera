import { useTranslate } from '../lib/i18n'
import { McpRegistry } from '../components/mcp/McpRegistry'
import { SectionHeader } from './SettingsPage'

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
      <McpRegistry />
    </div>
  )
}
