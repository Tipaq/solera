import { CalendarDays, Hash, Link2, Paperclip, X } from 'lucide-react'
import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react'
import type { CardDto } from '@solera/protocol'
import { IconButton, cx } from '@solera/ui'
import { dayFromInput } from '../../lib/dates'
import { useEscapeLayer } from '../../lib/escape-layers'
import { locale, useTranslate } from '../../lib/i18n'
import {
  dismissMention,
  highlightSegments,
  insertMention,
  isSingleUrl,
  mentionQuery,
  normalizeUrl,
  startMention,
  suggestCards,
  urlsIn,
  type Edit,
} from '../../lib/writing'
import { columnLabel } from '../board/columns'
import type { BriefAttachments } from './use-brief-attachments'

/** Hauteur d'une ligne (`leading-6`) et marges verticales de la zone (`pt-3 pb-2`) :
    à changer avec ces classes. */
const LINE = 24
const PADDING = 20
/** Au-delà, la zone défile au lieu de grandir. */
const MAX_HEIGHT = 384
/** Hauteur d'une suggestion (`h-8`) et du pied de la liste, pour décider dessus ou dessous. */
const OPTION_HEIGHT = 32
const LIST_CHROME = 44

/** Le texte, rendu derrière la zone transparente : mentions de cartes et liens. */
function Highlight({ text, known }: { text: string; known: ReadonlySet<number> }) {
  const segments = useMemo(() => highlightSegments(text, known), [text, known])
  return (
    <>
      {segments.map((segment, index) =>
        segment.kind === 'text' || segment.kind === 'unknown' ? (
          segment.text
        ) : (
          <span
            key={index}
            className={segment.kind === 'card' ? 'rounded-sm bg-accent-wash text-accent' : 'text-accent underline decoration-accent/40'}
          >
            {segment.text}
          </span>
        ),
      )}
      {/* Garde la hauteur d'une dernière ligne vide, comme la zone elle-même. */}
      {'​'}
    </>
  )
}

/**
 * Le champ d'écriture à mentions : **un seul cadre**, le texte puis sa barre (Carte ·
 * Lien · Fichier, et ce que l'appelant pose à droite), comme le champ de commentaire de
 * GitHub. `#` pour une carte, coller une URL, déposer un fichier.
 *
 * Le texte est rendu par un calque derrière un `textarea` transparent : les mentions se
 * surlignent sans quitter un vrai champ (correcteur, annuler, sélection).
 *
 * L'autocomplétion `#` et le champ de lien sont des **couches** (`useEscapeLayer`) :
 * Échap les ferme sans fermer le tiroir qui les porte.
 */
export function BriefField({
  value,
  onChange,
  placeholder,
  label,
  rows = 12,
  cards,
  attachments,
  onSubmitShortcut,
  textRef,
  aside,
  autoFocus = true,
}: {
  value: string
  onChange: (next: string) => void
  placeholder: string
  /** Nom accessible de la zone ; le placeholder n'en tient pas lieu. */
  label: string
  rows?: number
  /** Les cartes qu'on peut mentionner. */
  cards: readonly CardDto[]
  attachments: BriefAttachments
  /** `⌘/Ctrl+Entrée` dans la zone : le geste principal de l'appelant. */
  onSubmitShortcut: () => void
  textRef: RefObject<HTMLTextAreaElement | null>
  /** Posé à droite de la barre (l'échéance, par exemple). */
  aside?: ReactNode
  autoFocus?: boolean
}) {
  const t = useTranslate()
  const mirror = useRef<HTMLDivElement>(null)
  const frame = useRef<HTMLDivElement>(null)
  const [above, setAbove] = useState(false)
  const [caret, setCaret] = useState(0)
  /** L'option surlignée de la liste ; `caret` est la position dans le texte. */
  const [activeOption, setActiveOption] = useState(0)
  /** Le `#` dont on a fermé la liste sans choisir : elle ne se rouvre pas pour lui. */
  const [dismissed, setDismissed] = useState<number | null>(null)
  const [dragging, setDragging] = useState(false)
  const known = useMemo(() => new Set(cards.map((card) => card.number)), [cards])
  const listId = useId()

  const mention = mentionQuery(value, caret)
  const open = mention && mention.start !== dismissed ? mention : null
  const matches = open ? suggestCards(cards, open.query) : []
  const active = Math.min(activeOption, Math.max(matches.length - 1, 0))
  const suggesting = open !== null && matches.length > 0

  /** Écrit le texte suivant et y replace le curseur ; `focus` le rend à la zone. */
  const placing = useRef<{ caret: number; focus: boolean } | null>(null)
  const apply = (edit: Edit, focus = true) => {
    placing.current = { caret: edit.caret, focus }
    onChange(edit.text)
    setCaret(edit.caret)
  }
  // Le curseur se replace dans le rendu qui écrit le texte, pas à la frame suivante : une
  // touche frappée entre-temps serait sinon écrite, puis le curseur reculerait derrière
  // elle (« #Lir » devenait « Lir# », et la liste ne s'ouvrait pas).
  useLayoutEffect(() => {
    const pending = placing.current
    const area = textRef.current
    if (!pending || !area) return
    placing.current = null
    if (pending.focus) area.focus()
    area.setSelectionRange(pending.caret, pending.caret)
  })

  // Le `#` fermé sans choix oublié dès qu'on le quitte : un autre `#` au même endroit,
  // plus tard, rouvre la liste.
  useEffect(() => {
    if (dismissed !== null && mention?.start !== dismissed) setDismissed(null)
  }, [dismissed, mention?.start])

  // La zone grandit avec son texte jusqu'à un plafond, puis défile : pas de poignée, qui
  // dépassait au-dessus de la liste des cartes.
  useLayoutEffect(() => {
    const area = textRef.current
    if (!area) return
    area.style.height = 'auto'
    const next = Math.max(rows * LINE + PADDING, Math.min(area.scrollHeight, MAX_HEIGHT))
    area.style.height = `${next}px`
    area.style.overflowY = area.scrollHeight > MAX_HEIGHT ? 'auto' : 'hidden'
    if (mirror.current) {
      // Le calque prend la même barre de défilement que la zone, sinon le texte y passe à
      // la ligne plus loin et le surlignage se décale.
      mirror.current.style.overflowY = area.style.overflowY
      mirror.current.scrollTop = area.scrollTop
    }
  }, [value, rows, textRef])

  // La liste se pose sous le cadre entier, barre comprise, ou au-dessus s'il manque de
  // place en bas.
  useLayoutEffect(() => {
    if (!suggesting || !frame.current) return
    const box = frame.current.getBoundingClientRect()
    const height = matches.length * OPTION_HEIGHT + LIST_CHROME
    setAbove(box.bottom + height + 8 > window.innerHeight && box.top - height - 8 > 0)
  }, [suggesting, matches.length])

  // Le curseur bouge aussi sans frappe (clic, flèches, « Carte » qui insère `#`) : on le
  // suit par l'événement du document, plus fiable que l'`onSelect` de React.
  useEffect(() => {
    const follow = () => {
      const area = textRef.current
      if (area && document.activeElement === area) setCaret(area.selectionStart)
    }
    document.addEventListener('selectionchange', follow)
    return () => document.removeEventListener('selectionchange', follow)
  }, [textRef])

  /** Fermer sans choisir : un `#` resté seul est retiré, une recherche entamée reste. */
  const dismiss = (focus = true) => {
    if (!open) return
    const edit = dismissMention(value, caret, open)
    if (edit) apply(edit, focus)
    else setDismissed(open.start)
  }
  useEscapeLayer(suggesting, dismiss)

  const choose = (card: CardDto) => {
    if (open) apply(insertMention(value, open.start, caret, card.number))
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault()
      onSubmitShortcut()
      return
    }
    if (!suggesting) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveOption((active + 1) % matches.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveOption((active - 1 + matches.length) % matches.length)
    } else if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault()
      choose(matches[active]!)
    }
  }

  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    if (event.clipboardData.files.length) {
      event.preventDefault()
      attachments.addFiles(event.clipboardData.files)
      return
    }
    const pasted = event.clipboardData.getData('text')
    // Une URL seule devient une puce ; dans un texte plus long, le texte reste et ses
    // URL sont jointes en plus.
    if (isSingleUrl(pasted)) {
      event.preventDefault()
      attachments.addLink(pasted.trim())
      return
    }
    for (const url of urlsIn(pasted)) attachments.addLink(url)
  }

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setDragging(false)
    if (event.dataTransfer.files.length) {
      attachments.addFiles(event.dataTransfer.files)
      return
    }
    const dropped = (event.dataTransfer.getData('text/uri-list') || event.dataTransfer.getData('text')).trim()
    if (isSingleUrl(dropped)) attachments.addLink(dropped)
  }

  const shared = 'w-full px-3.5 pt-3 pb-2 text-sm leading-6 break-words whitespace-pre-wrap'
  return (
    <div
      ref={frame}
      data-brief-field=""
      className={cx(
        'relative flex flex-col rounded-md border bg-canvas transition-colors focus-within:border-line-strong',
        dragging ? 'border-accent' : 'border-line',
      )}
      onDragOver={(event) => {
        event.preventDefault()
        setDragging(true)
      }}
      onDragLeave={(event) => {
        // Passer d'un enfant à l'autre déclenche aussi `dragleave` : on ne lâche le voile
        // qu'en quittant vraiment le cadre.
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false)
      }}
      onDrop={onDrop}
    >
      <div className="relative">
        <div ref={mirror} aria-hidden className={cx(shared, 'pointer-events-none absolute inset-0 overflow-hidden text-ink')}>
          <Highlight text={value} known={known} />
        </div>
        <textarea
          ref={textRef}
          autoFocus={autoFocus}
          value={value}
          onChange={(event) => {
            onChange(event.target.value)
            setCaret(event.target.selectionStart)
            setActiveOption(0)
          }}
          onSelect={(event) => setCaret(event.currentTarget.selectionStart)}
          onScroll={(event) => {
            if (mirror.current) mirror.current.scrollTop = event.currentTarget.scrollTop
          }}
          onKeyDown={onKeyDown}
          onBlur={() => {
            if (suggesting) dismiss(false)
          }}
          onPaste={onPaste}
          rows={rows}
          placeholder={placeholder}
          aria-label={label}
          spellCheck
          aria-autocomplete="list"
          aria-expanded={suggesting}
          aria-controls={suggesting ? listId : undefined}
          aria-activedescendant={suggesting ? `${listId}-${matches[active]!.number}` : undefined}
          className={cx(shared, 'relative block resize-none bg-transparent text-transparent caret-ink outline-none selection:bg-accent/25 placeholder:text-ink-faint')}
        />
        {dragging ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-t-md bg-accent-wash/60 text-sm text-accent">
            {t('writing.drop')}
          </div>
        ) : null}
      </div>

      <WriteToolbar attachments={attachments} onCard={() => apply(startMention(value, textRef.current?.selectionStart ?? value.length))} aside={aside} />

      {suggesting ? (
        <ul
          id={listId}
          role="listbox"
          aria-label={t('writing.suggestAria')}
          className={cx(
            'surface absolute inset-x-0 z-20 overflow-hidden rounded-lg border border-line py-1 shadow-float',
            above ? 'bottom-full mb-1.5' : 'top-full mt-1.5',
          )}
        >
          {matches.map((card, index) => (
            <li key={card.id}>
              <button
                type="button"
                id={`${listId}-${card.number}`}
                role="option"
                aria-selected={index === active}
                tabIndex={-1}
                // `onMouseDown` : un `onClick` laisserait d'abord la zone perdre le focus,
                // ce qui referme la liste avant que le choix soit pris.
                onMouseDown={(event) => {
                  event.preventDefault()
                  choose(card)
                }}
                onMouseEnter={() => setActiveOption(index)}
                className={cx(
                  'grid h-8 w-full grid-cols-[3rem_minmax(0,1fr)_auto] items-center gap-2 px-3 text-left text-sm',
                  index === active ? 'bg-surface-high' : '',
                )}
              >
                <span className="text-xs text-ink-faint tabular-nums">#{card.number}</span>
                <span className="min-w-0 truncate text-ink">{card.title}</span>
                <span className="text-right text-xs text-ink-faint">{columnLabel(card.column)}</span>
              </button>
            </li>
          ))}
          <li role="presentation" className="mt-1 border-t border-line px-3 pt-1.5 pb-0.5 text-meta text-ink-faint">
            {t('writing.suggestHint')}
          </li>
        </ul>
      ) : null}
    </div>
  )
}

/**
 * La barre, en bas du cadre : Carte · Lien · Fichier en icônes, puis ce que l'appelant
 * pose à droite. Le champ de lien s'ouvre **en place**, avec son ✕ : c'est une couche,
 * Échap la referme sans fermer le tiroir.
 */
function WriteToolbar({ attachments, onCard, aside }: { attachments: BriefAttachments; onCard: () => void; aside?: ReactNode }) {
  const t = useTranslate()
  const [linking, setLinking] = useState(false)
  const [link, setLink] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)
  const cancel = () => {
    setLink('')
    setLinking(false)
  }
  useEscapeLayer(linking, cancel)

  return (
    <div className="flex min-h-10 flex-wrap items-center gap-1 border-t border-line px-1.5 py-1">
      {linking ? (
        <form
          onSubmit={(event) => {
            event.preventDefault()
            const url = normalizeUrl(link)
            if (url) attachments.addLink(url)
            cancel()
          }}
          className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md bg-surface-high pr-1 pl-2.5 text-sm"
        >
          <Link2 size={14} className="shrink-0 text-ink-faint" />
          <input
            autoFocus
            value={link}
            onChange={(event) => setLink(event.target.value)}
            onBlur={() => {
              if (!link.trim()) cancel()
            }}
            placeholder={t('writing.linkPlaceholder')}
            aria-label={t('writing.linkAria')}
            className="min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-ink-faint"
          />
          <IconButton type="button" label={t('writing.linkCancel')} size="sm" onMouseDown={(event) => event.preventDefault()} onClick={cancel}>
            <X size={14} />
          </IconButton>
        </form>
      ) : (
        <>
          <IconButton label={t('writing.card')} title={t('writing.cardTip')} size="sm" onClick={onCard}>
            <Hash size={14} />
          </IconButton>
          <IconButton label={t('writing.link')} title={t('writing.linkTip')} size="sm" onClick={() => setLinking(true)}>
            <Link2 size={14} />
          </IconButton>
          <IconButton label={t('writing.file')} title={t('writing.fileTip')} size="sm" onClick={() => fileInput.current?.click()}>
            <Paperclip size={14} />
          </IconButton>
          {aside ? <span className="ml-auto flex items-center gap-2 pr-1">{aside}</span> : null}
        </>
      )}
      <input
        ref={fileInput}
        type="file"
        multiple
        hidden
        onChange={(event) => {
          if (event.target.files) attachments.addFiles(event.target.files)
          event.target.value = ''
        }}
      />
    </div>
  )
}

/**
 * L'échéance, en bouton de la barre : discrète vide, la date courte remplie, avec son ✕.
 * Un `input type=date` invisible couvre le bouton et ouvre le sélecteur du système.
 * La valeur est celle du champ (`AAAA-MM-JJ`), vide sans échéance.
 */
export function DueField({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  const t = useTranslate()
  const day = dayFromInput(value)
  return (
    <label className="relative inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md px-2 text-xs text-ink-soft hover:bg-surface-high hover:text-ink">
      <CalendarDays size={14} className="shrink-0" />
      <span className={day !== null ? 'text-ink' : undefined}>
        {day !== null ? new Intl.DateTimeFormat(locale(), { day: 'numeric', month: 'short', year: 'numeric' }).format(day) : t('writing.due')}
      </span>
      <input
        type="date"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-label={t('writing.due')}
        className="absolute inset-0 cursor-pointer opacity-0"
      />
      {day !== null ? (
        // Au-dessus du champ invisible, sinon le clic ouvrirait le sélecteur.
        <button
          type="button"
          aria-label={t('writing.dueRemove')}
          title={t('writing.dueRemove')}
          onClick={(event) => {
            event.preventDefault()
            onChange('')
          }}
          className="relative grid size-4 place-items-center rounded-sm text-ink-faint hover:text-ink"
        >
          <X size={11} />
        </button>
      ) : null}
    </label>
  )
}
