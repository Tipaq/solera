import { GitBranch, TriangleAlert } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { ConfirmDialog, cx } from '@solera/ui'
import { formatBytes, pluralOf } from '../../lib/code-model'
import { useUpdateCard } from '../../lib/cards'
import { useLocale, useTranslate } from '../../lib/i18n'
import { cleanSummary, type CleanRequest } from '../../lib/travail-clean'
import { useCleanBranches, useCleanWorktree, useWorktreeCleanupPlans } from '../../lib/worktrees'
import { errorText, useTravailNotice } from './TravailNotice'

/** Les noms montrés d'une section avant « et N autres ». */
const PREVIEW = 4

/**
 * Le dialogue « Nettoyer » de Travail (`projet.md` T-12), le seul : la barre, la section
 * « À nettoyer », les branches fusionnées, le menu d'un arbre et son tiroir l'ouvrent,
 * chacun avec ce qu'il retire.
 *
 * Deux sections cochables, cochées à chaque ouverture : les arbres, les branches sans
 * arbre. Ce qui partirait se lit dans le plan que le serveur rend pour chaque arbre,
 * relu à l'ouverture : le travail non commité, les sessions archivées, celles qui
 * travaillent (l'arbre attend), les services arrêtés, les terminaux fermés. Une branche
 * qui a des commits que la base n'a pas reste.
 *
 * La place libérée se dit « jusqu'à », sous les sections et non dans le bouton, qui
 * n'aurait plus tenu dans le dialogue : la taille mesurée compte les fichiers de
 * `node_modules` que le store de pnpm partage, et que le nettoyage ne rend pas.
 */
export function CleanDialog({
  projectId,
  request,
  base,
  onClose,
  onRemoved,
}: {
  projectId: string
  /** Null : fermé. */
  request: CleanRequest | null
  base: string | null
  onClose: () => void
  /** Les clés des arbres retirés. */
  onRemoved: (keys: string[]) => void
}) {
  const t = useTranslate()
  const locale = useLocale()
  const say = useTravailNotice()
  const trees = request?.trees ?? []
  const branches = request?.branches ?? []
  const [withTrees, setWithTrees] = useState(true)
  const [withBranches, setWithBranches] = useState(true)
  const [closeCards, setCloseCards] = useState(false)
  const [running, setRunning] = useState(false)
  // Une nouvelle demande repart tout coché ; les cartes, elles, ne passent en Terminé que sur demande.
  useEffect(() => {
    setWithTrees(true)
    setWithBranches(true)
    setCloseCards(false)
  }, [request])

  const plans = useWorktreeCleanupPlans(projectId, request ? trees.map((tree) => tree.path) : [])
  const summary = cleanSummary({ trees, branches, withTrees, withBranches, plans })
  const cleanTree = useCleanWorktree(projectId)
  const cleanBranches = useCleanBranches(projectId)
  const updateCard = useUpdateCard(projectId)

  const size = (bytes: number) => formatBytes(bytes, locale)
  const names = (list: string[]) => list.join(', ')
  const what = (kind: 'what' | 'removed', treeCount: number, branchCount: number) => {
    const parts = [
      treeCount > 0 ? t(`travail.clean.${kind}.trees.${pluralOf(treeCount)}`, { count: treeCount }) : null,
      branchCount > 0 ? t(`travail.clean.${kind}.branches.${pluralOf(branchCount)}`, { count: branchCount }) : null,
    ].filter((part): part is string => part !== null)
    return parts.length === 2 ? t('travail.clean.and', { first: parts[0]!, second: parts[1]! }) : (parts[0] ?? '')
  }
  const freed = summary.bytes ? summary.bytes : null
  // Rien ne part : rien n'est coché, ou ce qui l'est attend la fin d'un tour.
  const waiting = summary.count === 0 && summary.held.length > 0
  const confirmLabel =
    summary.count === 0
      ? t(waiting ? 'travail.clean.waiting' : 'travail.clean.nothing')
      : t('travail.clean.confirm', { what: what('what', summary.removed.length, summary.branches.length) })

  const run = async () => {
    if (summary.count === 0) return onClose()
    setRunning(true)
    const failures: string[] = []
    const removed: string[] = []
    let removedBytes: number | null = 0
    for (const [index, job] of summary.jobs.entries()) {
      const tree = summary.removed[index]!
      try {
        await cleanTree.mutateAsync(job)
        removed.push(tree.key)
        removedBytes = removedBytes === null || tree.sizeBytes === null ? null : removedBytes + tree.sizeBytes
      } catch (error) {
        failures.push(t('travail.cleanup.failed', { name: tree.branch ?? tree.name, error: errorText(error) }))
      }
    }
    let deleted = 0
    if (summary.branches.length > 0) {
      try {
        const result = await cleanBranches.mutateAsync(summary.branches)
        deleted = result.deleted.length
        for (const entry of result.refused) failures.push(t(`branchCleanup.refused.${entry.reason}`, { name: entry.name, message: entry.message ?? '' }))
      } catch (error) {
        failures.push(errorText(error))
      }
    }
    // La carte passe en Terminé par le geste ordinaire du board : la colonne reste un geste humain.
    if (closeCards) for (const card of summary.cards) updateCard.mutate({ id: card.id, column: 'done' })
    setRunning(false)
    onRemoved(removed)
    onClose()
    const done =
      removed.length + deleted > 0
        ? t(removedBytes ? 'travail.clean.doneFreed' : 'travail.clean.done', { what: what('removed', removed.length, deleted), size: removedBytes ? size(removedBytes) : '' })
        : null
    say([done, ...failures].filter(Boolean).join(' '), failures.length > 0 ? 'critical' : 'neutral')
  }

  const allMerged = trees.every((tree) => tree.verdict === 'clean')
  const facts: string[] = []
  if (summary.archived.length > 0) {
    facts.push(t(`travail.clean.archived.${pluralOf(summary.archived.length)}`, { count: summary.archived.length, titles: names(summary.archived.map((entry) => entry.title)) }))
  }
  if (summary.services.length > 0) {
    facts.push(t(`travail.clean.services.${pluralOf(summary.services.length)}`, { count: summary.services.length, labels: names(summary.services) }))
  }
  if (summary.terminals > 0) facts.push(t(`travail.clean.terminals.${pluralOf(summary.terminals)}`, { count: summary.terminals }))
  if (summary.restarted.length > 0) {
    const titles = names(summary.restarted.map((entry) => (entry.running ? t('worktrees.clean.restarted.running', { title: entry.title }) : entry.title)))
    facts.push(t(`travail.clean.restarted.${pluralOf(summary.restarted.length)}`, { titles }))
  }

  return (
    <ConfirmDialog
      open={request !== null}
      onOpenChange={(open) => (open || running ? null : onClose())}
      title={t('travail.clean.title')}
      confirmLabel={confirmLabel}
      tone={summary.losing.length > 0 ? 'critical' : 'accent'}
      busy={running || !summary.ready || waiting}
      onConfirm={() => void run()}
    >
      <div className="flex flex-col gap-3" data-clean-dialog>
        {trees.length > 0 ? (
          <CleanSection
            checked={withTrees}
            onChange={setWithTrees}
            title={t(allMerged ? 'travail.clean.trees.merged' : 'travail.clean.trees.any', { count: trees.length })}
            aside={<UpTo bytes={sumOf(trees.map((tree) => tree.sizeBytes))} />}
            items={trees.map((tree) => ({ key: tree.key, label: tree.branch ?? tree.name, aside: tree.sizeBytes !== null ? size(tree.sizeBytes) : undefined }))}
          />
        ) : null}
        {branches.length > 0 ? (
          <CleanSection
            checked={withBranches}
            onChange={setWithBranches}
            title={t('travail.clean.branches', { count: branches.length })}
            aside={t('travail.clean.branchesAside')}
            items={branches.map((name) => ({ key: name, label: name }))}
          />
        ) : null}

        {!summary.ready ? (
          <p className="text-xs text-ink-faint">{t('travail.clean.loading')}</p>
        ) : (
          <>
            {summary.losing.length > 0 ? (
              <p className="flex items-start gap-2 text-xs text-critical">
                <TriangleAlert size={13} aria-hidden className="mt-px shrink-0" />
                {t('travail.clean.losing', { names: names(summary.losing) })}
              </p>
            ) : summary.count > 0 && summary.keptBranches.length === 0 ? (
              <p className="text-xs text-ink-soft">{t('travail.clean.nothingLost', { base: base ?? '' })}</p>
            ) : null}
            {summary.keptBranches.length > 0 ? <p className="text-xs text-ink-soft">{t('travail.clean.kept', { names: names(summary.keptBranches), base: base ?? '' })}</p> : null}
            {summary.held.map((entry) => (
              <p key={entry.tree.key} className="text-xs text-caution">
                {t('travail.clean.held', { names: entry.tree.branch ?? entry.tree.name, sessions: names(entry.busy) })}
              </p>
            ))}
            {freed ? (
              <p className="text-xs text-ink-soft" title={t('travail.clean.upToHint')}>
                {t('travail.clean.freed', { size: size(freed) })}
              </p>
            ) : null}
            {facts.length > 0 ? (
              <ul className="flex flex-col gap-0.5 text-xs text-ink-faint">
                {facts.map((fact) => (
                  <li key={fact}>{fact}</li>
                ))}
              </ul>
            ) : null}
            {summary.cards.length > 0 ? (
              <label className="flex cursor-pointer items-start gap-2 text-xs text-ink-soft">
                <input type="checkbox" checked={closeCards} onChange={(event) => setCloseCards(event.target.checked)} className="mt-px size-4 shrink-0 accent-accent" />
                <span className="min-w-0">{t('travail.clean.cards', { cards: names(summary.cards.map((card) => `#${card.number} ${card.title}`)) })}</span>
              </label>
            ) : null}
          </>
        )}
      </div>
    </ConfirmDialog>
  )
}

/** La somme des tailles, null tant qu'une manque : une somme partielle mentirait. */
function sumOf(sizes: (number | null)[]): number | null {
  return sizes.some((value) => value === null) ? null : sizes.reduce<number>((sum, value) => sum + (value ?? 0), 0)
}

/** « jusqu'à X », et pourquoi dans l'infobulle. */
function UpTo({ bytes }: { bytes: number | null }) {
  const t = useTranslate()
  const locale = useLocale()
  if (!bytes) return null
  return <span title={t('travail.clean.upToHint')}>{t('travail.clean.upTo', { size: formatBytes(bytes, locale) })}</span>
}

/** Une section cochable : son titre, puis quatre noms, et le reste au clic. */
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
  aside: ReactNode
  items: { key: string; label: string; aside?: string }[]
}) {
  const t = useTranslate()
  const [all, setAll] = useState(false)
  const shown = all ? items : items.slice(0, PREVIEW)
  const rest = items.length - shown.length
  return (
    <section className="flex flex-col gap-1.5">
      <label className="flex cursor-pointer items-center gap-2">
        <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="size-4 shrink-0 accent-accent" />
        <span className="font-medium text-ink">{title}</span>
        <span className="ml-auto text-xs tabular-nums text-ink-faint">{aside}</span>
      </label>
      <ul className={cx('flex max-h-40 flex-col gap-0.5 overflow-y-auto pl-6', !checked && 'opacity-50')}>
        {shown.map((item) => (
          <li key={item.key} className="flex items-center gap-2 text-xs">
            <GitBranch size={11} aria-hidden className="shrink-0 text-ink-faint" />
            <span className="min-w-0 flex-1 truncate font-mono">{item.label}</span>
            {item.aside ? <span className="shrink-0 tabular-nums text-ink-faint">{item.aside}</span> : null}
          </li>
        ))}
      </ul>
      {rest > 0 ? (
        <button type="button" onClick={() => setAll(true)} className="self-start rounded pl-6 text-xs text-ink-faint underline-offset-2 hover:text-ink hover:underline focus-visible:outline-2 focus-visible:outline-accent">
          {t(`travail.clean.more.${pluralOf(rest)}`, { count: rest })}
        </button>
      ) : null}
    </section>
  )
}
