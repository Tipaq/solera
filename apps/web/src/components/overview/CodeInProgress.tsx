import type { ProjectDto } from '@solera/protocol'
import { liveTrees, orderLines, type TreeRow } from '../../lib/code-model'
import { useCodeData } from '../../lib/code-data'
import { useTranslate } from '../../lib/i18n'
import { CodeGraph } from '../code/CodeGraph'
import { OverviewSection } from './OverviewSection'

/**
 * « Code en cours » (`projet.md` A-4) : les arbres vivants du projet en graphe de
 * branches, la racine en tête ; ceux qui n'ont plus qu'à être nettoyés sont comptés et
 * renvoient à Travail filtré « À nettoyer ».
 */
export function CodeInProgress({ projectId, project }: { projectId: string; project: ProjectDto }) {
  const code = useCodeData(projectId, project)
  // Rien tant que l'état des arbres charge (A-1.4) : « rien en cours » serait faux.
  if (code.pending) return null
  return <CodeInProgressView projectId={projectId} trees={code.trees} base={code.base} />
}

/** Le bloc sans sa requête, pour sa story : les arbres jugés, triés et comptés ici. */
export function CodeInProgressView({ projectId, trees, base }: { projectId: string; trees: TreeRow[]; base: string | null }) {
  const t = useTranslate()
  const { live, settled } = liveTrees(trees)
  return (
    <OverviewSection title={t('project.overview.code.title')}>
      <CodeGraph projectId={projectId} lines={orderLines(live)} settled={settled} base={base} />
    </OverviewSection>
  )
}
