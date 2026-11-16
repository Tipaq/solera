import { useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { CardDto } from '@solera/protocol'
import { Button, Tooltip, cx } from '@solera/ui'
import { announce, readBrief } from '../../lib/brief'
import { useTranslate } from '../../lib/i18n'
import { useAddToMilestone } from '../../lib/milestones'
import { Drawer } from '../shell/Drawer'
import { AttachedPieces } from '../writing/AttachedPieces'
import { BriefField } from '../writing/BriefField'
import { BriefSpotted } from '../writing/BriefSpotted'
import { ComposerFooter, ComposerHeader, SubmitShortcut } from '../writing/ComposerChrome'
import { useBriefAttachments } from '../writing/use-brief-attachments'

/**
 * **Ajouter au jalon** (#196, spec jalons ADD-1..4) : le champ du composer, plus court,
 * dont le texte part à la session d'affinage du jalon. L'agent dit où il le range — en
 * sous-tâches d'une carte, ou en nouvelles cartes — et sa proposition attend le clic
 * dans le résumé d'affinage (AFF-7).
 *
 * Sans session d'affinage, l'envoi ouvre un brouillon de découpage du jalon, le message
 * pré-rempli : c'est là qu'on choisit le CLI. Les fichiers se joignent alors au jalon.
 */
export function AddToMilestoneDrawer({
  open,
  onClose,
  projectId,
  milestone,
  cards,
}: {
  open: boolean
  onClose: () => void
  projectId: string
  milestone: CardDto
  /** Les cartes qu'on peut mentionner. */
  cards: readonly CardDto[]
}) {
  const t = useTranslate()
  const navigate = useNavigate()
  const [text, setText] = useState('')
  const textRef = useRef<HTMLTextAreaElement>(null)
  const attachments = useBriefAttachments(cards, text, setText)
  const reading = useMemo(() => readBrief(text), [text])
  const add = useAddToMilestone(projectId, milestone)
  const empty = !text.trim()

  const submit = () => {
    if (empty || add.isPending) return
    add.mutate(
      { text, links: attachments.links.map((link) => link.url), files: attachments.files.map((piece) => piece.file) },
      {
        onSuccess: ({ open: href }) => {
          setText('')
          attachments.reset()
          onClose()
          if (href) navigate(href)
        },
      },
    )
  }

  const propose = (
    <Button size="sm" disabled={empty || add.isPending} onClick={submit}>
      {t('milestone.add.submit')}
      {empty ? null : <SubmitShortcut />}
    </Button>
  )

  return (
    <Drawer open={open} onClose={onClose} label={t('milestone.add.title')}>
      <div className="flex min-h-0 flex-1 flex-col">
        <ComposerHeader eyebrow={t('milestone.add.title')} onClose={onClose}>
          <h2 className="min-w-0 truncate text-xl leading-tight font-semibold tracking-tight text-ink">
            #{milestone.number} {milestone.title}
          </h2>
        </ComposerHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 pt-2 pb-5">
          <BriefField
            value={text}
            onChange={setText}
            label={t('milestone.add.label')}
            placeholder={t('milestone.add.placeholder')}
            rows={8}
            cards={cards}
            attachments={attachments}
            onSubmitShortcut={submit}
            textRef={textRef}
          />
          <AttachedPieces attachments={attachments} allowInclude={false} />
        </div>
        <ComposerFooter
          info={
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <Tooltip label={t('milestone.add.hintLong')}>
                <span className={cx('min-w-0 truncate text-sm', empty ? 'text-ink-faint' : 'text-ink-soft')}>
                  {empty ? t(announce(reading).key) : t('milestone.add.hint')}
                </span>
              </Tooltip>
              <BriefSpotted reading={reading} attachments={attachments} />
              {add.isError ? (
                <p role="alert" className="text-xs text-critical">
                  {t('milestone.add.failed', { error: add.error.message })}
                </p>
              ) : null}
            </div>
          }
          actions={
            <>
              <Button size="sm" variant="ghost" onClick={onClose}>
                {t('milestone.add.cancel')}
              </Button>
              {empty ? (
                <Tooltip label={t('milestone.add.empty')}>
                  <span tabIndex={0}>{propose}</span>
                </Tooltip>
              ) : (
                propose
              )}
            </>
          }
        />
      </div>
    </Drawer>
  )
}
