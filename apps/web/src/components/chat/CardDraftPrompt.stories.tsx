import type { Meta, StoryObj } from '@storybook/react-vite'
import { CardDraftPrompt } from './CardDraftPrompt'

const meta = {
  title: "Composants d'application/CardDraftPrompt",
  component: CardDraftPrompt,
  parameters: {
    docs: {
      description: {
        component:
          "Le brouillon d'un découpage en cartes (#70) : l'utilisateur a dicté un chantier en vrac, l'agent a lu le board et le code, et propose une parente et ses cartes enfants.\n\n**Rien n'existe sur le board avant « Créer ».** Le bloc corrige ce qui se corrige d'un geste : un titre, une description, des sous-tâches, une carte ou un lien en trop. Fusionner, ajouter ou réorganiser se demande à l'agent dans le fil, qui redépose un brouillon entier ; l'ancien passe alors en « Remplacé ».\n\n**Les liens « Après » sont des liens « bloque »**, vers une autre carte du brouillon ou une carte existante. Une correction qui fait tourner les dépendances en boucle grise « Créer ». Les cartes « Liée à » sont celles que l'agent a trouvées proches sur le board : elles seront liées, pas recréées.\n\nLe bouton n'apparaît qu'au propriétaire du projet : c'est son board que le brouillon remplit.",
      },
    },
  },
  args: {
    conversationId: 'c1',
    canDecide: true,
    item: {
      kind: 'cardDraft',
      id: 'r1',
      status: 'pending',
      reason: null,
      parent: null,
      created: [],
      draft: {
        parent: { kind: 'new', title: 'Découper en cartes depuis une dictée', description: 'La cible du jalon.', dueAt: null },
        cards: [
          {
            key: 'api',
            title: 'Le brouillon dans le protocole et le daemon',
            description: 'Le schéma `CardDraft`, l’outil `propose_cards` et la route de validation.',
            subtasks: ['Le schéma et le fold', 'La route de validation'],
            after: [],
            blockedBy: [{ cardId: 'k66', number: 66, title: 'Ce qu’un agent fait avec les cartes' }],
            related: [],
          },
          {
            key: 'ui',
            title: 'Le bloc éditable dans le fil',
            description: 'Renommer, retirer, décocher un lien, puis créer.',
            subtasks: [],
            after: ['api'],
            blockedBy: [],
            related: [{ cardId: 'k71', number: 71, title: 'Promouvoir une sous-tâche en carte' }],
          },
          {
            key: 'entry',
            title: 'L’entrée « Découper en cartes » sur le board et dans la palette',
            description: '',
            subtasks: [],
            after: ['api'],
            blockedBy: [],
            related: [],
          },
        ],
      },
    },
  },
} satisfies Meta<typeof CardDraftPrompt>

export default meta
type Story = StoryObj<typeof meta>

/** Un jalon neuf et trois cartes, dont deux attendent la première. */
export const Attente: Story = {}

/** Sous une carte existante, celle d'où le découpage est parti. */
export const SousUneCarte: Story = {
  name: 'Sous une carte existante',
  args: {
    item: {
      ...meta.args.item,
      draft: { ...meta.args.item.draft, parent: { kind: 'existing', card: { cardId: 'k70', number: 70, title: 'Découper en cartes' } } },
    },
  },
}

/** Créé : chaque carte porte son numéro, et mène au board. */
export const Cree: Story = {
  name: 'Créé',
  args: {
    item: {
      ...meta.args.item,
      status: 'created',
      parent: { cardId: 'k120', number: 120, title: 'Découper en cartes depuis une dictée' },
      created: [
        { key: 'api', cardId: 'k121', number: 121, title: 'Le brouillon dans le protocole et le daemon' },
        { key: 'ui', cardId: 'k122', number: 122, title: 'Le bloc éditable dans le fil' },
        { key: 'entry', cardId: 'k123', number: 123, title: 'L’entrée « Découper en cartes » sur le board et dans la palette' },
      ],
    },
  },
}

/** Remplacé par une version suivante : il reste lisible, sans bouton. */
export const Remplace: Story = {
  name: 'Remplacé',
  args: { item: { ...meta.args.item, status: 'superseded' } },
}

/** Vu par un autre membre du projet : il lit, le propriétaire tranche. */
export const AutreMembre: Story = {
  name: 'Vu par un autre membre',
  args: { canDecide: false },
}

/** Retiré avec son fil, archivé avant le clic (#119). */
export const PlusApplicable: Story = {
  name: 'Plus applicable',
  args: { item: { ...meta.args.item, status: 'impossible', reason: 'conversation_archived' } },
}
