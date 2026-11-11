import type { ProjectDto } from '@solera/protocol'
import { useTranslate } from '../../lib/i18n'
import { ModelDefaultsSettings, PermissionsSettings } from '../settings/LayeredSettings'

/**
 * Les réglages des agents propres au projet (#120, Q33) : les mêmes sections que celles
 * du compte, chaque ligne disant si elle en hérite ou si le projet la change.
 *
 * Partagés, à la différence des réglages du compte : ce que le projet change vaut pour
 * tous ses membres, et le reste vient du compte de chacun. D'où l'écriture réservée au
 * propriétaire, comme le reste des réglages du projet. Les conversations qui n'ont pas
 * changé une valeur la suivent à la relance de leur session.
 */
export function ProjectAgentSettings({ project }: { project: ProjectDto }) {
  const t = useTranslate()
  const level = { kind: 'project', project } as const
  return (
    <section className="flex flex-col gap-4" aria-labelledby="project-agent-settings">
      {/* Les autres blocs de la page sont des cartes à un seul réglage ; celui-ci en
          réunit plusieurs, et son titre les annonce. */}
      <div className="flex flex-col gap-1 pt-2">
        <h2 id="project-agent-settings" className="text-base font-semibold text-ink">
          {t('project.agentSettings.title')}
        </h2>
        <p className="text-sm text-ink-faint">{t('project.agentSettings.description')}</p>
      </div>
      <PermissionsSettings level={level} />
      <ModelDefaultsSettings level={level} />
    </section>
  )
}
