/**
 * PROTOTYPE JETABLE (#121, #51) — trois variantes de la section unique des demandes,
 * dans la colonne entière, en mode arbre et en mode projet. Tout se règle par l'adresse :
 * `?variant=A|B|C&state=empty|one|mixed|many&mode=tree|project&device=auto|phone&theme=dark|light`.
 *
 * Lancer : `pnpm --filter @solera/web prototype:colonne`, puis `/prototype-colonne.html`.
 * Ne se fusionne pas : il vit sur la branche `prototype/section-demandes`.
 */
import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cx, TooltipProvider, UiLabelsProvider } from '@solera/ui'
import '../../styles/index.css'
import { Column, type CurrentProject, type Mode, type Variant } from './Column'
import { DEMANDS, SCENARIOS, threadOf, type Scenario } from './data'

const VARIANTS: { id: Variant; name: string; tranche: string }[] = [
  { id: 'A', name: 'Le point seul', tranche: 'Le blocage n’est qu’un point ambre ; la ligne est celle du fil.' },
  { id: 'B', name: 'La demande en clair', tranche: 'La ligne dit ce qui est demandé ; l’icône du genre passe en ambre.' },
  { id: 'C', name: 'Le fil bloqué déplié', tranche: 'Un fil bloqué prend deux lignes : le fil, puis ce qu’il attend.' },
  { id: 'D', name: 'Tout dans l’Activité', tranche: 'Un seul bloc : ce qui t’attend en tête, puis non-lus et en cours, coupé à 7 lignes pour le tout ; au doigt, l’en-tête seul.' },
]

function useParam<T extends string>(key: string, fallback: T): [T, (value: T) => void] {
  const read = () => (new URLSearchParams(location.search).get(key) as T | null) ?? fallback
  const [value, setValue] = useState<T>(read)
  const set = (next: T) => {
    const params = new URLSearchParams(location.search)
    params.set(key, next)
    history.replaceState(null, '', `?${params}`)
    setValue(next)
  }
  return [value, set]
}

function Pills<T extends string>({ value, options, onChange }: {
  value: T
  options: { id: T; label: string }[]
  onChange: (value: T) => void
}) {
  return (
    <span className="flex rounded-full bg-white/10 p-0.5">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          onClick={() => onChange(option.id)}
          className={cx('rounded-full px-2.5 py-1 text-xs', value === option.id ? 'bg-white text-black' : 'text-white/80 hover:text-white')}
        >
          {option.label}
        </button>
      ))}
    </span>
  )
}

function Prototype() {
  const [variant, setVariant] = useParam<Variant>('variant', 'A')
  const [state, setState] = useParam<Scenario>('state', 'mixed')
  const [mode, setMode] = useParam<Mode>('mode', 'tree')
  const [device, setDevice] = useParam<'auto' | 'phone'>('device', 'auto')
  const [theme, setTheme] = useParam<'dark' | 'light'>('theme', 'dark')
  const [bar] = useParam<'on' | 'off'>('bar', 'on')
  const [current, setCurrent] = useState<CurrentProject>('solera')
  const [openThread, setOpenThread] = useState('t6')
  const narrow = window.matchMedia('(max-width: 48rem)').matches
  const phone = device === 'phone' || narrow

  useEffect(() => { document.documentElement.dataset.theme = theme }, [theme])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
      const index = VARIANTS.findIndex((entry) => entry.id === variant)
      const next = (index + (event.key === 'ArrowRight' ? 1 : -1) + VARIANTS.length) % VARIANTS.length
      setVariant(VARIANTS[next]!.id)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const demands = DEMANDS[state]
  const info = VARIANTS.find((entry) => entry.id === variant)!
  // Le projet suit la conversation ouverte : en ouvrir une d'ailleurs ramène la colonne.
  const open = (id: string) => {
    setOpenThread(id)
    setCurrent(threadOf(id).projectId)
  }

  const column = (
    <Column
      variant={variant}
      demands={demands}
      mode={mode}
      onMode={setMode}
      current={current}
      onCurrent={setCurrent}
      openThread={openThread}
      onOpenThread={open}
      coarse={phone}
    />
  )

  const cycle = (step: number) => {
    const index = VARIANTS.findIndex((entry) => entry.id === variant)
    setVariant(VARIANTS[(index + step + VARIANTS.length) % VARIANTS.length]!.id)
  }

  return (
    <div className="app-layer flex h-dvh overflow-hidden bg-canvas text-ink">
      {phone && !narrow ? (
        <div className="flex flex-1 items-start justify-center overflow-auto py-6">
          <div data-shot="telephone" className="surface h-[844px] w-[390px] shrink-0 overflow-hidden rounded-[2rem] border border-line shadow-pop">
            {column}
          </div>
        </div>
      ) : phone ? (
        <div data-shot="telephone" className="surface h-full w-full">{column}</div>
      ) : (
        <>
          <aside data-shot="colonne" className="surface h-full w-[16.5rem] shrink-0 border-r border-line">{column}</aside>
          <main className="flex flex-1 flex-col">
            <header className="flex h-13 items-center border-b border-line px-4 text-sm font-medium">
              {threadOf(openThread).title}
            </header>
            <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-ink-faint">
              <div className="max-w-md space-y-2">
                <p className="font-medium text-ink-soft">{info.id} — {info.name}</p>
                <p>{info.tranche}</p>
                <p>Cliquer une demande ou un fil l’ouvre ici ; en mode projet, la colonne suit son projet.</p>
              </div>
            </div>
          </main>
        </>
      )}

      {bar === 'on' ? (
        <div className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 flex-wrap items-center justify-center gap-2 rounded-2xl bg-black/90 px-3 py-2 text-white shadow-pop ring-1 ring-white/20">
          <span className="flex items-center gap-1">
            <button type="button" onClick={() => cycle(-1)} className="rounded-full p-1 hover:bg-white/15" aria-label="Variante précédente"><ChevronLeft size={16} /></button>
            <span className="min-w-40 text-center text-xs font-medium">{info.id} · {info.name}</span>
            <button type="button" onClick={() => cycle(1)} className="rounded-full p-1 hover:bg-white/15" aria-label="Variante suivante"><ChevronRight size={16} /></button>
          </span>
          <Pills value={state} options={SCENARIOS} onChange={setState} />
          <Pills value={mode} options={[{ id: 'tree', label: 'Arbre' }, { id: 'project', label: 'Un projet' }]} onChange={setMode} />
          {narrow ? null : (
            <Pills value={device} options={[{ id: 'auto', label: 'Ordinateur' }, { id: 'phone', label: 'Téléphone' }]} onChange={setDevice} />
          )}
          <Pills value={theme} options={[{ id: 'dark', label: 'Sombre' }, { id: 'light', label: 'Clair' }]} onChange={setTheme} />
        </div>
      ) : null}
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <UiLabelsProvider labels={{ cancel: 'Annuler', selectPlaceholder: 'Choisir…' }}>
      <TooltipProvider>
        <Prototype />
      </TooltipProvider>
    </UiLabelsProvider>
  </StrictMode>,
)
