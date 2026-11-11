import { CircleDot, FileText, GitPullRequest, Globe, Hash, X } from 'lucide-react'
import type { ReactNode } from 'react'
import type { CardDto } from '@solera/protocol'
import { Tooltip, cx } from '@solera/ui'
import { locale, useTranslate } from '../../lib/i18n'
import { sizeParts } from '../../lib/writing'
import { columnLabel } from '../board/columns'
import type { BriefAttachments, CardMode } from './use-brief-attachments'

/**
 * Une puce jointe : même hauteur partout, icône de nature, ✕ au survol ou au focus
 * (toujours visible au doigt). Focalisée, ⌫ ou Suppr la retire.
 */
function Piece({ icon, onRemove, removeLabel, children, tall = false }: {
  icon: ReactNode
  onRemove: () => void
  removeLabel: string
  children: ReactNode
  /** Plus haute, pour la vignette d'une image. */
  tall?: boolean
}) {
  return (
    <span
      tabIndex={0}
      data-piece=""
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return
        if (event.key === 'Backspace' || event.key === 'Delete') {
          event.preventDefault()
          onRemove()
        }
      }}
      className={cx(
        'group/piece inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-md border border-line pr-1 text-xs outline-none focus-visible:border-line-strong focus-visible:ring-2 focus-visible:ring-accent/30',
        tall ? 'h-10 pl-1' : 'h-7 pl-2',
      )}
    >
      <span className="shrink-0 text-ink-faint">{icon}</span>
      {children}
      <button
        type="button"
        aria-label={removeLabel}
        title={removeLabel}
        onClick={onRemove}
        className="grid size-5 shrink-0 place-items-center rounded-sm text-ink-faint opacity-0 transition-opacity group-focus-within/piece:opacity-100 group-hover/piece:opacity-100 hover:bg-surface-high hover:text-ink pointer-coarse:opacity-100"
      >
        <X size={12} />
      </button>
    </span>
  )
}

/** Réf. ou Inclure, dans la puce d'une carte. */
function ModeSwitch({ card, mode, onChange }: { card: CardDto; mode: CardMode; onChange: (mode: CardMode) => void }) {
  const t = useTranslate()
  const option = (value: CardMode, label: string, tip: string) => (
    <Tooltip label={tip}>
      <button
        type="button"
        role="radio"
        aria-checked={mode === value}
        onClick={() => onChange(value)}
        className={cx('rounded-sm px-1.5', mode === value ? 'surface text-ink shadow-card' : 'text-ink-faint hover:text-ink')}
      >
        {label}
      </button>
    </Tooltip>
  )
  return (
    <span role="radiogroup" aria-label={t('attachments.refOrInclude', { number: card.number })} className="ml-0.5 inline-flex shrink-0 rounded-sm bg-sunken p-px text-meta">
      {option('reference', t('attachments.ref'), t('attachments.refTip'))}
      {option('include', t('attachments.include'), t('attachments.includeTip'))}
    </span>
  )
}

/**
 * La rangée « Joint · N », sous le champ : cartes mentionnées, liens, fichiers.
 * Invisible tant que rien n'est joint. `allowInclude` montre Réf./Inclure sur les cartes.
 */
export function AttachedPieces({ attachments, allowInclude }: { attachments: BriefAttachments; allowInclude: boolean }) {
  const t = useTranslate()
  if (attachments.count === 0) return null
  const size = (bytes: number) => {
    const { unit, value } = sizeParts(bytes)
    return t(`attachments.size.${unit}`, { value: new Intl.NumberFormat(locale()).format(value) })
  }
  return (
    <section aria-label={t('attachments.aria')} className="flex flex-col gap-2">
      <span className="text-xs text-ink-faint">{t('attachments.joined', { count: attachments.count })}</span>
      <div className="flex flex-wrap gap-1.5">
        {attachments.cards.map((card) => {
          const preview = card.parent
            ? t('attachments.cardPreviewInParent', { number: card.number, title: card.title, column: columnLabel(card.column), parentNumber: card.parent.number, parentTitle: card.parent.title })
            : t('attachments.cardPreview', { number: card.number, title: card.title, column: columnLabel(card.column) })
          return (
            <Piece key={card.id} icon={<Hash size={12} />} removeLabel={t('attachments.remove', { name: `#${card.number}` })} onRemove={() => attachments.removeCard(card)}>
              <Tooltip label={preview}>
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="text-ink-faint tabular-nums">{card.number}</span>
                  <span className="max-w-44 truncate text-ink">{card.title}</span>
                </span>
              </Tooltip>
              {allowInclude ? <ModeSwitch card={card} mode={attachments.modeOf(card)} onChange={(mode) => attachments.setMode(card, mode)} /> : null}
            </Piece>
          )
        })}
        {attachments.links.map((link) => {
          const Icon = link.kind === 'pr' ? GitPullRequest : link.kind === 'issue' ? CircleDot : Globe
          return (
            <Piece key={link.url} icon={<Icon size={12} />} removeLabel={t('attachments.remove', { name: link.label })} onRemove={() => attachments.removeLink(link.url)}>
              <Tooltip label={link.url}>
                <a href={link.url} target="_blank" rel="noreferrer" className="flex min-w-0 items-center gap-1.5 hover:underline">
                  <span className="max-w-48 truncate text-ink">{link.label}</span>
                  {link.detail ? <span className="max-w-32 truncate text-ink-faint">{link.detail}</span> : null}
                </a>
              </Tooltip>
            </Piece>
          )
        })}
        {attachments.files.map((piece) => (
          <Piece
            key={piece.key}
            tall={piece.preview !== null}
            icon={piece.preview ? <img src={piece.preview} alt="" className="size-8 rounded-sm object-cover" /> : <FileText size={12} />}
            removeLabel={t('attachments.remove', { name: piece.file.name })}
            onRemove={() => attachments.removeFile(piece.key)}
          >
            <span className="max-w-44 truncate text-ink">{piece.file.name}</span>
            <span className="shrink-0 text-ink-faint tabular-nums">{size(piece.file.size)}</span>
          </Piece>
        ))}
      </div>
    </section>
  )
}
