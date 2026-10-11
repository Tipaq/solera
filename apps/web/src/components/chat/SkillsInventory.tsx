import { Tabs } from '@solera/ui'
import { BookOpen, Search } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { AgentConfig, AgentSkillDto, SlashCommandDto } from '@solera/protocol'
import { useTranslate } from '../../lib/i18n'
import { useSkillLibrary } from '../../lib/skill-library'
import { SettingsHeading } from './SettingsPanel'

/**
 * Inventaire des skills et des commandes de la session, montré dans le menu « + ».
 *
 * Deux listes et non une : ce que la bibliothèque de Solera livrera au prochain
 * lancement, et ce que le CLI déclare avoir. Le catalogue configuré ne prouve pas que
 * le CLI l'a déjà chargé, et les confondre faisait annoncer des skills absents.
 */
interface SkillsInventoryProps {
  projectId?: string
  config: AgentConfig
  skills: AgentSkillDto[]
  commands: SlashCommandDto[]
  /** Revenir à la racine du menu « + », d'où cette vue a été ouverte. */
  onBack: () => void
  onClose: () => void
}

export function SkillsInventory({ projectId, config, skills, commands, onBack, onClose }: SkillsInventoryProps) {
  const t = useTranslate()
  const [search, setSearch] = useState('')
  const [view, setView] = useState<'library' | 'reported'>('library')
  const library = useSkillLibrary(projectId ?? null)
  const configured = (library.data?.skills ?? []).filter((skill) => skill.enabled && !skill.problem)
  const libraryEnabled = config.skillLibrary && library.data?.enabled === true
  // Claude ne distingue pas les skills des commandes dans son inventaire public.
  const reported = config.agent === 'claude' ? commands : skills
  const matches = (item: { name: string; description: string }) =>
    (item.name + ' ' + item.description).toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())
  const visibleLibrary = configured.filter(matches)
  const visibleReported = reported.filter(matches)

  return <>
    <SettingsHeading title={t('composer.skills.title')} onBack={onBack} onClose={onClose} />
    <div className="shrink-0 px-4">
      <Link to="/settings/skills" onClick={onClose} className="mb-3 flex min-h-11 items-center gap-2 text-sm text-accent"><BookOpen size={16} />{t('composer.skills.manage')}</Link>
      <label className="flex items-center gap-2 rounded-md border border-line bg-sunken px-3">
        <Search size={16} className="shrink-0 text-ink-faint" />
        <input value={search} onChange={(event) => setSearch(event.target.value)} aria-label={t('composer.skills.search')}
          placeholder={t('composer.skills.search')} className="h-11 min-w-0 flex-1 bg-transparent text-sm outline-none" />
      </label>
      {/* Le soulignement des onglets fait office de bordure basse du bloc : la
          `border-b` du conteneur tracerait une seconde ligne à douze pixels. */}
      <Tabs label={t('composer.skills.title')} value={view} onChange={setView} layout="fill" className="mt-3 -mx-4 px-4" tabs={[
        { value: 'library', label: t('composer.skills.configured'), count: visibleLibrary.length },
        { value: 'reported', label: t('composer.skills.session'), count: visibleReported.length },
      ]} />
    </div>
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4">
      {view === 'library' ? <section>
        <p className="py-3 text-xs text-ink-faint">{t('composer.skills.configuredHint')}</p>
        {library.isPending ? <p role="status" className="py-3 text-sm text-ink-faint">{t('composer.skills.loading')}</p> : null}
        {library.isError ? <p role="alert" className="py-3 text-sm text-critical">{t('composer.skills.error')}</p> : null}
        {!library.isPending && !library.isError && !libraryEnabled ? <p className="py-3 text-sm text-ink-faint">{t('composer.skills.disabled')}</p> : null}
        {libraryEnabled && visibleLibrary.map((skill) => <InventoryRow key={skill.id} name={skill.name} description={skill.description}
          scope={t(skill.scope === 'project' ? 'composer.skills.project' : 'composer.skills.global')} />)}
        {libraryEnabled && visibleLibrary.length === 0 ? <p className="py-3 text-sm text-ink-faint">{t('composer.skills.empty')}</p> : null}
      </section> : <section>
        <h3 className="pt-3 text-xs font-semibold text-ink-soft">{t(config.agent === 'claude' ? 'composer.skills.commands' : 'composer.skills.reported')}</h3>
        <p className="py-3 text-xs text-ink-faint">{t(config.agent === 'claude' ? 'composer.skills.commandsHint' : 'composer.skills.reportedHint')}</p>
        {visibleReported.map((skill) => <InventoryRow key={skill.name} name={skill.name} description={skill.description} />)}
        {visibleReported.length === 0 ? <p className="py-3 text-sm text-ink-faint">{t(reported.length === 0 ? 'composer.skills.notReported' : 'composer.skills.empty')}</p> : null}
      </section>}
    </div>
  </>
}

/** Une description longue reste consultable sans allonger tout l'inventaire. */
function InventoryRow({ name, description, scope }: { name: string; description: string; scope?: string }) {
  return <details className="group border-b border-line py-3 last:border-0">
    <summary className="cursor-pointer rounded-sm outline-offset-4 focus-visible:outline-accent">
      <span className="ml-1 break-words text-sm font-medium">{name}</span>
      {scope ? <span className="float-right ml-3 text-xs text-ink-faint">{scope}</span> : null}
      <span className="mt-1 line-clamp-2 text-xs text-ink-faint group-open:hidden">{description}</span>
    </summary>
    <p className="mt-2 whitespace-pre-wrap break-words text-sm text-ink-soft">{description}</p>
  </details>
}
