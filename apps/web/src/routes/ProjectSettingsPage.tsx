import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { PROJECT_CAP_MAX, type ConfinedServices, type ProjectDto, type ProjectVisibility } from '@solera/protocol'
import { Banner, Button, EmptyState, SaveBar, SegmentedControl, Select, Switch } from '@solera/ui'
import { AutonomousConfinementSelect, EnvironmentSelect } from '../components/Environment'
import { InstructionsPanel } from '../components/instructions/InstructionsPanel'
import { MemoryPanel } from '../components/instructions/MemoryPanel'
import { PathField } from '../components/PathField'
import {
  CapField,
  ColorSwatches,
  ProjectImageControl,
  RemoveProject,
  SettingInput,
} from '../components/project-settings/GeneralControls'
import { DesignSystemControl, IssueSourceControl, PrototypeCandidates } from '../components/project-settings/Integrations'
import { useAgentSettingItems } from '../components/project-settings/AgentSettingRows'
import { ProjectDevcontainer } from '../components/project-settings/ProjectDevcontainer'
import { SettingsPage, type SettingsCategory } from '../components/settings-page/SettingsPage'
import type { SettingItem } from '../components/settings-page/SettingRow'
import { ProjectSkills } from '../components/skills/ProjectSkills'
import { ApiRequestError } from '../lib/api'
import { useConfigLayerDraft } from '../lib/config-layers'
import { useTranslate, type MessageKey } from '../lib/i18n'
import { useCapability } from '../lib/instance'
import {
  changedFields,
  draftOf,
  draftProblem,
  settingsBaseOf,
  settingsPatchOf,
  type SettingsEdits,
  type SettingsField,
} from '../lib/project-settings'
import {
  useProjectDevcontainer,
  useProjectEnvironments,
  useProjectPrototypes,
  useProjects,
  useUpdateProject,
} from '../lib/projects'

/** Le retour qui suit l'enregistrement reste à la place de la barre ce temps-là. */
const NOTICE_MS = 3200

/**
 * Les réglages d'un projet (page projet v2, PP-21) : une page à menu gauche, un
 * brouillon unique et sa barre d'enregistrement.
 *
 * Ce que les agents savent (consignes, mémoire, skills) et les Intégrations écrivent
 * tout de suite, avec leurs propres boutons : ils restent hors du brouillon.
 */
export function ProjectSettingsPage() {
  const { projectId } = useParams()
  const t = useTranslate()
  const { data: projects, isPending } = useProjects()
  const project = projects?.find((entry) => entry.id === projectId)
  if (isPending) return null
  if (!project) return <EmptyState title={t('project.notFound')} />
  return <ProjectSettings key={project.id} project={project} />
}

/**
 * Le brouillon des réglages simples et du niveau d'agent du projet : les modifications
 * par-dessus l'enregistré, comptées dans la barre et envoyées ensemble en un seul `PATCH`.
 */
function useSettingsDraft(project: ProjectDto) {
  const t = useTranslate()
  const { data: environments } = useProjectEnvironments(project.id)
  const { data: devcontainer } = useProjectDevcontainer(project.id)
  const update = useUpdateProject()
  const agentLayer = useConfigLayerDraft(project)
  const [edits, setEdits] = useState<SettingsEdits>({})
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(null), NOTICE_MS)
    return () => window.clearTimeout(timer)
  }, [notice])

  const base = settingsBaseOf(project, environments, devcontainer)
  const draft = draftOf(base, edits)
  const changed = changedFields(base, edits)
  const problem = draftProblem(draft)
  const count = changed.length + agentLayer.changed.length

  return {
    base,
    draft,
    changed,
    isChanged: (...fields: SettingsField[]) => fields.some((field) => changed.includes(field)),
    set: <K extends SettingsField>(field: K, value: SettingsEdits[K]) => {
      update.reset()
      setEdits((current) => ({ ...current, [field]: value }))
    },
    count,
    reset: () => {
      update.reset()
      setEdits({})
      agentLayer.clear()
    },
    save: async () => {
      const configLayer = agentLayer.body()
      // L'enregistré relu (la mutation attend l'invalidation) avant d'effacer le brouillon :
      // sinon les champs repasseraient un instant par les anciennes valeurs.
      await update.mutateAsync({ id: project.id, ...settingsPatchOf(base, edits), ...(configLayer.length > 0 ? { configLayer } : {}) })
      setEdits({})
      agentLayer.clear()
      setNotice(t(count > 1 ? 'projectSettings.save.done.other' : 'projectSettings.save.done.one', { count: String(count) }))
    },
    busy: update.isPending,
    error: update.error instanceof ApiRequestError ? update.error.message : null,
    problem: problem ? t(`projectSettings.problem.${problem}` as MessageKey, { max: String(PROJECT_CAP_MAX) }) : null,
    notice,
    environments,
    devcontainer,
    agentLayer,
  }
}

function ProjectSettings({ project }: { project: ProjectDto }) {
  const t = useTranslate()
  const sharedProjects = useCapability('sharedProjects')
  const model = useSettingsDraft(project)
  const { draft, set, isChanged, environments, devcontainer } = model
  const owner = project.isOwner
  const agentRows = useAgentSettingItems(project, model.agentLayer)
  const { data: prototypes } = useProjectPrototypes(project.id, owner && Boolean(project.designSystemPath))
  const candidates = project.designSystemPath ? (prototypes?.candidates ?? []) : []

  const categories: SettingsCategory[] = [
    { key: 'general', label: t('projectSettings.category.general') },
    { key: 'agents', label: t('projectSettings.category.agents') },
    { key: 'integrations', label: t('projectSettings.category.integrations') },
    { key: 'danger', label: t('projectSettings.category.danger'), danger: true },
  ]
  const keywords = (key: MessageKey) => t(key).split(/\s+/)
  const identity = t('projectSettings.group.identity')
  const appearance = t('projectSettings.group.appearance')
  const execution = t('projectSettings.group.execution')

  const general: SettingItem[] = [
    {
      id: 'name', category: 'general', group: identity, kind: 'row', disabled: !owner,
      label: t('project.settings.name'), help: t('projectSettings.item.name.help'), changed: isChanged('name'),
      render: () => <SettingInput label={t('project.settings.name')} value={draft.name ?? ''} onChange={(value) => set('name', value)} />,
    },
    {
      id: 'path', category: 'general', group: identity, kind: 'row', disabled: !owner,
      label: t('project.settings.workspacePath'), help: t('project.settings.workspacePath.hint'),
      keywords: keywords('projectSettings.item.path.keywords'), changed: isChanged('workspacePath'),
      render: () => (
        <div className="flex flex-col gap-2">
          <PathField hideLabel label={t('project.settings.workspacePath')} value={draft.workspacePath ?? ''} onChange={(value) => set('workspacePath', value)} />
          {isChanged('workspacePath') ? (
            <Banner tone="caution">{t('project.settings.pathChanged.warning')}</Banner>
          ) : null}
        </div>
      ),
    },
    ...(sharedProjects
      ? [{
          id: 'visibility', category: 'general', group: identity, kind: 'row', disabled: !owner,
          label: t('project.settings.visibility'), help: t('projectSettings.item.visibility.help'),
          keywords: keywords('projectSettings.item.visibility.keywords'), changed: isChanged('visibility'),
          render: () => (
            <SegmentedControl<ProjectVisibility>
              label={t('project.settings.visibility')}
              value={draft.visibility ?? 'private'}
              onChange={(value) => set('visibility', value)}
              segments={[
                { value: 'private', label: t('project.visibility.private') },
                { value: 'shared', label: t('project.visibility.shared') },
              ]}
            />
          ),
        } satisfies SettingItem]
      : []),
    {
      id: 'cap', category: 'general', group: identity, kind: 'row', disabled: !owner,
      label: t('projectSettings.item.cap.label'), help: t('projectSettings.item.cap.help'),
      keywords: keywords('projectSettings.item.cap.keywords'), changed: isChanged('cap'),
      render: () => <CapField value={draft.cap ?? ''} onChange={(value) => set('cap', value)} />,
    },
    {
      id: 'color', category: 'general', group: appearance, kind: 'row', disabled: !owner,
      label: t('project.color.title'), help: t('projectSettings.item.color.help'),
      keywords: keywords('projectSettings.item.color.keywords'), changed: isChanged('color'),
      render: () => <ColorSwatches value={draft.color ?? null} onChange={(value) => set('color', value)} />,
    },
    {
      id: 'image', category: 'general', group: appearance, kind: 'row', disabled: !owner,
      label: t('projectSettings.item.image.label'), help: t('projectSettings.item.image.help'),
      keywords: keywords('projectSettings.item.image.keywords'),
      render: () => <ProjectImageControl project={project} color={draft.color ?? null} />,
    },
    ...(environments && draft.environment
      ? [{
          id: 'environment', category: 'general', group: execution, kind: 'row', disabled: !owner,
          label: t('project.environment.title'), help: t('projectSettings.item.environment.help'),
          keywords: keywords('projectSettings.item.environment.keywords'), changed: isChanged('environment'),
          render: () => (
            <div className="flex flex-col gap-2">
              <EnvironmentSelect hideLabel value={draft.environment!} choices={environments.choices} onChange={(value) => set('environment', value)} />
              {environments.suggested && !isChanged('environment') ? (
                <div className="flex flex-wrap items-center gap-2 text-meta text-ink-soft">
                  <span>{t('project.environment.suggested')}</span>
                  <Button size="sm" variant="secondary" onClick={() => set('environment', environments.suggested!)}>
                    {t('project.environment.suggested.accept')}
                  </Button>
                </div>
              ) : null}
            </div>
          ),
        } satisfies SettingItem,
        {
          id: 'autonomous', category: 'general', group: execution, kind: 'row', disabled: !owner,
          label: t('projectSettings.item.autonomous.label'), help: t('project.environment.autonomous'),
          keywords: keywords('projectSettings.item.autonomous.keywords'), changed: isChanged('autonomousConfined'),
          render: () => (
            <AutonomousConfinementSelect hideLabel value={draft.autonomousConfined ?? false} onChange={(value) => set('autonomousConfined', Boolean(value))} />
          ),
        } satisfies SettingItem]
      : []),
    ...(devcontainer?.compose
      ? [{
          id: 'services', category: 'general', group: execution, kind: 'row', disabled: !owner,
          label: t('projectSettings.item.services.label'), help: t('projectSettings.item.services.help'),
          keywords: keywords('projectSettings.item.services.keywords'), changed: isChanged('confinedServices'),
          render: () => (
            <Select<ConfinedServices>
              placeholder={t('projectSettings.item.services.label')}
              value={draft.confinedServices ?? 'shared'}
              onChange={(value) => set('confinedServices', value)}
              options={[
                { value: 'shared', label: t('projectSettings.services.shared') },
                { value: 'copy', label: t('projectSettings.services.copy'), hint: t('projectSettings.services.copyHint') },
              ]}
            />
          ),
        } satisfies SettingItem]
      : []),
    ...(owner
      ? [{
          id: 'devcontainer', category: 'general', group: execution, kind: 'block',
          label: t('project.devcontainer.title'), help: t('projectSettings.item.devcontainer.help'),
          keywords: keywords('projectSettings.item.devcontainer.keywords'),
          render: () => <ProjectDevcontainer projectId={project.id} />,
        } satisfies SettingItem]
      : []),
    {
      id: 'checkpoints', category: 'general', group: execution, kind: 'row', disabled: !owner,
      label: t('project.settings.checkpoints'), help: t('project.settings.checkpoints.hint'),
      keywords: keywords('projectSettings.item.checkpoints.keywords'), changed: isChanged('turnCheckpoints'),
      render: () => (
        <Switch checked={draft.turnCheckpoints ?? true} onCheckedChange={(value) => set('turnCheckpoints', value)} label={t('project.settings.checkpoints')} />
      ),
    },
  ]

  /* Un projet partagé ne montre des Agents que ce que les agents savent. */
  const knowledge = t('projectSettings.group.knowledge')
  const agents: SettingItem[] = [
    {
      id: 'instructions', category: 'agents', group: knowledge, kind: 'block',
      label: t('instructions.project.title'), help: t('projectSettings.item.instructions.help'),
      keywords: keywords('projectSettings.item.instructions.keywords'),
      render: () => <InstructionsPanel projectId={project.id} />,
    },
    {
      id: 'memory', category: 'agents', group: knowledge, kind: 'block',
      label: t('projectSettings.item.memory.label'), help: t('projectSettings.item.memory.help'),
      keywords: keywords('projectSettings.item.memory.keywords'),
      render: () => <MemoryPanel projectId={project.id} />,
    },
    {
      id: 'skills', category: 'agents', group: knowledge, kind: 'block',
      label: t('projectSettings.item.skills.label'), help: t('projectSettings.item.skills.help'),
      keywords: keywords('projectSettings.item.skills.keywords'),
      render: () => <ProjectSkills projectId={project.id} isOwner={owner} />,
    },
    ...agentRows,
  ]
  const design = t('projectSettings.group.design')
  const integrations: SettingItem[] = owner
    ? [
        {
          id: 'issues', category: 'integrations', group: t('projectSettings.group.forge'), kind: 'row',
          label: t('projectSettings.item.issues.label'), help: t('projectSettings.item.issues.help'),
          keywords: keywords('projectSettings.item.issues.keywords'),
          render: () => <IssueSourceControl projectId={project.id} />,
        },
        {
          id: 'design', category: 'integrations', group: design, kind: 'row',
          label: t('project.designSystem.title'), help: t('projectSettings.item.design.help'),
          keywords: keywords('projectSettings.item.design.keywords'),
          render: () => <DesignSystemControl projectId={project.id} path={project.designSystemPath} />,
        },
        ...(candidates.length > 0
          ? [{
              id: 'candidates', category: 'integrations', group: design, kind: 'row',
              label: t('projectSettings.item.candidates.label'), help: t('project.designSystem.candidates.hint'),
              keywords: keywords('projectSettings.item.candidates.keywords'),
              render: () => <PrototypeCandidates candidates={candidates} />,
            } satisfies SettingItem]
          : []),
      ]
    : []
  const danger: SettingItem[] = owner
    ? [{
        id: 'remove', category: 'danger', group: t('projectSettings.group.irreversible'), kind: 'row',
        label: t('projectSettings.item.remove.label'), help: t('project.settings.remove.notice'),
        keywords: keywords('projectSettings.item.remove.keywords'),
        render: () => <RemoveProject project={project} />,
      }]
    : []

  const count = model.count
  const message = model.problem ?? model.error
  return (
    <SettingsPage
      categories={categories}
      items={[...general, ...agents, ...integrations, ...danger]}
      notice={owner ? null : <div className="pt-4"><Banner tone="info">{t('project.shared.readonly', { name: project.ownerName })}</Banner></div>}
      footer={
        <SaveBar
          count={count}
          labels={{
            pending: (
              <>
                {t(count > 1 ? 'projectSettings.save.pending.other' : 'projectSettings.save.pending.one', { count: String(count) })}
                {message ? <span className="block text-critical">{message}</span> : null}
              </>
            ),
            cancel: t('project.settings.cancel'),
            save: t('project.settings.save'),
          }}
          notice={model.notice}
          busy={model.busy}
          saveDisabled={Boolean(model.problem)}
          onCancel={model.reset}
          onSave={() => void model.save().catch(() => undefined)}
        />
      }
    />
  )
}
