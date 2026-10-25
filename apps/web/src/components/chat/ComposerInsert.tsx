import { MenuItem } from '@solera/ui'
import type { AgentKind } from '@solera/protocol'
import { useTranslate } from '../../lib/i18n'
import { Entry } from './ComposerPlusMenu'

/** Les préfixes qu'on tape dans le champ pour ouvrir une liste de suggestions. */
export type InsertPrefix = '@' | '@@' | '#' | '/' | '$'

export interface InsertEntry {
  prefix: InsertPrefix
  label: string
  hint: string
}

/**
 * Ce que le champ sait compléter, et le préfixe qui l'ouvre.
 *
 * Rien de neuf : les mêmes listes que la frappe ouvre. Le menu « Insérer » ne sert qu'à
 * apprendre qu'elles existent, et choisir une ligne écrit son préfixe au curseur, comme
 * si on l'avait tapé. N'est proposé que ce qui ouvrirait une liste : pas de fichier ni
 * de carte hors projet, pas de commande tant que le CLI n'en a publié aucune.
 */
export function useInsertEntries({ project, commands, skills, agent }: {
  project: boolean
  commands: boolean
  skills: boolean
  agent: AgentKind
}): InsertEntry[] {
  const t = useTranslate()
  // Claude et Grok rangent leurs skills parmi leurs commandes : un seul `/` pour les deux.
  const combined = agent === 'claude' || agent === 'grok'
  return [
    ...(project
      ? [
          { prefix: '@' as const, label: t('composer.insert.file'), hint: t('composer.insert.fileHint') },
          { prefix: '@@' as const, label: t('composer.insert.session'), hint: t('composer.insert.sessionHint') },
          { prefix: '#' as const, label: t('composer.insert.card'), hint: t('composer.insert.cardHint') },
        ]
      : []),
    ...(commands
      ? [{
          prefix: '/' as const,
          label: t(combined ? 'composer.insert.commandOrSkill' : 'composer.insert.command'),
          hint: t('composer.insert.commandHint'),
        }]
      : []),
    ...(skills ? [{ prefix: '$' as const, label: t('composer.insert.skill'), hint: t('composer.insert.skillHint') }] : []),
  ]
}

/** Au pointeur : le préfixe à droite, à la place d'un raccourci, puisque c'en est un. */
export function InsertMenuItems({ entries, onPick }: { entries: InsertEntry[]; onPick: (prefix: InsertPrefix) => void }) {
  return entries.map(({ prefix, label }) => (
    <MenuItem key={prefix} shortcut={prefix} onSelect={() => onPick(prefix)}>
      {label}
    </MenuItem>
  ))
}

/** Au doigt : la même liste, chaque ligne avec ce qu'elle cherche. */
export function InsertList({ entries, onPick }: { entries: InsertEntry[]; onPick: (prefix: InsertPrefix) => void }) {
  const t = useTranslate()
  return (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1 pb-[max(0.25rem,var(--sg-safe-bottom))]">
      <p className="px-2.5 pt-1 pb-2 text-xs leading-relaxed text-ink-faint">{t('composer.insert.intro')}</p>
      {entries.map(({ prefix, label, hint }) => (
        <Entry key={prefix} value={prefix} hint={hint} onClick={() => onPick(prefix)}>
          {label}
        </Entry>
      ))}
    </div>
  )
}

/**
 * Écrit un préfixe au curseur, et rend le texte et la position qui en résultent.
 *
 * Une commande occupe le message entier et ne se reconnaît qu'en tête : son `/` va au
 * début, et ce qui était écrit devient son argument. Les autres remplacent la sélection,
 * précédés d'une espace quand ils colleraient au mot d'avant — sans elle, la liste ne
 * s'ouvrirait pas.
 */
export function withPrefix(
  text: string,
  selection: { start: number; end: number },
  prefix: InsertPrefix,
): { text: string; caret: number } {
  if (prefix === '/') return { text: `/${text.replace(/^\s+/, '')}`, caret: 1 }
  const before = text.slice(0, selection.start)
  const inserted = `${before && !/\s$/.test(before) ? ' ' : ''}${prefix}`
  return { text: before + inserted + text.slice(selection.end), caret: selection.start + inserted.length }
}
