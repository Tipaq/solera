import { memo, useRef, useState } from 'react'
import { Loader, Plus, Zap } from 'lucide-react'
import { useActions } from '../../lib/actions'
import { useEscapeLayer } from '../../lib/escape-layers'
import { useTranslate } from '../../lib/i18n'
import { ActionList, useActionDialogs } from '../actions/ActionList'
import { Banner, Button, EmptyState, PanelNotice } from '@solera/ui'
import { CommandRunDetail, CommandRunsGroup, useCommandRuns } from './CommandRuns'

/**
 * L'onglet Actions du panneau : les commandes lancées ici en tête (`CommandRuns`), la
 * liste complète, et l'endroit où l'on en crée. Le lanceur de l'en-tête montre la même
 * liste sans quitter ce qu'on regarde.
 *
 * Le détail d'une commande s'ouvre **en pile**, à la place de la liste ; Échap y remonte.
 */
export const ActionsPane = memo(function ActionsPane({ projectId, conversationId }: { projectId: string; conversationId?: string }) {
  const t = useTranslate()
  const { data, error, isPending } = useActions()
  const { handlers, create, dialogs, failure } = useActionDialogs(projectId, conversationId)
  const actions = (data ?? []).filter((action) => action.projectId === projectId)
  const runs = useCommandRuns(projectId, conversationId)
  const [openRun, setOpenRun] = useState<string | null>(null)
  const [runError, setRunError] = useState<string | null>(null)
  const pane = useRef<HTMLDivElement>(null)
  // Un terminal fermé ailleurs ramène à la liste.
  const shown = runs.find((run) => run.terminalId === openRun) ?? null
  useEscapeLayer(shown !== null, () => setOpenRun(null), pane)

  if (shown) {
    return (
      <div ref={pane} className="flex min-h-0 flex-1 flex-col">
        <CommandRunDetail
          key={shown.terminalId}
          projectId={projectId}
          conversationId={conversationId}
          run={shown}
          onBack={() => setOpenRun(null)}
          onRelaunched={setOpenRun}
        />
      </div>
    )
  }

  const runsGroup = (
    <CommandRunsGroup projectId={projectId} runs={runs} onOpen={(run) => setOpenRun(run.terminalId)} onError={setRunError} />
  )

  return (
    <div ref={pane} className="flex min-h-0 flex-1 flex-col">
      {runError ? (
        <PanelNotice tone="critical" onClose={() => setRunError(null)}>
          {runError}
        </PanelNotice>
      ) : null}
      {error ?? failure ? (
        <div className="p-2">
          <Banner>{(error ?? failure)?.message}</Banner>
        </div>
      ) : null}

      {isPending ? (
        <p className="flex items-center gap-1.5 px-3 py-3 text-xs text-ink-faint">
          <Loader size={12} className="animate-spin" />
          {t('actions.loading')}
        </p>
      ) : actions.length === 0 ? (
        <div className="flex min-h-0 flex-1 flex-col">
          {runsGroup}
          <div className="flex min-h-0 flex-1 items-center justify-center p-4">
            <EmptyState
              icon={<Zap size={22} />}
              title={t('actions.empty.title')}
              description={t('actions.empty.description')}
              action={
                <Button size="sm" icon={<Plus size={14} />} onClick={create}>
                  {t('actions.new')}
                </Button>
              }
            />
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          {runsGroup}
          <ActionList projectId={projectId} actions={actions} conversationId={conversationId} handlers={handlers} />
        </div>
      )}

      {actions.length > 0 ? (
        <footer className="flex shrink-0 items-center justify-between gap-2 border-t border-line py-1 pr-1.5 pl-3">
          <p className="min-w-0 truncate text-[0.6875rem] text-ink-faint">
            {t(conversationId ? 'actions.where.worktree' : 'actions.where.root')}
          </p>
          <Button size="sm" variant="ghost" icon={<Plus size={14} />} onClick={create}>
            {t('actions.new')}
          </Button>
        </footer>
      ) : null}

      {dialogs}
    </div>
  )
})
