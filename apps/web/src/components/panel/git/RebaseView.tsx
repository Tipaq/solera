import { useEffect, useState } from 'react'
import { ChevronDown, GripVertical, Loader, Lock, Play } from 'lucide-react'
import type { GitStateDto, RebaseCommitDto, RebaseStep, RebaseVerb } from '@solera/protocol'
import { useTranslate, type MessageKey } from '../../../lib/i18n'
import type { WorkspaceScope } from '../../../lib/workspace-scope'
import { Button, Menu, MenuItem, cx } from '@solera/ui'
import { useGitActions } from './actions'
import { DragLive, moved, useKeyboardDrag } from './drag'
import { useRebasePlan } from './queries'

/**
 * Le rebase interactif (planche T9) : quatre verbes, et la suspension des tours.
 *
 * L'écran se lit comme une recette, du plus ancien au plus récent — l'inverse du
 * graphe, et c'est voulu : c'est l'ordre dans lequel git rejouera.
 *
 * **Le bandeau du bas n'est pas un avertissement de politesse.** C'est le troisième
 * écart assumé avec GitKraken (carte #10) : pendant que le rebase court, les tours de
 * ce fil sont suspendus, parce qu'un rebase à moitié fait n'est pas un dépôt qu'un
 * agent sait lire. Le refus vit dans le gestionnaire de sessions ; l'écran ne fait que
 * le dire avant, pour que ce ne soit pas une surprise.
 *
 * **Réordonner se fait au clavier** (lot 4) : c'est le même geste que « glisser une
 * branche sur une autre », écrit une fois dans `drag.tsx`, et il n'existe pas au doigt.
 * Les quatre verbes, eux, passent par le menu de chaque ligne, qui marche partout — et
 * c'est bien pour ça qu'un plan reste entièrement composable sans ce raccourci.
 *
 * L'ordre du plan n'est pas une préférence d'affichage : c'est l'ordre dans lequel git
 * rejouera. Il part donc tel quel dans `rebase-start`, qui l'attendait déjà du plus
 * ancien au plus récent — aucune route n'a eu à bouger pour ce lot.
 */

const VERBS: { id: RebaseVerb; label: MessageKey }[] = [
  { id: 'pick', label: 'git.rebase.verb.pick' },
  { id: 'squash', label: 'git.rebase.verb.squash' },
  { id: 'reword', label: 'git.rebase.verb.reword' },
  { id: 'drop', label: 'git.rebase.verb.drop' },
]

const TONES: Record<RebaseVerb, string> = {
  pick: 'bg-accent-wash text-accent',
  squash: 'bg-accent-wash text-accent',
  reword: 'bg-caution/15 text-caution',
  drop: 'bg-critical/12 text-critical',
}

export function RebaseView({
  scope,
  onto,
  state,
  onClose,
}: {
  scope: WorkspaceScope
  /** Le point de départ désigné par le menu d'un commit ; null = l'amont. */
  onto: string | null
  state: GitStateDto | undefined
  onClose: () => void
}) {
  const t = useTranslate()
  const { run, lock, pending } = useGitActions()
  const plan = useRebasePlan(scope, onto, true)
  const running = state?.rebase ?? null
  const frozen = !!lock || pending

  /** Le verbe choisi pour chaque commit, et le message réécrit quand il y en a un. */
  const [verbs, setVerbs] = useState<Record<string, RebaseStep>>({})
  /** L'ordre composé, qui n'est plus forcément celui que le serveur a lu. */
  const [order, setOrder] = useState<string[]>([])
  useEffect(() => {
    const commits = plan.data?.commits ?? []
    setVerbs(
      Object.fromEntries(
        commits.map((commit) => [commit.hash, { hash: commit.hash, verb: 'pick' as const, message: '' }]),
      ),
    )
    setOrder(commits.map((commit) => commit.hash))
  }, [plan.data])

  const drag = useKeyboardDrag({
    rows: order,
    canHold: () => !frozen,
    // Toutes les autres lignes : déplacer une ligne dans une liste, c'est pouvoir la
    // poser n'importe où, et c'est ce qui fait que ce geste vaut le détour.
    canDrop: () => true,
    onDrop: (held, over) => setOrder((current) => moved(current, held, over)),
    roleDescription: t('git.drag.step.role'),
    phrase: (step, held, over) => {
      const name = (hash: string) =>
        (plan.data?.commits ?? []).find((commit) => commit.hash === hash)?.subject ?? hash
      if (step === 'cancel') return t('git.drag.cancelled', { name: name(held) })
      const at = (over === null ? order : moved(order, held, over)).indexOf(held) + 1
      if (step === 'drop') return t('git.drag.step.dropped', { name: name(held), at, of: order.length })
      return t('git.drag.step.held', { name: name(held), at, of: order.length })
    },
  })

  // L'ordre qu'on verrait si on lâchait maintenant : c'est ce qui se rend pendant le
  // geste, et c'est la même fonction qui l'écrira au lâcher.
  const shown = drag.held !== null && drag.over !== null ? moved(order, drag.held, drag.over) : order
  const byHash = new Map((plan.data?.commits ?? []).map((commit) => [commit.hash, commit]))
  const commits = shown.map((hash) => byHash.get(hash)).filter(Boolean) as RebaseCommitDto[]
  const steps = commits.map((commit) => verbs[commit.hash]).filter(Boolean) as RebaseStep[]
  const kept = steps.filter((step) => step.verb === 'pick' || step.verb === 'reword').length

  // Un rebase court déjà : l'écran devient son tableau de bord, et le plan n'a plus
  // lieu d'être proposé — on ne rebase pas pendant qu'on rebase.
  if (running) {
    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <Header
          title={t('git.rebase.runningTitle', { done: running.done, total: running.total })}
          onClose={onClose}
        />
        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2.5">
          {running.stopped ? (
            <p className="text-xs text-ink">
              {t('git.rebase.stoppedOn', {
                hash: running.stopped.shortHash,
                subject: running.stopped.subject,
              })}
            </p>
          ) : null}
          {running.conflicted.length > 0 ? (
            <p className="text-xs text-caution">
              {t('git.rebase.conflicted', { count: running.conflicted.length })}
            </p>
          ) : null}
          <Suspended />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="primary"
              disabled={frozen || running.conflicted.length > 0}
              onClick={() => run({ kind: 'rebase-continue' })}
            >
              {t('git.rebase.continue')}
            </Button>
            <Button variant="ghost" disabled={frozen} onClick={() => run({ kind: 'rebase-skip' })}>
              {t('git.rebase.skip')}
            </Button>
            <Button variant="danger" disabled={frozen} onClick={() => run({ kind: 'rebase-abort' })}>
              {t('git.rebase.abort')}
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <Header
        title={
          plan.data?.onto
            ? t(commits.length === 1 ? 'git.rebase.titleOne' : 'git.rebase.title', {
                count: commits.length,
                onto: ontoLabel(plan.data.onto),
              })
            : t('git.rebase.noOnto')
        }
        onClose={onClose}
        action={
          commits.length > 0 ? (
            <button
              type="button"
              disabled={frozen || steps.length === 0}
              onClick={() =>
                plan.data?.onto && run({ kind: 'rebase-start', onto: plan.data.onto.ref, plan: steps })
              }
              className="flex shrink-0 items-center gap-1.5 rounded-md bg-accent px-2.5 py-1.5 text-xs font-medium text-on-accent disabled:opacity-45"
            >
              <Play size={13} />
              {t('git.rebase.run')}
            </button>
          ) : null
        }
      />

      <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto p-2">
        {plan.isPending ? (
          <p className="flex items-center gap-1.5 px-1 py-2 text-xs text-ink-faint">
            <Loader size={11} className="animate-spin" />
            {t('git.graph.loading')}
          </p>
        ) : null}

        {!plan.isPending && commits.length === 0 ? (
          <p className="px-1 py-2 text-xs text-ink-faint">
            {plan.data?.onto ? t('git.rebase.empty') : t('git.rebase.noOntoHint')}
          </p>
        ) : null}

        {commits.map((commit) => {
          const step = verbs[commit.hash]
          const verb = step?.verb ?? 'pick'
          return (
            <div
              key={commit.hash}
              {...drag.rowProps(commit.hash)}
              aria-label={t('git.drag.step.label', { subject: commit.subject })}
              className={cx(
                'flex items-center gap-2 rounded-md border px-2 py-1.5 outline-none',
                drag.over === commit.hash ? 'border-accent' : 'border-line',
                drag.held === commit.hash && 'bg-accent-wash',
                'focus-visible:border-accent',
                verb === 'drop' && 'opacity-55',
              )}
            >
              {/* La poignée ne se clique pas : elle dit que la ligne se déplace, et où
                  la flèche du clavier agira. Au doigt, elle n'est qu'un repère — le
                  geste n'y existe pas, et les quatre verbes suffisent à composer. */}
              <GripVertical
                size={13}
                aria-hidden
                className={cx(
                  'shrink-0',
                  drag.held === commit.hash ? 'text-accent' : 'text-ink-faint opacity-50',
                )}
              />

              <Menu
                align="start"
                trigger={
                  <button
                    type="button"
                    aria-label={t('git.rebase.choose', { subject: commit.subject })}
                    className={cx(
                      'flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-micro font-medium',
                      TONES[verb],
                    )}
                  >
                    {t(VERBS.find((entry) => entry.id === verb)?.label ?? 'git.rebase.verb.pick')}
                    <ChevronDown size={11} />
                  </button>
                }
              >
                {VERBS.map((entry) => (
                  <MenuItem
                    key={entry.id}
                    onSelect={() =>
                      setVerbs((current) => ({
                        ...current,
                        [commit.hash]: {
                          hash: commit.hash,
                          verb: entry.id,
                          message: entry.id === 'reword' ? commit.subject : '',
                        },
                      }))
                    }
                  >
                    {t(entry.label)}
                  </MenuItem>
                ))}
              </Menu>

              {/* Réécrire se fait sur place : ouvrir un dialogue pour une ligne de
                  texte ferait perdre de vue le reste du plan, qui est ce qu'on est en
                  train de composer. */}
              {verb === 'reword' ? (
                <input
                  value={step?.message ?? ''}
                  aria-label={t('git.rebase.newMessage')}
                  onChange={(event) =>
                    setVerbs((current) => ({
                      ...current,
                      [commit.hash]: { hash: commit.hash, verb: 'reword', message: event.target.value },
                    }))
                  }
                  className="min-w-0 flex-1 rounded border border-line bg-transparent px-1.5 py-0.5 text-xs text-ink outline-none focus:border-accent"
                />
              ) : (
                <span
                  className={cx(
                    'min-w-0 flex-1 truncate text-xs text-ink',
                    verb === 'drop' && 'line-through',
                  )}
                  title={commit.subject}
                >
                  {commit.subject}
                </span>
              )}

              <span className="shrink-0 font-mono text-micro text-ink-faint">{commit.shortHash}</span>
            </div>
          )
        })}

        {commits.length > 0 ? (
          <div className="mt-1">
            <Suspended count={`${commits.length} → ${kept}`} />
          </div>
        ) : null}

        <DragLive message={drag.message} />
      </div>
    </div>
  )
}

/**
 * Sur quoi on rebase, dit court.
 *
 * `ref` est ce qu'on a demandé à git : un nom de branche quand il vient de l'amont, un
 * sha de quarante caractères quand il vient du menu d'un commit. Le second ne se lit
 * pas dans un titre, et c'est le sha court qui le remplace.
 */
const ontoLabel = (onto: { ref: string; shortHash: string }): string =>
  /^[0-9a-f]{7,40}$/.test(onto.ref) ? onto.shortHash : onto.ref

function Header({
  title,
  action,
  onClose,
}: {
  title: string
  action?: React.ReactNode
  onClose: () => void
}) {
  const t = useTranslate()
  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-line px-2.5 py-2">
      <p className="min-w-0 flex-1 truncate text-xs font-medium text-ink">{title}</p>
      {action}
      <button
        type="button"
        onClick={onClose}
        className="shrink-0 rounded-md border border-line px-2 py-1 text-micro font-medium text-ink-soft hover:bg-surface-high"
      >
        {t('git.rebase.close')}
      </button>
    </div>
  )
}

/**
 * Le bandeau que GitKraken ne peut pas avoir.
 *
 * Il dit ce que le rebase fera des commits, et ce qu'il fera des tours. Les deux dans
 * la même phrase parce que c'est la même décision : on accepte de ne pas pouvoir
 * parler à l'agent pendant ce temps-là, en échange de trois commits au lieu de douze.
 */
function Suspended({ count }: { count?: string }) {
  const t = useTranslate()
  return (
    <div className="flex items-start gap-2 rounded-md border border-caution/40 bg-caution/8 px-2.5 py-2">
      <Lock size={13} className="mt-0.5 shrink-0 text-caution" />
      <p className="min-w-0 text-micro text-ink-soft">
        {count ? <span className="font-medium text-ink">{count}. </span> : null}
        {t('git.rebase.suspends')}
      </p>
    </div>
  )
}
