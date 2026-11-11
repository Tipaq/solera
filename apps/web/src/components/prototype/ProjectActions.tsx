/* PROTOTYPE — jetable (branche proto/page-projet). Ne pas fusionner dans main.
 *
 * Les actions dans l'Aperçu, fidèles à ce qu'elles sont (`protocol/src/actions.ts`) :
 * - un **service** (serveur de dev, worker) tourne sous une unité systemd : il a un état,
 *   des ports, un lien ; c'est lui qu'on oublie allumé ;
 * - une **tâche** (tests, build, seed) se joue dans un terminal du panneau : elle n'a
 *   pas d'historique, seulement son dernier passage tant que l'onglet du terminal est
 *   ouvert ;
 * - une action **proposée** par un agent attend d'être relue avant sa première exécution.
 * Le bloc ne montre donc que ce qui vit ou attend : les services en marche, les tâches
 * en cours, les actions à relire. Le reste est dans le lanceur ⚡ de la bande.
 * Les vraies viennent de `/api/actions` ; en `?demo=1`, un jeu fictif de même forme.
 */
import { ArrowUpRight, ShieldQuestion, SquareTerminal } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import type { ProjectActionDto } from '@solera/protocol'
import { actionView, useActions } from '../../lib/actions'
import { elapsed } from '../../lib/dates'

const MIN = 60_000

function demoActions(projectId: string): ProjectActionDto[] {
  const now = Date.now()
  const base = {
    projectId,
    description: null,
    subdir: null,
    url: null,
    status: 'approved' as const,
    agentConversationId: null,
    agentConversationTitle: null,
    createdAt: now - 30 * 24 * 60 * MIN,
    updatedAt: now - 30 * 24 * 60 * MIN,
    service: null,
    lastRun: null,
  }
  return [
    {
      ...base,
      id: 'demo-dev',
      label: 'Serveur de dev',
      kind: 'service',
      command: 'pnpm dev',
      url: 'http://localhost:{port}',
      service: { unit: 'solera-app-dev', state: 'active', cwd: null, ports: [5173], startedAt: now - 26 * 60 * MIN },
    },
    {
      ...base,
      id: 'demo-tests',
      label: 'Tests unitaires',
      kind: 'task',
      command: 'pnpm test',
      lastRun: { terminalId: 't1', alive: true, exitCode: null, startedAt: now - 2 * MIN },
    },
    {
      ...base,
      id: 'demo-e2e',
      label: 'Suite UI du tableau',
      kind: 'task',
      command: 'pnpm test:board-ui',
      status: 'proposed',
      agentConversationId: 'x',
      agentConversationTitle: 'Revue de la PR #117',
    },
    {
      ...base,
      id: 'demo-storybook',
      label: 'Storybook',
      kind: 'service',
      command: 'pnpm --filter @solera/catalog dev',
      service: { unit: 'solera-app-storybook', state: 'inactive', cwd: null, ports: [], startedAt: null },
    },
  ]
}

/** Ce qui mérite une ligne dans l'Aperçu : ce qui tourne, ou ce qui attend Tim. */
function worthShowing(action: ProjectActionDto): boolean {
  return action.status === 'proposed' || actionView(action).live
}

export function ProjectActionsBlock({ projectId }: { projectId: string }) {
  const [params] = useSearchParams()
  const demo = params.get('demo') === '1'
  const { data } = useActions()
  const all = demo ? demoActions(projectId) : (data ?? []).filter((action) => action.projectId === projectId)
  const shown = all.filter(worthShowing)
  const idle = all.length - shown.length

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-baseline gap-2">
        <h3 className="text-xs font-medium tracking-wide text-ink-faint uppercase">Actions</h3>
        {demo ? <span className="text-meta text-fuchsia-600 dark:text-fuchsia-300">démo</span> : null}
      </div>
      {shown.length === 0 ? (
        <p className="text-sm text-ink-faint">
          {all.length === 0 ? 'Aucune action dans ce projet.' : 'Rien ne tourne.'}{' '}
          <span className="text-ink-faint">Le lanceur ⚡ de la bande les lance.</span>
        </p>
      ) : (
        <ul className="flex flex-col">
          {shown.map((action) => {
            const view = actionView(action)
            const proposed = action.status === 'proposed'
            return (
              <li key={action.id} className="flex min-h-9 items-center gap-2 text-sm">
                <span
                  aria-hidden
                  className={proposed ? 'size-2 shrink-0 rounded-full bg-caution' : 'size-2 shrink-0 animate-pulse rounded-full bg-positive'}
                />
                <span className="min-w-0 truncate">{action.label}</span>
                <span className="min-w-0 truncate text-xs text-ink-faint">
                  {proposed
                    ? `à relire — proposée dans « ${action.agentConversationTitle ?? 'une session supprimée'} »`
                    : action.service
                      ? `service${action.service.ports.length ? ` · :${action.service.ports.join(' :')}` : ''}${action.service.startedAt ? ` · depuis ${elapsed(action.service.startedAt)}` : ''}`
                      : `tâche en cours dans un terminal${action.lastRun ? ` · ${elapsed(action.lastRun.startedAt)}` : ''}`}
                </span>
                {view.href ? (
                  <a href={view.href} target="_blank" rel="noreferrer" className="ml-auto inline-flex shrink-0 items-center gap-0.5 text-xs text-accent hover:underline">
                    Ouvrir <ArrowUpRight size={12} />
                  </a>
                ) : proposed ? (
                  <span className="ml-auto inline-flex shrink-0 items-center gap-1 text-xs text-caution"><ShieldQuestion size={12} /> Relire dans ⚡</span>
                ) : (
                  <span className="ml-auto inline-flex shrink-0 items-center gap-1 text-xs text-ink-faint"><SquareTerminal size={12} /> Panneau</span>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {shown.length > 0 && idle > 0 ? <p className="text-xs text-ink-faint">{idle} autre{idle > 1 ? 's' : ''} au repos, dans le lanceur ⚡.</p> : null}
    </section>
  )
}
