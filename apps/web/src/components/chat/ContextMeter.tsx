import { ConfirmDialog, cx } from '@solera/ui'
import { useState } from 'react'
import type { ContextState } from '../../lib/chat-fold'
import { useTranslate } from '../../lib/i18n'

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
 * La jauge, et le détail qu'elle ouvre.
 *
 * Un repère cliquable doit dire ce que le clic fera : c'est l'objection qui avait
 * jusqu'ici gardé la jauge inerte. Elle est levée par le contenu de la modale, qui
 * explique l'état de la fenêtre avant de proposer quoi que ce soit, et par l'intitulé
 * du bouton, qui annonce un détail et pas une action.
 */
export function ContextButton({ context, model, onCompact, canCompact }: {
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
        <div className="h-1.5 overflow-hidden rounded-full bg-surface-high">
          <div className="h-full rounded-full bg-accent" style={{ width: `${percent}%` }} />
        </div>

        <dl className="mt-1 flex justify-between gap-3 text-xs">
          <dt className="text-ink-faint">{t('composer.setting.model')}</dt>
          <dd className="min-w-0 truncate text-ink">{model}</dd>
        </dl>

        <p className="mt-1 text-xs">{t('composer.context.explain')}</p>
        {/* Le détail par source — système, outils, fichiers lus — manque parce que les
            CLI donnent un total et pas sa composition. L'estimer serait inventer. */}
        <p className="text-meta text-ink-faint">{t('composer.context.noBreakdown')}</p>
      </ConfirmDialog>
    </>
  )
}
