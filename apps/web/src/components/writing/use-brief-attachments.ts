import { useEffect, useMemo, useRef, useState } from 'react'
import type { CardDto } from '@solera/protocol'
import { linkPiece, mentionedNumbers, removeMention, type LinkPiece } from '../../lib/writing'

/** Un fichier joint, gardé tel quel pour l'envoyer à la création. */
export interface FilePiece {
  key: string
  file: File
  /** Vignette d'une image (`blob:`), révoquée quand la pièce part. */
  preview: string | null
}

/**
 * Ce qu'une carte jointe devient : une *Référence* (lien `related`, informatif) ou une
 * carte *Incluse* (elle prend pour parente la carte créée).
 */
export type CardMode = 'reference' | 'include'

export interface BriefAttachments {
  /** Les cartes jointes : celles que le texte mentionne, dans son ordre. */
  cards: CardDto[]
  modeOf: (card: CardDto) => CardMode
  setMode: (card: CardDto, mode: CardMode) => void
  /** Retire la carte, c'est-à-dire ses mentions dans le texte. */
  removeCard: (card: CardDto) => void
  links: LinkPiece[]
  addLink: (url: string) => void
  removeLink: (url: string) => void
  files: FilePiece[]
  addFiles: (list: FileList | readonly File[]) => void
  removeFile: (key: string) => void
  count: number
  /** Tout vider, après un envoi. Le texte appartient à l'appelant. */
  reset: () => void
}

const fileKey = (file: File) => `${file.name}-${file.size}-${file.lastModified}`

/**
 * Les pièces jointes d'un texte : cartes, liens, fichiers. Une carte jointe **est** une
 * carte mentionnée : le texte fait foi, et retirer sa puce retire sa mention.
 */
export function useBriefAttachments(cards: readonly CardDto[], text: string, setText: (next: string) => void): BriefAttachments {
  const [modes, setModes] = useState<Record<string, CardMode>>({})
  const [links, setLinks] = useState<LinkPiece[]>([])
  const [files, setFiles] = useState<FilePiece[]>([])
  const byNumber = useMemo(() => new Map(cards.map((card) => [card.number, card])), [cards])
  const attached = useMemo(
    () => mentionedNumbers(text).map((number) => byNumber.get(number)).filter((card): card is CardDto => card !== undefined),
    [text, byNumber],
  )

  // Les vignettes vivent jusqu'au démontage, pas au-delà.
  const previews = useRef(new Set<string>())
  useEffect(() => () => previews.current.forEach((url) => URL.revokeObjectURL(url)), [])
  const release = (piece: FilePiece) => {
    if (!piece.preview) return
    URL.revokeObjectURL(piece.preview)
    previews.current.delete(piece.preview)
  }

  return {
    cards: attached,
    modeOf: (card) => modes[card.id] ?? 'reference',
    setMode: (card, mode) => setModes((current) => ({ ...current, [card.id]: mode })),
    removeCard: (card) => setText(removeMention(text, card.number)),
    links,
    addLink: (url) => setLinks((current) => (current.some((entry) => entry.url === url) ? current : [...current, linkPiece(url)])),
    removeLink: (url) => setLinks((current) => current.filter((entry) => entry.url !== url)),
    files,
    addFiles: (list) => {
      const known = new Set(files.map((entry) => entry.key))
      const added: FilePiece[] = []
      for (const file of list) {
        const key = fileKey(file)
        if (known.has(key)) continue
        known.add(key)
        const preview = file.type.startsWith('image/') ? URL.createObjectURL(file) : null
        if (preview) previews.current.add(preview)
        added.push({ key, file, preview })
      }
      if (added.length) setFiles((current) => [...current, ...added])
    },
    removeFile: (key) => {
      const piece = files.find((entry) => entry.key === key)
      if (piece) release(piece)
      setFiles((current) => current.filter((entry) => entry.key !== key))
    },
    count: attached.length + links.length + files.length,
    reset: () => {
      setModes({})
      setLinks([])
      files.forEach(release)
      setFiles([])
    },
  }
}
