import { Cpu, MemoryStick } from 'lucide-react'
import type { SystemLoadDto } from '@solera/protocol'
import { cx } from '@solera/ui'
import { formatBytes } from '../../lib/attachments'
import { useTranslate } from '../../lib/i18n'

/**
 * La machine, en tête de la page des services : ce qu'il reste de processeur et de
 * mémoire, et la part qu'y prend ce que Solera fait tourner.
 *
 * La mémoire est une barre empilée : chaque gros consommateur a son segment, le reste
 * des services un seul, puis tout ce qui tourne hors Solera, puis ce qui est
 * disponible. On voit d'un coup d'œil si c'est Solera qui remplit la machine, et lequel
 * de ses services. Le processeur suit la même lecture, en deux parts : Solera, le reste.
 */

/** Une entrée qui pèse : un service, une app ou un agent, avec ce qu'il consomme. */
export interface LoadConsumer {
  id: string
  label: string
  memoryBytes: number
  /** Part d'un cœur ; null tant qu'il n'y a pas eu deux mesures. */
  cpu: number | null
}

/** Les consommateurs nommés dans la barre ; au-delà, ils se fondent en un seul segment. */
const NAMED = 4

/**
 * Des teintes de l'accent, de la plus soutenue à la plus pâle : les segments se
 * distinguent sans qu'une couleur d'état (rouge, orange) laisse croire à une alerte.
 */
const SHADES = ['bg-accent', 'bg-accent/75', 'bg-accent/55', 'bg-accent/40']
const OTHERS_SHADE = 'bg-accent/25'
const OUTSIDE_SHADE = 'bg-ink-faint/45'

function toneOf(ratio: number): string {
  if (ratio >= 0.9) return 'text-critical'
  if (ratio >= 0.75) return 'text-caution'
  return 'text-ink'
}

export function SystemLoad({ system, consumers }: { system: SystemLoadDto; consumers: LoadConsumer[] }) {
  const t = useTranslate()
  const used = Math.max(0, system.memoryTotal - system.memoryAvailable)
  const ranked = [...consumers].sort((a, b) => b.memoryBytes - a.memoryBytes)
  const named = ranked.slice(0, NAMED).filter((entry) => entry.memoryBytes > 0)
  const othersBytes = ranked.slice(NAMED).reduce((sum, entry) => sum + entry.memoryBytes, 0)
  const soleraBytes = named.reduce((sum, entry) => sum + entry.memoryBytes, 0) + othersBytes
  // La mémoire des services est comptée en RSS : elle peut dépasser l'« utilisé » du
  // noyau d'un cheveu (pages partagées). Le reste de la machine ne descend pas sous zéro.
  const outsideBytes = Math.max(0, used - soleraBytes)
  const share = (bytes: number) => `${(bytes / system.memoryTotal) * 100}%`
  const memoryRatio = used / system.memoryTotal

  const soleraCpu = consumers.reduce((sum, entry) => sum + (entry.cpu ?? 0), 0) / system.cores
  const machineCpu = system.cpu
  const outsideCpu = machineCpu === null ? null : Math.max(0, machineCpu - soleraCpu)
  const swapUsed = system.swapTotal - system.swapFree

  return (
    <section aria-label={t('services.system.title')} className="grid gap-4 rounded-lg border border-line bg-surface p-4 md:grid-cols-[1fr_1.6fr] md:gap-6">
      <div className="flex min-w-0 flex-col gap-2">
        <div className="flex items-baseline gap-2">
          <Cpu size={14} className="shrink-0 self-center text-ink-faint" aria-hidden />
          <span className="text-xs font-medium text-ink-soft">{t('services.system.cpu')}</span>
          <span className={cx('ml-auto text-lg font-semibold tabular-nums', machineCpu === null ? 'text-ink-faint' : toneOf(machineCpu))}>
            {machineCpu === null ? '—' : `${Math.round(machineCpu * 100)} %`}
          </span>
        </div>
        <div className="flex h-2.5 overflow-hidden rounded-full bg-surface-high" role="img"
          aria-label={t('services.system.cpuBar', { solera: Math.round(soleraCpu * 100), total: Math.round((machineCpu ?? 0) * 100) })}>
          <div className="h-full bg-accent" style={{ width: `${Math.min(soleraCpu, 1) * 100}%` }} />
          <div className={cx('h-full', OUTSIDE_SHADE)} style={{ width: `${Math.min(outsideCpu ?? 0, 1) * 100}%` }} />
        </div>
        <p className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-ink-faint">
          <Legend shade="bg-accent" label={t('services.system.solera')} value={`${Math.round(soleraCpu * 100)} %`} />
          <span className="tabular-nums">
            {t('services.system.cores', { cores: system.cores })} · {t('services.system.load', { load: system.load.map((value) => value.toFixed(1)).join(' · ') })}
          </span>
        </p>
      </div>

      <div className="flex min-w-0 flex-col gap-2">
        <div className="flex items-baseline gap-2">
          <MemoryStick size={14} className="shrink-0 self-center text-ink-faint" aria-hidden />
          <span className="text-xs font-medium text-ink-soft">{t('services.system.memory')}</span>
          <span className="ml-auto text-xs text-ink-faint tabular-nums">
            <span className={cx('text-lg font-semibold', toneOf(memoryRatio))}>{formatBytes(used)}</span>
            {' '}/ {formatBytes(system.memoryTotal)}
          </span>
        </div>
        <div className="flex h-2.5 gap-px overflow-hidden rounded-full bg-surface-high" role="img"
          aria-label={t('services.system.memoryBar', { solera: formatBytes(soleraBytes), available: formatBytes(system.memoryAvailable) })}>
          {named.map((entry, index) => (
            <div key={entry.id} title={`${entry.label} · ${formatBytes(entry.memoryBytes)}`}
              className={cx('h-full', SHADES[index])} style={{ width: share(entry.memoryBytes) }} />
          ))}
          {othersBytes > 0 ? <div title={t('services.system.otherServices')} className={cx('h-full', OTHERS_SHADE)} style={{ width: share(othersBytes) }} /> : null}
          <div title={t('services.system.outside')} className={cx('h-full', OUTSIDE_SHADE)} style={{ width: share(outsideBytes) }} />
        </div>
        <p className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-ink-faint">
          {named.map((entry, index) => (
            <Legend key={entry.id} shade={SHADES[index]!} label={entry.label} value={formatBytes(entry.memoryBytes)} />
          ))}
          {othersBytes > 0 ? <Legend shade={OTHERS_SHADE} label={t('services.system.otherServices')} value={formatBytes(othersBytes)} /> : null}
          <Legend shade={OUTSIDE_SHADE} label={t('services.system.outside')} value={formatBytes(outsideBytes)} />
          <Legend shade="bg-surface-high ring-1 ring-line" label={t('services.system.available')} value={formatBytes(system.memoryAvailable)} />
          {swapUsed > 0 ? <span className="tabular-nums">{t('services.system.swap', { used: formatBytes(swapUsed), total: formatBytes(system.swapTotal) })}</span> : null}
        </p>
      </div>
    </section>
  )
}

function Legend({ shade, label, value }: { shade: string; label: string; value: string }) {
  return (
    <span className="flex min-w-0 max-w-full items-center gap-1.5">
      <span aria-hidden className={cx('size-2 shrink-0 rounded-sm', shade)} />
      <span className="min-w-0 truncate">{label}</span>
      <span className="shrink-0 tabular-nums text-ink-soft">{value}</span>
    </span>
  )
}
