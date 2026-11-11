/* PROTOTYPE — jetable (branche proto/page-projet). Ne pas fusionner dans main. */
import { GitBranch, HardDrive } from 'lucide-react'
import { useMemo } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import type { ProjectDto } from '@solera/protocol'
import { EmptyState, SegmentedControl, cx } from '@solera/ui'
import { AgentIcon } from '../../components/AgentIcon'
import { usePrototypeVariant, type PrototypeVariant } from '../../components/PrototypeSwitcher'
import { PrototypeVerdict } from '../../components/PrototypeVerdict'
import { useProjects } from '../../lib/projects'
import { FilBody } from '../prototype-activity/FilActivity'
import { Branches, SimTag, Trees, VERDICT_TONE } from '../prototype-code/ProjectCodePage'
import { formatBytes, isCleanable, type CodeData } from '../prototype-code/data'
import { GitPanelHost } from '../../components/prototype/GitPanelHost'
import { CardDrawerHost } from '../prototype-milestones/CardDrawer'
import { Couloirs } from './Couloirs'
import { Empile } from './Empile'
import { Hybride } from './Hybride'
import { Rail } from './Rail'
import { UneLigne } from './UneLigne'
import { TreeCard, TreeDetail, inboxInTree, scopeOf, useScopedModel, useTravail } from './shared'

/**
 * L'onglet **Travail** : Activité et Code fondus en un seul. Rien n'y est neuf — le fil
 * est celui de l'Activité (`FilBody`), les arbres ceux de Code ; seul l'assemblage change.
 *
 * Tim aime le regroupement, le fil et le tableau des arbres, mais pas la bascule du haut
 * (2026-11-11). D'où trois assemblages **sans bascule**, en tête :
 *
 * - `empile` : demandes, arbres en court, puis le fil ; une puce d'arbre sur chaque ligne
 *   filtre le fil en place.
 * - `rail` : le fil au centre, un rail d'arbres collant à droite (des puces au téléphone).
 * - `couloirs` : un couloir par arbre, avec son propre fil ; « Projet » pour le reste.
 *
 * Derrière, pour comparer : `bascule` (« Par moment | Par arbre ») et `maitre-detail`.
 *
 * En tête depuis le 2026-11-11 : `une-ligne`, le principe Filtrer ▾ / Affichage ▾ du
 * Tableau appliqué à Travail (Couloirs · Fil · Tableau en vues, l'arbre choisi en filtre).
 *
 * Avant elle : `hybride` et `hybride-filtre`, l'index de `maitre-detail` et les
 * couloirs de `couloirs` réunis, qui ne diffèrent que par le geste de l'index.
 */
const VARIANTS: PrototypeVariant[] = [
  { key: 'une-ligne', name: 'Une ligne : Filtrer ▾ · Affichage ▾' },
]

export function ProjectTravailPage() {
  const { projectId } = useParams()
  const { data: projects, isPending } = useProjects()
  const project = projects?.find((entry) => entry.id === projectId)
  const variant = usePrototypeVariant(VARIANTS)

  if (isPending) return null
  if (!projectId || !project) return <EmptyState title="Projet introuvable" />

  return (
    <div className="h-full">
      {variant === 'une-ligne' ? (
        <UneLigne projectId={projectId} project={project} />
      ) : variant === 'hybride' || variant === 'hybride-filtre' ? (
        <Hybride projectId={projectId} project={project} mode={variant === 'hybride' ? 'scroll' : 'filter'} />
      ) : variant === 'empile' ? (
        <Empile projectId={projectId} project={project} />
      ) : variant === 'rail' ? (
        <Rail projectId={projectId} project={project} />
      ) : variant === 'couloirs' ? (
        <Couloirs projectId={projectId} project={project} />
      ) : variant === 'bascule' ? (
        <Bascule projectId={projectId} project={project} />
      ) : (
        <MaitreDetail projectId={projectId} project={project} />
      )}
      <CardDrawerHost />
      {projectId ? <GitPanelHost projectId={projectId} /> : null}
      <PrototypeVerdict scope="travail" variant={variant} />
    </div>
  )
}

/* ------------------------------------------------------------------ bascule */

type View = 'moment' | 'arbre'

function Bascule({ projectId, project }: { projectId: string; project: ProjectDto }) {
  const [params, setParams] = useSearchParams()
  const view: View = params.get('vue') === 'arbre' ? 'arbre' : 'moment'
  const { model, code, conversations } = useTravail(projectId, project)

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-12 shrink-0 items-center gap-3 border-b border-line px-4 md:px-6">
        <SegmentedControl<View>
          label="Ranger le travail"
          value={view}
          onChange={(next) =>
            setParams((current) => {
              current.set('vue', next)
              return current
            })
          }
          segments={[
            { value: 'moment', label: 'Par moment' },
            { value: 'arbre', label: `Par arbre ${code.trees.length || ''}`.trim() },
          ]}
        />
        <span className="ml-auto hidden text-xs text-ink-faint sm:block">
          {view === 'moment' ? 'Ce qui t’attend, ce qui tourne, ce qui s’est passé.' : 'Chaque arbre se déplie sur ses sessions et son historique.'}
        </span>
      </div>
      <div className="min-h-0 flex-1">
        {view === 'moment' ? (
          model.isPending ? null : <FilBody model={model} projectId={projectId} project={project} />
        ) : (
          <div className="h-full overflow-y-auto">
            <div className="flex flex-col gap-8 p-4 pb-28 md:p-6 md:pb-28">
              {!project.git && !code.demo ? (
                <EmptyState title="Ce projet n’est pas un dépôt git" />
              ) : (
                <>
                  <Trees
                    projectId={projectId}
                    data={code}
                    detail={(tree) => <TreeDetail projectId={projectId} tree={tree} model={model} conversations={conversations} demo={code.demo} />}
                  />
                  <Branches data={code} />
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ maître-détail */

function MaitreDetail({ projectId, project }: { projectId: string; project: ProjectDto }) {
  const [params, setParams] = useSearchParams()
  const { model, code, overview, conversations } = useTravail(projectId, project)

  const selectedKey = params.get('arbre')
  const tree = code.trees.find((entry) => entry.key === selectedKey) ?? null
  const scope = useMemo(() => (tree ? scopeOf(tree, conversations) : null), [tree, conversations])
  const scoped = useScopedModel(model, tree, scope)
  const inbox = scope ? overview.inbox.filter((item) => inboxInTree(item, scope)) : undefined

  const select = (key: string | null) =>
    setParams((current) => {
      if (key) current.set('arbre', key)
      else current.delete('arbre')
      return current
    })

  if (model.isPending) return null
  if (!project.git && !code.demo) {
    return <FilBody model={model} projectId={projectId} project={project} />
  }

  return (
    <div className="flex h-full min-h-0 flex-col lg:grid lg:grid-cols-[20rem_minmax(0,1fr)]">
      {/* Au large : la colonne des arbres, collante parce qu'elle a son propre défilement. */}
      <aside className="hidden min-h-0 flex-col border-r border-line lg:flex">
        <TreeList code={code} selected={tree?.key ?? null} onSelect={select} />
      </aside>

      {/* Au doigt : la liste devient un sélecteur au-dessus du fil. */}
      <div className="flex shrink-0 items-center gap-2 border-b border-line px-4 py-2 lg:hidden">
        <GitBranch size={14} className="shrink-0 text-ink-faint" />
        <select
          value={tree?.key ?? ''}
          onChange={(event) => select(event.target.value || null)}
          aria-label="Arbre"
          className="h-8 min-w-0 flex-1 rounded-md border border-line bg-canvas px-2 text-sm"
        >
          <option value="">Tous les arbres ({code.trees.length})</option>
          {code.trees.map((entry) => (
            <option key={entry.key} value={entry.key}>
              {VERDICT_TONE[entry.verdict].label} · {entry.branch ?? entry.name}
            </option>
          ))}
        </select>
      </div>

      <div className="min-h-0 flex-1">
        <FilBody
          model={scoped}
          projectId={projectId}
          project={project}
          inbox={inbox}
          top={tree ? <TreeCard projectId={projectId} tree={tree} demo={code.demo} onClose={() => select(null)} /> : undefined}
        />
      </div>
    </div>
  )
}

function TreeList({ code, selected, onSelect }: { code: CodeData; selected: string | null; onSelect: (key: string | null) => void }) {
  const cleanable = code.trees.filter(isCleanable)
  const total = code.trees.reduce((sum, tree) => sum + tree.sizeBytes, 0)
  const count = code.trees.filter((tree) => !tree.root).length
  const item = 'flex w-full min-w-0 items-start gap-2.5 rounded-md px-2 py-2 text-left transition-colors'

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex shrink-0 flex-col gap-1 border-b border-line px-4 py-3">
        <h2 className="text-sm font-semibold text-ink">Arbres</h2>
        <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-ink-soft">
          <span className="tabular-nums">{count} arbre{count > 1 ? 's' : ''}</span>
          <span aria-hidden className="text-ink-faint">·</span>
          <span className="inline-flex items-center gap-1 tabular-nums">
            <HardDrive size={12} className="text-ink-faint" />
            {formatBytes(total)}
            <SimTag />
          </span>
          {cleanable.length > 0 ? (
            <>
              <span aria-hidden className="text-ink-faint">·</span>
              <span className="text-positive tabular-nums">{cleanable.length} à nettoyer</span>
            </>
          ) : null}
        </p>
      </header>
      <ul className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto p-2">
        <li>
          <button type="button" onClick={() => onSelect(null)} className={cx(item, selected === null ? 'bg-surface-high' : 'hover:bg-surface-high/60')}>
            <span aria-hidden className="mt-1.5 size-2 shrink-0 rounded-full border border-ink-faint" />
            <span className="min-w-0 flex-1 text-sm font-medium">Tous</span>
            <span className="text-xs text-ink-faint">tout le fil</span>
          </button>
        </li>
        {code.trees.map((tree) => {
          const tone = VERDICT_TONE[tree.verdict]
          return (
            <li key={tree.key}>
              <button type="button" onClick={() => onSelect(tree.key)} className={cx(item, selected === tree.key ? 'bg-surface-high' : 'hover:bg-surface-high/60')}>
                <span aria-hidden className={cx('mt-1.5 size-2 shrink-0 rounded-full', tone.dot)} />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className={cx('min-w-0 truncate font-mono text-[13px]', tree.root && 'font-semibold')}>{tree.branch ?? tree.name}</span>
                  <span className={cx('min-w-0 truncate text-xs', tone.text)}>{tree.reason}</span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1">
                  <span className="text-xs tabular-nums text-ink-faint">{tree.sizeBytes ? formatBytes(tree.sizeBytes) : ''}</span>
                  {tree.sessions.length > 0 ? (
                    <span className="flex gap-0.5">
                      {tree.sessions.slice(0, 3).map((session) => (
                        <span key={session.id} className={cx('flex size-4 items-center justify-center rounded', session.status === 'running' ? 'text-accent' : 'bg-caution/15 text-caution')}>
                          <AgentIcon agent={session.agent} size={11} />
                        </span>
                      ))}
                    </span>
                  ) : null}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
