import { Link } from 'react-router-dom'
import { EmptyState, cx } from '@solera/ui'
import { Target } from 'lucide-react'
import { ProjectAvatar } from '../components/ProjectAvatar'
import { useTranslate } from '../lib/i18n'
import { WORK_DOTS, WORK_LABELS, useWorkGroups, type WorkItem } from '../lib/portfolio'

/**
 * *Travail* : toutes les cartes qui réclament une personne, tous projets confondus.
 *
 * C'est l'écran qui répond à « par quoi je m'y remets ? » quand on suit cinq projets, et
 * c'est pourquoi il est **groupé par ce que les cartes demandent** et non par colonne —
 * sans quoi il redirait le board global, qui est l'onglet d'à côté.
 *
 * Il ne montre que ce qui réclame : une carte qu'aucune session ne touche et qui dort en
 * *À faire* n'est pas du travail en cours, c'est un inventaire, et un inventaire ne
 * demande rien à personne. Le groupe vide disparaît, comme une tuile à zéro.
 *
 * Référence : `docs/audits/2026-10-14-gestion-de-projet/final/pages/`, écran F7.
 */
export function PortfolioWorkPage() {
  const t = useTranslate()
  const { groups, total, isPending } = useWorkGroups()

  if (isPending && total === 0) return null

  if (total === 0) {
    return (
      <div className="h-full overflow-y-auto p-4 md:p-6">
        <EmptyState
          icon={<Target size={22} />}
          title={t('portfolio.work.empty')}
          description={t('portfolio.work.emptyHint')}
        />
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto p-4 md:p-6">
      <div className="flex flex-col gap-5">
        {groups.map((group) =>
          group.items.length === 0 ? null : (
            <section key={group.kind} className="flex min-w-0 flex-col gap-1.5">
              <h2 className="flex items-center gap-2 px-1 text-sm text-ink-soft">
                <span aria-hidden className={cx('size-2 shrink-0 rounded-full', WORK_DOTS[group.kind])} />
                <span className="min-w-0 flex-1 truncate">{t(WORK_LABELS[group.kind])}</span>
                <span className="shrink-0 rounded-md bg-surface-high px-1.5 py-0.5 text-meta tabular-nums text-ink-faint">
                  {group.items.length}
                </span>
              </h2>
              <ul className="flex flex-col gap-1.5">
                {group.items.map((item) => (
                  <WorkRow key={item.card.id} item={item} />
                ))}
              </ul>
            </section>
          ),
        )}
      </div>
    </div>
  )
}

/**
 * Une ligne de travail : le projet, le numéro, le titre, puis l'état à droite.
 *
 * En lignes et non en tuiles, pour la raison du catalogue : dès qu'on compare, l'œil
 * descend une colonne alignée plutôt que de refaire le chemin dans chaque carte. Ici on
 * compare bien — c'est une file d'attente, pas un board.
 */
function WorkRow({ item }: { item: WorkItem }) {
  const t = useTranslate()
  const { card, sessions, awaiting, running } = item

  return (
    <li>
      <Link
        to={`/p/${card.projectId}/board?carte=${card.number}`}
        className={cx(
          'flex min-h-12 min-w-0 flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-line px-3.5 py-2',
          'transition-colors hover:border-line-strong focus-visible:outline-2 focus-visible:outline-accent',
        )}
      >
        {/* La colonne du projet est la même largeur sur chaque ligne : c'est ce qui rend
            la file lisible de haut en bas quand elle mêle cinq projets. */}
        <span className="flex w-32 min-w-0 shrink-0 items-center gap-2">
          <ProjectAvatar project={card.project} className="size-4 shrink-0" />
          <span className="min-w-0 truncate text-xs text-ink-faint">{card.project.name}</span>
        </span>
        <span className="shrink-0 text-xs tabular-nums text-ink-faint">#{card.number}</span>
        <span className="min-w-0 flex-1 truncate text-sm">{card.title}</span>
        <span className="shrink-0 text-xs text-ink-faint">
          {awaiting
            ? t('portfolio.work.state.awaiting', { count: sessions })
            : running
              ? t('portfolio.work.state.running', { count: sessions })
              : sessions > 0
                ? t('portfolio.work.state.sessions', { count: sessions })
                : t('portfolio.work.state.none')}
        </span>
      </Link>
    </li>
  )
}
