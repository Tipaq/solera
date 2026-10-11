import { TooltipButton, cx } from '@solera/ui'
import { ChevronDown } from 'lucide-react'
import type { RefObject } from 'react'
import type { AgentKind } from '@solera/protocol'
import { useTranslate } from '../../lib/i18n'
import { AgentIcon } from '../AgentIcon'
import { SettingsSurface, type SettingGroup } from './ComposerSettings'
import { SettingOptions, SettingsHeading } from './SettingsPanel'

/**
 * Marques dont le nom d'un modèle se préfixe sans rien apprendre.
 *
 * « claude-sonnet-5 » répète la marque que l'icône porte déjà, et c'est ce préfixe qui
 * faisait déborder la puce au téléphone. Les modèles d'opencode s'écrivent
 * `fournisseur/modèle` : le fournisseur tombe pour la même raison.
 */
const BRANDS = ['claude', 'anthropic', 'openai']

/**
 * Nom court d'un modèle, pour une puce qui porte déjà sa marque en icône.
 *
 * Ne retire jamais tout : un libellé qui ne serait qu'une marque reste entier, mieux
 * vaut une puce large qu'une puce vide.
 */
export function shortModelLabel(label: string): string {
  const slash = label.indexOf('/')
  const withoutProvider = slash > 0 ? label.slice(slash + 1) : label
  const match = /^([A-Za-zÀ-ÿ]+)[-\s](.+)$/.exec(withoutProvider)
  const [, brand = '', rest = ''] = match ?? []
  return BRANDS.includes(brand.toLocaleLowerCase()) ? rest : withoutProvider
}

/**
 * La puce du modèle : marque du CLI, nom court, effort, et le menu qui les change.
 *
 * Un seul déclencheur pour trois réglages qui vont ensemble — le modèle, son niveau
 * d'effort, et le mode rapide quand il existe — parce que les niveaux d'effort
 * dépendent du modèle choisi et qu'ils se lisaient jusqu'ici sur deux boutons dont le
 * second changeait de contenu sans prévenir.
 */
export function ModelControl({ agent, groups, disabled, inputRef }: {
  agent: AgentKind
  groups: SettingGroup[]
  disabled: boolean
  inputRef: RefObject<HTMLTextAreaElement | null>
}) {
  const t = useTranslate()
  const model = groups.find((group) => group.key === 'model')
  const effort = groups.find((group) => group.key === 'effort')
  const speed = groups.find((group) => group.key === 'speed')
  if (!model) return null

  const value =
    model.options.find((option) => option.value === model.value)?.label ||
    model.value ||
    t('composer.select.default')
  const effortValue = effort?.options.find((option) => option.value === effort.value)?.label

  return (
    <SettingsSurface
      label={model.label}
      inputRef={inputRef}
      disabled={disabled}
      quick
      trigger={
        <TooltipButton
          type="button"
          disabled={disabled}
          aria-label={t('composer.settings.quick', { setting: model.label, value })}
          title={t('composer.settings.quick', { setting: model.label, value })}
          className={cx(
            'flex min-h-11 min-w-0 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-ink md:min-h-9 pointer-coarse:min-h-11',
            'hover:bg-surface-high focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent',
            'data-[state=open]:bg-accent-wash disabled:pointer-events-none disabled:opacity-45',
          )}
        >
          <AgentIcon agent={agent} size={14} />
          <span className="min-w-0 truncate">{shortModelLabel(value)}</span>
          {/* L'effort ne s'écrit que là où il reste de la place : au téléphone, c'est
              le nom du modèle qui doit rester lisible. */}
          {effortValue ? (
            <span className="hidden shrink-0 font-normal text-ink-faint @min-[26rem]:inline">· {effortValue}</span>
          ) : null}
          {/* Le chevron tombe sous 352 px de barre : au plus serré, c'est le nom du
              modèle qui doit rester lisible, et la puce reste un bouton nommé. */}
          <ChevronDown size={14} aria-hidden className="hidden shrink-0 text-ink-faint @min-[22rem]:block" />
        </TooltipButton>
      }
    >
      {(close) => (
        <>
          <SettingsHeading title={model.label} onClose={() => close()} />
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 pb-[max(0.75rem,var(--sg-safe-bottom))]">
            {model.notice ? <p className="mb-2 text-xs text-caution">{model.notice}</p> : null}
            {/* Choisir un modèle referme : c'est la décision principale, et les niveaux
                d'effort proposés en dessous ne sont plus les mêmes après. L'effort et
                la vitesse, eux, s'appliquent sans fermer. */}
            <SettingOptions
              group={model}
              disabled={disabled}
              onPick={(picked) => { model.onChange(picked); close(true) }}
            />
            {[effort, speed].flatMap((group) => group ?? []).map((group) => (
              <section key={group.key} className="mt-4">
                <h3 className="mb-2 flex items-center gap-2 text-xs font-medium text-ink-soft">
                  {group.icon}{group.label}
                </h3>
                {group.notice ? <p className="mb-2 text-xs text-caution">{group.notice}</p> : null}
                <SettingOptions group={group} disabled={disabled} compact onPick={group.onChange} />
              </section>
            ))}
          </div>
        </>
      )}
    </SettingsSurface>
  )
}
