import { Pencil, RefreshCw, Unlink } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import type { IssueSourceDto, PrototypeCandidateDto } from '@solera/protocol'
import { Banner, Button, Field } from '@solera/ui'
import { ApiRequestError } from '../../lib/api'
import { relativeDate } from '../../lib/dates'
import { useTranslate } from '../../lib/i18n'
import { useIssueSource, usePollIssueSource, useSetIssueSource } from '../../lib/issues'
import { useUpdateProject } from '../../lib/projects'
import { PathField } from '../PathField'

/*
 * Réglages › Intégrations : des rangées dont le contrôle se lit au repos (le dépôt,
 * le dossier, ou leur absence) et s'ouvre en champ pour changer. Hors du brouillon de la
 * page : se brancher ou se délier écrit tout de suite, avec ses propres boutons.
 */

const errorOf = (error: unknown) => (error instanceof ApiRequestError ? error.message : null)

/**
 * Une valeur d'intégration : lue en mono, ou son absence en gris, avec ses gestes ; en
 * édition, le champ que `editor` rend et Enregistrer / Annuler.
 */
function LinkedValue({
  value,
  empty,
  status,
  editor,
  editLabel,
  linkLabel,
  saveLabel,
  canSave,
  busy,
  error,
  extra,
  onEdit,
  onCancel,
  onSave,
}: {
  value: string | null
  empty: string
  status?: ReactNode
  editor: ReactNode | null
  editLabel: string
  linkLabel: string
  saveLabel: string
  canSave: boolean
  busy: boolean
  error: string | null
  extra?: ReactNode
  onEdit: () => void
  onCancel: () => void
  onSave: () => void
}) {
  const t = useTranslate()
  if (editor) {
    return (
      <div className="flex flex-col gap-2">
        {editor}
        {error ? <Banner>{error}</Banner> : null}
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" disabled={!canSave || busy} onClick={onSave}>
            {saveLabel}
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={onCancel}>
            {t('dialog.cancel')}
          </Button>
        </div>
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-1">
      {value ? (
        <span className="min-w-0 font-mono text-sm break-all text-ink">{value}</span>
      ) : (
        <span className="text-sm text-ink-faint">{empty}</span>
      )}
      {status}
      {error ? <Banner>{error}</Banner> : null}
      <div className="-ml-3 flex flex-wrap items-center">
        <Button size="sm" variant="ghost" icon={<Pencil size={13} />} onClick={onEdit}>
          {value ? editLabel : linkLabel}
        </Button>
        {extra}
      </div>
    </div>
  )
}

/** « N cartes venues de là · lu il y a … », ou l'erreur de la dernière lecture, en rouge. */
export function IssueSourceStatus({ source }: { source: IssueSourceDto }) {
  const t = useTranslate()
  if (source.error) return <span className="text-xs text-critical">{t('project.issues.pollError', { error: source.error })}</span>
  const cards = t(source.cardCount > 1 ? 'projectSettings.issues.cards.other' : 'projectSettings.issues.cards.one', { count: source.cardCount })
  return (
    <span className="text-xs text-ink-faint">
      {source.polledAt ? `${cards} · ${t('projectSettings.issues.read', { when: relativeDate(source.polledAt) })}` : t('project.issues.waiting')}
    </span>
  )
}

/**
 * Forge › Dépôt des issues : le dépôt GitHub dont les issues entrent dans le Tableau
 * (#84), en cartes à accepter. Une seule source par projet.
 */
export function IssueSourceControl({ projectId }: { projectId: string }) {
  const t = useTranslate()
  const { data: source } = useIssueSource(projectId)
  const setSource = useSetIssueSource(projectId)
  const poll = usePollIssueSource(projectId)
  const current = source?.repository ?? ''
  const [draft, setDraft] = useState<string | null>(null)
  const trimmed = draft?.trim() ?? ''

  return (
    <LinkedValue
      value={source?.repository ?? null}
      empty={t('projectSettings.issues.none')}
      status={source ? <IssueSourceStatus source={source} /> : null}
      editor={
        draft !== null ? (
          <Field
            label={t('project.issues.repository')}
            hideLabel
            hint={t('project.issues.repository.hint')}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={t('project.issues.repository.placeholder')}
            spellCheck={false}
            autoComplete="off"
            autoFocus
          />
        ) : null
      }
      editLabel={t('projectSettings.integration.change')}
      linkLabel={t('project.issues.save')}
      saveLabel={t('project.issues.save')}
      canSave={Boolean(trimmed) && trimmed !== current}
      busy={setSource.isPending}
      error={errorOf(setSource.error) ?? errorOf(poll.error)}
      extra={
        source ? (
          <>
            <Button size="sm" variant="ghost" icon={<RefreshCw size={13} />} disabled={poll.isPending} onClick={() => poll.mutate()}>
              {t('project.issues.poll')}
            </Button>
            <Button size="sm" variant="ghost" icon={<Unlink size={13} />} disabled={setSource.isPending} onClick={() => setSource.mutate(null)}>
              {t('project.issues.unlink')}
            </Button>
          </>
        ) : null
      }
      onEdit={() => {
        setSource.reset()
        setDraft(current)
      }}
      onCancel={() => {
        setSource.reset()
        setDraft(null)
      }}
      onSave={() => setSource.mutate(trimmed, { onSuccess: () => setDraft(null) })}
    />
  )
}

/**
 * Design › Design system : le dossier d'un Storybook (un `.storybook/`) dont les agents
 * du projet lisent les composants par le serveur MCP au lieu d'en inventer.
 */
export function DesignSystemControl({ projectId, path }: { projectId: string; path: string | null }) {
  const t = useTranslate()
  const update = useUpdateProject()
  const [draft, setDraft] = useState<string | null>(null)
  const trimmed = draft?.trim() ?? ''

  return (
    <LinkedValue
      value={path}
      empty={t('projectSettings.design.none')}
      editor={
        draft !== null ? (
          <PathField
            hideLabel
            label={t('project.designSystem.path')}
            value={draft}
            onChange={setDraft}
            placeholder={t('project.designSystem.path.placeholder')}
            hint={t('project.designSystem.path.hint')}
          />
        ) : null
      }
      editLabel={t('projectSettings.integration.change')}
      linkLabel={t('project.designSystem.save')}
      saveLabel={t('project.designSystem.save')}
      canSave={Boolean(trimmed) && trimmed !== (path ?? '')}
      busy={update.isPending}
      error={errorOf(update.error)}
      extra={
        path ? (
          <Button
            size="sm"
            variant="ghost"
            icon={<Unlink size={13} />}
            disabled={update.isPending}
            onClick={() => update.mutate({ id: projectId, designSystemPath: null })}
          >
            {t('project.designSystem.unlink')}
          </Button>
        ) : null
      }
      onEdit={() => {
        update.reset()
        setDraft(path ?? '')
      }}
      onCancel={() => {
        update.reset()
        setDraft(null)
      }}
      onSave={() => update.mutate({ id: projectId, designSystemPath: trimmed }, { onSuccess: () => setDraft(null) })}
    />
  )
}

/**
 * Ce que les agents ont dû créer faute de le trouver dans le DS (carte #63) : des
 * composants qui restent dans les prototypes de ce projet tant que personne n'a décidé
 * s'ils entrent dans le DS, s'ils étaient un accident, ou s'il faut les recomposer.
 */
export function PrototypeCandidates({ candidates }: { candidates: PrototypeCandidateDto[] }) {
  return (
    <ul className="flex flex-col gap-1.5">
      {candidates.map((candidate) => (
        <li key={candidate.path} className="min-w-0">
          <p className="truncate text-sm text-ink">{candidate.name}</p>
          <p className="truncate font-mono text-xs text-ink-faint" title={candidate.path}>
            {candidate.path}
          </p>
        </li>
      ))}
    </ul>
  )
}
