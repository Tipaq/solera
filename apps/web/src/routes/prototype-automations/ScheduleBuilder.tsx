/* PROTOTYPE — jetable (branche proto/page-projet). Ne pas fusionner dans main.
 *
 * La planification pour un humain, à la place du cron brut : une règle qui se lit
 * comme une phrase (« Répéter chaque semaine le L J à 03:00 »), dont chaque morceau est
 * un contrôle. Toujours affichés dessous : la phrase en clair, un mois avec les jours de
 * passage, les prochains passages, le fuseau.
 *
 * Il produit la cadence du protocole (`ScheduleCadence` : cron, intervalle, une fois) et
 * sait relire une cadence existante pour se pré-remplir ; ce qu'il ne sait pas relire
 * passe en Personnalisé, le cron tel quel.
 */
import { Check, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { nextScheduleRun, type ScheduleCadence } from '@solera/protocol'
import { Popover, cx } from '@solera/ui'
import { cronToHuman } from '../../lib/cron'
import { locale } from '../../lib/i18n'
import { describeCadence, formatDateTime } from '../../lib/schedules'

const DAY = 24 * 60 * 60_000

export type Frequency = 'once' | 'hours' | 'daily' | 'weekly' | 'monthly' | 'custom'

/** Lundi d'abord, comme on lit une semaine ; la valeur est celle du cron (0 = dimanche). */
const WEEKDAYS: { cron: number; short: string; long: string }[] = [
  { cron: 1, short: 'L', long: 'lundi' },
  { cron: 2, short: 'M', long: 'mardi' },
  { cron: 3, short: 'M', long: 'mercredi' },
  { cron: 4, short: 'J', long: 'jeudi' },
  { cron: 5, short: 'V', long: 'vendredi' },
  { cron: 6, short: 'S', long: 'samedi' },
  { cron: 0, short: 'D', long: 'dimanche' },
]

const MINUTES = [0, 15, 30, 45]

export interface BuilderState {
  frequency: Frequency
  hour: number
  minute: number
  /** Une fois : le jour choisi (minuit local). */
  date: number
  /** Toutes les N heures. */
  every: number
  rangeOn: boolean
  from: number
  to: number
  /** Chaque jour : jours ouvrés seulement. */
  workdays: boolean
  /** Chaque semaine : jours du cron. */
  days: number[]
  /** Chaque mois : 1–31, ou 'L' pour le dernier jour. */
  monthDay: number | 'L'
  cron: string
}

function midnight(ts: number): number {
  const date = new Date(ts)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

export function defaultState(): BuilderState {
  return {
    frequency: 'daily',
    hour: 3,
    minute: 0,
    date: midnight(Date.now() + DAY),
    every: 6,
    rangeOn: false,
    from: 8,
    to: 20,
    workdays: false,
    days: [1],
    monthDay: 1,
    cron: '0 3 * * *',
  }
}

const isInt = (value: string) => /^\d+$/.test(value)

/** Relit une cadence pour pré-remplir le builder ; sinon Personnalisé. */
export function stateFromCadence(cadence: ScheduleCadence | null | undefined): BuilderState {
  const base = defaultState()
  if (!cadence) return base
  if (cadence.kind === 'once') {
    const at = new Date(cadence.at)
    return { ...base, frequency: 'once', date: midnight(cadence.at), hour: at.getHours(), minute: at.getMinutes() }
  }
  if (cadence.kind === 'interval') {
    if (cadence.minutes % 60 === 0) return { ...base, frequency: 'hours', every: Math.max(1, cadence.minutes / 60) }
    return { ...base, frequency: 'custom', cron: `*/${cadence.minutes} * * * *` }
  }
  const expression = cadence.expression.trim()
  const parts = expression.split(/\s+/)
  const custom = { ...base, frequency: 'custom' as const, cron: expression }
  if (parts.length !== 5) return custom
  const [min, hour, dom, month, dow] = parts as [string, string, string, string, string]
  if (month !== '*') return custom
  // Toutes les N heures, sur une plage ou non : « 0 */6 * * * » ou « 0 8-20/2 * * * ».
  const step = hour.match(/^(\*|(\d+)-(\d+))\/(\d+)$/)
  if (isInt(min) && step && dom === '*' && dow === '*') {
    return step[2]
      ? { ...base, frequency: 'hours', every: Number(step[4]), rangeOn: true, from: Number(step[2]), to: Number(step[3]) }
      : { ...base, frequency: 'hours', every: Number(step[4]) }
  }
  if (!isInt(min) || !isInt(hour)) return custom
  const time = { hour: Number(hour), minute: Number(min) }
  if (dom === '*' && dow === '*') return { ...base, ...time, frequency: 'daily' }
  if (dom === '*' && dow === '1-5') return { ...base, ...time, frequency: 'daily', workdays: true }
  if (dom === '*' && /^[0-7](,[0-7])*$/.test(dow)) {
    return { ...base, ...time, frequency: 'weekly', days: [...new Set(dow.split(',').map((day) => Number(day) % 7))] }
  }
  if (dow === '*' && (isInt(dom) || dom === 'L')) return { ...base, ...time, frequency: 'monthly', monthDay: dom === 'L' ? 'L' : Number(dom) }
  return custom
}

/** La cadence du protocole ; null si le choix est incomplet ou l'expression invalide. */
export function cadenceFromState(state: BuilderState): ScheduleCadence | null {
  const time = `${state.minute} ${state.hour}`
  switch (state.frequency) {
    case 'once': {
      const at = new Date(state.date)
      at.setHours(state.hour, state.minute, 0, 0)
      return { kind: 'once', at: at.getTime() }
    }
    case 'hours':
      return state.rangeOn
        ? { kind: 'cron', expression: `0 ${state.from}-${state.to}/${state.every} * * *` }
        : state.every === 1
          ? { kind: 'interval', minutes: 60 }
          : { kind: 'cron', expression: `0 */${state.every} * * *` }
    case 'daily':
      return { kind: 'cron', expression: `${time} * * ${state.workdays ? '1-5' : '*'}` }
    case 'weekly':
      if (state.days.length === 0) return null
      return { kind: 'cron', expression: `${time} * * ${[...state.days].sort((a, b) => a - b).join(',')}` }
    case 'monthly':
      return { kind: 'cron', expression: `${time} ${state.monthDay} * *` }
    case 'custom':
      return cronToHuman(state.cron, locale()) ? { kind: 'cron', expression: state.cron.trim() } : null
  }
}

/** La phrase en clair, écrite ici pour les cas qu'on construit (plus nette que cronstrue). */
export function sentenceOf(state: BuilderState, cadence: ScheduleCadence | null): string | null {
  if (!cadence) return null
  const at = `${state.hour} h ${String(state.minute).padStart(2, '0')}`
  switch (state.frequency) {
    case 'once':
      return `Une seule fois, le ${new Date(state.date).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })} à ${at}`
    case 'hours':
      return `Toutes les ${state.every === 1 ? 'heures' : `${state.every} heures`}${state.rangeOn ? `, entre ${state.from} h et ${state.to} h` : ''}`
    case 'daily':
      return state.workdays ? `Chaque jour ouvré (lundi à vendredi) à ${at}` : `Chaque jour à ${at}`
    case 'weekly': {
      const names = WEEKDAYS.filter((day) => state.days.includes(day.cron)).map((day) => day.long)
      const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} et ${names[names.length - 1]}` : names[0]
      return `Chaque ${list} à ${at}`
    }
    case 'monthly':
      return state.monthDay === 'L' ? `Le dernier jour de chaque mois à ${at}` : `Le ${state.monthDay === 1 ? '1er' : state.monthDay} de chaque mois à ${at}`
    case 'custom':
      return describeCadence(cadence, (expression) => cronToHuman(expression, locale()))
  }
}

export function upcoming(cadence: ScheduleCadence | null, count: number, horizon = Infinity): number[] {
  if (!cadence) return []
  const out: number[] = []
  let cursor = Date.now()
  try {
    while (out.length < count) {
      const next = nextScheduleRun(cadence, cursor, out[out.length - 1] ?? null)
      if (!next || next > horizon) break
      out.push(next)
      cursor = next + 1
      if (cadence.kind === 'once') break
    }
  } catch {
    /* expression invalide */
  }
  return out
}

const TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone

/* ------------------------------------------------------------------ composant */

/**
 * La règle se lit comme une phrase, façon récurrence d'agenda : « Répéter [chaque
 * semaine ▾] le [L M M J V S D] à [03:00 ▾] ». Chaque morceau entre crochets est un
 * contrôle ; la ligne se plie d'elle-même au téléphone. Dessous, l'aperçu : la phrase en
 * clair, un mois avec les jours de passage, les prochains passages.
 */
export function ScheduleBuilder({
  initial,
  onChange,
  label,
}: {
  initial?: ScheduleCadence | null
  onChange: (cadence: ScheduleCadence | null, sentence: string | null) => void
  /** Titre facultatif au-dessus (« Démarrer », « Arrêter »). */
  label?: string
}) {
  const [state, setState] = useState<BuilderState>(() => stateFromCadence(initial))
  const set = (patch: Partial<BuilderState>) => setState((current) => ({ ...current, ...patch }))
  const cadence = useMemo(() => cadenceFromState(state), [state])
  const sentence = sentenceOf(state, cadence)
  useEffect(() => {
    onChange(cadence, sentence)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cadence ? JSON.stringify(cadence) : null, sentence])

  /* Passer en Personnalisé garde le cron équivalent, pour qu'on parte de ce qu'on voyait. */
  const pickFrequency = (frequency: Frequency) => {
    if (frequency === 'custom' && cadence?.kind === 'cron') set({ frequency, cron: cadence.expression })
    else set({ frequency })
  }

  const time = <TimeButton hour={state.hour} minute={state.minute} onChange={(hour, minute) => set({ hour, minute })} />

  return (
    <div className="flex flex-col gap-4">
      {label ? <span className="text-xs font-medium tracking-wide text-ink-faint uppercase">{label}</span> : null}

      {/* La phrase. `leading-9` garde les contrôles alignés quand la ligne se plie. */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-2 text-sm text-ink-soft">
        {state.frequency !== 'once' && state.frequency !== 'custom' ? <Word>Répéter</Word> : null}
        <FrequencyMenu value={state.frequency} onChange={pickFrequency} />

        {state.frequency === 'once' ? (
          <>
            <Word>le</Word>
            <DateButton value={state.date} onChange={(date) => set({ date })} />
            <Word>à</Word>
            {time}
          </>
        ) : null}

        {state.frequency === 'hours' ? (
          <>
            <EveryButton value={state.every} onChange={(every) => set({ every })} />
            {state.rangeOn ? (
              <>
                <Word>entre</Word>
                <TimeButton hour={state.from} minute={0} hoursOnly onChange={(from) => set({ from, to: Math.max(state.to, from + 1) })} />
                <Word>et</Word>
                <TimeButton hour={state.to} minute={0} hoursOnly onChange={(to) => set({ to: Math.max(to, state.from + 1) })} />
                <Toggle on={false} onClick={() => set({ rangeOn: false })}>toute la journée</Toggle>
              </>
            ) : (
              <Toggle on={false} onClick={() => set({ rangeOn: true })}>+ sur une plage horaire</Toggle>
            )}
          </>
        ) : null}

        {state.frequency === 'daily' ? (
          <>
            <Word>à</Word>
            {time}
            <Toggle on={state.workdays} onClick={() => set({ workdays: !state.workdays })}>jours ouvrés seulement</Toggle>
          </>
        ) : null}

        {state.frequency === 'weekly' ? (
          <>
            <Word>le</Word>
            <WeekdayPills value={state.days} onChange={(days) => set({ days })} />
            <Word>à</Word>
            {time}
          </>
        ) : null}

        {state.frequency === 'monthly' ? (
          <>
            <Word>le</Word>
            <MonthDayButton value={state.monthDay} onChange={(monthDay) => set({ monthDay })} />
            <Word>à</Word>
            {time}
          </>
        ) : null}

        {state.frequency === 'custom' ? (
          <input
            value={state.cron}
            onChange={(event) => set({ cron: event.target.value })}
            spellCheck={false}
            aria-label="Expression cron"
            placeholder="ex. 0 9 * * 1"
            className={cx(
              'h-9 min-w-0 flex-1 basis-48 rounded-md border bg-canvas px-2.5 font-mono text-sm text-ink outline-none placeholder:italic placeholder:text-ink-faint/55 focus:border-accent',
              cadence ? 'border-line hover:border-line-strong' : 'border-critical/60',
            )}
          />
        ) : null}
      </div>

      {state.frequency === 'weekly' && state.days.length === 0 ? <span role="alert" className="-mt-2 text-xs text-critical">Choisis au moins un jour.</span> : null}
      {state.frequency === 'monthly' && typeof state.monthDay === 'number' && state.monthDay > 28 ? (
        <span className="-mt-2 text-xs text-ink-faint">Les mois sans {state.monthDay}, rien ne part : « dernier jour » suit la longueur du mois.</span>
      ) : null}
      {state.frequency === 'custom' ? (
        <span className={cx('-mt-2 text-xs', cadence ? 'text-ink-faint' : 'text-critical')} role={cadence ? undefined : 'alert'}>
          {cadence ? 'minute · heure · jour du mois · mois · jour de la semaine' : 'Il faut 5 champs, par exemple « 0 9 * * 1 » pour chaque lundi à 9 h.'}
        </span>
      ) : null}

      <Preview cadence={cadence} sentence={sentence} />
    </div>
  )
}

/* ------------------------------------------------------------------ la phrase */

function Word({ children }: { children: ReactNode }) {
  return <span className="text-ink-soft">{children}</span>
}

/** Le bouton d'un morceau de la phrase : la valeur, un chevron, la même hauteur partout. */
const PART =
  'inline-flex h-9 items-center gap-1.5 rounded-md border border-line bg-canvas px-2.5 text-sm font-medium text-ink tabular-nums transition-colors hover:border-line-strong aria-expanded:border-accent'

function PartButton({ children, ...rest }: React.ComponentProps<'button'>) {
  return (
    <button type="button" className={PART} {...rest}>
      {children}
      <ChevronDown size={13} className="shrink-0 text-ink-faint" />
    </button>
  )
}

function Toggle({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cx(
        'inline-flex h-9 items-center gap-1.5 rounded-md px-2 text-sm transition-colors',
        on ? 'text-ink' : 'text-ink-faint hover:text-ink',
      )}
    >
      <span className={cx('grid size-4 place-items-center rounded border', on ? 'border-accent bg-accent text-accent-ink' : 'border-line-strong')}>
        {on ? <Check size={11} /> : null}
      </span>
      {children}
    </button>
  )
}

const FREQUENCY_WORDS: Record<Frequency, string> = {
  once: 'Une seule fois',
  hours: 'toutes les…',
  daily: 'chaque jour',
  weekly: 'chaque semaine',
  monthly: 'chaque mois',
  custom: 'Personnalisé (cron)',
}

function FrequencyMenu({ value, onChange }: { value: Frequency; onChange: (next: Frequency) => void }) {
  const [open, setOpen] = useState(false)
  const groups: Frequency[][] = [['once'], ['hours', 'daily', 'weekly', 'monthly'], ['custom']]
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      label="Fréquence"
      side="bottom"
      align="start"
      className="w-56 p-1"
      trigger={<PartButton aria-expanded={open}>{value === 'hours' ? 'toutes les' : FREQUENCY_WORDS[value]}</PartButton>}
    >
      <ul role="listbox" aria-label="Fréquence" className="flex flex-col">
        {groups.map((group, index) => (
          <li key={index} className={cx(index > 0 && 'mt-1 border-t border-line pt-1')}>
            <ul className="flex flex-col">
              {group.map((key) => (
                <li key={key}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={value === key}
                    onClick={() => { onChange(key); setOpen(false) }}
                    className={cx('flex h-9 w-full items-center gap-2 rounded px-2.5 text-left text-sm hover:bg-surface-high', value === key ? 'text-ink' : 'text-ink-soft')}
                  >
                    <span className="first-letter:uppercase">{key === 'hours' ? 'Toutes les N heures' : FREQUENCY_WORDS[key]}</span>
                    {value === key ? <Check size={14} className="ml-auto text-accent" /> : null}
                  </button>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </Popover>
  )
}

const EVERY = [1, 2, 3, 4, 6, 8, 12]

function EveryButton({ value, onChange }: { value: number; onChange: (next: number) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      label="Intervalle"
      side="bottom"
      align="start"
      className="w-48 p-1.5"
      trigger={<PartButton aria-expanded={open}>{value === 1 ? 'heure' : `${value} heures`}</PartButton>}
    >
      <div className="grid grid-cols-4 gap-1">
        {EVERY.map((entry) => (
          <button
            key={entry}
            type="button"
            aria-pressed={value === entry}
            onClick={() => { onChange(entry); setOpen(false) }}
            className={cx('h-8 rounded text-sm tabular-nums', value === entry ? 'bg-accent font-semibold text-accent-ink' : 'text-ink-soft hover:bg-surface-high hover:text-ink')}
          >
            {entry} h
          </button>
        ))}
      </div>
    </Popover>
  )
}

function WeekdayPills({ value, onChange }: { value: number[]; onChange: (next: number[]) => void }) {
  return (
    <span role="group" aria-label="Jours de la semaine" className="inline-flex h-9 items-center gap-0.5 rounded-md border border-line bg-canvas p-0.5">
      {WEEKDAYS.map((day) => {
        const on = value.includes(day.cron)
        return (
          <button
            key={day.cron}
            type="button"
            aria-pressed={on}
            aria-label={day.long}
            title={day.long}
            onClick={() => onChange(on ? value.filter((entry) => entry !== day.cron) : [...value, day.cron])}
            className={cx(
              'grid h-7 w-7 place-items-center rounded text-xs font-semibold transition-colors',
              on ? 'bg-accent text-accent-ink' : 'text-ink-faint hover:bg-surface-high hover:text-ink',
            )}
          >
            {day.short}
          </button>
        )
      })}
    </span>
  )
}

const pad = (value: number) => String(value).padStart(2, '0')

/**
 * L'heure : un bouton « 03:00 » qui ouvre une grille 00–23 et les quarts d'heure. On peut
 * aussi la taper (« 9 », « 9:30 », « 0930 ») dans le champ en tête de la grille.
 */
function TimeButton({ hour, minute, onChange, hoursOnly = false }: {
  hour: number
  minute: number
  onChange: (hour: number, minute: number) => void
  hoursOnly?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState('')
  const commit = () => {
    const match = typed.trim().match(/^(\d{1,2})(?:[:h ]?(\d{2}))?$/)
    if (match) {
      const h = Number(match[1])
      const m = hoursOnly ? 0 : Number(match[2] ?? 0)
      if (h < 24 && m < 60) {
        onChange(h, m)
        setOpen(false)
      }
    }
    setTyped('')
  }
  return (
    <Popover
      open={open}
      onOpenChange={(next) => { setOpen(next); setTyped('') }}
      label="Heure"
      side="bottom"
      align="start"
      className="w-64 p-2"
      trigger={<PartButton aria-expanded={open}>{hoursOnly ? `${hour} h` : `${pad(hour)}:${pad(minute)}`}</PartButton>}
    >
      <div className="flex flex-col gap-2">
        <input
          autoFocus
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); commit() } }}
          placeholder={hoursOnly ? 'ex. 8' : 'ex. 9:30'}
          aria-label="Taper l'heure"
          className="h-8 rounded-md border border-line bg-canvas px-2 text-sm tabular-nums text-ink outline-none placeholder:italic placeholder:text-ink-faint/55 focus:border-accent"
        />
        <div className="grid grid-cols-6 gap-0.5">
          {Array.from({ length: 24 }, (_, h) => (
            <button
              key={h}
              type="button"
              aria-pressed={hour === h}
              onClick={() => { onChange(h, minute); if (hoursOnly) setOpen(false) }}
              className={cx('h-7 rounded text-xs tabular-nums', hour === h ? 'bg-accent font-semibold text-accent-ink' : 'text-ink-soft hover:bg-surface-high hover:text-ink')}
            >
              {pad(h)}
            </button>
          ))}
        </div>
        {hoursOnly ? null : (
          <div className="grid grid-cols-4 gap-0.5 border-t border-line pt-2">
            {MINUTES.map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={minute === m}
                onClick={() => { onChange(hour, m); setOpen(false) }}
                className={cx('h-7 rounded text-xs tabular-nums', minute === m ? 'bg-surface-high font-semibold text-ink' : 'text-ink-faint hover:bg-surface-high hover:text-ink')}
              >
                :{pad(m)}
              </button>
            ))}
          </div>
        )}
      </div>
    </Popover>
  )
}

function MonthDayButton({ value, onChange }: { value: number | 'L'; onChange: (next: number | 'L') => void }) {
  const [open, setOpen] = useState(false)
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      label="Jour du mois"
      side="bottom"
      align="start"
      className="w-64 p-2"
      trigger={<PartButton aria-expanded={open}>{value === 'L' ? 'dernier jour' : value === 1 ? '1er' : value}</PartButton>}
    >
      <div className="grid grid-cols-7 gap-0.5">
        {Array.from({ length: 31 }, (_, index) => index + 1).map((day) => (
          <button
            key={day}
            type="button"
            aria-pressed={value === day}
            onClick={() => { onChange(day); setOpen(false) }}
            className={cx(
              'h-8 rounded text-xs tabular-nums',
              value === day ? 'bg-accent font-semibold text-accent-ink' : day > 28 ? 'text-ink-faint hover:bg-surface-high' : 'text-ink-soft hover:bg-surface-high hover:text-ink',
            )}
          >
            {day}
          </button>
        ))}
        <button
          type="button"
          aria-pressed={value === 'L'}
          onClick={() => { onChange('L'); setOpen(false) }}
          className={cx('col-span-4 h-8 rounded text-xs', value === 'L' ? 'bg-accent font-semibold text-accent-ink' : 'text-ink-soft hover:bg-surface-high hover:text-ink')}
        >
          Dernier jour
        </button>
      </div>
    </Popover>
  )
}

function DateButton({ value, onChange }: { value: number; onChange: (next: number) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      label="Date"
      side="bottom"
      align="start"
      className="w-auto p-2"
      trigger={<PartButton aria-expanded={open}>{new Date(value).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })}</PartButton>}
    >
      <MonthGrid
        pick={value}
        onPick={(day) => { onChange(day); setOpen(false) }}
      />
    </Popover>
  )
}

/* ------------------------------------------------------------------ l'aperçu */

const WEEK_HEAD = ['L', 'M', 'M', 'J', 'V', 'S', 'D']

/**
 * Un mois, qui sert deux fois : pour choisir un jour (Une fois) et pour montrer les jours
 * de passage (l'aperçu). Cellules régulières, jours passés atténués, aujourd'hui cerclé.
 */
function MonthGrid({ pick, onPick, marked }: {
  /** Le jour choisi, quand la grille sert à choisir. */
  pick?: number
  onPick?: (day: number) => void
  /** Les passages à marquer, quand la grille sert à montrer. */
  marked?: Map<number, number>
}) {
  const [month, setMonth] = useState(() => {
    const date = new Date(pick ?? Date.now())
    return new Date(date.getFullYear(), date.getMonth(), 1).getTime()
  })
  const first = new Date(month)
  const offset = (first.getDay() + 6) % 7
  const length = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate()
  const today = midnight(Date.now())
  const shift = (delta: number) => setMonth(new Date(first.getFullYear(), first.getMonth() + delta, 1).getTime())
  return (
    <div className="flex w-[15.5rem] flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="pl-1 text-sm font-medium text-ink first-letter:uppercase">{first.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })}</span>
        <span className="flex">
          <button type="button" aria-label="Mois précédent" onClick={() => shift(-1)} className="grid size-7 place-items-center rounded-md text-ink-faint hover:bg-surface-high hover:text-ink"><ChevronLeft size={15} /></button>
          <button type="button" aria-label="Mois suivant" onClick={() => shift(1)} className="grid size-7 place-items-center rounded-md text-ink-faint hover:bg-surface-high hover:text-ink"><ChevronRight size={15} /></button>
        </span>
      </div>
      <div className="grid grid-cols-7">
        {WEEK_HEAD.map((day, index) => <span key={index} className="grid h-7 place-items-center text-[11px] font-medium text-ink-faint">{day}</span>)}
        {Array.from({ length: offset }, (_, index) => <span key={`o${index}`} />)}
        {Array.from({ length }, (_, index) => {
          const day = new Date(first.getFullYear(), first.getMonth(), index + 1).getTime()
          const past = day < today
          const count = marked?.get(day) ?? 0
          const chosen = pick !== undefined && day === midnight(pick)
          const filled = chosen || count > 0
          const cell = cx(
            'relative mx-auto grid size-8 place-items-center rounded-full text-xs tabular-nums transition-colors',
            filled ? 'bg-accent font-semibold text-accent-ink' : past ? 'text-ink-faint/40' : 'text-ink-soft',
            day === today && !filled && 'ring-1 ring-ink-faint',
            onPick && !past && !filled && 'hover:bg-surface-high hover:text-ink',
          )
          const label = new Date(day).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
          return onPick ? (
            <button key={day} type="button" disabled={past} aria-pressed={chosen} aria-label={label} onClick={() => onPick(day)} className={cell}>
              {index + 1}
            </button>
          ) : (
            <span key={day} title={count ? `${label} · ${count} passage${count > 1 ? 's' : ''}` : undefined} className={cell}>
              {index + 1}
              {count > 1 ? <span className="absolute -top-0.5 -right-0.5 rounded-full bg-ink px-1 text-[9px] leading-tight text-canvas">{count}</span> : null}
            </span>
          )
        })}
      </div>
    </div>
  )
}

/** « demain », « dans 3 j », « dans 5 h » : l'écart d'abord, la date ensuite. */
function relative(at: number): string {
  const delta = at - Date.now()
  const days = Math.round((midnight(at) - midnight(Date.now())) / DAY)
  if (delta < 60 * 60_000) return `dans ${Math.max(1, Math.round(delta / 60_000))} min`
  if (days === 0) return `dans ${Math.round(delta / (60 * 60_000))} h`
  if (days === 1) return 'demain'
  return `dans ${days} j`
}

function Preview({ cadence, sentence }: { cadence: ScheduleCadence | null; sentence: string | null }) {
  const marked = new Map<number, number>()
  for (const at of upcoming(cadence, 400, Date.now() + 62 * DAY)) marked.set(midnight(at), (marked.get(midnight(at)) ?? 0) + 1)
  const next = upcoming(cadence, 5)
  return (
    <div className="flex flex-col gap-4 rounded-md bg-surface/60 px-4 py-3.5">
      <span className={cx('text-sm font-medium', sentence ? 'text-ink' : 'text-ink-faint')}>{sentence ?? 'Règle incomplète.'}</span>
      <div className="flex flex-wrap items-start gap-x-10 gap-y-4">
        <MonthGrid marked={marked} />
        <div className="flex min-w-48 flex-col">
          <span className="flex h-7 items-center text-sm font-medium text-ink">Prochains passages</span>
          {next.length ? (
            <ol className="flex flex-col">
              {next.map((at) => (
                <li key={at} className="flex h-8 items-center gap-3 border-b border-line/60 text-xs last:border-0">
                  <span className="w-16 shrink-0 text-ink-faint">{relative(at)}</span>
                  <span className="tabular-nums text-ink-soft first-letter:uppercase">{formatDateTime(at)}</span>
                </li>
              ))}
            </ol>
          ) : (
            <span className="text-xs text-ink-faint">Aucun.</span>
          )}
          <span className="mt-2 text-[11px] text-ink-faint">Fuseau {TIMEZONE}</span>
        </div>
      </div>
    </div>
  )
}
