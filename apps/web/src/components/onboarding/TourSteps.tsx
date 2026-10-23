import {
  BookOpen,
  CalendarClock,
  Columns3,
  FolderTree,
  GitBranch,
  Inbox,
  LayoutGrid,
  ListTree,
  MessagesSquare,
  Milestone,
  NotebookPen,
  PanelRight,
  ScrollText,
  SquareKanban,
} from 'lucide-react'
import { useTranslate } from '../../lib/i18n'
import { Idea, Ideas, StepTitle, useCommit, useGate, type StepProps } from './shell'

/**
 * Les deux étapes qui présentent sans régler : l'écran, puis la façon d'y organiser le
 * travail. Elles nomment les lieux tels que l'interface les nomme, pour qu'on les
 * reconnaisse en sortant de la visite.
 */
export function ScreenStep({ nav }: StepProps) {
  const t = useTranslate()
  useGate(nav, { canContinue: true, laterAllowed: false, skipAllowed: true })
  useCommit(nav, null)

  return (
    <>
      <StepTitle title={t('onboarding.screen.title')} lead={t('onboarding.screen.lead')} />
      <Ideas>
        <Idea icon={<ListTree size={16} />} title={t('onboarding.screen.column')}>
          {t('onboarding.screen.column.body')}
        </Idea>
        <Idea icon={<Inbox size={16} />} title={t('onboarding.screen.awaiting')}>
          {t('onboarding.screen.awaiting.body')}
        </Idea>
        <Idea icon={<MessagesSquare size={16} />} title={t('onboarding.screen.conversation')}>
          {t('onboarding.screen.conversation.body')}
        </Idea>
        <Idea icon={<PanelRight size={16} />} title={t('onboarding.screen.panel')}>
          {t('onboarding.screen.panel.body')}
        </Idea>
        <Idea icon={<GitBranch size={16} />} title={t('onboarding.screen.git')}>
          {t('onboarding.screen.git.body')}
        </Idea>
        <Idea icon={<BookOpen size={16} />} title={t('onboarding.screen.knowledge')}>
          {t('onboarding.screen.knowledge.body')}
        </Idea>
      </Ideas>
    </>
  )
}

export function WorkStep({ nav }: StepProps) {
  const t = useTranslate()
  useGate(nav, { canContinue: true, laterAllowed: false, skipAllowed: true })
  useCommit(nav, null)

  return (
    <>
      <StepTitle title={t('onboarding.work.title')} lead={t('onboarding.work.lead')} />
      <Ideas>
        <Idea icon={<FolderTree size={16} />} title={t('onboarding.work.projects')}>
          {t('onboarding.work.projects.body')}
        </Idea>
        <Idea icon={<SquareKanban size={16} />} title={t('onboarding.work.board')}>
          {t('onboarding.work.board.body')}
        </Idea>
        <Idea icon={<Milestone size={16} />} title={t('onboarding.work.milestones')}>
          {t('onboarding.work.milestones.body')}
        </Idea>
        <Idea icon={<Columns3 size={16} />} title={t('onboarding.work.cards')}>
          {t('onboarding.work.cards.body')}
        </Idea>
        <Idea icon={<ScrollText size={16} />} title={t('onboarding.work.journal')}>
          {t('onboarding.work.journal.body')}
        </Idea>
        <Idea icon={<CalendarClock size={16} />} title={t('onboarding.work.schedules')}>
          {t('onboarding.work.schedules.body')}
        </Idea>
        <Idea icon={<LayoutGrid size={16} />} title={t('onboarding.work.portfolio')}>
          {t('onboarding.work.portfolio.body')}
        </Idea>
        <Idea icon={<NotebookPen size={16} />} title={t('onboarding.work.notes')}>
          {t('onboarding.work.notes.body')}
        </Idea>
      </Ideas>
    </>
  )
}
