import type { ReactNode } from 'react'
import { Crosshair, GitBranch, MoreHorizontal, Tag } from 'lucide-react'
import type { GraphNodeDto, GraphRefDto } from '@solera/protocol'
import { relativeDate, shortAge } from '../../../lib/dates'
import { useTranslate } from '../../../lib/i18n'
import { cx } from '@solera/ui'
import { Lanes, laneWidth, ROW_HEIGHT } from './lanes'
import { CommitMenu, type MenuContext } from './menus'

/**
 * Le graphe lui-même : l'en-tête de colonnes et les rangées.
 *
 * **Les colonnes suivent la largeur du panneau**, en requêtes de conteneur et non en
 * `min-width` de fenêtre : un panneau de 30 rem doit se comporter pareil dans une
 * fenêtre de 1 600 px et sur un portable. L'échelle est arrêtée par le tour 4 de
 * `docs/audits/2026-10-15-git/` — Date à 28 rem, Auteur à 36, Sha à 46, Fil à 56, et
 * sous 28 une seule étiquette par commit. Rien ne se règle : la place décide.
 *
 * L'ordre suit l'utilité par pixel dépensé : Date d'abord, étroite et souvent lue ;
 * Sha en dernier, parce qu'on le copie depuis le menu du commit plutôt qu'on ne le lit.
 */

/** Les largeurs des colonnes, partagées par l'en-tête et les rangées. */
const THREAD = 'w-28'
const AUTHOR = 'w-20'
const DATE = 'w-12'
const SHA = 'w-14'

export function GraphHeader({ lanes, hovered, onHead }: {
  lanes: number
  /** Ramène au commit extrait ; absent quand il n'est pas dans la fenêtre chargée. */
  onHead?: () => void
  /**
   * La branche de la course survolée. Écrite ici, dans l'en-tête qui reste collé en
   * haut, plutôt qu'en infobulle : une infobulle native met une seconde à venir, et
   * on survole un trait pour le suivre, pas pour s'arrêter dessus.
   */
  hovered?: { name: string | null; color: string } | null
}) {
  const t = useTranslate()
  return (
    <div className="sticky top-0 z-10 flex items-center gap-2 bg-surface px-2.5 py-1 text-micro font-semibold tracking-wide text-ink-faint uppercase">
      <span className="shrink-0" style={{ width: laneWidth(lanes) }}>
        {t('git.column.graph')}
      </span>
      {hovered ? (
        <span className="flex min-w-0 flex-1 items-center gap-1 normal-case tracking-normal" role="status">
          <GitBranch size={10} className="shrink-0" style={{ color: hovered.color }} />
          <span className="truncate text-ink">{hovered.name ?? t('git.graph.unnamedBranch')}</span>
        </span>
      ) : (
        <span className="min-w-0 flex-1">{t('git.column.message')}</span>
      )}
      <span className={cx('hidden shrink-0 @min-[56rem]:block', THREAD)}>{t('git.column.thread')}</span>
      <span className={cx('hidden shrink-0 @min-[36rem]:block', AUTHOR)}>{t('git.column.author')}</span>
      <span className={cx('hidden shrink-0 @min-[28rem]:block', DATE)}>{t('git.column.date')}</span>
      <span className={cx('hidden shrink-0 @min-[46rem]:block', SHA)}>{t('git.column.sha')}</span>
      {onHead ? (
        <button
          type="button"
          onClick={onHead}
          title={t('git.graph.toHead')}
          aria-label={t('git.graph.toHead')}
          className="flex shrink-0 items-center gap-1 rounded px-1 normal-case tracking-normal text-ink-faint hover:text-accent"
        >
          <Crosshair size={11} />
          <span className="hidden @min-[36rem]:inline">{t('git.graph.head')}</span>
        </button>
      ) : null}
    </div>
  )
}

/** Une étiquette de ref, collée au message comme chez GitKraken. */
export function Ref({ value }: { value: GraphRefDto }) {
  return (
    <span
      className={cx(
        'flex shrink-0 items-center gap-1 rounded px-1 py-px text-micro font-medium',
        value.kind === 'local' && 'bg-accent-wash text-accent',
        value.kind === 'remote' && 'bg-surface-high text-ink-faint',
        value.kind === 'tag' && 'bg-surface-high text-ink-soft',
        value.kind === 'worktree' && 'bg-positive/12 text-positive',
        value.kind === 'head' && 'bg-surface-high text-ink-faint',
      )}
    >
      {value.kind === 'worktree' ? <GitBranch size={9} /> : null}
      {value.kind === 'tag' ? <Tag size={9} /> : null}
      {value.name}
    </span>
  )
}

export function GraphRow({
  node,
  lanes,
  runs,
  onHoverRun,
  selected,
  onSelect,
  menus,
  onOpenThread,
}: {
  node: GraphNodeDto
  lanes: number
  runs: (string | null)[]
  /** La course désignée par le pointeur : celle du commit, ou celle du trait visé. */
  onHoverRun: (run: number | null) => void
  selected: boolean
  onSelect: () => void
  /** De quoi nommer les entrées du menu de ce commit. Voir la règle T0. */
  menus: MenuContext
  onOpenThread: (id: string) => void
}) {
  const t = useTranslate()
  const refs = node.refs.filter((ref) => ref.kind !== 'head')
  const working = node.working

  /**
   * La ligne, écrite une fois et rendue deux : avec son menu, et — pour le nœud « en
   * cours », qui n'est pas un commit — avec une place vide à la sienne.
   */
  const row = (menu: ReactNode) => (
    <div
      className={cx(
        'group flex items-center gap-2 px-2.5',
        selected ? 'bg-accent-wash' : 'hover:bg-surface-high',
      )}
      style={{ height: ROW_HEIGHT }}
      data-hash={node.hash || undefined}
      onPointerEnter={() => onHoverRun(node.run)}
      onPointerLeave={() => onHoverRun(null)}
    >
      <Lanes node={node} lanes={lanes} runs={runs} onHoverRun={(run) => onHoverRun(run ?? node.run)} />

      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
        title={node.kind === 'working' ? undefined : node.subject}
      >
        {refs.map((ref, index) => (
          // Sous 28 rem, une seule étiquette : une deuxième pastille mange le message.
          <span key={ref.name} className={cx('flex', index > 0 && 'hidden @min-[28rem]:flex')}>
            <Ref value={ref} />
          </span>
        ))}
        <span
          className={cx(
            'min-w-0 flex-1 truncate text-xs',
            node.kind === 'working' ? 'font-medium text-ink' : 'text-ink',
          )}
        >
          {working
            ? t('git.graph.working', {
                files: working.files,
                added: working.added,
                removed: working.removed,
              })
            : node.subject}
        </span>
      </button>

      {node.thread ? (
        <button
          type="button"
          onClick={() => node.thread && onOpenThread(node.thread.id)}
          title={node.thread.sure ? node.thread.title : t('git.thread.guessed', { title: node.thread.title })}
          className={cx(
            'hidden shrink-0 truncate text-left text-micro text-accent hover:underline @min-[56rem]:block',
            THREAD,
            !node.thread.sure && 'opacity-70',
          )}
        >
          {node.thread.title}
        </button>
      ) : (
        <span className={cx('hidden shrink-0 @min-[56rem]:block', THREAD)} />
      )}

      {/* L'agent plutôt que l'auteur git quand il y en a un : ici l'auteur est
          l'utilisateur dans les deux cas, et ce qui renseigne est qui a écrit. */}
      <span
        className={cx('hidden shrink-0 truncate text-micro text-ink-faint @min-[36rem]:block', AUTHOR)}
        title={node.agent ? t('git.author.agent', { agent: node.agent, author: node.author }) : node.author}
      >
        {node.agent ?? node.author}
      </span>
      {/* L'ancienneté en deux caractères et une unité, pas la phrase : « il y a trois
          semaines » ne tient pas dans une colonne qui doit entrer dès 28 rem. La
          phrase entière est dans l'infobulle, et la date exacte dans le détail. */}
      <span
        className={cx('hidden shrink-0 truncate text-micro text-ink-faint tabular-nums @min-[28rem]:block', DATE)}
        title={node.kind === 'working' ? undefined : relativeDate(node.ts)}
      >
        {node.kind === 'working' ? '' : shortAge(node.ts)}
      </span>
      <span
        className={cx('hidden shrink-0 truncate font-mono text-micro text-ink-faint @min-[46rem]:block', SHA)}
      >
        {node.shortHash}
      </span>

      {menu}
    </div>
  )

  // Le menu du commit : douze entrées, et c'est ce qui permet à la barre d'outils de
  // n'en avoir que huit (règle T0). Le nœud « en cours » n'en a pas — il n'est pas un
  // commit, et ses gestes sont ceux d'*En cours* ; sa ligne n'a donc pas non plus de
  // clic droit, qui ouvrirait le menu d'un objet qui n'existe pas.
  if (node.kind === 'working') return row(<span className="size-5 shrink-0" />)

  return (
    <CommitMenu
      hash={node.hash}
      shortHash={node.shortHash}
      threadId={node.thread?.id ?? null}
      context={menus}
      row={row}
      trigger={
        <button
          type="button"
          aria-label={t('git.menu.commit.label', { subject: node.subject })}
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
}
