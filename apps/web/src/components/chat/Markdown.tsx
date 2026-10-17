import { useContext, useMemo, useState, type MouseEvent } from 'react'
import { openTab } from '../../lib/editor-tabs'
import { FileLinkContext, useKnownFiles } from '../../lib/file-links'
import { parseMarkdown } from '../../lib/markdown'
import { setPanelOpen, setPanelTab } from '../../lib/panel'
import { ImageLightbox } from '../panel/ImageView'
import { openInPanel } from '../WebLink'
import { CodeBlock } from './CodeBlock'
import { MarkdownTable } from './MarkdownTable'

/**
 * Rendu d'un texte markdown.
 *
 * Le document est découpé : les blocs de code et les tableaux deviennent des
 * composants React, qui portent leur barre d'outils, et tout le reste est le HTML de
 * markdown-it, stylé par les règles `.sg-markdown`.
 */
/**
 * `base` : dossier du fichier rendu, quand le texte en est un. Ses liens relatifs en
 * partent, au lieu de partir de la racine du workspace.
 */
export function Markdown({
  text,
  base,
  onToggleTask,
}: {
  text: string
  base?: string
  /**
   * Rend les cases `- [ ]` cliquables et dit laquelle vient d'être cochée, par son
   * rang dans le document. Absent partout sauf sur la description d'une carte : c'est
   * le seul texte que l'interface sait réécrire.
   */
  onToggleTask?: (index: number, checked: boolean) => void
}) {
  const conversationId = useContext(FileLinkContext)
  const [viewing, setViewing] = useState<{ src: string; name: string } | null>(null)
  const tasks = onToggleTask ? ('interactive' as const) : undefined

  // Première passe : ce que le texte cite. Elle ne produit aucun lien, mais son HTML
  // est celui affiché tant que la réponse du serveur n'est pas là.
  const found = useMemo(
    () => parseMarkdown(text, { scope: conversationId ?? undefined, base, tasks }),
    [text, conversationId, base, tasks],
  )
  const known = useKnownFiles(found.candidates)

  // Seconde passe, une fois les fichiers connus. Sautée quand aucun candidat du texte
  // n'en fait partie, ce qui est le cas le plus fréquent.
  const linkable = useMemo(
    () => [...found.candidates].some((path) => known.has(path)),
    [found.candidates, known],
  )
  const segments = useMemo(
    () =>
      linkable
        ? parseMarkdown(text, {
            knownFiles: known,
            scope: conversationId ?? undefined,
            base,
            tasks,
          }).segments
        : found.segments,
    [linkable, text, known, conversationId, base, tasks, found.segments],
  )

  /**
   * Ouverture d'un chemin cité.
   *
   * Écouteur unique sur le conteneur plutôt qu'un par lien : le HTML est injecté tel
   * quel, il n'y a pas de composant React où accrocher un `onClick`.
   */
  const onClick = (event: MouseEvent<HTMLDivElement>) => {
    const task = (event.target as HTMLElement).closest<HTMLInputElement>('[data-sg-task]')
    if (task && onToggleTask) {
      // La case ne bascule pas d'elle-même : son état vit dans la description, pas
      // dans le DOM injecté, et la laisser se cocher avant la réponse afficherait un
      // travail fait que le serveur peut encore refuser.
      // `checked` porte déjà l'état visé : le navigateur bascule la case avant de
      // livrer le clic, et c'est `preventDefault` qui l'en fait revenir.
      event.preventDefault()
      onToggleTask(Number(task.dataset.sgTask), task.checked)
      return
    }

    const target = (event.target as HTMLElement).closest<HTMLElement>('[data-sg-path]')
    const path = target?.dataset.sgPath

    // Une image du web, qui n'est pas un fichier du projet : la visionneuse en plein
    // écran plutôt que rien. Celle qu'un lien enveloppe garde son lien.
    const image = event.target as HTMLElement
    if (!path && image instanceof HTMLImageElement && image.hasAttribute('data-sg-web-image') && !image.closest('a')) {
      setViewing({ src: image.currentSrc || image.src, name: image.alt || image.src.split('/').pop() || '' })
      return
    }

    // Un lien vers le web s'ouvre dans la vue *Web* du panneau, sans quitter le fil.
    const link = (event.target as HTMLElement).closest<HTMLAnchorElement>('a[href]')
    if (!path && link && openInPanel(event, conversationId, link.href)) return
    if (!path || !conversationId) return

    event.preventDefault()
    openTab(conversationId, path)
    setPanelTab('files')
    setPanelOpen(true)
  }

  return (
    <div className="sg-reading flex flex-col gap-3">
      {segments.map((segment, index) => {
        // L'index comme clé : les segments n'ont pas d'identité propre et la liste est
        // reconstruite entièrement à chaque changement du texte.
        const key = `${segment.kind}-${index}`

        if (segment.kind === 'code') {
          return <CodeBlock key={key} language={segment.language} code={segment.code} />
        }
        if (segment.kind === 'table') {
          return <MarkdownTable key={key} html={segment.html} rows={segment.rows} />
        }
        return (
          <div
            key={key}
            className="sg-markdown"
            onClick={onClick}
            dangerouslySetInnerHTML={{ __html: segment.html }}
          />
        )
      })}
      {viewing ? <ImageLightbox src={viewing.src} name={viewing.name} onClose={() => setViewing(null)} /> : null}
    </div>
  )
}
