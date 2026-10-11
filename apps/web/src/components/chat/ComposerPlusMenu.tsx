import { TooltipButton, cx } from '@solera/ui'
import { BookOpen, ChevronRight, Paperclip, PlugZap, Plus, SlidersHorizontal } from 'lucide-react'
import { useState, type ReactNode, type RefObject } from 'react'
import type { AgentConfig, AgentSkillDto, SlashCommandDto } from '@solera/protocol'
import { useTranslate } from '../../lib/i18n'
import { SettingsSurface, type SettingGroup, type SettingsStatus } from './ComposerSettings'
import { SettingsHeading, SettingsPanel } from './SettingsPanel'
import { SkillsInventory } from './SkillsInventory'

/**
 * Tout ce qui a quitté la rangée, derrière un seul bouton.
 *
 * Joindre, les skills, les serveurs MCP et les réglages tenaient chacun leur place
 * dans la barre, sur deux lignes. Un « + » les réunit, comme sur claude.ai : ce sont
 * des gestes de préparation, pas des réglages qu'on change à chaque tour.
 *
 * Une seule surface, qui navigue, plutôt que des sous-menus empilés : trois niveaux
 * sur un écran étroit sont intenables, et deux dispositions différentes — menu au
 * large, feuille au doigt — auraient fait diverger ce qu'on y trouve. La surface est
 * un panneau ancré sur ordinateur et une feuille au doigt, comme les réglages.
 *
 * La pastille d'alerte vit ici parce que ce bouton est le seul chemin vers les
 * réglages : sans elle, des approbations coupées ou un mode Plan deviendraient
 * invisibles une fois le panneau refermé.
 */
type View = 'root' | 'skills' | 'mcp' | 'settings'

interface ComposerPlusMenuProps {
  groups: SettingGroup[]
  status: SettingsStatus
  /** Les contrôles MCP, dépliés : le `+` n'ouvre pas un second menu par-dessus. */
  mcp: ReactNode
  /** Résumé des serveurs, lu sur l'entrée sans l'ouvrir. */
  mcpSummary: string
  feedback?: ReactNode
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
}

export function ComposerPlusMenu({
  groups,
  status,
  mcp,
  mcpSummary,
  feedback,
  disabled,
  inputRef,
  onAttach,
  canAttach,
  projectId,
  config,
  skills,
  commands,
}: ComposerPlusMenuProps) {
  const t = useTranslate()
  const [view, setView] = useState<View>('root')

  const titles: Record<View, string> = {
    root: t('composer.plus.title'),
    skills: t('composer.skills.title'),
    mcp: t('composer.plus.mcp'),
    settings: t('composer.settings.title'),
  }

  return (
    <SettingsSurface
      label={titles[view]}
      inputRef={inputRef}
      disabled={disabled}
      // Le « + » est contre le bord gauche de la barre : un panneau aligné à droite
      // s'ouvrirait hors du cadre.
      align="start"
      // Rouvrir doit rendre la première vue : un panneau qui se souvient de la
      // branche où on l'a laissé fait manquer les trois autres.
      onOpenChange={(open) => { if (!open) setView('root') }}
      trigger={
        <TooltipButton
          type="button"
          disabled={disabled}
          aria-label={[t('composer.plus.label'), ...status.labels].join(' · ')}
          title={[t('composer.plus.label'), ...status.labels].join(' · ')}
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
      }
    >
      {(close) => {
        if (view === 'settings') {
          return (
            <SettingsPanel
              groups={groups}
              disabled={disabled}
              extra={mcp}
              feedback={feedback}
              onBack={() => setView('root')}
              onDone={() => close(true)}
              onClose={() => close()}
            />
          )
        }
        return (
          <>
            {/* L'inventaire des skills porte son propre en-tête, comme le panneau de
                réglages : il n'en reçoit pas un second. */}
            {view === 'skills' ? null : (
              <SettingsHeading
                title={titles[view]}
                onBack={view === 'root' ? undefined : () => setView('root')}
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
                onBack={() => setView('root')}
                onClose={() => close()}
              />
            ) : null}
          </>
        )
      }}
    </SettingsSurface>
  )
}

/** Une ligne du menu : une action, ou une vue où l'on entre. */
function Entry({ icon, children, value, submenu = false, disabled = false, onClick }: {
  icon: ReactNode
  children: ReactNode
  /** Ce qui est en vigueur, aligné à droite : un réglage se lit sans l'ouvrir. */
  value?: string
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
      <span className="shrink-0">{icon}</span>
      <span className="min-w-0 flex-1">{children}</span>
      {value ? <span className="shrink-0 text-xs text-ink-faint">{value}</span> : null}
      {submenu ? <ChevronRight size={14} aria-hidden className="shrink-0 text-ink-faint" /> : null}
    </button>
  )
}
