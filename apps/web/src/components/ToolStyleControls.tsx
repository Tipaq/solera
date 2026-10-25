import { ChoiceList } from '@solera/ui'
import type { ToolItem } from '../lib/chat-fold'
import { useTranslate } from '../lib/i18n'
import { TOOL_STYLES, TOOL_STYLE_HINTS, TOOL_STYLE_LABELS, useToolStyle } from '../lib/tool-style'
import { ToolCallGroup } from './chat/ToolCall'

/**
 * Trois appels d'exemple, un par origine : un outil de Solera, un MCP d'ailleurs, un
 * outil du CLI en cours. Ils passent par les vrais composants, sans conversation ni
 * sortie à demander au serveur.
 */
const PREVIEW: ToolItem[] = [
  { kind: 'tool', id: 'preview-solera', name: 'solera/read_memory', ts: 0, input: { file: 'project.md' }, output: 'project.md', outputBytes: null, status: 'done', durationMs: 120, parentToolCallId: null },
  { kind: 'tool', id: 'preview-mcp', name: 'github/issue_read', ts: 0, input: { number: 58 }, output: '#58', outputBytes: null, status: 'done', durationMs: 350, parentToolCallId: null },
  { kind: 'tool', id: 'preview-native', name: 'Edit', ts: 0, input: { file_path: 'src/App.tsx', old_string: 'a', new_string: 'b\nc' }, output: null, outputBytes: null, status: 'running', durationMs: null, parentToolCallId: null },
]

/** La présentation des outils dans le fil, avec son aperçu à côté du choix. */
export function ToolStyleControls() {
  const [style, setStyle] = useToolStyle()
  const t = useTranslate()
  return (
    <div className="flex flex-col gap-4">
      <ChoiceList
        label={t('toolStyle.label')}
        value={style}
        options={TOOL_STYLES.map((option) => ({ value: option, label: t(TOOL_STYLE_LABELS[option]), hint: t(TOOL_STYLE_HINTS[option]) }))}
        onChange={setStyle}
      />
      <div className="flex flex-col gap-2 rounded-md border border-line bg-canvas p-3" data-tool-style-preview>
        <span className="text-xs font-medium text-ink-soft">{t('toolStyle.preview')}</span>
        <p className="text-sm text-ink">{t('toolStyle.sample')}</p>
        <ToolCallGroup tools={PREVIEW} complete={false} conversationId="appearance-preview" variant={style} />
      </div>
    </div>
  )
}
