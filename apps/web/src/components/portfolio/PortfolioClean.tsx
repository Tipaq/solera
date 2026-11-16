import { Trash2 } from 'lucide-react'
import { createContext, useContext, useMemo, useState, type ReactElement, type ReactNode } from 'react'
import type { ProjectDto } from '@solera/protocol'
import { Menu, MenuItem, MenuLabel } from '@solera/ui'
import { useTranslate } from '../../lib/i18n'
import type { WorkCleanOffer } from '../../lib/portfolio-work'
import { ProjectPip } from '../places/ProjectPip'
import { toolbarButtonClass } from '../toolbar/OneLineToolbar'
import { CleanDialog } from '../travail/CleanDialog'
import { TravailNoticeHost } from '../travail/TravailNotice'

type CleanTarget = WorkCleanOffer<ProjectDto>

const OpenContext = createContext<(target: CleanTarget) => void>(() => {})

/**
 * Le nettoyage au portefeuille (PF-20) : le dialogue de Travail (`CleanDialog`), le seul,
 * ouvert sur **un** projet à la fois. Ses plans, ses retraits et sa base sont ceux d'un
 * dépôt : nettoyer plusieurs projets, c'est confirmer projet par projet, chacun voyant ce
 * qu'il perdrait.
 */
export function PortfolioCleanHost({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<CleanTarget | null>(null)
  return (
    <TravailNoticeHost>
      <OpenContext.Provider value={setTarget}>{children}</OpenContext.Provider>
      <CleanDialog
        key={target?.project.id ?? ''}
        projectId={target?.project.id ?? ''}
        request={target?.request ?? null}
        base={target?.base ?? null}
        onClose={() => setTarget(null)}
        onRemoved={() => {}}
      />
    </TravailNoticeHost>
  )
}

/**
 * Ce qui ouvre le nettoyage : un projet, le dialogue s'ouvre ; plusieurs, un menu les
 * nomme d'abord, chacun avec ce qu'il retire. `trigger` reçoit de quoi ouvrir le seul.
 */
export function CleanChooser({ targets, trigger }: { targets: CleanTarget[]; trigger: (open?: () => void) => ReactElement }) {
  const t = useTranslate()
  const open = useContext(OpenContext)
  if (targets.length === 0) return null
  if (targets.length === 1) return trigger(() => open(targets[0]!))
  return (
    <Menu align="end" trigger={trigger()}>
      <MenuLabel>{t('portfolio.work.cleanWhich')}</MenuLabel>
      {targets.map((target) => (
        <MenuItem key={target.project.id} onSelect={() => open(target)}>
          <span className="flex min-w-0 items-center gap-3">
            <ProjectPip project={target.project} plain className="flex-1" />
            <span className="shrink-0 text-xs tabular-nums text-ink-faint">{target.count}</span>
          </span>
        </MenuItem>
      ))}
    </Menu>
  )
}

/** « Nettoyer · N » de la barre : neutre, il ne se signale que par son compte (T-1.5). */
export function PortfolioCleanButton({ offers }: { offers: CleanTarget[] }) {
  const t = useTranslate()
  const count = useMemo(() => offers.reduce((sum, offer) => sum + offer.count, 0), [offers])
  const label = t('travail.clean.button', { count })
  return (
    <CleanChooser
      targets={offers}
      trigger={(open) => (
        <button type="button" onClick={open} title={t('travail.clean.hint')} aria-label={label} className={toolbarButtonClass(false)}>
          <Trash2 size={13} aria-hidden />
          {/* Au téléphone, la barre n'a la place que du compte. */}
          <span aria-hidden className="tabular-nums sm:hidden">{count}</span>
          <span aria-hidden className="hidden tabular-nums sm:inline">{label}</span>
        </button>
      )}
    />
  )
}
