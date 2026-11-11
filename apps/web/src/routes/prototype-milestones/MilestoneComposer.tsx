/* PROTOTYPE — jetable (branche proto/page-projet). Ne pas fusionner dans main.
 *
 * Flux v2 : écrire un jalon, ou un ajout à un jalon, dans un vrai champ. Une phrase
 * suffit, un brief aussi ; le pied dit en direct ce que l'agent va faire de ce qu'on a
 * écrit (`brief.ts`) et dans quelle étape le jalon entre selon le geste.
 *
 * Joindre, sans quitter le texte :
 * - `#` ouvre l'autocomplétion des cartes ; la carte choisie s'écrit `#N`, surlignée dans
 *   le texte, et rejoint la rangée « Joint » (retirer la puce retire aussi la mention) ;
 * - coller une URL en fait une puce de lien (GitHub reconnu : « PR #212 ») ;
 * - déposer un fichier (ou « Fichier ») en fait une puce, avec vignette pour une image.
 * Une carte jointe est une *Référence* (en vrai : lien `related`, informatif) ou est
 * *Incluse* dans le jalon (en vrai : `parent` = le jalon, elle devient une de ses cartes).
 *
 * Rien ne part au serveur : en démo, le jalon entre dans le magasin (les cartes incluses y
 * restent liées en `related`, faute de mieux) ; hors démo, le geste dit ce qu'il ferait.
 */
import {
  CalendarDays,
  CircleDot,
  CornerDownLeft,
  FileText,
  GitPullRequest,
  Globe,
  Hash,
  Link2,
  Paperclip,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent, type ReactNode } from 'react'
import type { CardDto } from '@solera/protocol'
import { Button, IconButton, Tooltip, cx } from '@solera/ui'
import { Drawer, useEscapeLayer } from '../../components/prototype/Drawer'
import { announce, readBrief, titleFromBrief, type BriefReading } from './brief'
import { createMilestoneFromBrief, proposeAddition, type MilestoneBrief } from './demo-store'
import { ENTRY_STAGE, MATURITY_LABEL, MATURITY_TONE } from './maturity'
import { refinePrompt } from './refineSession'

const PLACEHOLDER = `ex. Mode hors-ligne complet

ou un brief :
## Objectif
Pouvoir relire et répondre aux sessions sans réseau.
## Étapes
- Cache local des fils
- File d'envoi des réponses (voir #156)
- Resynchronisation au retour du réseau
## Hors champ
- Lancer une session hors ligne`

const COLUMN_WORD: Record<string, string> = {
  todo: 'à faire',
  in_progress: 'en cours',
  review: 'à relire',
  done: 'faite',
  abandoned: 'abandonnée',
}

/* ------------------------------------------------------------------ pièces jointes */

interface LinkPiece { url: string; label: string; detail: string; kind: 'pr' | 'issue' | 'web' }
interface FilePiece { key: string; name: string; size: number; preview: string | null }
type CardMode = 'reference' | 'include'

const URL_RE = /https?:\/\/[^\s<>()]+/g
const MENTION_RE = /(^|[^\w&])#(\d+)\b/g

/** Ce qu'une URL donne à lire : « PR #212 · owner/repo », ou un titre tiré du chemin. */
export function linkPiece(url: string): LinkPiece {
  try {
    const parsed = new URL(url)
    const host = parsed.hostname.replace(/^www\./, '')
    const parts = parsed.pathname.split('/').filter(Boolean)
    if (host === 'github.com' && parts.length >= 4 && (parts[2] === 'pull' || parts[2] === 'issues')) {
      return { url, kind: parts[2] === 'pull' ? 'pr' : 'issue', label: `${parts[2] === 'pull' ? 'PR' : 'Issue'} #${parts[3]}`, detail: `${parts[0]}/${parts[1]}` }
    }
    const last = decodeURIComponent(parts[parts.length - 1] ?? '').replace(/\.[a-z0-9]{1,5}$/i, '').replace(/[-_+]+/g, ' ').trim()
    const label = last && !/^\d+$/.test(last) && last.length > 2 ? last.charAt(0).toUpperCase() + last.slice(1) : host
    return { url, kind: 'web', label: label.length > 48 ? `${label.slice(0, 45)}…` : label, detail: host }
  } catch {
    return { url, kind: 'web', label: url, detail: '' }
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`
  return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} Mo`
}

function mentionedNumbers(text: string): number[] {
  return [...text.matchAll(MENTION_RE)].map((match) => Number(match[2]))
}

/** Les pièces jointes d'un texte : cartes (mentionnées ou ajoutées), liens, fichiers. */
function useAttachments(cards: CardDto[], text: string, setText: (next: string) => void) {
  const [modes, setModes] = useState<Record<string, CardMode>>({})
  const [links, setLinks] = useState<LinkPiece[]>([])
  const [files, setFiles] = useState<FilePiece[]>([])
  const byNumber = useMemo(() => new Map(cards.map((card) => [card.number, card])), [cards])
  // Une carte jointe est une carte mentionnée dans le texte : le texte fait foi.
  const attachedCards = useMemo(() => {
    const seen = new Set<number>()
    return mentionedNumbers(text)
      .filter((number) => (seen.has(number) ? false : (seen.add(number), true)))
      .map((number) => byNumber.get(number))
      .filter((card): card is CardDto => Boolean(card))
  }, [text, byNumber])

  const removeCard = (card: CardDto) => {
    setText(text.replace(new RegExp(`(^|[^\\w&])#${card.number}\\b ?`, 'g'), '$1').replace(/[ \t]+\n/g, '\n'))
  }
  const addLink = (url: string) => setLinks((current) => (current.some((entry) => entry.url === url) ? current : [...current, linkPiece(url)]))
  const addFiles = (list: FileList | File[]) => {
    const next = [...list].map((file) => ({
      key: `${file.name}-${file.size}-${file.lastModified}`,
      name: file.name,
      size: file.size,
      preview: file.type.startsWith('image/') ? URL.createObjectURL(file) : null,
    }))
    setFiles((current) => [...current, ...next.filter((file) => !current.some((entry) => entry.key === file.key))])
  }
  const reset = () => {
    setModes({})
    setLinks([])
    files.forEach((file) => file.preview && URL.revokeObjectURL(file.preview))
    setFiles([])
  }
  return {
    cards: attachedCards,
    modeOf: (card: CardDto): CardMode => modes[card.id] ?? 'reference',
    setMode: (card: CardDto, mode: CardMode) => setModes((current) => ({ ...current, [card.id]: mode })),
    removeCard,
    links,
    addLink,
    removeLink: (url: string) => setLinks((current) => current.filter((entry) => entry.url !== url)),
    files,
    addFiles,
    removeFile: (key: string) => setFiles((current) => current.filter((entry) => entry.key !== key)),
    count: attachedCards.length + links.length + files.length,
    reset,
  }
}
type Attachments = ReturnType<typeof useAttachments>

/* ------------------------------------------------------------------ la zone d'écriture */

/** Le texte, surligné derrière la zone : les mentions de cartes et les liens. */
function Highlight({ text, known }: { text: string; known: Set<number> }) {
  const parts: ReactNode[] = []
  const tokens = /(#\d+\b|https?:\/\/[^\s<>()]+)/g
  let last = 0
  for (const match of text.matchAll(tokens)) {
    const at = match.index ?? 0
    if (at > last) parts.push(text.slice(last, at))
    const token = match[0]
    const isCard = token.startsWith('#')
    const ok = !isCard || known.has(Number(token.slice(1)))
    parts.push(
      <span key={at} className={cx('rounded-[3px]', isCard ? (ok ? 'bg-accent/15 text-accent' : 'text-ink') : 'text-accent underline decoration-accent/40')}>{token}</span>,
    )
    last = at + token.length
  }
  parts.push(text.slice(last))
  // L'espace final garde la hauteur de la dernière ligne vide, comme la zone elle-même.
  return <>{parts}{'​'}</>
}

/** Insère `#` au curseur : l'autocomplétion des cartes s'ouvre d'elle-même. */
function startMention(textRef: React.RefObject<HTMLTextAreaElement | null>, value: string, setValue: (next: string) => void) {
  const area = textRef.current
  const at = area?.selectionStart ?? value.length
  const before = value.slice(0, at)
  const glue = before && !/\s$/.test(before) ? ' ' : ''
  setValue(`${before}${glue}#${value.slice(at)}`)
  const next = at + glue.length + 1
  requestAnimationFrame(() => {
    area?.focus()
    area?.setSelectionRange(next, next)
  })
}

/**
 * La zone d'écriture, commune au nouveau jalon et à l'ajout : **un seul cadre**, le texte
 * puis sa barre (Carte · Lien · Fichier, et ce qu'on y ajoute à droite), comme le champ
 * de commentaire de GitHub. `#` pour une carte, coller une URL, déposer un fichier.
 * Le texte est rendu par un calque derrière une zone transparente, pour surligner les
 * mentions sans quitter un vrai `textarea`.
 *
 * L'autocomplétion `#` est une **couche** (`useEscapeLayer`) : Échap, ou un clic dehors,
 * la ferme sans fermer le tiroir, et retire le `#` resté seul.
 */
function Writing({ value, onChange, placeholder, rows = 12, cards, attachments, onSubmitShortcut, textRef, aside }: {
  value: string
  onChange: (next: string) => void
  placeholder: string
  rows?: number
  cards: CardDto[]
  attachments: Attachments
  onSubmitShortcut: () => void
  textRef: React.RefObject<HTMLTextAreaElement | null>
  /** Posé à droite de la barre de saisie (l'échéance, par exemple). */
  aside?: ReactNode
}) {
  const mirror = useRef<HTMLDivElement>(null)
  const frame = useRef<HTMLDivElement>(null)
  const [above, setAbove] = useState(false)
  const [caret, setCaret] = useState(0)
  const [cursor, setCursor] = useState(0)
  const [dismissed, setDismissed] = useState<number | null>(null)
  const [dragging, setDragging] = useState(false)
  const known = useMemo(() => new Set(cards.map((card) => card.number)), [cards])

  // Le mot `#…` juste avant le curseur ouvre l'autocomplétion.
  const token = /(^|[^\w&])#([\p{L}\p{N}-]*)$/u.exec(value.slice(0, caret))
  const tokenStart = token ? caret - token[2]!.length - 1 : -1
  const query = token && dismissed !== tokenStart ? token[2]!.toLocaleLowerCase('fr') : null
  const matches = query === null
    ? []
    : cards
        .filter((card) => card.column !== 'abandoned')
        .filter((card) => !query || String(card.number).startsWith(query) || card.title.toLocaleLowerCase('fr').includes(query))
        .sort((a, b) => Number(a.column === 'done') - Number(b.column === 'done') || b.number - a.number)
        .slice(0, 6)
  const active = Math.min(cursor, Math.max(matches.length - 1, 0))
  const suggesting = matches.length > 0

  // La zone grandit avec son texte, jusqu'à un plafond, puis défile : pas de poignée de
  // redimensionnement, qui dépassait au-dessus du menu `#`.
  useEffect(() => {
    const area = textRef.current
    if (!area) return
    const min = rows * 24 + 20
    area.style.height = 'auto'
    const next = Math.max(min, Math.min(area.scrollHeight, 384))
    area.style.height = `${next}px`
    area.style.overflowY = area.scrollHeight > 384 ? 'auto' : 'hidden'
  }, [value, rows, textRef])

  // Le menu `#` se pose sous le cadre entier, ou au-dessus s'il manque de place en bas.
  useEffect(() => {
    if (!suggesting || !frame.current) return
    const box = frame.current.getBoundingClientRect()
    const height = matches.length * 32 + 44
    setAbove(box.bottom + height + 8 > window.innerHeight && box.top - height - 8 > 0)
  }, [suggesting, matches.length])

  // Le curseur peut bouger sans frappe (clic, flèches, « Carte » qui insère `#`) :
  // on le suit par l'événement du document, plus fiable que l'`onSelect` de React.
  useEffect(() => {
    const follow = () => {
      const area = textRef.current
      if (area && document.activeElement === area) setCaret(area.selectionStart)
    }
    document.addEventListener('selectionchange', follow)
    return () => document.removeEventListener('selectionchange', follow)
  }, [textRef])

  /** Fermer sans choisir : un `#` resté seul est retiré, une recherche entamée reste. */
  const dismiss = () => {
    if (tokenStart < 0) return
    if (token && token[2] === '') {
      onChange(value.slice(0, tokenStart) + value.slice(caret))
      const at = tokenStart
      requestAnimationFrame(() => {
        textRef.current?.setSelectionRange(at, at)
        setCaret(at)
      })
    } else setDismissed(tokenStart)
  }
  useEscapeLayer(suggesting, dismiss)

  const choose = (card: CardDto) => {
    const before = value.slice(0, tokenStart)
    const after = value.slice(caret)
    const insert = `#${card.number}${after.startsWith(' ') ? '' : ' '}`
    onChange(before + insert + after)
    const at = before.length + insert.length
    requestAnimationFrame(() => {
      textRef.current?.focus()
      textRef.current?.setSelectionRange(at, at)
      setCaret(at)
    })
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault()
      onSubmitShortcut()
      return
    }
    if (!suggesting) return
    if (event.key === 'ArrowDown') { event.preventDefault(); setCursor((active + 1) % matches.length) }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setCursor((active - 1 + matches.length) % matches.length) }
    else if (event.key === 'Enter' || event.key === 'Tab') { event.preventDefault(); choose(matches[active]!) }
  }

  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const pasted = event.clipboardData.getData('text').trim()
    if (event.clipboardData.files.length) {
      event.preventDefault()
      attachments.addFiles(event.clipboardData.files)
      return
    }
    // Une URL seule devient une puce ; dans un texte plus long, ses URL sont jointes et le texte reste.
    if (/^https?:\/\/\S+$/.test(pasted)) {
      event.preventDefault()
      attachments.addLink(pasted)
      return
    }
    for (const match of pasted.matchAll(URL_RE)) attachments.addLink(match[0])
  }

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setDragging(false)
    if (event.dataTransfer.files.length) attachments.addFiles(event.dataTransfer.files)
    else {
      const dropped = event.dataTransfer.getData('text/uri-list') || event.dataTransfer.getData('text')
      if (/^https?:\/\//.test(dropped.trim())) attachments.addLink(dropped.trim())
    }
  }

  const shared = 'w-full px-3.5 pt-3 pb-2 text-sm leading-6 break-words whitespace-pre-wrap'
  return (
    <div
      ref={frame}
      className={cx(
        'relative flex flex-col rounded-lg border bg-canvas transition-colors focus-within:border-line-strong',
        dragging ? 'border-accent' : 'border-line',
      )}
      onDragOver={(event) => { event.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      <div className="relative">
        <div ref={mirror} aria-hidden className={cx(shared, 'pointer-events-none absolute inset-0 overflow-hidden text-ink')}>
          <Highlight text={value} known={known} />
        </div>
        <textarea
          ref={textRef}
          autoFocus
          value={value}
          onChange={(event) => { onChange(event.target.value); setCaret(event.target.selectionStart); setCursor(0) }}
          onSelect={(event) => setCaret(event.currentTarget.selectionStart)}
          onScroll={(event) => { if (mirror.current) mirror.current.scrollTop = event.currentTarget.scrollTop }}
          onKeyDown={onKeyDown}
          onBlur={() => { if (suggesting) dismiss() }}
          onPaste={onPaste}
          rows={rows}
          placeholder={placeholder}
          spellCheck
          aria-autocomplete="list"
          aria-expanded={suggesting}
          className={cx(shared, 'relative block resize-none bg-transparent text-transparent caret-ink outline-none selection:bg-accent/25 placeholder:text-ink-faint/60')}
        />
        {dragging ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-t-lg bg-accent/5 text-sm text-accent">
            Dépose pour joindre
          </div>
        ) : null}

      </div>

      <WriteToolbar attachments={attachments} onCard={() => startMention(textRef, value, onChange)} aside={aside} />
      {suggesting ? (
          <ul role="listbox" aria-label="Cartes" className={cx('absolute inset-x-0 z-30 overflow-hidden rounded-lg border border-line bg-canvas py-1 shadow-md', above ? 'bottom-full mb-1.5' : 'top-full mt-1.5')}>
            {matches.map((card, index) => (
              <li key={card.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={index === active}
                  onMouseDown={(event) => { event.preventDefault(); choose(card) }}
                  onMouseEnter={() => setCursor(index)}
                  className={cx('grid h-8 w-full grid-cols-[3rem_minmax(0,1fr)_auto] items-center gap-2 px-3 text-left text-sm', index === active ? 'bg-surface-high' : '')}
                >
                  <span className="text-xs text-ink-faint tabular-nums">#{card.number}</span>
                  <span className="min-w-0 truncate text-ink">{card.title}</span>
                  <span className="text-right text-xs text-ink-faint">{COLUMN_WORD[card.column] ?? card.column}</span>
                </button>
              </li>
            ))}
            <li className="mt-1 border-t border-line px-3 pt-1.5 pb-0.5 text-meta text-ink-faint">↑↓ choisir · Entrée joindre · Échap fermer</li>
          </ul>
        ) : null}
    </div>
  )
}

/**
 * La barre de saisie, en bas du cadre : Carte · Lien · Fichier en icônes (infobulles et
 * raccourcis), puis ce que la zone pose à droite. Le champ de lien s'ouvre **en place**,
 * avec son ✕ : c'est une couche, Échap la referme sans fermer le tiroir.
 */
function WriteToolbar({ attachments, onCard, aside }: { attachments: Attachments; onCard: () => void; aside?: ReactNode }) {
  const [linking, setLinking] = useState(false)
  const [link, setLink] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)
  const cancel = () => { setLink(''); setLinking(false) }
  useEscapeLayer(linking, cancel)

  return (
    <div className="flex min-h-10 flex-wrap items-center gap-1 border-t border-line px-1.5 py-1">
      {linking ? (
        <form
          onSubmit={(event) => {
            event.preventDefault()
            const url = link.trim()
            if (url) attachments.addLink(/^https?:\/\//.test(url) ? url : `https://${url}`)
            cancel()
          }}
          className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md bg-surface-high/60 pr-1 pl-2.5 text-sm"
        >
          <Link2 size={14} className="shrink-0 text-ink-faint" />
          <input
            autoFocus
            value={link}
            onChange={(event) => setLink(event.target.value)}
            onBlur={() => { if (!link.trim()) cancel() }}
            placeholder="Colle ou tape une adresse, puis Entrée"
            aria-label="Adresse du lien"
            className="min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-ink-faint"
          />
          <IconButton label="Annuler (Échap)" size="sm" onMouseDown={(event) => event.preventDefault()} onClick={cancel}>
            <X size={14} />
          </IconButton>
        </form>
      ) : (
        <>
          <Tooltip label="Joindre une carte — tape #">
            <IconButton label="Joindre une carte" size="sm" onClick={onCard}><Hash size={15} /></IconButton>
          </Tooltip>
          <Tooltip label="Joindre un lien — ou colle une adresse">
            <IconButton label="Joindre un lien" size="sm" onClick={() => setLinking(true)}><Link2 size={15} /></IconButton>
          </Tooltip>
          <Tooltip label="Joindre un fichier — ou dépose-le">
            <IconButton label="Joindre un fichier" size="sm" onClick={() => fileInput.current?.click()}><Paperclip size={15} /></IconButton>
          </Tooltip>
          {aside ? <span className="ml-auto flex items-center gap-2 pr-1">{aside}</span> : null}
        </>
      )}
      <input ref={fileInput} type="file" multiple hidden onChange={(event) => { if (event.target.files) attachments.addFiles(event.target.files); event.target.value = '' }} />
    </div>
  )
}

/** L'échéance, en bouton de la barre de saisie : discrète vide, lisible remplie. */
function DueField({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  return (
    <label className="relative inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md px-2 text-xs text-ink-soft hover:bg-surface-high hover:text-ink">
      <CalendarDays size={14} className="shrink-0" />
      <span className={value ? 'text-ink' : undefined}>
        {value ? new Date(`${value}T12:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Échéance'}
      </span>
      {value ? (
        <button type="button" aria-label="Retirer l'échéance" onClick={(event) => { event.preventDefault(); onChange('') }} className="grid size-4 place-items-center rounded text-ink-faint hover:text-ink">
          <X size={11} />
        </button>
      ) : null}
      <input type="date" value={value} onChange={(event) => onChange(event.target.value)} aria-label="Échéance" className="absolute inset-0 cursor-pointer opacity-0" />
    </label>
  )
}

/* ------------------------------------------------------------------ la rangée « Joint » */

/**
 * Une puce jointe : même hauteur partout, icône de nature, ✕ au survol ou au focus.
 * Focalisée, ⌫ ou Suppr la retire.
 */
function Piece({ icon, onRemove, removeLabel, children, tall = false }: {
  icon: ReactNode
  onRemove: () => void
  removeLabel: string
  children: ReactNode
  tall?: boolean
}) {
  return (
    <span
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return
        if (event.key === 'Backspace' || event.key === 'Delete') { event.preventDefault(); onRemove() }
      }}
      className={cx(
        'group/piece inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-md border border-line pr-1 pl-2 text-xs outline-none focus-visible:border-line-strong focus-visible:ring-2 focus-visible:ring-accent/30',
        tall ? 'h-10 pl-1' : 'h-7',
      )}
    >
      <span className="shrink-0 text-ink-faint">{icon}</span>
      {children}
      <button
        type="button"
        aria-label={removeLabel}
        onClick={onRemove}
        className="grid size-5 shrink-0 place-items-center rounded text-ink-faint opacity-0 transition-opacity group-hover/piece:opacity-100 group-focus-within/piece:opacity-100 hover:bg-surface-high hover:text-ink pointer-coarse:opacity-100"
      >
        <X size={12} />
      </button>
    </span>
  )
}

function Joined({ attachments, cards, allowInclude }: { attachments: Attachments; cards: CardDto[]; allowInclude: boolean }) {
  if (attachments.count === 0) return null
  const parentOf = (card: CardDto) => (card.parent ? cards.find((entry) => entry.id === card.parent!.id) ?? null : null)
  return (
    <section aria-label="Pièces jointes" className="flex flex-col gap-2">
      <span className="text-xs text-ink-faint">Joint · {attachments.count}</span>
      <div className="flex flex-wrap gap-1.5">
        {attachments.cards.map((card) => {
          const mode = attachments.modeOf(card)
          const parent = parentOf(card)
          const preview = `#${card.number} ${card.title} — ${COLUMN_WORD[card.column] ?? card.column}${parent ? ` · dans #${parent.number} ${parent.title}` : ''}`
          return (
            <Piece key={card.id} icon={<Hash size={12} />} removeLabel={`Retirer #${card.number}`} onRemove={() => attachments.removeCard(card)}>
              <Tooltip label={preview}>
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="text-ink-faint tabular-nums">{card.number}</span>
                  <span className="max-w-44 truncate text-ink">{card.title}</span>
                </span>
              </Tooltip>
              {allowInclude ? (
                <span className="ml-0.5 inline-flex shrink-0 rounded bg-surface-high/60 p-px text-meta" role="radiogroup" aria-label={`#${card.number} : référence ou incluse`}>
                  <Tooltip label="Référence : un lien informatif, la carte reste où elle est.">
                    <button type="button" role="radio" aria-checked={mode === 'reference'} onClick={() => attachments.setMode(card, 'reference')} className={cx('rounded-[3px] px-1.5', mode === 'reference' ? 'bg-canvas text-ink shadow-xs' : 'text-ink-faint hover:text-ink')}>
                      Réf.
                    </button>
                  </Tooltip>
                  <Tooltip label="Inclure : la carte devient une carte du jalon.">
                    <button type="button" role="radio" aria-checked={mode === 'include'} onClick={() => attachments.setMode(card, 'include')} className={cx('rounded-[3px] px-1.5', mode === 'include' ? 'bg-canvas text-ink shadow-xs' : 'text-ink-faint hover:text-ink')}>
                      Inclure
                    </button>
                  </Tooltip>
                </span>
              ) : null}
            </Piece>
          )
        })}
        {attachments.links.map((link) => {
          const Icon = link.kind === 'pr' ? GitPullRequest : link.kind === 'issue' ? CircleDot : Globe
          return (
            <Piece key={link.url} icon={<Icon size={12} />} removeLabel={`Retirer ${link.label}`} onRemove={() => attachments.removeLink(link.url)}>
              <Tooltip label={link.url}>
                <a href={link.url} target="_blank" rel="noreferrer" className="flex min-w-0 items-center gap-1.5 hover:underline">
                  <span className="max-w-48 truncate text-ink">{link.label}</span>
                  {link.detail ? <span className="max-w-32 truncate text-ink-faint">{link.detail}</span> : null}
                </a>
              </Tooltip>
            </Piece>
          )
        })}
        {attachments.files.map((file) => (
          <Piece
            key={file.key}
            tall={Boolean(file.preview)}
            icon={file.preview ? <img src={file.preview} alt="" className="size-8 rounded object-cover" /> : <FileText size={12} />}
            removeLabel={`Retirer ${file.name}`}
            onRemove={() => attachments.removeFile(file.key)}
          >
            <span className="max-w-44 truncate text-ink">{file.name}</span>
            <span className="shrink-0 text-ink-faint tabular-nums">{formatSize(file.size)}</span>
          </Piece>
        ))}
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------ ce qui va se passer */

type Intent = MilestoneBrief['intent']

function spottedChips(reading: BriefReading, attachments: Attachments): string[] {
  const plural = (count: number, word: string, many = `${word}s`) => `${count} ${count > 1 ? many : word}`
  const chips: string[] = []
  if (reading.objective) chips.push('objectif')
  if (reading.steps.length) chips.push(plural(reading.steps.length, 'étape'))
  if (reading.constraints.length) chips.push(plural(reading.constraints.length, 'contrainte'))
  if (reading.outOfScope.length) chips.push(`${reading.outOfScope.length} hors champ`)
  if (reading.openPoints.length) chips.push(plural(reading.openPoints.length, 'point ouvert', 'points ouverts'))
  if (attachments.cards.length) chips.push(plural(attachments.cards.length, 'carte'))
  if (attachments.links.length) chips.push(plural(attachments.links.length, 'lien'))
  if (attachments.files.length) chips.push(plural(attachments.files.length, 'fichier'))
  return chips
}

function Spotted({ reading, attachments }: { reading: BriefReading; attachments: Attachments }) {
  const chips = spottedChips(reading, attachments)
  if (!chips.length) return null
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-ink-faint">
      <span>Repéré</span>
      {chips.map((chip, index) => (
        <span key={chip} className="text-ink-soft">{chip}{index < chips.length - 1 ? <span className="text-ink-faint">,</span> : null}</span>
      ))}
    </span>
  )
}

/** À gauche du pied : l'étape d'arrivée, ce que fera l'agent en une ligne, ce qu'il a repéré. */
function WhatHappens({ intent, reading, attachments }: { intent: Intent; reading: BriefReading; attachments: Attachments }) {
  const said = announce(reading)
  const entry = ENTRY_STAGE[intent]
  const agent = said.mode === 'empty' ? said.line : intent === 'note' ? 'Aucune session ne part : tu l’affineras plus tard.' : said.line.replace(/^[^:]+:\s*/, '')
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <div className="flex min-w-0 items-center gap-2 text-sm">
        <span className="shrink-0 text-xs text-ink-faint">Entre en</span>
        <span className={cx('shrink-0 rounded-full px-2 py-0.5 text-meta font-medium', MATURITY_TONE[entry.stage])}>{MATURITY_LABEL[entry.stage]}</span>
        <Tooltip label={said.mode === 'empty' ? agent : `${agent} ${entry.then}`}>
          <span className="min-w-0 truncate text-ink-soft">{agent}</span>
        </Tooltip>
      </div>
      <Spotted reading={reading} attachments={attachments} />
    </div>
  )
}

function Kbd() {
  return (
    <span className="ml-1.5 hidden items-center gap-0.5 rounded border border-current/30 px-1 text-meta opacity-70 md:inline-flex">
      {navigator.userAgent.includes('Mac') ? '⌘' : 'Ctrl'}<CornerDownLeft size={10} />
    </span>
  )
}

/** L'en-tête des deux tiroirs : la nature en petit, le titre en grand, ✕ à droite. */
function ComposerHeader({ eyebrow, onClose, children }: { eyebrow: string; onClose: () => void; children: ReactNode }) {
  return (
    <header className="flex shrink-0 items-start gap-3 px-6 pt-4 pb-2">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-xs text-ink-faint">{eyebrow}</span>
        {children}
      </div>
      <IconButton label="Fermer (Échap)" size="sm" onClick={onClose}><X size={15} /></IconButton>
    </header>
  )
}

/** Le pied collant : ce qui va se passer à gauche, les gestes à droite. */
function ComposerFooter({ info, actions }: { info: ReactNode; actions: ReactNode }) {
  return (
    <footer className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-3 border-t border-line bg-canvas px-6 py-3">
      {info}
      <div className="ml-auto flex shrink-0 items-center gap-2">{actions}</div>
    </footer>
  )
}

/* ------------------------------------------------------------------ nouveau jalon */

export function NewMilestoneDrawer({
  open,
  onClose,
  cards,
  demo,
  onCreated,
  onOpenSession,
  onSimulate,
}: {
  open: boolean
  onClose: () => void
  cards: CardDto[]
  demo: boolean
  /**
   * Le numéro du jalon créé, ce qu'on a choisi d'en faire, et — pour *Affiner* ou
   * *Découper* — le premier message de la session d'affinage (`/affiner-un-jalon`).
   */
  onCreated: (number: number, intent: MilestoneBrief['intent'], prompt: string | null) => void
  /** Hors démo, rien n'est créé : on ouvre quand même la session, message pré-rempli. */
  onOpenSession?: (prompt: string) => void
  onSimulate: (text: string) => void
}) {
  const [text, setText] = useState('')
  const [title, setTitle] = useState('')
  const [due, setDue] = useState('')
  const [hovered, setHovered] = useState<Intent | null>(null)
  const textRef = useRef<HTMLTextAreaElement>(null)
  const attachments = useAttachments(cards, text, setText)
  const reading = useMemo(() => readBrief(text), [text])
  const empty = reading.words === 0
  const derived = empty ? '' : titleFromBrief(text)
  const primary: Intent = reading.sufficient ? 'split' : 'refine'
  const shown = hovered ?? primary

  useEffect(() => {
    if (!open) setHovered(null)
  }, [open])

  const reset = () => {
    setText('')
    setTitle('')
    setDue('')
    attachments.reset()
  }

  const submit = (intent: Intent) => {
    if (empty || (intent === 'split' && !reading.sufficient)) return
    const included = attachments.cards.filter((card) => attachments.modeOf(card) === 'include')
    const promptFor = (number: number | null) =>
      intent === 'note'
        ? null
        : refinePrompt({
            number,
            intent,
            brief: text,
            cards: attachments.cards.map((card) => ({ number: card.number, include: attachments.modeOf(card) === 'include' })),
            links: attachments.links.map((link) => link.url),
          })
    if (!demo && intent !== 'note' && onOpenSession) {
      // Rien n'est écrit : la session s'ouvre quand même, message pré-rempli, pour qu'on
      // voie où mène le geste.
      reset()
      onClose()
      onOpenSession(promptFor(null)!)
      return
    }
    if (!demo) {
      onSimulate(
        `${intent === 'note'
          ? 'Simulé : Solera créerait la carte-jalon (drapeau « jalon »), sans lancer de session.'
          : intent === 'split'
            ? 'Simulé : Solera créerait le jalon et lancerait une session qui propose directement un découpage (propose_cards).'
            : "Simulé : Solera créerait le jalon et lancerait une session d'affinage. Active « Données de démo » pour jouer le parcours."}${included.length ? ` Les cartes ${included.map((card) => `#${card.number}`).join(', ')} deviendraient des cartes du jalon (parent).` : ''}`,
      )
      reset()
      onClose()
      return
    }
    // Un titre retouché passe en tête du texte : c'est de là que le magasin le tire.
    const heading = title.trim()
    let body = text
    if (heading) {
      const lines = text.split('\n')
      const first = lines.findIndex((line) => line.trim())
      if (first >= 0 && /^#\s/.test(lines[first]!.trim())) lines.splice(first, 1)
      body = `# ${heading}\n\n${lines.join('\n').trim()}`
    }
    if (attachments.files.length) body += `\n\n**Fichiers**\n${attachments.files.map((file) => `- ${file.name} (${formatSize(file.size)})`).join('\n')}`
    const number = createMilestoneFromBrief({
      text: body,
      links: attachments.links.map((link) => link.url),
      cardIds: attachments.cards.map((card) => card.id),
      dueAt: due ? new Date(`${due}T18:00`).getTime() : null,
      intent,
    })
    if (included.length) onSimulate(`Simulé : en vrai, ${included.map((card) => `#${card.number}`).join(', ')} deviendrai${included.length > 1 ? 'ent' : 't'} des cartes du jalon (parent) ; ici, elles lui sont liées.`)
    reset()
    onClose()
    onCreated(number, intent, promptFor(number))
  }

  const gesture = (intent: Intent, label: string) => {
    const disabled = empty || (intent === 'split' && !reading.sufficient)
    const isPrimary = intent === primary
    const why = empty
      ? 'Écris d’abord le jalon.'
      : intent === 'split' && !reading.sufficient
        ? 'Il faut au moins deux étapes, ou un objectif et un peu de matière.'
        : undefined
    return (
      <span
        key={intent}
        onMouseEnter={() => setHovered(intent)}
        onMouseLeave={() => setHovered(null)}
        onFocus={() => setHovered(intent)}
        onBlur={() => setHovered(null)}
        title={why}
      >
        <Button size="sm" variant={isPrimary ? undefined : intent === 'note' ? 'ghost' : 'secondary'} disabled={disabled} onClick={() => submit(intent)}>
          {label}
          {isPrimary && !disabled ? <Kbd /> : null}
        </Button>
      </span>
    )
  }

  return (
    <Drawer open={open} onClose={onClose} label="Nouveau jalon" width="wide">
      <div className="flex min-h-0 flex-1 flex-col">
        <ComposerHeader eyebrow="Nouveau jalon" onClose={onClose}>
          {/* Le titre, tiré du texte tant qu'on ne le retouche pas. */}
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder={derived || 'Sans titre'}
            aria-label="Titre du jalon"
            className={cx('w-full bg-transparent text-xl leading-tight font-semibold tracking-tight outline-none', derived ? 'placeholder:text-ink' : 'placeholder:text-ink-faint/50')}
          />
          <span className="text-xs text-ink-faint">
            {derived && !title ? 'Titre tiré de ton texte, modifiable.' : 'Une phrase suffit, ou colle ton brief : l’agent s’adapte.'}
          </span>
        </ComposerHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 pt-2 pb-5">
          <Writing
            value={text}
            onChange={setText}
            placeholder={PLACEHOLDER}
            cards={cards}
            attachments={attachments}
            onSubmitShortcut={() => submit(primary)}
            textRef={textRef}
            aside={<DueField value={due} onChange={setDue} />}
          />
          <Joined attachments={attachments} cards={cards} allowInclude />
        </div>

        <ComposerFooter
          info={<WhatHappens intent={shown} reading={reading} attachments={attachments} />}
          actions={<>
            {gesture('note', 'Noter l’idée')}
            {gesture('refine', 'Affiner avec un agent')}
            {gesture('split', 'Découper directement')}
          </>}
        />
      </div>
    </Drawer>
  )
}

/* ------------------------------------------------------------------ ajouter au jalon */

/** « Ajouter au jalon » : le même champ, plus court ; l'agent dit où il le range. */
export function AddToMilestoneDrawer({
  open,
  onClose,
  milestoneId,
  title,
  demo,
  onSimulate,
  cards = [],
}: {
  open: boolean
  onClose: () => void
  milestoneId: string
  title: string
  demo: boolean
  onSimulate: (text: string) => void
  cards?: CardDto[]
}) {
  const [text, setText] = useState('')
  const textRef = useRef<HTMLTextAreaElement>(null)
  const attachments = useAttachments(cards, text, setText)
  const reading = useMemo(() => readBrief(text), [text])
  const empty = !text.trim()
  const submit = () => {
    if (empty) return
    const extra = [
      ...attachments.links.map((link) => `- ${link.label} : ${link.url}`),
      ...attachments.files.map((file) => `- ${file.name}`),
    ]
    const body = extra.length ? `${text.trim()}\n\n${extra.join('\n')}` : text.trim()
    if (demo) proposeAddition(milestoneId, body)
    else onSimulate("Simulé : la session d'affinage du jalon recevrait cet ajout et proposerait où le ranger.")
    setText('')
    attachments.reset()
    onClose()
  }
  const said = announce(reading)
  return (
    <Drawer open={open} onClose={onClose} label="Ajouter au jalon">
      <div className="flex min-h-0 flex-1 flex-col">
        <ComposerHeader eyebrow="Ajouter au jalon" onClose={onClose}>
          <h2 className="min-w-0 truncate text-xl leading-tight font-semibold tracking-tight text-ink">{title}</h2>
        </ComposerHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 pt-2 pb-5">
          <Writing
            value={text}
            onChange={setText}
            rows={8}
            placeholder={'Ce que tu veux ajouter : une phrase, ou une liste.\n\nex. Il faut aussi gérer les pièces jointes hors ligne (#156)'}
            cards={cards}
            attachments={attachments}
            onSubmitShortcut={submit}
            textRef={textRef}
          />
          <Joined attachments={attachments} cards={cards} allowInclude={false} />
        </div>
        <ComposerFooter
          info={
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <Tooltip label="L’agent le range dans la carte qui en parle déjà (en sous-tâche), ou propose de nouvelles cartes dans la bonne vague. Tu valides dans le fil du jalon.">
                <span className={cx('min-w-0 truncate text-sm', empty ? 'text-ink-faint' : 'text-ink-soft')}>
                  {empty ? said.line : 'L’agent le range dans une carte existante, ou propose de nouvelles cartes.'}
                </span>
              </Tooltip>
              <Spotted reading={reading} attachments={attachments} />
            </div>
          }
          actions={<>
            <Button size="sm" variant="ghost" onClick={onClose}>Annuler</Button>
            <span title={empty ? 'Écris d’abord l’ajout.' : undefined}>
              <Button size="sm" disabled={empty} onClick={submit}>Proposer à l’agent{!empty ? <Kbd /> : null}</Button>
            </span>
          </>}
        />
      </div>
    </Drawer>
  )
}
