/* PROTOTYPE — jetable (branche proto/page-projet). Ne pas fusionner dans main.
 *
 * La vue **Lanceur** de l'onglet Actions : une grille de **tuiles de taille égale**,
 * rangées par **nature** (Services, Commandes, Agents ; « Lancés par les sessions » en
 * tête quand il y en a). Chaque tuile a la même forme : en-tête (icône de nature avec son
 * point d'état, libellé, menu ⋯), une ligne d'état en gris, une ligne de contexte
 * (commande, prompt, cadence), et **un seul geste principal en bas, toujours au même
 * endroit** — « Lancer ▾ », l'interrupteur d'un service, « Relire ». Une tuile qui tourne
 * prend un liseré d'accent, rien de plus. Aucune écriture : chaque geste dit « Simulé ».
 */
import { AlarmClock, ArrowUpRight, Bot, MoreHorizontal, Plus, Repeat, Server, SquareTerminal } from 'lucide-react'
import { createContext, useContext, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Menu, MenuItem, MenuLabel, MenuSeparator, cx } from '@solera/ui'
import type { EditorSeed } from './Editor'
import { LaunchButton, ReviewButton, ServiceSwitch, StateIcon, actionState, cadenceText, quietGestureClass } from './LaunchButton'
import type { Automation } from './model'
import { ServedLine, useServedContext, useServedOf, useServiceSwitch, type ServedVersion } from './served'

type Simulate = (text: string) => void

/**
 * Dit aux groupes posés dans le Lanceur (« Lancés par les sessions ») qu'ils sont dans une
 * grille de tuiles : ils prennent la même forme que les autres.
 */
export const LauncherTilesContext = createContext(false)
export const useInLauncher = () => useContext(LauncherTilesContext)

/** La grille commune : des colonnes de largeur fixe, 3 à 4 selon la place. */
export const TILE_GRID = 'grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(16.5rem,1fr))] 2xl:[grid-template-columns:repeat(auto-fill,minmax(18rem,1fr))]'
/** La hauteur constante d'une tuile. */
/** Hauteur fixe, rien ne dépasse : chaque rangée interne tronque, la boîte coupe le reste. */
export const TILE_BOX = '@container/tile flex h-[9.5rem] min-w-0 flex-col overflow-hidden rounded-xl border p-3'

export function LauncherView({ projectId, items, onOpen, onEdit, simulate, before }: {
  projectId: string
  /** Posé en tête, avant les groupes : « Lancés par les sessions ». */
  before?: ReactNode
  items: Automation[]
  onOpen: (item: Automation) => void
  onEdit: (seed: EditorSeed) => void
  simulate: Simulate
}) {
  const services = items.filter((item) => item.what === 'command' && item.commandKind === 'service')
  const commands = items.filter((item) => item.what === 'command' && item.commandKind !== 'service')
  const agents = items.filter((item) => item.what === 'agent')
  const tile = (item: Automation) => <Tile key={item.id} projectId={projectId} item={item} onOpen={onOpen} onEdit={onEdit} simulate={simulate} />

  return (
    <LauncherTilesContext.Provider value>
      <div className="flex flex-col gap-7 p-4 md:p-6">
        {before}
        <Group icon={<Server size={14} />} title="Services" count={services.length} add={{ label: 'Nouveau service', onClick: () => onEdit({ preset: { what: 'command', kind: 'service' } }) }}>
          {services.map(tile)}
        </Group>
        <Group icon={<SquareTerminal size={14} />} title="Commandes" count={commands.length} add={{ label: 'Nouvelle commande', onClick: () => onEdit({ preset: { what: 'command', kind: 'task' } }) }}>
          {commands.map(tile)}
        </Group>
        <Group icon={<Bot size={14} />} title="Agents" count={agents.length} add={{ label: 'Nouvelle tâche d’agent', onClick: () => onEdit({ preset: { what: 'agent' } }) }}>
          {agents.map(tile)}
        </Group>
      </div>
    </LauncherTilesContext.Provider>
  )
}

/** Un groupe : en-tête sobre (icône, titre, compte), puis la grille et sa tuile d'ajout. */
export function Group({ icon, title, count, add, children }: {
  icon: ReactNode
  title: string
  count: number
  add?: { label: string; onClick: () => void }
  children: ReactNode
}) {
  return (
    <section className="flex flex-col gap-2.5">
      <header className="flex items-center gap-2 text-ink-soft">
        <span className="text-ink-faint">{icon}</span>
        <h2 className="text-sm font-medium text-ink">{title}</h2>
        <span className="text-xs tabular-nums text-ink-faint">{count}</span>
      </header>
      <div className={TILE_GRID}>
        {children}
        {add ? (
          <button
            type="button"
            onClick={add.onClick}
            className={cx(TILE_BOX, 'items-center justify-center gap-1.5 border-dashed border-line text-xs text-ink-faint transition-colors hover:border-line-strong hover:text-ink')}
          >
            <Plus size={15} /> {add.label}
          </button>
        ) : null}
      </div>
    </section>
  )
}

function Tile({ projectId, item, onOpen, onEdit, simulate }: {
  projectId: string
  item: Automation
  onOpen: (item: Automation) => void
  onEdit: (seed: EditorSeed) => void
  simulate: Simulate
}) {
  const state = actionState(item)
  const cadence = cadenceText(item)
  const running = item.live !== null && !item.review
  const context = item.what === 'agent' ? item.prompt : item.command
  const served = useServedOf(item)

  return (
    <article
      className={cx(
        TILE_BOX,
        'gap-2 transition-colors',
        running ? 'border-accent/40 bg-accent/5' : item.review ? 'border-caution/40' : 'border-line hover:border-line-strong',
      )}
    >
      <header className="flex min-w-0 items-start gap-2.5">
        <StateIcon item={item} tone={state.tone} />
        <button type="button" onClick={() => onOpen(item)} className="flex min-w-0 flex-1 flex-col items-start text-left">
          <span className="w-full truncate text-sm font-medium text-ink hover:underline">{item.label}</span>
          <span className={cx('w-full truncate text-xs', state.tone === 'review' ? 'text-caution' : state.tone === 'fail' ? 'text-critical' : 'text-ink-faint')}>{state.text}</span>
        </button>
        <TileMenu item={item} onOpen={onOpen} onEdit={onEdit} simulate={simulate} />
      </header>

      <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5 overflow-hidden pl-[2.625rem] text-xs text-ink-faint">
        {served ? (
          <ServedLine served={served} />
        ) : context ? (
          item.what === 'agent'
            ? <span className="truncate">{context}</span>
            : <code className="truncate font-mono text-[11px]">$ {context}</code>
        ) : null}
        {cadence ? (
          <span className="inline-flex min-w-0 items-center gap-1"><AlarmClock size={11} className="shrink-0" /> <span className="truncate">{cadence}</span></span>
        ) : null}
      </div>

      <footer className="flex min-w-0 items-center gap-1.5 overflow-hidden">
        <PrimaryGesture projectId={projectId} item={item} onOpen={onOpen} simulate={simulate} served={served} />
      </footer>
    </article>
  )
}

/** Le geste principal, toujours au même endroit : en bas à gauche de la tuile. */
function PrimaryGesture({ projectId, item, onOpen, simulate, served }: { projectId: string; item: Automation; onOpen: (item: Automation) => void; simulate: Simulate; served: ServedVersion | null }) {
  if (item.review) return <ReviewButton onReview={() => onOpen(item)} />
  if (item.what === 'command' && item.commandKind === 'service') {
    const on = item.live?.kind === 'service'
    return (
      <>
        <ServiceSwitch
          on={on}
          label={on ? `Arrêter « ${item.label} »` : `Démarrer « ${item.label} »`}
          onToggle={() => simulate(on ? `arrêter « ${item.label} »` : `démarrer « ${item.label} » à la racine du projet`)}
        />
        {on && served ? <SwitchMenu served={served} simulate={simulate} /> : null}
        {on && item.live?.href ? (
          <a href={item.live.href} target="_blank" rel="noreferrer" className={cx(quietGestureClass(), 'ml-auto')}>
            Ouvrir <ArrowUpRight size={12} />
          </a>
        ) : null}
      </>
    )
  }
  if (item.live?.kind === 'terminal') {
    return (
      <button type="button" onClick={() => simulate('ouvrir le terminal de la commande dans le panneau')} className={quietGestureClass()}>
        <SquareTerminal size={12} /> Terminal
      </button>
    )
  }
  if (item.live?.kind === 'session' && item.live.href) {
    return <Link to={item.live.href} className={quietGestureClass()}>Session <ArrowUpRight size={12} /></Link>
  }
  return <LaunchButton projectId={projectId} item={item} simulate={simulate} />
}

/** ⋯ : les gestes rares, hors de la tuile. */
function TileMenu({ item, onOpen, onEdit, simulate }: { item: Automation; onOpen: (item: Automation) => void; onEdit: (seed: EditorSeed) => void; simulate: Simulate }) {
  return (
    <Menu
      trigger={
        <button type="button" aria-label={`Plus pour « ${item.label} »`} className="-mt-0.5 -mr-1 grid size-7 shrink-0 place-items-center rounded-md text-ink-faint transition-colors hover:bg-surface-high hover:text-ink">
          <MoreHorizontal size={15} />
        </button>
      }
    >
      <MenuItem onSelect={() => onOpen(item)}>Voir le détail</MenuItem>
      {item.review ? null : (
        <>
          <MenuItem onSelect={() => onEdit({ from: item })}>Modifier</MenuItem>
          <MenuItem onSelect={() => onEdit({ from: item, schedule: true })}>{item.schedule ? 'Modifier la planification' : 'Planifier'}</MenuItem>
        </>
      )}
      <MenuItem onSelect={() => simulate(`dupliquer « ${item.label} »`)}>Dupliquer</MenuItem>
      <MenuSeparator />
      <MenuItem onSelect={() => simulate(`supprimer « ${item.label} »`)}>Supprimer</MenuItem>
    </Menu>
  )
}

/**
 * « Servir… » : basculer un service en marche sur un autre arbre. Ne se tait plus — le
 * dialogue dit ce qu'il sert et qu'il redémarre (voir `served.tsx`).
 */
function SwitchMenu({ served, simulate }: { served: ServedVersion; simulate: Simulate }) {
  const index = useServedContext()
  const { ask, dialog } = useServiceSwitch(simulate)
  const others = (index?.trees ?? []).filter((tree) => tree.key !== served.tree?.key && tree.state !== 'missing' && tree.state !== 'merged').slice(0, 8)
  if (others.length === 0) return null
  return (
    <>
      <Menu
        trigger={
          <button type="button" title="Servir une autre branche" aria-label="Servir une autre branche" className={quietGestureClass()}>
            <Repeat size={12} /><span className="hidden @min-[19rem]/tile:inline">Servir…</span>
          </button>
        }
      >
        <MenuLabel>Basculer sur</MenuLabel>
        {others.map((tree) => (
          <MenuItem key={tree.key} onSelect={() => ask(served, { name: tree.name, branch: tree.root ? `la racine (${tree.branch ?? '?'})` : tree.branch })}>
            <span className="truncate font-mono text-xs">{tree.root ? `racine (${tree.branch ?? '?'})` : tree.branch ?? tree.name}</span>
          </MenuItem>
        ))}
      </Menu>
      {dialog}
    </>
  )
}
