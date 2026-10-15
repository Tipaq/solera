import type { ReactNode } from 'react'
import { NavLink } from 'react-router-dom'
import { TabCount, cx, tabItemClass } from '@solera/ui'

/** Une vue atteignable depuis la rangée. */
export interface ViewTab {
  /** Adresse absolue de la vue. */
  to: string
  label: string
  icon: ReactNode
  /** Compteur après l'intitulé. `undefined` n'occupe pas de place. */
  count?: number
  tone?: 'neutral' | 'caution'
  /** Vrai pour la vue d'arrivée, dont l'adresse est le préfixe de toutes les autres. */
  end?: boolean
}

/**
 * La rangée des vues d'un projet ou du portefeuille, **dans le contenu** et sous la bande.
 *
 * Une navigation de liens, pas une liste d'onglets ARIA : ce qu'elle montre sont des
 * pages, chacune avec son adresse, et un lecteur d'écran doit annoncer « lien » et non
 * « onglet 2 sur 4 » devant quelque chose qui change l'URL. Elle partage son apparence
 * avec `Tabs` par `tabItemClass` — même soulignement, même hauteur, même compteur —
 * parce que c'est le même motif vu par l'œil, et deux apparences pour un motif est
 * exactement ce que le catalogue interdit.
 *
 * Pas dans la bande : la rangée y entrait en concurrence avec le nom du projet et deux
 * boutons, et plafonnait à quatre vues (décision 1 de
 * `docs/audits/2026-10-14-gestion-de-projet/`). Collée aux bords du contenu, sans
 * couloir centré, pour que son bord gauche ne saute pas d'une vue à l'autre.
 *
 * `action` est **l'action de la vue** — *+ Carte*, *+ Tâche* — posée au bout de la
 * rangée. Au doigt elle y reste et défile avec elle : collée à droite, jamais
 * flottante, parce qu'un bouton flottant au-dessus d'un board recouvre une carte.
 */
export function ProjectTabs({ label, tabs, action }: {
  label: string
  tabs: ViewTab[]
  action?: ReactNode
}) {
  return (
    <nav
      aria-label={label}
      /* `gap-5` comme `Tabs` en disposition `start`, et le défilement horizontal au
         doigt : le quatrième onglet coupé net dit qu'il y en a d'autres, sans légende. */
      className="flex shrink-0 items-center gap-5 overflow-x-auto border-b border-line px-4"
    >
      {tabs.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          end={tab.end}
          className={({ isActive }) => cx(tabItemClass(isActive), 'shrink-0')}
        >
          <span className="shrink-0 text-ink-faint">{tab.icon}</span>
          {tab.label}
          {tab.count === undefined || tab.count === 0 ? null : (
            <TabCount count={tab.count} tone={tab.tone} />
          )}
        </NavLink>
      ))}
      {action ? (
        /* `ml-auto` sur un conteneur qui défile ne pousse qu'au-delà de la largeur
           visible : au large l'action est à droite, au doigt elle est au bout de la
           rangée, ce qui est la même règle énoncée deux fois. */
        <span className="ml-auto flex shrink-0 items-center gap-1.5 py-1.5 pl-3">{action}</span>
      ) : null}
    </nav>
  )
}
