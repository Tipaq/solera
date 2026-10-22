import { BookOpen, Box, Brain, Clock, Columns3, Compass, FilePen, FolderInput, Globe, IdCard, MessageCircleQuestion, MessageSquareText, ShieldCheck, Sparkles, SquareTerminal, UserRoundSearch, UsersRound, Zap } from 'lucide-react'
import { cloneElement, useMemo, type ReactElement, type ReactNode } from 'react'
import {
  CLI_DEFAULT,
  claudeEffortSchema,
  codexModeSchema,
  DEFAULT_CLAUDE_CONFIG,
  type AgentConfig,
  type AgentModelDto,
  type ClaudeConfig,
  type CodexApprovalName,
  type CodexConfig,
  type CodexMode,
  type GrokConfig,
  type McpServerStatus,
  type OpencodePermission,
  type OpencodePermissions,
} from '@solera/protocol'
import { catalogModel, effortLabel, effortsFor, supportsFastMode, useAgentModels } from '../../lib/agents'
import { useClaudeAccounts } from '../../lib/claude-accounts'
import { useCodexAccounts } from '../../lib/codex-accounts'
import { useGrokAccounts } from '../../lib/grok-accounts'
import { useMcpServers } from '../../lib/mcp'
import { useSkillLibrary } from '../../lib/skill-library'
import { useTranslate, type MessageKey, type MessageParams } from '../../lib/i18n'
import {
  setting,
  type SettingChoice,
  type SettingGroup,
  type SettingOption,
  type SummarySegment,
} from './ComposerSettings'
import { McpControl, mcpSummaryOf, type McpControlProps } from './McpControl'
import { modelIdName, shortModelLabel, shortModelName } from './ModelControl'

/**
 * Réglages d'une configuration d'agent, sous la forme de catégories d'options.
 *
 * Partagé par le composer, qui règle une conversation, et l'écran des défauts de
 * compte, qui règle avec quoi les suivantes s'ouvriront. Les deux posent exactement la
 * même question au même objet : dupliquer la liste des modes de permission ou la
 * gestion des sentinelles aurait garanti que les deux écrans divergent.
 *
 * Ce module produit des données, pas une disposition : le composer les empile dans un
 * panneau à plat, la page de réglages les déplie. Seul le contrôle MCP arrive
 * déjà rendu, n'étant pas un choix unique parmi une liste.
 */

/** Traduction, passée aux fabriques d'options qui vivent hors du composant. */
type Translate = (key: MessageKey, params?: MessageParams) => string

function permissionOptions(t: Translate): SettingChoice<ClaudeConfig['permissionMode']>[] {
  return [
    { value: 'manual', label: t('composer.permission.manual'), hint: t('composer.permission.manual.hint') },
    { value: 'auto', label: t('composer.permission.auto'), hint: t('composer.permission.auto.hint') },
    {
      value: 'acceptEdits',
      label: t('composer.permission.acceptEdits'),
      hint: t('composer.permission.acceptEdits.hint'),
    },
    { value: 'plan', label: t('composer.permission.plan'), hint: t('composer.permission.plan.hint') },
    {
      value: 'dontAsk',
      label: t('composer.permission.dontAsk'),
      hint: t('composer.permission.dontAsk.hint'),
    },
    {
      value: 'bypassPermissions',
      label: t('composer.permission.bypass'),
      hint: t('composer.permission.bypass.hint'),
      tone: 'caution',
    },
  ]
}

/**
 * Modes de Grok Build. Ses noms recopient ceux de Claude Code, à `manual` près, qu'il
 * appelle `default` : les libellés de Claude servent donc, sauf l'automatique, dont
 * l'indice nomme l'agent qui décide. Tous se changent à chaud.
 */
function grokPermissionOptions(t: Translate): SettingChoice<GrokConfig['permissionMode']>[] {
  return [
    { value: 'default', label: t('composer.permission.manual'), hint: t('composer.permission.manual.hint') },
    { value: 'auto', label: t('composer.permission.auto'), hint: t('composer.grokPermission.auto.hint') },
    { value: 'plan', label: t('composer.permission.plan'), hint: t('composer.permission.plan.hint') },
    {
      value: 'bypassPermissions',
      label: t('composer.permission.bypass'),
      hint: t('composer.permission.bypass.hint'),
      tone: 'caution',
    },
  ]
}

type WebSearchChoice = 'on' | 'off'

function webSearchOptions(t: Translate): SettingChoice<WebSearchChoice>[] {
  return [
    { value: 'on', label: t('composer.webSearch.on'), hint: t('composer.webSearch.on.hint') },
    { value: 'off', label: t('composer.webSearch.off'), hint: t('composer.webSearch.off.hint') },
  ]
}

/**
 * Valeur d'affichage de la sentinelle `CLI_DEFAULT` dans le sélecteur d'approbation.
 * Laisser Codex appliquer sa propre politique est un état réel du protocole
 * (`approvalPolicy: null`), pas un trou : il mérite d'être nommé et sélectionnable.
 */
const CLI_DEFAULT_CHOICE = 'cli-default'

type ApprovalChoice = CodexApprovalName | typeof CLI_DEFAULT_CHOICE | 'granular'

/**
 * Vocabulaire natif de Codex, volontairement non aligné sur celui de Claude : les
 * deux CLI n'ont pas les mêmes concepts, et inventer une abstraction commune
 * mentirait sur ce qui se passe réellement.
 */
function codexApprovalOptions(t: Translate): SettingChoice<ApprovalChoice>[] {
  return [
    {
      value: CLI_DEFAULT_CHOICE,
      label: t('composer.approval.cliDefault'),
      hint: t('composer.approval.cliDefault.hint'),
    },
    {
      value: 'untrusted',
      label: t('composer.approval.untrusted'),
      hint: t('composer.approval.untrusted.hint'),
    },
    {
      value: 'on-request',
      label: t('composer.approval.onRequest'),
      hint: t('composer.approval.onRequest.hint'),
    },
    {
      value: 'never',
      label: t('composer.approval.never'),
      hint: t('composer.approval.never.hint'),
      tone: 'caution',
    },
  ]
}

/**
 * Le mode rapide de Claude Code, en deux valeurs plutôt qu'une case à cocher : le
 * panneau ne connaît que des listes, et « Standard » mérite d'être nommé autant que
 * « Rapide », puisque c'est le tarif qui les sépare.
 */
type SpeedChoice = 'standard' | 'fast'

function speedOptions(t: Translate): SettingChoice<SpeedChoice>[] {
  return [
    { value: 'standard', label: t('composer.speed.standard'), hint: t('composer.speed.standard.hint') },
    { value: 'fast', label: t('composer.speed.fast'), hint: t('composer.speed.fast.hint') },
  ]
}

/**
 * Ultracode, en deux valeurs pour la même raison que la vitesse. L'allumé porte le ton
 * de mise en garde : il lance des workflows multi-agents à chaque tâche de fond, et le
 * résumé doit le montrer tant qu'il dépense.
 */
type UltracodeChoice = 'off' | 'on'

function ultracodeOptions(t: Translate): SettingChoice<UltracodeChoice>[] {
  return [
    { value: 'off', label: t('composer.ultracode.off'), hint: t('composer.ultracode.off.hint') },
    { value: 'on', label: t('composer.ultracode.on'), hint: t('composer.ultracode.on.hint'), tone: 'caution' },
  ]
}

/**
 * La bibliothèque de skills de Solera, livrée ou non à la session. Un choix à deux
 * valeurs plutôt qu'une case, pour se ranger avec les autres réglages du panneau.
 */
type LibraryChoice = 'on' | 'off'

function skillLibraryOptions(t: Translate): SettingChoice<LibraryChoice>[] {
  return [
    { value: 'on', label: t('composer.skillLibrary.on'), hint: t('composer.skillLibrary.on.hint') },
    { value: 'off', label: t('composer.skillLibrary.off'), hint: t('composer.skillLibrary.off.hint') },
  ]
}

const libraryChoice = (enabled: boolean): LibraryChoice => (enabled ? 'on' : 'off')

/**
 * La mémoire de Solera, prêtée ou non à la session.
 *
 * Accordée en premier et sans ton de mise en garde, à la différence du rangement : c'est
 * une capacité qu'on retire pour le sujet qu'on ne veut pas voir orienter les suivants,
 * pas une portée qu'on accorde. « Éteinte » et non « Démontée » parce que c'est vrai des
 * trois CLI, Claude compris, qui reçoit `autoMemoryEnabled: false` et n'a donc pas de
 * dossier de repli où continuer d'écrire.
 */
type MemoryChoice = 'on' | 'off'

function agentMemoryOptions(t: Translate): SettingChoice<MemoryChoice>[] {
  return [
    { value: 'on', label: t('composer.agentMemory.on'), hint: t('composer.agentMemory.on.hint') },
    { value: 'off', label: t('composer.agentMemory.off'), hint: t('composer.agentMemory.off.hint') },
  ]
}

const memoryChoice = (enabled: boolean): MemoryChoice => (enabled ? 'on' : 'off')

/**
 * Le rangement de projet : déclarer un projet, et demander le déplacement d'une
 * conversation. Deux valeurs comme les réglages voisins, et l'allumé porte le ton de
 * mise en garde — c'est une portée qui agit au-dessus du projet où la session travaille.
 */
type FilingChoice = 'on' | 'off'

function projectFilingOptions(t: Translate): SettingChoice<FilingChoice>[] {
  return [
    { value: 'off', label: t('composer.projectFiling.off'), hint: t('composer.projectFiling.off.hint') },
    { value: 'on', label: t('composer.projectFiling.on'), hint: t('composer.projectFiling.on.hint'), tone: 'caution' },
  ]
}

const filingChoice = (enabled: boolean): FilingChoice => (enabled ? 'on' : 'off')

/**
 * Le rangement de carte : proposer le déplacement d'une carte du board, en disant
 * pourquoi. Même forme et même ton que le rangement de projet — une portée qu'on accorde,
 * pas une capacité qu'on retire —, et la même raison : la colonne d'une carte est un choix
 * qu'une personne a posé.
 */
function cardFilingOptions(t: Translate): SettingChoice<FilingChoice>[] {
  return [
    { value: 'off', label: t('composer.cardFiling.off'), hint: t('composer.cardFiling.off.hint') },
    { value: 'on', label: t('composer.cardFiling.on'), hint: t('composer.cardFiling.on.hint'), tone: 'caution' },
  ]
}

/**
 * Les décisions : demander à une personne de trancher, sans attendre (`request_decision`).
 *
 * Un seul réglage pour l'interrupteur et le délai maximal, plutôt qu'un interrupteur et
 * un champ : « refusées » ou « accordées, X h au plus » se lisent d'une seule valeur, et
 * trois délais couvrent les usages — une demi-journée, une journée, un week-end. Un
 * délai posé ailleurs (par l'API) reste choisissable plutôt que d'être réécrit en silence.
 */
const DECISION_HOURS = [4, 24, 72]

function decisionOptions(t: Translate, current: number): SettingChoice<string>[] {
  const hours = DECISION_HOURS.includes(current) ? DECISION_HOURS : [...DECISION_HOURS, current].sort((a, b) => a - b)
  return [
    { value: 'off', label: t('composer.decisions.off'), hint: t('composer.decisions.off.hint') },
    ...hours.map((value) => ({
      value: String(value),
      label: t('composer.decisions.on', { hours: value }),
      hint: t('composer.decisions.on.hint'),
      tone: 'caution' as const,
    })),
  ]
}

const decisionChoice = (config: { decisions: boolean; decisionMaxHours: number }): string =>
  config.decisions ? String(config.decisionMaxHours) : 'off'

function decisionsSetting<C extends AgentConfig>(
  current: C,
  applied: C | null,
  onConfigChange: (config: C) => void,
  t: Translate,
): SettingGroup {
  const options = decisionOptions(t, current.decisionMaxHours)
  return setting({
    key: 'decisions',
    label: t('composer.setting.decisions'),
    icon: <MessageCircleQuestion size={14} />,
    options,
    value: decisionChoice(current),
    onChange: (choice) =>
      onConfigChange({
        ...current,
        decisions: choice !== 'off',
        decisionMaxHours: choice === 'off' ? current.decisionMaxHours : Number(choice),
      }),
    // L'outil est listé au lancement du serveur MCP : l'allumer ou l'éteindre attend la
    // relance de la session. Le délai, lui, est relu par le daemon à chaque dépôt.
    notice: notice(
      applied && applied.decisions !== current.decisions
        ? appliedLabel(decisionChoice(applied), decisionChoice(current), decisionOptions(t, applied.decisionMaxHours))
        : null,
      t,
    ),
  })
}

/**
 * Ce que l'envoi fait d'un message tapé pendant un tour : l'y pousser, ou le faire
 * attendre. Deux valeurs nommées plutôt qu'une case à cocher, parce que les deux
 * comportements méritent chacun leur phrase — l'un peut couper l'agent, l'autre peut
 * laisser le message attendre longtemps.
 */
type QueueChoice = 'steer' | 'queue'

function queueOptions(t: Translate): SettingChoice<QueueChoice>[] {
  return [
    { value: 'steer', label: t('composer.queue.steer'), hint: t('composer.queue.steer.hint') },
    { value: 'queue', label: t('composer.queue.queue'), hint: t('composer.queue.queue.hint') },
  ]
}

const queueChoice = (queued: boolean): QueueChoice => (queued ? 'queue' : 'steer')

function codexSandboxOptions(t: Translate): SettingChoice<CodexConfig['sandbox']>[] {
  return [
    { value: 'read-only', label: t('composer.sandbox.readOnly'), hint: t('composer.sandbox.readOnly.hint') },
    {
      value: 'workspace-write',
      label: t('composer.sandbox.workspaceWrite'),
      hint: t('composer.sandbox.workspaceWrite.hint'),
    },
    {
      value: 'danger-full-access',
      label: t('composer.sandbox.fullAccess'),
      hint: t('composer.sandbox.fullAccess.hint'),
      tone: 'caution',
    },
  ]
}

/**
 * Règle d'opencode pour une famille d'outils, dans son vocabulaire : demander, laisser
 * faire, refuser. La sentinelle `CLI_DEFAULT` est un état réel, celui où Solera ne pose
 * aucune règle et où l'`opencode.json` du poste décide : elle a son entrée, comme la
 * politique d'approbation de Codex.
 */
type OpencodePermissionChoice = Exclude<OpencodePermission, ''> | typeof CLI_DEFAULT_CHOICE

function opencodePermissionOptions(t: Translate): SettingChoice<OpencodePermissionChoice>[] {
  return [
    { value: 'ask', label: t('composer.opencodePermission.ask'), hint: t('composer.opencodePermission.ask.hint') },
    {
      value: 'allow',
      label: t('composer.opencodePermission.allow'),
      hint: t('composer.opencodePermission.allow.hint'),
      tone: 'caution',
    },
    { value: 'deny', label: t('composer.opencodePermission.deny'), hint: t('composer.opencodePermission.deny.hint') },
    {
      value: CLI_DEFAULT_CHOICE,
      label: t('composer.opencodePermission.cliDefault'),
      hint: t('composer.opencodePermission.cliDefault.hint'),
    },
  ]
}

const opencodePermissionChoice = (value: OpencodePermission): OpencodePermissionChoice =>
  value === CLI_DEFAULT ? CLI_DEFAULT_CHOICE : value

/** Les familles réglables, dans l'ordre du panneau, avec leur intitulé et leur icône. */
const OPENCODE_PERMISSIONS: { family: keyof OpencodePermissions; label: MessageKey; icon: ReactElement }[] = [
  { family: 'edit', label: 'composer.setting.opencodeEdit', icon: <FilePen size={14} /> },
  { family: 'bash', label: 'composer.setting.opencodeBash', icon: <SquareTerminal size={14} /> },
  { family: 'webfetch', label: 'composer.setting.opencodeWebfetch', icon: <Globe size={14} /> },
]

/**
 * La ligne nommée que la ligne par défaut du catalogue désigne, appariée par
 * l'identifiant canonique que les deux partagent.
 *
 * Claude Code appelle la sienne « Default (recommended) », ce qui est long et ne dit
 * pas qui répondra. La jumelle, elle, porte un nom lisible : c'est le sien que la ligne
 * par défaut emprunte, pour s'annoncer « Défaut : Opus 5 » au lieu de taire sa
 * génération. Les deux lignes restent dans la liste — choisir « suis ce que le CLI
 * recommande » et choisir ce modèle-là nommément sont deux gestes différents, et seul
 * le premier suivra le CLI quand il changera d'avis.
 *
 * Null quand il n'y a pas de jumelle : Codex et opencode posent `isDefault` sur un vrai
 * modèle de leur catalogue, qui porte alors son propre nom sans emprunt.
 */
function namedTwinOf(models: AgentModelDto[], row: AgentModelDto): AgentModelDto | null {
  if (!row.hint) return null
  return models.find((model) => !model.isDefault && model.hint === row.hint) ?? null
}

/**
 * Le libellé de la valeur que la session applique encore, quand ce n'est pas celle
 * qui est choisie. Null quand les deux coïncident, donc partout sauf entre un réglage
 * que le CLI refuse de changer en vol et le redémarrage qui le prend en compte.
 *
 * Un libellé et non un drapeau : « en attente » ne dit pas sous quel régime le tour se
 * déroule, ce qu'on cherche justement à savoir quand on vient de poser ou de lever un
 * garde-fou.
 */
function appliedLabel(
  applied: string | undefined,
  chosen: string,
  options: SettingOption[],
): string | null {
  if (applied === undefined || applied === chosen) return null
  return options.find((option) => option.value === applied)?.label ?? applied
}

/** La mention posée sur la ligne du réglage, absente quand rien n'attend. */
function notice(applied: string | null, t: Translate): string | undefined {
  return applied === null ? undefined : t('composer.setting.pending', { value: applied })
}

/** Voir `appliedLabel` : la même comparaison, pour la rangée de signaux. */
export function appliedPermissionLabel(
  config: AgentConfig,
  applied: AgentConfig | null,
  t: Translate,
): string | null {
  if (config.agent !== 'claude' || applied?.agent !== 'claude') return null
  return appliedLabel(applied.permissionMode, config.permissionMode, permissionOptions(t))
}

export interface AgentSettings {
  /** Les catégories, dans l'ordre où on les change. */
  groups: SettingGroup[]
  /** Valeurs annoncées par l'accès complet et états de permissions à garder visibles. */
  summary: SummarySegment[]
  /** Serveurs MCP et isolation stricte, déjà rendus. */
  mcp: ReactNode
  /** Les mêmes contrôles MCP, dépliés dans la vue complète du composer. */
  mcpPanel: ReactNode
  /** Les mêmes encore, en entrées de menu, pour le sous-menu du pointeur. */
  mcpItems: ReactNode
  /** Résumé des serveurs, pour l'entrée de menu qui mène au contrôle. */
  mcpSummary: string
  /** Le CLI n'a pas répondu : la liste des modèles se réduit à ce qui est enregistré. */
  catalogError: Error | null
}

interface AgentSettingsParams {
  config: AgentConfig
  onConfigChange: (config: AgentConfig) => void
  /**
   * Configuration sous laquelle le CLI tourne réellement, `null` à froid ou hors d'une
   * conversation lancée. Ce qui y diffère de `config` est un réglage choisi que la
   * session n'a pas pu adopter en vol et qui attend son redémarrage.
   */
  appliedConfig?: AgentConfig | null
  /**
   * Inventaire MCP rapporté par la session en cours. Absent hors d'une conversation
   * lancée : le contrôle retombe alors sur ce que la configuration décrit.
   */
  mcpInventory?: McpServerStatus[]
  disabled?: boolean
}

/** Référence stable : un tableau littéral par défaut relancerait le rendu du contrôle. */
const NO_INVENTORY: McpServerStatus[] = []

export function useAgentSettings({
  config,
  onConfigChange,
  appliedConfig = null,
  mcpInventory = NO_INVENTORY,
  disabled = false,
}: AgentSettingsParams): AgentSettings {
  const t = useTranslate()
  // Une seule sonde, celle de l'agent visé : chaque sonde démarre le CLI correspondant
  // côté serveur.
  const { data: catalog, error: catalogError } = useAgentModels(config.agent)

  // Copies constantes de la configuration : TypeScript ne conserve pas l'affinement
  // d'un paramètre à l'intérieur des fonctions de rendu construites plus bas.
  const claude = config.agent === 'claude' ? config : null
  const codex = config.agent === 'codex' ? config : null
  const opencode = config.agent === 'opencode' ? config : null
  const grok = config.agent === 'grok' ? config : null

  /**
   * Modèle réellement en vigueur. `CLI_DEFAULT` ne désigne aucune entrée du catalogue :
   * l'afficher tel quel donnait un sélecteur vide et, faute de modèle trouvé, aucun
   * niveau d'effort. Le CLI annonce lequel de ses modèles il prendrait, c'est celui-là
   * que la barre montre. La configuration, elle, garde la sentinelle : c'est au serveur
   * de la résoudre au moment de créer la conversation.
   *
   * C'est bien la ligne par défaut qui est en vigueur, et non la jumelle qu'elle
   * désigne : les deux figurent dans la liste, et cocher la seconde quand on n'a rien
   * choisi ferait croire à un modèle épinglé là où on suit encore le CLI.
   */
  const defaultRow = catalog?.models.find((model) => model.isDefault)
  const resolvedModel = config.model || defaultRow?.value || CLI_DEFAULT

  const modelOptions = useMemo((): SettingChoice<string>[] => {
    const models = catalog?.models ?? []
    const known = models
      .map((model): SettingChoice<string> => {
        // Le nom court dit la famille et la génération — « Opus 5 » — là où le libellé
        // du CLI porte la variante de contexte ou la mention « recommandé ». Quand il
        // est lu sur l'identifiant, celui-ci n'a plus à être répété en dessous.
        const fromId = modelIdName(model.hint)
        const twin = model.isDefault ? namedTwinOf(models, model) : null
        const twinName = twin ? shortModelName(twin.hint, twin.displayName) : null
        return {
          value: model.value,
          // La liste dit le rang *et* le modèle — « Défaut : Opus 5 » — parce qu'on y
          // choisit entre les deux. La puce, elle, ne garde que le modèle : le rang
          // n'apprend rien à qui regarde la barre pour savoir qui va répondre, et
          // c'est de la place prise au seul mot qui compte. Le nom vient de la jumelle
          // et non de la ligne elle-même, dont le libellé — « Default (recommended) »
          // — est justement celui qu'on ne veut nulle part.
          label: twinName ? t('composer.model.defaultNamed', { model: twinName }) : model.displayName,
          listed: twinName ? t('composer.model.defaultNamed', { model: twinName }) : undefined,
          short: twinName ?? fromId ?? shortModelLabel(model.displayName),
          // `hint` porte la version réelle derrière un alias : sans elle, « Opus » ne
          // dit pas quelle génération va effectivement répondre. Le rappel « par
          // défaut » ne sert que si le libellé n'a pas déjà pu le dire.
          hint: [
            model.description,
            fromId ? null : model.hint,
            !twin && model.isDefault ? t('composer.model.default') : null,
          ]
            .filter(Boolean)
            .join(' · '),
        }
      })

    // Le modèle enregistré doit rester sélectionnable même si le catalogue n'a pas pu
    // être lu, sinon le select s'affiche vide et efface le réglage de la conversation.
    // Seulement s'il y a un réglage à préserver : la sentinelle n'en est pas un.
    // Un ancien nom d'un modèle toujours listé garde le nom lisible de celui-ci.
    if (config.model && !known.some((option) => option.value === config.model)) {
      const listed = catalogModel(models, config.model)
      known.unshift({
        value: config.model,
        label: listed?.displayName ?? config.model,
        short: shortModelName(listed?.hint, listed?.displayName ?? config.model),
        hint: [listed ? config.model : null, t('composer.select.saved')].filter(Boolean).join(' · '),
      })
    }
    return known
  }, [catalog, config.model, t])

  const effortOptions = useMemo((): SettingChoice<string>[] => {
    const known = effortsFor(catalog?.models, resolvedModel).map((effort) => ({
      value: effort.value,
      label: effortLabel(t, effort),
      hint: effort.hint ?? undefined,
    }))

    // Même règle que pour le modèle : le niveau enregistré reste sélectionnable et
    // lisible quand le catalogue ne le déclare pas (ou plus). Seulement si le modèle
    // gère l'effort : sinon le sélecteur n'a pas à exister.
    const current =
      config.agent === 'claude' ? config.effort : config.agent === 'opencode' ? config.variant : config.reasoningEffort
    if (known.length > 0 && current && !known.some((option) => option.value === current)) {
      known.unshift({ value: current, label: effortLabel(t, { value: current, label: current, hint: null }), hint: t('composer.select.saved') })
    }
    return known
  }, [catalog, config, resolvedModel, t])

  /**
   * Le mode rapide n'est proposé que s'il peut servir : un compte qui y a droit, et un
   * modèle qui le gère. Absent sinon, plutôt que grisé, comme l'effort ; et absent sur
   * un CLI qui ne connaît pas la notion, dont le catalogue laisse `fastMode` null.
   */
  const speedOffered =
    claude !== null &&
    catalog?.fastMode?.available === true &&
    supportsFastMode(catalog.models, resolvedModel)

  /**
   * Ultracode n'impose plus `xhigh` depuis Claude Code 2.1.284, mais le CLI le refuse
   * toujours sur un modèle qui ne gère pas ce niveau (sondé sur 2.1.296) : le réglage
   * n'existe que là, comme le mode rapide.
   */
  const supportsUltracode = (model: string): boolean =>
    effortsFor(catalog?.models, model).some((effort) => effort.value === 'xhigh')
  const ultracodeOffered = claude !== null && supportsUltracode(resolvedModel)

  /**
   * Styles de réponse annoncés par le CLI, derrière une entrée « par défaut » : la
   * configuration vide veut dire « laisser le style habituel », et Radix refuse une
   * option de valeur vide, d'où la même sentinelle d'affichage que l'approbation.
   */
  const outputStyleOptions = useMemo((): SettingChoice<string>[] => {
    const styles = catalog?.outputStyles ?? []
    if (!claude || styles.length === 0) return []
    const known: SettingChoice<string>[] = [
      {
        value: CLI_DEFAULT_CHOICE,
        label: t('composer.outputStyle.default'),
        hint: t('composer.outputStyle.default.hint'),
      },
      ...styles.map((style) => ({ value: style, label: style })),
    ]
    if (claude.outputStyle && !styles.includes(claude.outputStyle)) {
      known.push({ value: claude.outputStyle, label: claude.outputStyle, hint: t('composer.select.saved') })
    }
    return known
  }, [catalog, claude, t])

  /**
   * Modèles pouvant servir de conseiller : ceux du catalogue, moins la ligne « par
   * défaut » qui ne nomme personne, derrière une entrée « aucun ».
   */
  const advisorOptions = useMemo((): SettingChoice<string>[] => {
    const models = catalog?.models ?? []
    if (!claude || models.length === 0) return []
    const known: SettingChoice<string>[] = [
      { value: CLI_DEFAULT_CHOICE, label: t('composer.advisor.none'), hint: t('composer.advisor.none.hint') },
      ...models
        .filter((model) => !model.isDefault)
        .map((model) => ({
          value: model.value,
          label: model.displayName,
          hint: [model.hint, t('composer.advisor.model.hint')].filter(Boolean).join(' · '),
        })),
    ]
    if (claude.advisorModel && !known.some((option) => option.value === claude.advisorModel)) {
      known.push({ value: claude.advisorModel, label: claude.advisorModel, hint: t('composer.select.saved') })
    }
    return known
  }, [catalog, claude, t])

  /**
   * Même sentinelle côté effort, que seul Codex laisse vide : le niveau montré est
   * celui que le modèle retenu annonce par défaut.
   */
  const effortSetting = codex ?? grok
  const resolvedEffort = effortSetting
    ? effortSetting.reasoningEffort ||
      catalogModel(catalog?.models, resolvedModel)?.defaultEffort ||
      CLI_DEFAULT
    : CLI_DEFAULT

  /**
   * Modes de collaboration annoncés par Codex. Le mode décide des outils accessibles
   * au modèle : en mode Plan, il peut poser des questions à choix, ce que le routeur
   * du CLI refuse autrement. La liste vient du CLI, donc elle disparaît si la version
   * installée ne la connaît pas, et reste vide pour les CLI sans cette notion.
   */
  const codexModeOptions = useMemo((): SettingChoice<CodexMode>[] => {
    // La liste est une chaîne libre côté protocole, opencode y rangeant ses agents :
    // seuls les modes que Codex connaît peuvent partir dans sa configuration.
    return (catalog?.modes ?? []).flatMap((entry) => {
      const mode = codexModeSchema.safeParse(entry.mode)
      return mode.success ? [{ value: mode.data, label: entry.label }] : []
    })
  }, [catalog])

  /**
   * Agents primaires d'opencode (`build`, `plan`, ceux de l'utilisateur) : le pendant
   * des modes de collaboration, à ceci près que la liste est ouverte. L'agent
   * enregistré reste sélectionnable même si le catalogue ne l'annonce pas.
   */
  const primaryAgentOptions = useMemo((): SettingChoice<string>[] => {
    if (!opencode) return []
    const known: SettingChoice<string>[] = (catalog?.modes ?? []).map((entry) => ({
      value: entry.mode,
      label: entry.label,
      hint: entry.hint ?? undefined,
    }))
    if (!known.some((option) => option.value === opencode.primaryAgent)) {
      known.unshift({ value: opencode.primaryAgent, label: opencode.primaryAgent, hint: t('composer.select.saved') })
    }
    return known
  }, [catalog, opencode, t])

  /**
   * Variantes du modèle, derrière une entrée « par défaut » : sans variante, opencode
   * laisse au modèle ses réglages propres, et aucune des variantes ne désigne cet état.
   */
  const variantOptions = useMemo((): SettingChoice<string>[] => {
    if (!opencode || effortOptions.length === 0) return []
    return [
      { value: CLI_DEFAULT_CHOICE, label: t('composer.variant.default'), hint: t('composer.variant.default.hint') },
      ...effortOptions,
    ]
  }, [effortOptions, opencode, t])

  // L'approbation peut être un objet granulaire, que Solera n'édite pas : il est
  // alors affiché comme une option non modifiable plutôt que comme un select vide.
  const approval = config.agent === 'codex' ? config.askForApproval : CLI_DEFAULT
  const granular = typeof approval !== 'string'

  // Radix refuse une option de valeur vide : la sentinelle « le CLI décide » a donc
  // besoin d'une valeur d'affichage propre, traduite dans les deux sens ci-dessous.
  const approvalValue: ApprovalChoice = granular
    ? 'granular'
    : approval === CLI_DEFAULT
      ? CLI_DEFAULT_CHOICE
      : approval

  const approvalOptions: SettingChoice<ApprovalChoice>[] = granular
    ? [
        {
          value: 'granular',
          label: t('composer.approval.granular'),
          hint: t('composer.approval.granular.hint'),
          disabled: true,
        },
        ...codexApprovalOptions(t),
      ]
    : codexApprovalOptions(t)

  /**
   * Chaque modèle expose ses propres niveaux. Garder l'effort courant quand le
   * nouveau modèle ne le connaît pas ferait échouer le tour côté CLI : on retombe
   * alors sur le repli annoncé par le catalogue.
   */
  const clampEffort = (model: string, current: string): string => {
    if (effortsFor(catalog?.models, model).some((effort) => effort.value === current)) {
      return current
    }
    return catalog?.models.find((entry) => entry.value === model)?.defaultEffort ?? ''
  }

  /** Même repli, ramené dans l'enum du protocole que `ClaudeConfig.effort` exige. */
  const clampClaudeEffort = (model: string, current: string): ClaudeConfig['effort'] => {
    const parsed = claudeEffortSchema.safeParse(clampEffort(model, current))
    return parsed.success ? parsed.data : DEFAULT_CLAUDE_CONFIG.effort
  }

  /**
   * Intitulé de la valeur en cours. Le repli sur la valeur brute couvre la sentinelle
   * `CLI_DEFAULT`, qui n'a pas d'option nommée dans les listes de modèles.
   */
  const labelOf = <T extends string>(options: SettingChoice<T>[], value: T): string =>
    options.find((option) => option.value === value)?.label || value || t('composer.select.default')

  /**
   * Un créneau du résumé.
   *
   * Le ton vient de l'option choisie, et non d'une seconde liste de valeurs
   * dangereuses tenue en parallèle. Un garde-fou levé reste visible à toute largeur.
   */
  const segment = <T extends string>(
    key: string,
    options: SettingChoice<T>[],
    value: T,
  ): SummarySegment => {
    const tone = options.find((option) => option.value === value)?.tone
    return { key, label: labelOf(options, value), tone }
  }

  // Le registre est partagé par toute l'instance : la requête est mise en cache par
  // React Query et ne repart pas à chaque conversation ouverte.
  const mcpRegistry = useMcpServers().data
  // Absent quand l'instance a coupé la bibliothèque : un réglage sans effet n'a pas à
  // occuper le panneau, comme le serveur MCP de Solera.
  const libraryAvailable = useSkillLibrary(null).data?.enabled === true
  const libraryOptionList = skillLibraryOptions(t)
  const memoryOptionList = agentMemoryOptions(t)
  const filingOptionList = projectFilingOptions(t)
  const cardFilingOptionList = cardFilingOptions(t)
  const mcpServers = mcpRegistry?.servers ?? []
  // Faux tant que la requête n'a pas répondu, comme pour une instance qui ne monte pas
  // le serveur : la ligne apparaît alors au chargement du registre, plutôt que de
  // s'afficher d'abord puis de disparaître sous le curseur.
  const soleraAvailable = mcpRegistry?.soleraServer === true
  // Les outils de rangement vivent dans le serveur MCP de Solera : l'entrée disparaît
  // quand l'instance coupe l'un ou l'autre, un réglage inopérant valant moins que pas
  // de réglage du tout.
  const filingAvailable = soleraAvailable && mcpRegistry?.projectFiling === true
  // La mémoire ne dépend pas du serveur MCP de Solera, elle : Claude la tient
  // nativement, dans le dossier que Solera lui désigne. Seule l'instance peut la
  // retirer de l'interface.
  const memoryAvailable = mcpRegistry?.agentMemory === true
  // Même dépendance que le rangement de projet : l'outil vit dans le serveur MCP de
  // Solera, l'entrée disparaît quand l'instance coupe l'un ou l'autre.
  const cardFilingAvailable = soleraAvailable && mcpRegistry?.cardFiling === true
  const decisionsAvailable = soleraAvailable && mcpRegistry?.decisions === true

  /**
   * Comptes Claude supplémentaires du compte Solera. Demandés pour Claude seulement,
   * et la catégorie n'apparaît que s'il y a un choix à faire : sans compte enregistré,
   * la connexion du CLI va de soi.
   */
  const { data: claudeAccountList } = useClaudeAccounts(claude !== null)
  // Codex : seuls les comptes connectés se choisissent, un home vide refuserait le tour.
  const { data: codexAccountList } = useCodexAccounts(codex !== null)
  // Grok, sur le même modèle que Codex : un home par compte, connecté ou non.
  const { data: grokAccountList } = useGrokAccounts(grok !== null)
  const accountOptions = useMemo((): SettingChoice<string>[] => {
    const chosen = claude?.account ?? codex?.account ?? grok?.account ?? null
    const accounts = claude
      ? (claudeAccountList?.accounts ?? [])
      : codex
        ? (codexAccountList?.accounts ?? []).filter((account) => account.status === 'ready')
        : grok
          ? (grokAccountList?.accounts ?? []).filter((account) => account.status === 'ready')
          : null
    if (accounts === null) return []
    if (accounts.length === 0 && !chosen) return []
    const known: SettingChoice<string>[] = [
      { value: CLI_DEFAULT_CHOICE, label: t('composer.account.cli'), hint: t('composer.account.cli.hint') },
      ...accounts.map((account) => ({ value: account.id, label: account.label })),
    ]
    // Un compte supprimé depuis : la conversation le désigne encore, le serveur
    // repartira sur la connexion du CLI, et l'écran le dit plutôt que de montrer un
    // sélecteur vide.
    if (chosen && !accounts.some((account) => account.id === chosen)) {
      known.push({ value: chosen, label: t('composer.account.missing'), hint: t('composer.select.saved') })
    }
    return known
  }, [claudeAccountList, codexAccountList, grokAccountList, claude, codex, grok, t])
  const accountChoice = (account: string | null) => account ?? CLI_DEFAULT_CHOICE

  const permissionOptionList = permissionOptions(t)
  const sandboxOptionList = codexSandboxOptions(t)
  const speedOptionList = speedOptions(t)
  const ultracodeOptionList = ultracodeOptions(t)
  const queueOptionList = queueOptions(t)
  const opencodePermissionList = opencodePermissionOptions(t)
  const grokPermissionList = grokPermissionOptions(t)
  const webSearchOptionList = webSearchOptions(t)

  let groups: SettingGroup[] = []
  let summary: SummarySegment[] = []
  let mcp: ReactElement<McpControlProps> | null = null

  if (claude) {
    groups = [
      setting({
        key: 'model',
        label: t('composer.setting.model'),
        icon: <Sparkles size={14} />,
        options: modelOptions,
        value: resolvedModel,
        onChange: (model) =>
          onConfigChange({
            ...claude,
            model,
            effort: clampClaudeEffort(model, claude.effort),
            // Garder le mode rapide sur un modèle qui ne le gère pas ferait basculer
            // le CLI sur Opus sans prévenir : il retombe avec le modèle.
            fastMode: claude.fastMode && supportsFastMode(catalog?.models, model),
            ultracode: claude.ultracode && supportsUltracode(model),
          }),
      }),
      // Absente plutôt que grisée quand le modèle n'a pas de niveaux d'effort : un
      // réglage sans effet n'a pas à occuper le panneau.
      ...(effortOptions.length > 0
        ? [
            setting({
              key: 'effort',
              label: t('composer.setting.effort'),
              icon: <Brain size={14} />,
              options: effortOptions,
              value: claude.effort,
              onChange: (effort) => {
                // Les options sont génériques sur des chaînes ; l'enum du protocole
                // fait foi, une valeur inconnue ne part pas.
                const parsed = claudeEffortSchema.safeParse(effort)
                if (parsed.success) onConfigChange({ ...claude, effort: parsed.data })
              },
            }),
          ]
        : []),
      ...(speedOffered
        ? [
            setting({
              key: 'speed',
              toggle: { on: 'fast', label: t('composer.speed.toggle') },
              label: t('composer.setting.speed'),
              icon: <Zap size={14} />,
              options: speedOptionList,
              value: claude.fastMode ? 'fast' : 'standard',
              onChange: (speed) => onConfigChange({ ...claude, fastMode: speed === 'fast' }),
            }),
          ]
        : []),
      ...(ultracodeOffered
        ? [
            setting({
              key: 'ultracode',
              toggle: { on: 'on' },
              label: t('composer.setting.ultracode'),
              icon: <UsersRound size={14} />,
              options: ultracodeOptionList,
              value: claude.ultracode ? 'on' : 'off',
              // Indépendant de l'effort, comme dans le CLI depuis 2.1.284 : l'allumer ou
              // l'éteindre laisse le niveau où il est.
              onChange: (choice) => onConfigChange({ ...claude, ultracode: choice === 'on' }),
            }),
          ]
        : []),
      ...(accountOptions.length > 0
        ? [
            setting({
              key: 'account',
              label: t('composer.setting.account'),
              icon: <IdCard size={14} />,
              options: accountOptions,
              value: accountChoice(claude.account),
              onChange: (choice) =>
                onConfigChange({ ...claude, account: choice === CLI_DEFAULT_CHOICE ? null : choice }),
              // Le jeton arrive par l'environnement du process : changer de compte
              // attend la relance de la session, comme le mode de permission.
              notice: notice(
                appliedLabel(
                  appliedConfig?.agent === 'claude' ? accountChoice(appliedConfig.account) : undefined,
                  accountChoice(claude.account),
                  accountOptions,
                ),
                t,
              ),
            }),
          ]
        : []),
      setting({
        key: 'permission',
        label: t('composer.setting.permission'),
        icon: <ShieldCheck size={14} />,
        options: permissionOptionList,
        value: claude.permissionMode,
        onChange: (permissionMode) => onConfigChange({ ...claude, permissionMode }),
        // Le seul réglage du panneau que Claude Code refuse de changer en vol : entrer
        // dans « Tout autoriser » comme en sortir demande de relancer la session. Le
        // CLI est comparé aussi : un `appliedConfig` reçu à l'instant où l'on bascule
        // de CLI décrirait encore la session de l'autre.
        notice: notice(
          appliedLabel(
            appliedConfig?.agent === 'claude' ? appliedConfig.permissionMode : undefined,
            claude.permissionMode,
            permissionOptionList,
          ),
          t,
        ),
      }),
      // Absents quand le catalogue n'en annonce pas, comme l'effort : un CLI sans
      // styles ou sans modèles n'a pas à montrer un sélecteur vide.
      ...(outputStyleOptions.length > 0
        ? [
            setting({
              key: 'outputStyle',
              label: t('composer.setting.outputStyle'),
              icon: <MessageSquareText size={14} />,
              options: outputStyleOptions,
              value: claude.outputStyle || CLI_DEFAULT_CHOICE,
              onChange: (style) =>
                onConfigChange({ ...claude, outputStyle: style === CLI_DEFAULT_CHOICE ? CLI_DEFAULT : style }),
            }),
          ]
        : []),
      ...(advisorOptions.length > 0
        ? [
            setting({
              key: 'advisor',
              label: t('composer.setting.advisor'),
              icon: <UserRoundSearch size={14} />,
              options: advisorOptions,
              value: claude.advisorModel || CLI_DEFAULT_CHOICE,
              onChange: (model) =>
                onConfigChange({ ...claude, advisorModel: model === CLI_DEFAULT_CHOICE ? CLI_DEFAULT : model }),
            }),
          ]
        : []),
      ...(libraryAvailable
        ? [
            setting({
              key: 'skillLibrary',
              toggle: { on: 'on' },
              label: t('composer.setting.skillLibrary'),
              icon: <BookOpen size={14} />,
              options: libraryOptionList,
              value: libraryChoice(claude.skillLibrary),
              onChange: (choice) => onConfigChange({ ...claude, skillLibrary: choice === 'on' }),
              // Comme le mode de permission : Claude ne reçoit ses plugins qu'au
              // lancement, le changement attend la relance de la session.
              notice: notice(
                appliedLabel(
                  appliedConfig?.agent === 'claude' ? libraryChoice(appliedConfig.skillLibrary) : undefined,
                  libraryChoice(claude.skillLibrary),
                  libraryOptionList,
                ),
                t,
              ),
            }),
          ]
        : []),
      ...(memoryAvailable
        ? [
            setting({
              key: 'agentMemory',
              toggle: { on: 'on' },
              label: t('composer.setting.agentMemory'),
              icon: <Brain size={14} />,
              options: memoryOptionList,
              value: memoryChoice(claude.agentMemory),
              onChange: (choice) => onConfigChange({ ...claude, agentMemory: choice === 'on' }),
              // Le dossier de mémoire est posé au lancement, dans les réglages du CLI et
              // dans l'environnement du serveur MCP : le changement attend la relance de
              // la session, comme la bibliothèque de skills.
              notice: notice(
                appliedLabel(appliedConfig?.agent === 'claude' ? memoryChoice(appliedConfig.agentMemory) : undefined, memoryChoice(claude.agentMemory), memoryOptionList),
                t,
              ),
            }),
          ]
        : []),
      ...(filingAvailable
        ? [
            setting({
              key: 'projectFiling',
              toggle: { on: 'on' },
              label: t('composer.setting.projectFiling'),
              icon: <FolderInput size={14} />,
              options: filingOptionList,
              value: filingChoice(claude.projectFiling),
              onChange: (choice) => onConfigChange({ ...claude, projectFiling: choice === 'on' }),
              // Les outils sont listés au lancement du serveur MCP : le changement
              // attend la relance de la session, comme la bibliothèque de skills.
              notice: notice(
                appliedLabel(appliedConfig?.agent === 'claude' ? filingChoice(appliedConfig.projectFiling) : undefined, filingChoice(claude.projectFiling), filingOptionList),
                t,
              ),
            }),
          ]
        : []),
      ...(cardFilingAvailable
        ? [
            setting({
              key: 'cardFiling',
              toggle: { on: 'on' },
              label: t('composer.setting.cardFiling'),
              icon: <Columns3 size={14} />,
              options: cardFilingOptionList,
              value: filingChoice(claude.cardFiling),
              onChange: (choice) => onConfigChange({ ...claude, cardFiling: choice === 'on' }),
              // L'outil est listé au lancement du serveur MCP : le changement attend la
              // relance de la session, comme le rangement de projet.
              notice: notice(
                appliedLabel(appliedConfig?.agent === 'claude' ? filingChoice(appliedConfig.cardFiling) : undefined, filingChoice(claude.cardFiling), cardFilingOptionList),
                t,
              ),
            }),
          ]
        : []),
      ...(decisionsAvailable
        ? [decisionsSetting(claude, appliedConfig?.agent === 'claude' ? appliedConfig : null, onConfigChange, t)]
        : []),
      setting({
        key: 'queue',
        toggle: { on: 'queue', label: t('composer.queue.toggle'), hint: t('composer.queue.toggle.hint') },
        label: t('composer.setting.queue'),
        icon: <Clock size={14} />,
        options: queueOptionList,
        value: queueChoice(claude.queueMessages),
        onChange: (choice) => onConfigChange({ ...claude, queueMessages: choice === 'queue' }),
      }),
    ]

    summary = [
      segment('model', modelOptions, resolvedModel),
      ...(effortOptions.length > 0 ? [segment('effort', effortOptions, claude.effort)] : []),
      // Le mode rapide coûte à chaque tour : tant qu'il est allumé, il se lit dans le
      // résumé, comme un garde-fou levé se lit dans le sien.
      ...(speedOffered && claude.fastMode ? [segment('speed', speedOptionList, 'fast')] : []),
      ...(ultracodeOffered && claude.ultracode ? [segment('ultracode', ultracodeOptionList, 'on')] : []),
      // Un autre abonnement que celui du CLI paie le tour : ça se lit dans le résumé.
      ...(claude.account ? [segment('account', accountOptions, claude.account)] : []),
      segment('permission', permissionOptionList, claude.permissionMode),
    ]

    mcp = (
      <McpControl
        servers={mcpServers}
        inventory={mcpInventory}
        selected={claude.mcpServers}
        onSelectedChange={(ids) => onConfigChange({ ...claude, mcpServers: ids })}
        solera={soleraAvailable ? claude.soleraMcp : null}
        onSoleraChange={(soleraMcp) => onConfigChange({ ...claude, soleraMcp })}
        strict={claude.strictMcp}
        onStrictChange={(strictMcp) => onConfigChange({ ...claude, strictMcp })}
        disabled={disabled}
      />
    )
  } else if (codex) {
    groups = [
      setting({
        key: 'model',
        label: t('composer.setting.model'),
        icon: <Sparkles size={14} />,
        options: modelOptions,
        value: resolvedModel,
        onChange: (model) =>
          onConfigChange({
            ...codex,
            model,
            reasoningEffort: clampEffort(model, codex.reasoningEffort),
          }),
      }),
      ...(codexModeOptions.length > 0
        ? [
            setting({
              key: 'mode',
              label: t('composer.setting.mode'),
              icon: <Compass size={14} />,
              options: codexModeOptions,
              value: codex.collaborationMode,
              onChange: (collaborationMode) => onConfigChange({ ...codex, collaborationMode }),
            }),
          ]
        : []),
      ...(effortOptions.length > 0
        ? [
            setting({
              key: 'effort',
              label: t('composer.setting.effort'),
              icon: <Brain size={14} />,
              options: effortOptions,
              value: resolvedEffort,
              onChange: (reasoningEffort) => onConfigChange({ ...codex, reasoningEffort }),
            }),
          ]
        : []),
      ...(accountOptions.length > 0
        ? [
            setting({
              key: 'account',
              label: t('composer.setting.account'),
              icon: <IdCard size={14} />,
              options: accountOptions,
              value: accountChoice(codex.account),
              onChange: (choice) =>
                onConfigChange({ ...codex, account: choice === CLI_DEFAULT_CHOICE ? null : choice }),
              // Le home du compte est l'environnement de l'app-server : changer de
              // compte attend la relance de la session.
              notice: notice(
                appliedLabel(
                  appliedConfig?.agent === 'codex' ? accountChoice(appliedConfig.account) : undefined,
                  accountChoice(codex.account),
                  accountOptions,
                ),
                t,
              ),
            }),
          ]
        : []),
      setting({
        key: 'approval',
        label: t('composer.setting.approval'),
        icon: <ShieldCheck size={14} />,
        options: approvalOptions,
        value: approvalValue,
        onChange: (choice) => {
          // 'granular' n'est qu'un repère d'affichage, il n'est pas sélectionnable et
          // ne doit jamais repartir vers le serveur.
          if (choice === 'granular') return
          onConfigChange({
            ...codex,
            askForApproval: choice === CLI_DEFAULT_CHOICE ? CLI_DEFAULT : choice,
          })
        },
      }),
      setting({
        key: 'sandbox',
        label: t('composer.setting.sandbox'),
        icon: <Box size={14} />,
        options: sandboxOptionList,
        value: codex.sandbox,
        onChange: (sandbox) => onConfigChange({ ...codex, sandbox }),
      }),
      // Appliqué à chaud par Codex, d'où l'absence de mention d'attente.
      ...(libraryAvailable
        ? [
            setting({
              key: 'skillLibrary',
              toggle: { on: 'on' },
              label: t('composer.setting.skillLibrary'),
              icon: <BookOpen size={14} />,
              options: libraryOptionList,
              value: libraryChoice(codex.skillLibrary),
              onChange: (choice) => onConfigChange({ ...codex, skillLibrary: choice === 'on' }),
            }),
          ]
        : []),
      ...(memoryAvailable
        ? [
            setting({
              key: 'agentMemory',
              toggle: { on: 'on' },
              label: t('composer.setting.agentMemory'),
              icon: <Brain size={14} />,
              options: memoryOptionList,
              value: memoryChoice(codex.agentMemory),
              onChange: (choice) => onConfigChange({ ...codex, agentMemory: choice === 'on' }),
              // Le dossier de mémoire est posé au lancement, dans les réglages du CLI et
              // dans l'environnement du serveur MCP : le changement attend la relance de
              // la session, comme la bibliothèque de skills.
              notice: notice(
                appliedLabel(appliedConfig?.agent === 'codex' ? memoryChoice(appliedConfig.agentMemory) : undefined, memoryChoice(codex.agentMemory), memoryOptionList),
                t,
              ),
            }),
          ]
        : []),
      ...(filingAvailable
        ? [
            setting({
              key: 'projectFiling',
              toggle: { on: 'on' },
              label: t('composer.setting.projectFiling'),
              icon: <FolderInput size={14} />,
              options: filingOptionList,
              value: filingChoice(codex.projectFiling),
              onChange: (choice) => onConfigChange({ ...codex, projectFiling: choice === 'on' }),
              // Les outils sont listés au lancement du serveur MCP : le changement
              // attend la relance de la session, comme la bibliothèque de skills.
              notice: notice(
                appliedLabel(appliedConfig?.agent === 'codex' ? filingChoice(appliedConfig.projectFiling) : undefined, filingChoice(codex.projectFiling), filingOptionList),
                t,
              ),
            }),
          ]
        : []),
      ...(cardFilingAvailable
        ? [
            setting({
              key: 'cardFiling',
              toggle: { on: 'on' },
              label: t('composer.setting.cardFiling'),
              icon: <Columns3 size={14} />,
              options: cardFilingOptionList,
              value: filingChoice(codex.cardFiling),
              onChange: (choice) => onConfigChange({ ...codex, cardFiling: choice === 'on' }),
              // L'outil est listé au lancement du serveur MCP : le changement attend la
              // relance de la session, comme le rangement de projet.
              notice: notice(
                appliedLabel(appliedConfig?.agent === 'codex' ? filingChoice(appliedConfig.cardFiling) : undefined, filingChoice(codex.cardFiling), cardFilingOptionList),
                t,
              ),
            }),
          ]
        : []),
      ...(decisionsAvailable
        ? [decisionsSetting(codex, appliedConfig?.agent === 'codex' ? appliedConfig : null, onConfigChange, t)]
        : []),
      setting({
        key: 'queue',
        toggle: { on: 'queue', label: t('composer.queue.toggle'), hint: t('composer.queue.toggle.hint') },
        label: t('composer.setting.queue'),
        icon: <Clock size={14} />,
        options: queueOptionList,
        value: queueChoice(codex.queueMessages),
        onChange: (choice) => onConfigChange({ ...codex, queueMessages: choice === 'queue' }),
      }),
    ]

    // Les levées d'approbation et de bac à sable restent visibles simultanément.
    const approvalOff = approvalValue === 'never'
    summary = [
      segment('model', modelOptions, resolvedModel),
      ...(effortOptions.length > 0 ? [segment('effort', effortOptions, resolvedEffort)] : []),
      ...(codex.account ? [segment('account', accountOptions, codex.account)] : []),
      ...(approvalOff ? [segment('approval', approvalOptions, approvalValue)] : []),
      ...(approvalOff && codex.sandbox !== 'danger-full-access'
        ? []
        : [segment('sandbox', sandboxOptionList, codex.sandbox)]),
    ]

    mcp = (
      <McpControl
        servers={mcpServers}
        inventory={mcpInventory}
        selected={codex.mcpServers}
        onSelectedChange={(ids) => onConfigChange({ ...codex, mcpServers: ids })}
        solera={soleraAvailable ? codex.soleraMcp : null}
        onSoleraChange={(soleraMcp) => onConfigChange({ ...codex, soleraMcp })}
        strict={null}
        onStrictChange={() => {}}
        disabled={disabled}
      />
    )
  } else if (opencode) {
    const applied = appliedConfig?.agent === 'opencode' ? appliedConfig : null
    const variant = opencode.variant || CLI_DEFAULT_CHOICE

    groups = [
      setting({
        key: 'model',
        label: t('composer.setting.model'),
        icon: <Sparkles size={14} />,
        options: modelOptions,
        value: resolvedModel,
        // Une variante que le nouveau modèle ne connaît pas retombe sur ses réglages
        // propres, qui existent toujours.
        onChange: (model) =>
          onConfigChange({ ...opencode, model, variant: clampEffort(model, opencode.variant) }),
      }),
      setting({
        key: 'mode',
        label: t('composer.setting.primaryAgent'),
        icon: <Compass size={14} />,
        options: primaryAgentOptions,
        value: opencode.primaryAgent,
        onChange: (primaryAgent) => onConfigChange({ ...opencode, primaryAgent }),
      }),
      ...(variantOptions.length > 0
        ? [
            setting({
              key: 'effort',
              label: t('composer.setting.variant'),
              icon: <Brain size={14} />,
              options: variantOptions,
              value: variant,
              onChange: (choice) =>
                onConfigChange({ ...opencode, variant: choice === CLI_DEFAULT_CHOICE ? CLI_DEFAULT : choice }),
            }),
          ]
        : []),
      // opencode lit ses règles au lancement : comme le mode de permission de Claude,
      // un changement attend la relance de la session, et la ligne dit ce qui vaut
      // encore d'ici là.
      ...OPENCODE_PERMISSIONS.map(({ family, label, icon }) =>
        setting({
          key: `permission-${family}`,
          label: t(label),
          icon,
          options: opencodePermissionList,
          value: opencodePermissionChoice(opencode.permissions[family]),
          onChange: (choice) =>
            onConfigChange({
              ...opencode,
              permissions: {
                ...opencode.permissions,
                [family]: choice === CLI_DEFAULT_CHOICE ? CLI_DEFAULT : choice,
              },
            }),
          notice: notice(
            appliedLabel(
              applied ? opencodePermissionChoice(applied.permissions[family]) : undefined,
              opencodePermissionChoice(opencode.permissions[family]),
              opencodePermissionList,
            ),
            t,
          ),
        }),
      ),
      ...(libraryAvailable
        ? [
            setting({
              key: 'skillLibrary',
              toggle: { on: 'on' },
              label: t('composer.setting.skillLibrary'),
              icon: <BookOpen size={14} />,
              options: libraryOptionList,
              value: libraryChoice(opencode.skillLibrary),
              onChange: (choice) => onConfigChange({ ...opencode, skillLibrary: choice === 'on' }),
              notice: notice(
                appliedLabel(
                  applied ? libraryChoice(applied.skillLibrary) : undefined,
                  libraryChoice(opencode.skillLibrary),
                  libraryOptionList,
                ),
                t,
              ),
            }),
          ]
        : []),
      ...(memoryAvailable
        ? [
            setting({
              key: 'agentMemory',
              toggle: { on: 'on' },
              label: t('composer.setting.agentMemory'),
              icon: <Brain size={14} />,
              options: memoryOptionList,
              value: memoryChoice(opencode.agentMemory),
              onChange: (choice) => onConfigChange({ ...opencode, agentMemory: choice === 'on' }),
              // Le dossier de mémoire est posé au lancement, dans les réglages du CLI et
              // dans l'environnement du serveur MCP : le changement attend la relance de
              // la session, comme la bibliothèque de skills.
              notice: notice(
                appliedLabel(applied ? memoryChoice(applied.agentMemory) : undefined, memoryChoice(opencode.agentMemory), memoryOptionList),
                t,
              ),
            }),
          ]
        : []),
      ...(filingAvailable
        ? [
            setting({
              key: 'projectFiling',
              toggle: { on: 'on' },
              label: t('composer.setting.projectFiling'),
              icon: <FolderInput size={14} />,
              options: filingOptionList,
              value: filingChoice(opencode.projectFiling),
              onChange: (choice) => onConfigChange({ ...opencode, projectFiling: choice === 'on' }),
              // Les outils sont listés au lancement du serveur MCP : le changement
              // attend la relance de la session, comme la bibliothèque de skills.
              notice: notice(
                appliedLabel(applied ? filingChoice(applied.projectFiling) : undefined, filingChoice(opencode.projectFiling), filingOptionList),
                t,
              ),
            }),
          ]
        : []),
      ...(cardFilingAvailable
        ? [
            setting({
              key: 'cardFiling',
              toggle: { on: 'on' },
              label: t('composer.setting.cardFiling'),
              icon: <Columns3 size={14} />,
              options: cardFilingOptionList,
              value: filingChoice(opencode.cardFiling),
              onChange: (choice) => onConfigChange({ ...opencode, cardFiling: choice === 'on' }),
              // L'outil est listé au lancement du serveur MCP : le changement attend la
              // relance de la session, comme le rangement de projet.
              notice: notice(
                appliedLabel(applied ? filingChoice(applied.cardFiling) : undefined, filingChoice(opencode.cardFiling), cardFilingOptionList),
                t,
              ),
            }),
          ]
        : []),
      ...(decisionsAvailable
        ? [decisionsSetting(opencode, applied, onConfigChange, t)]
        : []),
      setting({
        key: 'queue',
        toggle: { on: 'queue', label: t('composer.queue.toggle'), hint: t('composer.queue.toggle.hint') },
        label: t('composer.setting.queue'),
        icon: <Clock size={14} />,
        options: queueOptionList,
        value: queueChoice(opencode.queueMessages),
        onChange: (choice) => onConfigChange({ ...opencode, queueMessages: choice === 'queue' }),
      }),
    ]

    // Le résumé nomme la famille : « Autoriser » seul ne dirait pas quoi. Une famille
    // laissée libre reste visible, comme tout garde-fou levé ; les deux en « demander »
    // se résument en un mot.
    const { edit, bash } = opencode.permissions
    summary = [
      segment('model', modelOptions, resolvedModel),
      ...(opencode.variant ? [segment('effort', variantOptions, variant)] : []),
      ...(opencode.primaryAgent === 'build' ? [] : [segment('mode', primaryAgentOptions, opencode.primaryAgent)]),
      ...(edit === 'ask' && bash === 'ask'
        ? [{ key: 'permission', label: t('composer.opencodePermission.summary.ask') }]
        : []),
      ...(edit === 'allow'
        ? [{ key: 'permission-edit', label: t('composer.opencodePermission.summary.editAllow'), tone: 'caution' as const }]
        : []),
      ...(bash === 'allow'
        ? [{ key: 'permission-bash', label: t('composer.opencodePermission.summary.bashAllow'), tone: 'caution' as const }]
        : []),
    ]

    mcp = (
      <McpControl
        servers={mcpServers}
        inventory={mcpInventory}
        selected={opencode.mcpServers}
        onSelectedChange={(ids) => onConfigChange({ ...opencode, mcpServers: ids })}
        solera={soleraAvailable ? opencode.soleraMcp : null}
        onSoleraChange={(soleraMcp) => onConfigChange({ ...opencode, soleraMcp })}
        strict={null}
        onStrictChange={() => {}}
        disabled={disabled}
      />
    )
  } else if (grok) {
    const applied = appliedConfig?.agent === 'grok' ? appliedConfig : null
    const webSearch: WebSearchChoice = grok.webSearch ? 'on' : 'off'

    groups = [
      setting({
        key: 'model',
        label: t('composer.setting.model'),
        icon: <Sparkles size={14} />,
        options: modelOptions,
        value: resolvedModel,
        onChange: (model) =>
          onConfigChange({ ...grok, model, reasoningEffort: clampEffort(model, grok.reasoningEffort) }),
      }),
      ...(effortOptions.length > 0
        ? [
            setting({
              key: 'effort',
              label: t('composer.setting.effort'),
              icon: <Brain size={14} />,
              options: effortOptions,
              value: resolvedEffort,
              onChange: (reasoningEffort) => onConfigChange({ ...grok, reasoningEffort }),
            }),
          ]
        : []),
      setting({
        key: 'permission',
        label: t('composer.setting.permission'),
        icon: <ShieldCheck size={14} />,
        options: grokPermissionList,
        value: grok.permissionMode,
        onChange: (permissionMode) => onConfigChange({ ...grok, permissionMode }),
      }),
      ...(accountOptions.length > 0
        ? [
            setting({
              key: 'account',
              label: t('composer.setting.account'),
              icon: <IdCard size={14} />,
              options: accountOptions,
              value: accountChoice(grok.account),
              onChange: (choice) =>
                onConfigChange({ ...grok, account: choice === CLI_DEFAULT_CHOICE ? null : choice }),
              // Le compte est le `GROK_HOME` du process : changer de compte attend la
              // relance de la session.
              notice: notice(
                appliedLabel(applied ? accountChoice(applied.account) : undefined, accountChoice(grok.account), accountOptions),
                t,
              ),
            }),
          ]
        : []),
      // Grok coupe ses outils web par une option de lancement : le changement attend
      // la relance de la session, et la ligne dit ce qui vaut d'ici là.
      setting({
        key: 'webSearch',
        toggle: { on: 'on' },
        label: t('composer.setting.webSearch'),
        icon: <Globe size={14} />,
        options: webSearchOptionList,
        value: webSearch,
        onChange: (choice) => onConfigChange({ ...grok, webSearch: choice === 'on' }),
        notice: notice(
          appliedLabel(applied ? (applied.webSearch ? 'on' : 'off') : undefined, webSearch, webSearchOptionList),
          t,
        ),
      }),
      ...(libraryAvailable
        ? [
            setting({
              key: 'skillLibrary',
              toggle: { on: 'on' },
              label: t('composer.setting.skillLibrary'),
              icon: <BookOpen size={14} />,
              options: libraryOptionList,
              value: libraryChoice(grok.skillLibrary),
              onChange: (choice) => onConfigChange({ ...grok, skillLibrary: choice === 'on' }),
              // Les skills arrivent en plugin au lancement du process, comme chez Claude.
              notice: notice(
                appliedLabel(
                  applied ? libraryChoice(applied.skillLibrary) : undefined,
                  libraryChoice(grok.skillLibrary),
                  libraryOptionList,
                ),
                t,
              ),
            }),
          ]
        : []),
      ...(memoryAvailable
        ? [
            setting({
              key: 'agentMemory',
              toggle: { on: 'on' },
              label: t('composer.setting.agentMemory'),
              icon: <Brain size={14} />,
              options: memoryOptionList,
              value: memoryChoice(grok.agentMemory),
              onChange: (choice) => onConfigChange({ ...grok, agentMemory: choice === 'on' }),
              // L'index de la mémoire part dans les règles données à la création de la
              // session : le changement attend la relance, comme la bibliothèque.
              notice: notice(
                appliedLabel(applied ? memoryChoice(applied.agentMemory) : undefined, memoryChoice(grok.agentMemory), memoryOptionList),
                t,
              ),
            }),
          ]
        : []),
      ...(filingAvailable
        ? [
            setting({
              key: 'projectFiling',
              toggle: { on: 'on' },
              label: t('composer.setting.projectFiling'),
              icon: <FolderInput size={14} />,
              options: filingOptionList,
              value: filingChoice(grok.projectFiling),
              onChange: (choice) => onConfigChange({ ...grok, projectFiling: choice === 'on' }),
              notice: notice(
                appliedLabel(applied ? filingChoice(applied.projectFiling) : undefined, filingChoice(grok.projectFiling), filingOptionList),
                t,
              ),
            }),
          ]
        : []),
      ...(cardFilingAvailable
        ? [
            setting({
              key: 'cardFiling',
              toggle: { on: 'on' },
              label: t('composer.setting.cardFiling'),
              icon: <Columns3 size={14} />,
              options: cardFilingOptionList,
              value: filingChoice(grok.cardFiling),
              onChange: (choice) => onConfigChange({ ...grok, cardFiling: choice === 'on' }),
              notice: notice(
                appliedLabel(applied ? filingChoice(applied.cardFiling) : undefined, filingChoice(grok.cardFiling), cardFilingOptionList),
                t,
              ),
            }),
          ]
        : []),
      ...(decisionsAvailable
        ? [decisionsSetting(grok, applied, onConfigChange, t)]
        : []),
      setting({
        key: 'queue',
        toggle: { on: 'queue', label: t('composer.queue.toggle'), hint: t('composer.queue.toggle.hint') },
        label: t('composer.setting.queue'),
        icon: <Clock size={14} />,
        options: queueOptionList,
        value: queueChoice(grok.queueMessages),
        onChange: (choice) => onConfigChange({ ...grok, queueMessages: choice === 'queue' }),
      }),
    ]

    summary = [
      segment('model', modelOptions, resolvedModel),
      ...(effortOptions.length > 0 ? [segment('effort', effortOptions, resolvedEffort)] : []),
      ...(grok.account ? [segment('account', accountOptions, grok.account)] : []),
      segment('permission', grokPermissionList, grok.permissionMode),
    ]

    mcp = (
      <McpControl
        servers={mcpServers}
        inventory={mcpInventory}
        selected={grok.mcpServers}
        onSelectedChange={(ids) => onConfigChange({ ...grok, mcpServers: ids })}
        solera={soleraAvailable ? grok.soleraMcp : null}
        onSoleraChange={(soleraMcp) => onConfigChange({ ...grok, soleraMcp })}
        strict={null}
        onStrictChange={() => {}}
        disabled={disabled}
      />
    )
  }

  return {
    groups,
    summary,
    mcp,
    mcpPanel: mcp ? cloneElement(mcp, { presentation: 'panel' }) : null,
    mcpItems: mcp ? cloneElement(mcp, { presentation: 'items' }) : null,
    mcpSummary: mcp ? mcpSummaryOf(mcp.props) : '',
    catalogError,
  }
}
