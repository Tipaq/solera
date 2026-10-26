import type { Meta, StoryObj } from '@storybook/react-vite'
import { CardFilingPrompt } from './CardFilingPrompt'

const meta = {
  title: "Composants d'application/CardFilingPrompt",
  component: CardFilingPrompt,
  parameters: {
    docs: {
      description: {
        component:
          "La proposition de changement de cartes qu'un agent dépose dans son fil, et que le propriétaire du projet accorde d'un clic.\n\n**La raison est obligatoire, par carte, et c'est le fond de ce composant.** Le prix d'un rangement de conversation se calcule tout seul — un worktree, une carte, une reprise de CLI — alors qu'une carte ne se range que sur un constat. Une demande sans raison écrite n'est pas une proposition, c'est un ordre poli : le serveur la refuse avant même d'arriver ici. Ce qui reste à lire, donc, est exactement ce que l'agent a constaté.\n\n**Au-delà de la colonne, la parente, l'échéance et les liens « bloque » d'une carte existante** (#66) : ils engagent le planning d'une personne, et passent par le même clic. Chaque ligne n'affiche que ce qu'elle change.\n\n**Toutes les colonnes sont permises, `abandoned` comprise.** Il n'y a pas de règle par sens de mouvement : le tabou visait l'acte, pas la proposition, et c'est le clic qui tranche. Le mouvement est ensuite inscrit dans `card_moves` au nom de **la personne qui a cliqué**, jamais de la session qui a proposé.\n\n**Une demande porte plusieurs cartes, accordées en une transaction** — le cas qui a ouvert la carte #54 était treize cartes finies et publiées, restées en « en cours », qu'aucun agent ne pouvait ranger. Un seul bouton accorde la liste entière.\n\nLe bouton n'apparaît qu'au propriétaire du **projet**, et non du fil : c'est son board. Les deux ne se confondent que sur une instance à un seul compte.",
      },
    },
  },
  args: {
    conversationId: 'c1',
    canDecide: true,
    filing: {
      kind: 'cardFiling',
      id: 'r1',
      cards: [
        {
          cardId: 'k1',
          number: 23,
          title: 'Un agent déclare un projet, et demande un rangement',
          fromColumn: 'in_progress',
          toColumn: 'done',
          reason: 'La PR est fusionnée dans main et publiée ; les trois branches sont recollées.',
        },
        {
          cardId: 'k2',
          number: 41,
          title: 'Une grille outil × portée, réglable par projet',
          fromColumn: 'todo',
          toColumn: 'abandoned',
          reason: "Le grill du 2026-10-16 a arrêté quatre familles fixes : cette carte n'a plus d'objet.",
        },
      ],
      status: 'pending',
      reason: null,
      moved: [],
      applied: null,
      closed: [],
    },
  },
} satisfies Meta<typeof CardFilingPrompt>

export default meta
type Story = StoryObj<typeof meta>

/** Deux cartes d'un coup, dont un abandon : un seul clic accorde les deux. */
export const Attente: Story = {}

/** Une seule carte : le bouton perd son décompte. */
export const UneSeuleCarte: Story = {
  name: 'Une seule carte',
  args: { filing: { ...meta.args.filing, cards: [meta.args.filing.cards[0]!] } },
}

/**
 * Accordée, et une carte avait bougé entre le dépôt et le clic : c'est `moved` qui dit
 * d'où elle est réellement partie, pas la colonne qu'affichait la proposition.
 */
export const Accordee: Story = {
  name: 'Accordée',
  args: {
    filing: {
      ...meta.args.filing,
      status: 'accepted',
      moved: [
        { number: 23, fromColumn: 'review', toColumn: 'done' },
        { number: 41, fromColumn: 'todo', toColumn: 'abandoned' },
      ],
    },
  },
}

/** Ce qui n'est pas une colonne : une parente, une échéance, des liens « bloque ». */
export const AutresChamps: Story = {
  name: 'Parente, échéance et blocages',
  args: {
    filing: {
      ...meta.args.filing,
      cards: [
        {
          cardId: 'k3',
          number: 67,
          title: 'Une colonne « À préciser » : la session clarifie la carte au lancement',
          fromColumn: 'todo',
          parent: { from: null, to: { cardId: 'k9', number: 75, title: 'Orchestrer le travail par cartes' } },
          dueAt: { from: null, to: new Date(2026, 10, 15).getTime() },
          reason: 'Le jalon #75 la liste dans son tableau, mais elle ne lui est pas rattachée.',
        },
        {
          cardId: 'k4',
          number: 69,
          title: 'Clore une carte finie : archiver et nettoyer',
          fromColumn: 'todo',
          blocks: [{ cardId: 'k5', number: 72, title: 'Lancer un jalon' }],
          reason: '#72 archive les conversations des cartes closes : il lui faut le geste de #69.',
        },
      ],
    },
  },
}

/**
 * Accordée, mais une carte avait changé d'échéance entre le dépôt et le clic : elle sort
 * du lot, et la ligne le dit.
 */
export const EnPartie: Story = {
  name: 'Accordée en partie',
  args: {
    filing: {
      ...meta.args.filing,
      status: 'accepted',
      moved: [{ number: 23, fromColumn: 'in_progress', toColumn: 'done' }],
      applied: [23],
    },
  },
}

/** Clore une carte finie (#69) : ce que le clic archivera, retirera et supprimera. */
const closing = {
  cardId: 'k6',
  number: 69,
  title: 'Clore une carte finie : archiver et nettoyer',
  fromColumn: 'done' as const,
  close: { conversations: 2, worktrees: ['feat/clore-une-carte'], abandon: [], branch: null },
  reason: 'PR #57 fusionnée dans main ; la clôture essayée sur une carte de test archive et nettoie comme prévu.',
}

export const Cloture: Story = {
  name: 'Clôture',
  args: { filing: { ...meta.args.filing, cards: [closing] } },
}

/** Une parente dont deux enfants restent ouvertes : la demande les nomme, le clic les abandonne. */
export const ClotureParente: Story = {
  name: 'Clôture d’une parente, avec abandons',
  args: {
    filing: {
      ...meta.args.filing,
      cards: [
        {
          cardId: 'k9',
          number: 75,
          title: 'Orchestrer le travail par cartes',
          fromColumn: 'in_progress',
          toColumn: 'done',
          close: {
            conversations: 3,
            worktrees: ['feat/lancer-un-jalon', 'feat/onglet-agents'],
            abandon: [
              { cardId: 'k10', number: 72, title: 'Lancer un jalon' },
              { cardId: 'k11', number: 74, title: 'Revoir l’onglet Agents' },
            ],
            branch: 'jalon/75-orchestrer',
          },
          reason: "Tim a renoncé à #72 et #74 pour ce jalon ; le reste est fusionné dans main.",
        },
      ],
    },
  },
}

/** Accordée : ce qui a été fait, et ce qui est resté en place faute d'être poussé. */
export const ClotureAccordee: Story = {
  name: 'Clôture accordée',
  args: {
    filing: {
      ...meta.args.filing,
      cards: [closing],
      status: 'accepted',
      applied: [69],
      closed: [
        {
          number: 69,
          archived: 2,
          removed: ['feat/clore-une-carte'],
          kept: [{ name: 'feat/clore-essai', reason: 'unpushed' }],
          deleted: ['feat/clore-une-carte'],
          abandoned: [],
        },
      ],
    },
  },
}

export const Refusee: Story = {
  name: 'Refusée',
  args: { filing: { ...meta.args.filing, status: 'refused' } },
}

/** Revérifié au clic : plus aucune des cartes ne pouvait bouger. */
export const Impossible: Story = {
  args: { filing: { ...meta.args.filing, status: 'impossible', reason: 'cards_gone' } },
}

/** Le propriétaire du fil qui ne possède pas le projet : il voit, il ne tranche pas. */
export const SansDroit: Story = {
  name: 'Sans droit de décider',
  args: { canDecide: false },
}

/** Revérifié au clic (#119) : le fil a changé de projet depuis la proposition. */
export const PlusApplicable: Story = {
  name: 'Plus applicable',
  args: { filing: { ...meta.args.filing, status: 'impossible', reason: 'project_changed' } },
}
