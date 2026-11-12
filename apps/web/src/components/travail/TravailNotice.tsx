import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { cx } from '@solera/ui'

type Tone = 'neutral' | 'critical'
type Say = (text: string, tone?: Tone) => void

const NoticeContext = createContext<Say>(() => {})

/** Le retour d'un geste de Travail : une phrase, au même endroit pour tous (T-13.3). */
export function useTravailNotice(): Say {
  return useContext(NoticeContext)
}

/**
 * Le message d'une erreur. Celui d'une erreur d'API est déjà dans la langue de
 * l'interface, ses paramètres posés (`api.ts`) : le retraduire les perdrait.
 */
export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

const SHOWN_MS = 5_000

/**
 * L'hôte des retours de gestes : sous la barre, au-dessus du contenu comme du tiroir.
 * Un retour chasse le précédent ; il s'efface seul au bout de cinq secondes.
 */
export function TravailNoticeHost({ children }: { children: ReactNode }) {
  const [notice, setNotice] = useState<{ text: string; tone: Tone; at: number } | null>(null)
  const timer = useRef<number | undefined>(undefined)
  const say = useCallback<Say>((text, tone = 'neutral') => setNotice({ text, tone, at: Date.now() }), [])
  useEffect(() => {
    window.clearTimeout(timer.current)
    if (notice) timer.current = window.setTimeout(() => setNotice(null), SHOWN_MS)
    return () => window.clearTimeout(timer.current)
  }, [notice])
  return (
    <NoticeContext.Provider value={say}>
      {children}
      <div role="status" aria-live="polite" className="pointer-events-none fixed top-28 left-1/2 z-40 -translate-x-1/2 px-4">
        {notice ? (
          <p
            key={notice.at}
            className={cx(
              'surface max-w-[min(32rem,calc(100vw-2rem))] rounded-lg border px-3 py-2 text-xs shadow-pop',
              notice.tone === 'critical' ? 'border-critical/40 text-critical' : 'border-line text-ink',
            )}
          >
            {notice.text}
          </p>
        ) : null}
      </div>
    </NoticeContext.Provider>
  )
}
