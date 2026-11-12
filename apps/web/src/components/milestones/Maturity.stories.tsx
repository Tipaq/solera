import type { Meta, StoryObj } from '@storybook/react-vite'
import type { CardDto, CardLinkDto, MilestoneRunDto } from '@solera/protocol'
import { useTranslate } from '../../lib/i18n'
import { horizonOf, MATURITIES, nextAction, nextActionText, type MilestoneEntry } from '../../lib/milestone-model'
import { fixtureCard } from '../board/card-fixtures'
import { MaturityPill } from './MaturityPill'
import { ExplainedSteps, MaturitySteps } from './MaturitySteps'
import { MaturityTag } from './MaturityTag'

const link = ({ id, number, title, column }: CardDto): CardLinkDto => ({ id, number, title, column })

/** Un jalon et ses enfants, liés dans les deux sens comme le serveur les rend. */
function milestone(number: number, title: string, kids: CardDto[], extra: Partial<CardDto> = {}): CardDto[] {
  const parent = fixtureCard(number, title, 'todo', { milestone: true, ...extra })
  for (const kid of kids) kid.parent = link(parent)
  parent.children = kids.map(link)
  return [parent, ...kids]
}

const blocked = (card: CardDto, blocker: CardDto) => {
  card.blockedBy = [link(blocker)]
  blocker.blocks = [link(card)]
  return card
}

/** Un jalon à chaque étape, pour que chaque pastille porte une vraie raison en infobulle. */
function entries(): MilestoneEntry[] {
  const first = fixtureCard(911, 'Échelle et axe', 'done')
  const second = blocked(fixtureCard(912, 'Barres de cartes', 'in_progress'), first)
  const clarify = fixtureCard(921, 'Fil unique', 'todo', { toClarifySince: Date.now() })
  const cards = [
    fixtureCard(901, 'Mode hors ligne complet', 'todo', { milestone: true }),
    fixtureCard(902, 'Projets partagés en équipe', 'todo', {
      milestone: true,
      refinement: {
        conversationId: 'split-902', title: 'Affinage', status: 'awaiting_input', mode: 'questions', createdAt: Date.now(),
        draft: { requestId: 'd-902', count: 4 }, change: null,
      },
    }),
    ...milestone(920, 'Activité et Journal fusionnés', [clarify, fixtureCard(922, 'Filtres par nature', 'todo')]),
    ...milestone(930, 'Accès distant fiable', [fixtureCard(931, 'Adresse de secours', 'todo'), fixtureCard(932, 'Doc mobile', 'todo')]),
    ...milestone(910, 'Page projet v2', [first, second]),
    ...milestone(940, 'Comptes Claude nommés', [fixtureCard(941, 'Alias facultatif', 'done'), fixtureCard(942, 'Migration', 'done')]),
  ]
  const runs = [{ cardId: 'card-910', state: 'running', createdAt: Date.now() } as MilestoneRunDto]
  return horizonOf({ cards, runs, requests: new Map() })
}

const meta = {
  title: "Composants d'application/Maturité d'un jalon",
  component: MaturityPill,
  parameters: {
    docs: {
      description: {
        component:
          "Où en est un jalon entre l'idée et la livraison (#188, spec jalons MAT-1, MAT-8, MAT-9) : **Idée → À affiner → À régler → Prêt → Lancé → Livré**. Rien ne la stocke : `horizonOf` (`lib/milestone-model`) la déduit des cartes, du pilotage, de la PR du jalon et de la session d'affinage.\n\n`MaturityPill` dit l'étape ; avec son jalon, l'infobulle en donne la raison principale. `MaturitySteps` montre le chemin parcouru en six traits ; `ExplainedSteps`, sur la page d'un jalon, ouvre chaque étape sur sa fiche : pourquoi il est ici et comment passer à la suivante, ou quand il y était, quand il y sera.",
      },
    },
  },
  args: { maturity: 'ready' },
} satisfies Meta<typeof MaturityPill>

export default meta
type Story = StoryObj<typeof meta>

/** Les six pastilles, sans jalon : l'étape seule, sans infobulle. */
export const Pastilles: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      {MATURITIES.map((maturity) => (
        <MaturityPill key={maturity} maturity={maturity} />
      ))}
    </div>
  ),
}

function Rows() {
  return (
    <ul className="flex max-w-xl flex-col divide-y divide-line">
      {entries().map((entry) => (
        <li key={entry.card.id} className="flex flex-col gap-2 py-3">
          <div className="flex items-center gap-2">
            <span className="text-sm text-ink-faint tabular-nums">#{entry.card.number}</span>
            <span className="min-w-0 flex-1 truncate text-sm text-ink">{entry.card.title}</span>
            <MaturityPill maturity={entry.maturity} entry={entry} />
          </div>
          <MaturitySteps maturity={entry.maturity} />
        </li>
      ))}
    </ul>
  )
}

/** Un jalon à chaque étape : survoler la pastille en donne la raison, les traits le chemin. */
export const Jalons: Story = {
  render: () => <Rows />,
}

/** Les traits seuls, à chaque étape. */
export const Traits: Story = {
  render: () => (
    <div className="flex max-w-xs flex-col gap-3">
      {MATURITIES.map((maturity) => (
        <MaturitySteps key={maturity} maturity={maturity} />
      ))}
    </div>
  ),
}

function Explained() {
  const t = useTranslate()
  return (
    <ul className="flex max-w-2xl flex-col gap-6">
      {entries().map((entry) => (
        <li key={entry.card.id} className="flex flex-col gap-2">
          <span className="text-sm text-ink">
            #{entry.card.number} {entry.card.title}
          </span>
          <ExplainedSteps entry={entry} action={nextActionText(nextAction(entry), t)} onAct={() => undefined} />
        </li>
      ))}
    </ul>
  )
}

/** Les étapes expliquées de la page d'un jalon : cliquer une étape ouvre sa fiche. */
export const Expliquees: Story = {
  render: () => <Explained />,
}

/** L'étape en texte, précédée de son point : là où une pastille serait trop lourde (le phare de l'Aperçu). */
export const Etiquettes: Story = {
  name: 'Étiquettes',
  render: () => (
    <div className="flex flex-wrap gap-4">
      {MATURITIES.map((maturity) => (
        <MaturityTag key={maturity} maturity={maturity} />
      ))}
    </div>
  ),
}
