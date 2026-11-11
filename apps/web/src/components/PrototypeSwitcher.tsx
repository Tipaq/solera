/* PROTOTYPE — jetable (branche proto/page-projet). Ne pas fusionner dans main. */
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'

export interface PrototypeVariant {
  key: string
  name: string
}

/** Lit `?variant=` ; la première variante par défaut. */
export function usePrototypeVariant(variants: PrototypeVariant[]): string {
  const [params] = useSearchParams()
  const wanted = params.get('variant')
  return variants.some((variant) => variant.key === wanted) ? wanted! : variants[0]!.key
}

/** La barre flottante qui fait défiler les variantes, aux flèches ou au clavier. */
export function PrototypeSwitcher({ variants }: { variants: PrototypeVariant[] }) {
  const [, setParams] = useSearchParams()
  const current = usePrototypeVariant(variants)
  const index = variants.findIndex((variant) => variant.key === current)

  const go = (step: number) => {
    const next = variants[(index + step + variants.length) % variants.length]!
    setParams((previous) => {
      previous.set('variant', next.key)
      return previous
    }, { replace: true })
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, [contenteditable="true"]')) return
      if (event.key === 'ArrowLeft') go(-1)
      if (event.key === 'ArrowRight') go(1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (!import.meta.env.DEV) return null
  const variant = variants[index]!

  return (
    <div className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-1 rounded-full bg-black px-2 py-1.5 text-sm text-white shadow-xl ring-2 ring-fuchsia-500">
      <button type="button" className="rounded-full p-1 hover:bg-white/20" onClick={() => go(-1)} aria-label="previous">
        <ChevronLeft size={16} />
      </button>
      <span className="px-2 font-mono whitespace-nowrap">
        {variant.key} · {variant.name} <span className="opacity-60">({index + 1}/{variants.length})</span>
      </span>
      <button type="button" className="rounded-full p-1 hover:bg-white/20" onClick={() => go(1)} aria-label="next">
        <ChevronRight size={16} />
      </button>
    </div>
  )
}
