import { Globe, Lock } from 'lucide-react'
import { Select } from '@solera/ui'
import type { ProjectVisibility } from '@solera/protocol'
import { useTranslate } from '../lib/i18n'
import { useCapability } from '../lib/instance'

/**
 * Le choix privé/partagé d'un projet, à sa création comme dans ses réglages.
 *
 * Absent d'une instance à un seul compte (l'app de bureau) : la question n'y a pas de
 * réponse utile, et le projet garde la valeur que lui donne le formulaire.
 */
export function VisibilitySelect({
  value,
  onChange,
}: {
  value: ProjectVisibility
  onChange: (value: ProjectVisibility) => void
}) {
  const t = useTranslate()
  const sharedProjects = useCapability('sharedProjects')
  if (!sharedProjects) return null
  return (
    <Select
      label={t('project.settings.visibility')}
      value={value}
      onChange={onChange}
      options={[
        {
          value: 'private',
          label: t('project.visibility.private'),
          icon: <Lock size={16} />,
          hint: t('project.visibility.private.hint'),
        },
        {
          value: 'shared',
          label: t('project.visibility.shared'),
          icon: <Globe size={16} />,
          hint: t('project.visibility.shared.hint'),
        },
      ]}
    />
  )
}
