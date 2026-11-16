import { ImagePlus, Trash2 } from 'lucide-react'
import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PROJECT_CAP_MAX, type ProjectDto } from '@solera/protocol'
import { Banner, Button, ConfirmDialog, Field, cx } from '@solera/ui'
import { ApiRequestError } from '../../lib/api'
import { useTranslate } from '../../lib/i18n'
import { PROJECT_COLORS } from '../../lib/project-colors'
import { useDeleteProject, useRemoveProjectImage, useSetProjectImage } from '../../lib/projects'
import { ProjectAvatar } from '../ProjectAvatar'

/** Un champ de texte d'une rangée de réglages : son libellé est dit à gauche. */
export function SettingInput({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (value: string) => void
}) {
  return <Field hideLabel label={label} value={value} onChange={(event) => onChange(event.target.value)} />
}

/**
 * Le cap du projet : une phrase, sur deux lignes, bornée comme le serveur la borne. Une
 * zone de texte nue, faute de primitive : l'habillage est celui de `Field`.
 */
export function CapField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const t = useTranslate()
  return (
    <textarea
      aria-label={t('projectSettings.item.cap.label')}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      rows={2}
      maxLength={PROJECT_CAP_MAX}
      placeholder={t('projectSettings.item.cap.placeholder')}
      className="w-full resize-none rounded-md border border-line bg-sunken px-3 py-2 text-sm text-ink outline-none transition-colors placeholder:text-ink-faint hover:border-line-strong focus:border-accent disabled:opacity-60"
    />
  )
}

/**
 * Les pastilles de couleur du projet (R-4.5), celle de son avatar quand il n'a pas
 * d'image. La « par défaut » est l'accent du thème ; un anneau marque la choisie.
 */
export function ColorSwatches({ value, onChange }: { value: string | null; onChange: (value: string | null) => void }) {
  const t = useTranslate()
  return (
    <div role="radiogroup" aria-label={t('project.color.title')} className="flex flex-wrap items-center gap-2">
      {PROJECT_COLORS.map((entry) => {
        const selected = value === entry.value
        return (
          <button
            key={entry.value ?? 'default'}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={t(entry.label)}
            title={t(entry.label)}
            onClick={() => onChange(entry.value)}
            className={cx(
              'size-7 shrink-0 rounded-full ring-offset-2 ring-offset-[var(--sg-surface)] transition',
              'focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-60',
              selected ? 'ring-2 ring-ink' : 'hover:ring-2 hover:ring-line-strong',
              entry.value === null && 'bg-accent',
            )}
            style={entry.value ? { background: entry.value } : undefined}
          />
        )
      })}
    </div>
  )
}

/**
 * L'image du projet (R-4.6) : l'envoyer, la remplacer, la retirer. Hors du brouillon,
 * elle part au choix du fichier ; l'avatar montre la couleur du brouillon.
 */
export function ProjectImageControl({ project, color }: { project: ProjectDto; color: string | null }) {
  const t = useTranslate()
  const input = useRef<HTMLInputElement>(null)
  const setImage = useSetProjectImage()
  const removeImage = useRemoveProjectImage()
  const failure = setImage.error ?? removeImage.error
  const error = failure instanceof ApiRequestError ? failure.message : null

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <ProjectAvatar project={{ ...project, color }} className="size-10" />
        <input
          ref={input}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0]
            // Vidé pour que choisir deux fois le même fichier redéclenche l'envoi.
            event.target.value = ''
            if (!file) return
            removeImage.reset()
            setImage.mutate({ id: project.id, file })
          }}
        />
        <Button
          variant="secondary"
          size="sm"
          icon={<ImagePlus size={14} />}
          disabled={setImage.isPending}
          onClick={() => input.current?.click()}
        >
          {t('projectSettings.item.image.change')}
        </Button>
        {project.image ? (
          <Button
            variant="ghost"
            size="sm"
            disabled={removeImage.isPending}
            onClick={() => {
              setImage.reset()
              removeImage.mutate(project.id)
            }}
          >
            {t('project.image.remove')}
          </Button>
        ) : null}
      </div>
      {project.image?.provisional ? <p className="text-xs text-ink-faint">{t('project.image.provisional')}</p> : null}
      {error ? <Banner>{error}</Banner> : null}
    </div>
  )
}

/** Retirer le projet (R-10) : après confirmation, puis retour à l'accueil. */
export function RemoveProject({ project }: { project: ProjectDto }) {
  const t = useTranslate()
  const navigate = useNavigate()
  const remove = useDeleteProject()
  const [confirming, setConfirming] = useState(false)
  const error = remove.error instanceof ApiRequestError ? remove.error.message : null
  return (
    <div className="flex flex-col gap-2">
      <div>
        <Button variant="danger" size="sm" icon={<Trash2 size={14} />} onClick={() => setConfirming(true)}>
          {t('projectSettings.item.remove.label')}
        </Button>
      </div>
      {error ? <Banner>{error}</Banner> : null}
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t('project.settings.remove.confirm', { name: project.name })}
        confirmLabel={t('projectSettings.item.remove.label')}
        tone="critical"
        busy={remove.isPending}
        onConfirm={() =>
          /* Pas les rappels de `mutate` : l'invalidation des projets démonte la page avant
             qu'ils ne partent, et l'on resterait sur « projet introuvable ». */
          remove
            .mutateAsync(project.id)
            .then(() => navigate('/'))
            .catch(() => setConfirming(false))
        }
      >
        <p>{t('project.settings.remove.notice')}</p>
      </ConfirmDialog>
    </div>
  )
}
