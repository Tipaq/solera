import { useParams } from 'react-router-dom'
import { EmptyState } from '@solera/ui'
import { AskInbox } from '../components/inbox/AskInbox'
import { OverviewActions } from '../components/overview/OverviewActions'
import { RecentEvents } from '../components/overview/RecentEvents'
import { useTranslate } from '../lib/i18n'
import { useProjects } from '../lib/projects'
import { useInbox } from '../lib/use-inbox'

/**
 * L'**Aperçu** d'un projet : la vue d'arrivée, et la seule sans action propre — elle ne
 * crée rien, elle envoie.
 *
 * Mise en page `combo` (`docs/specs/2026-11-page-projet-v2/projet.md` A-1), retenue le
 * 2026-11-11 : ce qui **t'attend** en tête, puis le phare des jalons, seule surface
 * teintée de la page, puis une grille — le code en cours à gauche, à droite la pile de
 * ce qui **tourne** (Actions) et de ce qui **s'est passé** (Derniers événements).
 *
 * Pleine largeur, sur la gouttière de la coque (`p-4 md:p-6`) : pas de couloir centré,
 * le bord gauche reste celui de la rangée d'onglets.
 *
 * La bande et la rangée d'onglets appartiennent à `ProjectLayout` : cette page commence
 * à son contenu.
 */
export function ProjectOverviewPage() {
  const { projectId } = useParams()
  const t = useTranslate()
  const { data: projects, isPending } = useProjects()
  const inbox = useInbox({ projectId: projectId ?? '' })

  // Rien tant que le projet charge (A-1.4) : un squelette redirait la page deux fois.
  if (isPending) return null
  const project = projects?.find((entry) => entry.id === projectId)
  if (!projectId || !project) return <EmptyState title={t('project.notFound')} />

  return (
    <div className="h-full overflow-y-auto p-4 md:p-6">
      <div className="flex flex-col gap-10">
        <AskInbox items={inbox} />
        {/* La place du phare des jalons (#174). */}
        <div className="grid gap-10 xl:grid-cols-[minmax(0,1fr)_24rem]">
          {/* La place du « Code en cours » (#173) ; en une colonne, rien ne la réserve. */}
          <div className="hidden min-w-0 xl:block" />
          <div className="flex min-w-0 flex-col gap-10">
            <OverviewActions projectId={projectId} />
            <RecentEvents projectId={projectId} />
          </div>
        </div>
      </div>
    </div>
  )
}
