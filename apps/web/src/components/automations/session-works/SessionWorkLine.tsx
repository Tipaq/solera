import { MoreHorizontal, Square } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { IconButton, Menu, MenuItem, cx, panelRowClass } from '@solera/ui'
import { useTranslate } from '../../../lib/i18n'
import { seedFromWork, type SessionWork } from '../../../lib/session-works'
import { PortLink, SessionPill, WorkIcon, useWorkText, type WorkGestures } from './parts'

const ON_HOVER = 'opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 pointer-coarse:opacity-100'

/**
 * La ligne d'un processus dans le panneau (PRC-7) : **un serveur qui tourne**, lu comme
 * tel. 36 px, la même icône (famille et point) que les lignes d'actions ; le libellé
 * humain, la session d'origine en pastille seulement si ce n'est pas celle-ci ; à droite
 * le port en lien et la durée ; au survol « ■ » et un ⋯ (En faire une action, Voir la
 * sortie, Aller à la session). Un clic déplie la commande exacte, l'origine, la charge,
 * et dit où lire la sortie.
 */
export function SessionWorkLine({
  projectId,
  work,
  currentConversationId,
  gestures,
}: {
  projectId: string
  work: SessionWork
  currentConversationId?: string
  gestures: WorkGestures
}) {
  const t = useTranslate()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const { name, short, load, since, sessionHref } = useWorkText(projectId, work)
  const here = currentConversationId !== undefined && work.conversationId === currentConversationId
  return (
    // Son propre conteneur : sous 26 rem, la pastille se replie sur l'icône du CLI et la
    // durée s'efface — le détail déplié dit les deux.
    <li data-session-work={work.id} className="@container flex flex-col">
      <div className={panelRowClass}>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          title={[short ?? work.description, load].filter(Boolean).join(' — ')}
          className="-mx-1 flex min-w-0 flex-1 items-center gap-2.5 self-stretch rounded-sm px-1 text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
        >
          <WorkIcon work={work} size="sm" />
          {/* Le libellé d'abord : la pastille cède la place la première. */}
          <span className="min-w-0 truncate text-sm text-ink">{name}</span>
          {here ? null : <SessionPill work={work} narrow className="shrink-[4]" />}
        </button>
        <span className="flex shrink-0 items-center gap-0.5">
          <span className={cx('flex items-center gap-0.5', ON_HOVER)}>
            {work.stop ? (
              <IconButton
                size="sm"
                label={t('sessionWorks.gesture.stopNamed', { name })}
                title={t('sessionWorks.gesture.stop')}
                disabled={gestures.stopping === work.id}
                onClick={() => gestures.onStop(work)}
                className="hover:text-critical"
              >
                <Square size={10} fill="currentColor" />
              </IconButton>
            ) : null}
            <Menu
              trigger={
                <IconButton size="sm" label={t('sessionWorks.gesture.more', { name })}>
                  <MoreHorizontal size={14} />
                </IconButton>
              }
            >
              <MenuItem onSelect={() => gestures.onMakeAction(seedFromWork(work, t))}>{t('sessionWorks.gesture.makeAction')}</MenuItem>
              <MenuItem onSelect={() => setOpen(true)}>{t('sessionWorks.gesture.showOutput')}</MenuItem>
              {here ? null : <MenuItem onSelect={() => navigate(sessionHref)}>{t('sessionWorks.gesture.goToSession')}</MenuItem>}
            </Menu>
          </span>
          {work.port ? (
            <PortLink
              port={work.port}
              className="inline-flex h-8 items-center gap-0.5 rounded-md px-1.5 font-mono text-xs text-ink-soft tabular-nums underline-offset-2 hover:bg-surface-high hover:text-ink hover:underline"
            />
          ) : null}
          {since ? <span className="hidden w-12 shrink-0 text-right text-xs tabular-nums text-ink-faint @min-[26rem]:inline">{since}</span> : null}
        </span>
      </div>
      {open ? (
        <div className="flex flex-col gap-1.5 pr-3 pb-2.5 pl-[2.75rem] text-xs text-ink-faint">
          {work.command ? (
            <code className="font-mono text-[11px] break-all text-ink-soft">$ {work.command}</code>
          ) : work.description ? (
            <span>{work.description}</span>
          ) : null}
          <span className="flex min-w-0 flex-wrap items-center gap-x-2">
            <span>{here ? t('sessionWorks.origin.thisSession') : t('sessionWorks.origin.by', { title: work.conversationTitle })}</span>
            {since ? <span>{t('sessionWorks.state.since', { duration: since })}</span> : null}
            {load ? <span className="tabular-nums">{load}</span> : null}
          </span>
          <span>{t('sessionWorks.output.none')}</span>
        </div>
      ) : null}
    </li>
  )
}
