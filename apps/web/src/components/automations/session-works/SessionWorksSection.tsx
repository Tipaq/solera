import { Waves } from 'lucide-react'
import { useState } from 'react'
import { Banner, PanelGroup } from '@solera/ui'
import type { EditorSeed } from '../../../lib/action-editor'
import { useTranslate } from '../../../lib/i18n'
import type { SessionWork } from '../../../lib/session-works'
import { useStopWork } from '../../../lib/session-works-query'
import { LauncherGroup } from '../LauncherGroup'
import { SessionWorkLine } from './SessionWorkLine'
import { SessionWorkRow } from './SessionWorkRow'
import { SessionWorkTile } from './SessionWorkTile'
import type { WorkGestures } from './parts'

export type SessionWorksVariant = 'tiles' | 'rows' | 'compact'

/**
 * « Lancés par les sessions » (AC-17) : en tuiles dans le Lanceur, en lignes dans la
 * Liste de l'onglet Actions, en lignes de 36 px dans le panneau d'une conversation
 * (`compact`, « Processus des sessions »). Rien quand aucune session ne fait rien.
 *
 * « Arrêter » est tenu ici ; son échec remonte à `onError` quand l'hôte a une bande
 * pour le dire (le panneau), sinon il s'affiche sous le titre.
 */
export function SessionWorksSection({
  projectId,
  works,
  variant,
  currentConversationId,
  onMakeAction,
  onError,
}: {
  projectId: string
  works: SessionWork[]
  variant: SessionWorksVariant
  /** Dans le panneau d'une conversation : ses propres processus ne portent pas sa pastille. */
  currentConversationId?: string
  onMakeAction: (seed: EditorSeed) => void
  onError?: (message: string) => void
}) {
  const t = useTranslate()
  const stop = useStopWork(projectId)
  const [failure, setFailure] = useState<string | null>(null)
  if (works.length === 0) return null
  const gestures: WorkGestures = {
    onMakeAction,
    stopping: stop.isPending ? (stop.variables?.id ?? null) : null,
    onStop: (work) => {
      setFailure(null)
      stop.mutate(work, { onError: (error) => (onError ? onError(error.message) : setFailure(error.message)) })
    },
  }
  const banner = failure ? <Banner>{failure}</Banner> : null

  if (variant === 'compact') {
    return (
      <section data-session-works className="pt-1.5 pb-1">
        <PanelGroup title={t('sessionWorks.section.panelTitle')} count={works.length} />
        {banner ? <div className="px-3 pb-1">{banner}</div> : null}
        <ul className="flex flex-col">
          {works.map((work) => (
            <SessionWorkLine key={work.id} projectId={projectId} work={work} currentConversationId={currentConversationId} gestures={gestures} />
          ))}
        </ul>
      </section>
    )
  }

  if (variant === 'tiles') {
    return (
      <div data-session-works className="flex flex-col gap-2">
        {banner}
        <LauncherGroup icon={<Waves size={14} />} title={t('sessionWorks.section.title')} count={works.length}>
          {works.map((work) => (
            <SessionWorkTile key={work.id} projectId={projectId} work={work} gestures={gestures} />
          ))}
        </LauncherGroup>
      </div>
    )
  }

  return (
    <section data-session-works className="flex flex-col gap-2">
      <header className="flex items-baseline gap-2">
        <h2 className="text-sm font-semibold text-ink">{t('sessionWorks.section.title')}</h2>
        <span className="text-xs tabular-nums text-ink-faint">{works.length}</span>
        <span className="hidden min-w-0 truncate text-xs text-ink-faint md:inline">— {t('sessionWorks.section.hint')}</span>
      </header>
      {banner}
      <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line">
        {works.map((work) => (
          <SessionWorkRow key={work.id} projectId={projectId} work={work} gestures={gestures} />
        ))}
      </ul>
    </section>
  )
}
