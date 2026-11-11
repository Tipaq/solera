/* PROTOTYPE — jetable (branche proto/page-projet). Ne pas fusionner dans main.
 *
 * Le **tiroir unique d'une action**, sorti de l'onglet Actions pour servir aussi au
 * panneau d'une conversation : trois modes, le détail, l'édition (nouvelle action, ou
 * « Modifier » depuis le détail, qui y revient à l'annulation), et « Planifier une action
 * existante… ». L'onglet et la conversation tiennent chacun leur état (`ActionPanel`) ;
 * ce composant ne fait que le rendre.
 *
 * Deux enveloppes pour le même contenu : le **tiroir** (onglet Actions du projet), et
 * `inline` — le panneau de droite d'une conversation, où l'action **remplace la liste**
 * dans le panneau même, avec « ‹ Actions » pour remonter. Un second tiroir à côté du
 * panneau en ouvrait deux. Les mises en page suivent la largeur de leur conteneur
 * (`@container/action`), pas celle de l'écran.
 */
import { useEffect } from 'react'
import { AlarmClock } from 'lucide-react'
import { Button } from '@solera/ui'
import { Drawer } from '../../components/prototype/Drawer'
import { ActionDetail } from './ActionDetail'
import { ActionBlock, ActionBody, ActionChromeProvider, ActionFooter, ActionHeader, NatureIcon, natureOf } from './DrawerParts'
import { ActionEditorBody, type EditorSeed } from './Editor'
import type { Automation } from './model'

export type ActionPanel =
  | { mode: 'detail'; id: string; review?: boolean }
  | { mode: 'edit'; seed: EditorSeed; back: string | null }
  | { mode: 'pick' }

/** Les entrées de « + Nouvelle » : la nature d'abord, ou planifier une action qui existe. */
export type NewActionKind = 'commande' | 'service' | 'agent' | 'planifier' | 'any'

export function newActionPanel(kind: NewActionKind): ActionPanel {
  const edit = (seed: EditorSeed): ActionPanel => ({ mode: 'edit', seed, back: null })
  if (kind === 'commande') return edit({ preset: { what: 'command', kind: 'task' } })
  if (kind === 'service') return edit({ preset: { what: 'command', kind: 'service' } })
  if (kind === 'agent') return edit({ preset: { what: 'agent' } })
  if (kind === 'planifier') return { mode: 'pick' }
  return edit({})
}

/** `?nouvelle=` (le ⚡, l'onglet) : l'éditeur pré-réglé, ou le choix d'une action à planifier. */
export function actionPanelOf(value: string | null): ActionPanel | null {
  if (value === '1') return newActionPanel('any')
  if (value === 'commande' || value === 'service' || value === 'agent' || value === 'planifier') return newActionPanel(value)
  return null
}

export function ActionDrawer({
  projectId,
  items,
  panel,
  onPanel,
  onClose,
  simulate,
  launchWhere,
  layerId,
  inline = false,
  backLabel = 'Actions',
}: {
  projectId: string
  items: Automation[]
  panel: ActionPanel | null
  onPanel: (panel: ActionPanel) => void
  onClose: () => void
  simulate: (text: string) => void
  /** Voir `ActionDetail` : depuis une conversation, « le worktree de cette conversation ». */
  launchWhere?: string
  /** Voir `Drawer` : le calque de la conversation. */
  layerId?: string
  /** Rendu dans le panneau, sans tiroir : voir l'en-tête du fichier. */
  inline?: boolean
  /** Le retour d'un niveau, en `inline`. */
  backLabel?: string
}) {
  const open = panel?.mode === 'detail' ? (items.find((item) => item.id === panel.id) ?? null) : null
  const pickable = items.filter((item) => !item.schedule && !item.review)
  /** Remonter d'un niveau : de l'édition au détail d'où l'on vient, sinon à la liste. */
  const back = () => (panel?.mode === 'edit' && panel.back ? onPanel({ mode: 'detail', id: panel.back }) : onClose())

  // Échap remonte d'un niveau, comme le ✕ d'un tiroir le fermerait. Un menu ouvert
  // (heure, fréquence) garde son Échap : il s'est déjà refermé et a marqué l'événement.
  useEffect(() => {
    if (!inline || panel === null) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      if ((event.target as HTMLElement | null)?.closest('[role="dialog"], [role="menu"], [role="listbox"]')) return
      back()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const content = (
    <div className="@container/action flex min-h-0 min-w-0 flex-1 flex-col">
      {panel?.mode === 'detail' && open ? (
        <ActionDetail
          key={open.id}
          item={open}
          projectId={projectId}
          simulate={simulate}
          onEdit={(seed) => onPanel({ mode: 'edit', seed, back: open.id })}
          onClose={onClose}
          launchWhere={launchWhere}
          focusReview={panel.review}
        />
      ) : panel?.mode === 'edit' ? (
        <ActionEditorBody
          key={`${panel.seed.from?.id ?? 'new'}-${panel.seed.schedule ? 'q' : 'w'}-${panel.seed.preset?.what ?? ''}${panel.seed.preset?.kind ?? ''}`}
          seed={panel.seed}
          onClose={onClose}
          onBack={panel.back ? () => onPanel({ mode: 'detail', id: panel.back! }) : undefined}
          simulate={simulate}
        />
      ) : panel?.mode === 'pick' ? (
        <>
          <ActionHeader nature={null} title="Planifier une action existante" when={['Choisis l’action, puis sa cadence']} onClose={onClose} />
          <ActionBody>
            <ActionBlock title={`Pas encore planifiées · ${pickable.length}`}>
              {pickable.length === 0 ? (
                <p className="text-sm text-ink-faint">Toutes les actions sont déjà planifiées.</p>
              ) : (
                <ul className="flex flex-col divide-y divide-line rounded-md border border-line">
                  {pickable.map((item) => (
                    <li key={item.id}>
                      <button type="button" onClick={() => onPanel({ mode: 'edit', seed: { from: item, schedule: true }, back: null })} className="flex min-h-12 w-full items-center gap-3 px-3 py-2 text-left hover:bg-surface-high/50">
                        <span className="grid size-7 shrink-0 place-items-center rounded-md bg-surface-high/70"><NatureIcon nature={natureOf(item)} /></span>
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="truncate text-sm text-ink">{item.label}</span>
                          <span className="truncate font-mono text-[11px] text-ink-faint">{item.what === 'agent' ? item.prompt : `$ ${item.command}`}</span>
                        </span>
                        <span className="inline-flex shrink-0 items-center gap-1 text-xs text-ink-soft"><AlarmClock size={13} /> Planifier</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </ActionBlock>
          </ActionBody>
          <ActionFooter right={<Button size="sm" variant="ghost" onClick={onClose}>Annuler</Button>} />
        </>
      ) : null}
    </div>
  )

  if (inline) {
    if (panel === null || (panel.mode === 'detail' && open === null)) return null
    return <ActionChromeProvider value={{ inline: true, backLabel, onBack: back }}>{content}</ActionChromeProvider>
  }

  return (
    <Drawer
      open={panel !== null && (panel.mode !== 'detail' || open !== null)}
      onClose={onClose}
      label={panel?.mode === 'edit' ? (panel.seed.from ? `Modifier « ${panel.seed.from.label} »` : 'Nouvelle action') : panel?.mode === 'pick' ? 'Planifier une action existante' : (open?.label ?? 'Action')}
      width="wide"
      layerId={layerId}
    >
      {content}
    </Drawer>
  )
}
