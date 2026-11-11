/* PROTOTYPE — jetable (branche proto/page-projet). Ne pas fusionner dans main.
 *
 * Les deux surfaces de Travail `une-ligne` que Tim a demandées pour que « ce qui a l'air
 * cliquable fasse quelque chose » :
 * - le tiroir d'un arbre, qu'ouvre un clic sur sa ligne ou son couloir ;
 * - le dialogue de nettoyage unique : les worktrees fusionnés et les branches fusionnées,
 *   deux sections cochables, un total, une confirmation.
 */
import { ArrowDown, ArrowUp, GitBranch, TriangleAlert } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { ConversationDto } from '@solera/protocol'
import { Badge, Button, ConfirmDialog, cx } from '@solera/ui'
import { Drawer } from '../../components/prototype/Drawer'
import { elapsed } from '../../lib/dates'
import { PR_LABEL, SimTag, VERDICT_TONE } from '../prototype-code/ProjectCodePage'
import { ServiceMark } from '../prototype-automations/served'
import { formatBytes, type TreeRow } from '../prototype-code/data'
import { useProtoHref } from '../prototype-milestones/model'
import type { ActivityModel } from '../prototype-activity/shared'
import { TreeDetail, useTreeActions } from './shared'

/* ------------------------------------------------------------------ le tiroir d'un arbre */

export function TreeDrawer({
  projectId,
  tree,
  model,
  conversations,
  demo,
  onClose,
}: {
  projectId: string
  tree: TreeRow | null
  model: ActivityModel
  conversations: ConversationDto[]
  demo: boolean
  onClose: () => void
}) {
  return (
    <Drawer
      open={tree !== null}
      onClose={onClose}
      label={tree ? `Arbre ${tree.branch ?? tree.name}` : 'Arbre'}
      title={tree ? <span className="font-mono text-[15px]">{tree.branch ?? tree.name}</span> : null}
      subtitle={
        tree ? (
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className={cx('size-2 rounded-full', VERDICT_TONE[tree.verdict].dot)} />
            {tree.root ? 'Racine du projet' : VERDICT_TONE[tree.verdict].label}
            <ServiceMark treeKey={tree.key} />
          </span>
        ) : null
      }
    >
      {tree ? <TreeBody projectId={projectId} tree={tree} model={model} conversations={conversations} demo={demo} /> : null}
    </Drawer>
  )
}

function TreeBody({ projectId, tree, model, conversations, demo }: { projectId: string; tree: TreeRow; model: ActivityModel; conversations: ConversationDto[]; demo: boolean }) {
  const href = useProtoHref()
  const { actions } = useTreeActions(projectId, tree, demo)
  const link = 'underline-offset-2 hover:text-ink hover:underline'

  return (
    <div className="flex flex-col gap-5 px-4 py-4">
      <p className={cx('text-sm', tree.verdict === 'merged-dirty' || tree.verdict === 'missing' ? 'text-critical' : 'text-ink-soft')}>{tree.reason}</p>

      <div className="flex flex-wrap gap-1.5">
        {actions.map((action) => (
          <Button key={action.key} size="sm" variant="secondary" icon={action.icon} onClick={action.run} className={action.tone === 'critical' ? 'text-critical' : undefined}>
            {action.label}
          </Button>
        ))}
      </div>

      <dl className="grid grid-cols-[8rem_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
        {tree.card ? (
          <Fact label="Carte">
            <Link to={href(`?fiche=${tree.card.number}`)} className={cx('min-w-0 truncate', link)}>
              <span className="tabular-nums text-ink-faint">#{tree.card.number}</span> {tree.card.title}
            </Link>
          </Fact>
        ) : null}
        {tree.card?.milestone ? (
          <Fact label="Jalon">
            <Link to={href(`/p/${projectId}/timeline/${tree.card.milestone.number}`)} className={link}>
              #{tree.card.milestone.number} {tree.card.milestone.title}
            </Link>
          </Fact>
        ) : null}
        <Fact label="PR">
          {tree.pr ? (
            tree.pr.url ? (
              <a href={tree.pr.url} target="_blank" rel="noopener noreferrer" className={cx('inline-flex items-center gap-1.5', link)}>
                #{tree.pr.number} <Badge tone={PR_LABEL[tree.pr.state].tone}>{PR_LABEL[tree.pr.state].label}</Badge>
              </a>
            ) : (
              <span className="inline-flex items-center gap-1.5">#{tree.pr.number} <Badge>{PR_LABEL[tree.pr.state].label}</Badge></span>
            )
          ) : (
            <span className="text-ink-faint">aucune</span>
          )}
        </Fact>
        {tree.root ? null : (
          <Fact label="Sur la base">
            <span className="inline-flex items-center gap-3 tabular-nums text-ink-soft">
              <span className="inline-flex items-center"><ArrowUp size={12} />{tree.ahead} propres</span>
              <span className="inline-flex items-center"><ArrowDown size={12} />{tree.behind} en retard</span>
            </span>
          </Fact>
        )}
        <Fact label="Non commités">
          <span className={tree.uncommitted > 0 ? 'text-caution' : 'text-ink-faint'}>{tree.uncommitted > 0 ? `${tree.uncommitted} fichier${tree.uncommitted > 1 ? 's' : ''}` : 'aucun'}</span>
        </Fact>
        <Fact label="Taille">
          <span className="inline-flex items-center gap-1.5 tabular-nums">{tree.sizeBytes ? formatBytes(tree.sizeBytes) : '—'} <SimTag /></span>
        </Fact>
        <Fact label="Dernier usage">
          <span className="text-ink-soft">{tree.lastUsedAt ? `il y a ${elapsed(tree.lastUsedAt)}` : '—'}</span>
        </Fact>
        <Fact label="Chemin">
          <code className="min-w-0 truncate font-mono text-xs text-ink-faint" title={tree.path}>{tree.path}</code>
        </Fact>
      </dl>

      <section className="flex flex-col gap-2">
        <h3 className="text-xs font-medium tracking-wide text-ink-faint uppercase">Sessions et derniers événements</h3>
        <TreeDetail projectId={projectId} tree={tree} model={model} conversations={conversations} demo={demo} limit={8} />
      </section>
    </div>
  )
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-ink-faint">{label}</dt>
      <dd className="flex min-w-0 items-center">{children}</dd>
    </>
  )
}

/* ------------------------------------------------------------------ le nettoyage, en un seul dialogue */

export interface CleanRequest {
  trees: TreeRow[]
  branches: string[]
}

export function CleanAllDialog({
  request,
  base,
  onClose,
  onConfirm,
}: {
  request: CleanRequest | null
  base: string | null
  onClose: () => void
  onConfirm: (trees: TreeRow[], branches: string[]) => void
}) {
  const trees = request?.trees ?? []
  const branches = request?.branches ?? []
  const [withTrees, setWithTrees] = useState(true)
  const [withBranches, setWithBranches] = useState(true)
  // Une nouvelle demande repart tout coché.
  useEffect(() => {
    setWithTrees(true)
    setWithBranches(true)
  }, [request])

  const losing = trees.filter((tree) => tree.uncommitted > 0 || tree.unmergedCommits)
  const size = withTrees ? trees.reduce((sum, tree) => sum + tree.sizeBytes, 0) : 0
  const count = (withTrees ? trees.length : 0) + (withBranches ? branches.length : 0)
  const parts = [
    withTrees && trees.length ? `${trees.length} arbre${trees.length > 1 ? 's' : ''}` : null,
    withBranches && branches.length ? `${branches.length} branche${branches.length > 1 ? 's' : ''}` : null,
  ].filter(Boolean)

  return (
    <ConfirmDialog
      open={request !== null}
      onOpenChange={(open) => (open ? null : onClose())}
      title="Nettoyer"
      confirmLabel={count === 0 ? 'Rien de coché' : `Supprimer ${parts.join(' et ')}${size ? ` — libère ${formatBytes(size)}` : ''}`}
      tone={withTrees && losing.length ? 'critical' : 'accent'}
      onConfirm={() => (count === 0 ? onClose() : onConfirm(withTrees ? trees : [], withBranches ? branches : []))}
    >
      <div className="flex flex-col gap-3 text-sm">
        <p className="rounded-md bg-fuchsia-500/10 px-2.5 py-1.5 text-xs text-fuchsia-700 dark:text-fuchsia-300">Simulé : rien ne sera supprimé depuis le prototype.</p>

        {trees.length > 0 ? (
          <CleanSection
            checked={withTrees}
            onChange={setWithTrees}
            title={`Worktrees fusionnés · ${trees.length}`}
            aside={formatBytes(trees.reduce((sum, tree) => sum + tree.sizeBytes, 0))}
            items={trees.map((tree) => ({ key: tree.key, label: tree.branch ?? tree.name, aside: formatBytes(tree.sizeBytes) }))}
          />
        ) : null}
        {branches.length > 0 ? (
          <CleanSection
            checked={withBranches}
            onChange={setWithBranches}
            title={`Branches fusionnées · ${branches.length}`}
            aside="sans arbre"
            items={branches.map((name) => ({ key: name, label: name }))}
          />
        ) : null}

        {withTrees && losing.length ? (
          <p className="flex items-start gap-2 text-xs text-critical">
            <TriangleAlert size={13} className="mt-px shrink-0" />
            {losing.map((tree) => tree.branch ?? tree.name).join(', ')} : du travail non fusionné ou non commité serait perdu.
          </p>
        ) : (
          <p className="text-xs text-ink-soft">Tout est déjà dans {base ?? 'la base'} : rien ne se perd. Les sessions des arbres sont archivées.</p>
        )}
      </div>
    </ConfirmDialog>
  )
}

/** Une section cochable du dialogue : son titre, puis un aperçu court qui se déplie. */
function CleanSection({
  checked,
  onChange,
  title,
  aside,
  items,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  title: string
  aside: string
  items: { key: string; label: string; aside?: string }[]
}) {
  const [all, setAll] = useState(false)
  const shown = all ? items : items.slice(0, 4)
  return (
    <section className="flex flex-col gap-1.5">
      <label className="flex cursor-pointer items-center gap-2">
        <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="size-4 accent-[var(--color-accent)]" />
        <span className="font-medium">{title}</span>
        <span className="ml-auto text-xs tabular-nums text-ink-faint">{aside}</span>
      </label>
      <ul className={cx('flex max-h-40 flex-col gap-0.5 overflow-y-auto pl-6', !checked && 'opacity-50')}>
        {shown.map((item) => (
          <li key={item.key} className="flex items-center gap-2 text-xs">
            <GitBranch size={11} className="shrink-0 text-ink-faint" />
            <span className="min-w-0 flex-1 truncate font-mono">{item.label}</span>
            {item.aside ? <span className="shrink-0 tabular-nums text-ink-faint">{item.aside}</span> : null}
          </li>
        ))}
      </ul>
      {items.length > shown.length ? (
        <button type="button" onClick={() => setAll(true)} className="self-start pl-6 text-xs text-ink-faint underline-offset-2 hover:text-ink hover:underline">
          et {items.length - shown.length} autre{items.length - shown.length > 1 ? 's' : ''}
        </button>
      ) : null}
    </section>
  )
}
