import { Link } from 'react-router-dom'
import type { JournalEntryDto, ProjectDto } from '@solera/protocol'
import { Button, cx } from '@solera/ui'
import { formatBytes, pluralOf } from '../../lib/code-model'
import { shortAge } from '../../lib/dates'
import { locale, useLocale, useTranslate } from '../../lib/i18n'
import type { JournalDay } from '../../lib/journal'
import type { WorkCleanOffer, WorkTree } from '../../lib/portfolio-work'
import { sizeOf } from '../../lib/travail-clean'
import { AgentIcon } from '../AgentIcon'
import { PrTag } from '../code/PrTag'
import { REASON_TONE, VerdictDot, verdictReason } from '../code/VerdictDot'
import { JOURNAL_KIND_ICONS, journalDestination, journalIconTone } from '../journal/JournalView'
import { ProjectAvatar } from '../ProjectAvatar'
import { ProjectPip } from '../places/ProjectPip'
import { SectionTitle } from '../places/SectionTitle'
import { CleanChooser } from './PortfolioClean'

type WorkProject = Pick<ProjectDto, 'id' | 'name' | 'image' | 'color'>
type Tree = WorkTree<ProjectDto>

/*
 * Les pièces de Travail au portefeuille (#238, `coque.md` PF-17 à PF-21) : la ligne d'un
 * arbre, le repli des fusionnés et le fil Par moment. La page les range ; ici rien ne lit
 * le serveur.
 */

/** Les colonnes du Tableau (PF-18), au-delà de `md` ; la vue Par projet n'a pas la colonne Projet. */
const GRID = {
  table: 'md:grid md:grid-cols-[0.5rem_10rem_minmax(0,1fr)_6rem_5rem_5rem_5rem_4rem] md:items-center md:gap-x-4',
  group: 'md:grid md:grid-cols-[0.5rem_minmax(0,1fr)_6rem_5rem_5rem_5rem_4rem] md:items-center md:gap-x-4',
}

/** L'adresse d'un arbre dans Travail de son projet (PF-21). */
export function treeHref(tree: Tree): string {
  return `/p/${tree.project.id}/travail?arbre=${encodeURIComponent(tree.key)}`
}

/**
 * Les arbres en lignes : bordées sous l'en-tête d'un projet (`group`), ou en une seule
 * table avec la colonne Projet et ses en-têtes (`table`). Au téléphone, la ligne s'empile.
 */
export function WorkTreeList({ trees, mode }: { trees: Tree[]; mode: 'group' | 'table' }) {
  const t = useTranslate()
  if (trees.length === 0) return null
  return (
    <div className="flex flex-col">
      {mode === 'table' ? (
        <div aria-hidden className={cx('hidden border-b border-line px-3 pb-2 text-meta font-medium tracking-wide text-ink-faint uppercase', GRID.table)}>
          <span />
          <span>{t('portfolio.toolbar.project')}</span>
          <span>{t('travail.table.branch')}</span>
          <span>{t('travail.table.sessions')}</span>
          <span>{t('travail.table.pr')}</span>
          <span>{t('travail.table.base')}</span>
          <span>{t('travail.table.disk')}</span>
          <span className="text-right">{t('travail.table.seen')}</span>
        </div>
      ) : null}
      <ul className={cx('divide-y divide-line', mode === 'group' && 'rounded-xl border border-line')}>
        {trees.map((tree) => (
          <WorkTreeLine key={`${tree.project.id}:${tree.key}`} tree={tree} withProject={mode === 'table'} />
        ))}
      </ul>
    </div>
  )
}

/** Une ligne : toute entière un lien vers l'arbre, dans Travail de son projet. */
function WorkTreeLine({ tree, withProject }: { tree: Tree; withProject: boolean }) {
  const t = useTranslate()
  const lang = useLocale()
  const name = tree.branch ?? tree.name
  const facts = [
    tree.card ? `#${tree.card.number} ${tree.card.title}` : null,
    tree.card?.milestone ? t('code.milestone', { number: tree.card.milestone.number }) : null,
  ].filter(Boolean)
  return (
    <li data-work-tree={`${tree.project.id}:${tree.key}`}>
      <Link
        to={treeHref(tree)}
        className={cx(
          'flex min-h-11 w-full flex-col gap-1 px-3 py-2.5 text-left transition-colors hover:bg-surface-high/40 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent',
          withProject ? GRID.table : GRID.group,
        )}
      >
        <VerdictDot verdict={tree.verdict} className="hidden md:block" />
        {withProject ? <ProjectPip project={tree.project} plain /> : null}
        <span className="flex min-w-0 flex-col">
          <span className="flex min-w-0 items-center gap-2">
            <VerdictDot verdict={tree.verdict} className="md:hidden" />
            <span className="truncate font-mono text-xs text-ink">
              {tree.root ? t('portfolio.work.root', { branch: name }) : name}
            </span>
          </span>
          <span className="truncate text-xs text-ink-faint">
            {/* La raison seule, teintée : le mot du verdict la répéterait (« En cours · En cours : … »). */}
            <span className={REASON_TONE[tree.verdict]}>{verdictReason(t, tree.reason)}</span>
            {facts.map((fact) => ` · ${fact}`).join('')}
          </span>
        </span>
        {/* Au téléphone, les faits passent en une rangée sous le titre. */}
        <span className="flex flex-wrap items-center gap-x-4 gap-y-1 pl-4 text-xs tabular-nums text-ink-faint md:contents">
          <span className={cx('items-center gap-1', tree.sessions.length > 0 ? 'flex' : 'hidden md:flex')}>
            {tree.sessions.map((session) => (
              <AgentIcon key={session.id} agent={session.agent} size={13} />
            ))}
          </span>
          {/* Le numéro seul, sans lien : la ligne en est déjà un. */}
          <span>{tree.pr ? <PrTag pr={{ ...tree.pr, url: null }} compact /> : <span aria-hidden>—</span>}</span>
          <span>
            {tree.root ? (
              tree.uncommitted > 0 ? (
                <span className="text-caution" title={t(`code.drift.dirty.${pluralOf(tree.uncommitted)}`, { count: tree.uncommitted })}>
                  ●{tree.uncommitted}
                </span>
              ) : (
                '—'
              )
            ) : (
              <span title={`${t(`code.drift.ahead.${pluralOf(tree.ahead)}`, { count: tree.ahead })} · ${t(`code.drift.behind.${pluralOf(tree.behind)}`, { count: tree.behind })}`}>
                ↑{tree.ahead} ↓{tree.behind}
              </span>
            )}
          </span>
          <span title={t('code.size')}>{tree.sizeBytes !== null ? formatBytes(tree.sizeBytes, lang) : '—'}</span>
          <span className="md:text-right">{tree.lastUsedAt ? shortAge(tree.lastUsedAt) : ''}</span>
        </span>
      </Link>
    </li>
  )
}

/**
 * Le repli des arbres fusionnés (PF-17) : leur nombre, leur place, « rien à perdre », et
 * « Nettoyer », qui ne propose que ceux-là, projet par projet.
 */
export function WorkFolded({ trees, offers }: { trees: Tree[]; offers: WorkCleanOffer<ProjectDto>[] }) {
  const t = useTranslate()
  const lang = useLocale()
  if (trees.length === 0) return null
  const bytes = sizeOf(trees)
  const targets = offers.flatMap((offer) => {
    const mine = trees.filter((tree) => tree.project.id === offer.project.id && tree.id !== null)
    return mine.length > 0 ? [{ ...offer, request: { trees: mine, branches: [] }, count: mine.length }] : []
  })
  return (
    <div data-work-folded className="flex min-h-11 items-center gap-2 px-3 py-1 text-xs text-ink-faint">
      <span aria-hidden className="size-2 shrink-0 rounded-full bg-positive/60" />
      <span className="min-w-0 truncate">
        {[t(`travail.cleanup.toggle.${pluralOf(trees.length)}`, { count: trees.length }), bytes !== null ? formatBytes(bytes, lang) : null, t('travail.cleanup.nothingLost')]
          .filter(Boolean)
          .join(' · ')}
      </span>
      <CleanChooser
        targets={targets}
        trigger={(open) => (
          <Button size="sm" variant="ghost" onClick={open} className="shrink-0">
            {t('travail.cleanup.action')}
          </Button>
        )}
      />
    </div>
  )
}

/** Le jour d'un groupe, écrit en entier dans la langue de l'app : « lundi 10 novembre ». */
function dayTitle(at: number): string {
  return new Intl.DateTimeFormat(locale(), { weekday: 'long', day: 'numeric', month: 'long' }).format(at)
}

/**
 * Par moment (PF-19) : le fil de tous les projets, par jour. Une ligne : l'heure, la
 * nature, le titre, puis le projet (son nom à partir de `sm`) ; elle mène où l'événement
 * mène, quand il mène quelque part.
 */
export function WorkMoments({ days, projects }: { days: JournalDay[]; projects: ReadonlyMap<string, WorkProject> }) {
  const t = useTranslate()
  if (days.length === 0) return <p className="text-sm text-ink-faint">{t('portfolio.work.emptyPeriod')}</p>
  const time = new Intl.DateTimeFormat(locale(), { hour: '2-digit', minute: '2-digit' })
  return (
    <div className="flex flex-col gap-5">
      {days.map((day) => (
        <section key={day.at} data-work-day className="flex flex-col gap-1">
          <SectionTitle count={day.entries.length}>
            <span className="inline-block first-letter:uppercase">{dayTitle(day.at)}</span>
          </SectionTitle>
          <ul className="flex flex-col border-l border-line pl-3">
            {day.entries.map((entry) => (
              <MomentLine key={entry.id} entry={entry} project={projects.get(entry.projectId)} time={time.format(entry.at)} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

function MomentLine({ entry, project, time }: { entry: JournalEntryDto; project: WorkProject | undefined; time: string }) {
  const to = journalDestination(entry)
  const body = (
    <>
      <span className="w-11 shrink-0 text-xs tabular-nums text-ink-faint">{time}</span>
      <span aria-hidden className={cx('flex shrink-0', journalIconTone(entry))}>
        {JOURNAL_KIND_ICONS[entry.kind]}
      </span>
      <span className="min-w-0 flex-1 truncate text-sm">{entry.title}</span>
      {project ? (
        <span className="inline-flex shrink-0 items-center gap-1.5 text-xs text-ink-faint" title={project.name}>
          <ProjectAvatar project={project} className="size-3.5" />
          <span className="hidden max-w-40 truncate sm:inline">{project.name}</span>
        </span>
      ) : null}
    </>
  )
  const shape = 'flex min-h-9 items-center gap-2.5 rounded-md px-2 pointer-coarse:min-h-11'
  return (
    <li>
      {to ? (
        <Link to={to} className={cx(shape, 'transition-colors hover:bg-surface-high/60 focus-visible:outline-2 focus-visible:outline-accent')}>
          {body}
        </Link>
      ) : (
        <div className={shape}>{body}</div>
      )}
    </li>
  )
}
