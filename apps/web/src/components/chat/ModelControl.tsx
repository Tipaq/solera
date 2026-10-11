import {
  Menu,
  MenuCheckboxItem,
  MenuLabel,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuSub,
  SwitchRow,
  TooltipButton,
  cx,
  useMediaQuery,
} from '@solera/ui'
import { ChevronDown } from 'lucide-react'
import { useState, type ComponentPropsWithRef, type RefObject } from 'react'
import type { AgentKind } from '@solera/protocol'
import { useTranslate } from '../../lib/i18n'
import { AgentIcon } from '../AgentIcon'
import { Entry } from './ComposerPlusMenu'
import { SettingsSurface, useResumeTyping, type SettingGroup } from './ComposerSettings'
import { SettingOptions, SettingsHeading } from './SettingsPanel'

/**
 * Modèles montrés d'emblée quand le catalogue est long, avant « Plus de modèles… ».
 *
 * Trois, parce qu'un CLI peut en annoncer une vingtaine et qu'on en emploie deux ou
 * trois : la liste entière ferait d'un geste courant une lecture. Le modèle en vigueur
 * s'y ajoute s'il n'y figure pas, sans quoi le menu s'ouvrirait sans montrer ce qui
 * est choisi.
 */
const SHORTLIST = 3

/**
 * En deçà, tout le catalogue tient dans le menu et s'y montre entier.
 *
 * Claude Code n'annonce que cinq entrées : en replier deux derrière « Plus de
 * modèles… » coûtait un geste et laissait croire qu'il n'y a rien d'autre. Même seuil
 * que la recherche du panneau complet, qui apparaît au-delà de huit options : une
 * liste qui se lit d'un coup d'œil ne se replie pas.
 */
const SHORTLIST_ABOVE = 8

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
 * Nom court d'un modèle : sa famille et sa version, lues sur l'identifiant canonique.
 *
 * `claude-opus-5[1m]` donne « Opus 5 », `claude-haiku-4-5-20251001` « Haiku 4.5 »,
 * `anthropic/claude-sonnet-5` « Sonnet 5 ». C'est l'identifiant qu'on lit et non le nom
 * affiché, parce que les CLI mettent dans celui-ci la variante de contexte et la
 * mention « recommandé » — « Opus (1M context) », « Default (recommended) » — qui
 * tiennent mal dans la rangée et taisent la génération qui répondra.
 *
 * Seuls les identifiants qui commencent par une marque connue sont relus ainsi : eux
 * seuls portent la version. Ailleurs — `gpt-5-codex`, un modèle d'opencode — le nom
 * affiché est déjà le bon, et c'est lui qui sert.
 */
export function shortModelName(resolved: string | null | undefined, fallback: string): string {
  return modelIdName(resolved) ?? shortModelLabel(fallback)
}

/** Le nom lu sur l'identifiant, ou null quand celui-ci ne porte pas de version. */
export function modelIdName(resolved: string | null | undefined): string | null {
  const id = (resolved ?? '').slice((resolved ?? '').indexOf('/') + 1)
  const brand = BRANDS.find((name) => id.toLowerCase().startsWith(`${name}-`))
  if (!brand) return null
  const parts = id
    .slice(brand.length + 1)
    // La variante de contexte et la date de publication ne sont pas le nom du modèle.
    .replace(/\[[^\]]*\]$/, '')
    .replace(/-\d{8}$/, '')
    .split('-')
    .filter(Boolean)
  if (parts.length === 0) return null
  // Les segments de version se recollent entre eux — `4-5` devient `4.5` — et suivent
  // le mot qu'ils numérotent.
  const words = parts.reduce<string[]>((acc, part) => {
    const previous = acc[acc.length - 1]
    if (/^\d+$/.test(part) && previous && /^[\d.]+$/.test(previous)) acc[acc.length - 1] = `${previous}.${part}`
    else acc.push(part)
    return acc
  }, [])
  return words.map((word) => (/^\d/.test(word) ? word : word.charAt(0).toLocaleUpperCase() + word.slice(1))).join(' ')
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
  const sheet = useMediaQuery('(max-width: 34rem), (pointer: coarse)')
  const resume = useResumeTyping(inputRef)
  const model = groups.find((group) => group.key === 'model')
  const effort = groups.find((group) => group.key === 'effort')
  const speed = groups.find((group) => group.key === 'speed')
  if (!model) return null

  const selected = model.options.find((option) => option.value === model.value)
  const value = selected?.label || model.value || t('composer.select.default')
  const chip = selected?.short || shortModelLabel(value)
  const effortValue = effort?.options.find((option) => option.value === effort.value)?.label

  const trigger = (
    <ModelChip agent={agent} label={model.label} value={value} chip={chip} effort={effortValue}
      disabled={disabled} {...resume.trigger} />
  )

  // Au pointeur, le même dessin que le « + » : des sous-menus qui s'ouvrent à côté.
  // Au doigt, un panneau, parce que le rail d'effort se touche d'un geste là où un
  // sous-menu en demanderait deux.
  if (!sheet) {
    return (
      <Menu align="start" trigger={trigger} onCloseAutoFocus={resume.onCloseAutoFocus}>
        <ModelItems model={model} disabled={disabled} />
        {effort || speed ? <MenuSeparator /> : null}
        {effort ? (
          <MenuSub icon={effort.icon} label={effort.label}
            value={effort.options.find((option) => option.value === effort.value)?.label}
            disabled={disabled}>
            {effort.notice ? <p className="px-2.5 py-1.5 text-xs text-caution">{effort.notice}</p> : null}
            <MenuRadioGroup value={effort.value} onValueChange={effort.onChange}>
              {effort.options.map((option) => (
                <MenuRadioItem key={option.value} value={option.value} hint={option.hint}
                  tone={option.tone} disabled={disabled || option.disabled}>
                  {option.label}
                </MenuRadioItem>
              ))}
            </MenuRadioGroup>
          </MenuSub>
        ) : null}
        {speed?.toggle ? <SpeedItem group={speed} disabled={disabled} /> : null}
      </Menu>
    )
  }

  return (
    <SettingsSurface
      label={model.label}
      inputRef={inputRef}
      disabled={disabled}
      quick
      trigger={trigger}
    >
      {(close) => <ModelMenu agent={agent} model={model} effort={effort} speed={speed} disabled={disabled} close={close} />}
    </SettingsSurface>
  )
}

/** La puce elle-même, commune aux deux présentations. */
function ModelChip({ agent, label, value, chip, effort, disabled, ...rest }: {
  agent: AgentKind
  label: string
  /** Nom entier, pour l'intitulé accessible : la puce, elle, montre le nom court. */
  value: string
  chip: string
  effort?: string
  disabled: boolean
} & ComponentPropsWithRef<'button'>) {
  const t = useTranslate()
  const title = t('composer.settings.quick', { setting: label, value })
  return (
    <TooltipButton
      {...rest}
      type="button"
      disabled={disabled}
      aria-label={title}
      title={title}
      className={cx(
        // Resserrée au pointeur : la hauteur reste celle du catalogue — 44 px au
        // doigt, 36 à la souris — mais l'écartement et les marges d'une puce de
        // barre n'ont pas à être ceux d'un bouton de formulaire.
        'flex min-h-11 min-w-0 items-center gap-1 rounded-md px-1.5 text-xs font-medium text-ink md:min-h-9 pointer-coarse:min-h-11',
        'hover:bg-surface-high focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent',
        'data-[state=open]:bg-accent-wash disabled:pointer-events-none disabled:opacity-45',
      )}
    >
      <AgentIcon agent={agent} size={14} decorative />
      <span className="min-w-0 truncate">{chip}</span>
      {/* L'effort ne s'écrit que là où il reste de la place : au téléphone, c'est
          le nom du modèle qui doit rester lisible. */}
      {effort ? (
        <span className="hidden shrink-0 text-meta font-normal text-ink-faint @min-[26rem]:inline">· {effort}</span>
      ) : null}
      {/* Le chevron tombe sous 352 px de barre : au plus serré, c'est le nom du
          modèle qui doit rester lisible, et la puce reste un bouton nommé. */}
      <ChevronDown size={11} aria-hidden className="hidden shrink-0 text-ink-faint @min-[22rem]:block" />
    </TooltipButton>
  )
}

/**
 * Les modèles, en entrées de menu : les courants d'emblée, le reste dans un tiroir.
 *
 * Pas de recherche ici, contrairement au panneau : un menu se parcourt au clavier par
 * les premières lettres, et un champ posé dedans capterait la frappe.
 */
function ModelItems({ model, disabled }: { model: SettingGroup; disabled: boolean }) {
  const t = useTranslate()
  const options = model.options.map((option) => ({ ...option, label: option.short ?? option.label }))
  const shown = options.length <= SHORTLIST_ABOVE ? options : shortlistOf(options, model.value)
  const rest = options.filter((option) => !shown.includes(option))
  const items = (list: typeof options) => (
    <MenuRadioGroup value={model.value} onValueChange={model.onChange}>
      {list.map((option) => (
        <MenuRadioItem key={option.value} value={option.value} tone={option.tone}
          disabled={disabled || option.disabled}>
          {option.label}
        </MenuRadioItem>
      ))}
    </MenuRadioGroup>
  )
  return (
    <>
      {model.notice ? <p className="px-2.5 py-1.5 text-xs text-caution">{model.notice}</p> : null}
      {items(shown)}
      {rest.length > 0 ? (
        <MenuSub label={t('composer.settings.more')} value={String(options.length)}>
          {items(options)}
        </MenuSub>
      ) : null}
    </>
  )
}

/** Le mode rapide, en interrupteur : il va avec le modèle, pas avec les réglages. */
function SpeedItem({ group, disabled }: { group: SettingGroup; disabled: boolean }) {
  const toggle = group.toggle
  if (!toggle) return null
  const on = group.options.find((option) => option.value === toggle.on)
  return (
    <MenuCheckboxItem
      appearance="switch"
      checked={group.value === toggle.on}
      disabled={disabled}
      onCheckedChange={(checked) => {
        const next = checked ? toggle.on : group.options.find((option) => option.value !== toggle.on)?.value
        if (next) group.onChange(next)
      }}
    >
      <span className="flex flex-col">
        <span>{toggle.label ?? group.label}</span>
        {on?.hint ? <span className="text-meta text-ink-faint">{on.hint}</span> : null}
      </span>
    </MenuCheckboxItem>
  )
}

/**
 * Les modèles montrés d'emblée quand le catalogue est long : les premiers du
 * catalogue, et celui qui est en vigueur s'il n'en fait pas partie.
 */
function shortlistOf<T extends { value: string }>(options: T[], value: string): T[] {
  const head = options.slice(0, SHORTLIST)
  if (head.some((option) => option.value === value)) return head
  return [...options.filter((option) => option.value === value), ...head.slice(0, SHORTLIST - 1)]
}

/**
 * Le panneau de la puce, au doigt : les modèles courants, l'effort, le mode rapide.
 *
 * Le rail d'effort y reste déplié plutôt que rangé dans une vue : trois cases se
 * touchent d'un geste, et c'est le réglage qu'on change le plus souvent après le
 * modèle lui-même.
 */
function ModelMenu({ agent, model, effort, speed, disabled, close }: {
  agent: AgentKind
  model: SettingGroup
  effort?: SettingGroup
  speed?: SettingGroup
  disabled: boolean
  close: (resumeTyping?: boolean) => void
}) {
  const t = useTranslate()
  const [all, setAll] = useState(false)
  const options = model.options.map((option) => ({
    ...option,
    label: option.short ?? option.label,
    icon: <AgentIcon agent={agent} size={14} decorative />,
  }))
  const shortlist = shortlistOf(options, model.value)
  const shown = all || options.length <= SHORTLIST_ABOVE ? options : shortlist
  // Choisir un modèle referme : c'est la décision principale, et les niveaux d'effort
  // proposés en dessous ne sont plus les mêmes après. L'effort et la vitesse, eux,
  // s'appliquent sans fermer.
  const pick = (picked: string) => { model.onChange(picked); close(true) }

  return (
    <>
      {/* Pas d'en-tête sur la première vue : le menu tient en un écran, le titre de
          section suffit à le nommer, et la surface se ferme au-dehors comme par Échap.
          Le catalogue entier, lui, est une vue où l'on entre : elle porte son retour. */}
      {all ? (
        <SettingsHeading title={model.label} onBack={() => setAll(false)} onClose={() => close()} />
      ) : null}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2 pb-[max(0.5rem,var(--sg-safe-bottom))]">
        {all ? null : <MenuLabel>{model.label}</MenuLabel>}
        {model.notice ? <p className="mb-2 px-1 text-xs text-caution">{model.notice}</p> : null}
        <SettingOptions group={{ ...model, options: shown }} disabled={disabled} onPick={pick} />
        {shown.length < options.length ? (
          <Entry submenu hint={t('composer.settings.moreHint')} onClick={() => setAll(true)}>
            {t('composer.settings.more')}
          </Entry>
        ) : null}
        {all ? null : (
          <>
            {effort ? (
              <section className="mt-2 border-t border-line pt-2">
                <MenuLabel>{effort.label}</MenuLabel>
                {effort.notice ? <p className="mb-2 px-2.5 text-xs text-caution">{effort.notice}</p> : null}
                {/* Le niveau retenu s'explique pour qui l'écoute, mais le rail se lit
                    seul : la phrase sous les trois cases allongeait le menu d'autant. */}
                <SettingOptions group={effort} disabled={disabled} compact quietHint onPick={effort.onChange} />
              </section>
            ) : null}
            {speed?.toggle ? (
              <>
                <div className="my-2 h-px bg-line" />
                <SwitchRow
                  icon={speed.icon}
                  checked={speed.value === speed.toggle.on}
                  disabled={disabled}
                  onCheckedChange={(checked) => {
                    const toggle = speed.toggle
                    if (!toggle) return
                    const next = checked ? toggle.on : speed.options.find((option) => option.value !== toggle.on)?.value
                    if (next) speed.onChange(next)
                  }}
                  label={speed.toggle.label ?? speed.label}
                  description={speed.options.find((option) => option.value === speed.toggle?.on)?.hint}
                />
              </>
            ) : null}
          </>
        )}
      </div>
    </>
  )
}
