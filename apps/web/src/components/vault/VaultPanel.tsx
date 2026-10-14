import { ChevronLeft, FileText, History, Layers, Link2, ListTree, Unlink, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { IconButton, TooltipButton, cx } from '@solera/ui'
import type { VaultNoteFactsDto, VaultNoteHistoryDto, VaultTreeDto } from '@solera/protocol'
import { locale, useTranslate } from '../../lib/i18n'
import { setPanelExpanded, setPanelOpen, setDockedPanelWidth, setPanelWidth, restorePanelWidth } from '../../lib/panel'
import { setVaultPanelTab, useVaultPanelTab, type VaultPanelTab } from '../../lib/vault-panel'
import { resizeHandle } from '../../lib/resize-handle'
import { useMediaQuery } from '../../lib/viewport'
import { PanelFocus } from '../PanelFocus'
import { HeaderBand } from '../HeaderBand'
import { NoteTree } from './NoteTree'

/**
 * Le panneau droit en contexte *Savoir* : **Notes · Rapprochements · Liens ·
 * Historique**, puis *Agent*.
 *
 * La même forme qu'en Travail — des vues de contexte, un trait, puis ce qui regarde
 * l'agent — et c'est le choix P1 du premier tour : *Liens* et *Rapprochements* restent
 * séparés parce qu'ils ne sont pas de la même matière. Un lien entrant est un **fait du
 * texte**, exact et sans recours ; un rapprochement est un **calcul**, qui peut se
 * tromper et porte donc toujours un geste de rejet. Les fondre dans un *Autour* aurait
 * mélangé une certitude et une estimation au moment précis où l'estimation devient le
 * cœur du produit.
 *
 * Composant à part de `SidePanel`, et non un mode de plus dans celui-ci : les deux ne
 * partagent aucune vue, et seule la **grammaire** leur est commune — la bande, la
 * poignée du bord, les trois géométries. C'est cette grammaire qui est reprise ici, pas
 * le code qui sert un répertoire de travail.
 */
export function VaultPanel({
  note,
  facts,
  history,
  tree,
  open,
  docked = false,
  canDock = false,
  onOpenNote,
  onCreateNote,
}: {
  /** La note ouverte au centre, ou `null` quand le vault est vide. */
  note: string | null
  facts: VaultNoteFactsDto | undefined
  history: VaultNoteHistoryDto | undefined
  tree: VaultTreeDto | undefined
  /** Faux pendant la sortie : le panneau est encore monté, mais s'en va. */
  open: boolean
  docked?: boolean
  canDock?: boolean
  onOpenNote: (path: string) => void
  onCreateNote: (folder: string, title: string) => void
}) {
  const t = useTranslate()
  const tab = useVaultPanelTab()
  const aside = useRef<HTMLElement>(null)
  const [entered, setEntered] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const wide = useMediaQuery('(min-width: 48rem)')
  const modal = !wide || fullscreen

  useEffect(restorePanelWidth, [])

  /**
   * Le premier rendu se fait hors écran, l'entrée n'étant lancée qu'au rendu suivant :
   * un élément qui naît déjà en place n'a aucune transition à jouer.
   */
  useEffect(() => {
    const frame = requestAnimationFrame(() => setEntered(true))
    return () => cancelAnimationFrame(frame)
  }, [])

  const geometries: ('docked' | 'sheet' | 'fullscreen')[] = [
    ...(canDock ? (['docked'] as const) : []),
    'sheet',
    'fullscreen',
  ]
  const geometry = fullscreen ? 'fullscreen' : docked ? 'docked' : 'sheet'
  const nextGeometry = geometries[(geometries.indexOf(geometry) + 1) % geometries.length] ?? 'sheet'
  const goTo = (next: 'docked' | 'sheet' | 'fullscreen') => {
    setFullscreen(next === 'fullscreen')
    if (next !== 'fullscreen') setPanelExpanded(next === 'sheet')
  }

  const handle = resizeHandle({
    widthAt: (clientX) => window.innerWidth - clientX,
    current: () => aside.current?.getBoundingClientRect().width ?? null,
    apply: docked ? setDockedPanelWidth : setPanelWidth,
  })

  return (
    <PanelFocus open={open} modal={modal} onClose={() => (fullscreen ? setFullscreen(false) : setPanelOpen(false))}>
      <aside
        ref={aside}
        inert={!open}
        aria-hidden={!open}
        aria-label={t('vault.panel.aria')}
        role={modal ? 'dialog' : undefined}
        aria-modal={modal && open ? true : undefined}
        data-panel="vault"
        data-fullscreen={fullscreen || undefined}
        className={cx(
          'surface flex flex-col border-l border-line shadow-pop',
          fullscreen
            ? 'app-layer z-40 pt-safe'
            : docked
              ? 'relative z-20 h-full w-[clamp(20rem,var(--panel-docked-width,38%),calc(100%-26rem))] shrink-0'
              : 'absolute inset-0 z-20 md:left-auto md:w-[min(var(--panel-width,32rem),calc(100vw-10rem))]',
          'transition-[translate] duration-200 ease-out',
          entered && open ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        {modal ? (
          <HeaderBand zone="panel">
            {fullscreen ? (
              <IconButton label={t('panel.fullscreen.exit')} onClick={() => setFullscreen(false)}>
                <ChevronLeft size={18} />
              </IconButton>
            ) : null}
            <span className="min-w-0 flex-1 truncate text-sm font-medium">{t('vault.panel.aria')}</span>
            <IconButton data-panel-initial-focus label={t('panel.close')} onClick={() => setPanelOpen(false)}>
              <X size={16} />
            </IconButton>
          </HeaderBand>
        ) : null}

        <ViewBar band={!modal} closable={!modal && !docked} tab={tab} facts={facts} />

        {/* L'arbre reste monté : revenir aux notes ne doit replier aucun dossier, ni
            perdre sa position de défilement. */}
        <div
          className={cx(
            'min-h-0 min-w-0 flex-1 flex-col overflow-hidden pb-safe',
            tab === 'notes' ? 'flex' : 'hidden',
          )}
        >
          <NoteTree tree={tree} current={note} onOpen={onOpenNote} onCreate={onCreateNote} />
        </div>

        {tab === 'rapprochements' ? <RapprochementsPane /> : null}
        {tab === 'links' ? <LinksPane facts={facts} onOpenNote={onOpenNote} /> : null}
        {tab === 'history' ? <HistoryPane history={history} /> : null}

        <div
          role="separator"
          aria-orientation="vertical"
          aria-label={t('panel.resize.aria', { next: t(`panel.geometry.${nextGeometry}`) })}
          tabIndex={0}
          onPointerDown={handle.onPointerDown}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              goTo(nextGeometry)
              return
            }
            handle.onKeyDown(event)
          }}
          onDoubleClick={() => {
            if (fullscreen) return setFullscreen(false)
            if (canDock) setPanelExpanded(docked)
          }}
          className={cx(
            'absolute inset-y-0 -left-1 hidden w-2 cursor-col-resize',
            !fullscreen && 'md:block',
            'after:absolute after:inset-y-0 after:left-1/2 after:w-0.5 after:-translate-x-1/2',
            'after:transition-colors hover:after:bg-accent focus-visible:after:bg-accent',
            'outline-none',
          )}
        />
      </aside>
    </PanelFocus>
  )
}

/**
 * Les quatre vues du contexte, et le trait.
 *
 * *Agent* n'est pas encore là : la boîte des agents n'existe pas, et une vue qui
 * n'ouvrirait rien ne serait pas une vue. Le trait qui l'annonce viendra avec elle,
 * comme les **vues à soi** qui s'ajoutent après un second trait — elles supposent la
 * recherche enregistrée, qui n'est pas ce tour-ci.
 */
function ViewBar({ band, closable, tab, facts }: {
  band: boolean
  closable: boolean
  tab: VaultPanelTab
  facts: VaultNoteFactsDto | undefined
}) {
  const t = useTranslate()
  const views = (
    <>
      <Tab icon={<ListTree size={15} />} label={t('vault.panel.notes')} keepLabel={!band}
        active={tab === 'notes'} onSelect={() => setVaultPanelTab('notes')} />
      <Tab icon={<Layers size={15} />} label={t('vault.panel.rapprochements')} keepLabel={!band}
        active={tab === 'rapprochements'} onSelect={() => setVaultPanelTab('rapprochements')} />
      {/* Le décompte est celui des liens entrants : c'est le fait, et il ne se replie
          jamais — une note citée quatre fois doit le dire même l'onglet fermé. */}
      <Tab icon={<Link2 size={15} />} label={t('vault.panel.links')} keepLabel={!band}
        badge={facts?.incoming.length ?? 0}
        announce={t('vault.panel.links.badge', { count: String(facts?.incoming.length ?? 0) })}
        active={tab === 'links'} onSelect={() => setVaultPanelTab('links')} />
      <Tab icon={<History size={15} />} label={t('vault.panel.history')} keepLabel={!band}
        active={tab === 'history'} onSelect={() => setVaultPanelTab('history')} />
    </>
  )

  const inner = 'flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto'
  const close = closable ? (
    <IconButton data-panel-initial-focus size="sm" label={t('panel.close')} onClick={() => setPanelOpen(false)}>
      <X size={16} />
    </IconButton>
  ) : null

  return band ? (
    <HeaderBand zone="panel" className="@container">
      <div className={inner}>{views}</div>
      {close}
    </HeaderBand>
  ) : (
    <div className="@container flex h-[var(--header-height)] shrink-0 items-center border-b border-line px-2">
      <div className={inner}>{views}</div>
      {close}
    </div>
  )
}

/**
 * Même bouton que la bande du Travail, et même règle : les noms tombent **tous
 * ensemble** sous 30 rem. À 20 rem le panneau du Savoir est donc une rangée d'icônes,
 * ce qui rend l'icône de chaque vue décisive.
 */
function Tab({ icon, label, active, badge = 0, keepLabel = false, announce, onSelect }: {
  icon: React.ReactNode
  label: string
  active: boolean
  badge?: number
  keepLabel?: boolean
  /**
   * Ce que le décompte **dit**, quand « en cours » serait faux.
   *
   * Le panneau du Travail compte des choses qui tournent ; celui du Savoir compte des
   * liens entrants, qui ne tournent pas. Un seul gabarit pour les deux aurait fait
   * annoncer « Liens, 5 en cours » à un lecteur d'écran.
   */
  announce?: string
  onSelect: () => void
}) {
  const t = useTranslate()
  return (
    <TooltipButton
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      aria-label={badge > 0 ? (announce ?? t('panel.tab.badge', { label, count: badge })) : label}
      title={label}
      className={cx(
        'flex h-11 min-w-11 shrink-0 items-center justify-center gap-1.5 rounded-md px-2 text-xs font-medium transition-colors md:h-8 md:min-w-0 pointer-coarse:h-11 pointer-coarse:min-w-11',
        active ? 'bg-accent-wash text-ink' : 'text-ink-faint hover:text-ink',
      )}
    >
      <span className="shrink-0">{icon}</span>
      <span className={cx(keepLabel && active ? null : '@max-[30rem]:hidden')}>{label}</span>
      {badge > 0 ? (
        <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-accent text-micro font-semibold text-accent-ink">
          {badge}
        </span>
      ) : null}
    </TooltipButton>
  )
}

/**
 * *Rapprochements* : la vue existe, son calcul n'est pas encore là.
 *
 * Elle est nommée et vide plutôt qu'absente, et c'est délibéré : la bande du Savoir est
 * arrêtée à quatre vues de contexte, qui doivent rester au même endroit pour tout le
 * monde. Ce qui manque est le **niveau 2** de l'indexation — un vecteur par section, une
 * distance, et un appel de modèle pour la seule contradiction. Le dire ici vaut mieux
 * qu'une liste vide qu'on prendrait pour « rien à rapprocher ».
 */
function RapprochementsPane() {
  const t = useTranslate()
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
      <p className="text-sm text-ink-soft">{t('vault.rapprochements.pending')}</p>
      <p className="mt-2 text-xs text-ink-faint">{t('vault.rapprochements.why')}</p>
    </div>
  )
}

/**
 * *Liens* : qui cite cette note, et ce qu'elle cite.
 *
 * Les entrants d'abord : c'est ce qu'on vient chercher, et c'est l'inversion exacte des
 * sortants des autres notes. Un lien **cassé** se montre avec sa cible telle qu'elle est
 * écrite — c'est ce qu'il faut pour la réparer, et il n'y a pas de titre à afficher.
 */
function LinksPane({ facts, onOpenNote }: {
  facts: VaultNoteFactsDto | undefined
  onOpenNote: (path: string) => void
}) {
  const t = useTranslate()
  if (!facts) return null

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2 pb-safe">
      <Section label={t('vault.links.incoming', { count: facts.incoming.length })}>
        {facts.incoming.length === 0 ? (
          <Empty>{t('vault.links.noIncoming')}</Empty>
        ) : (
          facts.incoming.map((link, index) => (
            <li key={`${link.path}:${link.line}:${index}`}>
              <button
                type="button"
                onClick={() => onOpenNote(link.path)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-ink-soft transition-colors hover:bg-surface-high hover:text-ink"
              >
                <FileText size={14} className="shrink-0 text-ink-faint" />
                <span className="min-w-0 flex-1 truncate">{link.title}</span>
                <span className="shrink-0 text-meta tabular-nums text-ink-faint">{link.line}</span>
              </button>
            </li>
          ))
        )}
      </Section>

      <Section label={t('vault.links.outgoing', { count: facts.outgoing.length })}>
        {facts.outgoing.length === 0 ? (
          <Empty>{t('vault.links.noOutgoing')}</Empty>
        ) : (
          facts.outgoing.map((link, index) => (
            <li key={`${link.target}:${link.line}:${index}`}>
              {link.path === null ? (
                <span
                  title={t('vault.links.broken')}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-ink-faint"
                >
                  <Unlink size={14} className="shrink-0 text-critical" />
                  <span className="min-w-0 flex-1 truncate line-through">{link.title}</span>
                  <span className="shrink-0 text-meta tabular-nums">{link.line}</span>
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => onOpenNote(link.path ?? '')}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-ink-soft transition-colors hover:bg-surface-high hover:text-ink"
                >
                  <FileText size={14} className="shrink-0 text-ink-faint" />
                  <span className="min-w-0 flex-1 truncate">{link.title}</span>
                  <span className="shrink-0 text-meta tabular-nums text-ink-faint">{link.line}</span>
                </button>
              )}
            </li>
          ))
        )}
      </Section>
    </div>
  )
}

/**
 * *Historique* : les commits qui ont touché cette note.
 *
 * `versioned` à faux dit qu'il n'y a pas d'historique **du tout**, ce qui ne se confond
 * pas avec une note qu'aucun commit ne connaît encore. Et une note enregistrée mais pas
 * committée le dit : enregistrer dans Solera n'est pas committer, et laisser croire que
 * l'historique contient la dernière frappe serait un mensonge utile à personne.
 */
function HistoryPane({ history }: { history: VaultNoteHistoryDto | undefined }) {
  const t = useTranslate()
  if (!history) return null

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2 pb-safe">
      {!history.versioned ? (
        <Empty>{t('vault.history.unversioned')}</Empty>
      ) : (
        <>
          {history.uncommitted ? (
            <p className="mx-2 mb-2 rounded-md bg-surface-high px-2 py-1.5 text-xs text-ink-soft">
              {t('vault.history.uncommitted')}
            </p>
          ) : null}
          {history.revisions.length === 0 ? (
            <Empty>{t('vault.history.empty')}</Empty>
          ) : (
            <ul>
              {history.revisions.map((revision) => (
                <li key={revision.hash} className="px-2 py-1.5">
                  <p className="truncate text-sm text-ink-soft" title={revision.subject}>
                    {revision.subject}
                  </p>
                  <p className="text-meta text-ink-faint">
                    {revision.author} ·{' '}
                    {new Date(revision.at).toLocaleString(locale(), {
                      day: 'numeric',
                      month: 'short',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}{' '}
                    · <span className="font-mono">{revision.hash.slice(0, 8)}</span>
                  </p>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  )
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="mb-2">
      <h3 className="px-2 pt-1 pb-1 text-meta font-semibold uppercase tracking-wider text-ink-faint">
        {label}
      </h3>
      <ul>{children}</ul>
    </section>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return <li className="px-2 py-1.5 text-sm text-ink-faint">{children}</li>
}
