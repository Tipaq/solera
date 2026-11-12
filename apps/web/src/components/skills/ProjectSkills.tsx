import { ArrowUpRight } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { LibrarySkillDto } from '@solera/protocol'
import { Banner, FoldLine } from '@solera/ui'
import { useTranslate } from '../../lib/i18n'
import { openSettings } from '../../lib/settings-dialog'
import { useSkillLibrary } from '../../lib/skill-library'
import { AddSkillMenu } from './AddSkillMenu'
import { SkillBadges } from './SkillList'
import { SkillUpdates } from './SkillUpdates'

/**
 * Réglages › Agents › Skills : les skills propres au projet, une ligne chacun, puis ce
 * que l'instance livre ici aussi. Ajouter passe par le même menu que la bibliothèque ;
 * modifier, par l'éditeur d'un skill, qu'une ligne dépliée ouvre.
 */
export function ProjectSkills({ projectId, isOwner }: { projectId: string; isOwner: boolean }) {
  const { data } = useSkillLibrary(projectId)
  const skills = data?.skills ?? []
  const own = skills.filter((skill) => skill.scope === 'project')
  return (
    <ProjectSkillList
      own={own}
      instanceCount={skills.length - own.length}
      libraryOff={Boolean(data && !data.enabled)}
      add={isOwner ? <AddSkillMenu scope="project" projectId={projectId} variant="ghost" align="start" /> : null}
    />
  )
}

/** La liste, sans ses requêtes : ce que la story et les Réglages partagent. */
export function ProjectSkillList({
  own,
  instanceCount,
  libraryOff,
  add,
}: {
  own: LibrarySkillDto[]
  instanceCount: number
  libraryOff: boolean
  add: ReactNode
}) {
  const t = useTranslate()
  return (
    <div className="flex flex-col gap-2">
      {libraryOff ? <Banner tone="caution">{t('skills.instanceDisabled')}</Banner> : null}
      <SkillUpdates skills={own} />
      {own.length === 0 ? (
        <p className="text-sm text-ink-faint">{t('skills.project.empty')}</p>
      ) : (
        <ul className="flex flex-col">
          {own.map((skill) => (
            <FoldLine
              key={skill.id}
              title={
                <span className="flex items-center gap-2">
                  <span className="font-mono">{skill.name}</span>
                  {skill.enabled ? null : <span className="text-xs text-ink-faint">{t('projectSettings.skills.disabled')}</span>}
                </span>
              }
              meta={skill.description || t('skills.description.empty')}
            >
              <div className="flex flex-col gap-2">
                <p className="text-sm text-ink-soft">{skill.description || t('skills.description.empty')}</p>
                <div className="flex flex-wrap items-center gap-2">
                  <SkillBadges skill={skill} showScope={false} />
                  <Link to={`/skills/${skill.id}`} className="inline-flex items-center gap-1 text-xs text-accent hover:underline">
                    {t('projectSettings.skills.open')} <ArrowUpRight size={12} aria-hidden />
                  </Link>
                </div>
              </div>
            </FoldLine>
          ))}
        </ul>
      )}
      <p className="text-xs text-ink-faint">
        {t(instanceCount > 1 ? 'projectSettings.skills.instance.other' : 'projectSettings.skills.instance.one', { count: instanceCount })}{' '}
        <button type="button" onClick={() => openSettings('skills')} className="text-accent hover:underline">
          {t('skills.project.globals.link')}
        </button>
      </p>
      {add}
    </div>
  )
}
