import type { ReactNode } from 'react'
import { useTranslate } from '../../lib/i18n'

/**
 * Où en est une branche face à la base : ↑ commits d'avance, ↓ de retard (ambre au-delà
 * de 2), ● fichiers non commités, et le conflit. « à jour » quand il n'y a rien.
 */
export function Drift({ ahead, behind, dirty, conflicts }: { ahead: number; behind: number; dirty: number; conflicts: boolean }) {
  const t = useTranslate()
  const many = (count: number) => (count === 1 ? 'one' : 'other')
  const parts: ReactNode[] = []
  if (ahead) parts.push(<span key="a" title={t(`code.drift.ahead.${many(ahead)}`, { count: ahead })}>↑{ahead}</span>)
  if (behind) {
    parts.push(
      <span key="b" title={t(`code.drift.behind.${many(behind)}`, { count: behind })} className={behind > 2 ? 'text-caution' : undefined}>
        ↓{behind}
      </span>,
    )
  }
  if (dirty) parts.push(<span key="d" title={t(`code.drift.dirty.${many(dirty)}`, { count: dirty })}>●{dirty}</span>)
  if (conflicts) parts.push(<span key="c" className="text-critical">{t('code.drift.conflict')}</span>)
  if (parts.length === 0) return <span className="text-ink-faint">{t('code.drift.upToDate')}</span>
  return <span className="inline-flex gap-2 tabular-nums">{parts}</span>
}
