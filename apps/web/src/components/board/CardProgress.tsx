import type { CardSubtask } from '@solera/protocol'
import { useTranslate } from '../../lib/i18n'

/**
 * L'avancement des sous-tâches d'une carte — c'est-à-dire des `- [ ]` de sa
 * description, qui n'ont pas de table à elles.
 *
 * La barre de la maquette T2 à coût de schéma nul : les agents écrivent déjà ces
 * listes, et rien de neuf ne s'apprend ni à `create_card` ni à l'éditeur. Ce qu'on
 * perd avec elle est un ordre indépendant du texte et toute interrogation SQL sur les
 * sous-tâches, dont personne n'a l'emploi ici.
 */
export function CardProgress({ subtasks }: { subtasks: CardSubtask[] }) {
  const t = useTranslate()
  if (subtasks.length === 0) return null

  const done = subtasks.filter((task) => task.checked).length
  const ratio = done / subtasks.length

  return (
    <div className="flex items-center gap-2">
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={subtasks.length}
        aria-valuenow={done}
        aria-label={t('board.card.subtasks')}
        className="h-1 min-w-16 flex-1 overflow-hidden rounded-full bg-line"
      >
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-200"
          style={{ width: `${Math.round(ratio * 100)}%` }}
        />
      </div>
      <span className="shrink-0 text-meta text-ink-faint">
        {t('board.card.subtasks.count', { done, total: subtasks.length })}
      </span>
    </div>
  )
}
