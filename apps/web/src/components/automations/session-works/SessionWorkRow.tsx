import { Square, Wand2 } from 'lucide-react'
import { Link } from 'react-router-dom'
import { cx } from '@solera/ui'
import { useTranslate } from '../../../lib/i18n'
import { familyWord, seedFromWork, type SessionWork } from '../../../lib/session-works'
import { AgentIcon } from '../../AgentIcon'
import { FamilyIcon, PortLink, useWorkText, type WorkGestures } from './parts'

const GESTURE = 'inline-flex h-11 items-center gap-1 rounded-md px-2 text-xs md:h-9 pointer-coarse:h-11 focus-visible:outline-2 focus-visible:outline-accent'

/**
 * La ligne d'un processus dans la Liste (PRC-4) : point vert, icône de famille, libellé
 * humain, `$ commande`, puis les faits (session d'origine en lien, famille, depuis,
 * :port) ; à droite « :port ↗ », « En faire une action » et « ■ ».
 */
export function SessionWorkRow({ projectId, work, gestures }: { projectId: string; work: SessionWork; gestures: WorkGestures }) {
  const t = useTranslate()
  const { name, short, load, since, sessionHref } = useWorkText(projectId, work)
  return (
    <li data-session-work={work.id} className="flex min-h-9 flex-wrap items-center gap-x-2.5 gap-y-1.5 px-3.5 py-2.5">
      <span aria-hidden className="size-2 shrink-0 rounded-full bg-positive motion-safe:animate-pulse" />
      <span className="shrink-0 text-ink-faint"><FamilyIcon family={work.family} /></span>
      {/* Sous 14 rem de texte, les gestes passent à la ligne plutôt que de l'écraser. */}
      <span className="flex min-w-0 flex-1 basis-56 flex-col" title={load ?? undefined}>
        <span className="truncate text-sm text-ink">{name}</span>
        {short ? <code className="truncate font-mono text-xs text-ink-faint" title={work.command ?? undefined}>$ {short}</code> : null}
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 text-xs text-ink-faint">
          <Link to={sessionHref} className="inline-flex min-w-0 items-center gap-1 underline-offset-2 hover:text-ink hover:underline">
            {work.agent ? <AgentIcon agent={work.agent} size={11} decorative /> : null}
            <span className="truncate">{work.conversationTitle}</span>
          </Link>
          <span>{familyWord(work.family, t)}</span>
          {since ? <span>{t('sessionWorks.state.since', { duration: since })}</span> : null}
          {work.port ? <span className="tabular-nums">:{work.port}</span> : null}
        </span>
      </span>
      <span className="ml-auto flex shrink-0 items-center gap-1">
        {work.port ? (
          <PortLink port={work.port} label={t('launcher.gesture.open')} className={cx(GESTURE, 'text-ink-soft hover:bg-surface-high hover:text-ink')} />
        ) : null}
        <button
          type="button"
          onClick={() => gestures.onMakeAction(seedFromWork(work, t))}
          title={t('sessionWorks.gesture.makeActionHint')}
          className={cx(GESTURE, 'border border-line text-ink hover:bg-surface-high')}
        >
          <Wand2 size={12} aria-hidden /> {t('sessionWorks.gesture.makeAction')}
        </button>
        {work.stop ? (
          <button
            type="button"
            onClick={() => gestures.onStop(work)}
            disabled={gestures.stopping === work.id}
            title={t('sessionWorks.gesture.stop')}
            aria-label={t('sessionWorks.gesture.stopNamed', { name })}
            className="grid size-11 place-items-center rounded-md text-ink-faint hover:bg-surface-high hover:text-critical disabled:pointer-events-none disabled:opacity-45 md:size-9 pointer-coarse:size-11 focus-visible:outline-2 focus-visible:outline-accent"
          >
            <Square size={11} fill="currentColor" aria-hidden />
          </button>
        ) : null}
      </span>
    </li>
  )
}
