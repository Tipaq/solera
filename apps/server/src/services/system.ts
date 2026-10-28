import { readFile } from 'node:fs/promises'
import { availableParallelism, loadavg } from 'node:os'
import type { SystemLoadDto } from '@solera/protocol'

/**
 * La charge de la machine, lue dans `/proc` : de quoi dire, à côté des services, si un
 * de plus tient encore.
 *
 * Le CPU ne se lit qu'entre deux mesures : `/proc/stat` cumule les temps depuis le
 * démarrage. La mesure précédente est gardée ici ; la toute première attend un court
 * instant pour en prendre une seconde, plutôt que d'afficher une jauge vide à
 * l'ouverture de la page.
 */

interface CpuSample { busy: number; total: number }

let previous: CpuSample | undefined

async function sampleCpu(): Promise<CpuSample> {
  const line = (await readFile('/proc/stat', 'utf8')).split('\n', 1)[0] ?? ''
  const values = line.trim().split(/\s+/).slice(1).map(Number)
  // user nice system idle iowait irq softirq steal : l'attente disque compte comme repos.
  const idle = (values[3] ?? 0) + (values[4] ?? 0)
  const total = values.slice(0, 8).reduce((sum, value) => sum + value, 0)
  return { busy: total - idle, total }
}

function meminfo(text: string, key: string): number {
  return Number(new RegExp(`^${key}:\\s+(\\d+)`, 'm').exec(text)?.[1] ?? 0) * 1024
}

export async function readSystemLoad(): Promise<SystemLoadDto> {
  if (!previous) {
    previous = await sampleCpu()
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  const [current, memory] = await Promise.all([sampleCpu(), readFile('/proc/meminfo', 'utf8')])
  const elapsed = current.total - previous.total
  const cpu = elapsed > 0 ? Math.min(1, Math.max(0, (current.busy - previous.busy) / elapsed)) : null
  previous = current
  const [one, five, fifteen] = loadavg()
  return {
    cpu,
    cores: availableParallelism(),
    load: [one ?? 0, five ?? 0, fifteen ?? 0],
    memoryTotal: meminfo(memory, 'MemTotal'),
    memoryAvailable: meminfo(memory, 'MemAvailable'),
    swapTotal: meminfo(memory, 'SwapTotal'),
    swapFree: meminfo(memory, 'SwapFree'),
  }
}
