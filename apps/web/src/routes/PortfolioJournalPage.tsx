import { useMemo } from 'react'
import { JournalView } from '../components/journal/JournalView'
import { useProjects } from '../lib/projects'

/**
 * *Journal* du portefeuille (F11) : le même journal, tous projets confondus.
 *
 * Les projets ne servent qu'à la pastille de tête de ligne — le serveur, lui, choisit
 * déjà ce qu'il rend. Les archivés sont dehors des deux côtés : on les archive pour
 * qu'ils cessent de parler, et une ligne qui n'aurait pas de pastille serait le signe
 * que les deux listes ont divergé.
 */
export function PortfolioJournalPage() {
  const { data: projects } = useProjects()
  const visible = useMemo(
    () => (projects ?? []).filter((project) => !project.archivedAt),
    [projects],
  )
  return <JournalView projects={visible} />
}
