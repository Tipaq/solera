import { SwitchRow, TooltipButton } from '@solera/ui'
import { PlugZap, Plus } from 'lucide-react'
import type { ReactNode } from 'react'
import type { McpServer, McpServerState, McpServerStatus } from '@solera/protocol'
import { translate, useTranslate, type MessageKey } from '../../lib/i18n'
import { setMcpRegistryOpen } from '../../lib/mcp-registry'
import { Menu, MenuCheckboxItem, MenuSeparator, cx } from '@solera/ui'

/**
 * La pastille d'état, et rien d'autre : un mot y suffirait mal, et l'état se lit
 * d'abord à la couleur quand on survole une liste de huit serveurs.
 */
const STATE_TONES: Record<McpServerState, string> = {
  pending: 'bg-ink-faint',
  connected: 'bg-positive',
  failed: 'bg-critical',
  'needs-auth': 'bg-caution',
  disabled: 'bg-ink-faint/50',
}

const STATE_LABELS: Record<McpServerState, MessageKey> = {
  pending: 'composer.mcp.state.pending',
  connected: 'composer.mcp.state.connected',
  failed: 'composer.mcp.state.failed',
  'needs-auth': 'composer.mcp.state.needsAuth',
  disabled: 'composer.mcp.state.disabled',
}

/**
 * Serveurs MCP actifs sur la conversation, et l'isolation stricte de Claude.
 *
 * Les deux vivent dans le même contrôle parce qu'ils répondent à la même question,
 * « avec quels outils cet agent travaille » : les séparer obligerait à ouvrir deux
 * réglages pour comprendre ce que le CLI a réellement chargé.
 *
 * C'est cette même question qui justifie d'y montrer les serveurs venus du CLI, que
 * Solera n'a pas déclarés et ne peut pas régler. Les taire donnait un composeur qui
 * annonçait « Aucun » à une session où l'agent disposait déjà de sept outils : le
 * réglage disait vrai sur ce qu'il contrôle, et faux sur ce qui est chargé.
 *
 * `strictMcp` n'est proposé que pour Claude, et le dit. Codex n'a pas d'équivalent :
 * son `config.toml` et son serveur intégré restent là quoi qu'on fasse, et offrir la
 * bascule des deux côtés promettrait une isolation qu'un des deux ne tient pas.
 */

export interface McpControlProps {
  /**
   * `menu` porte sa propre pastille, `panel` rend les mêmes choix en contrôles
   * ordinaires, `items` ne rend que les entrées — pour un sous-menu qui les accueille
   * dans le menu d'un autre bouton.
   */
  presentation?: 'menu' | 'panel' | 'items'
  /** Registre de Solera : le seul que ce contrôle peut activer ou désactiver. */
  servers: McpServer[]
  /**
   * Inventaire que le CLI rapporte pour la session en cours.
   *
   * Vide sur une conversation au repos, qui n'a pas de process : le contrôle retombe
   * alors sur ce que la configuration décrit, faute de mieux.
   */
  inventory: McpServerStatus[]
  selected: string[]
  onSelectedChange: (ids: string[]) => void
  /**
   * Serveur MCP de Solera, ou null quand l'instance ne le monte pas du tout.
   *
   * Null fait disparaître la ligne au lieu de la griser : un réglage visible mais
   * inopérant pousse à chercher pourquoi il ne fait rien, là où son absence se lit
   * comme une instance qui n'a pas cette fonction.
   */
  solera: boolean | null
  onSoleraChange: (enabled: boolean) => void
  /** Null pour Codex, qui n'a pas d'isolation à régler. */
  strict: boolean | null
  onStrictChange: (strict: boolean) => void
  disabled?: boolean
}

export function McpControl({
  presentation = 'menu',
  servers,
  inventory,
  selected,
  onSelectedChange,
  solera,
  onSoleraChange,
  strict,
  onStrictChange,
  disabled = false,
}: McpControlProps) {
  const t = useTranslate()
  const CheckboxItem = presentation === 'panel' ? McpSwitch : MenuCheckboxItem
  const Separator = presentation === 'panel' ? McpDivider : MenuSeparator
  const active = new Set(selected)
  const external = inventory.filter((server) => server.external)
  const toolsByName = new Map(inventory.map((server) => [server.name, server.tools.length]))

  const toggle = (id: string, checked: boolean) => {
    // Reconstruit depuis l'ordre du registre plutôt qu'en ajoutant en fin de liste :
    // l'ordre décide quel serveur l'emporte quand deux exposent un outil homonyme, et
    // il ne doit pas dépendre de l'ordre des clics.
    const next = new Set(active)
    if (checked) next.add(id)
    else next.delete(id)
    onSelectedChange(servers.filter((server) => next.has(server.id)).map((server) => server.id))
  }

  // `strictMcp` l'emporte sur l'activation : le drapeau annonce « rien d'autre que ce
  // que j'ai déclaré », et le serveur de Solera tombe avec les autres. Sa case reste
  // affichée pour que son état se lise, mais devient inerte tant que l'isolation dure.
  /**
   * Une ligne par serveur, quelle que soit sa provenance.
   *
   * Les serveurs venus du CLI étaient listés à part, en lignes inertes : ils restent
   * inertes — Solera ne peut pas régler ce qu'il n'a pas déclaré — mais ils se lisent
   * dans la même colonne, avec le même état et le même compte d'outils. La question
   * posée ici est « avec quels outils cet agent travaille », et elle ne distingue pas
   * d'où ils viennent.
   */
  const row = (entry: {
    key: string
    name: string
    hint: string
    state: McpServerState | undefined
    tools: number | undefined
    checked: boolean
    onCheckedChange?: (checked: boolean) => void
    disabled?: boolean
  }) => {
    const label = (
      <span className="flex min-w-0 flex-1 items-center gap-2">
        <span
          aria-hidden
          className={cx('size-2 shrink-0 rounded-full', entry.state ? STATE_TONES[entry.state] : 'bg-ink-faint/40')}
        />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate">{entry.name}</span>
          <span className="truncate text-meta text-ink-faint">{entry.hint}</span>
        </span>
        <ToolCount count={entry.tools} />
      </span>
    )

    // Une ligne inerte plutôt qu'une bascule grisée : une bascule, même éteinte,
    // laisse croire qu'elle deviendra manœuvrable, alors que Solera ne pourra jamais
    // régler un serveur qu'il n'a pas déclaré.
    if (!entry.onCheckedChange) {
      return (
        <div key={entry.key} className="flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm text-ink-faint">
          {label}
        </div>
      )
    }

    return (
      <CheckboxItem
        key={entry.key}
        checked={entry.checked}
        onCheckedChange={entry.onCheckedChange}
        disabled={entry.disabled}
      >
        {label}
      </CheckboxItem>
    )
  }

  const statusByName = new Map(inventory.map((server) => [server.name.toLowerCase(), server]))
  const statusOf = (name: string) => statusByName.get(name.toLowerCase())
  const hintOf = (origin: string, status: McpServerStatus | undefined) =>
    [origin, status?.error ?? (status ? t(STATE_LABELS[status.state]) : null)].filter(Boolean).join(' · ')

  const items = (
    <>
      {solera === null ? null : (
        row({
          key: 'solera',
          name: t('composer.mcp.builtin'),
          hint: hintOf(t('composer.mcp.origin.builtin'), statusOf('solera')),
          state: statusOf('solera')?.state,
          tools: toolsByName.get('solera'),
          checked: solera,
          onCheckedChange: onSoleraChange,
          disabled: disabled || strict === true,
        })
      )}

      {servers.length === 0 && external.length === 0 ? (
        <p className="px-2.5 py-2 text-xs text-ink-faint">{t('composer.mcp.empty')}</p>
      ) : null}

      {servers.map((server) =>
        row({
          key: server.id,
          name: server.name,
          hint: hintOf(t('composer.mcp.origin.solera'), statusOf(server.name)),
          state: server.enabled ? statusOf(server.name)?.state : 'disabled',
          tools: toolsByName.get(server.name),
          checked: active.has(server.id),
          onCheckedChange: (checked) => toggle(server.id, checked),
          disabled: disabled || !server.enabled,
        }),
      )}

      {external.map((server) =>
        row({
          key: `cli:${server.name}`,
          name: server.name,
          hint: hintOf(t('composer.mcp.origin.cli'), server),
          state: server.state,
          tools: server.tools.length,
          checked: true,
        }),
      )}

      {strict === null ? null : (
        <>
          <Separator />
          <CheckboxItem checked={strict} onCheckedChange={onStrictChange} disabled={disabled}>
            <span className="flex flex-col">
              <span>{t('composer.mcp.strict')}</span>
              <span className="text-meta text-ink-faint">{t('composer.mcp.strict.hint')}</span>
            </span>
          </CheckboxItem>
        </>
      )}

      <Separator />
      {/* Le seul chemin vers l'écriture : ajouter, régler ou retirer un serveur se
          fait dans la modale, et nulle part ailleurs. */}
      <button
        type="button"
        onClick={() => setMcpRegistryOpen(true)}
        className="flex min-h-11 w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm text-ink-soft hover:bg-accent-wash hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"
      >
        <Plus size={16} className="shrink-0" />
        {t('composer.mcp.manage')}
      </button>
    </>
  )

  // Une pastille d'icône et de compte plutôt qu'un sélecteur nommé : la question
  // « avec quels outils » se lit d'un coup d'œil et ne mérite pas d'occuper la barre
  // à hauteur des réglages qu'on change à chaque tour.
  const configured = configuredCount(solera, strict, selected)
  const summary = mcpSummary(configured, inventory.length)
  const count = inventory.length > 0 ? inventory.length : configured

  if (presentation === 'panel') return <div>{items}</div>
  if (presentation === 'items') return items

  return (
    <Menu
      align="start"
      trigger={
        <TooltipButton
          type="button"
          disabled={disabled}
          aria-label={t('composer.mcp.label', { summary })}
          title={summary}
          className={cx(
            'flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-1 rounded-md px-2 text-xs tabular-nums md:min-h-8 pointer-coarse:min-h-11',
            'border border-transparent bg-transparent text-ink-faint transition-colors',
            'hover:bg-surface-high hover:text-ink',
            'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent',
            'data-[state=open]:bg-surface-high data-[state=open]:text-ink',
            'disabled:pointer-events-none disabled:opacity-45',
          )}
        >
          <PlugZap size={14} className="shrink-0" />
          {/* Rien à zéro : un « 0 » se lirait comme une panne, pour la même raison
              que le compte d'outils reste muet tant que le CLI n'a pas répondu. */}
          {count > 0 ? <span>{count}</span> : null}
        </TooltipButton>
      }
    >
      {items}
    </Menu>
  )
}

/** Les mêmes choix que le menu, avec des contrôles ordinaires dans le panneau. */
function McpSwitch({ checked, onCheckedChange, disabled, children }: {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  disabled?: boolean
  children: ReactNode
}) {
  // L'intitulé de ces lignes est déjà composé — nom, compte d'outils, phrase — par le
  // contenu que le menu et le panneau partagent : il passe entier comme intitulé.
  return <SwitchRow checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} label={children} />
}

function McpDivider() { return <div className="my-2 h-px bg-line" /> }

/** Absent tant que le CLI n'a pas répondu : un « 0 outil » se lirait comme un échec. */
function ToolCount({ count }: { count: number | undefined }) {
  const t = useTranslate()
  if (count === undefined || count === 0) return null

  return (
    <span className="shrink-0 text-meta tabular-nums text-ink-faint">
      {t(count > 1 ? 'composer.mcp.tools.many' : 'composer.mcp.tools.one', { count })}
    </span>
  )
}

/**
 * Serveurs que la configuration décrit.
 *
 * Le serveur de Solera compte comme les autres : c'en est un, il expose des outils, et
 * l'omettre ferait afficher « aucun » à une conversation qui démarrera pourtant avec
 * une mémoire du projet. L'isolation stricte le fait tomber avec les autres.
 */
function configuredCount(solera: boolean | null, strict: boolean | null, selected: string[]): number {
  return selected.length + (solera === true && strict !== true ? 1 : 0)
}

/**
 * Le même résumé, pour qui montre le contrôle derrière une entrée de menu plutôt que
 * derrière sa propre pastille : la règle de comptage ne se recopie pas.
 */
export function mcpSummaryOf({ inventory, selected, solera, strict }: McpControlProps): string {
  return mcpSummary(configuredCount(solera, strict, selected), inventory.length)
}

/**
 * Résumé affiché par le composer sur son déclencheur replié.
 *
 * Compte ce que la session a réellement chargé dès que le CLI l'a dit, et non ce que
 * la configuration décrit : c'est la question à laquelle ce contrôle sert à répondre,
 * et les serveurs du CLI en font partie sans que Solera les ait déclarés. Une
 * conversation au repos n'a pas d'inventaire, le compte configuré prend alors le
 * relais faute de mieux.
 *
 * Fonction appelée au rendu et non constante de module : un libellé composé au
 * chargement se figerait dans la langue d'alors et resterait en place après un
 * changement de langue.
 */
export function mcpSummary(configured: number, loaded: number): string {
  if (loaded > 0) {
    return translate(loaded > 1 ? 'composer.mcp.loaded.many' : 'composer.mcp.loaded.one', {
      count: loaded,
    })
  }
  if (configured === 0) return translate('composer.mcp.none')
  return translate(configured > 1 ? 'composer.mcp.count.many' : 'composer.mcp.count.one', {
    count: configured,
  })
}
