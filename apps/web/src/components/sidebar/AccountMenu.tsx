import { ChevronDown, GaugeCircle, Info, LogOut, MessageCircleQuestion, Palette, Server, Settings } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslate } from '../../lib/i18n'
import { useCurrentUser, useLogout } from '../../lib/session'
import { useDisplaySettings } from '../../lib/display-settings'
import { openSettings } from '../../lib/settings-dialog'
import { useVersionInfo, useUpdateNotice } from '../../lib/system'
import { THEMES, THEME_LABELS, useTheme } from '../../lib/theme'
import { UpdateDot } from '../UpdateDot'
import { UsagePanel } from '../UsagePanel'
import { cx, Menu, MenuItem, MenuSeparator } from '@solera/ui'

/**
 * Le compte, en une ligne, tout en bas de la colonne.
 *
 * *Services* et *Réglages* y entrent : **deux lignes gagnées** en bas de colonne, qui
 * n'en garde qu'une. La pastille de mise à jour remonte sur l'avatar ; elle était sur
 * l'icône des réglages, qui n'a plus de ligne à elle.
 *
 * *Consommation* ouvre la modale des CLI et de leurs comptes : elle appartient au compte — le chiffre
 * est le même quel que soit le fil — et son panneau, jusqu'ici ouvert depuis une
 * conversation, ne connaissait que le CLI de celle-ci.
 *
 * La maquette porte un montant à droite de l'entrée (« 4,10 $ »). Il n'est pas écrit :
 * aucun CLI ne déclare de coût dans `AgentUsage`, et le chiffre qui s'en approcherait —
 * une part de quota — demanderait de lancer les trois CLI à chaque ouverture du menu,
 * pour une ligne que personne n'a demandée. Le montant reviendra le jour où il arrivera
 * sans ce prix.
 *
 * *Raccourcis*, la septième entrée, manque encore : aucun écran ne les liste (carte #20).
 */
export function AccountMenu({ onNavigate }: { onNavigate: () => void }) {
  const t = useTranslate()
  const navigate = useNavigate()
  const { data: user } = useCurrentUser()
  const display = useDisplaySettings()
  const logout = useLogout()
  const updateNotice = useUpdateNotice()
  const { data: version } = useVersionInfo()
  const [theme, setTheme] = useTheme()
  const [usageOpen, setUsageOpen] = useState(false)

  const go = (path: string) => {
    onNavigate()
    navigate(path)
  }

  /**
   * Les réglages n'ont plus de route : ils s'ouvrent en modale par-dessus ce qu'on
   * lisait. Y naviguer passerait par la route de compatibilité, qui rend la main à
   * l'accueil — on perdrait la vue en ouvrant un réglage.
   */
  const settings = (section?: Parameters<typeof openSettings>[0]) => {
    onNavigate()
    openSettings(section)
  }

  return (
    <div className="shrink-0 border-t border-line p-2 pb-[max(0.5rem,var(--sg-safe-bottom))]">
      <Menu
        align="start"
        trigger={
          <button
            type="button"
            className="flex h-11 w-full items-center gap-2.5 rounded-md px-2 text-left text-sm text-ink-soft transition-colors hover:bg-surface-high hover:text-ink md:h-10 pointer-coarse:h-11"
          >
            <span className="relative shrink-0">
              {/* L'initiale est un ornement : sans `aria-hidden`, le bouton s'annonce
                  « A Alex ». */}
              <span aria-hidden className="flex size-6 items-center justify-center rounded-full bg-accent-wash text-micro font-semibold uppercase text-accent">
                {(user?.displayName ?? user?.username ?? '?').slice(0, 1)}
              </span>
              {updateNotice ? <UpdateDot /> : null}
            </span>
            <span className="min-w-0 flex-1 truncate">{user?.displayName ?? user?.username}</span>
            {updateNotice ? <span className="sr-only">{t('about.badge.updateAvailable')}</span> : null}
            <ChevronDown size={14} className="shrink-0 text-ink-faint" />
          </button>
        }
      >
        {/* Jamais grisée, même sans CLI installé : savoir lesquels le sont demande une
            sonde qui lance un process par CLI, et ce menu est monté en permanence — la
            payer à chaque retour sur l'onglet pour griser une ligne serait un mauvais
            marché. C'est la modale qui le dit, une fois ouverte. */}
        <MenuItem
          icon={<GaugeCircle size={14} />}
          onSelect={() => {
            onNavigate()
            setUsageOpen(true)
          }}
        >
          {t('shell.account.usage')}
        </MenuItem>
        {display.services ? (
          <MenuItem icon={<Server size={14} />} onSelect={() => go('/services')}>
            {t('services.title')}
          </MenuItem>
        ) : null}
        {/* L'historique des décisions : la section « À décider » de la colonne y mène,
            mais elle disparaît quand rien n'attend, et l'historique reste à relire. */}
        <MenuItem icon={<MessageCircleQuestion size={14} />} onSelect={() => go('/decisions')}>
          {t('decision.page.title')}
        </MenuItem>
        <MenuItem icon={<Settings size={14} />} onSelect={() => settings()}>
          {t('shell.settings.fallback')}
        </MenuItem>
        <MenuSeparator />
        {/* Le thème en segmenté dans le menu : le choisir se voit tout de suite, et un
            sous-menu pour trois valeurs coûterait un aller-retour de plus. Des boutons
            nus plutôt que des entrées de menu, qui refermeraient le panneau à chaque
            essai. */}
        <div className="flex items-center gap-2.5 px-2.5 py-2 text-sm text-ink-soft">
          <Palette size={14} className="shrink-0" />
          <span className="flex-1">{t('shell.account.theme')}</span>
          <span className="flex items-center gap-0.5 rounded-md bg-sunken p-0.5">
            {THEMES.map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={theme === option}
                onClick={() => setTheme(option)}
                className={cx(
                  'rounded px-1.5 py-0.5 text-micro transition-colors',
                  theme === option ? 'bg-surface-high font-medium text-ink' : 'text-ink-faint hover:text-ink',
                )}
              >
                {t(THEME_LABELS[option])}
              </button>
            ))}
          </span>
        </div>
        <MenuItem icon={<Info size={14} />} onSelect={() => settings('a-propos')}>
          <span className="flex items-center gap-2">
            {t('about.title')}
            {version ? (
              <span className={cx(
                'rounded-full px-1.5 py-px text-micro tabular-nums',
                updateNotice ? 'bg-accent-wash text-accent' : 'text-ink-faint',
              )}>
                {version.version}
              </span>
            ) : null}
          </span>
        </MenuItem>
        <MenuSeparator />
        <MenuItem icon={<LogOut size={14} />} onSelect={() => logout.mutate()}>
          {t('shell.logout')}
        </MenuItem>
      </Menu>

      {/* Hors du menu : il se referme en ouvrant la modale, et son portail emporterait
          celui de Radix avec lui. */}
      <UsagePanel open={usageOpen} onOpenChange={setUsageOpen} />
    </div>
  )
}
