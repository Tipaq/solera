import { RotateCcw, ShieldAlert } from 'lucide-react'
import { useState } from 'react'
import { agentKindSchema, type AgentKind, type ConfigSource, type ProjectDto } from '@solera/protocol'
import { SegmentedControl, Select } from '@solera/ui'
import { AGENT_LABELS, AgentIcon } from '../AgentIcon'
import { requestAvailabilityOf, requestSettings, useAgentSettings } from '../chat/agent-settings'
import { SETTING_FIELDS, type SettingGroup } from '../chat/ComposerSettings'
import { ADVANCED_KEYS, LENT_KEYS, MCP_FIELDS, MODEL_KEYS, REFLEX_KEYS, pick } from '../settings/LayeredSettings'
import type { SettingItem } from '../settings-page/SettingRow'
import type { ConfigLayerDraft, DraftLevelConfig } from '../../lib/config-layers'
import { useTranslate } from '../../lib/i18n'
import { useMcpServers } from '../../lib/mcp'

/**
 * Les réglages d'agent du projet, à plat (page projet v2, PP-22) : des rangées comme les
 * autres, libellé et aide à gauche, contrôle à droite, et non plus des cartes dans un
 * bloc. Les mêmes lignes que le menu « + » du composer (`useAgentSettings`), changées
 * dans le brouillon de la page et enregistrées avec le reste.
 */

/**
 * Ce que les libellés d'un segment tiennent, ensemble, dans la colonne du contrôle
 * (18 rem au large, la largeur du téléphone sinon). Au-delà, il en déborde — « Interdit ·
 * Demande mon accord · Automatique » le faisait dans le prototype — et la liste prend le
 * relais.
 */
const SEGMENT_LABELS_MAX = 26

const isLocal = (sources: Record<string, ConfigSource>, fields: string[]) =>
  fields.some((field) => sources[field] === 'project')

/**
 * Le contrôle d'une rangée : un segment pour trois choix courts au plus, s'il tient dans
 * sa colonne, une liste sinon. Un choix à risque dit son indice dessous, en ambre ; les
 * autres le donnent comme aide de la rangée.
 */
export function GroupControl({ group }: { group: SettingGroup }) {
  const selected = group.options.find((option) => option.value === group.value)
  const segmented =
    group.options.length <= 3 &&
    group.options.reduce((total, option) => total + option.label.length, 0) <= SEGMENT_LABELS_MAX
  return (
    <div className="flex flex-col gap-1.5">
      {segmented ? (
        <SegmentedControl
          label={group.label}
          value={group.value}
          segments={group.options.map((option) => ({ value: option.value, label: option.label }))}
          onChange={group.onChange}
        />
      ) : (
        <Select placeholder={group.label} value={group.value} options={group.options} onChange={group.onChange} />
      )}
      {selected?.tone === 'caution' && selected.hint ? (
        <p className="flex items-start gap-1.5 text-xs text-caution">
          <ShieldAlert size={13} className="mt-0.5 shrink-0" />
          {selected.hint}
        </p>
      ) : null}
    </div>
  )
}

/**
 * « hérité du compte », ou « modifié ici » avec le retour à l'héritage d'un clic. Une
 * mention en toutes lettres sous le contrôle, lue comme un lien : ni badge ni bouton de
 * plus dans une rangée qui a déjà le sien.
 */
export function Inheritance({ local, onReset }: { local: boolean; onReset: () => void }) {
  const t = useTranslate()
  return local ? (
    <button
      type="button"
      onClick={onReset}
      title={t('settings.layer.reset')}
      className="inline-flex items-center gap-1 self-start text-xs text-accent hover:underline"
    >
      {t('projectSettings.inheritance.local')}
      <RotateCcw size={11} aria-hidden />
    </button>
  ) : (
    <span className="text-xs text-ink-faint">{t('projectSettings.inheritance.inherited')}</span>
  )
}

/** Le CLI dont on règle ce qui ne vaut que pour lui. */
export function AgentPick({ agent, onChange }: { agent: AgentKind; onChange: (agent: AgentKind) => void }) {
  const t = useTranslate()
  return (
    <SegmentedControl<AgentKind>
      label={t('projectSettings.item.cli.label')}
      value={agent}
      className="flex w-full flex-wrap md:inline-flex md:w-auto"
      segments={agentKindSchema.options.map((value) => ({
        value,
        label: AGENT_LABELS[value],
        icon: <AgentIcon agent={value} size={14} />,
      }))}
      onChange={onChange}
    />
  )
}

/**
 * Les rangées de la catégorie Agents, pour le propriétaire : un projet partagé n'en
 * montre à ses membres que « Ce que les agents savent ».
 */
export function useAgentSettingItems(project: ProjectDto, draft: ConfigLayerDraft): SettingItem[] {
  const t = useTranslate()
  const registry = useMcpServers().data
  const owner = project.isOwner
  const [agent, setAgent] = useState<AgentKind>('claude')

  // Les champs communs se lisent sur n'importe quel CLI : Claude sert de référence, et
  // l'écriture les range en commun.
  const shared = draft.level('claude')
  const sharedSettings = useAgentSettings({ config: shared.config, onConfigChange: shared.write, disabled: !owner })
  const own = draft.level(agent)
  const ownSettings = useAgentSettings({ config: own.config, onConfigChange: own.write, disabled: !owner })
  if (!owner || !draft.ready) return []

  const groups = {
    requests: t('projectSettings.group.requests'),
    lent: t('projectSettings.group.lent'),
    permissions: t('projectSettings.group.permissions'),
    model: t('projectSettings.group.model'),
  }
  type Section = keyof typeof groups

  const row = (section: Section, group: SettingGroup, level: DraftLevelConfig): SettingItem => {
    const fields = SETTING_FIELDS[group.key] ?? []
    const selected = group.options.find((option) => option.value === group.value)
    return {
      id: `agent-${section}-${group.key}`,
      category: 'agents',
      group: groups[section],
      kind: 'row',
      label: group.label,
      help: selected?.tone === 'caution' ? undefined : selected?.hint,
      changed: level.changed(fields),
      render: () => (
        <div className="flex flex-col gap-1">
          <GroupControl group={group} />
          <Inheritance local={isLocal(level.sources, fields)} onReset={() => level.reset(fields)} />
        </div>
      ),
    }
  }

  /* Le CLI choisi ne montre que ses rangées : ce que le brouillon change pour un autre se
     marque sur la rangée du CLI, et par elle sur la catégorie. */
  const cliRow = (section: Section, keys: string[]): SettingItem => {
    const fields = new Set(keys.flatMap((key) => SETTING_FIELDS[key] ?? []))
    return {
      id: `agent-${section}-cli`,
      category: 'agents',
      group: groups[section],
      kind: 'row',
      label: t('projectSettings.item.cli.label'),
      help: t('projectSettings.item.cli.help'),
      changed: draft.changed.some((key) => {
        const [scope, field] = key.split('.')
        return field !== undefined && scope !== agent && fields.has(field)
      }),
      render: () => <AgentPick agent={agent} onChange={setAgent} />,
    }
  }
  /* Les réglages avancés ne se règlent plus au projet (R-5.4) ; un projet qui en change un
     le montre encore, pour qu'on le voie et qu'on le rende à l'héritage. */
  const advanced = pick(ownSettings.groups, ADVANCED_KEYS).filter((group) => {
    const fields = SETTING_FIELDS[group.key] ?? []
    return isLocal(own.sources, fields) || own.changed(fields)
  })

  return [
    ...requestSettings(shared.config, null, shared.write, t, requestAvailabilityOf(registry)).map((group) =>
      row('requests', group, shared),
    ),
    ...pick(sharedSettings.groups, LENT_KEYS).map((group) => row('lent', group, shared)),
    {
      id: 'agent-lent-mcp',
      category: 'agents',
      group: groups.lent,
      kind: 'row',
      label: t('cliDefaults.mcp.label'),
      help: t('cliDefaults.mcp.hint'),
      keywords: t('projectSettings.item.mcp.keywords').split(/\s+/),
      changed: shared.changed(MCP_FIELDS),
      render: () => (
        <div className="flex flex-col gap-1">
          {/* Le contrôle porte déjà son icône et son décompte. */}
          <div className="flex">{sharedSettings.mcp}</div>
          <Inheritance local={isLocal(shared.sources, MCP_FIELDS)} onReset={() => shared.reset(MCP_FIELDS)} />
        </div>
      ),
    },
    cliRow('permissions', REFLEX_KEYS),
    ...pick(ownSettings.groups, REFLEX_KEYS).map((group) => row('permissions', group, own)),
    cliRow('model', [...MODEL_KEYS, ...ADVANCED_KEYS]),
    ...pick(ownSettings.groups, MODEL_KEYS).map((group) => row('model', group, own)),
    ...advanced.map((group) => row('model', group, own)),
    ...pick(sharedSettings.groups, ['queue']).map((group) => row('model', group, shared)),
  ]
}
