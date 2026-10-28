import * as Dialog from '@radix-ui/react-dialog'
import { ChevronRight, Settings, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { IconButton, cx } from '@solera/ui'
import { locale, useTranslate } from '../../lib/i18n'
import { useInstance } from '../../lib/instance'
import { useCurrentUser } from '../../lib/session'
import {
  FIRST_SECTION,
  closeSettings,
  showSettingsSection,
  useSettingsDialog,
  type SettingsSectionId,
} from '../../lib/settings-dialog'
import { useVersionInfo } from '../../lib/system'
import { useMediaQuery } from '../../lib/viewport'
import { UpdateDot } from '../UpdateDot'
import { SETTINGS_GROUPS, visibleSections } from './sections'
import { AboutSection } from '../../routes/AboutSection'
import { AccountSection } from '../../routes/AccountSection'
import { AgentsSettingsPage } from '../../routes/AgentsSettingsPage'
import { ApiTokensSettingsPage } from '../../routes/ApiTokensSettingsPage'
import { AppearanceSection } from '../../routes/AppearanceSection'
import { ArchivingSettingsPage } from '../../routes/ArchivingSettingsPage'
import { DictationSettingsPage } from '../../routes/DictationSettingsPage'
import { DisplaySection } from '../../routes/DisplaySection'
import { GitCredentialsSettingsPage } from '../../routes/GitCredentialsSettingsPage'
import { InstructionsSettingsPage } from '../../routes/InstructionsSettingsPage'
import { PermissionsSettingsPage } from '../../routes/PermissionsSettingsPage'
import { McpSettingsPage } from '../../routes/McpSettingsPage'
import { NotificationsSection } from '../../routes/NotificationsSection'
import { SecretsSettingsPage } from '../../routes/SecretsSettingsPage'
import { SessionsSettingsPage } from '../../routes/SessionsSettingsPage'
import { SkillLibrarySettingsPage } from '../../routes/SkillLibrarySettingsPage'
import { UsersSettingsPage } from '../../routes/UsersSettingsPage'
import { VaultSettingsPage } from '../../routes/VaultSettingsPage'

/**
 * Les réglages, en modale à deux volets.
 *
 * C'était une route, `/settings/*`, qui portait sa propre colonne de 14 rem : ouverte,
 * elle mettait deux colonnes gauche côte à côte et poussait la conversation au bord de
 * l'écran. Une modale ne prend la place de rien et rend l'application dès qu'on la
 * ferme — un réglage se change entre deux gestes, on n'y « va » pas.
 *
 * Au téléphone, elle occupe tout l'écran et retrouve le motif liste-détail : la liste
 * est la page, ouvrir une section la remplace, et une flèche ramène à la liste. Les
 * deux volets côte à côte dans 390 px ne laisseraient à chacun que la moitié de ce
 * qu'il faut.
 */
const CONTENT: Record<SettingsSectionId, () => ReactNode> = {
  compte: AccountSection,
  apparence: AppearanceSection,
  affichage: DisplaySection,
  notifications: NotificationsSection,
  dictee: DictationSettingsPage,
  permissions: PermissionsSettingsPage,
  agents: AgentsSettingsPage,
  mcp: McpSettingsPage,
  consignes: InstructionsSettingsPage,
  skills: SkillLibrarySettingsPage,
  sessions: SessionsSettingsPage,
  git: GitCredentialsSettingsPage,
  secrets: SecretsSettingsPage,
  api: ApiTokensSettingsPage,
  savoir: VaultSettingsPage,
  archivage: ArchivingSettingsPage,
  comptes: UsersSettingsPage,
  'a-propos': AboutSection,
}

export function SettingsDialog() {
  const t = useTranslate()
  const { open, section } = useSettingsDialog()
  const { data: user } = useCurrentUser()
  const { data: versionInfo } = useVersionInfo()
  // Doit rester aligné sur le `md:` de Tailwind, qui commande les deux dispositions.
  const wide = useMediaQuery('(min-width: 48rem)')
  const { data: instance } = useInstance()
  const sections = visibleSections(user?.isAdmin, instance?.capabilities)

  // Au large, aucun volet droit vide : la modale s'ouvre toujours sur une section.
  // La résolution se fait ici et non à l'ouverture, parce que la largeur peut changer
  // pendant qu'elle est ouverte — un téléphone qu'on tourne, une fenêtre qu'on étire.
  // Une section demandée que cette instance cache (le compte, en bureau) compte pour
  // aucune ; et la première section, à défaut, est la première que l'instance montre.
  const requested = sections.some((item) => item.id === section) ? section : null
  const current =
    requested ?? (wide ? (sections.find((item) => item.id === FIRST_SECTION) ?? sections[0])?.id : null)
  const entry = sections.find((item) => item.id === current) ?? null
  const Body = entry ? CONTENT[entry.id] : null

  return (
    <Dialog.Root open={open} onOpenChange={(next) => (next ? null : closeSettings())}>
      <Dialog.Portal>
        <Dialog.Overlay className="scrim z-40" />
        <Dialog.Content
          aria-describedby={undefined}
          className={cx(
            'surface fixed z-50 flex overflow-hidden border-line shadow-pop',
            'inset-0 border-0',
            'md:inset-auto md:top-1/2 md:left-1/2 md:h-[min(80dvh,46rem)]',
            'md:w-[min(64rem,calc(100vw-3rem))] md:-translate-x-1/2 md:-translate-y-1/2',
            'md:rounded-xl md:border',
          )}
        >
          <Dialog.Title className="sr-only">{t('settings.title')}</Dialog.Title>

          {/* La liste cède la place à la section au doigt : les deux ensemble ne
              tiennent pas dans la largeur d'un téléphone. */}
          <nav
            className={cx(
              'flex min-h-0 w-full shrink-0 flex-col overflow-y-auto pt-safe pb-safe',
              'border-line md:w-60 md:border-r',
              entry && !wide && 'hidden',
            )}
          >
            <header className="flex items-center gap-2 px-4 pt-4 pb-3 md:pb-2">
              <Settings size={18} className="shrink-0 text-ink-faint" />
              <h2 className="flex-1 text-lg font-semibold tracking-tight">{t('settings.title')}</h2>
              {/* Au doigt la section n'est pas encore ouverte : sans cette croix, la
                  liste n'aurait rien à toucher pour sortir. */}
              <IconButton label={t('settings.close')} className="md:hidden" onClick={closeSettings}>
                <X size={16} />
              </IconButton>
            </header>

            <div className="flex-1 px-2">
              {SETTINGS_GROUPS.map((group) => {
                const entries = sections.filter((item) => item.group === group)
                if (entries.length === 0) return null
                return (
                  <div key={group} className="mb-4">
                    <h3 className="mb-1 px-2.5 text-meta font-semibold tracking-wide text-ink-faint uppercase">
                      {t(`settings.group.${group}`)}
                    </h3>
                    <ul className="flex flex-col gap-0.5">
                      {entries.map((item) => (
                        <li key={item.id}>
                          <button
                            type="button"
                            onClick={() => showSettingsSection(item.id)}
                            aria-current={item.id === current ? 'true' : undefined}
                            className={cx(
                              'flex min-h-11 w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm transition-colors',
                              item.id === current
                                ? 'bg-accent-wash font-medium text-ink'
                                : 'text-ink-soft hover:bg-surface-high hover:text-ink',
                            )}
                          >
                            <span className="relative shrink-0 text-ink-faint">
                              {item.icon}
                              {item.id === 'a-propos' && versionInfo?.updateAvailable ? (
                                <UpdateDot />
                              ) : null}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate">{t(item.labelKey)}</span>
                              {/* La description n'aide qu'au doigt, où la liste occupe
                                  l'écran et où rien d'autre ne dit ce qu'une section
                                  contient. */}
                              <span className="block text-xs text-ink-faint md:hidden">
                                {t(item.descriptionKey)}
                              </span>
                            </span>
                            <ChevronRight size={14} className="shrink-0 text-ink-faint md:hidden" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )
              })}
            </div>

            {/* Sans repère de version, « je ne vois pas la correction » ne se tranche
                pas : rien à l'écran ne dit quelle version tourne réellement. */}
            <p className="px-4 pt-1 pb-4 text-meta text-ink-faint">
              {t('settings.buildInfo', { version: __APP_VERSION__ })}{' '}
              <time dateTime={__BUILD_TIME__}>
                {new Date(__BUILD_TIME__).toLocaleString(locale())}
              </time>
            </p>
          </nav>

          <div className={cx('flex min-h-0 min-w-0 flex-1 flex-col', !entry && 'hidden md:flex')}>
            <header className="flex shrink-0 items-center gap-2 border-b border-line px-4 py-3 pt-safe md:px-6">
              {/* Retour vers la liste, au doigt seulement : ailleurs elle est déjà
                  sous les yeux, à gauche. */}
              <button
                type="button"
                onClick={() => showSettingsSection(null)}
                className="-ml-1 flex size-8 shrink-0 items-center justify-center rounded-md text-ink-faint hover:bg-surface-high hover:text-ink md:hidden"
                aria-label={t('settings.back')}
              >
                <ChevronRight size={16} className="rotate-180" />
              </button>
              <h2 className="min-w-0 flex-1 truncate text-lg font-semibold tracking-tight">
                {entry ? t(entry.labelKey) : null}
              </h2>
              <IconButton label={t('settings.close')} onClick={closeSettings}>
                <X size={16} />
              </IconButton>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 pb-safe md:px-6">
              {Body ? <Body /> : null}
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
