import { ArrowDown, ArrowUp, ArrowUpRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Button, cx } from '@solera/ui'
import { useTranslate } from '../../../lib/i18n'
import type { ServedTree, ServedVersion } from '../../../lib/served'
import { ServeIcon, ServeMenu } from './ServeMenu'

/** Ce que le bloc montre d'un arbre : de quoi le nommer, et sa carte. */
export interface ServedBlockTree extends ServedTree {
  card: { number: number; title: string; milestone: { number: number } | null } | null
}

/** L'arbre dans Travail, choisi dans l'index (`?arbre=`). */
export const travailTreePath = (projectId: string, key: string) => `/p/${projectId}/travail?arbre=${encodeURIComponent(key)}`

/**
 * « Ce qu'il sert » (SRV-3), dans le détail d'un service en marche : l'arbre (lien vers
 * Travail) et son dossier, la branche, le commit, la position sur la base, les fichiers
 * non commités servis tels quels, la carte ; puis « Servir une autre branche… ».
 *
 * Un service fixé à la racine ou sur une branche ne se bascule pas : le bloc dit pourquoi
 * à la place du geste.
 */
export function ServedBlock<T extends ServedBlockTree>({
  projectId,
  served,
  base,
  pinnedBranch = null,
  targets,
  onSwitch,
}: {
  projectId: string
  served: ServedVersion<T>
  base: string | null
  /** La branche d'un placement `branch`, pour dire ce qui le fixe. */
  pinnedBranch?: string | null
  /** `switchTargets` ; vide, le geste ne se pose pas. */
  targets: T[]
  onSwitch: (tree: T) => void
}) {
  const t = useTranslate()
  const { tree } = served
  const uncommitted = served.uncommitted
  const term = 'text-ink-faint'
  return (
    <div className="flex flex-col gap-2.5">
      <dl className="grid grid-cols-[7rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-sm">
        <dt className={term}>{t('served.block.tree')}</dt>
        <dd className="min-w-0">
          {tree ? (
            <Link
              to={travailTreePath(projectId, tree.key)}
              title={t('served.block.openTree', { tree: tree.root ? t('served.block.root') : tree.name })}
              className="inline-flex max-w-full items-center gap-1 text-ink hover:underline"
            >
              <span className="truncate">{tree.root ? t('served.block.root') : tree.name}</span>
              <ArrowUpRight size={12} className="shrink-0" aria-hidden />
            </Link>
          ) : (
            <span className={term}>{t('served.block.unrecognized')}</span>
          )}
          {served.cwd ? (
            <code className="block truncate font-mono text-meta text-ink-faint" title={served.cwd}>
              {served.cwd}
            </code>
          ) : null}
        </dd>

        <dt className={term}>{t('served.block.branch')}</dt>
        <dd className="min-w-0 truncate font-mono text-xs text-ink">{served.branch ?? '—'}</dd>

        <dt className={term}>{t('served.block.commit')}</dt>
        <dd>
          {served.commit ? (
            <code className="font-mono text-xs text-ink">{served.commit}</code>
          ) : (
            <span className="text-xs text-ink-faint">{t('served.block.commitUnknown')}</span>
          )}
        </dd>

        <dt className={cx(term, 'truncate')}>{base ? t('served.block.onBase', { base }) : t('served.block.onBaseUnknown')}</dt>
        <dd className="inline-flex flex-wrap items-center gap-x-3 text-xs tabular-nums text-ink-soft">
          {served.ahead === null && served.behind === null ? (
            <span className="text-ink-faint">{t('served.block.unmeasured')}</span>
          ) : (
            <>
              <span className="inline-flex items-center">
                <ArrowUp size={11} aria-hidden />
                {t('served.block.ahead', { count: served.ahead ?? 0 })}
              </span>
              <span className="inline-flex items-center">
                <ArrowDown size={11} aria-hidden />
                {t('served.block.behind', { count: served.behind ?? 0 })}
              </span>
            </>
          )}
        </dd>

        <dt className={term}>{t('served.block.uncommitted')}</dt>
        <dd className={cx('text-xs', uncommitted ? 'text-caution' : 'text-ink-faint')}>
          {uncommitted === null
            ? t('served.block.unmeasured')
            : uncommitted > 0
              ? t(uncommitted > 1 ? 'served.block.uncommitted.other' : 'served.block.uncommitted.one', { count: uncommitted })
              : t('served.block.uncommittedNone')}
        </dd>

        {tree?.card ? (
          <>
            <dt className={term}>{t('served.block.card')}</dt>
            <dd className="min-w-0 truncate text-xs text-ink-soft">
              #{tree.card.number} {tree.card.title}
              {tree.card.milestone ? (
                <span className="text-ink-faint"> · {t('served.block.milestone', { number: tree.card.milestone.number })}</span>
              ) : null}
            </dd>
          </>
        ) : null}
      </dl>

      {served.switchable ? (
        <ServeMenu
          targets={targets}
          onSwitch={onSwitch}
          trigger={
            <Button type="button" size="sm" variant="secondary" icon={<ServeIcon />} className="w-fit">
              {t('served.block.switch')}
            </Button>
          }
        />
      ) : (
        <p className="text-xs text-ink-faint">
          {pinnedBranch ? t('served.block.pinnedBranch', { branch: pinnedBranch }) : t('served.block.pinnedRoot')}
        </p>
      )}
    </div>
  )
}
