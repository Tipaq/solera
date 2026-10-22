import {
  Menu,
  MenuCheckboxItem,
  MenuItem,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuSub,
  SwitchRow,
  TooltipButton,
  cx,
  useMediaQuery,
} from '@solera/ui'
import { ArrowRightLeft, BookOpen, ChevronRight, Info, Paperclip, PlugZap, Plus, Search, SlidersHorizontal } from 'lucide-react'
import { useState, type ComponentPropsWithRef, type ReactNode, type RefObject } from 'react'
import type { AgentConfig, AgentSkillDto, SlashCommandDto } from '@solera/protocol'
import { useTranslate } from '../../lib/i18n'
import { SettingsSurface, type SettingGroup, type SettingsStatus } from './ComposerSettings'
import { SettingOptions, SettingsHeading } from './SettingsPanel'
import { SkillsInventory, SkillsMenu } from './SkillsInventory'

/**
 * Tout ce qui a quitté la rangée, derrière un seul bouton.
 *
 * Joindre, les skills, les serveurs MCP et les réglages tenaient chacun leur place
 * dans la barre, sur deux lignes. Un « + » les réunit, comme sur claude.ai : ce sont
 * des gestes de préparation, pas des réglages qu'on change à chaque tour.
 *
 * Deux présentations du même contenu, bâties sur les mêmes catégories — comme le
 * contrôle MCP, et comme la surface des réglages. Au pointeur, de vrais sous-menus :
 * ils s'ouvrent à côté de leur parent, se referment seuls, et n'ont donc besoin ni de
 * titre ni de croix à chaque niveau. Au doigt, une seule surface où les vues
 * s'empilent, chacune avec son retour : un troisième menu n'aurait nulle part où
 * s'ouvrir sur un écran de 320 px.
 *
 * Dans les deux cas, un réglage se lit sans être ouvert — sa valeur en vigueur est à
 * droite de son intitulé — et le panneau complet reste au bout, sous « Tous les
 * réglages… », parce qu'il est le seul endroit où plusieurs réglages se comparent d'un
 * coup d'œil.
 *
 * La pastille d'alerte vit ici parce que ce bouton est le seul chemin vers les
 * réglages : sans elle, des approbations coupées ou un mode Plan deviendraient
 * invisibles une fois le menu refermé.
 */
type View = 'root' | 'skills' | 'mcp' | 'settings' | { group: string }

/**
 * La bibliothèque de skills se règle avec les skills et non avec le reste : c'est le
 * même sujet que la liste qu'elle commande.
 */
const IN_SKILLS_MENU = ['skillLibrary']

interface ComposerPlusMenuProps {
  groups: SettingGroup[]
  status: SettingsStatus
  /** Les contrôles MCP, dépliés : le `+` n'ouvre pas un second menu par-dessus. */
  mcp: ReactNode
  /** Les mêmes, en entrées de menu, pour le sous-menu du pointeur. */
  mcpItems: ReactNode
  /** Résumé des serveurs, lu sur l'entrée sans l'ouvrir. */
  mcpSummary: string
  disabled: boolean
  inputRef: RefObject<HTMLTextAreaElement | null>
  /** Ouvre le sélecteur de fichiers, que le composer possède. */
  onAttach: () => void
  /** Faux quand le message a déjà son compte de pièces jointes. */
  canAttach: boolean
  projectId?: string
  config: AgentConfig
  skills: AgentSkillDto[]
  commands: SlashCommandDto[]
  /**
   * Chercher dans le fil et consulter ses détails, descendus de la barre du haut.
   *
   * Ils fouillent et décrivent la session ouverte, exactement comme les skills et les
   * serveurs qui vivaient déjà ici ; la barre, elle, ne garde que ce qui se lit sans
   * être ouvert. Absents du brouillon, qui n'a encore ni fil ni détails.
   */
  onFind?: () => void
  onDetails?: () => void
  /** Continuer le fil dans un autre CLI : il se décrit avec ses détails, il en part. */
  onHandoff?: () => void
}

/** Le raccourci de la recherche dans le fil, écrit comme le clavier de la machine. */
const FIND_HINT = navigator.userAgent.includes('Mac') ? '⌘ F' : 'Ctrl F'

export function ComposerPlusMenu(props: ComposerPlusMenuProps) {
  const sheet = useMediaQuery('(max-width: 34rem), (pointer: coarse)')
  return sheet ? <PlusSheet {...props} /> : <PlusMenu {...props} />
}

/** Le déclencheur, commun aux deux présentations : un « + » et sa pastille d'alerte. */
function PlusTrigger({ status, disabled, ...rest }: {
  status: SettingsStatus
  disabled: boolean
} & ComponentPropsWithRef<'button'>) {
  const t = useTranslate()
  const label = [t('composer.plus.label'), ...status.labels].join(' · ')
  return (
    <TooltipButton
      {...rest}
      type="button"
      disabled={disabled}
      aria-label={label}
      title={label}
      className={cx(
        'relative flex size-11 shrink-0 items-center justify-center rounded-md text-ink-soft md:size-9 pointer-coarse:size-11',
        'hover:bg-surface-high hover:text-ink focus-visible:outline-2 focus-visible:outline-accent',
        'data-[state=open]:bg-accent-wash disabled:pointer-events-none disabled:opacity-45',
      )}
    >
      <Plus size={16} />
      {status.labels.length > 0 ? (
        <span aria-hidden className={cx('absolute top-1.5 right-1.5 size-1.5 rounded-full', status.caution ? 'bg-caution' : 'bg-accent')} />
      ) : null}
    </TooltipButton>
  )
}

/**
 * Au pointeur : un menu, et des sous-menus qui s'ouvrent à côté.
 *
 * Une liste d'options n'a besoin ni de titre ni de croix — on la quitte en revenant
 * sur son parent, qui reste visible. Seules les deux vues qui ne sont pas des listes,
 * l'inventaire des skills et les réglages au complet, s'ouvrent en boîte : elles
 * portent une recherche, un défilement et des sections, qu'un menu ne sait pas tenir.
 */
function PlusMenu({ groups, status, mcpItems, mcpSummary, disabled, onAttach, canAttach, projectId, config, skills, commands, onFind, onDetails, onHandoff }: ComposerPlusMenuProps) {
  const t = useTranslate()
  const settingsGroups = groups.filter((group) => !IN_SKILLS_MENU.includes(group.key))
  const librarySetting = groups.find((group) => group.key === 'skillLibrary')
  const lists = settingsGroups.filter((group) => !group.toggle)
  const toggles = settingsGroups.filter((group) => group.toggle)

  return (
    <Menu align="start" trigger={<PlusTrigger status={status} disabled={disabled} />}>
      <MenuItem icon={<Paperclip size={16} />} disabled={disabled || !canAttach} onSelect={onAttach}>
        {t('composer.attach.label')}
      </MenuItem>
      <MenuSub icon={<BookOpen size={16} />} label={t('composer.plus.skills')}>
        <SkillsMenu projectId={projectId} config={config} skills={skills} commands={commands} library={librarySetting} />
      </MenuSub>
      <MenuSub icon={<PlugZap size={16} />} label={t('composer.plus.mcp')} value={mcpSummary}>
        {mcpItems}
      </MenuSub>
      {onFind || onDetails || onHandoff ? <MenuSeparator /> : null}
      {onFind ? (
        <MenuItem icon={<Search size={16} />} shortcut={FIND_HINT} onSelect={onFind}>
          {t('conversation.search')}
        </MenuItem>
      ) : null}
      {onDetails ? (
        <MenuItem icon={<Info size={16} />} onSelect={onDetails}>
          {t('conversation.meta.details')}
        </MenuItem>
      ) : null}
      {onHandoff ? (
        <MenuItem icon={<ArrowRightLeft size={16} />} onSelect={onHandoff}>
          {t('conversation.handoff.menu')}
        </MenuItem>
      ) : null}
      <MenuSeparator />
      <MenuSub icon={<SlidersHorizontal size={16} />} label={t('composer.plus.settings')} value={status.plan ?? undefined}>
        {lists.map((group) => {
          const current = group.options.find((option) => option.value === group.value)
          return (
            <MenuSub key={group.key} icon={group.icon} label={group.label}
              value={current?.short ?? current?.label ?? group.value} tone={current?.tone} disabled={disabled}>
              {group.notice ? <p className="px-2.5 py-1.5 text-xs text-caution">{group.notice}</p> : null}
              <MenuRadioGroup value={group.value} onValueChange={group.onChange}>
                {group.options.map((option) => (
                  <MenuRadioItem key={option.value} value={option.value}
                    // Le catalogue de modèles tient en noms courts : ses explications
                    // sont des phrases entières, et vingt entrées à trois lignes ne
                    // sont plus un menu. Elles restent dans la puce du modèle.
                    hint={group.key === 'model' ? undefined : option.hint}
                    tone={option.tone} disabled={disabled || option.disabled}>
                    {/* `listed` d'abord, comme `ModelItems` et `ModelMenu` : sinon la ligne par
                        défaut, dont le nom court est celui de sa jumelle, s'affiche ici sous le
                        même nom qu'elle — deux « Opus 5.5 » dont rien ne dit lequel suit le CLI. */}
                    {group.key === 'model' ? (option.listed ?? option.short ?? option.label) : option.label}
                  </MenuRadioItem>
                ))}
              </MenuRadioGroup>
            </MenuSub>
          )
        })}
        {toggles.length > 0 ? <MenuSeparator /> : null}
        {toggles.map((group) => {
          const toggle = group.toggle
          if (!toggle) return null
          const on = group.options.find((option) => option.value === toggle.on)
          return (
            <MenuCheckboxItem
              key={group.key}
              appearance="switch"
              checked={group.value === toggle.on}
              disabled={disabled || on?.disabled}
              onCheckedChange={(checked) => {
                const next = checked ? toggle.on : group.options.find((option) => option.value !== toggle.on)?.value
                if (next) group.onChange(next)
              }}
            >
              <span className="flex flex-col">
                <span>{toggle.label ?? group.label}</span>
                {toggle.hint ?? on?.hint ? <span className="text-meta text-ink-faint">{toggle.hint ?? on?.hint}</span> : null}
              </span>
            </MenuCheckboxItem>
          )
        })}
      </MenuSub>
    </Menu>
  )
}

/** Au doigt : une seule surface, et les vues s'y empilent, chacune avec son retour. */
function PlusSheet({
  groups,
  status,
  mcp,
  mcpSummary,
  disabled,
  inputRef,
  onAttach,
  canAttach,
  projectId,
  config,
  skills,
  commands,
  onFind,
  onDetails,
  onHandoff,
}: ComposerPlusMenuProps) {
  const t = useTranslate()
  const [view, setView] = useState<View>('root')
  const settingsGroups = groups.filter((group) => !IN_SKILLS_MENU.includes(group.key))
  const librarySetting = groups.find((group) => group.key === 'skillLibrary')
  const opened = typeof view === 'object' ? groups.find((group) => group.key === view.group) : undefined

  const title =
    opened?.label ??
    (view === 'root'
      ? t('composer.plus.title')
      : view === 'skills'
        ? t('composer.skills.title')
        : view === 'mcp'
          ? t('composer.plus.mcp')
          : t('composer.plus.settings'))

  return (
    <SettingsSurface
      label={title}
      inputRef={inputRef}
      disabled={disabled}
      // Le « + » est contre le bord gauche de la barre : un panneau aligné à droite
      // s'ouvrirait hors du cadre.
      align="start"
      // Rouvrir doit rendre la première vue : un panneau qui se souvient de la
      // branche où on l'a laissé fait manquer les trois autres.
      onOpenChange={(open) => { if (!open) setView('root') }}
      trigger={<PlusTrigger status={status} disabled={disabled} />}
    >
      {(close) => (
          <>
            {/* Pas d'en-tête sur la première vue : quatre lignes nommées se lisent
                sans titre, et la surface se ferme au-dehors comme par Échap. Les vues
                où l'on entre, elles, ont besoin de leur chemin de retour — et
                l'inventaire des skills porte déjà le sien. */}
            {view === 'root' || view === 'skills' ? null : (
              <SettingsHeading
                title={title}
                onBack={() => setView(opened ? 'settings' : 'root')}
                onClose={() => close()}
              />
            )}
            {view === 'root' ? (
              <div className="flex flex-col p-1">
                <Entry
                  icon={<Paperclip size={16} />}
                  disabled={disabled || !canAttach}
                  onClick={() => { close(); onAttach() }}
                >
                  {t('composer.attach.label')}
                </Entry>
                <Entry icon={<BookOpen size={16} />} submenu onClick={() => setView('skills')}>
                  {t('composer.plus.skills')}
                </Entry>
                <Entry icon={<PlugZap size={16} />} submenu value={mcpSummary} onClick={() => setView('mcp')}>
                  {t('composer.plus.mcp')}
                </Entry>
                {/* Pas de raccourci écrit sur cette pile : elle ne s'ouvre qu'au doigt,
                    où il n'y a pas de clavier pour le jouer. */}
                {onFind || onDetails || onHandoff ? <div className="my-1 h-px bg-line" /> : null}
                {onFind ? (
                  <Entry icon={<Search size={16} />} onClick={() => { close(); onFind() }}>
                    {t('conversation.search')}
                  </Entry>
                ) : null}
                {onDetails ? (
                  <Entry icon={<Info size={16} />} onClick={() => { close(); onDetails() }}>
                    {t('conversation.meta.details')}
                  </Entry>
                ) : null}
                {onHandoff ? (
                  <Entry icon={<ArrowRightLeft size={16} />} onClick={() => { close(); onHandoff() }}>
                    {t('conversation.handoff.menu')}
                  </Entry>
                ) : null}
                <div className="my-1 h-px bg-line" />
                <Entry
                  icon={<SlidersHorizontal size={16} />}
                  submenu
                  value={status.plan ?? undefined}
                  onClick={() => setView('settings')}
                >
                  {t('composer.plus.settings')}
                </Entry>
              </div>
            ) : null}
            {view === 'settings' ? (
              <SettingsMenu
                groups={settingsGroups}
                disabled={disabled}
                onOpenGroup={(key) => setView({ group: key })}
              />
            ) : null}
            {opened ? (
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2 pb-[max(0.5rem,var(--sg-safe-bottom))]">
                {opened.notice ? <p className="mb-2 px-1 text-xs text-caution">{opened.notice}</p> : null}
                {/* Choisir referme la sous-vue et rend le menu : la valeur retenue s'y
                    lit sur la ligne d'où l'on vient, ce qui vaut confirmation. */}
                <SettingOptions
                  group={opened}
                  disabled={disabled}
                  onPick={(picked) => { opened.onChange(picked); setView('settings') }}
                />
              </div>
            ) : null}
            {view === 'mcp' ? (
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2 pb-[max(0.5rem,var(--sg-safe-bottom))]">
                {mcp}
              </div>
            ) : null}
            {view === 'skills' ? (
              <SkillsInventory
                projectId={projectId}
                config={config}
                skills={skills}
                commands={commands}
                library={librarySetting}
                onBack={() => setView('root')}
                onClose={() => close()}
              />
            ) : null}
          </>
      )}
    </SettingsSurface>
  )
}

/**
 * Les réglages de la session en menu, au doigt : une ligne par catégorie, sa valeur à
 * droite.
 *
 * Ce qui s'allume prend un interrupteur et reste sur place — entrer dans une vue pour
 * y cocher l'une de deux valeurs coûte trois gestes là où une bascule en demande un.
 * Le reste ouvre sa liste, qui est celle du panneau complet, sans la recopier.
 */
function SettingsMenu({ groups, disabled, onOpenGroup }: {
  groups: SettingGroup[]
  disabled: boolean
  onOpenGroup: (key: string) => void
}) {
  const lists = groups.filter((group) => !group.toggle)
  const toggles = groups.filter((group) => group.toggle)

  return (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1 pb-[max(0.25rem,var(--sg-safe-bottom))]">
      {lists.map((group) => {
        const current = group.options.find((option) => option.value === group.value)
        return (
          <Entry
            key={group.key}
            icon={group.icon}
            submenu
            disabled={disabled}
            value={current?.short ?? current?.label ?? group.value}
            tone={current?.tone}
            onClick={() => onOpenGroup(group.key)}
          >
            {group.label}
          </Entry>
        )
      })}
      {toggles.length > 0 ? <div className="my-1 h-px bg-line" /> : null}
      {toggles.map((group) => {
        const toggle = group.toggle
        if (!toggle) return null
        const on = group.options.find((option) => option.value === toggle.on)
        return (
          <SwitchRow
            key={group.key}
            checked={group.value === toggle.on}
            disabled={disabled || on?.disabled}
            onCheckedChange={(checked) => {
              const next = checked ? toggle.on : group.options.find((option) => option.value !== toggle.on)?.value
              if (next) group.onChange(next)
            }}
            label={toggle.label ?? group.label}
            description={toggle.hint ?? on?.hint}
          />
        )
      })}
    </div>
  )
}

/**
 * Une ligne de la pile tactile : une action, ou une vue où l'on entre.
 *
 * Partagée avec le menu du modèle, qui reste un panneau des deux côtés : ses options
 * ne sont pas trois mots mais des modèles avec leur caractère, et son rail d'effort
 * n'est pas une entrée de menu.
 */
export function Entry({ icon, children, value, hint, tone, submenu = false, disabled = false, onClick }: {
  icon?: ReactNode
  children: ReactNode
  /** Ce qui est en vigueur, aligné à droite : un réglage se lit sans l'ouvrir. */
  value?: string
  /** Ce que la ligne mène à faire, sous son intitulé. */
  hint?: string
  /** Ambre quand la valeur en vigueur baisse un garde-fou. */
  tone?: 'caution'
  submenu?: boolean
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cx(
        'flex min-h-11 w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm text-ink-soft',
        'hover:bg-accent-wash hover:text-ink focus-visible:outline-2 focus-visible:outline-accent',
        'disabled:pointer-events-none disabled:opacity-45',
      )}
    >
      {icon ? <span className="shrink-0">{icon}</span> : null}
      <span className="min-w-0 flex-1">
        <span className="block">{children}</span>
        {hint ? <span className="mt-0.5 block text-meta text-ink-faint">{hint}</span> : null}
      </span>
      {value ? <span className={cx('shrink-0 text-xs', tone === 'caution' ? 'text-caution' : 'text-ink-faint')}>{value}</span> : null}
      {submenu ? <ChevronRight size={14} aria-hidden className="shrink-0 text-ink-faint" /> : null}
    </button>
  )
}
