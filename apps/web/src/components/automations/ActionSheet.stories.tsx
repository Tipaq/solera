import type { Meta, StoryObj } from '@storybook/react-vite'
import { Pencil } from 'lucide-react'
import type { ReactNode } from 'react'
import { cx } from '@solera/ui'
import { natureOf, stateSentence, whenWords, type Automation } from '../../lib/automations'
import { locale, useTranslate } from '../../lib/i18n'
import { ActionGesture, quietGestureClass } from './ActionGestures'
import { ActionBlock, ActionBody, ActionChromeProvider, ActionFooter, ActionHeader, Chip } from './ActionSheet'
import { AGENT, NOW, PROPOSED, SERVICE_ON, SeededWorktrees } from './automation-fixtures'

const ignore = () => {}

/** Un détail d'action assemblé des pièces, tel que le tiroir et le panneau le montreront. */
function Sheet({ item, review = false }: { item: Automation; review?: boolean }) {
  const t = useTranslate()
  const sentence = stateSentence(item, NOW, t)
  return (
    <>
      <ActionHeader
        nature={natureOf(item)}
        title={item.label}
        when={whenWords(item, t, locale())}
        extra={review ? <Chip tone="caution">{t('launcher.review.button')}</Chip> : null}
        onClose={ignore}
      />
      <ActionBody>
        <p className="text-sm text-ink-soft">{sentence.text}</p>
        <ActionBlock
          title={t('automation.nature.task')}
          aside={<button type="button" className={quietGestureClass('row')}><Pencil size={12} aria-hidden /></button>}
        >
          <code className="rounded-md bg-surface-high/60 px-2.5 py-2 font-mono text-xs text-ink">
            {item.what === 'agent' ? item.prompt : `$ ${item.command}`}
          </code>
        </ActionBlock>
        <ActionBlock title={t('automation.when.demand')}>
          <p className="text-sm text-ink-soft">{whenWords(item, t, locale()).join(' · ')}</p>
        </ActionBlock>
      </ActionBody>
      <ActionFooter
        left={<button type="button" className={quietGestureClass()}>{t('launcher.gesture.terminal')}</button>}
        right={<ActionGesture item={item} onReview={ignore} onToggleService={ignore} onTerminal={ignore} onLaunch={ignore} />}
      />
    </>
  )
}

function Frame({ inline, children }: { inline: boolean; children: ReactNode }) {
  const t = useTranslate()
  return (
    <SeededWorktrees>
      <ActionChromeProvider value={inline ? { inline: true, backLabel: t('actions.launcher.label'), onBack: ignore } : { inline: false }}>
        <div className={cx('flex h-[30rem] flex-col overflow-hidden rounded-lg border border-line bg-canvas', inline ? 'w-[22rem]' : 'w-[34rem] max-w-full')}>
          {children}
        </div>
      </ActionChromeProvider>
    </SeededWorktrees>
  )
}

const meta = {
  title: "Composants d'application/Actions/Tiroir",
  component: ActionHeader,
  args: { nature: natureOf(SERVICE_ON), title: SERVICE_ON.label, when: [], onClose: ignore },
  parameters: {
    docs: {
      description: {
        component:
          "Les pièces de tous les tiroirs d'une action — détail, éditeur, relecture : l'en-tête (icône de nature, libellé, puces Quoi puis Quand, ✕), le corps qui défile en blocs titrés, le pied collant aux gestes secondaires à gauche et au principal à droite. Dans le panneau d'une conversation (`ActionChromeProvider inline`), les marges se serrent et « ‹ Actions » remplace le ✕.",
      },
    },
  },
} satisfies Meta<typeof ActionHeader>

export default meta
type Story = StoryObj<typeof meta>

/** Dans un tiroir : un service en marche. */
export const Tiroir: Story = { name: 'Tiroir', render: () => <Frame inline={false}><Sheet item={SERVICE_ON} /></Frame> }

/** Une tâche d'agent planifiée : les puces « À la demande » et sa cadence. */
export const Agent: Story = { name: 'Agent planifié', render: () => <Frame inline={false}><Sheet item={AGENT} /></Frame> }

/** Dans le panneau d'une conversation : « ‹ Actions » remonte à la liste. */
export const Panneau: Story = { name: 'Panneau', render: () => <Frame inline><Sheet item={PROPOSED} review /></Frame> }
