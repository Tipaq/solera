import { FileText, Save, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Banner, Button } from '@solera/ui'
import { ApiRequestError } from '../../lib/api'
import { useTranslate } from '../../lib/i18n'
import { useProjectDevcontainer, useSetProjectDevcontainer } from '../../lib/projects'

/**
 * Le dev container du projet (#143) : celui du dépôt, qu'on nomme sans y toucher, ou le
 * `devcontainer.json` que Solera garde hors du dépôt pour un projet qui n'en a pas.
 * Créé depuis un modèle, édité ici, et rien n'est écrit dans le projet.
 *
 * Il agit tout de suite, avec ses propres boutons, hors du brouillon de la page : un
 * fichier entier n'est pas un réglage qu'on compte.
 */
export function ProjectDevcontainer({ projectId }: { projectId: string }) {
  const t = useTranslate()
  const { data } = useProjectDevcontainer(projectId)
  const save = useSetProjectDevcontainer(projectId)
  const [draft, setDraft] = useState<string | null>(null)

  useEffect(() => {
    setDraft(null)
  }, [projectId, data?.managed])

  if (!data) return null
  const error = save.error instanceof ApiRequestError ? save.error.message : null
  const remove = (
    <Button variant="ghost" icon={<Trash2 size={16} />} disabled={save.isPending} onClick={() => save.mutate(null)}>
      {t('project.devcontainer.remove')}
    </Button>
  )

  if (data.repository) {
    return (
      <div className="flex flex-col gap-2 text-sm">
        <p className="text-ink-soft">{t('project.devcontainer.repository', { path: data.repository })}</p>
        {data.managed !== null ? (
          <div className="flex flex-wrap items-center gap-2 text-ink-faint">
            <span>{t('project.devcontainer.repository.shadowed')}</span>
            {remove}
          </div>
        ) : null}
      </div>
    )
  }

  const text = draft ?? data.managed
  return (
    <div className="flex flex-col gap-2 text-sm">
      {text === null ? (
        <>
          <p className="text-ink-soft">{t('project.devcontainer.none')}</p>
          <div>
            <Button variant="secondary" icon={<FileText size={16} />} onClick={() => setDraft(data.template)}>
              {t('project.devcontainer.create')}
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="text-ink-faint">{t('project.devcontainer.hint')}</p>
          <textarea
            value={text}
            rows={12}
            spellCheck={false}
            aria-label={t('project.devcontainer.title')}
            onChange={(event) => setDraft(event.target.value)}
            className="min-h-48 w-full resize-y rounded-md border border-line bg-sunken px-3 py-2 font-mono text-code leading-relaxed text-ink outline-none hover:border-line-strong focus:border-accent"
          />
          {error ? <Banner>{error}</Banner> : null}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              icon={<Save size={16} />}
              disabled={draft === null || draft === data.managed || save.isPending}
              onClick={() => save.mutate(text)}
            >
              {t('project.devcontainer.save')}
            </Button>
            {draft !== null ? (
              <Button
                variant="ghost"
                onClick={() => {
                  save.reset()
                  setDraft(null)
                }}
              >
                {t('project.settings.cancel')}
              </Button>
            ) : (
              remove
            )}
          </div>
        </>
      )}
    </div>
  )
}
