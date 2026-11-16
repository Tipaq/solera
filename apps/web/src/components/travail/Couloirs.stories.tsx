import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { DrawerLayer } from '../shell/Drawer'
import { DEFAULT_DISPLAY, type TravailDisplay } from '../../lib/travail-model'
import { laneLayout, lanesOf } from '../../lib/travail-lanes'
import { CouloirsView } from './CouloirsView'
import { TravailNoticeHost } from './TravailNotice'
import { TreeDrawer } from './TreeDrawer'
import { BRANCHES, ENTRIES, LIVE, NOW, RAIL, SCOPES, SERVED, SESSIONS, TREES } from './travail-fixtures'

function View({ display = DEFAULT_DISPLAY, forced = false, opened = null }: { display?: TravailDisplay; forced?: boolean; opened?: string | null }) {
  const [open, setOpen] = useState<string | null>(opened)
  const layout = laneLayout({ lanes: lanesOf({ trees: TREES, live: LIVE, entries: ENTRIES, scopes: SCOPES, now: NOW }), branches: BRANCHES, display, forced, targeted: false, now: NOW })
  const tree = TREES.find((entry) => entry.key === open) ?? null
  return (
    <TravailNoticeHost>
      <div className="relative flex h-[46rem] overflow-clip border border-line">
        <div className="min-w-0 flex-1 overflow-y-auto px-4 pt-4 pb-10 md:px-6">
          <CouloirsView projectId="p1" layout={layout} rail={RAIL} served={SERVED} flash={null} onOpen={setOpen} />
        </div>
        <DrawerLayer />
      </div>
      <TreeDrawer
        projectId="p1"
        tree={tree}
        sessions={tree?.key === 'feat/175-travail' ? SESSIONS : []}
        entries={tree ? ENTRIES.filter((entry) => entry.title.includes(tree.branch ?? '') || entry.cardNumber === tree.card?.number) : []}
        journalDays={14}
        rail={RAIL}
        served={tree ? SERVED.get(tree.key) : undefined}
        onClose={() => setOpen(null)}
      />
    </TravailNoticeHost>
  )
}

const meta = {
  title: "Composants d'application/Travail par arbre",
  parameters: {
    docs: {
      description: {
        component:
          "La vue « Par arbre » de Travail (T-4) : un couloir par arbre (son fil : sessions vivantes, trois derniers événements), un par branche sans worktree, le couloir « Projet », puis « À nettoyer » et les branches fusionnées, repliés. L'en-tête d'un couloir ouvre le tiroir de l'arbre (T-11).",
      },
    },
  },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

/** Sans regroupement : les arbres, puis les branches sans worktree. Un clic sur un en-tête ouvre le tiroir. */
export const ParArbre: Story = { name: 'Par arbre', render: () => <View /> }

/** Regroupés par jalon, « Sans jalon » en dernier. */
export const ParJalon: Story = { name: 'Regroupés par jalon', render: () => <View display={{ ...DEFAULT_DISPLAY, group: 'milestone' }} /> }

/** Un filtre « À nettoyer » : les sections repliées s'ouvrent d'office. */
export const ANettoyer: Story = { name: 'À nettoyer déplié', render: () => <View forced /> }

/** Le tiroir d'un arbre (T-11), ouvert : son verdict, ses gestes, ses faits, ses sessions et son historique. */
export const Tiroir: Story = { name: 'Tiroir d’un arbre', render: () => <View opened="feat/175-travail" /> }
