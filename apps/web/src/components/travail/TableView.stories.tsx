import type { Meta, StoryObj } from '@storybook/react-vite'
import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import type { WorktreeCleanupPlanDto } from '@solera/protocol'
import { DrawerLayer } from '../shell/Drawer'
import { cleanOffer, type CleanRequest } from '../../lib/travail-clean'
import { DEFAULT_DISPLAY, type TravailDisplay } from '../../lib/travail-model'
import { laneLayout, lanesOf } from '../../lib/travail-lanes'
import { cleanupPlanKey } from '../../lib/worktrees'
import { CleanDialog } from './CleanDialog'
import { TableView } from './TableView'
import { TravailActionsHost } from './TravailActions'
import { TravailNoticeHost } from './TravailNotice'
import { BRANCHES, ENTRIES, LIVE, NOW, SCOPES, TREES } from './travail-fixtures'

const PROJECT = 'p1'

function Table({ display = DEFAULT_DISPLAY, forced = false }: { display?: TravailDisplay; forced?: boolean }) {
  const layout = laneLayout({
    lanes: lanesOf({ trees: TREES, live: LIVE, entries: ENTRIES, scopes: SCOPES, now: NOW }),
    branches: BRANCHES,
    display: { ...display, showProject: false },
    forced,
    targeted: false,
    now: NOW,
  })
  return (
    <TravailNoticeHost>
      <TravailActionsHost projectId={PROJECT} base="main" onRemoved={() => {}}>
        <div className="relative flex h-[46rem] overflow-clip border border-line">
          <div className="min-w-0 flex-1 overflow-y-auto px-4 pt-4 pb-10 md:px-6">
            <TableView projectId={PROJECT} layout={layout} onOpen={() => {}} />
          </div>
          <DrawerLayer />
        </div>
      </TravailActionsHost>
    </TravailNoticeHost>
  )
}

/** Le plan d'un arbre tel que le serveur le rendrait. */
function plan(path: string, over: Partial<WorktreeCleanupPlanDto> = {}): WorktreeCleanupPlanDto {
  return {
    path, name: path.split('/').pop() ?? path, branch: path.slice(4), state: 'merged', modified: 0, untracked: 0, ahead: 0, unmergedCommits: false,
    branchDeletable: true, conversations: [], busy: [], restarted: [], services: [], terminals: 0, card: null, ...over,
  }
}

/** Le dialogue, ouvert, les plans des arbres déjà lus. */
function Clean({ request, plans }: { request: CleanRequest; plans: WorktreeCleanupPlanDto[] }) {
  const client = useQueryClient()
  useState(() => plans.forEach((entry) => client.setQueryData(cleanupPlanKey(PROJECT, entry.path), entry)))
  const [open, setOpen] = useState(true)
  return (
    <TravailNoticeHost>
      <CleanDialog projectId={PROJECT} request={open ? request : null} base="main" onClose={() => setOpen(false)} onRemoved={() => {}} />
    </TravailNoticeHost>
  )
}

const meta = {
  title: "Composants d'application/Travail en tableau",
  parameters: {
    docs: {
      description: {
        component:
          "La vue « Tableau » de Travail (T-6) : une ligne par arbre (toute la ligne ouvre son tiroir), une par branche sans worktree, sur une grille de colonnes resserrées ; « À nettoyer » et les branches fusionnées en bas. Au téléphone, chaque ligne devient une carte. Et le dialogue « Nettoyer » (T-12), le seul de Travail.",
      },
    },
  },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

/** Sans regroupement : les arbres, puis les branches sans worktree. Le `⋯` d'une ligne porte ses gestes. */
export const Tableau: Story = { render: () => <Table /> }

/** Regroupés par état : une section par verdict, puis par genre de branche. */
export const ParEtat: Story = { name: 'Regroupés par état', render: () => <Table display={{ ...DEFAULT_DISPLAY, group: 'state' }} /> }

/** « À nettoyer » et les branches fusionnées dépliées, comme sous un filtre d'état. */
export const ANettoyer: Story = { name: 'À nettoyer déplié', render: () => <Table forced /> }

/** « Nettoyer · N » : les arbres fusionnés et les branches fusionnées, rien ne se perd. */
export const Nettoyer: Story = {
  name: 'Nettoyer',
  render: () => {
    const offer = cleanOffer(TREES, BRANCHES)
    return (
      <Clean
        request={offer}
        plans={offer.trees.map((tree, index) =>
          plan(tree.path, index === 0 ? { conversations: [{ id: 's1', title: 'La coque, premier jet' }], services: [{ id: 'v', label: 'Serveur de dev', kind: 'app' }], terminals: 1 } : {}),
        )}
      />
    )
  },
}

/** Un arbre au travail non commité, un autre où une session travaille : la perte se dit en rouge, l'arbre occupé attend. */
export const NettoyerAvecPerte: Story = {
  name: 'Nettoyer, avec perte',
  render: () => {
    const trees = TREES.filter((tree) => tree.key === 'feat/175-travail' || tree.key === 'spike/terminal')
    return (
      <Clean
        request={{ trees, branches: [] }}
        plans={[
          plan('/wt/feat/175-travail', { state: 'unmerged', modified: 3, unmergedCommits: true, ahead: 2, card: { id: 'k175', number: 175, title: 'Travail : onglet, barre, Par moment' } }),
          plan('/wt/spike/terminal', { busy: [{ id: 's9', title: 'Terminal : la reprise' }], conversations: [{ id: 's9', title: 'Terminal : la reprise' }] }),
        ]}
      />
    )
  },
}
