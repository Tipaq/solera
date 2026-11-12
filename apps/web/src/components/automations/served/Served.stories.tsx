import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import type { ActionPlacement } from '@solera/protocol'
import { useTranslate } from '../../../lib/i18n'
import { servedIndex, switchTargets } from '../../../lib/served'
import { ActionGesture, quietGestureClass } from '../ActionGestures'
import { ActionBlock } from '../ActionSheet'
import { PROJECT_ID, SERVICE_ON, SERVICE_TREE, SeededWorktrees } from '../automation-fixtures'
import { PlacementField } from './PlacementField'
import { ServedBlock, type ServedBlockTree } from './ServedBlock'
import { ServedLine } from './ServedLine'
import { ServeIcon, ServeMenu } from './ServeMenu'
import { SwitchServiceDialog, switchToTree, type SwitchRequest } from './SwitchServiceDialog'

const ignore = () => {}

const tree = (key: string, over: Partial<ServedBlockTree>): ServedBlockTree => ({
  key, root: false, id: null, path: key, name: key, branch: null, state: 'unmerged', ahead: 0, behind: 0, uncommitted: 0, card: null, ...over,
})

/** Les arbres de Nimbus, tels que `useCodeData` les rend : la racine, des worktrees, un fusionné. */
const TREES: ServedBlockTree[] = [
  tree('root', { root: true, path: '/srv/nimbus', name: 'nimbus', branch: 'main', state: 'root' }),
  tree('/srv/nimbus/.worktrees/w1', {
    id: 'w1', path: '/srv/nimbus/.worktrees/w1', name: 'w1', branch: 'feat/905-vue-horizon-et-ses-jalons', ahead: 4, behind: 3, uncommitted: 2,
    card: { number: 905, title: 'Vue horizon', milestone: { number: 900 } },
  }),
  tree('/srv/nimbus/.worktrees/w2', { id: 'w2', path: '/srv/nimbus/.worktrees/w2', name: 'w2', branch: 'fix/connexion-lente' }),
  tree('/srv/nimbus/.worktrees/w3', { id: 'w3', path: '/srv/nimbus/.worktrees/w3', name: 'w3', branch: 'feat/export-csv', state: 'merged' }),
]

const INDEX = servedIndex([SERVICE_ON, SERVICE_TREE], TREES)
const AT_ROOT = INDEX.byAutomation.get(SERVICE_ON.id)!
const IN_TREE = INDEX.byAutomation.get(SERVICE_TREE.id)!
const action = (item: typeof SERVICE_ON) => (item.source.kind === 'action' ? item.source.action : null)!

function Lines() {
  return (
    <div className="flex w-[22rem] flex-col gap-2 rounded-lg border border-line p-3">
      <ServedLine served={IN_TREE} />
      <ServedLine served={AT_ROOT} />
      <ServedLine served={{ ...IN_TREE, root: false, branch: null, commit: null, behind: 0, uncommitted: 0 }} />
    </div>
  )
}

function Block({ item }: { item: typeof IN_TREE }) {
  const t = useTranslate()
  const [request, setRequest] = useState<SwitchRequest | null>(null)
  return (
    <div className="w-[34rem] max-w-full rounded-lg border border-line py-3">
      <ActionBlock title={t('actionDetail.block.served')}>
        <ServedBlock
          projectId={PROJECT_ID}
          served={item}
          base="main"
          targets={switchTargets(TREES, item)}
          onSwitch={(target) => setRequest({ action: action(SERVICE_TREE), from: item, to: switchToTree(target, target.branch ?? target.name) })}
        />
      </ActionBlock>
      <SwitchServiceDialog request={request} onClose={() => setRequest(null)} onConfirm={() => setRequest(null)} />
    </div>
  )
}

function Tile() {
  const t = useTranslate()
  const [request, setRequest] = useState<SwitchRequest | null>(null)
  return (
    <SeededWorktrees>
      <div className="flex w-[20rem] flex-col gap-2 rounded-lg border border-accent/40 bg-accent/5 p-3">
        <span className="text-sm font-medium text-ink">{SERVICE_TREE.label}</span>
        <ServedLine served={IN_TREE} />
        <footer className="flex items-center gap-1.5">
          <ActionGesture
            item={SERVICE_TREE}
            onReview={ignore}
            onToggleService={ignore}
            onTerminal={ignore}
            onLaunch={ignore}
            serve={
              <ServeMenu
                targets={switchTargets(TREES, IN_TREE)}
                onSwitch={(target) => setRequest({ action: action(SERVICE_TREE), from: IN_TREE, to: switchToTree(target, target.branch ?? target.name) })}
                trigger={
                  <button type="button" aria-label={t('served.serveNamed', { label: SERVICE_TREE.label })} className={quietGestureClass()}>
                    <ServeIcon /> {t('served.serve')}
                  </button>
                }
              />
            }
          />
        </footer>
      </div>
      <SwitchServiceDialog request={request} onClose={() => setRequest(null)} onConfirm={() => setRequest(null)} />
    </SeededWorktrees>
  )
}

function PlacementDemo({ initial, url = 'http://127.0.0.1:{port}' }: { initial: ActionPlacement; url?: string }) {
  const [value, setValue] = useState(initial)
  const [branch, setBranch] = useState('main')
  return (
    <div className="w-[34rem] max-w-full">
      <PlacementField
        value={value}
        onChange={setValue}
        branch={branch}
        onBranch={setBranch}
        branches={['main', 'feat/905-vue-horizon-et-ses-jalons', 'fix/connexion-lente']}
        rootBranch="main"
        url={url}
      />
    </div>
  )
}

const meta = {
  title: "Composants d'application/Actions/Ce qu'il sert",
  component: ServedLine,
  args: { served: IN_TREE },
  parameters: {
    docs: {
      description: {
        component:
          "Ce qu'un service en marche sert : la ligne d'une tuile ou d'une liste (« sert `feat/…` @ commit · ↓ en retard · ● non commités », le dossier en infobulle), le bloc du détail (arbre vers Travail, branche, commit, position sur la base, non commités servis tels quels, carte), « Servir une autre branche… » et le dialogue qui dit que basculer redémarre. `PlacementField` règle où il tourne.",
      },
    },
  },
} satisfies Meta<typeof ServedLine>

export default meta
type Story = StoryObj<typeof meta>

/** Un worktree en retard avec des non commités ; la racine ; un dossier hors du projet. */
export const Ligne: Story = { name: 'Ligne', render: () => <Lines /> }

/** Le bloc du détail, d'un service sur un worktree : « Servir une autre branche… » ouvre le menu. */
export const Bloc: Story = { name: 'Bloc du détail', render: () => <Block item={IN_TREE} /> }

/** Un service fixé à la racine ne se bascule pas : le bloc le dit à la place du geste. */
export const BlocFixe: Story = { name: 'Bloc, placement fixé', render: () => <Block item={{ ...AT_ROOT, switchable: false }} /> }

/** La tuile d'un service en marche : l'interrupteur, « Servir… », « Ouvrir ↗ ». */
export const Tuile: Story = { name: 'Tuile en marche', render: () => <Tile /> }

/** Le dialogue de bascule, tel que l'ouvrent « Servir… » et un lancement refusé (409). */
export const Dialogue: Story = {
  name: 'Dialogue de bascule',
  render: () => (
    <SwitchServiceDialog
      request={{ action: action(SERVICE_TREE), from: IN_TREE, to: { name: 'fix/connexion-lente', worktreeId: 'w2' } }}
      onClose={ignore}
      onConfirm={ignore}
    />
  ),
}

/** « Où tourne-t-il » : la première conseillée, la quatrième annoncée. */
export const Placement: Story = { name: 'Où tourne-t-il', render: () => <PlacementDemo initial="follow" /> }

/** Toujours une branche : la racine y est, ou il faudrait un worktree dédié. */
export const PlacementBranche: Story = { name: 'Où tourne-t-il, une branche', render: () => <PlacementDemo initial="branch" /> }
