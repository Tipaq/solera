/* PROTOTYPE — jetable (branche proto/page-projet). Ne pas fusionner dans main.
 *
 * Les réglages « à plat » de `page-gauche` : plus de cartes dans des cartes dans des
 * cartes. Les vrais blocs (consignes, mémoire, skills, permissions et modèles, forge,
 * design system) empilaient jusqu'à trois surfaces bordées, chacune avec un titre et
 * une description qui redisaient le groupe. Ici :
 * - un groupe est un titre de texte, ses réglages des rangées séparées d'un filet ;
 * - les réglages d'agent deviennent des rangées comme les autres (libellé et
 *   explication à gauche, contrôle à droite), lues avec les mêmes hooks que le vrai
 *   composant (`useLevelConfig`, `useAgentSettings`, `requestSettings`) ;
 * - les listes (mémoire, skills) sont des lignes simples qui se déplient.
 * Aucune écriture : les réglages d'agent se changent dans une copie locale, comptée
 * dans la barre « modifications non enregistrées » ; le reste est en lecture.
 */
import { ChevronRight, Plus, RotateCcw, ShieldAlert } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { agentKindSchema, type AgentConfig, type AgentKind, type ProjectDto } from '@solera/protocol'
import { Badge, Button, SegmentedControl, Select, cx } from '@solera/ui'
import { AGENT_LABELS, AgentIcon } from '../../components/AgentIcon'
import { requestAvailabilityOf, requestSettings, useAgentSettings } from '../../components/chat/agent-settings'
import { SETTING_FIELDS, type SettingGroup } from '../../components/chat/ComposerSettings'
import { useLevelConfig } from '../../lib/config-layers'
import { relativeDate } from '../../lib/dates'
import { useTranslate } from '../../lib/i18n'
import { useIssueSource } from '../../lib/issues'
import { useMcpServers } from '../../lib/mcp'
import { useSkillLibrary } from '../../lib/skill-library'
import { useSettingItems, type SettingItem, type SettingsModel } from './model'
import { InstructionsPanel, MemoryPanel } from './knowledge'

const REFLEX_KEYS = ['permission', 'approval', 'sandbox', 'permission-edit', 'permission-bash', 'permission-webfetch']
const LENT_KEYS = ['skillLibrary', 'agentMemory']
const MODEL_KEYS = ['model', 'effort', 'account']

const pick = (groups: SettingGroup[], keys: string[]) => keys.flatMap((key) => groups.filter((group) => group.key === key))

/* ------------------------------------------------------------------ copie locale */

/**
 * Une configuration d'agent qu'on change sans l'écrire : la vraie au départ, puis la
 * copie. Ce qui en diffère se compte, champ par champ, pour la barre et les points.
 */
function useLocalConfig(project: ProjectDto, agent: AgentKind) {
  const level = { kind: 'project', project } as const
  const real = useLevelConfig(level, agent)
  const [copy, setCopy] = useState<AgentConfig | null>(null)
  const config = copy && copy.agent === real.config.agent ? copy : real.config
  const changedFields = copy
    ? Object.keys({ ...real.config, ...copy }).filter(
        (field) => JSON.stringify((copy as Record<string, unknown>)[field]) !== JSON.stringify((real.config as Record<string, unknown>)[field]),
      )
    : []
  return { real, config, write: (next: AgentConfig) => setCopy(next), reset: () => setCopy(null), changedFields }
}

/* ------------------------------------------------------------------ contrôles */

/** Le contrôle d'une ligne de réglage d'agent : segments à trois choix courts, liste sinon. */
function GroupControl({ group, disabled }: { group: SettingGroup; disabled: boolean }) {
  const selected = group.options.find((option) => option.value === group.value)
  const segmented = group.options.length <= 3 && group.options.every((option) => option.label.length <= 22)
  return (
    <div className="flex flex-col gap-1.5">
      {segmented ? (
        <SegmentedControl
          label={group.label}
          value={group.value}
          segments={group.options.map((option) => ({ value: option.value, label: option.label }))}
          onChange={disabled ? () => undefined : group.onChange}
        />
      ) : (
        <Select placeholder={group.label} value={group.value} options={group.options} onChange={group.onChange} disabled={disabled} />
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

/** « Hérité du compte » ou « modifié ici », avec le retour à l'héritage. Une ligne de texte, pas un badge de plus. */
function Inheritance({ local, onReset }: { local: boolean; onReset: () => void }) {
  return local ? (
    <button type="button" onClick={onReset} className="inline-flex items-center gap-1 text-xs text-accent hover:underline">
      modifié ici <RotateCcw size={11} />
    </button>
  ) : (
    <span className="text-xs text-ink-faint">hérité du compte</span>
  )
}

function AgentPick({ agent, onChange }: { agent: AgentKind; onChange: (agent: AgentKind) => void }) {
  return (
    <div className="flex flex-wrap gap-1">
      {agentKindSchema.options.map((value) => (
        <button
          key={value}
          type="button"
          onClick={() => onChange(value)}
          className={cx(
            'inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm transition-colors',
            value === agent ? 'bg-surface-high text-ink' : 'text-ink-faint hover:text-ink',
          )}
        >
          <AgentIcon agent={value} size={14} />
          {AGENT_LABELS[value]}
        </button>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ listes à plat */

/** Une ligne de liste qui se déplie : pas de surface, un filet au-dessus. */
function FoldLine({ title, meta, aside, children }: { title: ReactNode; meta?: ReactNode; aside?: ReactNode; children?: ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <li className="border-t border-line first:border-t-0">
      <div className="flex min-h-10 items-center gap-2">
        <button
          type="button"
          disabled={!children}
          onClick={() => setOpen((value) => !value)}
          className="flex min-w-0 flex-1 items-center gap-2 py-2 text-left disabled:cursor-default"
        >
          {children ? <ChevronRight size={13} className={cx('shrink-0 text-ink-faint transition-transform', open && 'rotate-90')} /> : <span className="w-[13px]" />}
          <span className="min-w-0 shrink-0 text-sm">{title}</span>
          {meta ? <span className="min-w-0 truncate text-xs text-ink-faint">{meta}</span> : null}
        </button>
        {aside ? <span className="shrink-0 text-xs text-ink-faint">{aside}</span> : null}
      </div>
      {open && children ? <div className="pb-3 pl-[21px]">{children}</div> : null}
    </li>
  )
}


function SkillsFlat({ projectId }: { projectId: string }) {
  const { data } = useSkillLibrary(projectId)
  const skills = data?.skills ?? []
  const own = skills.filter((skill) => skill.scope === 'project')
  const globals = skills.length - own.length
  return (
    <div className="flex flex-col gap-1">
      {own.length === 0 ? (
        <p className="text-sm text-ink-faint">Aucun skill propre au projet.</p>
      ) : (
        <ul className="flex flex-col">
          {own.map((skill) => (
            <FoldLine key={skill.id} title={<span className="font-mono">{skill.name}</span>} meta={skill.description} aside={skill.enabled ? null : 'désactivé'} />
          ))}
        </ul>
      )}
      <p className="text-xs text-ink-faint">+ {globals} skills de l’instance, livrés ici aussi.</p>
    </div>
  )
}

/* ------------------------------------------------------------------ les rangées */

/**
 * Les réglages de `page-gauche` : ceux de `useSettingItems`, où les blocs empilés sont
 * remplacés par des rangées et des listes à plat. Les réglages d'agent sont comptés à
 * part, dans `agentChanges`, pour la barre du bas.
 */
export function useFlatItems(model: SettingsModel): { items: SettingItem[]; agentChanges: number; resetAgent: () => void } {
  const t = useTranslate()
  const { project, notify } = model
  const owner = project.isOwner
  const base = useSettingItems(model)
  const registry = useMcpServers().data
  const { data: issueSource } = useIssueSource(project.id)

  // Ce qui vaut pour tous les CLI : demandes à Solera, ce que Solera prête, l'envoi.
  const shared = useLocalConfig(project, 'claude')
  const sharedSettings = useAgentSettings({ config: shared.config, onConfigChange: shared.write, disabled: !owner })
  const requests = requestSettings(shared.config, null, shared.write, t, requestAvailabilityOf(registry))

  // Ce qui reste par CLI : le réflexe natif, le modèle.
  const [agent, setAgent] = useState<AgentKind>('claude')
  const own = useLocalConfig(project, agent)
  const ownSettings = useAgentSettings({ config: own.config, onConfigChange: own.write, disabled: !owner })

  const row = (group: SettingGroup, source: ReturnType<typeof useLocalConfig>, section: string): SettingItem => {
    const fields = SETTING_FIELDS[group.key] ?? []
    const local = fields.some((field) => source.real.sources[field] === 'project')
    const selected = group.options.find((option) => option.value === group.value)
    return {
      id: `agent-${section}-${group.key}`,
      category: 'agents',
      group: section,
      label: group.label,
      help: selected?.tone === 'caution' ? undefined : selected?.hint,
      keywords: [group.key],
      kind: 'row',
      span: 'sm',
      changed: fields.some((field) => source.changedFields.includes(field)),
      render: () => (
        <div className="flex flex-col gap-1">
          <GroupControl group={group} disabled={!owner} />
          <Inheritance local={local} onReset={() => notify('Simulé : ce réglage reviendrait à celui du compte.')} />
        </div>
      ),
    }
  }

  const cliRow = (section: string): SettingItem => ({
    id: `agent-${section}-cli`,
    category: 'agents',
    group: section,
    label: 'CLI',
    help: 'Ces réglages valent pour un CLI à la fois.',
    kind: 'row',
    span: 'sm',
    render: () => <AgentPick agent={agent} onChange={setAgent} />,
  })

  const agentRows: SettingItem[] = owner
    ? [
        ...requests.map((group) => row(group, shared, 'Ce que l’agent demande à Solera')),
        ...pick(sharedSettings.groups, LENT_KEYS).map((group) => row(group, shared, 'Ce que Solera lui prête')),
        {
          id: 'agent-lent-mcp', category: 'agents', group: 'Ce que Solera lui prête', label: t('cliDefaults.mcp.label'),
          help: t('cliDefaults.mcp.hint'), keywords: ['mcp', 'serveur'], kind: 'row', span: 'sm',
          render: () => <div className="flex">{sharedSettings.mcp}</div>,
        },
        cliRow('Permissions du CLI'),
        ...pick(ownSettings.groups, REFLEX_KEYS).map((group) => row(group, own, 'Permissions du CLI')),
        cliRow('Modèle par défaut'),
        ...pick(ownSettings.groups, MODEL_KEYS).map((group) => row(group, own, 'Modèle par défaut')),
        ...pick(sharedSettings.groups, ['queue']).map((group) => row(group, shared, 'Modèle par défaut')),
      ]
    : []

  const replaced: Record<string, SettingItem[]> = {
    instructions: [{
      id: 'instructions', category: 'agents', group: 'Ce que les agents savent', label: t('instructions.project.title'),
      help: 'Les règles que tu donnes aux agents : où elles vivent, et ce que chaque CLI en lit.', keywords: ['agents.md', 'claude.md', 'consignes', 'solera.md', 'codex', 'grok', 'opencode'], kind: 'block', span: 'full',
      render: () => <InstructionsPanel projectId={project.id} notify={notify} />,
    }],
    memory: [{
      id: 'memory', category: 'agents', group: 'Ce que les agents savent', label: 'Mémoire',
      help: 'Ce que les agents ont retenu d’une session à l’autre : à relire, corriger ou supprimer.', keywords: ['mémoire', 'notes', 'memory.md'], kind: 'block', span: 'full',
      render: () => <MemoryPanel projectId={project.id} notify={notify} />,
    }],
    skills: [{
      id: 'skills', category: 'agents', group: 'Ce que les agents savent', label: 'Skills',
      help: 'Livrés aux sessions de ce projet, en plus de ceux de l’instance.', keywords: ['skill', 'bibliothèque'], kind: 'block', span: 'full', readOnly: true,
      render: () => (
        <div className="flex flex-col gap-2">
          <SkillsFlat projectId={project.id} />
          {owner ? (
            <Button size="sm" variant="ghost" icon={<Plus size={14} />} className="self-start" onClick={() => notify('Simulé : le menu d’ajout de skill s’ouvrirait.')}>
              Ajouter un skill
            </Button>
          ) : null}
        </div>
      ),
    }],
    permissions: agentRows,
    issues: [{
      id: 'issues', category: 'integrations', group: 'Forge', label: 'Dépôt des issues',
      help: 'Les issues de ce dépôt deviennent des cartes à accepter.', keywords: ['github', 'gitlab', 'issues', 'forge'], kind: 'row', span: 'sm', readOnly: true,
      render: () => (
        <div className="flex flex-col gap-1">
          <span className="font-mono text-sm">{issueSource?.repository ?? <span className="font-sans text-ink-faint">Aucun dépôt relié</span>}</span>
          {issueSource ? (
            <span className={cx('text-xs', issueSource.error ? 'text-critical' : 'text-ink-faint')}>
              {issueSource.error ?? `${issueSource.cardCount} carte${issueSource.cardCount > 1 ? 's' : ''} venue${issueSource.cardCount > 1 ? 's' : ''} de là${issueSource.polledAt ? ` · lu ${relativeDate(issueSource.polledAt)}` : ''}`}
            </span>
          ) : null}
        </div>
      ),
    }],
    design: [{
      id: 'design', category: 'integrations', group: 'Design', label: 'Design system',
      help: 'Un Storybook lié au projet, que les agents consultent.', keywords: ['storybook', 'design', 'ds'], kind: 'row', span: 'sm', readOnly: true,
      render: () => (
        <span className="font-mono text-sm">{project.designSystemPath ?? <span className="font-sans text-ink-faint">Aucun Storybook lié</span>}</span>
      ),
    }],
  }

  const items = base.flatMap((item) => replaced[item.id] ?? [item])
  return {
    items,
    agentChanges: shared.changedFields.length + own.changedFields.length,
    resetAgent: () => {
      shared.reset()
      own.reset()
    },
  }
}

/** Le badge discret « lecture » d'une catégorie qui a des blocs qu'on ne peut que lire ici. */
export function ReadOnlyNote() {
  return <Badge>lecture seule dans le proto</Badge>
}
