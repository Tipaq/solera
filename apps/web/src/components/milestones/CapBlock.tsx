import { Pencil, Plus } from 'lucide-react'
import { useState } from 'react'
import type { ProjectDto } from '@solera/protocol'
import { Button, IconButton } from '@solera/ui'
import { useTranslate } from '../../lib/i18n'
import { useUpdateProject } from '../../lib/projects'

/**
 * Le cap du projet en tête des Jalons (CAP-1..3) : une phrase, facultative, qui dit où
 * va le projet. Elle s'écrit sur place ; Réglages › Général porte le même champ.
 *
 * Enregistrer coupe les espaces ; une phrase vide retire le cap (le serveur fait de même).
 */
export function CapBlock({ project }: { project: Pick<ProjectDto, 'id' | 'cap'> }) {
  const t = useTranslate()
  const update = useUpdateProject()
  const [draft, setDraft] = useState<string | null>(null)
  const cap = project.cap ?? ''

  if (draft !== null) {
    const save = () => update.mutate({ id: project.id, cap: draft.trim() || null }, { onSuccess: () => setDraft(null) })
    return (
      <form
        className="flex flex-col gap-2 rounded-xl border border-line p-3"
        onSubmit={(event) => {
          event.preventDefault()
          save()
        }}
      >
        <textarea
          autoFocus
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          rows={2}
          aria-label={t('milestones.cap.label')}
          placeholder={t('milestones.cap.placeholder')}
          className="w-full resize-none bg-transparent text-base text-ink outline-none placeholder:text-ink-faint"
        />
        <div className="flex items-center gap-2">
          {update.isError ? (
            <p role="alert" className="min-w-0 text-xs text-critical">
              {t('milestones.cap.saveError')}
            </p>
          ) : null}
          <span className="ml-auto flex gap-1.5">
            <Button type="button" size="sm" variant="ghost" disabled={update.isPending} onClick={() => setDraft(null)}>
              {t('milestones.cap.cancel')}
            </Button>
            <Button type="submit" size="sm" disabled={update.isPending}>
              {t('milestones.cap.save')}
            </Button>
          </span>
        </div>
      </form>
    )
  }

  if (!cap) {
    return (
      <button
        type="button"
        onClick={() => setDraft('')}
        className="flex items-center gap-1.5 self-start rounded px-1 text-sm text-ink-faint hover:text-ink"
      >
        <Plus size={14} /> {t('milestones.cap.add')}
      </button>
    )
  }

  return (
    <div className="group flex items-start gap-3">
      <span aria-hidden className="mt-1 h-10 w-0.5 shrink-0 rounded-full bg-accent" />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium tracking-wide text-ink-faint uppercase">{t('milestones.cap.label')}</p>
        <p className="text-lg leading-snug text-ink">{cap}</p>
      </div>
      <IconButton
        label={t('milestones.cap.edit')}
        size="sm"
        onClick={() => setDraft(cap)}
        className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100"
      >
        <Pencil size={14} />
      </IconButton>
    </div>
  )
}
