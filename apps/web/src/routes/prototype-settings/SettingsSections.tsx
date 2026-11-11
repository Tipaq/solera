/* PROTOTYPE — jetable (branche proto/page-projet). Ne pas fusionner dans main. */
import { Bot, Check, Compass, FileText, Palette, Plug, Settings2, Trash2, TriangleAlert, Zap } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import type { ProjectDto } from '@solera/protocol'
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, cx } from '@solera/ui'
import { ProjectInstructions } from '../../components/instructions/Instructions'
import { ProjectMemory } from '../../components/instructions/ProjectMemory'
import { ProjectSkills } from '../../components/skills/ProjectSkills'
import { useAllConversations } from '../../lib/conversations'
import { translate, useTranslate } from '../../lib/i18n'
import { PROJECT_COLORS } from '../../lib/project-colors'
import { useDeleteProject, useProjects, useUpdateProject } from '../../lib/projects'
import {
  ProjectAgentSettings,
  ProjectDesignSystem,
  ProjectEnvironment,
  ProjectImage,
  ProjectIssueSource,
  ProjectSettings,
} from '../ProjectPage'
import { ActionsSection } from '../prototype-actions/ActionsSection'

type Section = 'general' | 'agents' | 'actions' | 'integrations' | 'danger'

const SECTIONS: { key: Section; label: string; hint: string; icon: ReactNode }[] = [
  { key: 'general', label: 'Général', hint: 'Nom, chemin, image, couleur, cap, environnement', icon: <Settings2 size={15} /> },
  { key: 'agents', label: 'Agents', hint: 'Consignes, mémoire, skills, réglages', icon: <Bot size={15} /> },
  { key: 'actions', label: 'Actions', hint: 'Raccourcis : serveurs, tests, scripts', icon: <Zap size={15} /> },
  { key: 'integrations', label: 'Intégrations', hint: 'Forge et issues, design system', icon: <Plug size={15} /> },
  { key: 'danger', label: 'Zone de danger', hint: 'Retirer le projet', icon: <TriangleAlert size={15} /> },
]

const SECTION_PARAM = 'section'

/**
 * Les réglages d'un projet en **quatre sections** : une navigation collante à gauche au
 * large, des onglets en haut au téléphone, la section dans l'adresse (`?section=`).
 * Les blocs sont ceux de la page actuelle, rangés ; les cartes-liens vers le board et
 * les worktrees disparaissent, la couleur sort du `⋯`.
 */
export function SettingsSections() {
  const { projectId } = useParams()
  const navigate = useNavigate()
  const t = useTranslate()
  const [params, setParams] = useSearchParams()
  const { data: projects, isPending } = useProjects()
  const { data: conversations } = useAllConversations()
  const project = projects?.find((entry) => entry.id === projectId)

  if (isPending) return null
  if (!project) return <EmptyState title={t('project.notFound')} />

  // Les actions vivent par défaut dans le hub ⚡ : leur section ne vient qu'avec `?actions=reglages`.
  const sections = params.get('actions') === 'reglages' ? SECTIONS : SECTIONS.filter((entry) => entry.key !== 'actions')
  const wanted = params.get(SECTION_PARAM)
  const section: Section = sections.some((entry) => entry.key === wanted) ? (wanted as Section) : 'general'
  const pick = (next: Section) =>
    setParams((current) => {
      current.set(SECTION_PARAM, next)
      return current
    }, { replace: true })
  const hasConversations = (conversations ?? []).some((entry) => entry.projectId === project.id)

  return (
    <div className="h-full overflow-y-auto">
      <div className="flex max-w-5xl flex-col gap-6 p-4 pb-28 md:flex-row md:gap-10 md:p-6">
        {/* La navigation : collante au large, des onglets qui défilent au doigt. */}
        <nav aria-label="Sections des réglages" className="shrink-0 md:sticky md:top-6 md:w-56 md:self-start">
          {/* PROTOTYPE : plus d'en-tête de projet ici — la bande, au-dessus, le nomme déjà. */}
          <ul className="-mx-4 flex gap-1 overflow-x-auto border-b border-line px-4 md:mx-0 md:flex-col md:gap-0.5 md:overflow-visible md:border-0 md:px-0">
            {sections.map((entry) => {
              const active = entry.key === section
              return (
                <li key={entry.key} className="shrink-0">
                  <button
                    type="button"
                    aria-current={active ? 'page' : undefined}
                    onClick={() => pick(entry.key)}
                    className={cx(
                      'flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors',
                      'border-b-2 md:rounded-lg md:border-b-0',
                      active
                        ? 'border-accent text-ink md:bg-surface-high'
                        : 'border-transparent text-ink-soft hover:text-ink md:hover:bg-surface-high/60',
                      entry.key === 'danger' && !active && 'md:text-critical/80',
                    )}
                  >
                    <span className={cx('shrink-0', active ? 'text-ink' : 'text-ink-faint')}>{entry.icon}</span>
                    <span className="flex min-w-0 flex-col">
                      <span className="whitespace-nowrap">{entry.label}</span>
                      <span className="hidden truncate text-xs text-ink-faint md:block">{entry.hint}</span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </nav>

        <main className="flex min-w-0 flex-1 flex-col gap-6">
          <header className="flex flex-col gap-1">
            <h1 className="text-lg font-semibold tracking-tight">{SECTIONS.find((entry) => entry.key === section)!.label}</h1>
            <p className="text-sm text-ink-faint">{SECTIONS.find((entry) => entry.key === section)!.hint}</p>
          </header>

          {section === 'general' ? (
            project.isOwner ? (
              <>
                <ProjectSettings
                  projectId={project.id}
                  initialName={project.name}
                  initialPath={project.workspacePath}
                  initialVisibility={project.visibility}
                  turnCheckpoints={project.turnCheckpoints}
                  hasConversations={hasConversations}
                  onDeleted={() => navigate('/')}
                  hideDanger
                />
                <ColorCard project={project} />
                <ProjectImage project={project} />
                <CapCard projectId={project.id} />
                <ProjectEnvironment projectId={project.id} />
              </>
            ) : (
              <ReadOnly project={project} />
            )
          ) : null}

          {section === 'agents' ? (
            <>
              <Card>
                <CardHeader
                  title={t('instructions.project.title')}
                  description={t('instructions.project.description')}
                  icon={<FileText size={16} />}
                />
                <CardBody>
                  <ProjectInstructions projectId={project.id} />
                </CardBody>
              </Card>
              <ProjectMemory projectId={project.id} />
              <ProjectSkills projectId={project.id} isOwner={project.isOwner} />
              {project.isOwner ? <ProjectAgentSettings project={project} /> : null}
            </>
          ) : null}

          {section === 'actions' ? <ActionsSection projectId={project.id} /> : null}

          {section === 'integrations' ? (
            project.isOwner ? (
              <>
                <ProjectIssueSource projectId={project.id} />
                <ProjectDesignSystem projectId={project.id} initialPath={project.designSystemPath} />
              </>
            ) : (
              <ReadOnly project={project} />
            )
          ) : null}

          {section === 'danger' ? (
            project.isOwner ? <DangerZone project={project} onDeleted={() => navigate('/')} /> : <ReadOnly project={project} />
          ) : null}
        </main>
      </div>
    </div>
  )
}

function ReadOnly({ project }: { project: ProjectDto }) {
  const t = useTranslate()
  return (
    <Card>
      <CardBody className="text-sm text-ink-faint">{t('project.shared.readonly', { name: project.ownerName })}</CardBody>
    </Card>
  )
}

/** La couleur du projet, sortie du `⋯` de la bande : c'est un réglage, pas un geste. */
function ColorCard({ project }: { project: ProjectDto }) {
  const t = useTranslate()
  const update = useUpdateProject()
  return (
    <Card>
      <CardHeader title="Couleur" description="Celle de sa pastille, dans la sidebar et le portefeuille." icon={<Palette size={16} />} />
      <CardBody>
        <div className="flex flex-wrap gap-2">
          {PROJECT_COLORS.map((entry) => {
            const selected = project.color === entry.value
            return (
              <button
                key={entry.value ?? 'default'}
                type="button"
                title={t(entry.label)}
                aria-label={t(entry.label)}
                aria-pressed={selected}
                onClick={() => update.mutate({ id: project.id, color: entry.value })}
                className={cx(
                  'flex size-8 items-center justify-center rounded-full ring-offset-2 ring-offset-canvas transition',
                  selected ? 'ring-2 ring-ink' : 'hover:ring-2 hover:ring-line-strong',
                  entry.value === null && 'bg-accent',
                )}
                style={entry.value ? { background: entry.value } : undefined}
              >
                {selected ? <Check size={14} className="text-white" /> : null}
              </button>
            )
          })}
        </div>
      </CardBody>
    </Card>
  )
}

/**
 * La phrase de cap, facultative. SIMULÉE : rien côté serveur, gardée dans ce navigateur
 * sous la même clé que l'horizon des jalons, pour que les deux se répondent.
 */
function CapCard({ projectId }: { projectId: string }) {
  const key = `proto-cap-${projectId}`
  const [value, setValue] = useState(() => localStorage.getItem(key) ?? '')
  const [saved, setSaved] = useState(value)
  useEffect(() => {
    const stored = localStorage.getItem(key) ?? ''
    setValue(stored)
    setSaved(stored)
  }, [key])
  return (
    <Card>
      <CardHeader
        title="Cap"
        actions={<Badge tone="accent">SIMULÉ</Badge>}
        description="Une phrase, facultative : où va le projet. Affichée en tête des Jalons, donnée à l'agent qui affine un jalon."
        icon={<Compass size={16} />}
      />
      <CardBody className="flex flex-col gap-3">
        <textarea
          value={value}
          onChange={(event) => setValue(event.target.value)}
          rows={2}
          placeholder="Ex. : un outil de pilotage d'agents qu'on utilise au quotidien, au bureau comme au téléphone."
          className="w-full resize-none rounded-lg border border-line bg-sunken px-3 py-2 text-sm outline-none focus:border-accent"
        />
        <div className="flex gap-2">
          <Button
            size="sm"
            disabled={value === saved}
            onClick={() => {
              if (value.trim()) localStorage.setItem(key, value.trim())
              else localStorage.removeItem(key)
              setSaved(value.trim())
            }}
          >
            Enregistrer
          </Button>
          {value !== saved ? (
            <Button size="sm" variant="ghost" onClick={() => setValue(saved)}>
              Annuler
            </Button>
          ) : null}
        </div>
      </CardBody>
    </Card>
  )
}

function DangerZone({ project, onDeleted }: { project: ProjectDto; onDeleted: () => void }) {
  const t = useTranslate()
  const remove = useDeleteProject()
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-critical/40 p-5">
      <div className="flex items-start gap-3">
        <TriangleAlert size={18} className="mt-0.5 shrink-0 text-critical" />
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-sm font-medium">{t('project.settings.remove')}</p>
          <p className="text-sm text-ink-faint">{t('project.settings.remove.notice')}</p>
        </div>
      </div>
      <div>
        <Button
          variant="danger"
          size="sm"
          icon={<Trash2 size={14} />}
          onClick={() => {
            if (!confirm(translate('project.settings.remove.confirm', { name: project.name }))) return
            remove.mutate(project.id, { onSuccess: onDeleted })
          }}
        >
          {t('project.settings.remove')}
        </Button>
      </div>
    </div>
  )
}
