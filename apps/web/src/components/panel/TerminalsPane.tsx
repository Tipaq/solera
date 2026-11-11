import { PanelNotice, cx } from '@solera/ui'
import { Loader } from 'lucide-react'
import { memo, useEffect, useState } from 'react'
import { MAX_TERMINALS_PER_PROJECT, type TerminalDto } from '@solera/protocol'
import { useTranslate } from '../../lib/i18n'
import { clearFocusedTerminal, useFocusedTerminal } from '../../lib/panel'
import { useProjects } from '../../lib/projects'
import { useCloseTerminal, useOpenTerminal, useTerminals } from '../../lib/terminals'
import { TerminalsEmpty, TerminalsLine } from './TerminalsLine'
import { TerminalView } from './TerminalView'

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
export const TerminalsPane = memo(function TerminalsPane({
  projectId,
  /** Présente en vue conversation : le nouveau terminal s'ouvre dans son répertoire. */
  conversationId,
  inWorktree = false,
  visible,
}: {
  projectId: string
  conversationId?: string
  /** Le fil a son worktree : l'état vide le dit, c'est là que le shell s'ouvrira. */
  inWorktree?: boolean
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

  const activeTerminal = terminals?.find((terminal) => terminal.id === active)

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <TerminalsLine
        terminals={terminals ?? []}
        active={active}
        workspacePath={workspacePath}
        opening={open.isPending}
        onSelect={setActive}
        onClose={(id) => close.mutate(id)}
        onNew={() => openNew()}
      />

      {error || open.error || close.error ? (
        <PanelNotice tone="critical">
          {(error ?? open.error ?? close.error) instanceof Error
            ? (error ?? open.error ?? close.error)?.message
            : t('terminal.unavailable')}
        </PanelNotice>
      ) : null}

      {/* Le shell a été emporté par un redémarrage du daemon : l'écran en dessous est
          son dernier état, et la relance rouvre un shell neuf au même endroit. */}
      {activeTerminal?.interrupted ? (
        <PanelNotice tone="caution">
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {t('terminal.interrupted')}
            <button
              type="button"
              disabled={full || open.isPending}
              onClick={() => openNew(activeTerminal)}
              className="font-medium underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40"
            >
              {t('terminal.relaunch')}
            </button>
          </span>
        </PanelNotice>
      ) : null}

      {isPending ? (
        <p className="flex items-center gap-1.5 px-3 py-2 text-xs text-ink-faint">
          <Loader size={11} className="animate-spin" />
          {t('terminal.loading')}
        </p>
      ) : null}

      {terminals?.length === 0 ? (
        <TerminalsEmpty inWorktree={inWorktree} opening={open.isPending} onNew={() => openNew()} />
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
