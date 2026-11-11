import { CircleDot, RefreshCw, Save, Shapes } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Banner, Button, Card, CardBody, CardHeader, Field } from '@solera/ui'
import { ApiRequestError } from '../../lib/api'
import { locale, useTranslate } from '../../lib/i18n'
import { useIssueSource, usePollIssueSource, useSetIssueSource } from '../../lib/issues'
import { useProjectPrototypes, useUpdateProject } from '../../lib/projects'
import { PathField } from '../PathField'

/*
 * Réglages › Intégrations, tels qu'ils étaient sur l'ancienne page : des cartes, posées
 * telles quelles dans la nouvelle (`kind: 'bare'`). Elles deviennent des rangées avec
 * #245.
 */

/**
 * Le design system lié : un dossier qui porte un `.storybook/`, dont les agents du
 * projet lisent les composants par le serveur MCP au lieu d'en inventer.
 *
 * Une carte à part et non une ligne des réglages : se lier ou se délier n'a rien à voir
 * avec renommer le projet, et ne doit pas attendre le même bouton.
 */
export function ProjectDesignSystem({
  projectId,
  initialPath,
}: {
  projectId: string
  initialPath: string | null
}) {
  const t = useTranslate()
  const update = useUpdateProject()
  const [path, setPath] = useState(initialPath ?? '')

  useEffect(() => {
    setPath(initialPath ?? '')
  }, [projectId, initialPath])

  const trimmed = path.trim()
  const dirty = trimmed !== (initialPath ?? '')
  const error = update.error instanceof ApiRequestError ? update.error.message : null

  return (
    <Card>
      <CardHeader
        title={t('project.designSystem.title')}
        description={t('project.designSystem.description')}
        icon={<Shapes size={16} />}
      />
      <CardBody className="flex flex-col gap-4">
        <PathField
          label={t('project.designSystem.path')}
          value={path}
          onChange={setPath}
          placeholder={t('project.designSystem.path.placeholder')}
          hint={t('project.designSystem.path.hint')}
        />

        {error ? <Banner>{error}</Banner> : null}

        <div className="flex flex-wrap items-center gap-2">
          <Button
            disabled={!dirty || !trimmed || update.isPending}
            icon={<Save size={16} />}
            onClick={() => update.mutate({ id: projectId, designSystemPath: trimmed })}
          >
            {t('project.designSystem.save')}
          </Button>
          {dirty ? (
            <Button
              variant="ghost"
              onClick={() => {
                update.reset()
                setPath(initialPath ?? '')
              }}
            >
              {t('project.settings.cancel')}
            </Button>
          ) : initialPath ? (
            <Button
              variant="ghost"
              disabled={update.isPending}
              onClick={() => update.mutate({ id: projectId, designSystemPath: null })}
            >
              {t('project.designSystem.unlink')}
            </Button>
          ) : null}
        </div>

        {initialPath ? <PrototypeCandidates projectId={projectId} /> : null}
      </CardBody>
    </Card>
  )
}

/**
 * Le dépôt GitHub dont les issues entrent dans le board (#84), en cartes non acceptées.
 *
 * Une seule source par projet. Rien ne sort vers GitHub que l'état des cartes venues de
 * ses issues : terminée ferme l'issue, abandonnée la ferme comme non prévue, refusée la
 * ferme avec un mot.
 */
export function ProjectIssueSource({ projectId }: { projectId: string }) {
  const t = useTranslate()
  const { data: source } = useIssueSource(projectId)
  const setSource = useSetIssueSource(projectId)
  const poll = usePollIssueSource(projectId)
  const current = source?.repository ?? ''
  const [repository, setRepository] = useState(current)

  useEffect(() => {
    setRepository(current)
  }, [projectId, current])

  const trimmed = repository.trim()
  const dirty = trimmed !== current
  const error = setSource.error instanceof ApiRequestError ? setSource.error.message : null

  return (
    <Card>
      <CardHeader
        title={t('project.issues.title')}
        description={t('project.issues.description')}
        icon={<CircleDot size={16} />}
      />
      <CardBody className="flex flex-col gap-4">
        <Field
          label={t('project.issues.repository')}
          hint={t('project.issues.repository.hint')}
          value={repository}
          onChange={(event) => setRepository(event.target.value)}
          placeholder={t('project.issues.repository.placeholder')}
          spellCheck={false}
          autoComplete="off"
        />

        {error ? <Banner>{error}</Banner> : null}
        {source?.error ? <Banner>{t('project.issues.pollError', { error: source.error })}</Banner> : null}
        {source && !source.error ? (
          <p className="text-sm text-ink-faint">
            {source.polledAt
              ? t('project.issues.status', {
                  count: source.cardCount,
                  date: new Date(source.polledAt).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' }),
                })
              : t('project.issues.waiting')}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <Button
            disabled={!dirty || !trimmed || setSource.isPending}
            icon={<Save size={16} />}
            onClick={() => setSource.mutate(trimmed)}
          >
            {t('project.issues.save')}
          </Button>
          {dirty ? (
            <Button variant="ghost" onClick={() => { setSource.reset(); setRepository(current) }}>
              {t('project.settings.cancel')}
            </Button>
          ) : source ? (
            <>
              <Button variant="ghost" icon={<RefreshCw size={16} />} disabled={poll.isPending} onClick={() => poll.mutate()}>
                {t('project.issues.poll')}
              </Button>
              <Button variant="ghost" disabled={setSource.isPending} onClick={() => setSource.mutate(null)}>
                {t('project.issues.unlink')}
              </Button>
            </>
          ) : null}
        </div>
      </CardBody>
    </Card>
  )
}

/**
 * Ce que les agents ont dû créer faute de le trouver dans le DS (carte #63) : des
 * composants qui restent dans les prototypes de ce projet tant que personne n'a décidé
 * s'ils entrent dans le DS, s'ils étaient un accident, ou s'il faut les recomposer.
 */
function PrototypeCandidates({ projectId }: { projectId: string }) {
  const t = useTranslate()
  const { data } = useProjectPrototypes(projectId, true)
  if (!data || data.candidates.length === 0) return null

  return (
    <div className="flex flex-col gap-2 border-t border-line pt-4">
      <p className="text-sm font-medium">{t('project.designSystem.candidates')}</p>
      <p className="text-xs text-ink-faint">{t('project.designSystem.candidates.hint')}</p>
      <ul className="flex flex-col gap-1">
        {data.candidates.map((candidate) => (
          <li key={candidate.path} className="min-w-0">
            <p className="truncate text-sm">{candidate.name}</p>
            <p className="truncate font-mono text-xs text-ink-faint" title={candidate.path}>
              {candidate.path}
            </p>
          </li>
        ))}
      </ul>
    </div>
  )
}
