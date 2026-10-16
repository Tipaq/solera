import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  ArrowDown,
  ArrowUp,
  Boxes,
  ChevronDown,
  Cloud,
  GitBranch,
  GitMerge,
  Loader,
  MessagesSquare,
  MoreHorizontal,
  RotateCcw,
  Tag,
} from 'lucide-react'
import type { RefSectionDto } from '@solera/protocol'
import { useTranslate } from '../../../lib/i18n'
import type { WorkspaceScope } from '../../../lib/workspace-scope'
import { Banner, cx } from '@solera/ui'
import { useGitActions } from './actions'
import { DragLive, useKeyboardDrag, type KeyboardDrag } from './drag'
import { BranchMenu, type MenuContext } from './menus'
import { useRefs } from './queries'

/**
 * La destination *Branches* : Local, Worktrees, Distants, Étiquettes, Sous-modules.
 *
 * Tout le panneau de gauche de GitKraken, **sections vides comprises** : une section
 * qui apparaît un jour sans prévenir est pire qu'une section vide. Deux colonnes sont
 * à nous : le retard sur l'amont, et le fil qui occupe le worktree.
 *
 * Les gestes — basculer, fusionner, rebaser, renommer, supprimer, pousser, suivre un
 * amont, en faire un worktree — vivent dans le menu de chaque ligne, jamais dans la
 * barre d'outils : ils désignent *cette* branche (règle T0). Les étiquettes et les
 * sous-modules n'en ont pas, leurs gestes n'étant pas du lot 2.
 *
 * **Le glisser-déposer du lot 4** (planche T6) n'ajoute donc rien à la barre d'outils
 * et rien au menu : c'est un raccourci au clavier vers deux entrées qui existent déjà,
 * et il *propose* au lieu d'agir.
 */
const ICONS = {
  local: GitBranch,
  worktrees: GitBranch,
  remote: Cloud,
  tags: Tag,
  submodules: Boxes,
} as const

/** Ce qu'on vient de lâcher, et sur quoi : la proposition de T6, pas encore un geste. */
interface Drop {
  from: string
  to: string
}

export function BranchesView({
  scope,
  menus,
  onOpenThread,
}: {
  scope: WorkspaceScope
  menus: MenuContext
  onOpenThread: (id: string) => void
}) {
  const t = useTranslate()
  const { data, error, isPending } = useRefs(scope, true)
  const [drop, setDrop] = useState<Drop | null>(null)

  /**
   * Les branches locales, dans l'ordre de l'écran : ce sont elles qui se saisissent,
   * et elles seules. Une étiquette ne se fusionne pas, un distant se tire.
   */
  const rows = (data?.sections ?? [])
    .filter((section) => section.kind === 'local' || section.kind === 'worktrees')
    .flatMap((section) => section.lines.map((line) => line.name))

  /**
   * **La destination est la branche courante, et rien d'autre.**
   *
   * Ce n'est pas une restriction de confort : les deux gestes que T6 propose sont
   * `git merge <branche>` et `git rebase <branche>`, qui partent tous les deux de là
   * où l'on est. Lâcher sur une branche où l'on n'est pas voudrait dire y basculer
   * d'abord — un troisième geste, que personne n'a demandé et qui déplacerait les
   * fichiers sous un agent. Les autres lignes ne s'allument donc pas.
   */
  const current = (data?.sections ?? [])
    .flatMap((section) => section.lines)
    .find((line) => line.current)?.name ?? null

  /**
   * **La proposition se périme avec le dépôt.**
   *
   * `branch-merge` et `branch-rebase` visent un `HEAD` implicite côté serveur : ils
   * ne portent que la branche d'où l'on part, et c'est la branche courante qui reçoit.
   * Si un agent bascule ailleurs entre le lâcher et le clic, la phrase à l'écran dit
   * toujours « sur main » pendant que le geste, lui, fusionnerait dans l'autre. Même
   * politique que le sha d'une remise au lot 2 : on refuse plutôt que de viser autre
   * chose. Ici, refuser c'est fermer — il n'y a rien de commencé à défaire.
   */
  useEffect(() => {
    if (drop && (drop.to !== current || !rows.includes(drop.from))) setDrop(null)
  }, [drop, current, rows])

  const drag = useKeyboardDrag({
    rows,
    canHold: (name) => !menus.locked && name !== current && drop === null,
    canDrop: (_held, over) => over === current,
    onDrop: (from, to) => setDrop({ from, to }),
    roleDescription: t('git.drag.branch.role'),
    phrase: (step, held, over) => {
      if (step === 'cancel') return t('git.drag.cancelled', { name: held })
      if (step === 'drop') return t('git.drag.branch.dropped', { from: held, to: over ?? '' })
      return t('git.drag.branch.held', { from: held, to: over ?? '' })
    },
  })

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-0.5 overflow-y-auto p-2 pt-1 pb-safe">
        {isPending ? (
          <p className="flex items-center gap-1.5 px-1 py-2 text-xs text-ink-faint">
            <Loader size={11} className="animate-spin" />
            {t('git.branches.loading')}
          </p>
        ) : null}

        {error ? <Banner>{error instanceof Error ? error.message : t('git.branches.error')}</Banner> : null}

        {data && data.sections === null ? (
          <p className="px-1 py-2 text-xs text-ink-faint">{t('changes.diff.notGitRepo')}</p>
        ) : null}

        {(data?.sections ?? []).map((section) => (
          <Section
            key={sectionKey(section)}
            section={section}
            menus={menus}
            drag={drag}
            onOpenThread={onOpenThread}
          />
        ))}
      </div>

      <DragLive message={drag.message} />

      {drop ? (
        <Proposal
          drop={drop}
          onClose={() => {
            setDrop(null)
            // Le focus revient d'où il venait. Sans ça il retombe sur le corps du
            // document, et la tabulation repart du haut de la page — ce qui coûte
            // bien plus cher à qui n'a que le clavier qu'à qui a une souris.
            document.getElementById(rowId(drop.from))?.focus()
          }}
        />
      ) : null}
    </div>
  )
}

/**
 * Ce que T6 montre au lâcher : la phrase, les deux issues, et l'échappée.
 *
 * Il n'agit pas de lui-même, et c'est toute la réserve de la planche — « il faut qu'un
 * lâcher accidentel ne fusionne rien ». Les deux boutons repassent par `run`, donc par
 * le verrou du tour en cours et par le garde-fou de T13 : ce raccourci n'ouvre aucune
 * porte dérobée.
 */
function Proposal({ drop, onClose }: { drop: Drop; onClose: () => void }) {
  const t = useTranslate()
  const { run, lock, pending } = useGitActions()
  const frozen = !!lock || pending

  const choose = (action: 'merge' | 'rebase'): void => {
    onClose()
    run(
      action === 'merge'
        ? { kind: 'branch-merge', name: drop.from }
        : { kind: 'branch-rebase', name: drop.from },
    )
  }

  /*
   * **Le focus va au conteneur, et non au premier bouton.**
   *
   * Deux raisons, et la première est un défaut qu'on a eu. Le lâcher part d'un
   * `keydown` Entrée ; monter ce bloc déplace le focus de façon synchrone ; si la
   * touche est restée enfoncée, le `keydown` de répétition arrive sur le bouton qui
   * vient de le prendre — et un navigateur active un `<button>` dès le `keydown` pour
   * Entrée. Une touche tenue une fraction de seconde de trop aurait fusionné. La
   * seconde raison tient sans la première : poser le focus par défaut sur l'issue qui
   * écrit est exactement ce que la réserve de T6 voulait éviter.
   *
   * Le conteneur prend donc le focus — ce qui fait lire la question avant les issues,
   * la tabulation menant ensuite aux trois boutons.
   */
  const shell = useRef<HTMLDivElement>(null)
  useEffect(() => shell.current?.focus(), [])

  const title = t('git.drag.branch.proposal', { from: drop.from, to: drop.to })

  return (
    <div
      ref={shell}
      // `alertdialog` sur le modèle du garde-fou de T13 : une question qui porte sur
      // un geste qui écrit doit être annoncée comme telle, et avec son texte.
      role="alertdialog"
      aria-label={title}
      tabIndex={-1}
      // Échap depuis n'importe lequel des trois boutons : la planche l'écrit à droite
      // comme une issue, et c'est la touche qu'on presse pour sortir d'une question.
      onKeyDown={(event) => event.key === 'Escape' && onClose()}
      className="flex shrink-0 flex-wrap items-center gap-2 border-t border-line bg-surface-high px-2.5 py-2 outline-none"
    >
      <p className="min-w-0 flex-1 text-xs text-ink">{title}</p>
      {/* « Fusionner » amène `from` dans la courante ; « Rebaser » rejoue la courante
          par-dessus `from`. Les deux verbes de T6, et les deux entrées du menu d'une
          branche — mot pour mot, pour que le raccourci n'apprenne rien de faux. */}
      <button
        type="button"
        disabled={frozen}
        onClick={() => choose('merge')}
        className="flex shrink-0 items-center gap-1.5 rounded-md bg-accent px-2.5 py-1.5 text-xs font-medium text-on-accent disabled:opacity-45"
      >
        <GitMerge size={13} />
        {t('git.drag.branch.merge')}
      </button>
      <button
        type="button"
        disabled={frozen}
        onClick={() => choose('rebase')}
        className="flex shrink-0 items-center gap-1.5 rounded-md border border-line px-2.5 py-1.5 text-xs font-medium text-ink-soft hover:bg-surface disabled:opacity-45"
      >
        <RotateCcw size={13} />
        {t('git.drag.branch.rebase')}
      </button>
      <button
        type="button"
        onClick={onClose}
        className="shrink-0 px-1 text-micro text-ink-faint hover:text-ink"
      >
        {t('git.drag.escape')}
      </button>
    </div>
  )
}

/** De quoi rendre le focus à la ligne qu'on vient de lâcher. */
const rowId = (name: string): string => `git-branch-${name.replace(/[^\w-]/g, '_')}`

const sectionKey = (section: RefSectionDto): string =>
  section.remote ? `${section.kind}:${section.remote}` : section.kind

function Section({
  section,
  menus,
  drag,
  onOpenThread,
}: {
  section: RefSectionDto
  menus: MenuContext
  drag: KeyboardDrag
  onOpenThread: (id: string) => void
}) {
  const t = useTranslate()
  const Icon = ICONS[section.kind]
  const movable = section.kind === 'local' || section.kind === 'worktrees'

  return (
    <div className="flex flex-col gap-0.5 pb-1">
      <span className="flex items-center gap-1 px-1 pt-1 text-micro font-semibold tracking-wide text-ink-soft uppercase">
        <ChevronDown size={10} />
        <Icon size={10} />
        {section.kind !== 'remote'
          ? t(`git.branches.${section.kind}`)
          : section.remote
            ? t('git.branches.remote', { remote: section.remote })
            : t('git.branches.remoteNone')}
      </span>

      {section.lines.length === 0 ? (
        <span className="px-1.5 py-0.5 text-micro text-ink-faint italic">
          {t('git.branches.none')}
        </span>
      ) : null}

      {section.lines.map((line) => {
        const row = (menu: ReactNode) => (
          <div
            {...(movable
              ? {
                  ...drag.rowProps(line.name),
                  id: rowId(line.name),
                  // Le nom, sans quoi le rôle ne sert à rien : un lecteur d'écran qui
                  // tabule dans la ligne annoncerait son rôle et rien d'autre.
                  'aria-label': t('git.drag.branch.label', { name: line.name }),
                }
              : {})}
            className={cx(
              'group flex items-center gap-1.5 rounded px-1.5 py-1 outline-none',
              line.current && 'bg-accent-wash',
              // La ligne tenue s'efface, la destination se souligne : c'est tout ce
              // que le geste a besoin de montrer, et ça tient dans deux classes.
              drag.held === line.name && 'opacity-50',
              drag.over === line.name && 'ring-1 ring-accent',
              movable && 'focus-visible:ring-1 focus-visible:ring-accent',
            )}
            title={line.subject}
          >
            <Icon
              size={11}
              className={cx('shrink-0', line.current ? 'text-accent' : 'text-ink-faint opacity-60')}
            />
            <span
              className={cx(
                'min-w-0 truncate text-xs',
                line.current ? 'font-medium text-accent' : 'text-ink',
              )}
            >
              {line.name}
            </span>

            {line.thread ? (
              <button
                type="button"
                onClick={() => line.thread && onOpenThread(line.thread.id)}
                className="flex min-w-0 shrink items-center gap-1 truncate text-micro text-ink-faint hover:text-accent hover:underline"
              >
                <MessagesSquare size={9} className="shrink-0" />
                {line.thread.title}
              </button>
            ) : null}

            <span className="flex-1" />

            {/* Le retard sur l'amont : ce qu'on pousserait, ce qu'on tirerait. */}
            {line.ahead ? (
              <span
                className="flex items-center gap-0.5 text-micro text-ink-faint tabular-nums"
                title={t('git.branches.ahead', { count: line.ahead, upstream: line.upstream ?? '' })}
              >
                <ArrowUp size={9} />
                {line.ahead}
              </span>
            ) : null}
            {line.behind ? (
              <span
                className="flex items-center gap-0.5 text-micro text-ink-faint tabular-nums"
                title={t('git.branches.behind', { count: line.behind, upstream: line.upstream ?? '' })}
              >
                <ArrowDown size={9} />
                {line.behind}
              </span>
            ) : null}

            {menu}
          </div>
        )

        if (!movable) return <div key={line.fullName}>{row(null)}</div>

        return (
          <BranchMenu
            key={line.fullName}
            name={line.name}
            current={line.current}
            upstream={line.upstream}
            threadId={line.thread?.id ?? null}
            worktreePath={line.worktreePath}
            context={menus}
            row={row}
            trigger={
              <button
                type="button"
                aria-label={t('git.menu.branch.label', { name: line.name })}
                className={cx(
                  'flex size-5 shrink-0 items-center justify-center rounded text-ink-faint',
                  'opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
                )}
              >
                <MoreHorizontal size={13} />
              </button>
            }
          />
        )
      })}
    </div>
  )
}
