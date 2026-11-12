import { useMemo } from 'react'
import { useAutomations } from './automations-query'
import { useCodeData } from './code-data'
import type { TreeRow } from './code-model'
import { useProjects } from './projects'
import { servedIndex, type ServedIndex } from './served'

export interface ServedData extends ServedIndex<TreeRow> {
  /** La branche de base du projet, pour dire l'avance et le retard. */
  base: string | null
  /** Les arbres du projet, pour proposer où basculer. */
  trees: TreeRow[]
}

/**
 * Ce que sert chaque service en marche d'un projet, rattaché aux arbres jugés de la page
 * (`useCodeData`) : par action pour la tuile et le détail, par arbre pour Travail.
 */
export function useServedIndex(projectId: string | undefined): ServedData {
  const { data: projects } = useProjects()
  const project = projects?.find((entry) => entry.id === projectId)
  const code = useCodeData(projectId, project)
  const { items } = useAutomations({ projectId: projectId ?? '' })
  return useMemo(
    () => ({ ...servedIndex(items, code.trees), base: code.base, trees: code.trees }),
    [items, code.trees, code.base],
  )
}
