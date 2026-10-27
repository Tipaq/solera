import {
  CONTEXT_DETAIL_MAX_ROWS,
  type ContextBreakdown,
  type ContextEntry,
} from '@solera/protocol'
import { ConfirmDialog, cx } from '@solera/ui'
import { memo, useState } from 'react'
import type { ContextState } from '../../lib/chat-fold'
import { useTranslate, type MessageKey } from '../../lib/i18n'

/** Au-delà, la conversation approche de la compaction : le repère change de ton. */
const WARN_RATIO = 0.75
const CRITICAL_RATIO = 0.9

const RADIUS = 7
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

function formatTokens(count: number): string {
  if (count < 1000) return String(count)
  if (count < 1_000_000) return `${Math.round(count / 1000)} k`
  return `${(count / 1_000_000).toFixed(1)} M`
}

/**
 * Occupation de la fenêtre de contexte.
 *
 * Distincte du quota d'abonnement affiché en en-tête : celle-ci se vide à chaque
 * nouvelle conversation et décide du moment où il faudra compacter.
 */
/**
 * Le dessin seul. Ce qu'on en fait — repère inerte ou déclencheur — appartient à
 * l'appelant : dans la barre de saisie c'est `ContextButton` qui le porte.
 */
export function ContextMeter({ context }: { context: ContextState }) {
  const ratio = Math.min(Math.max(context.ratio, 0), 1)
  const percent = Math.round(ratio * 100)

  const tone =
    ratio >= CRITICAL_RATIO ? 'text-critical' : ratio >= WARN_RATIO ? 'text-caution' : 'text-accent'

  return (
    <span className={cx('flex shrink-0 items-center gap-1.5 text-xs tabular-nums', tone)}>
      <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
        <circle
          cx="9"
          cy="9"
          r={RADIUS}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          opacity="0.22"
        />
        {/* Le tracé part de midi et tourne dans le sens horaire, d'où la rotation. */}
        <circle
          cx="9"
          cy="9"
          r={RADIUS}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={CIRCUMFERENCE * (1 - ratio)}
          transform="rotate(-90 9 9)"
        />
      </svg>
      {percent} %
    </span>
  )
}

/**
 * Une ligne du détail : un libellé, un poids, et la part qu'il prend.
 *
 * La part est rapportée à la fenêtre et non au total occupé : c'est la fenêtre qui
 * décide de la compaction, et une catégorie à « 30 % de ce qui est occupé » ne dit pas
 * s'il reste de la place.
 */
function DetailRow({
  label,
  tokens,
  windowTokens,
  muted = false,
  title,
}: {
  label: string
  tokens: number
  windowTokens: number
  muted?: boolean
  title?: string
}) {
  const share = windowTokens > 0 ? tokens / windowTokens : 0
  return (
    <div className="flex items-baseline gap-2 text-xs">
      <span className={cx('min-w-0 truncate', muted ? 'text-ink-faint' : 'text-ink-soft')} title={title ?? label}>
        {label}
      </span>
      <span
        aria-hidden
        className="h-px min-w-2 flex-1 self-center border-b border-dotted border-line"
      />
      <span className={cx('shrink-0 tabular-nums', muted ? 'text-ink-faint' : 'text-ink')}>
        {formatTokens(tokens)}
      </span>
      {/* La part n'apparaît qu'au-delà du demi-pourcent : « 0 % » à côté d'un poids non
          nul se lit comme une erreur d'affichage alors que c'est l'arrondi. */}
      <span className="w-9 shrink-0 text-right tabular-nums text-ink-faint">
        {share >= 0.005 ? `${Math.round(share * 100)} %` : ''}
      </span>
    </div>
  )
}

/**
 * Liste nominative, repliée sur son titre tant qu'on ne l'ouvre pas.
 *
 * Dépliable et non déployée : une session chargée en serveurs MCP aligne des dizaines
 * d'outils, et la modale doit d'abord répondre « qu'est-ce qui occupe la fenêtre » avant
 * de répondre « lequel exactement ».
 */
function EntryList({
  titleKey,
  entries,
  windowTokens,
}: {
  titleKey: MessageKey
  entries: ContextEntry[]
  windowTokens: number
}) {
  const t = useTranslate()
  if (entries.length === 0) return null
  const total = entries.reduce((sum, entry) => sum + entry.tokens, 0)

  return (
    <details className="group">
      {/* Le triangle est dessiné et non laissé au navigateur : sans lui, la ligne de
          repli se confond avec une ligne de catégorie, et le total qu'elle porte passe
          pour un doublon de celle qu'elle détaille. */}
      <summary className="flex cursor-pointer list-none items-baseline gap-1">
        <span aria-hidden className="shrink-0 text-ink-faint">
          <span className="group-open:hidden">▸</span>
          <span className="hidden group-open:inline">▾</span>
        </span>
        <span className="min-w-0 flex-1">
          <DetailRow label={`${t(titleKey)} (${entries.length})`} tokens={total} windowTokens={windowTokens} />
        </span>
      </summary>
      <ul className="mt-0.5 mb-1 flex flex-col gap-0.5 border-l border-line pl-2">
        {entries.map((entry) => (
          <li key={`${entry.source ?? ''}/${entry.name}`}>
            <DetailRow
              // Le chemin complet d'un fichier de mémoire ne tient pas dans la modale,
              // et son nom seul ne distingue pas deux `CLAUDE.md` : la provenance
              // annoncée par le CLI (« Project », « User ») fait la différence, et le
              // chemin reste dans l'infobulle.
              label={entry.source ? `${shortName(entry.name)} · ${entry.source}` : shortName(entry.name)}
              title={entry.name}
              tokens={entry.tokens}
              windowTokens={windowTokens}
              muted
            />
          </li>
        ))}
      </ul>
      {/* La liste part dans le journal à chaque tour, donc coupée à la source. Le test
          d'égalité ne se trompe pas : une liste pleine jusqu'au plafond est bien « les
          N plus lourds », qu'il y en ait eu davantage ou exactement N. */}
      {entries.length === CONTEXT_DETAIL_MAX_ROWS ? (
        <p className="mb-1 pl-2 text-meta text-ink-faint">
          {t('composer.context.truncated', { count: CONTEXT_DETAIL_MAX_ROWS })}
        </p>
      ) : null}
    </details>
  )
}

/** Dernier segment d'un chemin ; un nom qui n'en est pas un ressort inchangé. */
function shortName(name: string): string {
  const cut = name.lastIndexOf('/')
  return cut === -1 ? name : name.slice(cut + 1)
}

/** Opacités décroissantes : la catégorie la plus lourde est la plus franche. */
const SEGMENT_SHADES = ['bg-accent', 'bg-accent/75', 'bg-accent/55', 'bg-accent/40', 'bg-accent/25']

/** Les lignes `used` triées du plus lourd au plus léger ; l'ordre fait l'échelle. */
function usedRows(breakdown: Extract<ContextBreakdown, { axis: 'categories' }>) {
  return breakdown.categories.filter((row) => row.kind === 'used').sort((a, b) => b.tokens - a.tokens)
}

/**
 * La fenêtre en une barre, découpée par catégorie.
 *
 * Le tampon de compaction a sa propre teinte : il n'est pas occupé, mais il n'est pas
 * disponible non plus, et le confondre avec l'espace libre ferait croire à une marge
 * qui n'existe pas.
 */
function CategoriesBar({
  breakdown,
  windowTokens,
}: {
  breakdown: Extract<ContextBreakdown, { axis: 'categories' }>
  windowTokens: number
}) {
  const share = (tokens: number) => `${windowTokens > 0 ? (tokens / windowTokens) * 100 : 0}%`
  return (
    <div className="flex h-1.5 overflow-hidden rounded-full bg-surface-high" aria-hidden>
      {usedRows(breakdown).map((row, index) => (
        <div
          key={row.label}
          className={SEGMENT_SHADES[Math.min(index, SEGMENT_SHADES.length - 1)]}
          style={{ width: share(row.tokens) }}
        />
      ))}
      {breakdown.categories
        .filter((row) => row.kind === 'buffer')
        .map((row) => (
          <div key={row.label} className="bg-caution/35" style={{ width: share(row.tokens) }} />
        ))}
    </div>
  )
}

/**
 * Claude : la fenêtre découpée par catégorie de contenu.
 *
 * Les lignes `used` sont triées par poids décroissant, et la barre suit le même ordre :
 * l'échelle d'opacité se lit alors comme une échelle de poids. Les lignes `deferred`
 * sont à part parce qu'elles ne comptent pas dans l'occupation — les mêler aux autres
 * ferait une somme qui ne tombe pas sur le total affiché en haut.
 */
function CategoriesDetail({
  breakdown,
  windowTokens,
}: {
  breakdown: Extract<ContextBreakdown, { axis: 'categories' }>
  windowTokens: number
}) {
  const t = useTranslate()
  const used = usedRows(breakdown)
  const buffer = breakdown.categories.filter((row) => row.kind === 'buffer')
  const free = breakdown.categories.filter((row) => row.kind === 'free')
  const deferred = [...breakdown.categories]
    .filter((row) => row.kind === 'deferred')
    .sort((a, b) => b.tokens - a.tokens)

  return (
    <>
      <section className="flex flex-col gap-0.5">
        <h3 className="text-meta font-medium uppercase tracking-wide text-ink-faint">
          {t('composer.context.inWindow')}
        </h3>
        {used.map((row) => (
          <DetailRow key={row.label} label={row.label} tokens={row.tokens} windowTokens={windowTokens} />
        ))}
        {buffer.map((row) => (
          <DetailRow key={row.label} label={t('composer.context.buffer')} tokens={row.tokens} windowTokens={windowTokens} muted />
        ))}
        {free.map((row) => (
          <DetailRow key={row.label} label={t('composer.context.free')} tokens={row.tokens} windowTokens={windowTokens} muted />
        ))}
      </section>

      {/* Le nominatif détaille des lignes déjà comptées plus haut : il est à part pour
          qu'on ne l'additionne pas avec elles. C'est aussi le seul endroit actionnable
          de la modale — un serveur MCP qu'on coupe, un fichier de mémoire qu'on allège. */}
      <section className="flex flex-col gap-0.5 border-t border-line pt-2">
        <EntryList titleKey="composer.context.memoryFiles" entries={breakdown.memoryFiles} windowTokens={windowTokens} />
        <EntryList titleKey="composer.context.skills" entries={breakdown.skills} windowTokens={windowTokens} />
        <EntryList titleKey="composer.context.mcpTools" entries={breakdown.mcpTools} windowTokens={windowTokens} />
        <EntryList titleKey="composer.context.agents" entries={breakdown.agents} windowTokens={windowTokens} />
      </section>

      {deferred.length > 0 ? (
        <section className="flex flex-col gap-0.5">
          <h3 className="text-meta font-medium uppercase tracking-wide text-ink-faint">
            {t('composer.context.deferred')}
          </h3>
          {deferred.map((row) => (
            <DetailRow key={row.label} label={row.label} tokens={row.tokens} windowTokens={windowTokens} muted />
          ))}
          <p className="text-meta text-ink-faint">{t('composer.context.deferredHint')}</p>
        </section>
      ) : null}
    </>
  )
}

/**
 * Codex : la nature des jetons, faute d'un découpage par contenu.
 *
 * `last.inputTokens` est l'occupation, et ses trois parts (relu du cache, écrit au
 * cache, neuf) la composent : c'est le seul axe que l'app-server permette d'affirmer.
 * Le cumul du fil est donné à part, et dit explicitement qu'il n'est pas une
 * occupation — rapporté à la fenêtre il dépasserait 100 % sans jamais redescendre.
 */
function TokensDetail({
  breakdown,
  windowTokens,
}: {
  breakdown: Extract<ContextBreakdown, { axis: 'tokens' }>
  windowTokens: number
}) {
  const t = useTranslate()
  const { last, total } = breakdown
  const fresh = Math.max(last.inputTokens - last.cachedInputTokens - last.cacheWriteInputTokens, 0)

  return (
    <>
      <section className="flex flex-col gap-0.5">
        <h3 className="text-meta font-medium uppercase tracking-wide text-ink-faint">
          {t('composer.context.nature')}
        </h3>
        <DetailRow label={t('composer.context.cached')} tokens={last.cachedInputTokens} windowTokens={windowTokens} />
        <DetailRow label={t('composer.context.cacheWrite')} tokens={last.cacheWriteInputTokens} windowTokens={windowTokens} />
        <DetailRow label={t('composer.context.fresh')} tokens={fresh} windowTokens={windowTokens} />
        <DetailRow label={t('composer.context.output')} tokens={last.outputTokens} windowTokens={windowTokens} muted />
        {/* Décalée parce qu'elle est une part de la ligne au-dessus et non une ligne de
            plus : la sortie du tour contient déjà le raisonnement. */}
        <div className="pl-3">
          <DetailRow
            label={t('composer.context.reasoning')}
            tokens={last.reasoningOutputTokens}
            windowTokens={windowTokens}
            muted
          />
        </div>
      </section>

      <section className="flex flex-col gap-0.5 border-t border-line pt-2">
        <DetailRow
          label={t('composer.context.threadTotal')}
          tokens={total.totalTokens}
          // La part est volontairement omise : le cumul ne se rapporte pas à la fenêtre.
          windowTokens={0}
          muted
        />
        <p className="text-meta text-ink-faint">{t('composer.context.threadTotalHint')}</p>
      </section>
    </>
  )
}

/**
 * La jauge, et le détail qu'elle ouvre.
 *
 * Un repère cliquable doit dire ce que le clic fera : c'est l'objection qui avait
 * jusqu'ici gardé la jauge inerte. Elle est levée par le contenu de la modale, qui
 * explique l'état de la fenêtre avant de proposer quoi que ce soit, et par l'intitulé
 * du bouton, qui annonce un détail et pas une action.
 *
 * Mémoïsé : le composer se redessine à chaque frappe, la jauge n'a pas à le suivre.
 */
export const ContextButton = memo(function ContextButton({ context, model, onCompact, canCompact }: {
  context: ContextState
  /** Modèle en vigueur, nommé dans le détail. */
  model: string
  /** Absent là où compacter n'est pas offert : conversation lue, ou pas de plomberie. */
  onCompact?: () => void
  /** Compacter au milieu d'un tour résumerait un état que l'agent est en train de changer. */
  canCompact: boolean
}) {
  const t = useTranslate()
  const [open, setOpen] = useState(false)
  const percent = Math.round(Math.min(Math.max(context.ratio, 0), 1) * 100)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t('composer.context.label', { percent })}
        title={t('composer.context.tokens', {
          used: formatTokens(context.usedTokens),
          max: formatTokens(context.maxTokens),
        })}
        className={cx(
          // Sous 352 px de barre, la jauge tombe. Au plus serré la rangée doit choisir,
          // et entre savoir où en est la fenêtre et pouvoir lire le modèle, le mode en
          // vigueur, envoyer et arrêter, c'est le repère informatif qui cède.
          'hidden min-h-11 shrink-0 items-center rounded-md px-1.5 @min-[22rem]:flex md:min-h-9 pointer-coarse:min-h-11',
          'transition-colors hover:bg-surface-high focus-visible:outline-2 focus-visible:outline-accent',
        )}
      >
        <ContextMeter context={context} />
      </button>

      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={t('composer.context.title')}
        confirmLabel={t('composer.context.compact')}
        busy={!onCompact || !canCompact}
        onConfirm={() => {
          setOpen(false)
          onCompact?.()
        }}
      >
        <p className="text-ink-faint">{t('composer.context.subtitle')}</p>

        <div className="mt-1 flex items-baseline justify-between gap-3">
          <span className="text-ink">
            {t('composer.context.tokens', {
              used: formatTokens(context.usedTokens),
              max: formatTokens(context.maxTokens),
            })}
          </span>
          <span className="font-medium tabular-nums text-accent">{percent} %</span>
        </div>
        {/* La barre reste à sa place sous le total, et c'est son contenu qui change :
            une part unique quand on ne sait que le total, le découpage par catégorie
            quand le CLI le donne. */}
        {context.breakdown?.axis === 'categories' ? (
          <CategoriesBar breakdown={context.breakdown} windowTokens={context.maxTokens} />
        ) : (
          <div className="h-1.5 overflow-hidden rounded-full bg-surface-high">
            <div className="h-full rounded-full bg-accent" style={{ width: `${percent}%` }} />
          </div>
        )}

        <dl className="mt-1 flex justify-between gap-3 text-xs">
          <dt className="text-ink-faint">{t('composer.setting.model')}</dt>
          <dd className="min-w-0 truncate text-ink">{model}</dd>
        </dl>

        {/* La partie haute est commune aux trois CLI ; seule celle-ci change d'axe,
            parce qu'ils ne mesurent pas la même chose. Bornée en hauteur et défilante :
            une session chargée en skills et en outils MCP dépasse l'écran, et la
            `ConfirmDialog` ne défile pas d'elle-même. */}
        <div className="-mx-1 flex max-h-[45vh] flex-col gap-2 overflow-y-auto px-1">
          {/* `== null` et non `=== null` : le `.default(null)` du schéma n'est appliqué qu'au
              rejeu, le direct republie l'objet du runner sans le parser. Un bundle web neuf
              devant un serveur pas encore redémarré reçoit donc un `breakdown` absent.
              Et l'axe se teste en positif : un axe que ce bundle ne connaît pas encore
              retombe sur la phrase, il ne se fait pas déstructurer comme des jetons. */}
          {context.breakdown == null ? (
            <p className="text-meta text-ink-faint">{t('composer.context.noBreakdown')}</p>
          ) : context.breakdown.axis === 'categories' ? (
            <CategoriesDetail breakdown={context.breakdown} windowTokens={context.maxTokens} />
          ) : context.breakdown.axis === 'tokens' ? (
            <TokensDetail breakdown={context.breakdown} windowTokens={context.maxTokens} />
          ) : (
            <p className="text-meta text-ink-faint">{t('composer.context.noBreakdown')}</p>
          )}
        </div>

        <p className="mt-1 text-xs">{t('composer.context.explain')}</p>
      </ConfirmDialog>
    </>
  )
})
