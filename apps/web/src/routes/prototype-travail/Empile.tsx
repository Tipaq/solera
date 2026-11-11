/* PROTOTYPE — jetable (branche proto/page-projet). Ne pas fusionner dans main. */
import { ChevronRight, Filter, GitBranch } from 'lucide-react'
import { useState } from 'react'
import type { ProjectDto } from '@solera/protocol'
import { cx } from '@solera/ui'
import { AskInbox } from '../../components/prototype/AskInbox'
import { FilBody } from '../prototype-activity/FilActivity'
import { Branches, VERDICT_TONE } from '../prototype-code/ProjectCodePage'
import type { TreeRow } from '../prototype-code/data'
import {
  SessionDots,
  TreeActionButtons,
  TreeChip,
  TreeDetail,
  TreeFacts,
  TreeFilterPill,
  TreeSummary,
  useScopedModel,
  useTravail,
  useTreeSelection,
  type Travail,
} from './shared'

/** Arbres montrés d'emblée : ceux qui demandent un geste ou travaillent. */
const SHOWN = 5

/** Ce qui mérite une ligne d'emblée : un geste à faire, ou du travail qui tourne. */
const URGENT = new Set(['waiting', 'active', 'review', 'merged-dirty'])

/**
 * `empile` — une seule page qui défile, sans bascule : **Ce qui t'attend**, puis les
 * **Arbres** en version courte (ceux qui demandent un geste ou travaillent, dépliables),
 * puis **le fil**. Chaque ligne du fil porte la puce de son arbre ; cliquer une puce, ou
 * « Filtrer » sur un arbre, restreint le fil en place, avec une pastille pour revenir.
 */
export function Empile({ projectId, project }: { projectId: string; project: ProjectDto }) {
  const travail = useTravail(projectId, project)
  const { model, code, overview, scopes, treeOfEntry, treeOfRow } = travail
  const { tree, select } = useTreeSelection(code)
  const scoped = useScopedModel(model, tree, tree ? scopes.get(tree.key)! : null)

  if (model.isPending) return null

  return (
    <FilBody
      model={scoped}
      projectId={projectId}
      project={project}
      showInbox={false}
      headerExtra={tree ? <TreeFilterPill tree={tree} onClear={() => select(null)} /> : null}
      before={
        <>
          <AskInbox items={overview.inbox} />
          {project.git || code.demo ? <TreesBlock travail={travail} projectId={projectId} selected={tree?.key ?? null} onSelect={select} /> : null}
        </>
      }
      entryAside={(entry) => {
        const owner = treeOfEntry(entry)
        return owner && !owner.root ? <TreeChip tree={owner} active={owner.key === tree?.key} onSelect={select} /> : null
      }}
      rowAside={(row) => {
        const owner = treeOfRow(row)
        return owner && !owner.root ? <TreeChip tree={owner} active={owner.key === tree?.key} onSelect={select} /> : null
      }}
    />
  )
}

function TreesBlock({ travail, projectId, selected, onSelect }: { travail: Travail; projectId: string; selected: string | null; onSelect: (key: string | null) => void }) {
  const { code } = travail
  const [all, setAll] = useState(false)
  const [branches, setBranches] = useState(false)
  // La racine n'a sa ligne que si elle porte quelque chose : des fichiers non commités.
  const urgent = code.trees.filter((tree) => URGENT.has(tree.verdict) || (tree.root && tree.uncommitted > 0))
  const rest = code.trees.filter((tree) => !urgent.includes(tree))
  const shown = all ? [...urgent, ...rest] : urgent.slice(0, SHOWN)
  const hidden = code.trees.length - shown.length

  return (
    <section aria-labelledby="travail-trees" className="flex flex-col gap-2">
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 id="travail-trees" className="text-sm font-semibold text-ink">Arbres</h2>
        <TreeSummary code={code} />
      </header>

      {code.pending ? (
        <p className="text-sm text-ink-faint">Lecture des arbres…</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line overflow-hidden rounded-lg ring-1 ring-line">
          {shown.length === 0 ? (
            <li className="px-3 py-2.5 text-sm text-ink-faint">Aucun arbre ne demande de geste.</li>
          ) : (
            shown.map((tree) => (
              <CompactTree key={tree.key} tree={tree} travail={travail} projectId={projectId} selected={selected === tree.key} onSelect={onSelect} />
            ))
          )}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        {hidden > 0 || all ? (
          <button type="button" onClick={() => setAll((value) => !value)} className="rounded px-1 text-ink-faint hover:text-ink">
            {all ? 'Ne garder que ce qui demande un geste' : `Voir les ${hidden} autres`}
          </button>
        ) : null}
        {code.branches.length > 0 ? (
          <button type="button" onClick={() => setBranches((value) => !value)} aria-expanded={branches} className="inline-flex items-center gap-1 rounded px-1 text-ink-faint hover:text-ink">
            <ChevronRight size={12} className={cx('transition-transform', branches && 'rotate-90')} />
            {code.branches.length} branche{code.branches.length > 1 ? 's' : ''} sans arbre
            {code.branches.some((branch) => branch.merged) ? `, dont ${code.branches.filter((branch) => branch.merged).length} fusionnées` : ''}
          </button>
        ) : null}
      </div>
      {branches ? (
        <div className="pt-2">
          <Branches data={code} />
        </div>
      ) : null}
    </section>
  )
}

/** Un arbre en une ligne ; déplié, ses sessions, son historique et ses gestes. */
function CompactTree({
  tree,
  travail,
  projectId,
  selected,
  onSelect,
}: {
  tree: TreeRow
  travail: Travail
  projectId: string
  selected: boolean
  onSelect: (key: string | null) => void
}) {
  const [open, setOpen] = useState(false)
  const tone = VERDICT_TONE[tree.verdict]
  return (
    <li className={cx(selected && 'bg-accent-wash/30')}>
      <div className="flex min-h-11 min-w-0 items-center gap-2.5 px-3 py-2">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-label={open ? 'Replier' : 'Déplier ses sessions et son historique'}
          className="-ml-1 flex size-5 shrink-0 items-center justify-center rounded text-ink-faint hover:bg-surface-high hover:text-ink"
        >
          <ChevronRight size={14} className={cx('transition-transform', open && 'rotate-90')} />
        </button>
        <span aria-hidden className={cx('size-2 shrink-0 rounded-full', tone.dot)} />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-3">
          <span className="flex min-w-0 items-center gap-1.5">
            <GitBranch size={12} className="shrink-0 text-ink-faint" />
            <span className={cx('min-w-0 truncate font-mono text-[13px]', tree.root && 'font-semibold')}>{tree.branch ?? tree.name}</span>
          </span>
          <span className={cx('min-w-0 truncate text-xs', tone.text)}>{tree.reason}</span>
        </span>
        <SessionDots tree={tree} />
        <TreeFacts tree={tree} className="hidden shrink-0 flex-nowrap md:flex" />
        <button
          type="button"
          onClick={() => onSelect(tree.key)}
          title={selected ? 'Revenir à tout le fil' : 'Filtrer le fil sur cet arbre'}
          className={cx(
            'flex size-7 shrink-0 items-center justify-center rounded-md transition-colors',
            selected ? 'bg-accent-wash text-accent' : 'text-ink-faint hover:bg-surface-high hover:text-ink',
          )}
        >
          <Filter size={13} />
        </button>
      </div>
      {open ? (
        <div className="flex flex-col gap-3 px-3 pb-3 md:pl-12">
          <TreeFacts tree={tree} className="md:hidden" />
          <TreeActionButtons projectId={projectId} tree={tree} demo={travail.code.demo} />
          <TreeDetail projectId={projectId} tree={tree} model={travail.model} conversations={travail.conversations} demo={travail.code.demo} />
        </div>
      ) : null}
    </li>
  )
}
