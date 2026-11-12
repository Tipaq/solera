import { ArrowDown, GitBranch } from 'lucide-react'
import { cx } from '@solera/ui'
import { useTranslate } from '../../../lib/i18n'
import { servedName, shortBranch, type ServedVersion } from '../../../lib/served'

/**
 * « ⎇ sert `feat/905-…` @ a1b2c3d · ↓3 · ●2 » (SRV-1) : ce qu'un service en marche sert,
 * sur une ligne de tuile, de liste ou de panneau. Le dossier exact est dans l'infobulle.
 */
export function ServedLine({
  served,
  className,
}: {
  served: Pick<ServedVersion, 'root' | 'branch' | 'commit' | 'behind' | 'uncommitted' | 'cwd'>
  className?: string
}) {
  const t = useTranslate()
  const behind = served.behind ?? 0
  const uncommitted = served.uncommitted ?? 0
  return (
    <span className={cx('inline-flex min-w-0 items-center gap-1.5 text-xs text-ink-faint', className)} title={served.cwd ?? undefined}>
      <GitBranch size={11} className="shrink-0" aria-hidden />
      <span className="shrink-0">{t('served.serves')}</span>
      <code className="min-w-0 truncate font-mono text-meta text-ink-soft">{shortBranch(servedName(t, served))}</code>
      {served.commit ? <code className="shrink-0 font-mono text-meta">@ {served.commit}</code> : null}
      {behind > 0 ? (
        <span
          className="inline-flex shrink-0 items-center tabular-nums"
          title={t(behind > 1 ? 'served.behind.other' : 'served.behind.one', { count: behind })}
        >
          <ArrowDown size={10} aria-hidden />
          {behind}
        </span>
      ) : null}
      {uncommitted > 0 ? (
        <span className="shrink-0 tabular-nums text-caution" title={t('served.uncommittedTitle')}>
          ●{uncommitted}
        </span>
      ) : null}
    </span>
  )
}
