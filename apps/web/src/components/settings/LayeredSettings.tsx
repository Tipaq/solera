import { Bot, HandHelping, RotateCcw, ShieldAlert, ShieldQuestion, SlidersHorizontal, Users } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { agentKindSchema, type AgentKind, type ConfigSource } from '@solera/protocol'
import { Badge, Banner, Card, CardBody, CardHeader, ChoiceList, IconButton, SegmentedControl, Select } from '@solera/ui'
import { AGENT_LABELS, AGENT_META, AgentIcon } from '../AgentIcon'
import { requestAvailabilityOf, requestSettings, useAgentSettings } from '../chat/agent-settings'
import { SETTING_FIELDS, type SettingGroup } from '../chat/ComposerSettings'
import { useLevelConfig, type SettingsLevel } from '../../lib/config-layers'
import { useTranslate } from '../../lib/i18n'
import { useMcpServers } from '../../lib/mcp'

/**
 * Les réglages des agents, le même composant au compte et au projet (#120, Q33).
 *
 * Trois écrans en rendaient chacun leur version — Réglages → CLI, la page du projet, la
 * visite — avec des formes différentes pour la même valeur. Les lignes viennent ici de la
 * même source que le menu « + » du composer (`useAgentSettings`), et chacune dit, au
 * niveau du projet, si elle est héritée du compte ou modifiée ici, avec de quoi revenir à
 * l'héritage.
 */

/** Le réflexe natif du CLI : ce qui reste réglé par CLI dans la section Permissions. */
const REFLEX_KEYS = ['permission', 'approval', 'sandbox', 'permission-edit', 'permission-bash', 'permission-webfetch']
/** Ce que Solera prête à l'agent, commun à tous les CLI. */
const LENT_KEYS = ['skillLibrary', 'agentMemory']
/** Ce que « Modèles par défaut » garde (Q32), et ce qui part dans son repli « Avancé ». */
const MODEL_KEYS = ['model', 'effort', 'account']
const ADVANCED_KEYS = ['mode', 'speed', 'ultracode', 'outputStyle', 'advisor', 'webSearch']

const pick = (groups: SettingGroup[], keys: string[]) =>
  keys.flatMap((key) => groups.filter((group) => group.key === key))

interface RowContext {
  level: SettingsLevel
  sources: Record<string, ConfigSource>
  reset: (fields: string[]) => void
  disabled: boolean
}

/**
 * Une ligne de réglage. Trois choix qui s'excluent se montrent en `SegmentedControl`,
 * au-delà en `Select` ; l'aide du choix retenu se lit dessous, avec le ton d'alerte
 * quand il en porte un.
 */
export function LayeredRow({ group, context }: { group: SettingGroup; context: RowContext }) {
  const selected = group.options.find((option) => option.value === group.value)
  const fields = SETTING_FIELDS[group.key] ?? []
  const local = context.level.kind === 'project' && fields.some((field) => context.sources[field] === 'project')
  const segmented = group.options.length === 3 && group.options.every((option) => option.label.length <= 22)

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-2 text-sm font-medium text-ink-soft">
          {group.icon}
          {group.label}
        </span>
        {context.level.kind === 'project' ? (
          <InheritanceMark local={local} disabled={context.disabled} onReset={() => context.reset(fields)} />
        ) : null}
      </div>
      {segmented ? (
        <SegmentedControl
          label={group.label}
          value={group.value}
          segments={group.options.map((option) => ({ value: option.value, label: option.label }))}
          onChange={context.disabled ? () => undefined : group.onChange}
        />
      ) : (
        <Select
          // Sans intitulé visible : il est déjà au-dessus, avec la marque d'héritage.
          placeholder={group.label}
          value={group.value}
          options={group.options}
          onChange={group.onChange}
          disabled={context.disabled}
        />
      )}
      {selected?.hint ? (
        <p className={selected.tone === 'caution' ? 'flex items-start gap-1.5 text-xs text-caution' : 'text-xs text-ink-faint'}>
          {selected.tone === 'caution' ? <ShieldAlert size={14} className="mt-0.5 shrink-0" /> : null}
          <span>{selected.hint}</span>
        </p>
      ) : null}
    </div>
  )
}

/**
 * « Hérité du compte » ou « modifié ici », au niveau du projet (Q33), et de quoi revenir
 * à l'héritage d'un clic.
 */
function InheritanceMark({ local, disabled, onReset }: { local: boolean; disabled: boolean; onReset: () => void }) {
  const t = useTranslate()
  return (
    <span className="flex items-center gap-1">
      <Badge tone={local ? 'accent' : 'neutral'}>
        {local ? t('settings.layer.modifiedHere') : t('settings.layer.inherited')}
      </Badge>
      {local && !disabled ? (
        <IconButton size="sm" label={t('settings.layer.reset')} onClick={onReset}>
          <RotateCcw size={14} />
        </IconButton>
      ) : null}
    </span>
  )
}

/** Le choix du CLI, pour les réglages qui restent par CLI. */
function AgentPicker({ agent, onChange }: { agent: AgentKind; onChange: (agent: AgentKind) => void }) {
  const t = useTranslate()
  const agents = agentKindSchema.options.map((value) => ({
    value,
    label: AGENT_LABELS[value],
    hint: AGENT_META[value].vendor,
    icon: <AgentIcon agent={value} size={16} />,
  }))
  return <ChoiceList label={t('draft.cli.legend')} value={agent} options={agents} onChange={onChange} />
}

function Rows({ groups, context, empty }: { groups: SettingGroup[]; context: RowContext; empty?: ReactNode }) {
  if (groups.length === 0) return <>{empty ?? null}</>
  return (
    <div className="flex flex-col gap-5">
      {groups.map((group) => (
        <LayeredRow key={group.key} group={group} context={context} />
      ))}
    </div>
  )
}

/**
 * Ce que l'agent demande à Solera (Q32, premier bloc) : quatre lignes à trois états, qui
 * valent pour tous les CLI. Rendu seul par la visite, qui n'en montre pas plus.
 */
export function AgentRequestsCard({ level }: { level: SettingsLevel }) {
  const t = useTranslate()
  const registry = useMcpServers().data
  // Les champs partagés se lisent sur n'importe quel CLI : Claude sert de référence, et
  // l'écriture les range en commun.
  const shared = useLevelConfig(level, 'claude')
  const context = rowContext(level, shared)
  const groups = requestSettings(shared.config, null, shared.write, t, requestAvailabilityOf(registry))

  return (
    <Card>
      <CardHeader
        title={t('settings.permissions.requests.title')}
        description={t('settings.permissions.requests.description')}
        icon={<HandHelping size={16} />}
      />
      <CardBody className="flex flex-col gap-4">
        {shared.error ? <Banner>{t('settings.layer.saveError')}</Banner> : null}
        {shared.ready ? (
          <Rows groups={groups} context={context} empty={<p className="text-sm text-ink-faint">{t('settings.permissions.requests.none')}</p>} />
        ) : null}
      </CardBody>
    </Card>
  )
}

/** Le réflexe du CLI (Q32, second bloc) : le mode de permission natif, réglé par CLI. */
export function CliReflexCard({ level }: { level: SettingsLevel }) {
  const t = useTranslate()
  const [agent, setAgent] = useState<AgentKind>('claude')
  const current = useLevelConfig(level, agent)
  const { groups } = useAgentSettings({ config: current.config, onConfigChange: current.write, disabled: isReadOnly(level) })

  return (
    <Card>
      <CardHeader
        title={t('settings.permissions.reflex.title')}
        description={t('settings.permissions.reflex.description')}
        icon={<ShieldQuestion size={16} />}
      />
      <CardBody className="flex flex-col gap-5">
        <AgentPicker agent={agent} onChange={setAgent} />
        {current.error ? <Banner>{t('settings.layer.saveError')}</Banner> : null}
        {current.ready ? <Rows groups={pick(groups, REFLEX_KEYS)} context={rowContext(level, current)} /> : null}
      </CardBody>
    </Card>
  )
}

/** Ce que Solera prête à l'agent : outils, mémoire, skills, serveurs MCP. Commun aux CLI. */
function LentCard({ level }: { level: SettingsLevel }) {
  const t = useTranslate()
  const shared = useLevelConfig(level, 'claude')
  const { groups, mcp } = useAgentSettings({ config: shared.config, onConfigChange: shared.write, disabled: isReadOnly(level) })
  const local = level.kind === 'project' && ['mcpServers', 'soleraMcp', 'strictMcp'].some((field) => shared.sources[field] === 'project')

  return (
    <Card>
      <CardHeader
        title={t('settings.permissions.lent.title')}
        description={t('settings.permissions.lent.description')}
        icon={<Bot size={16} />}
      />
      <CardBody className="flex flex-col gap-5">
        {shared.ready ? (
          <>
            <Rows groups={pick(groups, LENT_KEYS)} context={rowContext(level, shared)} />
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium text-ink-soft">{t('cliDefaults.mcp.label')}</span>
                {level.kind === 'project' ? (
                  <InheritanceMark
                    local={local}
                    disabled={isReadOnly(level)}
                    onReset={() => shared.reset(['mcpServers', 'soleraMcp', 'strictMcp'])}
                  />
                ) : null}
              </div>
              {/* Le contrôle porte déjà son icône et son décompte : l'encadrer d'un second
                  repère ferait deux prises pour un seul réglage. */}
              <div className="flex">{mcp}</div>
              <p className="text-xs text-ink-faint">{t('cliDefaults.mcp.hint')}</p>
            </div>
          </>
        ) : null}
      </CardBody>
    </Card>
  )
}

/** La section Permissions, indépendante du CLI pour tout ce qui ne dépend pas de lui (Q32). */
export function PermissionsSettings({ level }: { level: SettingsLevel }) {
  return (
    <div className="flex flex-col gap-4">
      <AgentRequestsCard level={level} />
      <CliReflexCard level={level} />
      <LentCard level={level} />
    </div>
  )
}

/**
 * « Modèles par défaut » : le modèle, l'effort et l'abonnement de chaque CLI (Q32). Les
 * options propres à un CLI sont repliées dans « Avancé » ; l'envoi pendant un tour, qui
 * vaut pour tous, a sa carte. Au projet, le choix du CLI est dans la carte ; aux
 * réglages du compte, la section Agents a déjà un onglet par CLI et pose les deux
 * cartes elle-même.
 */
export function ModelDefaultsSettings({ level }: { level: SettingsLevel }) {
  const [agent, setAgent] = useState<AgentKind>('claude')
  return (
    <div className="flex flex-col gap-4">
      <AgentModelCard level={level} agent={agent} picker={<AgentPicker agent={agent} onChange={setAgent} />} />
      <SharedModelCard level={level} />
    </div>
  )
}

/** Modèle, effort et abonnement d'un CLI, et son repli « Avancé ». */
export function AgentModelCard({ level, agent, picker }: { level: SettingsLevel; agent: AgentKind; picker?: ReactNode }) {
  const t = useTranslate()
  const current = useLevelConfig(level, agent)
  const { groups, catalogError } = useAgentSettings({ config: current.config, onConfigChange: current.write, disabled: isReadOnly(level) })
  const context = rowContext(level, current)
  const advanced = pick(groups, ADVANCED_KEYS)

  return (
    <Card>
      <CardHeader
        title={t('settings.models.agent.title')}
        description={t('settings.models.agent.description')}
        icon={<SlidersHorizontal size={16} />}
      />
      <CardBody className="flex flex-col gap-5">
        {picker}
        {catalogError ? <Banner tone="caution">{t('composer.catalog.unavailable')}</Banner> : null}
        {current.error ? <Banner>{t('settings.layer.saveError')}</Banner> : null}
        {current.ready ? (
          <>
            <Rows groups={pick(groups, MODEL_KEYS)} context={context} />
            {advanced.length > 0 ? (
              <details className="group flex flex-col gap-4">
                <summary className="cursor-pointer text-sm font-medium text-ink-soft">{t('settings.models.advanced')}</summary>
                <div className="pt-4">
                  <Rows groups={advanced} context={context} />
                </div>
              </details>
            ) : null}
          </>
        ) : null}
      </CardBody>
    </Card>
  )
}

/** Ce qui ne dépend pas du CLI : l'envoi pendant un tour. */
export function SharedModelCard({ level }: { level: SettingsLevel }) {
  const t = useTranslate()
  const shared = useLevelConfig(level, 'claude')
  const { groups } = useAgentSettings({ config: shared.config, onConfigChange: shared.write, disabled: isReadOnly(level) })

  return (
    <Card>
      <CardHeader
        title={t('settings.models.shared.title')}
        description={t('settings.models.shared.description')}
        icon={<Users size={16} />}
      />
      <CardBody>
        {shared.ready ? <Rows groups={pick(groups, ['queue'])} context={rowContext(level, shared)} /> : null}
      </CardBody>
    </Card>
  )
}

/** Seul le propriétaire écrit les réglages d'un projet : les autres membres les lisent. */
function isReadOnly(level: SettingsLevel): boolean {
  return level.kind === 'project' && !level.project.isOwner
}

function rowContext(level: SettingsLevel, current: ReturnType<typeof useLevelConfig>): RowContext {
  return { level, sources: current.sources, reset: current.reset, disabled: isReadOnly(level) }
}
