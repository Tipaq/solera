import type { Meta, StoryObj } from '@storybook/react-vite'
import type { JournalEntryDto, JournalKind } from '@solera/protocol'
import { JournalRow } from './JournalView'

const meta = {
  title: "Composants d'application/La ligne du journal",
  component: JournalRow,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          "Une ligne du *Journal* (F5, F11), et les sept natures qu'elle prend.\n\n**La colonne de droite est fixe** : provenance puis heure, au même endroit sur chaque ligne. C'est elle qui rend la liste lisible de haut en bas quand sept natures se mélangent — l'œil descend une colonne alignée au lieu de chercher l'heure derrière un titre de longueur variable. Le libellé et le titre, eux, flottent : mettre le libellé en colonne fixe creuserait une gouttière vide large comme « TIR PLANIFIÉ ».\n\n**Deux teintes seulement**, et elles ne sont pas décoratives : ce qui ferme un chantier, ce qui a échoué. Une teinte par source ferait un sapin de Noël où plus rien ne ressort.\n\n**Il n'y a pas de ligne `DÉCISION`**, que la maquette montrait : `card_notes.body` est un champ libre et la carte #32 a refusé de lui donner un type le 2026-10-15. Un `kind` rempli au jugé par les agents étiquetterait tout « décision », et un tri auquel on ne peut pas se fier est pire qu'un tri absent. Le journal écrit `NOTE`, et la pilule de filtre dit *Notes*.\n\nUne ligne qui n'ouvre rien — une fusion faite au terminal, un audit versé sur le disque — n'est pas un lien : Solera n'a pas de page pour elle, et une ligne morte qui *a l'air* cliquable est pire qu'une ligne qui ne l'a pas.",
      },
    },
  },
} satisfies Meta<typeof JournalRow>

export default meta
type Story = StoryObj<typeof meta>

const base = {
  projectId: 'solera',
  cardNumber: null,
  source: null,
  count: null,
  status: null,
  conversationId: null,
} satisfies Omit<JournalEntryDto, 'id' | 'kind' | 'at' | 'title'>

const at = (hour: number, minute: number): number => {
  const date = new Date()
  date.setHours(hour, minute, 0, 0)
  return date.getTime()
}

const ENTRIES: JournalEntryDto[] = [
  {
    ...base,
    id: 'note',
    kind: 'note',
    at: at(14, 20),
    title: 'Un agent déclare un projet ; l’utilisateur accorde le rangement',
    cardNumber: 23,
    source: 'grill complet',
    conversationId: 'c1',
  },
  {
    ...base,
    id: 'audit',
    kind: 'audit',
    at: at(11, 5),
    title: 'docs/audits/2026-10-14-bundle-web — le bundle frôle la limite',
  },
  {
    ...base,
    id: 'opened',
    kind: 'cardOpened',
    at: at(9, 40),
    title: 'Décider le gréement d’autorisation des outils de Solera',
    cardNumber: 24,
  },
  {
    ...base,
    id: 'closed',
    kind: 'cardClosed',
    at: at(23, 10),
    title: 'Fusionner les quatre branches de la colonne',
    cardNumber: 17,
    count: 1,
  },
  {
    ...base,
    id: 'branch',
    kind: 'branch',
    at: at(18, 30),
    title: 'feat/rangement-par-agent',
    cardNumber: 23,
    count: 12,
  },
  {
    ...base,
    id: 'session',
    kind: 'session',
    at: at(8, 15),
    title: 'Porter le Journal : la route serveur, puis les deux pages',
    cardNumber: 33,
    source: 'claude',
    conversationId: 'c2',
  },
  {
    ...base,
    id: 'run',
    kind: 'run',
    at: at(7, 0),
    title: 'Veille des CLI — Claude Code 2.1.4 disponible',
    status: 'succeeded',
  },
]

/** Les sept natures, telles qu'un jour chargé les mêle. */
export const LesSeptNatures: Story = {
  args: { entry: ENTRIES[0] as JournalEntryDto },
  render: () => (
    <ul className="flex flex-col gap-1.5">
      {ENTRIES.map((entry) => (
        <JournalRow key={entry.id} entry={entry} />
      ))}
    </ul>
  ),
}

/** Un tir en échec : la seconde des deux teintes, et la seule qui alerte. */
export const UnTirEnEchec: Story = {
  args: {
    entry: {
      ...base,
      id: 'failed',
      kind: 'run' as JournalKind,
      at: at(6, 0),
      title: 'Veille des CLI — le dépôt n’a pas répondu',
      status: 'failed',
    },
  },
  render: (args) => (
    <ul className="flex flex-col gap-1.5">
      <JournalRow {...args} />
    </ul>
  ),
}

/** Au portefeuille, une pastille de projet ouvre la ligne, et c'est la seule différence. */
export const AuPortefeuille: Story = {
  args: { entry: ENTRIES[0] as JournalEntryDto },
  render: () => (
    <ul className="flex flex-col gap-1.5">
      {ENTRIES.slice(0, 4).map((entry) => (
        <JournalRow
          key={entry.id}
          entry={entry}
          projects={[{ id: 'solera', image: null, color: 'oklch(0.62 0.19 285)' }]}
        />
      ))}
    </ul>
  ),
}
