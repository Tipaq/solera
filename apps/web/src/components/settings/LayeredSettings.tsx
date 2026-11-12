import { Bot, HandHelping, ShieldAlert, ShieldQuestion, SlidersHorizontal, Users } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { agentKindSchema, type AgentKind } from '@solera/protocol'
import { Banner, Card, CardBody, CardHeader, ChoiceList, SegmentedControl, Select } from '@solera/ui'
import { AGENT_LABELS, AGENT_META, AgentIcon } from '../AgentIcon'
import { requestAvailabilityOf, requestSettings, useAgentSettings } from '../chat/agent-settings'
import { type SettingGroup } from '../chat/ComposerSettings'
import { useAccountConfig } from '../../lib/config-layers'
import { useTranslate } from '../../lib/i18n'
import { useMcpServers } from '../../lib/mcp'

/**
 * Les réglages des agents au niveau du compte (#120, Q33) : Réglages › Agents,
 * Permissions et la visite. Les lignes viennent de la même source que le menu « + » du
 * composer (`useAgentSettings`). Le niveau d'un projet a ses propres rangées, dans le
 * brouillon de sa page de réglages (`project-settings/AgentSettingRows`), qui reprennent
 * les listes de clés d'ici.
 */

/** Le réflexe natif du CLI : ce qui reste réglé par CLI dans la section Permissions. */
export const REFLEX_KEYS = ['permission', 'approval', 'sandbox', 'permission-edit', 'permission-bash', 'permission-webfetch']
/** Ce que Solera prête à l'agent, commun à tous les CLI. */
export const LENT_KEYS = ['skillLibrary', 'agentMemory']
/** Ce que « Modèles par défaut » garde (Q32), et ce qui part dans son repli « Avancé ». */
export const MODEL_KEYS = ['model', 'effort', 'account']
export const ADVANCED_KEYS = ['mode', 'speed', 'ultracode', 'outputStyle', 'advisor', 'webSearch']

/** Les champs du contrôle des serveurs MCP, qui n'est pas une catégorie de `SETTING_FIELDS`. */
export const MCP_FIELDS = ['mcpServers', 'soleraMcp', 'strictMcp']

export const pick = (groups: SettingGroup[], keys: string[]) =>
  keys.flatMap((key) => groups.filter((group) => group.key === key))

/**
 * Une ligne de réglage. Trois choix qui s'excluent se montrent en `SegmentedControl`,
 * au-delà en `Select` ; l'aide du choix retenu se lit dessous, avec le ton d'alerte
 * quand il en porte un.
 */
function LayeredRow({ group }: { group: SettingGroup }) {
  const selected = group.options.find((option) => option.value === group.value)
  const segmented = group.options.length === 3 && group.options.every((option) => option.label.length <= 22)

  return (
    <div className="flex flex-col gap-1.5">
      <span className="flex items-center gap-2 text-sm font-medium text-ink-soft">
        {group.icon}
        {group.label}
      </span>
      {segmented ? (
        <SegmentedControl
          label={group.label}
          value={group.value}
          segments={group.options.map((option) => ({ value: option.value, label: option.label }))}
          onChange={group.onChange}
        />
      ) : (
        <Select
          // Sans intitulé visible : il est déjà au-dessus.
          placeholder={group.label}
          value={group.value}
          options={group.options}
          onChange={group.onChange}
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

function Rows({ groups, empty }: { groups: SettingGroup[]; empty?: ReactNode }) {
  if (groups.length === 0) return <>{empty ?? null}</>
  return (
    <div className="flex flex-col gap-5">
      {groups.map((group) => (
        <LayeredRow key={group.key} group={group} />
      ))}
    </div>
  )
}

/**
 * Ce que l'agent demande à Solera (Q32, premier bloc) : quatre lignes à trois états, qui
 * valent pour tous les CLI. Rendu seul par la visite, qui n'en montre pas plus.
 */
export function AgentRequestsCard() {
  const t = useTranslate()
  const registry = useMcpServers().data
  // Les champs partagés se lisent sur n'importe quel CLI : Claude sert de référence, et
  // l'écriture les range en commun.
  const shared = useAccountConfig('claude')
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
          <Rows groups={groups} empty={<p className="text-sm text-ink-faint">{t('settings.permissions.requests.none')}</p>} />
        ) : null}
      </CardBody>
    </Card>
  )
}

/** Le réflexe du CLI (Q32, second bloc) : le mode de permission natif, réglé par CLI. */
export function CliReflexCard() {
  const t = useTranslate()
  const [agent, setAgent] = useState<AgentKind>('claude')
  const current = useAccountConfig(agent)
  const { groups } = useAgentSettings({ config: current.config, onConfigChange: current.write })

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
        {current.ready ? <Rows groups={pick(groups, REFLEX_KEYS)} /> : null}
      </CardBody>
    </Card>
  )
}

/** Ce que Solera prête à l'agent : outils, mémoire, skills, serveurs MCP. Commun aux CLI. */
function LentCard() {
  const t = useTranslate()
  const shared = useAccountConfig('claude')
  const { groups, mcp } = useAgentSettings({ config: shared.config, onConfigChange: shared.write })

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
            <Rows groups={pick(groups, LENT_KEYS)} />
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-ink-soft">{t('cliDefaults.mcp.label')}</span>
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
export function PermissionsSettings() {
  return (
    <div className="flex flex-col gap-4">
      <AgentRequestsCard />
      <CliReflexCard />
      <LentCard />
    </div>
  )
}

/** Modèle, effort et abonnement d'un CLI, et son repli « Avancé ». */
export function AgentModelCard({ agent }: { agent: AgentKind }) {
  const t = useTranslate()
  const current = useAccountConfig(agent)
  const { groups, catalogError } = useAgentSettings({ config: current.config, onConfigChange: current.write })
  const advanced = pick(groups, ADVANCED_KEYS)

  return (
    <Card>
      <CardHeader
        title={t('settings.models.agent.title')}
        description={t('settings.models.agent.description')}
        icon={<SlidersHorizontal size={16} />}
      />
      <CardBody className="flex flex-col gap-5">
        {catalogError ? <Banner tone="caution">{t('composer.catalog.unavailable')}</Banner> : null}
        {current.error ? <Banner>{t('settings.layer.saveError')}</Banner> : null}
        {current.ready ? (
          <>
            <Rows groups={pick(groups, MODEL_KEYS)} />
            {advanced.length > 0 ? (
              <details className="group flex flex-col gap-4">
                <summary className="cursor-pointer text-sm font-medium text-ink-soft">{t('settings.models.advanced')}</summary>
                <div className="pt-4">
                  <Rows groups={advanced} />
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
export function SharedModelCard() {
  const t = useTranslate()
  const shared = useAccountConfig('claude')
  const { groups } = useAgentSettings({ config: shared.config, onConfigChange: shared.write })

  return (
    <Card>
      <CardHeader
        title={t('settings.models.shared.title')}
        description={t('settings.models.shared.description')}
        icon={<Users size={16} />}
      />
      <CardBody>
        {shared.ready ? <Rows groups={pick(groups, ['queue'])} /> : null}
      </CardBody>
    </Card>
  )
}
