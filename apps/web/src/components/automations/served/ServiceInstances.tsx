import { ArrowUpRight, ExternalLink } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Badge, cx } from '@solera/ui'
import { useTranslate } from '../../../lib/i18n'
import type { ServedInstance, TreeRef } from '../../../lib/served'
import { ServedLine } from './ServedLine'
import { travailTreePath } from './ServedBlock'

/** Ce qu'il faut d'un arbre pour le nommer. */
type NamedTree = TreeRef & { name: string }

/**
 * Les instances d'un service « une par worktree » (SRV-6, AC-06), dans son détail : pour
 * chacune, l'arbre qu'elle sert (lien vers Travail), sa version, son port et son lien.
 * Une instance en échec dit de quel dossier elle venait. Rien ne s'y bascule : chaque
 * arbre a la sienne, qu'on démarre d'un clic depuis lui.
 */
export function ServiceInstances<T extends NamedTree>({
  projectId,
  instances,
  className,
}: {
  projectId: string
  instances: ServedInstance<T>[]
  className?: string
}) {
  const t = useTranslate()
  if (instances.length === 0) return <p className={cx('text-xs text-ink-faint', className)}>{t('served.instances.empty')}</p>
  return (
    <ul className={cx('flex flex-col divide-y divide-line', className)} aria-label={t('served.instances.label')}>
      {instances.map((instance) => {
        const served = instance.served
        const tree = served?.tree ?? null
        const port = served?.ports[0] ?? null
        return (
          <li key={instance.unit} className="flex min-w-0 flex-col gap-0.5 py-2 first:pt-0 last:pb-0">
            <div className="flex min-w-0 items-center gap-2 text-sm">
              <span
                aria-hidden
                className={cx(
                  'size-1.5 shrink-0 rounded-full',
                  instance.running ? 'bg-positive' : instance.failed ? 'bg-critical' : 'bg-ink-faint',
                )}
              />
              {tree ? (
                <Link
                  to={travailTreePath(projectId, tree.key)}
                  title={t('served.block.openTree', { tree: tree.root ? t('served.block.root') : tree.name })}
                  className="inline-flex min-w-0 items-center gap-1 text-ink hover:underline"
                >
                  <span className="truncate">{tree.root ? t('served.block.root') : tree.name}</span>
                  <ArrowUpRight size={12} className="shrink-0" aria-hidden />
                </Link>
              ) : (
                <code className="min-w-0 truncate font-mono text-xs text-ink-soft" title={instance.cwd ?? undefined}>
                  {instance.cwd ?? t('served.block.unrecognized')}
                </code>
              )}
              {instance.failed ? <Badge tone="critical">{t('served.instances.failed')}</Badge> : null}
              {!instance.running && !instance.failed ? <Badge>{t('served.instances.stopped')}</Badge> : null}
              {served?.href ? (
                <a
                  href={served.href}
                  target="_blank"
                  rel="noreferrer"
                  className="ml-auto inline-flex shrink-0 items-center gap-1 font-mono text-xs text-accent hover:underline"
                >
                  {port !== null ? `:${port}` : t('served.instances.open')}
                  <ExternalLink size={12} aria-hidden />
                </a>
              ) : port !== null ? (
                <code className="ml-auto shrink-0 font-mono text-xs text-ink-faint">:{port}</code>
              ) : null}
            </div>
            {served ? <ServedLine served={served} className="max-w-full pl-3.5" /> : null}
          </li>
        )
      })}
    </ul>
  )
}
