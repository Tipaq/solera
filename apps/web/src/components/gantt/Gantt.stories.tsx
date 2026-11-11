import type { Meta, StoryObj } from '@storybook/react-vite'
import { useMemo, useRef, useState } from 'react'
import type { CardConversationDto, CardDto } from '@solera/protocol'
import { cx } from '@solera/ui'
import { useMediaQuery } from '../../lib/viewport'
import { CardBar, BAR_H } from './CardBar'
import { AXIS_H, GanttAxis } from './GanttAxis'
import { GanttArrows } from './GanttArrows'
import { GanttGrid, TodayLine } from './GanttGrid'
import { useAxisWidth, useScrollToNow } from './hooks'
import { anchorsOf, chainOf, scaleOf, type Zoom } from './scale'

/** Mercredi 11 novembre 2026, 10 h : les stories ne bougent pas d'un jour à l'autre. */
const NOW = new Date(2026, 10, 11, 10).getTime()
const day = (month: number, date: number) => new Date(2026, month - 1, date).getTime()

const session = (id: string, status: CardConversationDto['status']): CardConversationDto => ({
  id, title: id, agent: 'claude', status, costUsd: 0, worktreeId: null, worktreeName: null, archivedAt: null, createdAt: NOW,
})

function card(number: number, title: string, column: CardDto['column'], createdAt: number, dueAt: number | null, extra: Partial<CardDto> = {}): CardDto {
  return {
    id: `card-${number}`, projectId: 'p', number, title, description: '', column, position: number,
    dueAt, parent: null, milestone: false, children: [], acceptedAt: createdAt, toClarifySince: null, createdBy: 'u1', createdByName: 'Tim', createdAt, updatedAt: createdAt, columnSince: createdAt,
    conversations: [], attachmentCount: 0, noteCount: 0, references: [], referencedBy: [], blocks: [], blockedBy: [], related: [], duplicateOf: null, duplicates: [], issue: null,
    ...extra,
  }
}

const blockedBy = (...cards: CardDto[]) => ({ blockedBy: cards.map(({ id, number, title, column }) => ({ id, number, title, column })) })

const scale201 = card(201, 'Échelle et axe du Gantt', 'done', day(10, 26), day(11, 3))
const bars202 = card(202, 'Barres de cartes et infobulle', 'review', day(11, 2), day(11, 10), blockedBy(scale201))
const arrows203 = card(203, 'Flèches « bloque » et chaîne éclairée au survol', 'in_progress', day(11, 4), day(11, 18), {
  ...blockedBy(scale201), conversations: [session('s203', 'running')],
})
const tip204 = card(204, 'Infobulle bornée à la fenêtre', 'todo', day(11, 5), day(11, 20), {
  ...blockedBy(arrows203), conversations: [session('s204', 'awaiting_input')],
})
const locale205 = card(205, 'Dates dans la langue courante', 'in_progress', day(10, 28), day(11, 6))
const stories206 = card(206, 'Stories du Gantt', 'todo', day(11, 6), null)
const detour207 = card(207, 'Contourner par l’interligne', 'todo', day(11, 3), day(11, 25), blockedBy(locale205))
const axis208 = card(208, 'Axe', 'todo', day(11, 12), day(11, 27))
const edge209 = card(209, 'Un titre long qui sortirait de l’axe passe à gauche de sa barre', 'todo', day(11, 24), day(11, 27))

const CARDS = [scale201, bars202, arrows203, tip204, locale205, stories206, detour207, axis208, edge209]

const ROW = 32
const LIST_WIDE = 296
const LIST_NARROW = 170

/**
 * Les primitives assemblées comme le Gantt détaillé les assemblera : un seul conteneur
 * qui défile dans les deux sens, la liste collée à gauche, l'axe collé en haut, la
 * grille dessous, le trait d'aujourd'hui et les flèches en surcouche.
 */
function Assembled({ zoom, cards, hover = null }: { zoom: Zoom; cards: CardDto[]; hover?: string | null }) {
  const scroller = useRef<HTMLDivElement>(null)
  const narrow = !useMediaQuery('(min-width: 40rem)')
  const listWidth = narrow ? LIST_NARROW : LIST_WIDE
  const [hovered, setHovered] = useState<string | null>(hover)
  const axisWidth = useAxisWidth(scroller, listWidth)
  const scale = useMemo(() => scaleOf(cards, zoom, NOW, axisWidth), [cards, zoom, axisWidth])
  useScrollToNow(scroller, scale, listWidth, NOW)
  const chain = useMemo(() => chainOf(cards, hovered), [cards, hovered])
  const centers = new Map(cards.map((entry, index) => [entry.id, index * ROW + ROW / 2]))
  const height = cards.length * ROW

  return (
    <div ref={scroller} className="h-[26rem] overflow-auto overscroll-contain rounded-lg border border-line">
      <div className="relative" style={{ width: listWidth + scale.width }}>
        <div className="sticky top-0 z-20 flex">
          <div className="sticky left-0 z-30 shrink-0 border-r border-b border-line bg-canvas" style={{ width: listWidth, height: AXIS_H }} />
          <GanttAxis scale={scale} zoom={zoom} now={NOW} inset={listWidth} />
        </div>
        <div className="relative" onMouseLeave={() => setHovered(null)}>
          <div className="absolute top-0" style={{ left: listWidth }}>
            <GanttGrid scale={scale} zoom={zoom} height={height} now={NOW} today={false} />
          </div>
          {cards.map((entry) => {
            const lit = hovered === entry.id
            const dim = chain !== null && !chain.has(entry.id)
            return (
              <div key={entry.id} className={cx('flex', lit && 'bg-accent/[0.07]')} style={{ height: ROW }} onMouseEnter={() => setHovered(entry.id)}>
                <div
                  className={cx('sticky left-0 z-10 flex shrink-0 items-center gap-1.5 border-r border-line px-3 text-sm', lit ? 'bg-surface-high' : 'bg-canvas', dim && 'text-ink-faint')}
                  style={{ width: listWidth }}
                >
                  <span className="shrink-0 text-xs text-ink-faint tabular-nums">#{entry.number}</span>
                  <span className="min-w-0 truncate">{entry.title}</span>
                </div>
                <div className="relative flex-1">
                  <CardBar card={entry} scale={scale} top={(ROW - BAR_H) / 2} onOpen={() => undefined} now={NOW} hovered={lit} dimmed={dim} onHover={setHovered} />
                </div>
              </div>
            )
          })}
          <div className="pointer-events-none absolute top-0 z-[4]" style={{ left: listWidth, height }}>
            <TodayLine scale={scale} height={height} now={NOW} />
          </div>
          <div className="pointer-events-none absolute top-0 z-[5]" style={{ left: listWidth }}>
            <GanttArrows anchors={anchorsOf(cards, centers, scale, NOW)} width={scale.width} height={height} chain={chain} />
          </div>
        </div>
      </div>
    </div>
  )
}

const meta = {
  title: "Composants d'application/Gantt",
  component: Assembled,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          "Les primitives du Gantt (`components/gantt/`), partagées par l'horizon des jalons, le Gantt détaillé et le portefeuille. La géométrie est pure (`scale.ts`) et testée à part.\n\n**L'échelle remplit au moins la largeur** mesurée et ne défile que si la période dépasse ; le zoom semaine garde 30 px par jour, le zoom mois tient dans la largeur. **Une barre** va de la création à l'échéance : pointillé sans échéance, cran rouge et hachures en retard, anneau ambre quand une session attend, point pulsant quand elle tourne. Le titre est dedans s'il y tient, sinon à côté, jamais tronqué. **Au survol**, la chaîne « bloque » s'éclaire et l'infobulle de la carte s'ouvre.",
      },
    },
  },
  args: { zoom: 'week', cards: CARDS },
  argTypes: { zoom: { control: 'inline-radio', options: ['week', 'month'] }, cards: { control: false } },
} satisfies Meta<typeof Assembled>

export default meta
type Story = StoryObj<typeof meta>

/** Zoom semaine : chaque jour, week-ends teintés, aujourd'hui centré. */
export const Semaine: Story = {}

/** Zoom mois : la vue d'ensemble, ajustée à la largeur ; l'étage bas compte les semaines ISO. */
export const Mois: Story = { args: { zoom: 'month' } }

/** Survol de #203 : sa chaîne (#201 en amont, #204 en aval) s'éclaire, le reste s'efface, l'infobulle s'ouvre. */
export const ChaineSurvolee: Story = { args: { hover: arrows203.id } }

/** Une carte qui attend, en retard, avec ses sessions : l'infobulle au complet. */
export const InfobulleEnRetard: Story = {
  args: {
    hover: 'card-210',
    cards: [
      ...CARDS.slice(0, 4),
      card(210, 'Infobulle d’une carte en retard', 'in_progress', day(10, 27), day(11, 4), {
        conversations: [session('s210a', 'awaiting_input'), { ...session('s210b', 'running'), agent: 'codex' }],
      }),
    ],
  },
}
