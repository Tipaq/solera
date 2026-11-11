/* PROTOTYPE — jetable (branche proto/page-projet). Ne pas fusionner dans main. */
import { Check, ChevronDown, ChevronUp, MessageSquare, X } from 'lucide-react'
import { useEffect, useState } from 'react'

/**
 * Le verdict de Tim sur une variante : approuvée, refusée, et une note libre.
 * Mémorisé dans ce navigateur, sous `proto-verdict:<scope>:<variante>`.
 *
 * Usage : `<PrototypeVerdict scope="jalons" variant={current} />`, à côté du
 * `PrototypeSwitcher`. Le récapitulatif liste tous les verdicts posés, toutes pages
 * confondues.
 */
type Status = 'approved' | 'rejected' | null
interface Verdict {
  status: Status
  note: string
}

const PREFIX = 'proto-verdict:'
const EVENT = 'proto-verdict-change'

function keyOf(scope: string, variant: string) {
  return `${PREFIX}${scope}:${variant}`
}

function read(key: string): Verdict {
  try {
    const raw = localStorage.getItem(key)
    if (raw) return JSON.parse(raw) as Verdict
  } catch {
    /* rien */
  }
  return { status: null, note: '' }
}

function write(key: string, verdict: Verdict) {
  if (verdict.status === null && verdict.note.trim() === '') localStorage.removeItem(key)
  else localStorage.setItem(key, JSON.stringify(verdict))
  window.dispatchEvent(new Event(EVENT))
}

function allVerdicts(): { scope: string; variant: string; verdict: Verdict }[] {
  const out: { scope: string; variant: string; verdict: Verdict }[] = []
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index)
    if (!key?.startsWith(PREFIX)) continue
    const [scope = '', ...rest] = key.slice(PREFIX.length).split(':')
    out.push({ scope, variant: rest.join(':'), verdict: read(key) })
  }
  return out.sort((a, b) => a.scope.localeCompare(b.scope) || a.variant.localeCompare(b.variant))
}

export function PrototypeVerdict({ scope, variant }: { scope: string; variant: string }) {
  const key = keyOf(scope, variant)
  const [verdict, setVerdict] = useState<Verdict>(() => read(key))
  const [noting, setNoting] = useState(false)
  const [summary, setSummary] = useState(false)
  const [, setTick] = useState(0)

  useEffect(() => {
    setVerdict(read(key))
    setNoting(false)
  }, [key])

  useEffect(() => {
    const refresh = () => setTick((tick) => tick + 1)
    window.addEventListener(EVENT, refresh)
    return () => window.removeEventListener(EVENT, refresh)
  }, [])

  if (!import.meta.env.DEV) return null

  const update = (next: Verdict) => {
    setVerdict(next)
    write(key, next)
  }
  const toggle = (status: Exclude<Status, null>) =>
    update({ ...verdict, status: verdict.status === status ? null : status })

  return (
    <div className="fixed bottom-16 left-1/2 z-50 flex w-[min(92vw,26rem)] -translate-x-1/2 flex-col gap-2 rounded-2xl bg-black p-2 text-sm text-white shadow-xl ring-2 ring-fuchsia-500">
      <div className="flex items-center gap-1.5">
        <span className="min-w-0 flex-1 truncate px-1.5 font-mono text-xs opacity-80">
          {scope} · {variant}
        </span>
        <button
          type="button"
          onClick={() => toggle('approved')}
          className={`flex items-center gap-1 rounded-full px-2.5 py-1 ${verdict.status === 'approved' ? 'bg-emerald-500 text-black' : 'hover:bg-white/15'}`}
        >
          <Check size={14} /> Approuver
        </button>
        <button
          type="button"
          onClick={() => toggle('rejected')}
          className={`flex items-center gap-1 rounded-full px-2.5 py-1 ${verdict.status === 'rejected' ? 'bg-rose-500 text-black' : 'hover:bg-white/15'}`}
        >
          <X size={14} /> Refuser
        </button>
        <button
          type="button"
          aria-label="Note"
          onClick={() => setNoting((value) => !value)}
          className={`rounded-full p-1.5 ${noting || verdict.note ? 'bg-white/20' : 'hover:bg-white/15'}`}
        >
          <MessageSquare size={14} />
        </button>
        <button
          type="button"
          aria-label="Récapitulatif"
          onClick={() => setSummary((value) => !value)}
          className="rounded-full p-1.5 hover:bg-white/15"
        >
          {summary ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
        </button>
      </div>

      {noting ? (
        <textarea
          autoFocus
          value={verdict.note}
          onChange={(event) => update({ ...verdict, note: event.target.value })}
          placeholder="Ce qui va, ce qui ne va pas…"
          rows={3}
          className="w-full resize-none rounded-lg bg-white/10 px-2.5 py-2 text-sm text-white outline-none placeholder:text-white/50"
        />
      ) : null}

      {summary ? (
        <ul className="flex max-h-60 flex-col gap-1 overflow-y-auto border-t border-white/20 pt-2 text-xs">
          {allVerdicts().length === 0 ? <li className="opacity-60">Aucun verdict pour l'instant.</li> : null}
          {allVerdicts().map((entry) => (
            <li key={`${entry.scope}:${entry.variant}`} className="flex gap-2">
              <span className="shrink-0">
                {entry.verdict.status === 'approved' ? '✓' : entry.verdict.status === 'rejected' ? '✗' : '·'}
              </span>
              <span className="shrink-0 font-mono opacity-80">
                {entry.scope}/{entry.variant}
              </span>
              <span className="min-w-0 flex-1 truncate opacity-70">{entry.verdict.note}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
