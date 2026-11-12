import { useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Banner, Button, Tooltip, cx } from '@solera/ui'
import { readBrief, titleFromBrief, type BriefReading } from '../../lib/brief'
import { useMilestoneDraft, type MilestoneDraft } from '../../lib/card-drafts'
import { useCards } from '../../lib/cards'
import { useCreateMilestone, type CreatedMilestone } from '../../lib/create-milestone'
import { dayFromInput } from '../../lib/dates'
import { pluralOf } from '../../lib/code-model'
import { useTranslate } from '../../lib/i18n'
import {
  ENTRY_STAGE,
  agentLine,
  gestureBlock,
  milestoneDescription,
  milestoneHref,
  primaryIntent,
  type MilestoneIntent,
} from '../../lib/new-milestone'
import { useCurrentUser } from '../../lib/session'
import { Drawer } from '../shell/Drawer'
import { AttachedPieces } from '../writing/AttachedPieces'
import { BriefField, DueField } from '../writing/BriefField'
import { BriefSpotted } from '../writing/BriefSpotted'
import { ComposerFooter, ComposerHeader, SubmitShortcut } from '../writing/ComposerChrome'
import { useBriefAttachments, type BriefAttachments } from '../writing/use-brief-attachments'
import { MaturityPill } from './MaturityPill'

const EMPTY: MilestoneDraft = { title: '', text: '', due: '' }
const INTENTS: readonly MilestoneIntent[] = ['note', 'refine', 'split']

/** Ce qu'a donné un envoi : le jalon, ce qui n'a pas suivi, et — pour un affinage — où aller. */
export interface MilestoneOutcome extends CreatedMilestone {
  /** La session d'affinage à ouvrir ; `null` pour une idée notée. */
  href: string | null
}

/**
 * Le tiroir **Nouveau jalon** (#193, spec jalons CMP) : un titre tiré du texte, le champ
 * d'écriture et son échéance, les pièces jointes, et un pied qui dit dans quelle étape le
 * jalon entre et ce que fera l'agent, selon le geste qu'on survole.
 *
 * Trois gestes : *Noter l'idée* crée le jalon sans session ; *Affiner avec un agent* et
 * *Découper directement* le créent puis ouvrent sa session d'affinage. Le texte, le titre
 * et l'échéance restent d'une ouverture à l'autre tant qu'ils ne sont pas partis.
 */
export function NewMilestoneDrawer({
  open,
  onClose,
  projectId,
  onDone,
}: {
  open: boolean
  onClose: () => void
  projectId: string
  /** Le jalon est créé : à l'appelant de dire l'idée notée ou d'ouvrir la session. */
  onDone: (outcome: MilestoneOutcome) => void
}) {
  const t = useTranslate()
  // Ici et non dans le contenu, démonté à la fermeture : la suite d'un envoi (ouvrir la
  // session, dire l'idée notée) ne doit pas se perdre. Et on ne ferme pas pendant l'envoi,
  // sinon un second envoi créerait le jalon deux fois.
  const create = useCreateMilestone(projectId)
  const close = () => {
    if (!create.isPending) onClose()
  }
  return (
    <Drawer open={open} onClose={close} label={t('milestones.composer.eyebrow')} width="wide">
      <Composer projectId={projectId} create={create} onClose={close} onDone={onDone} />
    </Drawer>
  )
}

function Composer({
  projectId,
  create,
  onClose,
  onDone,
}: {
  projectId: string
  create: ReturnType<typeof useCreateMilestone>
  onClose: () => void
  onDone: (outcome: MilestoneOutcome) => void
}) {
  const t = useTranslate()
  const { data: cards = [] } = useCards(projectId)
  const { data: user } = useCurrentUser()
  const { draft: stored, setDraft, acknowledge } = useMilestoneDraft(user?.id ?? '', `new:${projectId}`)
  const draft = stored ?? EMPTY
  const write = (patch: Partial<MilestoneDraft>) => {
    const next = { ...draft, ...patch }
    setDraft(next.title || next.text || next.due ? next : null)
  }
  const setText = (text: string) => write({ text })
  const textRef = useRef<HTMLTextAreaElement>(null)
  const attachments = useBriefAttachments(cards, draft.text, setText)
  const reading = useMemo(() => readBrief(draft.text), [draft.text])
  const [hovered, setHovered] = useState<MilestoneIntent | null>(null)
  const derived = reading.words === 0 ? '' : titleFromBrief(draft.text)
  const primary = primaryIntent(reading)

  const submit = (intent: MilestoneIntent) => {
    if (create.isPending || gestureBlock(intent, reading)) return
    const sent = draft
    const joined = attachments.cards.map((card) => ({ card, include: attachments.modeOf(card) === 'include' }))
    const links = attachments.links.map((link) => link.url)
    create.mutate(
      {
        title: sent.title.trim() || derived || t('milestones.composer.untitled'),
        description: milestoneDescription(sent.text, links, t('milestones.composer.links')),
        dueAt: dayFromInput(sent.due),
        references: joined.filter((entry) => !entry.include).map((entry) => entry.card.id),
        included: joined.filter((entry) => entry.include).map((entry) => entry.card.id),
        files: attachments.files.map((piece) => piece.file),
      },
      {
        onSuccess: (created) => {
          acknowledge(sent)
          attachments.reset()
          onClose()
          onDone({
            ...created,
            href:
              intent === 'note'
                ? null
                : milestoneHref(projectId, created.card, intent, {
                    brief: sent.text,
                    cards: joined.map((entry) => ({ number: entry.card.number, include: entry.include })),
                    links,
                  }),
          })
        },
      },
    )
  }

  const gesture = (intent: MilestoneIntent) => {
    const why = gestureBlock(intent, reading)
    const isPrimary = intent === primary
    const button = (
      <Button
        size="sm"
        variant={isPrimary ? undefined : intent === 'note' ? 'ghost' : 'secondary'}
        disabled={why !== null || create.isPending}
        onClick={() => submit(intent)}
      >
        {t(`milestones.composer.gesture.${intent}`)}
        {isPrimary && why === null ? <SubmitShortcut /> : null}
      </Button>
    )
    return (
      <span
        key={intent}
        onMouseEnter={() => setHovered(intent)}
        onMouseLeave={() => setHovered(null)}
        onFocus={() => setHovered(intent)}
        onBlur={() => setHovered(null)}
      >
        {why ? (
          <Tooltip label={t(why)}>
            <span tabIndex={0} className="inline-flex">
              {button}
            </span>
          </Tooltip>
        ) : (
          button
        )}
      </span>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ComposerHeader eyebrow={t('milestones.composer.eyebrow')} onClose={onClose}>
        {/* Le titre, tiré du texte tant qu'on ne le retouche pas. */}
        <input
          value={draft.title}
          onChange={(event) => write({ title: event.target.value })}
          placeholder={derived || t('milestones.composer.untitled')}
          aria-label={t('milestones.composer.titleAria')}
          className={cx(
            'w-full bg-transparent text-xl leading-tight font-semibold tracking-tight text-ink outline-none',
            derived ? 'placeholder:text-ink' : 'placeholder:text-ink-faint/50',
          )}
        />
        <span className="text-xs text-ink-faint">
          {t(derived && !draft.title ? 'milestones.composer.titleDerived' : 'milestones.composer.titleHint')}
        </span>
      </ComposerHeader>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 pt-2 pb-5">
        <BriefField
          value={draft.text}
          onChange={setText}
          label={t('milestones.composer.label')}
          placeholder={t('milestones.composer.placeholder')}
          cards={cards}
          attachments={attachments}
          onSubmitShortcut={() => submit(primary)}
          textRef={textRef}
          aside={<DueField value={draft.due} onChange={(due) => write({ due })} />}
        />
        <AttachedPieces attachments={attachments} allowInclude />
      </div>

      <ComposerFooter
        info={
          // Au moins 16 rem pour la phrase de l'agent : faute de place, les gestes passent dessous.
          <div className="flex min-w-64 flex-1 flex-col gap-1">
            <WhatHappens intent={hovered ?? primary} reading={reading} attachments={attachments} />
            {create.isError ? (
              <p role="alert" className="text-xs text-critical">
                {t('milestones.composer.failed', { error: create.error.message })}
              </p>
            ) : null}
          </div>
        }
        actions={INTENTS.map(gesture)}
      />
    </div>
  )
}

/** À gauche du pied : l'étape d'arrivée, ce que fera l'agent en une ligne, ce qu'il a repéré. */
function WhatHappens({ intent, reading, attachments }: { intent: MilestoneIntent; reading: BriefReading; attachments: BriefAttachments }) {
  const t = useTranslate()
  const line = t(agentLine(intent, reading))
  return (
    <>
      <div className="flex min-w-0 items-center gap-2 text-sm">
        <span className="shrink-0 text-xs text-ink-faint">{t('milestones.composer.entersIn')}</span>
        <MaturityPill maturity={ENTRY_STAGE[intent]} />
        <Tooltip label={reading.words === 0 ? line : `${line} ${t(`milestones.composer.then.${intent}`)}`}>
          <span className="min-w-0 truncate text-ink-soft">{line}</span>
        </Tooltip>
      </div>
      <BriefSpotted reading={reading} attachments={attachments} />
    </>
  )
}

/**
 * Ce que la page dit après un envoi (CMP-13) : l'idée notée, qui attend dans « Plus
 * tard » ; ou un jalon créé dont une pièce n'a pas suivi — la carte existe, rien n'est
 * défait, et la session d'affinage s'ouvre d'ici.
 */
export function MilestoneCreatedNotice({ outcome, onDismiss }: { outcome: MilestoneOutcome; onDismiss: () => void }) {
  const t = useTranslate()
  const { card, failed, href } = outcome
  return (
    <Banner tone={failed ? 'caution' : 'positive'}>
      <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span>
          {failed
            ? t(`milestones.composer.partial.${pluralOf(failed.count)}`, { number: card.number, count: failed.count, error: failed.message })
            : t('milestones.composer.noted', { number: card.number })}
        </span>
        {href ? (
          <Link to={href} className="text-xs underline-offset-2 hover:underline">
            {t('milestones.composer.openSession')}
          </Link>
        ) : null}
        <button type="button" onClick={onDismiss} className="text-xs underline-offset-2 hover:underline">
          {t('milestones.composer.dismiss')}
        </button>
      </span>
    </Banner>
  )
}
