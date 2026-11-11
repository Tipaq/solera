/* PROTOTYPE — jetable (branche proto/page-projet). Ne pas fusionner dans main.
 *
 * Ce que le ⚡ de la bande disait, maintenant qu'il est retiré : ce qui **tourne** dans
 * le projet, et ce qui **t'attend** (les actions à relire). Un seul calcul, lu par
 * l'onglet Actions (projet et panneau), le bouton du panneau d'une conversation et les
 * lignes d'outils des deux onglets Actions.
 *
 * Ce qui tourne : les services d'actions en marche (`actionView(action).live`) + les
 * processus lancés par les sessions du projet. Ces derniers viennent de la même requête
 * que la page Services (`useSessionWorks`, clé `['services']`) : aucune requête de plus.
 *
 * Règle d'un compte d'onglet, trois tons : gris = inventaire, ambre = ce qui t'attend,
 * vert = ce qui tourne. Sur l'onglet Actions, l'ambre passe d'abord (« N à relire ») :
 * une action à relire attend Tim, un service qui tourne se contente d'être là.
 */
import { useSearchParams } from 'react-router-dom'
import { cx } from '@solera/ui'
import { actionView, useActions } from '../../lib/actions'
import { demoActions } from '../../routes/prototype-actions/data'
import { useSessionWorks } from '../../routes/prototype-automations/SessionWorks'

export type CountTone = 'neutral' | 'caution' | 'running'

export interface ActionsCount {
  running: number
  toReview: number
}

export function useActionsCount(projectId: string | undefined): ActionsCount {
  const [params] = useSearchParams()
  const demo = params.get('demo') === '1'
  const { data } = useActions()
  const { works } = useSessionWorks(projectId)
  if (!projectId) return { running: 0, toReview: 0 }
  const actions = demo ? demoActions(projectId) : (data ?? []).filter((action) => action.projectId === projectId)
  const services = actions.filter((action) => action.kind === 'service' && actionView(action).live).length
  const processes = works.reduce((sum, work) => sum + (work.countOnly ?? 1), 0)
  return { running: services + processes, toReview: actions.filter((action) => action.status === 'proposed').length }
}

/** Le compte de l'onglet Actions : ambre « à relire » d'abord, sinon vert « en marche ». */
export function actionsTabCount(count: ActionsCount): { count: number; tone: CountTone; title: string } | null {
  if (count.toReview > 0) return { count: count.toReview, tone: 'caution', title: `${count.toReview} à relire` }
  if (count.running > 0) return { count: count.running, tone: 'running', title: `${count.running} en marche` }
  return null
}

const TONES: Record<CountTone, string> = {
  neutral: 'bg-surface-high text-ink-soft',
  caution: 'bg-caution/10 text-caution',
  running: 'bg-positive/10 text-positive',
}

/** La pastille d'un compte d'onglet, à trois tons (le `TabCount` du DS n'en a que deux). */
export function PlaceTabCount({ count, tone = 'neutral', title }: { count: number; tone?: CountTone; title?: string }) {
  return (
    <span title={title} className={cx('rounded px-1.5 py-0.5 text-xs tabular-nums', TONES[tone])}>
      {count}
    </span>
  )
}

/**
 * La même info en méta, dans la ligne d'outils d'un onglet Actions : point vert
 * « N en marche », ambre « N à relire ». Un clic mène au groupe concerné.
 */
export function ActionsStatusMeta({ count, onRunning, onReview }: {
  count: ActionsCount
  onRunning?: () => void
  onReview?: () => void
}) {
  if (count.running === 0 && count.toReview === 0) return null
  const item = 'inline-flex shrink-0 items-center gap-1.5 rounded px-1 text-xs whitespace-nowrap hover:bg-surface-high'
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      {count.running > 0 ? (
        <button type="button" onClick={onRunning} className={cx(item, 'text-positive')} title="Aller à ce qui tourne">
          <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-positive" />
          {count.running} en marche
        </button>
      ) : null}
      {count.toReview > 0 ? (
        <button type="button" onClick={onReview} className={cx(item, 'text-caution')} title="Aller aux actions à relire">
          <span aria-hidden className="size-1.5 rounded-full bg-caution" />
          {count.toReview} à relire
        </button>
      ) : null}
    </span>
  )
}

/** Défile jusqu'au premier élément qui porte l'ancre, s'il existe. */
export function scrollToAnchor(id: string): void {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}
