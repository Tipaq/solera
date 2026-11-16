import type { ActionPlacement } from '@solera/protocol'
import { ChoiceCards, Select } from '@solera/ui'
import { useTranslate } from '../../../lib/i18n'

/**
 * « Où tourne-t-il » (SRV-6), le réglage d'un service : une seule instance qu'on bascule
 * (conseillé), toujours la racine, toujours une branche, ou une instance par worktree
 * (AC-06), dont le coût est dit et dont le lien doit contenir `{port}`.
 */
export function PlacementField({
  value,
  onChange,
  branch,
  onBranch,
  branches,
  rootBranch,
  url,
}: {
  value: ActionPlacement
  onChange: (next: ActionPlacement) => void
  /** La branche d'un placement `branch`. */
  branch: string
  onBranch: (next: string) => void
  /** Les branches extraites dans un arbre du projet, la racine comprise. */
  branches: string[]
  /** La branche de la racine du projet ; null sans dépôt. */
  rootBranch: string | null
  /** Le lien du service : une instance par worktree demande `{port}`. */
  url: string
}) {
  const t = useTranslate()
  const choices = branches.includes(branch) || !branch ? branches : [branch, ...branches]
  return (
    <ChoiceCards
      label={t('served.placement.label')}
      value={value}
      onChange={onChange}
      options={[
        { value: 'follow', label: t('served.placement.follow'), hint: t('served.placement.followHint'), badge: t('served.placement.recommended') },
        { value: 'root', label: t('served.placement.root'), hint: t('served.placement.rootHint') },
        { value: 'branch', label: t('served.placement.branch'), hint: t('served.placement.branchHint') },
        {
          value: 'per-worktree',
          label: t('served.placement.perWorktree'),
          hint: t('served.placement.perWorktreeHint'),
          badge: t('served.placement.edgeCase'),
        },
      ]}
      selectedExtra={(choice) =>
        choice === 'branch' ? (
          <div className="flex flex-col gap-1.5">
            <Select
              label={t('served.placement.branchLabel')}
              value={branch}
              onChange={onBranch}
              options={choices.map((entry) => ({ value: entry, label: entry }))}
              className="max-w-xs"
            />
            {branch ? (
              <span className="text-xs text-ink-faint">
                {rootBranch === branch
                  ? t('served.placement.branchOnRoot')
                  : t('served.placement.branchNeedsTree', { root: rootBranch ?? '?', branch })}
              </span>
            ) : null}
          </div>
        ) : choice === 'per-worktree' ? (
          <p className="text-xs text-caution">
            {t('served.placement.perWorktreeCost')}
            {url.includes('{port}') ? null : <> {t('served.placement.perWorktreeLink', { token: '{port}' })}</>}
          </p>
        ) : null
      }
    />
  )
}
