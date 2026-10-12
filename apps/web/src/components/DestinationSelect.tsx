import { MessagesSquare } from 'lucide-react'
import { Select, type SelectOption } from '@solera/ui'
import { ProjectAvatar } from './ProjectAvatar'
import { useProjects } from '../lib/projects'
import { useTranslate } from '../lib/i18n'

/** Valeur sentinelle : le fil n'appartient à aucun projet. Radix interdit la chaîne vide. */
const NONE = '__none__'

/**
 * Où va cette conversation — et le défaut est : nulle part.
 *
 * Premier contrôle de la page d'une conversation neuve, parce que c'est lui qui décide
 * de tout le reste : sans projet il n'y a ni branche, ni carte, ni sessions du dossier à
 * reprendre. Réglé sur *Sans projet*, et ce n'est pas un vide à remplir : on ouvre un
 * fil parce qu'on a une question, savoir de quel projet elle relève vient après, parfois
 * jamais. `Ranger…` est là pour l'après.
 */
export function DestinationSelect({
  value,
  onChange,
  disabled,
}: {
  value: string | null
  onChange: (projectId: string | null) => void
  disabled?: boolean
}) {
  const t = useTranslate()
  const { data: projects } = useProjects()

  const options: SelectOption<string>[] = [
    {
      value: NONE,
      label: t('destination.none'),
      icon: <MessagesSquare size={16} />,
    },
    ...(projects ?? [])
      .filter((project) => project.archivedAt === null)
      .map((project) => ({
        value: project.id,
        label: project.name,
        icon: <ProjectAvatar project={project} className="size-4" />,
      })),
  ]

  return (
    <Select
      label={t('destination.label')}
      value={value ?? NONE}
      options={options}
      disabled={disabled}
      onChange={(next) => onChange(next === NONE ? null : next)}
    />
  )
}
