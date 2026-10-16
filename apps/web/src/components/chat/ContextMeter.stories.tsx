import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ContextState } from '../../lib/chat-fold'
import { ContextButton, ContextMeter } from './ContextMeter'

const meta = {
  title: "Composants d'application/ContextMeter",
  component: ContextMeter,
  parameters: {
    docs: {
      description: {
        component:
          "L'occupation de la fenêtre de contexte, et le détail qu'elle ouvre.\n\nDistincte du quota d'abonnement (`UsageBar`) : celle-ci se vide à chaque nouvelle conversation, et c'est elle qui décide du moment où il faudra compacter.\n\n**Un repère cliquable doit dire ce que le clic fera**, et c'est ce qui avait gardé la jauge inerte longtemps. L'objection est levée par le contenu de la modale, qui explique l'état de la fenêtre avant de proposer quoi que ce soit, et par l'intitulé du bouton, qui annonce un détail et pas une action.\n\n**Un seul écran, trois profondeurs.** Les trois CLI ne mesurent pas la même chose, et on assume la différence plutôt que de les rabattre sur le plus petit dénominateur commun. La partie haute — total, pourcentage, modèle, bouton Compacter — est commune ; seule la partie basse change d'axe. Rien n'y est estimé : un CLI qui ne dit pas ce qui occupe sa fenêtre le dit, au lieu d'afficher un découpage inventé.\n\nLes seuils de ton (0,75 et 0,9) sont un **choix d'affichage**, comme ceux d'`UsageBar` : aucun CLI ne déclare de niveau de gravité.",
      },
    },
  },
  args: { context: { usedTokens: 38_000, maxTokens: 200_000, ratio: 0.19, breakdown: null } },
} satisfies Meta<typeof ContextMeter>

export default meta
type Story = StoryObj<typeof meta>

/** Le dessin seul, sans ce que l'appelant en fait. */
export const Bac: Story = {}

export const LesTroisTons: Story = {
  name: 'Les trois tons',
  render: () => (
    <div className="flex items-center gap-6">
      {[0.19, 0.81, 0.96].map((ratio) => (
        <ContextMeter
          key={ratio}
          context={{
            usedTokens: Math.round(ratio * 200_000),
            maxTokens: 200_000,
            ratio,
            breakdown: null,
          }}
        />
      ))}
    </div>
  ),
}

/**
 * Claude découpe la fenêtre par catégorie de contenu — la table de `/context`, lue par
 * requête de contrôle. Les chiffres viennent d'un relevé réel : les lignes occupées
 * tombent sur le total, le tampon et l'espace libre complètent la fenêtre, et les
 * schémas d'outils laissés hors fenêtre sont listés sans y entrer.
 */
const claude: ContextState = {
  usedTokens: 19_813,
  maxTokens: 1_000_000,
  ratio: 0.019813,
  breakdown: {
    axis: 'categories',
    categories: [
      { label: 'System tools', tokens: 4618, kind: 'used' },
      { label: 'Memory files', tokens: 44, kind: 'used' },
      { label: 'Skills', tokens: 5463, kind: 'used' },
      { label: 'Messages', tokens: 9688, kind: 'used' },
      { label: 'MCP tools (deferred)', tokens: 8057, kind: 'deferred' },
      { label: 'System tools (deferred)', tokens: 13_450, kind: 'deferred' },
      { label: 'Autocompact buffer', tokens: 33_000, kind: 'buffer' },
      { label: 'Free space', tokens: 947_187, kind: 'free' },
    ],
    memoryFiles: [{ name: '/w/solera/CLAUDE.md', source: 'Project', tokens: 44 }],
    mcpTools: [
      { name: 'mcp__solera__read_card', source: 'solera', tokens: 310 },
      { name: 'mcp__solera__start_session', source: 'solera', tokens: 268 },
      { name: 'mcp__solera__list_cards', source: 'solera', tokens: 120 },
    ],
    agents: [{ name: 'Explore', source: 'projectSettings', tokens: 220 }],
    skills: [
      { name: 'dataviz', source: 'built-in', tokens: 482 },
      { name: 'anthropic-skills:docs', source: 'syncedSkills', tokens: 343 },
      { name: 'solera:code-review', source: 'plugin', tokens: 269 },
    ],
  },
}

/**
 * Codex ne dit rien de ce qui occupe sa fenêtre : ce qu'il compte, c'est la **nature**
 * des jetons. Le cumul du fil est donné à part parce qu'il n'est pas une occupation —
 * rapporté à la fenêtre, il dépasserait 100 % sans jamais redescendre, pas même après
 * une compaction.
 */
const codex: ContextState = {
  usedTokens: 12_000,
  maxTokens: 272_000,
  ratio: 12_000 / 272_000,
  breakdown: {
    axis: 'tokens',
    last: {
      totalTokens: 13_200,
      inputTokens: 12_000,
      cachedInputTokens: 9000,
      cacheWriteInputTokens: 1500,
      outputTokens: 1200,
      reasoningOutputTokens: 800,
    },
    total: {
      totalTokens: 38_794,
      inputTokens: 34_000,
      cachedInputTokens: 25_000,
      cacheWriteInputTokens: 4000,
      outputTokens: 4794,
      reasoningOutputTokens: 3100,
    },
  },
}

/** opencode additionne entrée, cache lu et cache écrit contre une limite, et c'est tout. */
const opencode: ContextState = {
  usedTokens: 84_300,
  maxTokens: 128_000,
  ratio: 84_300 / 128_000,
  breakdown: null,
}

export const TroisProfondeurs: Story = {
  name: 'Trois profondeurs',
  parameters: {
    docs: {
      description: {
        story:
          'Le détail est derrière le clic, comme dans la barre de saisie : les trois boutons ouvrent la même modale, et ce sont les trois CLI qui diffèrent, pas le gabarit.',
      },
    },
  },
  render: () => (
    <div className="flex flex-col gap-5">
      {[
        { label: 'Claude · par catégorie', context: claude, model: 'Opus 5' },
        { label: 'Codex · par nature de jeton', context: codex, model: 'GPT-5 Codex' },
        { label: 'opencode · rien de plus', context: opencode, model: 'Sonnet 5' },
      ].map((cas) => (
        /*
         * `@container`, et large d'au moins 22 rem sans pouvoir rétrécir : sous cette
         * largeur la jauge cède sa place aux commandes de la rangée, et sans conteneur
         * du tout elle reste `hidden` pour toujours. C'est le genre de dépendance à un
         * parent lointain qu'un catalogue doit faire apparaître, et il l'a fait dès la
         * première capture — les trois boutons y étaient invisibles.
         */
        <div key={cas.label} className="@container flex w-[24rem] shrink-0 flex-col items-start gap-1">
          <span className="text-meta text-ink-faint">{cas.label}</span>
          <ContextButton context={cas.context} model={cas.model} onCompact={() => {}} canCompact />
        </div>
      ))}
    </div>
  ),
}

export const CompactionIndisponible: Story = {
  name: 'Compaction indisponible',
  parameters: {
    docs: {
      description: {
        story:
          "Compacter au milieu d'un tour résumerait un état que l'agent est en train de changer : le bouton reste là, inerte, plutôt que de disparaître. Même traitement pour une conversation lue sans y écrire, où la plomberie manque.",
      },
    },
  },
  render: () => (
    <div className="@container w-[24rem]">
      <ContextButton context={claude} model="Opus 5" canCompact={false} />
    </div>
  ),
}
