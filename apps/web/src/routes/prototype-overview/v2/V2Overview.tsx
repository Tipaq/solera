/* PROTOTYPE — jetable (branche proto/page-projet). Ne pas fusionner dans main.
 *
 * L'Aperçu v2 : « Où en est le projet ? ». Un seul contenu — ce qui t'attend, les
 * jalons en phare, le code en cours et les derniers événements —, quatre styles.
 */
import type { ProjectDto } from '@solera/protocol'
import { DemoToggle } from '../../prototype-milestones/HorizonVariant'
import { Combo } from './Combo'
import { Tiles } from './Tiles'
import { Visual } from './Visual'
import { useV2Data } from './data'

/* `tuiles` (trop de place) et `visuel` (on ne voit pas ce qui appartient à quoi) sont
   écartées le 2026-11-11 ; leurs fichiers restent, hors du switcher. */
export const V2_VARIANTS = [{ key: 'combo', name: 'Combo' }]

export function isV2Variant(variant: string): boolean {
  return V2_VARIANTS.some((entry) => entry.key === variant)
}

export function V2Overview({ projectId, project, variant }: { projectId: string; project: ProjectDto; variant: string }) {
  const data = useV2Data(projectId, project)
  if (data.isPending) return null
  return (
    <div className="relative h-full">
      {variant === 'tuiles' ? <Tiles data={data} /> : variant === 'visuel' ? <Visual data={data} /> : <Combo data={data} />}
      <div className="absolute top-3 right-4 md:right-8">
        <DemoToggle demo={data.demo} />
      </div>
    </div>
  )
}
