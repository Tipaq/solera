import { MenuCheckboxItem, MenuItem, MenuLabel, MenuSeparator, MenuSub, SwitchRow } from '@solera/ui'
import { BookOpen, Search } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import type { AgentConfig, AgentSkillDto, SlashCommandDto } from '@solera/protocol'
import { useTranslate } from '../../lib/i18n'
import { useSkillLibrary, useUpdateLibrarySkill } from '../../lib/skill-library'
import type { SettingGroup } from './ComposerSettings'
import { SettingsHeading } from './SettingsPanel'

/**
 * Inventaire des skills et des commandes de la session, montré dans le menu « + ».
 *
 * Deux listes et non une : ce que la bibliothèque de Solera livrera au prochain
 * lancement, et ce que le CLI déclare avoir. Le catalogue configuré ne prouve pas que
 * le CLI l'a déjà chargé, et les confondre faisait annoncer des skills absents.
 *
 * Les deux se suivent dans le même défilement, chacune sous son intitulé, plutôt que
 * derrière deux onglets : elles sont courtes, elles répondent à la même question, et
 * l'onglet masqué faisait croire à une bibliothèque vide quand c'est l'autre liste
 * qu'on regardait.
 *
 * Un skill de la bibliothèque s'allume depuis ici. C'est un réglage de la
 * bibliothèque et non de la conversation — il vaut pour toutes les sessions à venir,
 * et l'intitulé de la section le dit.
 */
interface SkillsInventoryProps {
  projectId?: string
  config: AgentConfig
  skills: AgentSkillDto[]
  commands: SlashCommandDto[]
  /**
   * Le réglage de session « bibliothèque de skills », posé ici et non dans les
   * réglages : c'est le même sujet que la liste qu'il commande, et le chercher
   * ailleurs pour savoir pourquoi elle est vide n'a pas de sens.
   */
  library?: SettingGroup
  /** Revenir à la racine du menu « + ». Absent quand la vue s'ouvre en boîte. */
  onBack?: () => void
  /** Absent pour la forme menu, que Radix referme lui-même. */
  onClose?: () => void
}

export function SkillsInventory({ projectId, config, skills, commands, library: librarySetting, onBack, onClose }: SkillsInventoryProps) {
  const t = useTranslate()
  const [search, setSearch] = useState('')
  const library = useSkillLibrary(projectId ?? null)
  const update = useUpdateLibrarySkill()
  // Les skills éteints restent listés, puisqu'on peut les rallumer ici. Un skill
  // illisible, lui, ne se règle pas : il se répare dans la bibliothèque.
  const configured = (library.data?.skills ?? []).filter((skill) => !skill.problem)
  const libraryEnabled = config.skillLibrary && library.data?.enabled === true
  // Claude ne distingue pas les skills des commandes dans son inventaire public.
  const reported = config.agent === 'claude' ? commands : skills
  const matches = (item: { name: string; description: string }) =>
    (item.name + ' ' + item.description).toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())
  const visibleLibrary = configured.filter(matches)
  const visibleReported = reported.filter(matches)

  return <>
    <SettingsHeading title={t('composer.skills.title')} onBack={onBack} onClose={onClose} />
    <div className="shrink-0 px-4 pt-1 pb-3">
      <label className="flex items-center gap-2 rounded-md border border-line bg-sunken px-3">
        <Search size={16} className="shrink-0 text-ink-faint" />
        <input value={search} onChange={(event) => setSearch(event.target.value)} aria-label={t('composer.skills.search')}
          placeholder={t('composer.skills.search')} className="h-11 min-w-0 flex-1 bg-transparent text-sm outline-none" />
      </label>
    </div>
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-2">
      {librarySetting ? <LibrarySwitch group={librarySetting} /> : null}
      <section className={librarySetting ? 'mt-2 border-t border-line pt-2' : undefined}>
        <MenuLabel>{t('composer.skills.configured')}</MenuLabel>
        {library.isPending ? <p role="status" className="px-2.5 py-3 text-sm text-ink-faint">{t('composer.skills.loading')}</p> : null}
        {library.isError ? <p role="alert" className="px-2.5 py-3 text-sm text-critical">{t('composer.skills.error')}</p> : null}
        {!library.isPending && !library.isError && !libraryEnabled ? <p className="px-2.5 py-3 text-sm text-ink-faint">{t('composer.skills.disabled')}</p> : null}
        {libraryEnabled && visibleLibrary.map((skill) => (
          <SwitchRow key={skill.id} checked={skill.enabled} disabled={update.isPending}
            onCheckedChange={(enabled) => update.mutate({ id: skill.id, enabled })}
            label={skill.name}
            description={<span className="line-clamp-2">
              {t(skill.scope === 'project' ? 'composer.skills.project' : 'composer.skills.global')} · {skill.description}
            </span>} />
        ))}
        {libraryEnabled && visibleLibrary.length === 0 ? <p className="px-2.5 py-3 text-sm text-ink-faint">{t('composer.skills.empty')}</p> : null}
      </section>
      <section className="mt-2 border-t border-line pt-2">
        <MenuLabel>{t('composer.skills.session')}</MenuLabel>
        <p className="px-2.5 pb-2 text-meta text-ink-faint">{t(config.agent === 'claude' ? 'composer.skills.commandsHint' : 'composer.skills.reportedHint')}</p>
        {visibleReported.map((skill) => <InventoryRow key={skill.name} name={skill.name} description={skill.description} />)}
        {visibleReported.length === 0 ? <p className="px-2.5 py-3 text-sm text-ink-faint">{t(reported.length === 0 ? 'composer.skills.notReported' : 'composer.skills.empty')}</p> : null}
      </section>
    </div>
    {/* En pied, comme la maquette : c'est une sortie du composer vers un autre écran,
        pas une des lignes qu'on vient lire. */}
    <div className="shrink-0 border-t border-line px-2 pt-1 pb-[max(0.25rem,var(--sg-safe-bottom))]">
      <Link to="/settings/skills" onClick={onClose}
        className="flex min-h-11 items-center gap-2.5 rounded-md px-2.5 text-sm text-ink-soft hover:bg-accent-wash hover:text-ink focus-visible:outline-2 focus-visible:outline-accent">
        <BookOpen size={16} className="shrink-0" />{t('composer.skills.manage')}
      </Link>
    </div>
  </>
}

/**
 * Le réglage de session, en interrupteur : livrer ou non la bibliothèque à la session
 * en cours. Distinct de l'interrupteur de chaque skill, qui vaut pour toutes.
 */
function LibrarySwitch({ group }: { group: SettingGroup }) {
  const on = group.toggle?.on ?? 'on'
  const off = group.options.find((option) => option.value !== on)?.value
  const current = group.options.find((option) => option.value === on)
  return (
    <SwitchRow
      checked={group.value === on}
      onCheckedChange={(checked) => { const next = checked ? on : off; if (next) group.onChange(next) }}
      label={group.toggle?.label ?? group.label}
      description={group.toggle?.hint ?? current?.hint}
    />
  )
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

/**
 * Le même inventaire en entrées de menu, pour le sous-menu du pointeur.
 *
 * Pas de recherche ici : un menu se parcourt au clavier par ses premières lettres, et
 * un champ posé dedans capterait la frappe. Au-delà de quelques dizaines de skills,
 * c'est la bibliothèque qu'on ouvre — l'entrée est en pied.
 */
export function SkillsMenu({ projectId, config, skills, commands, library: librarySetting }: SkillsInventoryProps) {
  const t = useTranslate()
  const navigate = useNavigate()
  const library = useSkillLibrary(projectId ?? null)
  const update = useUpdateLibrarySkill()
  const configured = (library.data?.skills ?? []).filter((skill) => !skill.problem)
  const libraryEnabled = config.skillLibrary && library.data?.enabled === true
  const reported = config.agent === 'claude' ? commands : skills

  return <>
    {librarySetting ? <>
      <MenuSwitchRow group={librarySetting} />
      <MenuSeparator />
    </> : null}
    <MenuLabel>{t('composer.skills.configured')}</MenuLabel>
    {library.isPending ? <p role="status" className="px-2.5 py-2 text-sm text-ink-faint">{t('composer.skills.loading')}</p> : null}
    {library.isError ? <p role="alert" className="px-2.5 py-2 text-sm text-critical">{t('composer.skills.error')}</p> : null}
    {!library.isPending && !library.isError && !libraryEnabled
      ? <p className="px-2.5 py-2 text-meta text-ink-faint">{t('composer.skills.disabled')}</p>
      : null}
    {libraryEnabled && configured.map((skill) => (
      <MenuCheckboxItem key={skill.id} appearance="switch" checked={skill.enabled} disabled={update.isPending}
        onCheckedChange={(enabled) => update.mutate({ id: skill.id, enabled })}>
        <span className="flex flex-col">
          <span>{skill.name}</span>
          <span className="line-clamp-1 text-meta text-ink-faint">{skill.description}</span>
        </span>
      </MenuCheckboxItem>
    ))}
    {libraryEnabled && configured.length === 0
      ? <p className="px-2.5 py-2 text-meta text-ink-faint">{t('composer.skills.empty')}</p>
      : null}
    <MenuSeparator />
    {/* Ce que le CLI annonce ne se règle pas : une liste en lecture, dans son propre
        tiroir pour ne pas doubler la longueur du menu. */}
    <MenuSub label={t('composer.skills.session')} value={String(reported.length)}>
      <p className="px-2.5 py-1.5 text-meta text-ink-faint">
        {t(config.agent === 'claude' ? 'composer.skills.commandsHint' : 'composer.skills.reportedHint')}
      </p>
      {reported.map((skill) => (
        <p key={skill.name} className="px-2.5 py-1.5 text-sm text-ink-soft">
          {skill.name}
          <span className="line-clamp-1 text-meta text-ink-faint">{skill.description}</span>
        </p>
      ))}
      {reported.length === 0
        ? <p className="px-2.5 py-1.5 text-meta text-ink-faint">{t('composer.skills.notReported')}</p>
        : null}
    </MenuSub>
    <MenuItem icon={<BookOpen size={16} />} onSelect={() => navigate('/settings/skills')}>
      {t('composer.skills.manage')}
    </MenuItem>
  </>
}

/** L'interrupteur de session, en entrée de menu. */
function MenuSwitchRow({ group }: { group: SettingGroup }) {
  const on = group.toggle?.on ?? 'on'
  const off = group.options.find((option) => option.value !== on)?.value
  const current = group.options.find((option) => option.value === on)
  const hint = group.toggle?.hint ?? current?.hint
  return (
    <MenuCheckboxItem
      appearance="switch"
      checked={group.value === on}
      onCheckedChange={(checked) => { const next = checked ? on : off; if (next) group.onChange(next) }}
    >
      <span className="flex flex-col">
        <span>{group.toggle?.label ?? group.label}</span>
        {hint ? <span className="text-meta text-ink-faint">{hint}</span> : null}
      </span>
    </MenuCheckboxItem>
  )
}
