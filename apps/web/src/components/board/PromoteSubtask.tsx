import { useState, type FormEvent } from 'react'
import type { CardDto, CardSubtask } from '@solera/protocol'
import { Button, Field, SwitchRow } from '@solera/ui'
import { usePromoteSubtask } from '../../lib/cards'
import { useTranslate } from '../../lib/i18n'

/**
 * Promouvoir une sous-tâche en carte (#71), sous la description : un titre repris du
 * libellé, et le lien « bloque » proposé, puisque la carte attendait cette sous-tâche.
 *
 * La nouvelle carte est une sœur de celle-ci, sous la même parente : la fiche le dit
 * avant le clic, parce que c'est là qu'on la cherchera sur le board.
 */
export function PromoteSubtask({
  card,
  projectId,
  subtask,
  onClose,
}: {
  card: CardDto
  projectId: string
  subtask: CardSubtask
  onClose: () => void
}) {
  const t = useTranslate()
  const promote = usePromoteSubtask(projectId, card.id)
  const [title, setTitle] = useState(subtask.label)
  const [blocks, setBlocks] = useState(true)

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!title.trim() || promote.isPending) return
    promote.mutate(
      { index: subtask.index, label: subtask.label, title: title.trim(), blocks },
      { onSuccess: onClose },
    )
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 rounded-md border border-line bg-surface p-3">
      <Field
        label={t('board.card.promote.cardTitle')}
        value={title}
        maxLength={200}
        autoFocus
        onChange={(event) => setTitle(event.target.value)}
      />
      <p className="text-meta text-ink-faint">
        {card.parent
          ? t('board.card.promote.sibling', { number: card.parent.number })
          : t('board.card.promote.noParent')}
      </p>
      <SwitchRow checked={blocks} onCheckedChange={setBlocks} label={t('board.card.promote.blocks', { number: card.number })} />
      {promote.isError ? <p role="alert" className="text-sm text-critical">{t('board.card.promote.error')}</p> : null}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" size="sm" disabled={!title.trim() || promote.isPending}>
          {t('board.card.promote.submit')}
        </Button>
      </div>
    </form>
  )
}
