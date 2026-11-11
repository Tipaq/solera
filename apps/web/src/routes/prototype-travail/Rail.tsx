/* PROTOTYPE — jetable (branche proto/page-projet). Ne pas fusionner dans main. */
import { GitBranch } from 'lucide-react'
import type { ProjectDto } from '@solera/protocol'
import { cx } from '@solera/ui'
import { AskInbox } from '../../components/prototype/AskInbox'
import { FilBody } from '../prototype-activity/FilActivity'
import { VERDICT_TONE } from '../prototype-code/ProjectCodePage'
import type { TreeRow } from '../prototype-code/data'
import {
  Notice,
  SessionDots,
  TreeCard,
  TreeChip,
  TreeFacts,
  TreeFilterPill,
  TreeSummary,
  shortBranch,
  useScopedModel,
  useTravail,
  useTreeActions,
  useTreeSelection,
  type Travail,
} from './shared'

/**
 * `rail` — le fil au centre, pleine hauteur, et à droite un **rail d'arbres** collant :
 * le bilan en tête, puis chaque arbre en carte courte, ses gestes au survol. Choisir un
 * arbre filtre le fil et le met en surbrillance ; « Tous » en tête du rail. Au téléphone,
 * le rail devient une rangée de puces qui défile sous « Ce qui t'attend ».
 */
export function Rail({ projectId, project }: { projectId: string; project: ProjectDto }) {
  const travail = useTravail(projectId, project)
  const { model, code, overview, scopes, treeOfEntry, treeOfRow } = travail
  const { tree, select } = useTreeSelection(code)
  const scoped = useScopedModel(model, tree, tree ? scopes.get(tree.key)! : null)
  const hasTrees = Boolean(project.git || code.demo)

  if (model.isPending) return null

  const chip = (owner: TreeRow | null) =>
    owner && !owner.root && !tree ? <TreeChip tree={owner} onSelect={select} /> : null

  return (
    <div className={cx('h-full min-h-0', hasTrees && 'lg:grid lg:grid-cols-[minmax(0,1fr)_21rem]')}>
      <div className="h-full min-h-0">
        <FilBody
          model={scoped}
          projectId={projectId}
          project={project}
          showInbox={false}
          headerExtra={tree ? <TreeFilterPill tree={tree} onClear={() => select(null)} /> : null}
          before={
            <>
              <AskInbox items={overview.inbox} />
              {hasTrees ? <ChipRow travail={travail} selected={tree?.key ?? null} onSelect={select} /> : null}
              {tree ? <TreeCard projectId={projectId} tree={tree} demo={code.demo} onClose={() => select(null)} /> : null}
            </>
          }
          entryAside={(entry) => chip(treeOfEntry(entry))}
          rowAside={(row) => chip(treeOfRow(row))}
        />
      </div>
      {hasTrees ? (
        <aside className="hidden min-h-0 flex-col border-l border-line lg:flex">
          <RailBody travail={travail} projectId={projectId} selected={tree?.key ?? null} onSelect={select} />
        </aside>
      ) : null}
    </div>
  )
}

/** Au téléphone : les arbres en puces, sous les demandes. */
function ChipRow({ travail, selected, onSelect }: { travail: Travail; selected: string | null; onSelect: (key: string | null) => void }) {
  const { code } = travail
  return (
    <div className="-mx-4 flex flex-col gap-1.5 lg:hidden">
      <TreeSummary code={code} className="px-4" />
      <div className="flex gap-1.5 overflow-x-auto px-4 pb-1">
        <button
          type="button"
          onClick={() => onSelect(null)}
          className={cx('h-8 shrink-0 rounded-full px-3 text-xs', selected === null ? 'bg-surface-high font-medium text-ink' : 'bg-sunken text-ink-soft')}
        >
          Tous
        </button>
        {code.trees.map((tree) => {
          const tone = VERDICT_TONE[tree.verdict]
          return (
            <button
              key={tree.key}
              type="button"
              onClick={() => onSelect(tree.key)}
              className={cx(
                'flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 font-mono text-xs',
                selected === tree.key ? 'bg-accent-wash text-ink' : 'bg-sunken text-ink-soft',
              )}
            >
              <span aria-hidden className={cx('size-1.5 rounded-full', tone.dot)} />
              {tree.root ? tree.branch ?? tree.name : shortBranch(tree)}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function RailBody({ travail, projectId, selected, onSelect }: { travail: Travail; projectId: string; selected: string | null; onSelect: (key: string | null) => void }) {
  const { code } = travail
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-4">
        <GitBranch size={14} className="shrink-0 text-ink-faint" />
        <h2 className="text-sm font-semibold text-ink">Arbres</h2>
        <TreeSummary code={code} className="ml-auto justify-end" />
      </header>
      <ul className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-2">
        <li>
          <button
            type="button"
            onClick={() => onSelect(null)}
            className={cx('flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm', selected === null ? 'bg-surface-high font-medium' : 'text-ink-soft hover:bg-surface-high/60')}
          >
            <span aria-hidden className="size-2 shrink-0 rounded-full border border-ink-faint" />
            Tout le fil
          </button>
        </li>
        {code.pending ? <li className="px-3 py-2 text-xs text-ink-faint">Lecture des arbres…</li> : null}
        {code.trees.map((tree) => (
          <RailTree key={tree.key} tree={tree} projectId={projectId} demo={code.demo} selected={selected === tree.key} onSelect={onSelect} />
        ))}
      </ul>
    </div>
  )
}

/** Un arbre du rail : sa carte courte, ses gestes en icônes au survol. */
function RailTree({ tree, projectId, demo, selected, onSelect }: { tree: TreeRow; projectId: string; demo: boolean; selected: boolean; onSelect: (key: string | null) => void }) {
  const tone = VERDICT_TONE[tree.verdict]
  const { actions, notice } = useTreeActions(projectId, tree, demo)
  return (
    <li className="group relative">
      <button
        type="button"
        onClick={() => onSelect(tree.key)}
        aria-pressed={selected}
        className={cx(
          'flex w-full min-w-0 flex-col gap-1 rounded-lg px-3 py-2 text-left transition-colors',
          selected ? 'bg-accent-wash/50 ring-1 ring-accent/40' : 'hover:bg-surface-high/60',
        )}
      >
        <span className="flex min-w-0 items-center gap-2">
          <span aria-hidden className={cx('size-2 shrink-0 rounded-full', tone.dot)} />
          <span className={cx('min-w-0 flex-1 truncate font-mono text-[13px]', tree.root && 'font-semibold')}>{tree.branch ?? tree.name}</span>
          <SessionDots tree={tree} max={2} />
        </span>
        <span className={cx('min-w-0 truncate pl-4 text-xs', tone.text)}>{tree.reason}</span>
        <TreeFacts tree={tree} className="pl-4" />
      </button>
      {/* Les gestes, au survol : ils ne volent pas la place des faits au repos. */}
      <span className="absolute top-1.5 right-1.5 hidden gap-0.5 rounded-md bg-canvas p-0.5 shadow-sm ring-1 ring-line group-focus-within:flex group-hover:flex">
        {actions.map((action) => (
          <button
            key={action.key}
            type="button"
            title={action.label}
            aria-label={action.label}
            onClick={action.run}
            className={cx('flex size-6 items-center justify-center rounded hover:bg-surface-high', action.tone === 'critical' ? 'text-critical' : 'text-ink-soft')}
          >
            {action.icon}
          </button>
        ))}
      </span>
      {notice ? (
        <div className="px-3 pb-2">
          <Notice text={notice} />
        </div>
      ) : null}
    </li>
  )
}
