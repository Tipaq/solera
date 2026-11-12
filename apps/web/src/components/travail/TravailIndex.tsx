import { Cloud, GitBranch, Layers } from 'lucide-react'
import { cx } from '@solera/ui'
import { formatBytes, shortBranch, type BranchInfo, type TreeRow } from '../../lib/code-model'
import { shortAge } from '../../lib/dates'
import { locale, useTranslate } from '../../lib/i18n'
import { MilestoneChip } from '../code/MilestoneChip'
import { BranchDot, VerdictDot, verdictReason } from '../code/VerdictDot'

/** La teinte de la raison d'un arbre : rouge quand le nettoyer perdrait du travail. */
const REASON_TONE: Partial<Record<TreeRow['verdict'], string>> = {
  waiting: 'text-caution',
  'merged-dirty': 'text-critical',
  missing: 'text-critical',
  clean: 'text-positive',
}

const ITEM = 'flex w-full min-w-0 items-start gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-accent'

/**
 * L'index des arbres de Travail (`projet.md` T-3), en colonne à gauche : « Tous », un
 * arbre par ligne (son point de verdict, son nom, sa raison, sa taille), puis les
 * branches sans arbre.
 *
 * Deux usages, un seul dessin : en mode `filter` (« Par moment »), un clic restreint le
 * fil à l'élément, surligné tant qu'il est choisi ; en mode `scroll` (« Par arbre »), il
 * fait défiler jusqu'à son couloir, et la ligne « Projet » mène à ce qui ne vit dans
 * aucun arbre.
 */
export function TravailIndex({
  trees,
  branches,
  current,
  onChoose,
  mode,
  project = false,
}: {
  trees: TreeRow[]
  branches: BranchInfo[]
  /** La clé choisie (filtre) ou surlignée (défilement) ; null : « Tous ». */
  current: string | null
  onChoose: (key: string | null) => void
  mode: 'filter' | 'scroll'
  /** La ligne « Projet », en mode défilement seulement. */
  project?: boolean
}) {
  const t = useTranslate()
  const state = (key: string | null) => (current === key ? 'bg-surface-high' : 'hover:bg-surface-high/60')
  const filtering = mode === 'filter'
  return (
    <nav aria-label={t('travail.index.label')}>
      <ul className="flex flex-col gap-0.5 px-4 pt-2.5 pb-2">
        <li>
          <button type="button" onClick={() => onChoose(null)} aria-current={filtering && current === null ? 'true' : undefined} className={cx(ITEM, filtering ? state(null) : 'hover:bg-surface-high/60')}>
            <span aria-hidden className="mt-1.5 size-2 shrink-0 rounded-full border border-ink-faint" />
            <span className="min-w-0 flex-1 text-sm font-medium">{t('travail.index.all')}</span>
            <span className="text-xs text-ink-faint">{t(filtering ? 'travail.index.wholeThread' : 'travail.index.top')}</span>
          </button>
        </li>
        {trees.map((tree) => {
          const name = tree.branch ?? tree.name
          return (
            <li key={tree.key}>
              <button type="button" onClick={() => onChoose(tree.key)} aria-current={current === tree.key ? 'true' : undefined} className={cx(ITEM, state(tree.key))} title={name}>
                <VerdictDot verdict={tree.verdict} className="mt-1.5" />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className={cx('min-w-0 truncate font-mono text-sm', tree.root && 'font-semibold')}>{tree.root ? name : shortBranch(name)}</span>
                  <span className={cx('min-w-0 truncate text-xs', REASON_TONE[tree.verdict] ?? 'text-ink-faint')}>{verdictReason(t, tree.reason)}</span>
                </span>
                {tree.sizeBytes !== null ? <span className="shrink-0 text-xs tabular-nums text-ink-faint">{formatBytes(tree.sizeBytes, locale())}</span> : null}
              </button>
            </li>
          )
        })}
        {branches.length > 0 ? (
          <li className="mt-2 flex items-center gap-1.5 border-t border-line px-2 pt-3 pb-1 text-meta font-medium tracking-wide text-ink-faint uppercase">
            <GitBranch size={11} aria-hidden /> {t('travail.index.branches')}
          </li>
        ) : null}
        {branches.map((branch) => (
          <li key={branch.key}>
            <IndexBranch branch={branch} className={cx(ITEM, state(branch.key))} current={current === branch.key} onClick={() => onChoose(branch.key)} />
          </li>
        ))}
        {project && !filtering ? (
          <li className="mt-2 border-t border-line pt-2">
            <button type="button" onClick={() => onChoose('projet')} className={cx(ITEM, state('projet'))}>
              <Layers size={13} aria-hidden className="mt-0.5 shrink-0 text-ink-faint" />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-sm font-medium">{t('travail.index.project')}</span>
                <span className="text-xs text-ink-faint">{t('travail.index.projectHint')}</span>
              </span>
            </button>
          </li>
        ) : null}
      </ul>
    </nav>
  )
}

/** Une branche sans arbre dans l'index : son genre, sa PR, sa carte, son dernier commit. */
function IndexBranch({ branch, className, current, onClick }: { branch: BranchInfo; className: string; current: boolean; onClick: () => void }) {
  const t = useTranslate()
  return (
    <button type="button" onClick={onClick} aria-current={current ? 'true' : undefined} className={className} title={branch.name}>
      <BranchDot kind={branch.kind} className="mt-1.5" />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 items-center gap-1.5">
          {branch.remoteOnly ? <Cloud size={12} aria-hidden className="shrink-0 text-ink-faint" /> : <GitBranch size={12} aria-hidden className="shrink-0 text-ink-faint" />}
          <span className="min-w-0 truncate font-mono text-sm">{branch.name}</span>
        </span>
        <span className="min-w-0 truncate text-xs text-ink-soft">
          {branch.pr && branch.kind === 'pr' ? t('travail.index.pr', { number: branch.pr.number, state: t(`code.pr.${branch.pr.state}`) }) : t(`code.branchKind.${branch.kind}`)}
        </span>
        {branch.card ? (
          <span className="flex min-w-0 items-center gap-1.5 text-micro text-ink-faint">
            <span className="min-w-0 truncate">
              #{branch.card.number} {branch.card.title}
            </span>
            {branch.card.milestone ? <MilestoneChip milestone={branch.card.milestone} /> : null}
          </span>
        ) : null}
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1 text-xs tabular-nums text-ink-faint">
        {branch.lastCommitAt !== null ? <span>{shortAge(branch.lastCommitAt)}</span> : null}
        {branch.merged || branch.ahead === null ? null : (
          <span>
            ↑{branch.ahead} ↓{branch.behind ?? 0}
          </span>
        )}
      </span>
    </button>
  )
}
