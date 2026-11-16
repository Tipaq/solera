import { BookOpen, FolderX, Server } from 'lucide-react'
import { cx } from '@solera/ui'
import { useTranslate } from '../../lib/i18n'
import { scopeLabel, type PlannedScope } from '../../lib/planned'
import { ProjectAvatar } from '../ProjectAvatar'
import { ProjectPip } from '../places/ProjectPip'

/*
 * Les repères d'une portée sur la page Planifiées : où une tâche travaille, un projet,
 * le Savoir, l'instance ou nulle part.
 */

/** L'icône seule : l'avatar d'un projet, un livre pour le Savoir, un serveur pour l'instance. */
export function ScopeMark({ scope, className }: { scope: PlannedScope; className?: string }) {
  const shape = cx('size-3.5 shrink-0', className)
  switch (scope.kind) {
    case 'project':
      return scope.project ? <ProjectAvatar project={scope.project} className={shape} /> : <FolderX aria-hidden className={cx(shape, 'text-ink-faint')} />
    case 'vault':
      return <BookOpen aria-hidden className={cx(shape, 'text-ink-faint')} />
    case 'instance':
      return <Server aria-hidden className={cx(shape, 'text-ink-faint')} />
    case 'none':
      return <FolderX aria-hidden className={cx(shape, 'text-ink-faint')} />
  }
}

/**
 * La pastille d'une portée : la `ProjectPip` d'un projet, sinon son icône et son nom.
 * `plain` la rend sans lien, dans une ligne déjà cliquable.
 */
export function ScopePip({ scope, plain = false, className }: { scope: PlannedScope; plain?: boolean; className?: string }) {
  const t = useTranslate()
  if (scope.kind === 'project' && scope.project) return <ProjectPip project={scope.project} plain={plain} className={className} />
  return (
    <span className={cx('inline-flex max-w-48 min-w-0 items-center gap-1.5 text-xs text-ink-soft', className)}>
      <ScopeMark scope={scope} />
      <span className="truncate">{scopeLabel(scope, t)}</span>
    </span>
  )
}
