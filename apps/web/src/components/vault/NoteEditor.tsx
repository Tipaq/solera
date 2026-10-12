import { autocompletion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { markdown } from '@codemirror/lang-markdown'
import { EditorState, RangeSetBuilder } from '@codemirror/state'
import {
  Decoration,
  EditorView,
  ViewPlugin,
  drawSelection,
  keymap,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view'
import { useEffect, useLayoutEffect, useRef } from 'react'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags } from '@lezer/highlight'
import { translate } from '../../lib/i18n'

/**
 * L'éditeur d'une note : l'écriture au centre, en largeur de lecture.
 *
 * Distinct de `CodeEditor`, et pas par accident : celui-ci édite des **fichiers** —
 * numéros de ligne, gouttière de pliage, panneau de recherche, police à chasse fixe.
 * Une note est de la prose. Ce qu'elle garde de CodeMirror, c'est ce dont la prose a
 * besoin : l'historique d'annulation, le retour à la ligne, la coloration du markdown
 * — et le seul mécanisme que le dessin exige, `[[` qui ouvre le sélecteur de note.
 *
 * Le texte n'est lu qu'au montage. Le pousser dans un éditeur vivant effacerait le
 * curseur de qui est en train de taper : c'est à l'appelant de remonter l'éditeur
 * quand il change de note, par sa clé.
 */

/** Ce que `[[` propose. */
export interface NoteTarget {
  path: string
  folder: string
  title: string
  /** Le classement du sélecteur : les carrefours d'abord. */
  incoming: number
}

/**
 * La coloration d'une **prose**, et non celle du code.
 *
 * `editorHighlight` sert les fichiers : il range `tags.heading` avec les noms
 * d'attributs, donc dans la famille « attribut » de la palette de syntaxe. Un titre de
 * note s'affichait ainsi en rouge, et comme le curseur se pose sur le titre à
 * l'ouverture, c'était la première chose qu'on voyait d'une note.
 *
 * Ici un titre est un titre : de l'encre, en gras. Le markdown n'a que six formes qui
 * comptent dans une note, et aucune n'est une couleur — c'est le poids, l'italique et
 * la chasse fixe qui les distinguent.
 */
const proseHighlight = syntaxHighlighting(
  HighlightStyle.define([
    { tag: tags.heading, color: 'var(--sg-ink)', fontWeight: '600' },
    { tag: tags.strong, color: 'var(--sg-ink)', fontWeight: '600' },
    { tag: tags.emphasis, fontStyle: 'italic' },
    { tag: tags.strikethrough, textDecoration: 'line-through' },
    { tag: [tags.monospace, tags.contentSeparator], color: 'var(--sg-ink-soft)' },
    { tag: tags.quote, color: 'var(--sg-ink-soft)', fontStyle: 'italic' },
    { tag: [tags.link, tags.url], color: 'var(--sg-accent)' },
    // Les marques de la syntaxe — les étoiles, les tirets de liste, les accents graves
    // — restent lisibles mais s'effacent du regard : on écrit du markdown, on ne le lit
    // pas.
    { tag: [tags.processingInstruction, tags.meta], color: 'var(--sg-ink-faint)' },
  ]),
)

/** Un `[[lien]]`, pour qu'il se voie et qu'il se clique. */
const linkMark = Decoration.mark({ class: 'cm-vault-link' })

const WIKILINK = /\[\[([^\][\n]*)\]\]/g

/**
 * Les liens, soulignés dans le texte.
 *
 * Une décoration et non une coloration de syntaxe : `[[cible]]` n'est pas du markdown
 * standard, donc l'analyseur ne le voit pas, et c'est pourtant l'objet le plus
 * important du vault.
 */
const linkDecorations = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet

    constructor(view: EditorView) {
      this.decorations = build(view)
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) this.decorations = build(update.view)
    }
  },
  { decorations: (plugin) => plugin.decorations },
)

function build(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  // Le viewport seul : décorer un document entier qu'on ne regarde pas coûte sans rien
  // montrer, et CodeMirror redemande les décorations quand on défile.
  for (const { from, to } of view.visibleRanges) {
    const text = view.state.doc.sliceString(from, to)
    for (const match of text.matchAll(WIKILINK)) {
      builder.add(from + match.index, from + match.index + match[0].length, linkMark)
    }
  }
  return builder.finish()
}

const HEADING = /^(#{1,6})[ \t]+/

/**
 * Les dièses de la ligne du curseur.
 *
 * Ils restent écrits, mais discrets : la coloration du markdown les met à la couleur
 * des titres, donc en accent, et comme le curseur se pose sur le titre à l'ouverture
 * d'une note, c'était la première chose qu'on voyait. Une syntaxe qu'on garde pour
 * pouvoir la modifier n'a pas à crier plus fort que le texte.
 */
const headingHash = Decoration.mark({ class: 'cm-note-hash' })

/**
 * Les titres se lisent comme des titres.
 *
 * Les dièses sont cachés et la ligne grossit — sauf celle où le curseur se trouve, qui
 * remontre sa syntaxe. C'est le compromis d'un éditeur de prose : on écrit du markdown,
 * on ne le lit pas. Sans ça, la note s'ouvre sur un `#` que le dessin ne montre nulle
 * part, et la largeur de lecture ne sert à rien.
 */
const headingDecorations = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet

    constructor(view: EditorView) {
      this.decorations = headings(view)
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged || update.selectionSet) {
        this.decorations = headings(update.view)
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
)

function headings(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  const cursor = view.state.doc.lineAt(view.state.selection.main.head).number

  for (const { from, to } of view.visibleRanges) {
    let position = from
    while (position <= to) {
      const line = view.state.doc.lineAt(position)
      const match = HEADING.exec(line.text)
      if (match) {
        const level = Math.min(match[1]!.length, 3)
        builder.add(line.from, line.from, Decoration.line({ class: `cm-note-h${level}` }))
        // Sur la ligne du curseur, la syntaxe reste : la cacher sous le curseur ferait
        // disparaître ce qu'on est en train de taper. Elle s'efface du regard sans
        // s'effacer du texte.
        builder.add(
          line.from,
          line.from + match[0].length,
          line.number === cursor ? headingHash : Decoration.replace({}),
        )
      }
      position = line.to + 1
    }
  }

  return builder.finish()
}

const theme = EditorView.theme({
  '&': { height: '100%', backgroundColor: 'transparent', color: 'var(--sg-ink)' },
  '.cm-scroller': {
    // La police de l'interface, pas celle du code : on écrit de la prose.
    fontFamily: 'inherit',
    fontSize: '0.9375rem',
    lineHeight: '1.7',
    padding: '1.5rem 0 40vh',
  },
  // La largeur de lecture est portée par le contenu et non par un parent : c'est elle
  // qui doit borner la ligne, et le défilement doit rester sur toute la largeur.
  '.cm-content': {
    caretColor: 'var(--sg-accent)',
    maxWidth: '34rem',
    margin: '0 auto',
    padding: '0 1.5rem',
  },
  '.cm-line': { padding: '0' },
  // Trois niveaux suffisent à une note : au-delà, la hiérarchie n'est plus visuelle.
  '.cm-note-h1': { fontSize: '1.5em', fontWeight: '600', lineHeight: '1.3', marginTop: '0.2em' },
  '.cm-note-h2': { fontSize: '1.2em', fontWeight: '600', lineHeight: '1.4', marginTop: '0.8em' },
  '.cm-note-h3': { fontSize: '1.05em', fontWeight: '600', marginTop: '0.6em' },
  '.cm-note-hash': { color: 'var(--sg-ink-faint)', fontWeight: '400' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--sg-accent)' },
  '.cm-selectionBackground, ::selection': { backgroundColor: 'var(--sg-accent-wash) !important' },
  '&.cm-focused': { outline: 'none' },
  '.cm-vault-link': {
    color: 'var(--sg-accent)',
    textDecoration: 'underline',
    textDecorationStyle: 'dotted',
    textUnderlineOffset: '3px',
    cursor: 'pointer',
  },
  '.cm-tooltip.cm-tooltip-autocomplete': {
    backgroundColor: 'var(--sg-surface-high)',
    border: '1px solid var(--sg-line)',
    borderRadius: 'var(--sg-radius-md, 0.5rem)',
    boxShadow: 'var(--sg-shadow-pop, 0 8px 24px rgb(0 0 0 / 0.18))',
    overflow: 'hidden',
  },
  '.cm-tooltip.cm-tooltip-autocomplete > ul > li': {
    padding: '0.25rem 0.625rem',
    color: 'var(--sg-ink-soft)',
  },
  '.cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]': {
    backgroundColor: 'var(--sg-accent-wash)',
    color: 'var(--sg-ink)',
  },
})

export function NoteEditor({
  initial,
  targets,
  readOnly = false,
  onChange,
  onSave,
  onOpenLink,
  onCreateNote,
}: {
  /** Lu au montage seulement. Changer de note demande de remonter l'éditeur. */
  initial: string
  /** Les notes que `[[` propose. */
  targets: NoteTarget[]
  readOnly?: boolean
  onChange: (value: string) => void
  /** `Mod-s`. L'enregistrement à la pause de frappe est l'affaire de l'appelant. */
  onSave: () => void
  /** Un lien cliqué : la cible telle qu'elle est écrite, alias et ancre retirés. */
  onOpenLink: (target: string) => void
  /** La note absente, créée depuis le sélecteur et sans quitter la frappe. */
  onCreateNote: (title: string) => void
}) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  /**
   * Les rappels et les cibles sont lus au moment de l'événement, jamais capturés dans
   * les extensions : les recréer reconstruirait l'état de l'éditeur, donc le curseur et
   * l'historique, à chaque frappe.
   */
  const handlers = useRef({ onChange, onSave, onOpenLink, onCreateNote, targets })
  handlers.current = { onChange, onSave, onOpenLink, onCreateNote, targets }
  const content = useRef(initial)
  content.current = initial

  useLayoutEffect(() => {
    const parent = host.current
    if (!parent) return

    /** `[[` ouvre le sélecteur : c'est le geste que le dessin exige, et le seul. */
    const completeLink = (context: CompletionContext): CompletionResult | null => {
      const before = context.matchBefore(/\[\[([^\][\n]*)$/)
      if (!before) return null

      const typed = (before.text.slice(2) ?? '').trim()
      // Les carrefours d'abord : c'est là qu'on veut accrocher. Le titre tranche les
      // égalités, pour que la liste ne danse pas d'une frappe à l'autre.
      const ranked = [...handlers.current.targets].sort(
        (a, b) => b.incoming - a.incoming || a.title.localeCompare(b.title),
      )
      const exact = ranked.some((target) => target.title.toLowerCase() === typed.toLowerCase())

      return {
        from: before.from + 2,
        options: [...ranked.map((target) => ({
          label: target.title,
          // Le dossier en second rang : deux notes peuvent porter le même titre, et
          // c'est alors la seule chose qui les distingue. Le degré entrant explique le
          // classement, qui serait sinon un ordre sans raison visible.
          detail: [target.folder, target.incoming > 0 ? `${target.incoming} ↩` : null]
            .filter(Boolean)
            .join(' · ') || undefined,
          type: 'text',
          apply: (editor: EditorView, _completion: unknown, from: number, to: number) => {
            // Le crochet fermant n'est posé que s'il manque : taper `[[` dans un lien
            // déjà écrit ne doit pas en ajouter un second.
            const after = editor.state.doc.sliceString(to, to + 2)
            const closing = after === ']]' ? '' : ']]'
            editor.dispatch({
              changes: { from, to, insert: `${target.title}${closing}` },
              selection: { anchor: from + target.title.length + closing.length },
            })
          },
        })),
        // La note absente se crée sans quitter la frappe : écrire `[[` pour relier une
        // idée qui n'a pas encore sa note est le cas le plus fréquent, et sortir de
        // l'éditeur pour la créer casse exactement ce qu'on était en train de faire.
        ...(typed.length > 0 && !exact
          ? [{
            label: typed,
            displayLabel: translate('vault.editor.createNote', { title: typed }),
            // En dernier, toujours : une proposition qui crée ne doit pas se glisser
            // devant une note qui existe.
            boost: -99,
            type: 'text',
            apply: (editor: EditorView, _completion: unknown, from: number, to: number) => {
              const after = editor.state.doc.sliceString(to, to + 2)
              const closing = after === ']]' ? '' : ']]'
              editor.dispatch({
                changes: { from, to, insert: `${typed}${closing}` },
                selection: { anchor: from + typed.length + closing.length },
              })
              handlers.current.onCreateNote(typed)
            },
          }]
          : []),
        ],
      }
    }

    const editor = new EditorView({
      parent,
      state: EditorState.create({
        doc: content.current,
        extensions: [
          history(),
          drawSelection(),
          markdown(),
          proseHighlight,
          theme,
          linkDecorations,
          headingDecorations,
          EditorView.lineWrapping,
          EditorState.readOnly.of(readOnly),
          EditorView.editable.of(!readOnly),
          autocompletion({ override: [completeLink], activateOnTyping: true, icons: false }),
          keymap.of([
            {
              // Sans quoi le navigateur enregistrerait la page.
              key: 'Mod-s',
              preventDefault: true,
              run: () => {
                handlers.current.onSave()
                return true
              },
            },
            ...defaultKeymap,
            ...historyKeymap,
          ]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) handlers.current.onChange(update.state.doc.toString())
          }),
          EditorView.domEventHandlers({
            /**
             * Un lien s'ouvre au clic, et c'est le seul endroit où le savoir : la
             * décoration ne porte pas la cible, parce qu'elle serait à reconstruire à
             * chaque frappe alors que la position du clic suffit à la retrouver.
             */
            mousedown: (event, editor) => {
              if (!(event.target instanceof HTMLElement)) return false
              if (!event.target.classList.contains('cm-vault-link')) return false

              const position = editor.posAtDOM(event.target)
              const line = editor.state.doc.lineAt(position)
              const offset = position - line.from
              for (const match of line.text.matchAll(WIKILINK)) {
                if (match.index > offset || offset > match.index + match[0].length) continue
                const target = (match[1] ?? '').split('|')[0]?.split('#')[0]?.trim()
                if (!target) return false
                event.preventDefault()
                handlers.current.onOpenLink(target)
                return true
              }
              return false
            },
          }),
        ],
      }),
    })
    view.current = editor

    return () => {
      view.current = null
      editor.destroy()
    }
  }, [readOnly])

  /** Le focus au montage : la page du vault ouvre sur l'écriture, pas sur un curseur à poser. */
  useEffect(() => {
    if (!readOnly) view.current?.focus()
  }, [readOnly])

  return <div ref={host} className="h-full min-h-0 overflow-hidden" />
}
