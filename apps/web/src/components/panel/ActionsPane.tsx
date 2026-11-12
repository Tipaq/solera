import { memo, useRef, useState } from 'react'
import type { ProjectActionDto } from '@solera/protocol'
import { Loader, Plus, Zap } from 'lucide-react'
import type { EditorSeed } from '../../lib/action-editor'
import { useActions } from '../../lib/actions'
import { detailPanel, newActionPanel, panelItem, type ActionPanel } from '../../lib/action-panel'
import { actionAutomationId, fromAction } from '../../lib/automations'
import { useAutomations } from '../../lib/automations-query'
import { useEscapeLayer } from '../../lib/escape-layers'
import { useTranslate } from '../../lib/i18n'
import { ActionList, useActionDialogs, type ActionHandlers } from '../actions/ActionList'
import { ActionDrawer, panelShows } from '../automations/ActionDrawer'
import { Banner, Button, EmptyState, PanelNotice } from '@solera/ui'
import { useSessionWorks } from '../../lib/session-works-query'
import { SessionWorksSection } from '../automations/session-works/SessionWorksSection'
import { CommandRunDetail, CommandRunsGroup, useCommandRuns } from './CommandRuns'

/**
 * L'onglet Actions du panneau : les commandes lancées ici en tête (`CommandRuns`), la
 * liste complète, et l'endroit où l'on en crée. Le point du bouton du panneau dit, de
 * l'en-tête, ce qui y tourne et ce qui y attend.
 *
 * Le détail d'une commande lancée, celui d'une action, son édition et sa relecture
 * s'ouvrent **en pile**, à la place de la liste (`ActionDrawer`) ; Échap y remonte.
 */
export const ActionsPane = memo(function ActionsPane({ projectId, conversationId }: { projectId: string; conversationId?: string }) {
  const t = useTranslate()
  const { data, error, isPending } = useActions()
  const dialogs = useActionDialogs(projectId, conversationId)
  const { dialogs: hosted, failure } = dialogs
  const actions = (data ?? []).filter((action) => action.projectId === projectId)
  const { items, isPending: itemsPending } = useAutomations({ projectId })
  const [panel, setPanel] = useState<ActionPanel | null>(null)
  // Une action supprimée ailleurs referme son détail, sans le rouvrir si elle revenait.
  if (panel && !itemsPending && !panelShows(panel, items)) setPanel(null)
  const detail = (action: ProjectActionDto, review = false) => detailPanel(actionAutomationId(action.id), review)
  const handlers: ActionHandlers = {
    ...dialogs.handlers,
    onOpen: (action) => setPanel(detail(action)),
    onReview: (action) => setPanel(detail(action, true)),
    onEdit: (action) => setPanel({ mode: 'edit', seed: { from: panelItem(detail(action), items) ?? fromAction(action) }, back: null }),
  }
  const create = () => setPanel(newActionPanel('any'))
  // « En faire une action » : l'éditeur pré-rempli, en pile lui aussi.
  const createFrom = (seed: EditorSeed) => setPanel({ mode: 'edit', seed, back: null })
  const runs = useCommandRuns(projectId, conversationId)
  const works = useSessionWorks(projectId, { conversationId })
  const [openRun, setOpenRun] = useState<string | null>(null)
  const [runError, setRunError] = useState<string | null>(null)
  const pane = useRef<HTMLDivElement>(null)
  // Un terminal fermé ailleurs ramène à la liste.
  const shown = runs.find((run) => run.terminalId === openRun) ?? null
  useEscapeLayer(shown !== null, () => setOpenRun(null), pane)

  if (panelShows(panel, items)) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <ActionDrawer
          projectId={projectId}
          items={items}
          panel={panel}
          onPanel={setPanel}
          onClose={() => setPanel(null)}
          conversationId={conversationId}
        />
        {hosted}
      </div>
    )
  }

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

  // En tête : ce qui tourne — les commandes lancées ici, puis les processus des sessions (PACT-2).
  const runsGroup = (
    <>
      <CommandRunsGroup projectId={projectId} runs={runs} onOpen={(run) => setOpenRun(run.terminalId)} onError={setRunError} />
      <SessionWorksSection
        projectId={projectId}
        works={works}
        variant="compact"
        currentConversationId={conversationId}
        onMakeAction={createFrom}
        onError={setRunError}
      />
    </>
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

      {hosted}
    </div>
  )
})
