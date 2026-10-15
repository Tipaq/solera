import { GitBranch, Loader } from 'lucide-react'
import { useMemo } from 'react'
import { parseUnifiedDiff } from '../../../lib/diff'
import { useTranslate } from '../../../lib/i18n'
import { Banner } from '@solera/ui'
import { FileDiff, SectionTitle } from '../diff-parts'
import type { useWorkingDiff } from './queries'

/**
 * La destination *En cours* : ce qui n'est pas commité.
 *
 * En lecture seule, comme tout le lot 1. La planche T2 veut ici deux sections —
 * non indexés et indexés — un résumé, une description et le co-auteur ; tout cela
 * demande des routes d'écriture, et c'est le lot 2. En attendant, la vue garde ce que
 * l'onglet Git montrait déjà : les fichiers et leur diff.
 *
 * C'est aussi ce qu'on voit en sélectionnant le nœud « en cours » du graphe : le même
 * objet, donc la même vue, et pas deux écrans qui diraient la même chose autrement.
 */
export function WorkingView({
  query,
  onOpenFile,
}: {
  query: ReturnType<typeof useWorkingDiff>
  onOpenFile: (path: string) => void
}) {
  const t = useTranslate()
  const { data, error, isPending } = query
  const files = useMemo(() => (data ? parseUnifiedDiff(data.patch) : []), [data])

  // Sommés depuis le décompte du serveur plutôt que depuis le patch analysé : celui-ci
  // est tronqué au-delà d'une certaine taille, et le total mentirait alors.
  const added = (data?.files ?? []).reduce((sum, file) => sum + file.added, 0)
  const removed = (data?.files ?? []).reduce((sum, file) => sum + file.removed, 0)

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto pb-safe">
      <SectionTitle>{t('changes.diff.current')}</SectionTitle>

      {data?.branch ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line/60 px-2.5 py-1.5 text-meta text-ink-faint">
          <span className="flex items-center gap-1 text-ink-soft">
            <GitBranch size={11} className="shrink-0" />
            {data.branch}
          </span>

          {data.files && data.files.length > 0 ? (
            <span className="flex items-center gap-1.5">
              <span>
                {data.files.length > 1
                  ? t('changes.files.countMany', { count: data.files.length })
                  : t('changes.files.countOne', { count: data.files.length })}
              </span>
              {added > 0 ? <span className="font-mono text-positive">+{added}</span> : null}
              {removed > 0 ? <span className="font-mono text-critical">-{removed}</span> : null}
            </span>
          ) : null}
        </div>
      ) : null}

      {isPending ? (
        <p className="flex items-center gap-1.5 px-2.5 py-2 text-xs text-ink-faint">
          <Loader size={11} className="animate-spin" />
          {t('changes.diff.loading')}
        </p>
      ) : null}

      {error ? (
        <div className="p-2">
          <Banner>{error instanceof Error ? error.message : t('changes.diff.error')}</Banner>
        </div>
      ) : null}

      {data && data.files === null ? (
        <p className="px-2.5 py-2 text-xs text-ink-faint">{t('changes.diff.notGitRepo')}</p>
      ) : null}

      {data?.files?.length === 0 ? (
        <p className="px-2.5 py-2 text-xs text-ink-faint">{t('changes.diff.none')}</p>
      ) : null}

      {files.map((file) => (
        <FileDiff key={file.path} file={file} onOpenFile={onOpenFile} />
      ))}

      {data?.truncated ? (
        <p className="px-2.5 py-2 text-meta text-caution">{t('changes.diff.truncated')}</p>
      ) : null}
    </div>
  )
}
