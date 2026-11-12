import { Zap } from 'lucide-react'
import { Link } from 'react-router-dom'
import { cx } from '@solera/ui'
import { useTranslate } from '../../lib/i18n'
import { actionsTabPath } from '../../lib/overview-actions'
import type { ServedMark } from '../../lib/served'

/**
 * « ⚡ :5173 » : un service en marche sert cet arbre, fichiers non commités compris. Un
 * lien vers son détail, dans l'onglet Actions.
 */
export function ServiceMark({ projectId, marks, className }: { projectId: string; marks: ServedMark[] | undefined; className?: string }) {
  const t = useTranslate()
  if (!marks?.length) return null
  return (
    <>
      {marks.map((mark) => (
        <Link
          key={mark.automationId}
          to={actionsTabPath(projectId, mark.automationId)}
          onClick={(event) => event.stopPropagation()}
          title={mark.port === null ? t('code.served.title', { label: mark.label }) : t('code.served.titlePort', { label: mark.label, port: mark.port })}
          className={cx(
            'relative z-[1] inline-flex shrink-0 items-center gap-0.5 rounded-md border border-positive/40 px-1.5 py-px text-micro text-positive tabular-nums transition-colors hover:bg-positive/10',
            className,
          )}
        >
          <Zap size={10} aria-hidden /> {mark.port === null ? mark.label : `:${mark.port}`}
        </Link>
      ))}
    </>
  )
}
