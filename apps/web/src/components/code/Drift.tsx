import type { ReactNode } from 'react'
import { BEHIND_ALERT, pluralOf } from '../../lib/code-model'
import { useTranslate } from '../../lib/i18n'

/**
 * Où en est une branche face à la base : ↑ commits d'avance, ↓ de retard (ambre au-delà
 * de 2), ● fichiers non commités, et le conflit. « à jour » quand il n'y a rien. Chaque
 * signe porte sa phrase pour un lecteur d'écran : l'infobulle n'existe pas au doigt.
 */
export function Drift({ ahead, behind, dirty, conflicts }: { ahead: number; behind: number; dirty: number; conflicts: boolean }) {
  const t = useTranslate()
  const sign = (key: string, glyph: string, count: number, label: string, className?: string) => (
    <span key={key} title={label} className={className}>
      <span aria-hidden>
        {glyph}
        {count}
      </span>
      <span className="sr-only">{label}</span>
    </span>
  )
  const parts: ReactNode[] = []
  if (ahead) parts.push(sign('a', '↑', ahead, t(`code.drift.ahead.${pluralOf(ahead)}`, { count: ahead })))
  if (behind) {
    const alert = behind > BEHIND_ALERT.line ? 'text-caution' : undefined
    parts.push(sign('b', '↓', behind, t(`code.drift.behind.${pluralOf(behind)}`, { count: behind }), alert))
  }
  if (dirty) parts.push(sign('d', '●', dirty, t(`code.drift.dirty.${pluralOf(dirty)}`, { count: dirty })))
  if (conflicts) parts.push(<span key="c" className="text-critical">{t('code.drift.conflict')}</span>)
  if (parts.length === 0) return <span className="text-ink-faint">{t('code.drift.upToDate')}</span>
  return <span className="inline-flex gap-2 tabular-nums">{parts}</span>
}
