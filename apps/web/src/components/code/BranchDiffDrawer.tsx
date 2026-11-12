import { GitBranch, Loader } from 'lucide-react'
import { useMemo } from 'react'
import type { CompareDto } from '@solera/protocol'
import { Banner } from '@solera/ui'
import { pluralOf } from '../../lib/code-model'
import { parseUnifiedDiff } from '../../lib/diff'
import { useTranslate } from '../../lib/i18n'
import { useCompare } from '../../lib/worktrees'
import { FileDiff, SectionTitle } from '../panel/diff-parts'
import { Drawer } from '../shell/Drawer'
import { Drift } from './Drift'

/**
 * Le tiroir « Diff avec la base » d'une branche sans arbre (T-13.2, carte #169) : ce
 * qu'elle apporte depuis qu'elle a quitté la base, comme une PR le montrerait. Le corps
 * est celui du détail d'un commit (`CommitDetail`) : la liste des fichiers, dépliables
 * sur leur patch.
 *
 * Lu seulement tant qu'il est ouvert : une branche se compare à la demande.
 */
export function BranchDiffDrawer({
  projectId,
  base,
  branch,
  open,
  onClose,
}: {
  projectId: string
  /** La base du projet ; null hors dépôt, le tiroir n'a alors rien à lire. */
  base: string | null
  branch: string
  open: boolean
  onClose: () => void
}) {
  const t = useTranslate()
  const { data, error, isPending } = useCompare(open ? projectId : undefined, base, branch)
  return (
    <Drawer
      open={open}
      onClose={onClose}
      label={t('code.compare.label', { branch })}
      title={t('code.compare.title')}
      subtitle={
        <>
          <span className="flex min-w-0 items-center gap-1 font-mono">
            <GitBranch size={12} className="shrink-0" />
            <span className="truncate">{branch}</span>
          </span>
          {base ? <span>{t('code.compare.against', { base })}</span> : null}
          {data ? <Drift ahead={data.ahead} behind={data.behind} dirty={0} conflicts={false} /> : null}
        </>
      }
    >
      <BranchDiffBody data={data} base={base} pending={isPending} error={error} />
    </Drawer>
  )
}

/** Le corps du tiroir : chargement, erreur, ou les fichiers et leur patch. */
function BranchDiffBody({
  data,
  base,
  pending,
  error,
}: {
  data: CompareDto | undefined
  base: string | null
  pending: boolean
  error: unknown
}) {
  const t = useTranslate()
  const files = useMemo(() => (data ? parseUnifiedDiff(data.patch) : []), [data])
  const added = (data?.files ?? []).reduce((sum, file) => sum + file.added, 0)
  const removed = (data?.files ?? []).reduce((sum, file) => sum + file.removed, 0)

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto pb-safe">
      {pending && !error ? (
        <p className="flex items-center gap-1.5 px-5 py-3 text-xs text-ink-faint">
          <Loader size={11} className="animate-spin" />
          {t('code.compare.loading')}
        </p>
      ) : null}

      {error ? (
        <div className="p-3">
          <Banner>{error instanceof Error ? error.message : t('code.compare.error')}</Banner>
        </div>
      ) : null}

      {data && data.files.length === 0 ? (
        <p className="px-5 py-3 text-sm text-ink-soft">{t('code.compare.empty', { base: base ?? '' })}</p>
      ) : null}

      {data && data.files.length > 0 ? (
        <SectionTitle>
          {t(`code.compare.files.${pluralOf(data.files.length)}`, { count: data.files.length, added, removed })}
        </SectionTitle>
      ) : null}

      {/* Sans `onOpenFile` : le fichier du disque n'est pas celui de la branche. */}
      {files.map((file) => (
        <FileDiff key={file.path} file={file} />
      ))}

      {data?.truncated ? <p className="px-2.5 py-2 text-meta text-caution">{t('changes.diff.truncated')}</p> : null}
    </div>
  )
}
