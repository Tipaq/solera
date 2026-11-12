import type { ReactNode } from 'react'
import type { ProjectDto } from '@solera/protocol'
import { cx } from '@solera/ui'
import type { StatusOf } from '../../lib/card-state'
import { useTranslate } from '../../lib/i18n'
import { horizonSections, maturityCounts } from '../../lib/milestone-horizon'
import { MATURITIES, type MilestoneEntry } from '../../lib/milestone-model'
import type { Zoom } from '../gantt/scale'
import { CapBlock } from './CapBlock'
import { MilestoneAxis } from './MilestoneAxis'
import { WaveTiles } from './WaveTiles'

/**
 * L'**Horizon** des Jalons (CAP, HOR) : le cap du projet, la chaîne des maturités, puis
 * ses jalons — le présent sur un axe daté, le futur en tuiles sans dates.
 *
 * Le futur n'a pas de dates parce qu'on n'en a pas : un jalon qui n'est pas découpé n'a
 * ni durée ni début. On le range donc par maturité et par ordre du tableau, sans inventer.
 *
 * `entries` arrivent filtrés par la barre : les comptes de la chaîne suivent le filtre.
 */
export function Horizon({
  project,
  entries,
  zoom,
  statusOf,
}: {
  project: Pick<ProjectDto, 'id' | 'cap'>
  entries: MilestoneEntry[]
  zoom: Zoom
  statusOf?: StatusOf
}) {
  const t = useTranslate()
  const { now, next, later } = horizonSections(entries)
  const counts = maturityCounts(entries)
  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <CapBlock project={project} />

      <ol aria-label={t('milestones.horizon.chain')} className="grid grid-cols-3 gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-6">
        {MATURITIES.map((maturity, index) => (
          <li key={maturity} className="flex flex-col gap-0.5 bg-canvas px-3 py-2">
            <span className="flex items-center gap-1.5 text-xs text-ink-faint">
              <span className="tabular-nums">{index + 1}</span>
              {t(`milestones.maturity.label.${maturity}`)}
            </span>
            <span className={cx('text-lg font-semibold tabular-nums', counts[maturity] ? 'text-ink' : 'text-ink-faint/50')}>{counts[maturity]}</span>
          </li>
        ))}
      </ol>

      <Section title={t('milestones.horizon.now')} hint={t('milestones.horizon.nowHint')}>
        {now.length === 0 ? (
          <Quiet>{t('milestones.horizon.nowEmpty')}</Quiet>
        ) : (
          <MilestoneAxis projectId={project.id} entries={now} zoom={zoom} statusOf={statusOf} />
        )}
      </Section>

      <Section title={t('milestones.horizon.next')} hint={t('milestones.horizon.nextHint')}>
        {next.length === 0 ? <Quiet>{t('milestones.horizon.nextEmpty')}</Quiet> : <WaveTiles projectId={project.id} entries={next} />}
      </Section>

      <Section title={t('milestones.horizon.later')} hint={t('milestones.horizon.laterHint')}>
        {later.length === 0 ? <Quiet>{t('milestones.horizon.laterEmpty')}</Quiet> : <WaveTiles projectId={project.id} entries={later} />}
      </Section>
    </div>
  )
}

function Section({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
        <span className="text-xs text-ink-faint">{hint}</span>
      </div>
      {children}
    </section>
  )
}

function Quiet({ children }: { children: ReactNode }) {
  return <p className="rounded-xl border border-dashed border-line px-3.5 py-3 text-sm text-ink-faint">{children}</p>
}
