import { AlarmClock, Bot, ChevronDown, Plus, Server, SquareTerminal } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Button, Popover } from '@solera/ui'
import type { NewActionKind } from '../../lib/action-panel'
import { useTranslate, type MessageKey } from '../../lib/i18n'

const ENTRIES: { kind: Exclude<NewActionKind, 'any'>; icon: ReactNode; title: MessageKey; hint: MessageKey }[] = [
  { kind: 'command', icon: <SquareTerminal size={15} />, title: 'actionsTab.new.command', hint: 'actionsTab.new.commandHint' },
  { kind: 'service', icon: <Server size={15} />, title: 'actionsTab.new.service', hint: 'actionsTab.new.serviceHint' },
  { kind: 'agent', icon: <Bot size={15} />, title: 'actionsTab.new.agent', hint: 'actionsTab.new.agentHint' },
  { kind: 'schedule', icon: <AlarmClock size={15} />, title: 'actionsTab.new.schedule', hint: 'actionsTab.new.scheduleHint' },
]

/**
 * « + Action ▾ » (AO-6) : la nature d'abord — une commande, un service, une tâche
 * d'agent — ou planifier une action qui existe déjà. Chaque entrée dit en une ligne ce
 * qu'elle crée.
 */
export function NewActionMenu({ onPick }: { onPick: (kind: NewActionKind) => void }) {
  const t = useTranslate()
  const [open, setOpen] = useState(false)
  const pick = (kind: NewActionKind) => {
    setOpen(false)
    onPick(kind)
  }
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      label={t('actionsTab.new.label')}
      side="bottom"
      align="end"
      className="w-72 p-1"
      trigger={
        <Button size="sm" icon={<Plus size={14} />} aria-label={t('actionsTab.new.label')}>
          {t('actionsTab.new.button')} <ChevronDown size={13} className="-mr-1" aria-hidden />
        </Button>
      }
    >
      {ENTRIES.map((entry) => (
        <div key={entry.kind}>
          {entry.kind === 'schedule' ? <div className="my-1 border-t border-line" /> : null}
          <button
            type="button"
            onClick={() => pick(entry.kind)}
            className="flex min-h-11 w-full items-start gap-2.5 rounded-md px-2.5 py-2 text-left hover:bg-surface-high focus-visible:outline-2 focus-visible:outline-accent"
          >
            <span aria-hidden className="mt-0.5 shrink-0 text-ink-soft">{entry.icon}</span>
            <span className="flex min-w-0 flex-col">
              <span className="text-sm text-ink">{t(entry.title)}</span>
              <span className="text-xs text-ink-faint">{t(entry.hint)}</span>
            </span>
          </button>
        </div>
      ))}
    </Popover>
  )
}
