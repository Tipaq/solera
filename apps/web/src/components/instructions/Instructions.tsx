import { Eye, Pencil } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  MAX_INSTRUCTIONS_CHARS,
  type InstructionsAuthorDto,
  type ProjectInstructionsMode,
} from '@solera/protocol'
import { ApiRequestError } from '../../lib/api'
import { locale, useTranslate } from '../../lib/i18n'
import { useGlobalInstructions, useSaveGlobalInstructions } from '../../lib/instructions'
import { useUserSettings } from '../../lib/user-settings'
import { Markdown } from '../chat/Markdown'
import { Banner, Button, SegmentedControl, Select } from '@solera/ui'

/**
 * Éditeur d'une partie de consignes : du markdown, un aperçu, un bouton d'enregistrement.
 *
 * Le brouillon suit la version serveur tant qu'on n'y a pas touché : une consigne qu'un
 * agent écrit pendant que la page est ouverte apparaît, sans écraser une saisie en cours.
 */
export function MarkdownEditor({
  value,
  canEdit,
  maxLength,
  placeholder,
  saving,
  error,
  footer,
  onSave,
}: {
  value: string
  canEdit: boolean
  maxLength: number
  placeholder: string
  saving: boolean
  error: unknown
  footer?: ReactNode
  onSave: (content: string) => void
}) {
  const t = useTranslate()
  const [draft, setDraft] = useState<string | null>(null)
  const [preview, setPreview] = useState(!canEdit)
  const text = draft ?? value
  const dirty = draft !== null && draft !== value

  // Enregistré : le brouillon redevient la version serveur.
  useEffect(() => {
    if (draft !== null && draft === value) setDraft(null)
  }, [draft, value])

  return (
    <div className="flex flex-col gap-2">
      {canEdit ? (
        <SegmentedControl
          label={t('board.editor.mode')}
          value={preview ? 'preview' : 'write'}
          onChange={(value) => setPreview(value === 'preview')}
          className="self-end"
          segments={[
            { value: 'write', label: t('board.editor.write'), icon: <Pencil size={14} /> },
            { value: 'preview', label: t('board.editor.preview'), icon: <Eye size={14} /> },
          ]}
        />
      ) : null}

      {preview ? (
        <div className="min-h-40 rounded-md border border-line px-4 py-3 text-sm">
          {text.trim() ? (
            <Markdown text={text} />
          ) : (
            <p className="text-ink-faint">{t('instructions.empty')}</p>
          )}
        </div>
      ) : (
        <textarea
          value={text}
          rows={14}
          maxLength={maxLength}
          placeholder={placeholder}
          spellCheck={false}
          onChange={(event) => setDraft(event.target.value)}
          className="min-h-60 w-full resize-y rounded-md border border-line bg-sunken px-3 py-2 font-mono text-code leading-relaxed text-ink outline-none placeholder:font-sans placeholder:text-ink-faint hover:border-line-strong focus:border-accent"
        />
      )}

      {error instanceof ApiRequestError ? <Banner>{error.message}</Banner> : null}

      <div className="flex flex-wrap items-center gap-3">
        {canEdit ? (
          <>
            <Button size="sm" disabled={!dirty || saving} onClick={() => onSave(text)}>
              {t(saving ? 'instructions.saving' : 'instructions.save')}
            </Button>
            {dirty ? (
              <Button size="sm" variant="ghost" disabled={saving} onClick={() => setDraft(null)}>
                {t('dialog.cancel')}
              </Button>
            ) : null}
          </>
        ) : null}
        <span className="text-xs text-ink-faint">
          {t('instructions.count', { count: text.length.toLocaleString(locale()) })}
        </span>
        {footer}
      </div>
    </div>
  )
}

function AuthorLine({ author, updatedAt }: { author: InstructionsAuthorDto | null; updatedAt: number | null }) {
  const t = useTranslate()
  if (!author || updatedAt === null) return null
  const when = new Date(updatedAt).toLocaleString(locale(), { dateStyle: 'medium', timeStyle: 'short' })
  return (
    <span className="text-xs text-ink-faint">
      {author.kind === 'user' ? (
        t('instructions.author.user', { name: author.name, when })
      ) : (
        <>
          {t('instructions.author.session', { when })}{' '}
          {author.projectId ? (
            <Link
              to={`/p/${author.projectId}/c/${author.conversationId}`}
              className="text-accent hover:underline"
            >
              {author.title ?? t('instructions.author.session.untitled')}
            </Link>
          ) : (
            author.title ?? t('instructions.author.session.untitled')
          )}
        </>
      )}
    </span>
  )
}

/** La partie globale, commune à tous les projets de l'instance. */
export function GlobalInstructions() {
  const t = useTranslate()
  const { data } = useGlobalInstructions()
  const save = useSaveGlobalInstructions()
  if (!data) return null

  return (
    <div className="flex flex-col gap-3">
      {!data.canEdit ? <Banner tone="info">{t('instructions.global.readonly')}</Banner> : null}
      <MarkdownEditor
        value={data.content}
        canEdit={data.canEdit}
        maxLength={MAX_INSTRUCTIONS_CHARS}
        placeholder={t('instructions.global.placeholder')}
        saving={save.isPending}
        error={save.error}
        onSave={(content) => save.mutate(content)}
        footer={<AuthorLine author={data.author} updatedAt={data.updatedAt} />}
      />
    </div>
  )
}

/** Le choix proposé à la création ; `auto` laisse le serveur regarder le dossier. */
export type InstructionsModeChoice = ProjectInstructionsMode

export function InstructionsModeSelect({
  value,
  onChange,
}: {
  value: InstructionsModeChoice
  onChange: (value: InstructionsModeChoice) => void
}) {
  const t = useTranslate()
  return (
    <Select
      label={t('instructions.mode')}
      value={value}
      onChange={onChange}
      options={[
        { value: 'auto', label: t('instructions.mode.auto'), hint: t('instructions.mode.auto.hint') },
        { value: 'solera', label: t('instructions.mode.solera'), hint: t('instructions.mode.solera.hint') },
        { value: 'repo', label: t('instructions.mode.repo'), hint: t('instructions.mode.repo.hint') },
      ]}
    />
  )
}

/**
 * Le choix d'un formulaire de création, qui part du défaut du compte (posé par la
 * visite) tant qu'on n'y a pas touché, et toujours envoyé tel quel : un `auto` choisi
 * doit l'emporter sur un défaut qui dirait autre chose.
 */
export function useInstructionsModeChoice() {
  const { data: settings } = useUserSettings()
  const [chosen, setChosen] = useState<InstructionsModeChoice | null>(null)
  const value = chosen ?? settings?.projectDefaults.instructionsMode ?? 'auto'
  return { value, onChange: setChosen, field: { instructionsMode: value } }
}
