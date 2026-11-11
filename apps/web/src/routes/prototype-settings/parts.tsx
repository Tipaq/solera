/* PROTOTYPE — jetable (branche proto/page-projet). Ne pas fusionner dans main. */
import { Search, X } from 'lucide-react'
import { useEffect, useRef, type ReactNode } from 'react'
import { useParams } from 'react-router-dom'
import type { ProjectDto } from '@solera/protocol'
import { Banner, EmptyState, cx } from '@solera/ui'
import { useTranslate } from '../../lib/i18n'
import { useProjects } from '../../lib/projects'
import { ItemTitle, type SettingItem, type SettingsModel } from './model'

/** Charge le projet de l'adresse, puis rend la variante. */
export function WithProject({ children }: { children: (project: ProjectDto) => ReactNode }) {
  const { projectId } = useParams()
  const t = useTranslate()
  const { data: projects, isPending } = useProjects()
  const project = projects?.find((entry) => entry.id === projectId)
  if (isPending) return null
  if (!project) return <EmptyState title={t('project.notFound')} />
  return <>{children(project)}</>
}

/** Le bandeau d'un projet partagé, en tête : on lit, on ne règle pas. */
export function OwnerNotice({ project }: { project: ProjectDto }) {
  const t = useTranslate()
  if (project.isOwner) return null
  return <Banner>{t('project.shared.readonly', { name: project.ownerName })}</Banner>
}

/**
 * Les réglages d'un groupe en **rangées** : le libellé et son explication à gauche, le
 * contrôle à droite, sur toute la largeur. Un bloc (consignes, mémoire…) prend la rangée
 * entière sous son titre.
 */
export function RowGroup({
  model,
  name,
  items,
  highlight,
  anchorPrefix = 'reglage',
}: {
  model: SettingsModel
  name: string
  items: SettingItem[]
  highlight?: string | null
  anchorPrefix?: string
}) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="px-1 text-xs font-medium tracking-wide text-ink-faint uppercase">{name}</h3>
      <div className="divide-y divide-line rounded-xl border border-line">
        {items.map((item) => (
          <SettingRow key={item.id} model={model} item={item} highlighted={highlight === item.id} anchorId={`${anchorPrefix}-${item.id}`} />
        ))}
      </div>
    </section>
  )
}

function SettingRow({ model, item, highlighted, anchorId }: { model: SettingsModel; item: SettingItem; highlighted: boolean; anchorId: string }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (highlighted) ref.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [highlighted])

  const shell = cx(
    'scroll-mt-24 px-4 py-4 transition-colors md:px-5',
    highlighted && 'bg-accent-wash/40',
    item.category === 'danger' && 'bg-critical/5',
  )

  if (item.kind === 'block') {
    return (
      <div ref={ref} id={anchorId} className={cx(shell, 'flex flex-col gap-3')}>
        <div className="flex flex-col gap-0.5">
          <ItemTitle model={model} item={item} />
          {item.help ? <p className="text-xs text-ink-faint">{item.help}</p> : null}
        </div>
        {item.render()}
      </div>
    )
  }
  return (
    <div
      ref={ref}
      id={anchorId}
      className={cx(shell, 'grid gap-x-10 gap-y-2 md:grid-cols-[minmax(12rem,2fr)_minmax(0,3fr)] md:items-start')}
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        <ItemTitle model={model} item={item} />
        {item.help ? <p className="text-xs leading-relaxed text-ink-faint">{item.help}</p> : null}
      </div>
      <div className="min-w-0 md:pt-0.5">{item.render()}</div>
    </div>
  )
}

export function SearchBox({
  value,
  onChange,
  placeholder = 'Chercher un réglage : couleur, confin…',
  className,
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
}) {
  return (
    <label className={cx('flex h-10 items-center gap-2 rounded-xl border border-line bg-sunken px-3 focus-within:border-accent', className)}>
      <Search size={15} className="shrink-0 text-ink-faint" />
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-ink-faint"
      />
      {value ? (
        <button type="button" aria-label="Effacer" onClick={() => onChange('')} className="text-ink-faint hover:text-ink">
          <X size={14} />
        </button>
      ) : null}
    </label>
  )
}

export function NoResult({ query }: { query: string }) {
  return <p className="rounded-xl border border-dashed border-line px-4 py-8 text-center text-sm text-ink-faint">Aucun réglage pour « {query} ».</p>
}
