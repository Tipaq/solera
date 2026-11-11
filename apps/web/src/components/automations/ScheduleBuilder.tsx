import { Check, ChevronDown } from 'lucide-react'
import { Fragment, useEffect, useMemo, useState, type ComponentProps, type ReactNode } from 'react'
import type { ScheduleCadence } from '@solera/protocol'
import { Menu, MenuRadioGroup, MenuRadioItem, MenuSeparator, MonthGrid, Popover, TimePicker, cx } from '@solera/ui'
import { formatDateTime } from '../../lib/automations'
import { useLocale, useTranslate } from '../../lib/i18n'
import {
  EVERY_HOURS,
  FREQUENCY_GROUPS,
  WEEK,
  cadenceFromState,
  calendarDayOfLocal,
  dayWords,
  hourWords,
  localDayOf,
  localMidnightOf,
  marksOf,
  ordinalWords,
  pluralOf,
  problemOf,
  relativeDay,
  sentenceOf,
  stateFromCadence,
  upcoming,
  weekdayName,
  withFrequency,
  withRange,
  zonedTime,
  type BuilderState,
  type Clock,
  type Frequency,
} from '../../lib/schedule-rule'
import { useServerTimeZone } from '../../lib/schedules'

/**
 * La planification lisible (`actions.md` §1.F) : la règle se lit comme une phrase, façon
 * récurrence d'agenda — « Répéter [chaque semaine ▾] le [L M M J V S D] à [03:00 ▾] ».
 * Chaque morceau entre crochets est un contrôle de même hauteur ; la ligne se plie
 * d'elle-même quand la place manque. Dessous, toujours, l'aperçu : la phrase en clair,
 * un mois avec les jours de passage, les prochains passages et le fuseau du serveur.
 *
 * Elle produit la cadence du protocole et relit une cadence existante pour se
 * pré-remplir (`lib/schedule-rule.ts`). Tout se compte à l'heure du serveur, celle où
 * le daemon lit un motif cron.
 */
export function ScheduleBuilder({
  initial,
  onChange,
  label,
  timeZone: zone,
  now: fixedNow,
}: {
  initial?: ScheduleCadence | null
  /** La cadence, null tant que la règle est incomplète, et sa phrase en clair. */
  onChange: (cadence: ScheduleCadence | null, sentence: string | null) => void
  /** Titre facultatif au-dessus (« Démarrer », « Arrêter »). */
  label?: string
  /** Le fuseau du serveur ; lu de l'instance par défaut. Pour les stories et les tests. */
  timeZone?: string
  /** L'instant présent ; l'horloge par défaut. Pour les stories et les tests. */
  now?: number
}) {
  const t = useTranslate()
  const locale = useLocale()
  const serverZone = useServerTimeZone()
  const timeZone = zone ?? serverZone
  const [mountedAt] = useState(() => Date.now())
  const clock: Clock = useMemo(() => ({ now: fixedNow ?? mountedAt, timeZone }), [fixedNow, mountedAt, timeZone])

  const [state, setState] = useState<BuilderState>(() => stateFromCadence(initial, clock))
  const set = (patch: Partial<BuilderState>) => setState((current) => ({ ...current, ...patch }))
  const cadence = useMemo(() => cadenceFromState(state, clock), [state, clock])
  const problem = problemOf(state, clock)
  const sentence = sentenceOf(state, cadence, t, locale)

  const cadenceKey = cadence ? JSON.stringify(cadence) : null
  useEffect(() => {
    onChange(cadence, sentence)
    // La cadence se compare par valeur : un objet neuf à chaque rendu ne la change pas.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cadenceKey, sentence])

  const time = (
    <TimeButton hour={state.hour} minute={state.minute} onChange={(hour, minute) => set({ hour, minute })} />
  )

  return (
    <div className="flex flex-col gap-4">
      {label ? <span className="text-xs font-medium tracking-wide text-ink-faint uppercase">{label}</span> : null}

      <div className="flex flex-wrap items-center gap-2 text-sm text-ink-soft">
        {state.frequency !== 'once' && state.frequency !== 'custom' ? <Word>{t('scheduleRule.repeat')}</Word> : null}
        <FrequencyMenu value={state.frequency} onChange={(frequency) => setState(withFrequency(state, frequency, clock))} />

        {state.frequency === 'once' ? (
          <>
            <Word>{t('scheduleRule.word.on')}</Word>
            <DateButton state={state} clock={clock} onChange={(date) => set({ date })} />
            <Word>{t('scheduleRule.word.at')}</Word>
            {time}
          </>
        ) : null}

        {state.frequency === 'hours' ? (
          <>
            <EveryButton value={state.every} onChange={(every) => set({ every })} />
            {state.rangeOn ? (
              <>
                <Word>{t('scheduleRule.word.between')}</Word>
                <TimeButton hour={state.from} minute={0} hoursOnly onChange={(from) => setState(withRange(state, { from }))} />
                <Word>{t('scheduleRule.word.and')}</Word>
                <TimeButton hour={state.to} minute={0} hoursOnly onChange={(to) => setState(withRange(state, { to }))} />
                <Toggle on={false} onClick={() => set({ rangeOn: false })}>
                  {t('scheduleRule.range.allDay')}
                </Toggle>
              </>
            ) : (
              <Toggle on={false} onClick={() => set({ rangeOn: true })}>
                {t('scheduleRule.range.add')}
              </Toggle>
            )}
          </>
        ) : null}

        {state.frequency === 'daily' ? (
          <>
            <Word>{t('scheduleRule.word.at')}</Word>
            {time}
            <Toggle on={state.workdays} onClick={() => set({ workdays: !state.workdays })}>
              {t('scheduleRule.workdays')}
            </Toggle>
          </>
        ) : null}

        {state.frequency === 'weekly' ? (
          <>
            <Word>{t('scheduleRule.word.on')}</Word>
            <WeekdayPills value={state.days} onChange={(days) => set({ days })} />
            <Word>{t('scheduleRule.word.at')}</Word>
            {time}
          </>
        ) : null}

        {state.frequency === 'monthly' ? (
          <>
            <Word>{t('scheduleRule.word.on')}</Word>
            <MonthDayButton value={state.monthDay} onChange={(monthDay) => set({ monthDay })} />
            <Word>{t('scheduleRule.word.at')}</Word>
            {time}
          </>
        ) : null}

        {state.frequency === 'custom' ? (
          <input
            value={state.cron}
            onChange={(event) => set({ cron: event.target.value })}
            spellCheck={false}
            aria-label={t('scheduleRule.custom.label')}
            aria-invalid={problem === 'cron' || undefined}
            placeholder={t('scheduleRule.custom.placeholder')}
            className={cx(
              'h-9 min-w-0 flex-1 basis-48 rounded-md border bg-canvas px-2.5 font-mono text-sm text-ink outline-none',
              'placeholder:text-ink-faint placeholder:italic',
              problem === 'cron' ? 'border-critical' : 'border-line hover:border-line-strong focus:border-accent',
            )}
          />
        ) : null}
      </div>

      <Notes state={state} problem={problem} />

      <Preview cadence={cadence} sentence={sentence} clock={clock} />
    </div>
  )
}

/** Ce qui manque, ou ce qu'il faut savoir, sous la phrase. */
function Notes({ state, problem }: { state: BuilderState; problem: ReturnType<typeof problemOf> }) {
  const t = useTranslate()
  if (problem === 'weekdays') return <Note alert>{t('scheduleRule.weekdays.required')}</Note>
  if (problem === 'past') return <Note alert>{t('scheduleRule.date.past')}</Note>
  if (state.frequency === 'custom') {
    return problem === 'cron' ? (
      <Note alert>{t('scheduleRule.custom.invalid')}</Note>
    ) : (
      <Note>{t('scheduleRule.custom.fields')}</Note>
    )
  }
  if (state.frequency === 'monthly' && typeof state.monthDay === 'number' && state.monthDay > 28) {
    return <Note>{t('scheduleRule.monthDay.missing', { day: state.monthDay })}</Note>
  }
  return null
}

function Note({ alert = false, children }: { alert?: boolean; children: ReactNode }) {
  return (
    <span role={alert ? 'alert' : undefined} className={cx('-mt-2 text-xs', alert ? 'text-critical' : 'text-ink-faint')}>
      {children}
    </span>
  )
}

/* ------------------------------------------------------------------ la phrase */

function Word({ children }: { children: ReactNode }) {
  return <span className="text-ink-soft">{children}</span>
}

/** Le bouton d'un morceau de la phrase : la valeur, un chevron, la même hauteur partout. */
const PART = cx(
  'inline-flex h-9 items-center gap-1.5 rounded-md border border-line bg-canvas px-2.5',
  'text-sm font-medium text-ink tabular-nums transition-colors hover:border-line-strong',
  'data-[state=open]:border-accent',
  'focus-visible:outline-2 focus-visible:outline-accent',
)

function PartButton({ children, ...rest }: ComponentProps<'button'>) {
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
        'focus-visible:outline-2 focus-visible:outline-accent',
        on ? 'text-ink' : 'text-ink-faint hover:text-ink',
      )}
    >
      <span
        aria-hidden
        className={cx(
          'grid size-4 place-items-center rounded border',
          on ? 'border-accent bg-accent text-accent-ink' : 'border-line-strong',
        )}
      >
        {on ? <Check size={11} /> : null}
      </span>
      {children}
    </button>
  )
}

const FREQUENCY_KEYS = {
  once: 'scheduleRule.frequency.once',
  hours: 'scheduleRule.frequency.hours',
  daily: 'scheduleRule.frequency.daily',
  weekly: 'scheduleRule.frequency.weekly',
  monthly: 'scheduleRule.frequency.monthly',
  custom: 'scheduleRule.frequency.custom',
} as const

/** La fréquence : un menu en trois groupes, une fois · ce qui se répète · le cron. */
function FrequencyMenu({ value, onChange }: { value: Frequency; onChange: (next: Frequency) => void }) {
  const t = useTranslate()
  return (
    <Menu
      align="start"
      trigger={<PartButton>{t(FREQUENCY_KEYS[value])}</PartButton>}
    >
      <MenuRadioGroup value={value} onValueChange={(next) => onChange(next as Frequency)}>
        {FREQUENCY_GROUPS.map((group, index) => (
          <Fragment key={group[0]}>
            {index > 0 ? <MenuSeparator /> : null}
            {group.map((frequency) => (
              <MenuRadioItem key={frequency} value={frequency}>
                <span className="block first-letter:uppercase">
                  {t(frequency === 'hours' ? 'scheduleRule.frequency.hoursMenu' : FREQUENCY_KEYS[frequency])}
                </span>
              </MenuRadioItem>
            ))}
          </Fragment>
        ))}
      </MenuRadioGroup>
    </Menu>
  )
}

/** Un choix dans une grille qui se referme : intervalle, jour du mois. */
function GridChoice({ on, faint = false, className, ...rest }: ComponentProps<'button'> & { on: boolean; faint?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      className={cx(
        'h-8 rounded text-xs tabular-nums pointer-coarse:h-11',
        'focus-visible:outline-2 focus-visible:outline-accent',
        on
          ? 'bg-accent font-semibold text-accent-ink'
          : faint
            ? 'text-ink-faint hover:bg-surface-high'
            : 'text-ink-soft hover:bg-surface-high hover:text-ink',
        className,
      )}
      {...rest}
    />
  )
}

function EveryButton({ value, onChange }: { value: number; onChange: (next: number) => void }) {
  const t = useTranslate()
  const locale = useLocale()
  const [open, setOpen] = useState(false)
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      label={t('scheduleRule.every.label')}
      side="bottom"
      align="start"
      className="w-48 p-1.5"
      trigger={
        <PartButton>{t(`scheduleRule.everyHours.${pluralOf(value, locale)}`, { count: value })}</PartButton>
      }
    >
      <div className="grid grid-cols-4 gap-1">
        {EVERY_HOURS.map((entry) => (
          <GridChoice
            key={entry}
            on={value === entry}
            onClick={() => {
              onChange(entry)
              setOpen(false)
            }}
          >
            {t('scheduleRule.everyHours.option', { count: entry })}
          </GridChoice>
        ))}
      </div>
    </Popover>
  )
}

function WeekdayPills({ value, onChange }: { value: number[]; onChange: (next: number[]) => void }) {
  const t = useTranslate()
  const locale = useLocale()
  return (
    <span
      role="group"
      aria-label={t('scheduleRule.weekdays.label')}
      className="inline-flex h-9 items-center gap-0.5 rounded-md border border-line bg-canvas p-0.5"
    >
      {WEEK.map((day) => {
        const on = value.includes(day)
        const name = weekdayName(day, locale)
        return (
          <button
            key={day}
            type="button"
            aria-pressed={on}
            aria-label={name}
            title={name}
            onClick={() => onChange(on ? value.filter((entry) => entry !== day) : [...value, day])}
            className={cx(
              'grid size-7 place-items-center rounded text-xs font-semibold uppercase transition-colors',
              'focus-visible:outline-2 focus-visible:outline-accent',
              on ? 'bg-accent text-accent-ink' : 'text-ink-faint hover:bg-surface-high hover:text-ink',
            )}
          >
            {weekdayName(day, locale, 'narrow')}
          </button>
        )
      })}
    </span>
  )
}

const pad = (value: number) => String(value).padStart(2, '0')

/** L'heure : un bouton « 03:00 » qui ouvre le `TimePicker` (champ tapé, grille, quarts d'heure). */
function TimeButton({
  hour,
  minute,
  onChange,
  hoursOnly = false,
}: {
  hour: number
  minute: number
  onChange: (hour: number, minute: number) => void
  hoursOnly?: boolean
}) {
  const t = useTranslate()
  const [open, setOpen] = useState(false)
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      label={t('scheduleRule.time.label')}
      side="bottom"
      align="start"
      className="w-64 p-2"
      trigger={
<PartButton>{hoursOnly ? hourWords(hour, t) : `${pad(hour)}:${pad(minute)}`}</PartButton>
      }
    >
      <TimePicker
        hour={hour}
        minute={minute}
        hoursOnly={hoursOnly}
        onChange={onChange}
        onDone={() => setOpen(false)}
        placeholder={t(hoursOnly ? 'scheduleRule.time.hoursPlaceholder' : 'scheduleRule.time.typePlaceholder')}
      />
    </Popover>
  )
}

function MonthDayButton({ value, onChange }: { value: number | 'L'; onChange: (next: number | 'L') => void }) {
  const t = useTranslate()
  const locale = useLocale()
  const [open, setOpen] = useState(false)
  const pick = (next: number | 'L') => {
    onChange(next)
    setOpen(false)
  }
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      label={t('scheduleRule.monthDay.label')}
      side="bottom"
      align="start"
      className="w-64 p-2"
      trigger={
        <PartButton>
          {value === 'L' ? t('scheduleRule.monthDay.lastShort') : ordinalWords(value, t, locale)}
        </PartButton>
      }
    >
      <div className="grid grid-cols-7 gap-0.5">
        {Array.from({ length: 31 }, (_, index) => index + 1).map((day) => (
          <GridChoice key={day} on={value === day} faint={day > 28} onClick={() => pick(day)}>
            {day}
          </GridChoice>
        ))}
        <GridChoice on={value === 'L'} onClick={() => pick('L')} className="col-span-4">
          {t('scheduleRule.monthDay.last')}
        </GridChoice>
      </div>
    </Popover>
  )
}

/** Le jour d'une règle « une fois » : un mois où les jours passés ne se choisissent pas. */
function DateButton({ state, clock, onChange }: { state: BuilderState; clock: Clock; onChange: (next: BuilderState['date']) => void }) {
  const t = useTranslate()
  const locale = useLocale()
  const [open, setOpen] = useState(false)
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      label={t('scheduleRule.date.label')}
      side="bottom"
      align="start"
      className="w-auto p-2"
      trigger={<PartButton>{dayWords(state.date, locale, 'short')}</PartButton>}
    >
      <MonthGrid
        pick={localMidnightOf(state.date)}
        today={localDayOf(clock.now, clock.timeZone)}
        locale={locale}
        onPick={(day) => {
          onChange(calendarDayOfLocal(day))
          setOpen(false)
        }}
      />
    </Popover>
  )
}

/* ------------------------------------------------------------------ l'aperçu */

/** Le compte d'un jour s'arrête là : un motif à la minute en ferait 1 440. */
const DAY_RUNS = 99

function Preview({ cadence, sentence, clock }: { cadence: ScheduleCadence | null; sentence: string | null; clock: Clock }) {
  const t = useTranslate()
  const locale = useLocale()
  const { now, timeZone } = clock
  const today = localDayOf(now, timeZone)
  const [month, setMonth] = useState(today)

  // Les passages du mois affiché, comptés jour par jour du calendrier du serveur.
  const marked = useMemo(() => {
    const { year, month: shown } = calendarDayOfLocal(month)
    const length = new Date(year, shown, 0).getDate()
    const runs = Array.from({ length }, (_, index) => {
      const start = zonedTime({ year, month: shown, day: index + 1 }, 0, 0, timeZone)
      const end = zonedTime({ year, month: shown, day: index + 2 }, 0, 0, timeZone)
      return upcoming(cadence, DAY_RUNS, { after: Math.max(now, start - 1), horizon: end - 1, timeZone })
    })
    return marksOf(runs.flat(), timeZone)
  }, [cadence, month, now, timeZone])
  const next = useMemo(() => upcoming(cadence, 5, { after: now, timeZone }), [cadence, now, timeZone])

  return (
    <div className="flex flex-col gap-4 rounded-md bg-surface/60 px-4 py-3.5">
      <span className={cx('text-sm font-medium', sentence ? 'text-ink' : 'text-ink-faint')}>
        {sentence ?? t('scheduleRule.preview.incomplete')}
      </span>
      <div className="flex flex-wrap items-start gap-x-10 gap-y-4">
        <MonthGrid
          month={month}
          onMonth={setMonth}
          marked={marked}
          markedLabel={(count) => t(`scheduleRule.preview.passes.${pluralOf(count, locale)}`, { count })}
          today={today}
          locale={locale}
        />
        <div className="flex min-w-48 flex-col">
          <span className="flex h-7 items-center text-sm font-medium text-ink">{t('scheduleRule.preview.next')}</span>
          {next.length ? (
            <ol className="flex flex-col">
              {next.map((at) => (
                <li key={at} className="flex h-8 items-center gap-3 border-b border-line/60 text-xs last:border-0">
                  <span className="w-16 shrink-0 text-ink-faint">{relativeDay(at, now, t, timeZone)}</span>
                  <span className="tabular-nums text-ink-soft first-letter:uppercase">{formatDateTime(at, locale, timeZone)}</span>
                </li>
              ))}
            </ol>
          ) : (
            <span className="text-xs text-ink-faint">{t('scheduleRule.preview.none')}</span>
          )}
          <span className="mt-2 text-meta text-ink-faint">{t('scheduleRule.preview.timeZone', { zone: timeZone })}</span>
        </div>
      </div>
    </div>
  )
}
