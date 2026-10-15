import {
  ArrowDown,
  ArrowUp,
  Boxes,
  ChevronDown,
  Cloud,
  GitBranch,
  Loader,
  MessagesSquare,
  MoreHorizontal,
  Tag,
} from 'lucide-react'
import type { RefSectionDto } from '@solera/protocol'
import { useTranslate } from '../../../lib/i18n'
import type { WorkspaceScope } from '../../../lib/workspace-scope'
import { Banner, cx } from '@solera/ui'
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
 */
const ICONS = {
  local: GitBranch,
  worktrees: GitBranch,
  remote: Cloud,
  tags: Tag,
  submodules: Boxes,
} as const

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

  return (
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
          onOpenThread={onOpenThread}
        />
      ))}
    </div>
  )
}

const sectionKey = (section: RefSectionDto): string =>
  section.remote ? `${section.kind}:${section.remote}` : section.kind

function Section({
  section,
  menus,
  onOpenThread,
}: {
  section: RefSectionDto
  menus: MenuContext
  onOpenThread: (id: string) => void
}) {
  const t = useTranslate()
  const Icon = ICONS[section.kind]

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

      {section.lines.map((line) => (
        <div
          key={line.fullName}
          className={cx(
            'group flex items-center gap-1.5 rounded px-1.5 py-1',
            line.current && 'bg-accent-wash',
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

          {section.kind === 'local' || section.kind === 'worktrees' ? (
            <BranchMenu
              name={line.name}
              current={line.current}
              upstream={line.upstream}
              threadId={line.thread?.id ?? null}
              worktreePath={line.worktreePath}
              context={menus}
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
          ) : null}
        </div>
      ))}
    </div>
  )
}
