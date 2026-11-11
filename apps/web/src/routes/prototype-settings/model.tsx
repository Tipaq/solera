/* PROTOTYPE — jetable (branche proto/page-projet). Ne pas fusionner dans main.
 *
 * Le modèle commun aux quatre variantes d'affichage des réglages (`rangees`, `grille`,
 * `page`, `accueil`) : les mêmes catégories, les mêmes réglages, un seul brouillon.
 *
 * - Les réglages simples (nom, chemin, visibilité, couleur, cap, environnement…) partent
 *   des vraies valeurs du projet et se modifient dans un **brouillon local**. Enregistrer
 *   est un stub « Simulé » : rien n'est écrit (le cap seul va dans le localStorage du
 *   proto, sous la clé que lit l'horizon des jalons).
 * - Les gros blocs (consignes, mémoire, skills, permissions, forge, design system) sont
 *   les vrais composants, montrés **en lecture** (`inert`) : leur édition écrirait.
 * - Les actions sont la section du proto, déjà entièrement simulée : elles restent
 *   manipulables.
 */
import { Bot, Image as ImageIcon, Plug, Settings2, TriangleAlert, Zap } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  DEVCONTAINER_CONFINED_ENVIRONMENT,
  DEVCONTAINER_ENVIRONMENT,
  HOST_CONFINED_ENVIRONMENT,
  HOST_ENVIRONMENT,
  environmentKey,
  type ConfinedServices,
  type ExecutionEnvironment,
  type ProjectDto,
  type ProjectVisibility,
} from '@solera/protocol'
import { Banner, Button, SegmentedControl, Select, Switch, cx } from '@solera/ui'
import { EnvironmentIcon } from '../../components/Environment'
import { Monitor, ShieldCheck } from 'lucide-react'
import { ProjectInstructions } from '../../components/instructions/Instructions'
import { ProjectMemory } from '../../components/instructions/ProjectMemory'
import { ProjectAvatar } from '../../components/ProjectAvatar'
import { ProjectSkills } from '../../components/skills/ProjectSkills'
import { useActions } from '../../lib/actions'
import { useTranslate } from '../../lib/i18n'
import { useCapability } from '../../lib/instance'
import { useProjectInstructions } from '../../lib/instructions'
import { useIssueSource } from '../../lib/issues'
import { useProjectMemory } from '../../lib/memory'
import { PROJECT_COLORS } from '../../lib/project-colors'
import { useProjectEnvironments } from '../../lib/projects'
import { useSkillLibrary } from '../../lib/skill-library'
import { ProjectAgentSettings, ProjectDesignSystem, ProjectIssueSource } from '../ProjectPage'
import { ActionsSection } from '../prototype-actions/ActionsSection'
import { demoActions, groupOf, stateOf } from '../prototype-actions/data'

/* ------------------------------------------------------------------ catégories */

export type CategoryKey = 'general' | 'agents' | 'actions' | 'integrations' | 'danger'

export interface Category {
  key: CategoryKey
  label: string
  hint: string
  icon: (size: number) => ReactNode
}

export const CATEGORIES: Category[] = [
  { key: 'general', label: 'Général', hint: 'Identité, apparence, exécution', icon: (size) => <Settings2 size={size} /> },
  { key: 'agents', label: 'Agents', hint: 'Consignes, mémoire, skills, permissions', icon: (size) => <Bot size={size} /> },
  { key: 'actions', label: 'Actions', hint: 'Raccourcis : serveurs, tests, scripts', icon: (size) => <Zap size={size} /> },
  { key: 'integrations', label: 'Intégrations', hint: 'Forge et issues, design system', icon: (size) => <Plug size={size} /> },
  { key: 'danger', label: 'Zone de danger', hint: 'Retirer le projet', icon: (size) => <TriangleAlert size={size} /> },
]

export const CATEGORY_PARAM = 'section'

/**
 * Les actions vivent par défaut dans le hub ⚡ de la bande : leur catégorie n'existe
 * dans les Réglages que si l'adresse porte `?actions=reglages`, pour comparer.
 */
export function useActionsInSettings(): boolean {
  const [params] = useSearchParams()
  return params.get('actions') === 'reglages'
}

/** Les catégories montrées : sans Actions, sauf `?actions=reglages`. */
export function useCategories(): Category[] {
  const withActions = useActionsInSettings()
  return withActions ? CATEGORIES : CATEGORIES.filter((entry) => entry.key !== 'actions')
}

/** La catégorie de l'adresse (`?section=`), la première sinon. */
export function useCategoryParam(fallback: CategoryKey | null = 'general') {
  const [params, setParams] = useSearchParams()
  const categories = useCategories()
  const wanted = params.get(CATEGORY_PARAM)
  const current = categories.some((entry) => entry.key === wanted) ? (wanted as CategoryKey) : fallback
  const pick = (next: CategoryKey | null) =>
    setParams((previous) => {
      if (next) previous.set(CATEGORY_PARAM, next)
      else previous.delete(CATEGORY_PARAM)
      return previous
    }, { replace: true })
  return [current, pick] as const
}

/* ------------------------------------------------------------------ brouillon */

export interface Draft {
  name: string
  path: string
  visibility: ProjectVisibility
  checkpoints: boolean
  color: string | null
  cap: string
  environment: ExecutionEnvironment
  autonomousConfined: boolean
  confinedServices: ConfinedServices
}

const ALL_ENVIRONMENTS = [HOST_ENVIRONMENT, HOST_CONFINED_ENVIRONMENT, DEVCONTAINER_ENVIRONMENT, DEVCONTAINER_CONFINED_ENVIRONMENT]

const ENV_LABEL: Record<string, string> = {
  host: 'Hôte',
  'host.confined': 'Hôte confiné',
  devcontainer: 'Dev container',
  'devcontainer.confined': 'Dev container confiné',
}

export function envLabel(environment: ExecutionEnvironment): string {
  return ENV_LABEL[environmentKey(environment)] ?? environmentKey(environment)
}

const capKey = (projectId: string) => `proto-cap-${projectId}`

export interface SettingsModel {
  project: ProjectDto
  draft: Draft
  set: <K extends keyof Draft>(key: K, value: Draft[K]) => void
  changed: (keyof Draft)[]
  reset: () => void
  save: () => void
  notice: string | null
  notify: (text: string) => void
  /** Vrai quand le serveur ne connaît pas encore les environnements (instance stable v0.20.1). */
  environmentsSimulated: boolean
  environmentChoices: ExecutionEnvironment[]
}

export function useSettingsModel(project: ProjectDto): SettingsModel {
  const { data: environments } = useProjectEnvironments(project.id)
  const base = useMemo<Draft>(
    () => ({
      name: project.name,
      path: project.workspacePath,
      visibility: project.visibility,
      checkpoints: project.turnCheckpoints,
      color: project.color,
      cap: localStorage.getItem(capKey(project.id)) ?? '',
      environment: environments?.default ?? HOST_ENVIRONMENT,
      autonomousConfined: environments?.autonomousConfined ?? false,
      confinedServices: 'shared',
    }),
    [project, environments],
  )
  const [saved, setSaved] = useState<Draft>(base)
  const [draft, setDraft] = useState<Draft>(base)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    setSaved(base)
    setDraft(base)
  }, [base])

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(null), 3200)
    return () => window.clearTimeout(timer)
  }, [notice])

  const changed = (Object.keys(draft) as (keyof Draft)[]).filter((key) => JSON.stringify(draft[key]) !== JSON.stringify(saved[key]))

  return {
    project,
    draft,
    set: (key, value) => setDraft((current) => ({ ...current, [key]: value })),
    changed,
    reset: () => setDraft(saved),
    save: () => {
      // Le cap vit dans le stockage du proto, que l'horizon des jalons lit aussi.
      if (draft.cap.trim()) localStorage.setItem(capKey(project.id), draft.cap.trim())
      else localStorage.removeItem(capKey(project.id))
      setSaved(draft)
      setNotice(`Simulé : ${changed.length} réglage${changed.length > 1 ? 's' : ''} enregistré${changed.length > 1 ? 's' : ''} — rien n'est écrit sur le serveur.`)
    },
    notice,
    notify: setNotice,
    environmentsSimulated: !environments,
    environmentChoices: environments?.choices ?? ALL_ENVIRONMENTS,
  }
}

/* ------------------------------------------------------------------ réglages */

export interface SettingItem {
  id: string
  category: CategoryKey
  group: string
  label: string
  help?: string
  /** Mots qui le font trouver à la recherche, en plus du libellé et de l'aide. */
  keywords?: string[]
  /** `row` : un contrôle simple ; `block` : un bloc entier, qui prend la largeur. */
  kind: 'row' | 'block'
  /** Place dans la grille : `sm` une colonne, `full` toute la largeur. */
  span: 'sm' | 'full'
  /** Marqué comme simulé (rien côté serveur, ou instance trop ancienne). */
  simulated?: boolean
  /** Les champs du brouillon qu'il touche, pour marquer « modifié ». */
  fields?: (keyof Draft)[]
  /** « Modifié » tenu ailleurs que dans le brouillon (réglages d'agent du proto à plat). */
  changed?: boolean
  /** Lu seulement dans le proto : son édition écrirait. Dit une fois par catégorie. */
  readOnly?: boolean
  render: () => ReactNode
}

export function useSettingItems(model: SettingsModel): SettingItem[] {
  const t = useTranslate()
  const shared = useCapability('sharedProjects')
  const { project, draft, set, notify } = model
  const owner = project.isOwner
  const withActions = useActionsInSettings()

  const items: SettingItem[] = [
    /* --- Général › Identité */
    {
      id: 'name', category: 'general', group: 'Identité', label: 'Nom', kind: 'row', span: 'sm', fields: ['name'],
      help: 'Affiché dans la bande, la sidebar et le portefeuille.',
      render: () => <TextInput value={draft.name} onChange={(value) => set('name', value)} />,
    },
    {
      id: 'path', category: 'general', group: 'Identité', label: 'Dossier du workspace', kind: 'row', span: 'sm', fields: ['path'],
      help: t('project.settings.workspacePath.hint'), keywords: ['chemin', 'workspace', 'dossier'],
      render: () => (
        <div className="flex flex-col gap-2">
          <div className="flex gap-2">
            <TextInput mono value={draft.path} onChange={(value) => set('path', value)} />
            <Button size="sm" variant="secondary" onClick={() => notify('Simulé : le sélecteur de dossier s’ouvrirait.')}>Parcourir</Button>
          </div>
          {draft.path !== project.workspacePath ? (
            <Banner tone="caution">{t('project.settings.pathChanged.warning')}</Banner>
          ) : null}
        </div>
      ),
    },
    ...(shared
      ? [{
          id: 'visibility', category: 'general' as const, group: 'Identité', label: 'Visibilité', kind: 'row' as const, span: 'sm' as const, fields: ['visibility' as const],
          help: 'Privé : toi seul. Partagé : les membres de l’instance le voient.', keywords: ['partage', 'privé'],
          render: () => (
            <SegmentedControl<ProjectVisibility>
              label="Visibilité"
              value={draft.visibility}
              onChange={(value) => set('visibility', value)}
              segments={[
                { value: 'private', label: t('project.visibility.private') },
                { value: 'shared', label: t('project.visibility.shared') },
              ]}
            />
          ),
        }]
      : []),
    {
      id: 'cap', category: 'general', group: 'Identité', label: 'Cap', kind: 'row', span: 'full', fields: ['cap'], simulated: true,
      help: 'Une phrase, facultative : où va le projet. En tête des Jalons, donnée à l’agent qui affine un jalon.', keywords: ['vision', 'objectif'],
      render: () => (
        <textarea
          value={draft.cap}
          onChange={(event) => set('cap', event.target.value)}
          rows={2}
          placeholder="Ex. : un outil de pilotage d'agents qu'on utilise au quotidien, au bureau comme au téléphone."
          className="w-full resize-none rounded-lg border border-line bg-sunken px-3 py-2 text-sm outline-none focus:border-accent"
        />
      ),
    },
    /* --- Général › Apparence */
    {
      id: 'color', category: 'general', group: 'Apparence', label: 'Couleur', kind: 'row', span: 'sm', fields: ['color'],
      help: 'Celle de sa pastille, dans la sidebar et le portefeuille.', keywords: ['teinte', 'pastille'],
      render: () => (
        <div className="flex flex-wrap gap-2">
          {PROJECT_COLORS.map((entry) => {
            const selected = draft.color === entry.value
            return (
              <button
                key={entry.value ?? 'default'}
                type="button"
                title={t(entry.label)}
                aria-label={t(entry.label)}
                aria-pressed={selected}
                onClick={() => set('color', entry.value)}
                className={cx(
                  'size-7 rounded-full ring-offset-2 ring-offset-canvas transition',
                  selected ? 'ring-2 ring-ink' : 'hover:ring-2 hover:ring-line-strong',
                  entry.value === null && 'bg-accent',
                )}
                style={entry.value ? { background: entry.value } : undefined}
              />
            )
          })}
        </div>
      ),
    },
    {
      id: 'image', category: 'general', group: 'Apparence', label: 'Image', kind: 'row', span: 'sm',
      help: 'Remplace la pastille de couleur par une image carrée.', keywords: ['logo', 'avatar', 'icône'],
      render: () => (
        <div className="flex items-center gap-3">
          <ProjectAvatar project={{ ...project, color: draft.color }} className="size-10" />
          <Button size="sm" variant="secondary" icon={<ImageIcon size={14} />} onClick={() => notify('Simulé : le choix d’une image s’ouvrirait.')}>
            Changer
          </Button>
          {project.image ? (
            <Button size="sm" variant="ghost" onClick={() => notify('Simulé : l’image serait retirée.')}>Retirer</Button>
          ) : null}
        </div>
      ),
    },
    /* --- Général › Exécution */
    {
      id: 'environment', category: 'general', group: 'Exécution', label: t('project.environment.title'), kind: 'row', span: 'sm', fields: ['environment'],
      simulated: model.environmentsSimulated,
      help: 'Où tournent le CLI et les terminaux des sessions ouvertes ensuite. Une session garde le sien.',
      keywords: ['hôte', 'dev container', 'conteneur', 'sandbox', 'confin'],
      render: () => (
        <EnvironmentPicker value={draft.environment} choices={model.environmentChoices} onChange={(value) => set('environment', value)} />
      ),
    },
    {
      id: 'autonomous', category: 'general', group: 'Exécution', label: 'Sessions autonomes confinées', kind: 'row', span: 'sm', fields: ['autonomousConfined'],
      simulated: model.environmentsSimulated,
      help: t('project.environment.autonomous'), keywords: ['confin', 'autonome', 'jalon', 'planifiée', 'sandbox'],
      render: () => (
        <AutonomousPicker value={draft.autonomousConfined} onChange={(value) => set('autonomousConfined', value)} />
      ),
    },
    {
      id: 'services', category: 'general', group: 'Exécution', label: 'Services des sessions confinées', kind: 'row', span: 'sm', fields: ['confinedServices'],
      simulated: true,
      help: 'Les services docker-compose du dev container (base de données…) : ceux du projet, ou une copie par session.',
      keywords: ['docker', 'compose', 'base', 'confin'],
      render: () => (
        <Select<ConfinedServices>
          value={draft.confinedServices}
          onChange={(value) => set('confinedServices', value)}
          options={[
            { value: 'shared', label: 'Ceux du projet, partagés' },
            { value: 'copy', label: 'Une copie par session', hint: 'Supprimée avec la session' },
          ]}
        />
      ),
    },
    {
      id: 'checkpoints', category: 'general', group: 'Exécution', label: t('project.settings.checkpoints'), kind: 'row', span: 'sm', fields: ['checkpoints'],
      help: t('project.settings.checkpoints.hint'), keywords: ['reprise', 'git', 'refs', 'annuler'],
      render: () => <Switch checked={draft.checkpoints} onCheckedChange={(value) => set('checkpoints', value)} label={t('project.settings.checkpoints')} />,
    },
    /* --- Agents */
    {
      id: 'instructions', category: 'agents', group: 'Ce que les agents savent', label: t('instructions.project.title'), kind: 'block', span: 'full',
      help: t('instructions.project.description'), keywords: ['agents.md', 'claude.md', 'consignes'],
      render: () => <ReadOnlyBlock><ProjectInstructions projectId={project.id} /></ReadOnlyBlock>,
    },
    {
      id: 'memory', category: 'agents', group: 'Ce que les agents savent', label: 'Mémoire', kind: 'block', span: 'full',
      help: 'Les notes que les agents gardent d’une session à l’autre.', keywords: ['mémoire', 'notes'],
      render: () => <ReadOnlyBlock><ProjectMemory projectId={project.id} /></ReadOnlyBlock>,
    },
    {
      id: 'skills', category: 'agents', group: 'Ce que les agents savent', label: 'Skills', kind: 'block', span: 'full',
      help: 'Les skills livrés aux sessions de ce projet, en plus de ceux de l’instance.', keywords: ['skill', 'bibliothèque'],
      render: () => <ReadOnlyBlock><ProjectSkills projectId={project.id} isOwner={project.isOwner} /></ReadOnlyBlock>,
    },
    ...(owner
      ? [{
          id: 'permissions', category: 'agents' as const, group: 'Comment ils travaillent', label: 'Permissions et modèles', kind: 'block' as const, span: 'full' as const,
          help: 'Ce que les agents peuvent faire sans demander, et les modèles par défaut de chaque CLI.', keywords: ['permission', 'modèle', 'effort', 'autorisation'],
          render: () => <ReadOnlyBlock><ProjectAgentSettings project={project} /></ReadOnlyBlock>,
        }]
      : []),
    /* --- Actions */
    {
      id: 'actions', category: 'actions', group: 'Raccourcis', label: 'Actions du projet', kind: 'block', span: 'full',
      help: 'Les boutons qui lancent une commande : serveur de dev, tests, scripts.', keywords: ['action', 'raccourci', 'serveur', 'tests', 'script', 'service'],
      render: () => <ActionsSection projectId={project.id} />,
    },
    /* --- Intégrations */
    ...(owner
      ? [
          {
            id: 'issues', category: 'integrations' as const, group: 'Forge', label: 'Forge et issues', kind: 'block' as const, span: 'sm' as const,
            help: 'Les issues d’une forge deviennent des cartes à accepter.', keywords: ['github', 'gitlab', 'issues', 'forge'],
            render: () => <ReadOnlyBlock><ProjectIssueSource projectId={project.id} /></ReadOnlyBlock>,
          },
          {
            id: 'design', category: 'integrations' as const, group: 'Design', label: 'Design system', kind: 'block' as const, span: 'sm' as const,
            help: 'Un Storybook lié au projet, que les agents consultent.', keywords: ['storybook', 'design', 'ds'],
            render: () => <ReadOnlyBlock><ProjectDesignSystem projectId={project.id} initialPath={project.designSystemPath} /></ReadOnlyBlock>,
          },
        ]
      : []),
    /* --- Zone de danger */
    ...(owner
      ? [{
          id: 'remove', category: 'danger' as const, group: 'Irréversible', label: t('project.settings.remove'), kind: 'row' as const, span: 'full' as const,
          help: t('project.settings.remove.notice'), keywords: ['supprimer', 'retirer', 'effacer'],
          render: () => (
            <Button variant="danger" size="sm" onClick={() => notify('Simulé : le projet serait retiré après confirmation.')}>
              {t('project.settings.remove')}
            </Button>
          ),
        }]
      : []),
  ]
  return withActions ? items : items.filter((item) => item.category !== 'actions')
}

/** Les réglages qu'une recherche retrouve, accents et casse ignorés. */
export function searchItems(items: SettingItem[], query: string): SettingItem[] {
  const needle = fold(query.trim())
  if (!needle) return items
  return items.filter((item) => {
    const category = CATEGORIES.find((entry) => entry.key === item.category)!
    const haystack = fold([item.label, item.help ?? '', item.group, category.label, ...(item.keywords ?? [])].join(' '))
    return needle.split(/\s+/).every((word) => haystack.includes(word))
  })
}

function fold(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

/** Les groupes d'une catégorie, dans l'ordre d'apparition. */
export function groupsOf(items: SettingItem[], category: CategoryKey): { name: string; items: SettingItem[] }[] {
  const groups: { name: string; items: SettingItem[] }[] = []
  for (const item of items.filter((entry) => entry.category === category)) {
    const group = groups.find((entry) => entry.name === item.group)
    if (group) group.items.push(item)
    else groups.push({ name: item.group, items: [item] })
  }
  return groups
}

/* ------------------------------------------------------------------ résumés */

/** L'état d'une catégorie en quelques faits, pour une tuile ou un sommaire. */
export function useCategorySummaries(model: SettingsModel): Record<CategoryKey, string[]> {
  const t = useTranslate()
  const [params] = useSearchParams()
  const demo = params.get('demo') === '1'
  const { project, draft } = model
  const { data: instructions } = useProjectInstructions(project.id)
  const { data: memory } = useProjectMemory(project.id)
  const { data: library } = useSkillLibrary(project.id)
  const { data: issues } = useIssueSource(project.id)
  const { data: actionList } = useActions()

  const color = PROJECT_COLORS.find((entry) => entry.value === draft.color)
  const lines = (instructions?.content ?? '').split('\n').filter((line) => line.trim()).length
  const projectSkills = (library?.skills ?? []).filter((skill) => skill.scope === 'project').length
  const globalSkills = (library?.skills ?? []).filter((skill) => skill.scope === 'global').length
  const actions = demo ? demoActions(project.id) : (actionList ?? []).filter((action) => action.projectId === project.id)
  const running = actions.filter((action) => stateOf(action).live && action.kind === 'service').length
  const review = actions.filter((action) => groupOf(action) === 'review').length

  return {
    general: [
      `${t(draft.visibility === 'shared' ? 'project.visibility.shared' : 'project.visibility.private')} · ${color ? t(color.label).toLowerCase() : 'couleur'}`,
      envLabel(draft.environment) + (draft.autonomousConfined ? ' · autonomes confinées' : ''),
      draft.cap.trim() ? `Cap : « ${draft.cap.trim()} »` : 'Pas de cap',
    ],
    agents: [
      lines > 0 ? `Consignes : ${lines} ligne${lines > 1 ? 's' : ''}` : 'Pas de consignes propres',
      `Mémoire : ${memory?.files.length ?? 0} note${(memory?.files.length ?? 0) > 1 ? 's' : ''}`,
      `Skills : ${projectSkills} du projet · ${globalSkills} de l’instance`,
    ],
    actions: [
      `${actions.length} action${actions.length > 1 ? 's' : ''}`,
      running > 0 ? `${running} service${running > 1 ? 's' : ''} en marche` : 'Rien ne tourne',
      ...(review > 0 ? [`${review} à relire`] : []),
    ],
    integrations: [
      issues ? `${issues.provider} · ${issues.repository}` : 'Aucune forge reliée',
      project.designSystemPath ? `Design system : ${project.designSystemPath.split('/').pop()}` : 'Pas de design system',
    ],
    danger: ['Retirer le projet et ses conversations'],
  }
}

/* ------------------------------------------------------------------ petites pièces */

export function TextInput({ value, onChange, mono = false }: { value: string; onChange: (value: string) => void; mono?: boolean }) {
  return (
    <input
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className={cx(
        'h-9 w-full min-w-0 rounded-lg border border-line bg-sunken px-3 text-sm outline-none focus:border-accent',
        mono && 'font-mono text-xs',
      )}
    />
  )
}

/** Un vrai bloc des réglages, montré en lecture : son édition écrirait. */
export function ReadOnlyBlock({ children }: { children: ReactNode }) {
  return (
    <div className="relative">
      <div inert className="opacity-90">{children}</div>
      <span className="pointer-events-none absolute top-2 right-2 rounded bg-surface-high px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-ink-faint uppercase">
        lecture · éditer dans « actuel »
      </span>
    </div>
  )
}

export function SimTag() {
  return (
    <span className="rounded bg-fuchsia-500/15 px-1 text-[10px] font-medium tracking-wide text-fuchsia-700 uppercase dark:text-fuchsia-300">
      simulé
    </span>
  )
}

/** La barre des modifications en attente, collée en bas, au-dessus des barres du proto. */
export function SaveBar({ model }: { model: SettingsModel }) {
  const count = model.changed.length
  if (count === 0 && !model.notice) return null
  return (
    <div className="pointer-events-none sticky bottom-24 z-20 flex justify-center px-4">
      {count > 0 ? (
        <div className="pointer-events-auto flex items-center gap-3 rounded-xl border border-line bg-surface px-4 py-2.5 shadow-lg">
          <span className="text-sm">
            <span className="font-medium">{count} modification{count > 1 ? 's' : ''}</span>{' '}
            <span className="text-ink-faint">non enregistrée{count > 1 ? 's' : ''}</span>
          </span>
          <Button size="sm" variant="ghost" onClick={model.reset}>Annuler</Button>
          <Button size="sm" onClick={model.save}>Enregistrer</Button>
        </div>
      ) : (
        <div className="pointer-events-auto rounded-xl border border-line bg-surface px-4 py-2.5 text-sm text-ink-soft shadow-lg">{model.notice}</div>
      )}
    </div>
  )
}

/** Le point « modifié » d'un réglage dont le brouillon diffère de l'enregistré. */
export function isChanged(model: SettingsModel, item: SettingItem): boolean {
  return Boolean(item.changed) || (item.fields ?? []).some((field) => model.changed.includes(field))
}

export function ChangedDot() {
  return <span title="Modifié, pas encore enregistré" className="inline-block size-1.5 shrink-0 rounded-full bg-accent" />
}

export function ItemTitle({ model, item, className }: { model: SettingsModel; item: SettingItem; className?: string }) {
  return (
    <span className={cx('flex items-center gap-2', className)}>
      <span className="text-sm font-medium text-ink">{item.label}</span>
      {item.simulated ? <SimTag /> : null}
      {isChanged(model, item) ? <ChangedDot /> : null}
    </span>
  )
}

export const CATEGORY_ICON_TINT: Record<CategoryKey, string> = {
  general: 'text-accent',
  agents: 'text-[#8B7BF7]',
  actions: 'text-positive',
  integrations: 'text-caution',
  danger: 'text-critical',
}


/* ------------------------------------------------------------------ sélecteurs sans libellé
 * `EnvironmentSelect` et `AutonomousConfinementSelect` portent leur propre libellé, que la
 * rangée dit déjà à gauche : la capture de Tim le montrait deux fois. Mêmes options, sans
 * libellé visible (il reste en `aria-label`). */

function EnvironmentPicker({ value, choices, onChange }: { value: ExecutionEnvironment; choices: ExecutionEnvironment[]; onChange: (value: ExecutionEnvironment) => void }) {
  const t = useTranslate()
  const options = choices.some((choice) => environmentKey(choice) === environmentKey(value)) ? choices : [value, ...choices]
  const key = (environment: ExecutionEnvironment) => `environment.${environmentKey(environment)}` as const
  return (
    <Select
      placeholder={t('environment.label')}
      value={environmentKey(value)}
      onChange={(next) => {
        const found = options.find((choice) => environmentKey(choice) === next)
        if (found) onChange(found)
      }}
      disabled={options.length < 2}
      options={options.map((choice) => ({
        value: environmentKey(choice),
        label: t(key(choice)),
        icon: <EnvironmentIcon environment={choice} size={16} />,
        hint: t(`${key(choice)}.hint`),
      }))}
    />
  )
}

function AutonomousPicker({ value, onChange }: { value: boolean; onChange: (value: boolean) => void }) {
  const t = useTranslate()
  return (
    <Select
      placeholder={t('environment.autonomous.label')}
      value={value ? 'confined' : 'free'}
      onChange={(choice) => onChange(choice === 'confined')}
      options={(['free', 'confined'] as const).map((choice) => ({
        value: choice,
        label: t(`environment.autonomous.${choice}`),
        icon: choice === 'confined' ? <ShieldCheck size={16} /> : <Monitor size={16} />,
        hint: t(`environment.autonomous.${choice}.hint`),
      }))}
    />
  )
}
