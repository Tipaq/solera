import type { ServiceAppLaunch, ServiceUnits, ServiceUnitState } from '../src/services/apps.js'

/**
 * Les unités d'un systemd simulé, et ce qu'on lui a demandé, dans l'ordre. Un service
 * n'y est qu'une entrée (unité, état, dossier) : aucun processus ne part, aucune unité
 * réelle de la machine n'est touchée.
 *
 * Une unité démarrée écoute sur le `PORT` qu'on lui donne, et sur 5173 sans lui ; avec
 * lui, elle ouvre aussi un port plus bas, comme le rechargement à chaud d'un serveur de
 * dev, pour vérifier que le lien prend le sien.
 */
export function fakeUnits() {
  const units = new Map<string, ServiceUnitState>()
  const launches: ServiceAppLaunch[] = []
  const calls: string[] = []
  const impl: ServiceUnits = {
    available: async () => true,
    scan: async () => [...units.values()],
    start: async (launch) => {
      calls.push(`start ${launch.cwd}`)
      launches.push(launch)
      const port = launch.env.PORT ? Number(launch.env.PORT) : null
      units.set(launch.unit, {
        unit: launch.unit,
        state: 'active',
        cwd: launch.cwd,
        ports: port ? [1024, port] : [5173],
        port,
        startedAt: 1000 + launches.length,
      })
    },
    stop: async (unit) => {
      calls.push('stop')
      units.delete(unit)
    },
    control: async (unit, op) => {
      calls.push(op)
      if (op === 'stop') units.delete(unit)
    },
  }
  return { units, launches, calls, impl }
}
