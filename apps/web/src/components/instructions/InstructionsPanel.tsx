import { Check, Pencil, X } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import {
  MAX_INSTRUCTIONS_CHARS,
  MAX_REPO_INSTRUCTIONS_CHARS,
  REPO_INSTRUCTION_FILES,
  type InstructionsMode,
  type ProjectInstructionsDto,
  type RepoInstructionFile,
} from '@solera/protocol'
import { Banner, Button, ChoiceCards, ConfirmDialog, FoldLine, cx } from '@solera/ui'
import { ApiRequestError } from '../../lib/api'
import { relativeDate } from '../../lib/dates'
import { locale, useTranslate, type MessageKey } from '../../lib/i18n'
import {
  mergedForImport,
  useGlobalInstructions,
  useProjectInstructions,
  useUpdateProjectInstructions,
  useWriteRepoInstructions,
} from '../../lib/instructions'
import {
  alertsOf,
  editTargetOf,
  fileStateOf,
  nonEmptyLines,
  readersOf,
  type CliReading,
  type EditTarget,
  type InstructionsState,
  type RepoFiles,
} from '../../lib/instructions-readers'
import { openSettings } from '../../lib/settings-dialog'
import { AGENT_LABELS, AgentIcon } from '../AgentIcon'
import { Markdown } from '../chat/Markdown'

/**
 * Les consignes du projet dans ses réglages (page projet v2, R-6) : où elles vivent, les
 * fichiers du dépôt, ce que chaque CLI en lit, ce qui manque, et le texte en vigueur.
 *
 * Hors du brouillon de la page (R-3.3) : changer de mode ou enregistrer un texte prend
 * effet tout de suite, par les boutons du bloc.
 */
export function InstructionsPanel({ projectId }: { projectId: string }) {
  const t = useTranslate()
  const { data } = useProjectInstructions(projectId)
  const { data: global } = useGlobalInstructions()
  const update = useUpdateProjectInstructions(projectId)
  const write = useWriteRepoInstructions(projectId)
  if (!data) return <p className="text-sm text-ink-faint">{t('instructions.panel.loading')}</p>
  // Le mode demandé se montre choisi le temps de l'enregistrer.
  const pendingMode = update.isPending ? update.variables?.mode : undefined
  return (
    <InstructionsView
      data={pendingMode ? { ...data, mode: pendingMode } : data}
      global={global?.content ?? ''}
      onMode={(body) => update.mutate(body)}
      onSave={async (target, content) => {
        if (target.kind === 'solera') await update.mutateAsync({ content })
        else await write.mutateAsync({ path: target.path, content })
      }}
      saving={update.isPending || write.isPending}
      error={update.error ?? write.error}
      onEditGlobal={() => openSettings('consignes')}
    />
  )
}

/** Le bloc sans ses données : ce que montrent la page et sa story. */
export function InstructionsView({
  data,
  global,
  onMode,
  onSave,
  saving,
  error,
  onEditGlobal,
}: {
  data: ProjectInstructionsDto
  global: string
  /** `content` accompagne le passage dans Solera quand on y importe les fichiers du dépôt. */
  onMode: (body: { mode: InstructionsMode; content?: string }) => void
  /** Rejette si l'écriture échoue : l'éditeur reste alors ouvert. */
  onSave: (target: EditTarget, content: string) => Promise<void>
  saving: boolean
  error: unknown
  onEditGlobal: () => void
}) {
  const t = useTranslate()
  const [importing, setImporting] = useState(false)
  const files: RepoFiles = Object.fromEntries(data.repoFiles.map((file) => [file.path, file.content]))
  const state: InstructionsState = { mode: data.mode, solera: data.content, files, global }
  const target = editTargetOf(data.mode, files)
  // Ce qu'un passage dans Solera importerait : les fichiers qui ont un contenu à eux, pas
  // un « Voir AGENTS.md » qui ne voudrait plus rien dire une fois les fichiers masqués.
  const importable = data.repoFiles.filter(
    (file) => file.content.trim() && fileStateOf(data.mode, files, file.path).kind !== 'pointer',
  )

  const choose = (mode: InstructionsMode) => {
    if (mode === data.mode) return
    // Passer dans Solera avec un texte vide laisserait les agents sans rien : les
    // fichiers du dépôt leur seraient masqués. On propose d'abord de les importer.
    if (mode === 'solera' && !data.content.trim() && importable.length > 0) setImporting(true)
    else onMode({ mode })
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-2" aria-label={t('instructions.panel.mode')}>
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-sm font-medium text-ink">{t('instructions.panel.mode')}</span>
          {!data.modeChosen ? <span className="text-xs text-ink-faint">{t('instructions.panel.mode.inferred')}</span> : null}
        </div>
        <fieldset disabled={!data.canEdit} className="min-w-0">
          <ChoiceCards<InstructionsMode>
            label={t('instructions.panel.mode')}
            value={data.mode}
            columns={2}
            onChange={choose}
            options={[
              { value: 'repo', label: t('instructions.mode.repo'), hint: t('instructions.panel.mode.repo.hint') },
              { value: 'solera', label: t('instructions.mode.solera'), hint: t('instructions.panel.mode.solera.hint') },
            ]}
          />
        </fieldset>
      </section>

      <RepoFilesList mode={data.mode} files={files} />

      <section className="flex flex-col gap-2" aria-label={t('instructions.panel.readers')}>
        <span className="text-sm font-medium text-ink">{t('instructions.panel.readers')}</span>
        <ReadersTable readings={readersOf(state)} />
        {alertsOf(state).map((alert) => (
          <Banner key={alert.kind} tone="caution">
            {alert.kind === 'diverge'
              ? t('instructions.panel.alert.diverge')
              : t(
                  alert.rename
                    ? 'instructions.panel.alert.missing.rename'
                    : alert.agents.length > 1
                      ? 'instructions.panel.alert.missing.other'
                      : 'instructions.panel.alert.missing.one',
                  { agents: new Intl.ListFormat(locale(), { type: 'conjunction' }).format(alert.agents.map((agent) => AGENT_LABELS[agent])) },
                )}
          </Banner>
        ))}
        <p className="text-xs text-ink-faint">
          {t('instructions.panel.global')}{' '}
          <button type="button" className="text-accent hover:underline" onClick={onEditGlobal}>
            {t('instructions.panel.global.edit')}
          </button>
        </p>
      </section>

      <InstructionsEditor
        // Un autre texte, un autre éditeur : changer de mode referme celui qui était ouvert.
        key={target.kind === 'solera' ? 'solera' : target.path}
        data={data}
        target={target}
        text={target.kind === 'solera' ? data.content : (files[target.path] ?? '')}
        onSave={onSave}
        saving={saving}
        error={error}
      />

      <ConfirmDialog
        open={importing}
        onOpenChange={setImporting}
        title={t('instructions.migrate.title')}
        confirmLabel={t('instructions.migrate.confirm')}
        busy={saving}
        onConfirm={() => {
          onMode({ mode: 'solera', content: mergedForImport(data.content, importable) })
          setImporting(false)
        }}
      >
        <p>{t('instructions.migrate.body', { files: importable.map((file) => file.path).join(', ') })}</p>
        <p>{t('instructions.migrate.body.keep')}</p>
      </ConfirmDialog>
    </div>
  )
}

function linesLabel(t: ReturnType<typeof useTranslate>, count: number): string {
  return t(count === 1 ? 'instructions.panel.file.lines.one' : 'instructions.panel.file.lines.other', { count: String(count) })
}

/** `AGENTS.md` et `CLAUDE.md`, présents ou non, dépliables sur leur contenu brut. */
function RepoFilesList({ mode, files }: { mode: InstructionsMode; files: RepoFiles }) {
  const t = useTranslate()
  const metaOf = (file: RepoInstructionFile): string => {
    const state = fileStateOf(mode, files, file)
    if (state.kind === 'absent') return t('instructions.panel.file.absent')
    if (state.kind === 'pointer') return t('instructions.panel.file.pointer', { file: state.to })
    const lines = linesLabel(t, state.count)
    return state.masked ? t('instructions.panel.file.masked', { lines }) : lines
  }
  return (
    <section className="flex flex-col gap-1.5" aria-label={t('instructions.panel.files')}>
      <span className="text-sm font-medium text-ink">{t('instructions.panel.files')}</span>
      <ul className="flex flex-col">
        {REPO_INSTRUCTION_FILES.map((file) => (
          <FoldLine key={file} title={<span className="font-mono">{file}</span>} meta={metaOf(file)}>
            {files[file] !== undefined ? (
              <pre className="max-h-72 overflow-auto rounded-md bg-sunken px-3 py-2 font-mono text-xs leading-relaxed whitespace-pre-wrap text-ink-soft">
                {files[file]}
              </pre>
            ) : null}
          </FoldLine>
        ))}
      </ul>
    </section>
  )
}

const READER_REASON: Record<Extract<CliReading['project'], { kind: 'missing' }>['reason'], MessageKey> = {
  noFile: 'instructions.panel.readers.noFile',
  codexIgnoresClaude: 'instructions.panel.readers.codexIgnoresClaude',
  soleraEmpty: 'instructions.panel.readers.soleraEmpty',
}

/**
 * CLI × partie globale × partie projet, chacune ✓ ou ✕ avec ce qui est lu, ou pourquoi
 * rien. Une table quand elle tient ; au téléphone, une fiche par CLI, plutôt qu'une
 * table qui défilerait de côté et cacherait la colonne qui compte.
 */
function ReadersTable({ readings }: { readings: CliReading[] }) {
  const t = useTranslate()
  const globalOf = (reading: CliReading) => (
    <YesNo ok={reading.global}>
      {t(reading.global ? 'instructions.panel.readers.global.yes' : 'instructions.panel.readers.global.no')}
    </YesNo>
  )
  const projectOf = (reading: CliReading) => (
    <YesNo ok={reading.project.kind !== 'missing'}>
      {reading.project.kind === 'solera' ? (
        t('instructions.panel.readers.solera')
      ) : reading.project.kind === 'files' ? (
        <span className="font-mono text-code">{reading.project.files.join(' + ')}</span>
      ) : (
        t(READER_REASON[reading.project.reason])
      )}
    </YesNo>
  )
  const cli = (reading: CliReading) => (
    <span className="inline-flex items-center gap-2 text-sm text-ink">
      <AgentIcon agent={reading.agent} size={14} decorative />
      {AGENT_LABELS[reading.agent]}
    </span>
  )
  return (
    <div className="@container">
      <table className="hidden w-full text-left @min-[30rem]:table">
        <thead>
          <tr className="text-xs text-ink-faint">
            <th scope="col" className="py-1.5 pr-4 font-normal">{t('instructions.panel.readers.cli')}</th>
            <th scope="col" className="py-1.5 pr-4 font-normal">{t('instructions.panel.readers.global')}</th>
            <th scope="col" className="py-1.5 pr-4 font-normal">{t('instructions.panel.readers.project')}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line border-t border-line">
          {readings.map((reading) => (
            <tr key={reading.agent}>
              <th scope="row" className="py-2 pr-4 font-normal">{cli(reading)}</th>
              <td className="py-2 pr-4">{globalOf(reading)}</td>
              <td className="py-2 pr-4">{projectOf(reading)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <ul className="flex flex-col divide-y divide-line border-t border-line @min-[30rem]:hidden">
        {readings.map((reading) => (
          <li key={reading.agent} className="flex flex-col gap-1 py-2.5">
            {cli(reading)}
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-1 pl-[22px]">
              <dt className="text-xs text-ink-faint">{t('instructions.panel.readers.global')}</dt>
              <dd>{globalOf(reading)}</dd>
              <dt className="text-xs text-ink-faint">{t('instructions.panel.readers.project')}</dt>
              <dd>{projectOf(reading)}</dd>
            </dl>
          </li>
        ))}
      </ul>
    </div>
  )
}

function YesNo({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <span className={cx('inline-flex items-center gap-1.5 text-sm', ok ? 'text-ink' : 'text-critical')}>
      {ok ? <Check size={14} aria-hidden className="shrink-0 text-positive" /> : <X size={14} aria-hidden className="shrink-0" />}
      {children}
    </span>
  )
}

/** Le texte en vigueur, rendu ; « Modifier » l'ouvre en saisie brute. */
function InstructionsEditor({
  data,
  target,
  text,
  onSave,
  saving,
  error,
}: {
  data: ProjectInstructionsDto
  target: EditTarget
  text: string
  onSave: (target: EditTarget, content: string) => Promise<void>
  saving: boolean
  error: unknown
}) {
  const t = useTranslate()
  const [draft, setDraft] = useState<string | null>(null)
  const title =
    target.kind === 'solera'
      ? t('instructions.panel.target.solera')
      : target.exists
        ? target.path
        : t('instructions.panel.target.create', { file: target.path })
  const meta = [
    linesLabel(t, nonEmptyLines(text)),
    target.kind === 'solera' && data.updatedAt !== null ? relativeDate(data.updatedAt) : null,
  ].filter(Boolean).join(' · ')

  return (
    <section className="flex flex-col gap-2" aria-label={title}>
      <div className="flex min-h-8 flex-wrap items-center gap-x-2">
        <span className="text-sm font-medium whitespace-nowrap text-ink">{title}</span>
        <span className="text-xs whitespace-nowrap text-ink-faint">{meta}</span>
        <span className="ml-auto" />
        {draft === null ? (
          <Button size="sm" variant="ghost" icon={<Pencil size={13} />} onClick={() => setDraft(text)} disabled={!data.canEdit}>
            {t('instructions.panel.edit')}
          </Button>
        ) : null}
      </div>
      {draft !== null ? (
        <div className="flex flex-col gap-2">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            rows={14}
            maxLength={target.kind === 'solera' ? MAX_INSTRUCTIONS_CHARS : MAX_REPO_INSTRUCTIONS_CHARS}
            spellCheck={false}
            aria-label={title}
            placeholder={t('instructions.project.placeholder')}
            className="w-full resize-y rounded-md border border-line bg-sunken px-3 py-2 font-mono text-xs leading-relaxed text-ink outline-none placeholder:font-sans placeholder:text-ink-faint hover:border-line-strong focus:border-accent"
          />
          {error instanceof ApiRequestError ? <Banner>{error.message}</Banner> : null}
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              disabled={saving || draft === text}
              onClick={() => void onSave(target, draft).then(() => setDraft(null), () => undefined)}
            >
              {t(saving ? 'instructions.saving' : 'instructions.save')}
            </Button>
            <Button size="sm" variant="ghost" disabled={saving} onClick={() => setDraft(null)}>
              {t('dialog.cancel')}
            </Button>
          </div>
        </div>
      ) : text.trim() ? (
        <div className="max-h-72 overflow-auto rounded-md border border-line px-4 py-3 text-sm">
          <Markdown text={text} />
        </div>
      ) : (
        <p className="text-sm text-ink-faint">{t('instructions.panel.empty')}</p>
      )}
    </section>
  )
}
