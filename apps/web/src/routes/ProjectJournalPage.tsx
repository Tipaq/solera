import { useParams } from 'react-router-dom'
import { JournalView } from '../components/journal/JournalView'

/**
 * *Journal* d'un projet (F5) : ce qui s'est décidé et quand.
 *
 * La page ne fait que nommer le projet. Tout le rendu est dans `JournalView`, qui sert
 * aussi le portefeuille : les deux vues ne diffèrent que par la pastille de projet en
 * tête de ligne, et c'est la seule chose que l'audit a demandé de changer entre elles.
 *
 * Ni bande ni en-tête propre : la coque les porte (`GabaritLieu`, « Une page de lieu est
 * la première vue d'une rangée »).
 */
export function ProjectJournalPage() {
  const { projectId } = useParams()
  return <JournalView projectId={projectId} />
}
