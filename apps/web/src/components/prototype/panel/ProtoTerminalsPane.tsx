/* PROTOTYPE — jetable (branche proto/page-projet). Copie de components/panel/TerminalsPane.tsx alignée sur PanelTabFrame. */
import { Button, TooltipButton } from '@solera/ui'
import { Loader, Plus, SquareTerminal, X } from 'lucide-react'
import { memo, useEffect, useState } from 'react'
import { MAX_TERMINALS_PER_PROJECT, type TerminalDto } from '@solera/protocol'
import { useTranslate } from '../../../lib/i18n'
import { clearFocusedTerminal, useFocusedTerminal } from '../../../lib/panel'
import { useProjects } from '../../../lib/projects'
import { useCloseTerminal, useOpenTerminal, useTerminals } from '../../../lib/terminals'
import { cx } from '@solera/ui'
import { TerminalView } from '../../panel/TerminalView'
import { toolbarButtonClass } from '../ViewSwitch'
import { PanelNotice, PanelToolbar } from './PanelTabFrame'

/**
 * Onglets de terminaux, et le terminal actif en dessous.
 *
 * La liste est celle du **projet** : ouverte depuis une session ou depuis la vue
 * projet, c'est la même, et chaque onglet dit dans quel répertoire son shell tourne.
 * Seul le répertoire du nouveau terminal dépend d'où l'on est.
 *
 * Les vues restent toutes montées : une commande qui tourne dans l'un ne doit pas être
 * coupée parce qu'on regarde l'autre, et remonter un terminal repartirait d'un écran
 * vide alors que le pty, lui, a continué.
 */
export const ProtoTerminalsPane = memo(function ProtoTerminalsPane({
  projectId,
  /** Présente en vue conversation : le nouveau terminal s'ouvre dans son répertoire. */
  conversationId,
  visible,
}: {
  projectId: string
  conversationId?: string
  visible: boolean
}) {
  const { data: terminals, error, isPending } = useTerminals(projectId, visible)
  const { data: projects } = useProjects()
  const open = useOpenTerminal(projectId)
  const close = useCloseTerminal(projectId)
  const [active, setActive] = useState<string | null>(null)
  const t = useTranslate()

  const workspacePath = projects?.find((project) => project.id === projectId)?.workspacePath

  // La sélection suit la liste : un terminal fermé ne doit pas laisser une vue
  // pointant sur rien.
  useEffect(() => {
    if (!terminals) return
    setActive((current) =>
      current && terminals.some((terminal) => terminal.id === current)
        ? current
        : (terminals[0]?.id ?? null),
    )
  }, [terminals])

  // Un terminal ouvert par une action passe devant dès que la liste relue le contient.
  const focused = useFocusedTerminal()
  useEffect(() => {
    if (!focused || !terminals?.some((terminal) => terminal.id === focused)) return
    setActive(focused)
    clearFocusedTerminal()
  }, [focused, terminals])

  const full = (terminals?.length ?? 0) >= MAX_TERMINALS_PER_PROJECT
  // Une relance repart là où le shell tournait, et dans l'environnement de la session
  // qui l'avait ouvert : c'est elle qui le porte, pas la session affichée.
  const openNew = (relaunched?: TerminalDto) =>
    open.mutate(relaunched ? { cwd: relaunched.cwd, ...(relaunched.conversationId ? { conversationId: relaunched.conversationId } : {}) } : { conversationId }, {
      onSuccess: (created) => setActive(created.id),
    })

  /** Où tourne ce shell : le workspace, ou le nom du dossier de worktree. */
  const dirLabel = (terminal: TerminalDto) =>
    terminal.cwd === workspacePath
      ? t('terminal.dir.workspace')
      : (terminal.cwd.split('/').pop() ?? terminal.cwd)

  const activeTerminal = terminals?.find((terminal) => terminal.id === active)

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      {/* Des onglets plutôt qu'une liste en pile : on passe d'un shell à l'autre sans
          cesse, et une pile coûterait un clic à chaque fois en cachant le terminal. Mais
          ils vivent dans la ligne d'outils commune : titre, compte, puis les shells en
          pastilles à la hauteur des autres contrôles, et « + » au bout. */}
      <PanelToolbar title="Terminaux" meta={(terminals?.length ?? 0) > 0 ? terminals!.length : undefined}>
        <span className="flex min-w-0 shrink items-center gap-1 overflow-x-auto">
          {(terminals ?? []).map((terminal) => (
            <span
              key={terminal.id}
              className={cx(
                'group/term inline-flex h-11 shrink-0 items-center gap-1.5 rounded-md border pr-1 pl-2 text-xs md:h-9',
                terminal.id === active ? 'border-line-strong bg-surface-high text-ink' : 'border-line text-ink-soft hover:border-line-strong hover:text-ink',
              )}
            >
              <span
                aria-label={terminal.alive ? t('terminal.tab.shellAlive') : t('terminal.tab.shellDone')}
                className={cx('size-1.5 shrink-0 rounded-full', terminal.alive ? 'bg-positive' : terminal.exitCode ? 'bg-critical' : 'bg-ink-faint/50')}
              />
              <button type="button" onClick={() => setActive(terminal.id)} title={terminal.cwd} className="flex items-baseline gap-1.5">
                <span className="max-w-[8rem] truncate">{terminal.title}</span>
                <span className="text-micro text-ink-faint">{dirLabel(terminal)}</span>
              </button>
              <TooltipButton
                type="button"
                onClick={() => close.mutate(terminal.id)}
                aria-label={t('terminal.tab.close', { title: terminal.title })}
                className="rounded p-0.5 text-ink-faint opacity-0 hover:text-ink group-hover/term:opacity-100 pointer-coarse:opacity-100"
              >
                <X size={13} />
              </TooltipButton>
            </span>
          ))}
        </span>
        <button
          type="button"
          onClick={() => openNew()}
          disabled={full || open.isPending}
          title={full ? t('terminal.max', { max: MAX_TERMINALS_PER_PROJECT }) : t('terminal.new')}
          aria-label={t('terminal.new')}
          className={cx(toolbarButtonClass(false), 'disabled:opacity-40')}
        >
          {open.isPending ? <Loader size={14} className="animate-spin" /> : <Plus size={14} />}
        </button>
      </PanelToolbar>

      {error || open.error || close.error ? (
        <PanelNotice tone="critical">
          {(error ?? open.error ?? close.error) instanceof Error
            ? (error ?? open.error ?? close.error)?.message
            : t('terminal.unavailable')}
        </PanelNotice>
      ) : null}

      {isPending ? (
        <p className="flex items-center gap-1.5 px-2.5 py-2 text-xs text-ink-faint">
          <Loader size={11} className="animate-spin" />
          {t('terminal.loading')}
        </p>
      ) : null}

      {/* Aucun terminal : un état centré dans l'onglet, une phrase et le geste, plutôt
          qu'une ligne serrée contre la barre (Tim, 2026-11-11). */}
      {terminals?.length === 0 ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6 pb-12 text-center">
          <span className="grid size-10 place-items-center rounded-full bg-surface-high/70 text-ink-faint">
            <SquareTerminal size={18} />
          </span>
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium text-ink">Aucun terminal ouvert</p>
            <p className="text-xs text-ink-faint">
              {conversationId ? 'Il s’ouvre dans le worktree de cette conversation.' : 'Il s’ouvre à la racine du projet.'}
            </p>
          </div>
          <Button size="sm" icon={open.isPending ? <Loader size={14} className="animate-spin" /> : <Plus size={14} />} disabled={open.isPending} onClick={() => openNew()}>
            Nouveau terminal
          </Button>
        </div>
      ) : null}

      {/* Le shell a été emporté par un redémarrage du daemon : l'écran en dessous est
          son dernier état, et la relance rouvre un shell neuf au même endroit. */}
      {activeTerminal?.interrupted ? (
        <PanelNotice tone="caution">
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {t('terminal.interrupted')}
            <button type="button" disabled={full || open.isPending} onClick={() => openNew(activeTerminal)} className="font-medium underline-offset-2 hover:underline disabled:opacity-40">
              {t('terminal.relaunch')}
            </button>
          </span>
        </PanelNotice>
      ) : null}

      {(terminals ?? []).map((terminal) => (
        <div
          key={terminal.id}
          className={cx(
            'min-h-0 min-w-0 flex-1',
            terminal.id === active && visible ? 'block' : 'hidden',
          )}
        >
          <TerminalView
            projectId={projectId}
            terminalId={terminal.id}
            visible={terminal.id === active && visible}
          />
        </div>
      ))}
    </div>
  )
})
