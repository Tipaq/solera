import { useEffect, useState } from 'react'
import type { WorktreeStatusDto } from '@solera/protocol'
import { Banner, ConfirmDialog, Switch, cx } from '@solera/ui'
import { ApiRequestError } from '../lib/api'
import { useUpdateCard } from '../lib/cards'
import { translate, useTranslate } from '../lib/i18n'
import { useCleanWorktree, useWorktreeCleanupPlan } from '../lib/worktrees'

type PluralPrefix =
  | 'worktrees.modified'
  | 'worktrees.untracked'
  | 'worktrees.clean.sessions'
  | 'worktrees.clean.services'
  | 'worktrees.clean.terminals'
  | 'projectActivity.tree.changed'
  | 'projectActivity.idle.trees'
  | 'projectActivity.idle.merged'
  | 'projectActivity.idle.missing'
  | 'projectActivity.idle.cleanMerged'
  | 'projectActivity.branches'

export function plural(prefix: PluralPrefix, count: number): string {
  return translate(`${prefix}.${count > 1 ? 'many' : 'one'}`, { count })
}

/**
 * La confirmation du nettoyage : ce qui serait perdu, et les gestes qui l'accompagnent,
 * chacun débrayable. Le plan est relu à l'ouverture, parce que ce qui tourne dans
 * l'arbre et les sessions qui y tiennent changent d'une minute à l'autre.
 *
 * La carte passe en Terminé par le geste ordinaire du board, depuis le client : la
 * colonne reste un geste humain, et la synchronisation GitHub suit comme d'habitude.
 */
export function WorktreeCleanupDialog({
  projectId,
  tree,
  base,
  onClose,
}: {
  projectId: string
  tree: WorktreeStatusDto
  base: string | null
  onClose: () => void
}) {
  const t = useTranslate()
  const { data: plan, isPending: loading } = useWorktreeCleanupPlan(projectId, tree.path)
  const clean = useCleanWorktree(projectId)
  const updateCard = useUpdateCard(projectId)
  const [deleteBranch, setDeleteBranch] = useState(true)
  // Des commits que la base n'a pas : la branche les garde, on ne la propose pas à la
  // suppression d'office. Cochée quand même, la perte est dite plus bas.
  useEffect(() => { setDeleteBranch(!plan?.unmergedCommits) }, [plan?.unmergedCommits])
  const [stopServices, setStopServices] = useState(true)
  const [cardDone, setCardDone] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Une carte encore ouverte se propose en Terminé, sans s'imposer : décoché par défaut.
  useEffect(() => { setCardDone(false) }, [plan?.card?.id])

  const lost: string[] = []
  if (plan) {
    if (plan.modified > 0) lost.push(plural('worktrees.modified', plan.modified))
    if (plan.untracked > 0) lost.push(plural('worktrees.untracked', plan.untracked))
    // Les commits ne partent qu'avec la branche : l'arbre retiré, elle les garde.
    if (plan.unmergedCommits && deleteBranch && plan.branchDeletable && base) {
      lost.push(translate(plan.ahead > 1 ? 'worktrees.clean.lostCommits.many' : 'worktrees.clean.lostCommits.one', { count: plan.ahead, base }))
    }
  }
  const destructive = lost.length > 0 || plan?.state === 'dirty' || plan?.state === 'unreadable'

  return (
    <ConfirmDialog
      open
      onOpenChange={(open: boolean) => { if (!open) onClose() }}
      title={t('worktrees.clean.title', { name: tree.name })}
      confirmLabel={t('worktrees.clean.confirm')}
      tone={destructive ? 'critical' : 'accent'}
      // Une session qui travaille dans l'arbre ne le perd pas sous elle : on attend son tour.
      busy={!plan || plan.busy.length > 0 || clean.isPending || updateCard.isPending}
      onConfirm={() => {
        if (!plan) return
        setError(null)
        clean.mutate(
          { path: plan.path, deleteBranch: deleteBranch && plan.branchDeletable, stopServices },
          {
            onSuccess: () => {
              if (cardDone && plan.card) updateCard.mutate({ id: plan.card.id, column: 'done' })
              onClose()
            },
            onError: (err) => setError(err instanceof ApiRequestError ? err.message : String(err)),
          },
        )
      }}
    >
      {!plan ? (
        <p className="text-ink-faint">{loading ? t('worktrees.clean.loading') : null}</p>
      ) : (
        <>
          <p>{plan.state === 'missing' ? t('worktrees.clean.missingFolder') : t('worktrees.clean.intro')}</p>
          {plan.busy.length > 0 ? (
            <Banner tone="caution">{t('worktrees.clean.busy', { title: plan.busy.map((c) => c.title).join(', ') })}</Banner>
          ) : null}
          {lost.length > 0 ? (
            <Banner tone="critical">
              <span className="font-medium">{t('worktrees.clean.lost')}</span>
              {' · '}
              {lost.join(' · ')}
            </Banner>
          ) : plan.state === 'unreadable' ? (
            <Banner tone="caution">{t('worktrees.clean.unreadable')}</Banner>
          ) : plan.state !== 'missing' ? (
            <p className="text-ink-faint">{t('worktrees.clean.nothingLost')}</p>
          ) : null}
          <ul className="flex flex-col gap-1.5">
            {plan.branch ? (
              <CleanupChoice
                label={plan.branchDeletable ? t('worktrees.clean.branch', { branch: plan.branch }) : t('worktrees.clean.branchBase')}
                checked={deleteBranch && plan.branchDeletable}
                disabled={!plan.branchDeletable}
                onChange={setDeleteBranch}
              />
            ) : null}
            {/* Pas un choix : une session gardée repartirait à la racine du projet sans le
                dire, une fois son arbre parti (carte #61). */}
            {plan.conversations.length > 0 ? (
              <CleanupChoice
                label={plural('worktrees.clean.sessions', plan.conversations.length)}
                detail={plan.conversations.map((c) => c.title).join(', ')}
                checked
                disabled
                onChange={() => undefined}
              />
            ) : null}
            {plan.services.length > 0 ? (
              <CleanupChoice
                label={plural('worktrees.clean.services', plan.services.length)}
                detail={plan.services.map((s) => s.label).join(', ')}
                checked={stopServices}
                onChange={setStopServices}
              />
            ) : null}
            {plan.card ? (
              <CleanupChoice
                label={t('worktrees.clean.card', { number: plan.card.number })}
                detail={plan.card.title}
                checked={cardDone}
                onChange={setCardDone}
              />
            ) : null}
          </ul>
          {plan.terminals > 0 ? (
            <p className="text-ink-faint">{plural('worktrees.clean.terminals', plan.terminals)}</p>
          ) : null}
          {error ? <Banner>{t('worktrees.clean.failed', { message: error })}</Banner> : null}
        </>
      )}
    </ConfirmDialog>
  )
}

function CleanupChoice({
  label,
  detail,
  checked,
  disabled = false,
  onChange,
}: {
  label: string
  detail?: string
  checked: boolean
  disabled?: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <li className="flex items-center gap-2">
      <Switch checked={checked} onCheckedChange={onChange} label={label} disabled={disabled} />
      <span className="min-w-0 flex-1">
        <span className={cx('block', disabled && 'text-ink-faint')}>{label}</span>
        {detail ? <span className="block truncate text-xs text-ink-faint" title={detail}>{detail}</span> : null}
      </span>
    </li>
  )
}
