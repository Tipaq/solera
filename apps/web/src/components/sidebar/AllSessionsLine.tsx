import { ArrowRight, MessagesSquare } from 'lucide-react'
import { Link } from 'react-router-dom'

/**
 * La ligne de fin d'une liste de sessions : « Toutes les sessions du projet · N → ».
 *
 * La seule, sous un projet comme sous les fils libres ou l'historique de *Fils* : ce que
 * la colonne ne montre pas — coupé au budget, ou archivé — se lit sur la page
 * `/sessions`, filtrée sur ce groupe. Elle remplace « N autres sessions… », qui
 * dépliait sur place, et la section repliée des archivées. Hors des listes mesurées, la
 * mesure « Ajuster à la hauteur » ne la coupe jamais.
 */
export function AllSessionsLine({ to, label, count, onNavigate }: {
  /** La page `/sessions`, filtrée sur le groupe. */
  to: string
  label: string
  /** Le total du groupe, archivées comprises ; absent, rien n'est compté. */
  count?: number
  onNavigate: () => void
}) {
  return (
    <Link
      to={to}
      onClick={onNavigate}
      className="flex h-11 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-xs text-ink-faint transition-colors hover:bg-surface-high hover:text-ink md:h-8 pointer-coarse:h-11"
    >
      <span className="flex w-4 shrink-0 justify-center"><MessagesSquare size={14} /></span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count !== undefined ? <span className="shrink-0 tabular-nums">{count}</span> : null}
      <ArrowRight size={13} className="shrink-0" />
    </Link>
  )
}
