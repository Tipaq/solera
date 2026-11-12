import type { Meta, StoryObj } from '@storybook/react-vite'
import type { CardDto, CardLinkDto } from '@solera/protocol'
import { horizonOf } from '../../lib/milestone-model'
import { fixtureCard, PROJECT_ID } from '../board/card-fixtures'
import { SettleList } from './SettleList'

const HOUR = 3_600_000
const link = ({ id, number, title, column }: CardDto): CardLinkDto => ({ id, number, title, column })

/** Le jalon #182 et ses cartes, liées dans les deux sens comme le serveur les rend. */
function entryOf(kids: CardDto[]) {
  const milestone = fixtureCard(182, 'Page projet v2 · Jalons', 'todo', { milestone: true })
  for (const kid of kids) kid.parent = link(milestone)
  milestone.children = kids.map(link)
  return horizonOf({ cards: [milestone, ...kids], runs: [], requests: new Map() })[0]!
}

const blocks = (blocker: CardDto, blocked: CardDto) => {
  blocker.blocks = [...blocker.blocks, link(blocked)]
  blocked.blockedBy = [...blocked.blockedBy, link(blocker)]
}

function everything() {
  const clarify = fixtureCard(193, 'Tiroir « Nouveau jalon »', 'todo', { toClarifySince: Date.now() - 26 * HOUR })
  const outside = fixtureCard(198, 'Suivi d’un jalon lancé', 'todo', { acceptedAt: null })
  const a = fixtureCard(194, 'Page d’un jalon', 'todo')
  const b = fixtureCard(195, 'Résumé d’affinage', 'todo')
  blocks(a, b)
  blocks(b, a)
  return entryOf([clarify, outside, a, b])
}

const meta = {
  title: "Composants d'application/À régler avant de partir",
  component: SettleList,
  parameters: {
    docs: {
      description: {
        component:
          "Ce qui retient un jalon en dehors de sa session d'affinage (#196, spec jalons RGL), réglé sur place : **préciser** une carte (la précision part à la session qui l'a posée, sinon dans sa description), **accepter** une carte venue de l'extérieur, **retirer un lien** d'un cycle de blocages. Absent quand il n'y a rien. Une session bloquée n'y est pas recopiée : son repère ambre et « Ce qui t'attend » la portent.",
      },
    },
  },
  args: { projectId: PROJECT_ID, entry: everything() },
  render: (args) => (
    <div className="w-[min(46rem,100%)]">
      <SettleList {...args} />
    </div>
  ),
} satisfies Meta<typeof SettleList>

export default meta
type Story = StoryObj<typeof meta>

/** Une carte à préciser, une à accepter, et un cycle. */
export const ToutARegler: Story = {}

/** Une seule carte à préciser. */
export const UneCarteAPreciser: Story = {
  args: { entry: entryOf([fixtureCard(193, 'Tiroir « Nouveau jalon »', 'todo', { toClarifySince: Date.now() - 3 * HOUR })]) },
}
