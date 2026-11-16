import { AlarmClock } from 'lucide-react'
import { Suspense, lazy, useRef, useState, type ReactNode } from 'react'
import { Button } from '@solera/ui'
import { editorKey, panelBack, panelItem, panelLabel, pickable, type ActionPanel } from '../../lib/action-panel'
import { actionOf, natureOf, scheduleTargetOf, type Automation } from '../../lib/automations'
import { commandRunOf } from '../../lib/command-runs'
import { useDetailSurface } from '../../lib/detail-surface'
import type { EditorSeed } from '../../lib/action-editor'
import { useEscapeLayer } from '../../lib/escape-layers'
import { useTranslate } from '../../lib/i18n'
import { useProjects } from '../../lib/projects'
import { useTerminals } from '../../lib/terminals'
import { CommandRunDetail } from '../panel/CommandRuns'
import { Drawer } from '../shell/Drawer'
import { ActionDetail } from './ActionDetail'
import { NatureIcon } from './ActionMarks'
import { ActionBlock, ActionBody, ActionChromeProvider, ActionFooter, ActionHeader } from './ActionSheet'

/**
 * L'éditeur, chargé à son ouverture : il porte l'arborescence, le planificateur et les
 * réglages des CLI, hors du paquet d'entrée (#128).
 */
const ActionEditor = lazy(() => import('./ActionEditor').then((m) => ({ default: m.ActionEditor })))

/** Un passage qui tourne se suit d'assez près pour voir sa fin. */
const RUN_POLL_MS = 3_000

/** Si le tiroir a quelque chose à montrer : le détail d'une action disparue n'en a plus. */
export function panelShows(panel: ActionPanel | null, items: readonly Automation[]): panel is ActionPanel {
  if (panel === null) return false
  return panel.mode === 'edit' || panel.mode === 'pick' || panelItem(panel, items) !== null
}

/**
 * Le tiroir unifié d'une action (`actions.md` §1.C) : le détail, l'édition (« Modifier »
 * bascule le **même** tiroir, Annuler et Enregistrer y reviennent), « Planifier une
 * action existante… », et le passage d'une commande qui tourne.
 *
 * Là où la page veut qu'un détail s'ouvre (`useDetailSurface`, TIR-8) : dans le tiroir
 * commun sur une page sans panneau ; **en pile** dans le panneau d'une conversation, à la
 * place de la liste, « ‹ Actions » pour remonter. Dans la pile, Échap remonte d'un niveau
 * — de l'édition au détail d'où l'on vient, puis à la liste — sauf s'il revient à un menu
 * ouvert. L'hôte tient l'état (`panel`) ; en pile, c'est à lui de ne plus rendre sa liste
 * tant que `panelShows`.
 *
 * Les mises en page suivent la largeur du conteneur (`@container/action`), pas celle de
 * l'écran (TIRA-4).
 *
 * `projectId` null : la page Planifiées, qui mêle les projets. Chaque action s'ouvre dans
 * le sien ; une création porte sa portée (`seed.target`), qu'un duplicata reprend de
 * l'action d'où il vient.
 */
export function ActionDrawer({
  projectId,
  items,
  panel,
  onPanel,
  onClose,
  conversationId,
  backLabel,
  launchWhere,
}: {
  projectId: string | null
  items: readonly Automation[]
  panel: ActionPanel | null
  onPanel: (panel: ActionPanel) => void
  onClose: () => void
  /** Depuis une conversation : on lance et on essaie dans son worktree. */
  conversationId?: string
  /** En pile, le nom de l'onglet où l'on revient : « ‹ Actions ». */
  backLabel?: string
  /** La page Planifiées : où part un lancement à la main de cette action (PLF-9). */
  launchWhere?: (item: Automation) => string
}) {
  const t = useTranslate()
  const surface = useDetailSurface()
  const open = panelShows(panel, items)
  // Le dernier contenu reste le temps que le tiroir sorte de l'écran.
  const [last, setLast] = useState<ActionPanel | null>(panel)
  if (open && panel !== last) setLast(panel)
  const shown = open ? panel : surface === 'drawer' ? last : null

  /** Remonter d'un niveau : de l'édition ou d'un passage au détail d'où l'on vient, sinon fermer. */
  const back = () => {
    const up = panel ? panelBack(panel) : null
    if (up) onPanel(up)
    else onClose()
  }

  const item = shown ? panelItem(shown, items) : null
  const content = shown ? (
    <div className="@container/action flex min-h-0 min-w-0 flex-1 flex-col">
      <Mode
        panel={shown}
        item={item}
        items={items}
        projectId={projectId}
        conversationId={conversationId}
        launchWhere={launchWhere}
        onPanel={onPanel}
        onBack={back}
        onClose={onClose}
      />
    </div>
  ) : null

  if (surface === 'drawer') {
    return (
      <Drawer open={open} onClose={onClose} label={shown ? panelLabel(shown, item, t) : ''} width="wide">
        {content}
      </Drawer>
    )
  }
  if (!content) return null
  return (
    <ActionChromeProvider value={{ inline: true, backLabel: backLabel ?? t('panel.tab.actions'), onBack: back }}>
      <Stacked onBack={back}>{content}</Stacked>
    </ActionChromeProvider>
  )
}

/** En pile, le tiroir est une couche : Échap remonte d'un niveau s'il vient de chez lui. */
function Stacked({ onBack, children }: { onBack: () => void; children: ReactNode }) {
  const frame = useRef<HTMLDivElement>(null)
  useEscapeLayer(true, onBack, frame)
  return (
    <div ref={frame} data-action-stack className="flex min-h-0 min-w-0 flex-1 flex-col">
      {children}
    </div>
  )
}

function Mode({
  panel,
  item,
  items,
  projectId,
  conversationId,
  launchWhere,
  onPanel,
  onBack,
  onClose,
}: {
  panel: ActionPanel
  item: Automation | null
  items: readonly Automation[]
  projectId: string | null
  conversationId?: string
  launchWhere?: (item: Automation) => string
  onPanel: (panel: ActionPanel) => void
  onBack: () => void
  onClose: () => void
}) {
  // Hors d'un projet, le détail et le passage s'ouvrent dans celui de l'action.
  const home = projectId ?? item?.projectId ?? ''
  switch (panel.mode) {
    case 'detail':
      return item ? (
        <ActionDetail
          key={item.id}
          item={item}
          projectId={home}
          conversationId={conversationId}
          launchWhere={launchWhere?.(item)}
          focusReview={panel.review}
          onPanel={onPanel}
          onClose={onClose}
        />
      ) : null
    case 'edit':
      return (
        <Suspense fallback={null}>
          <ActionEditor
            key={editorKey(panel.seed)}
            projectId={projectId}
            seed={projectId === null ? scopedSeed(panel.seed, panel.back, items) : panel.seed}
            conversationId={conversationId}
            onClose={onClose}
            onBack={panel.back ? onBack : undefined}
          />
        </Suspense>
      )
    case 'pick':
      return <Pick items={items} named={projectId === null} onPanel={onPanel} onClose={onClose} />
    case 'run':
      return item ? (
        <RunPane item={item} terminalId={panel.terminalId} projectId={home} conversationId={conversationId} onPanel={onPanel} onBack={onBack} />
      ) : null
  }
}

/**
 * Hors d'un projet, une création sans portée — « Dupliquer » du détail — prend celle de
 * l'action d'où elle vient. Modifier garde la sienne, qui ne change pas.
 */
function scopedSeed(seed: EditorSeed, back: string | null, items: readonly Automation[]): EditorSeed {
  if (seed.from || seed.target) return seed
  const origin = back ? items.find((entry) => entry.id === back) : undefined
  return origin ? { ...seed, target: scheduleTargetOf(origin) } : seed
}

/** « Planifier une action existante » : celles qui ne le sont pas encore, puis l'éditeur sur Quand (TIRA-7). */
function Pick({
  items,
  named,
  onPanel,
  onClose,
}: {
  items: readonly Automation[]
  /** La page Planifiées, qui mêle les projets : chaque ligne nomme le sien. */
  named: boolean
  onPanel: (panel: ActionPanel) => void
  onClose: () => void
}) {
  const t = useTranslate()
  const { data: projects } = useProjects()
  const projectName = (id: string | null) => (named && id ? (projects?.find((entry) => entry.id === id)?.name ?? null) : null)
  const choices = pickable(items)
  return (
    <>
      <ActionHeader nature={null} title={t('actionDrawer.label.pick')} when={[t('actionDrawer.pick.hint')]} onClose={onClose} />
      <ActionBody>
        <ActionBlock title={t('actionDrawer.pick.block', { count: choices.length })}>
          {choices.length === 0 ? (
            <p className="text-sm text-ink-faint">{t('actionDrawer.pick.empty')}</p>
          ) : (
            <ul className="flex flex-col divide-y divide-line rounded-md border border-line">
              {choices.map((choice) => (
                <li key={choice.id}>
                  <button
                    type="button"
                    aria-label={t('actionDrawer.pick.named', { label: choice.label })}
                    onClick={() => onPanel({ mode: 'edit', seed: { from: choice, schedule: true }, back: null })}
                    className="flex min-h-12 w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-surface-high/50 focus-visible:outline-2 focus-visible:outline-accent"
                  >
                    <span className="grid size-7 shrink-0 place-items-center rounded-md bg-surface-high/70">
                      <NatureIcon nature={natureOf(choice)} />
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-sm text-ink">{choice.label}</span>
                      <span className="truncate font-mono text-meta text-ink-faint">{choice.what === 'agent' ? choice.prompt : `$ ${choice.command}`}</span>
                      {projectName(choice.projectId) ? <span className="truncate text-meta text-ink-soft">{projectName(choice.projectId)}</span> : null}
                    </span>
                    <span className="inline-flex shrink-0 items-center gap-1 text-xs text-ink-soft">
                      <AlarmClock size={13} aria-hidden /> {t('actionDrawer.pick.schedule')}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </ActionBlock>
      </ActionBody>
      <ActionFooter
        right={
          <Button size="sm" variant="ghost" onClick={onClose}>
            {t('actionDrawer.cancel')}
          </Button>
        }
      />
    </>
  )
}

/**
 * Le passage d'une commande qui tourne, ouvert par « Terminal » ou au lancement : sa
 * sortie en lecture seule, Arrêter, Relancer (`CommandRunDetail`). « ‹ » ramène au détail.
 */
function RunPane({
  item,
  terminalId,
  projectId,
  conversationId,
  onPanel,
  onBack,
}: {
  item: Automation
  terminalId: string
  projectId: string
  conversationId?: string
  onPanel: (panel: ActionPanel) => void
  onBack: () => void
}) {
  const { data: terminals } = useTerminals(projectId, true, RUN_POLL_MS)
  const terminal = terminals?.find((entry) => entry.id === terminalId)
  if (!terminal) return null
  const action = actionOf(item)
  return (
    <CommandRunDetail
      key={terminal.id}
      projectId={projectId}
      conversationId={conversationId}
      run={commandRunOf(terminal, action)}
      onBack={onBack}
      backLabel={item.label}
      onRelaunched={(relaunched) => onPanel({ mode: 'run', terminalId: relaunched, back: item.id })}
    />
  )
}
