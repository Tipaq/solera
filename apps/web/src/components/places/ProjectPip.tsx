import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { ProjectDto } from '@solera/protocol'
import { cx } from '@solera/ui'
import { ProjectAvatar } from '../ProjectAvatar'

/*
 * Les pièces qui nomment un projet dans une liste qui en mêle plusieurs : `/sessions`
 * et le portefeuille. Le projet s'y reconnaît à son avatar avant son nom.
 */

type PipProject = Pick<ProjectDto, 'id' | 'name' | 'image' | 'color'>

/**
 * La pastille d'un projet : son avatar et son nom, qui mène à sa page.
 *
 * `plain` la rend sans lien, pour une ligne déjà cliquable tout entière : un lien dans
 * un lien ne se pose pas.
 */
export function ProjectPip({ project, to, plain = false, className }: { project: PipProject; to?: string; plain?: boolean; className?: string }) {
  const body = (
    <>
      <ProjectAvatar project={project} className="size-3.5 shrink-0" />
      <span className="truncate">{project.name}</span>
    </>
  )
  const shape = cx('inline-flex max-w-48 min-w-0 items-center gap-1.5 text-xs text-ink-soft', className)
  if (plain) return <span className={shape}>{body}</span>
  return (
    <Link to={to ?? `/p/${project.id}`} className={cx(shape, 'underline-offset-2 hover:text-ink hover:underline')}>
      {body}
    </Link>
  )
}

/**
 * L'en-tête d'un groupe de lignes rangées par projet : l'avatar, le nom qui mène au
 * projet, le compte. `aside` porte les gestes du groupe, à droite.
 */
export function ProjectGroupHeader({ project, count, aside }: { project: PipProject; count?: number; aside?: ReactNode }) {
  return (
    <div className="flex min-w-0 items-center gap-2 py-1">
      <ProjectAvatar project={project} className="size-4 shrink-0" />
      <Link to={`/p/${project.id}`} className="truncate text-sm font-medium text-ink underline-offset-2 hover:underline">
        {project.name}
      </Link>
      {count !== undefined ? <span className="text-xs tabular-nums text-ink-faint">{count}</span> : null}
      {aside ? <span className="ml-auto flex items-center gap-2">{aside}</span> : null}
    </div>
  )
}
