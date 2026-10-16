import { useCallback, useEffect, useState, type KeyboardEvent, type ReactNode } from 'react'

/**
 * Le glisser-déposer de la vue Git — **au clavier, et seulement au clavier**.
 *
 * Deux points d'application, un seul mécanisme (planche T6) : glisser une branche sur
 * une autre, et réordonner les lignes d'un plan de rebase. C'est pour ça que les deux
 * sont du même lot — il n'y a qu'une chose à écrire, et qu'une chose à apprendre.
 *
 * **Pourquoi pas de souris, et pas de doigt.** Le geste n'existe pas au doigt : un
 * appui long y sert déjà au défilement, et le même choix passe par le menu de l'objet
 * (règle T0), livré au lot 2 et qui marche partout. L'ajouter au pointeur aurait
 * demandé `dnd-kit` et ses capteurs pour un raccourci que le menu rend déjà — alors
 * qu'au clavier le menu, lui, demande d'ouvrir, de descendre et de lire. Le clavier
 * est le seul endroit où ce geste gagne quelque chose, et c'est le seul où il est.
 *
 * **Ce que le geste ne fait pas : agir.** Lâcher une branche sur une autre *propose*
 * (T6), parce qu'un lâcher accidentel ne doit rien fusionner. La proposition, elle,
 * passe ensuite par `useGitActions` comme tout le reste — donc par le verrou et par le
 * garde-fou. Aucune route nouvelle n'est ouverte pour ce lot.
 *
 * Le contrat clavier, le même aux deux endroits :
 *
 * - **Espace** ou **Entrée** saisit la ligne, puis la lâche sur la destination visée ;
 * - **↑** et **↓** visent la destination précédente ou suivante, en bouclant ;
 * - **Échap** repose la ligne, et rien n'a changé.
 *
 * L'état reste `(held, over)` : deux identifiants, et rien d'autre. Ce qui se voit à
 * l'écran — la ligne qui se déplace dans le plan, la destination qui s'allume dans
 * *Branches* — s'en **dérive** au rendu, par `moved` plus bas. Déplacer vraiment les
 * lignes pendant le geste aurait demandé de savoir les remettre à leur place sur
 * Échap, ce qui est la façon ordinaire de perdre un plan à moitié composé.
 */

export interface KeyboardDrag {
  /** La ligne saisie, nulle au repos. */
  held: string | null
  /** La destination visée, nulle au repos. */
  over: string | null
  /** À étaler sur chaque ligne déplaçable. */
  rowProps: (id: string) => {
    tabIndex: number
    'aria-roledescription': string
    'data-held'?: true
    'data-over'?: true
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => void
  }
  /** La phrase à rendre dans la région vivante — voir `DragLive`. */
  message: string
  /** Repose la ligne sans rien faire : le *Échap* d'une proposition, au clic. */
  cancel: () => void
}

export interface KeyboardDragOptions {
  /** Les lignes, dans l'ordre où elles sont affichées. Relu à chaque rendu. */
  rows: string[]
  /** Une ligne peut-elle être saisie ? Faux pendant qu'un tour tient le répertoire. */
  canHold: (id: string) => boolean
  /** `over` accepte-t-il `held` ? Les flèches ne s'arrêtent que sur ce qui est vrai. */
  canDrop: (held: string, over: string) => boolean
  /** Le lâcher. Il propose ou il réordonne — jamais il ne détruit (voir T6). */
  onDrop: (held: string, over: string) => void
  /**
   * Ce que la région vivante annonce à chaque étape.
   *
   * Un geste qui n'existe qu'au clavier ne se voit pas forcément : sans ces phrases,
   * saisir une ligne ne produirait aucun retour pour qui n'a pas l'écran.
   */
  phrase: (step: 'hold' | 'move' | 'drop' | 'cancel', held: string, over: string | null) => string
  /** Le mot qu'un lecteur d'écran donne à la ligne — « élément déplaçable ». */
  roleDescription: string
}

export function useKeyboardDrag({
  rows,
  canHold,
  canDrop,
  onDrop,
  phrase,
  roleDescription,
}: KeyboardDragOptions): KeyboardDrag {
  const [held, setHeld] = useState<string | null>(null)
  const [over, setOver] = useState<string | null>(null)
  const [message, setMessage] = useState('')

  // Une ligne qui disparaît pendant qu'on la tient — une branche supprimée ailleurs,
  // un plan rechargé — repose le geste plutôt que de le laisser viser un fantôme.
  useEffect(() => {
    if (held !== null && !rows.includes(held)) {
      setHeld(null)
      setOver(null)
    }
  }, [rows, held])

  const cancel = useCallback(() => {
    if (held === null) return
    setMessage(phrase('cancel', held, over))
    setHeld(null)
    setOver(null)
  }, [held, over, phrase])

  const rowProps = useCallback(
    (id: string) => {
      const onKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
        // Seule la ligne elle-même écoute : sans ce filtre, Entrée sur le bouton du
        // fil ou dans le champ d'un *réécrire* déclencherait aussi le geste.
        if (event.target !== event.currentTarget) return

        if (event.key === 'Escape' && held !== null) {
          event.preventDefault()
          cancel()
          return
        }

        if (event.key === ' ' || event.key === 'Enter') {
          if (held === null) {
            if (!canHold(id)) return
            // Saisir une ligne qui n'a nulle part où aller n'avance à rien : le geste
            // ne commence pas, plutôt que de s'ouvrir sur une impasse.
            const first = rows.find((row) => row !== id && canDrop(id, row))
            if (first === undefined) return
            event.preventDefault()
            setHeld(id)
            setOver(first)
            setMessage(phrase('hold', id, first))
            return
          }
          if (over === null) return
          event.preventDefault()
          setMessage(phrase('drop', held, over))
          setHeld(null)
          setOver(null)
          onDrop(held, over)
          return
        }

        if (held === null) return
        const delta = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0
        if (delta === 0) return
        event.preventDefault()
        const reachable = rows.filter((row) => row !== held && canDrop(held, row))
        if (reachable.length === 0) return
        const at = over === null ? -1 : reachable.indexOf(over)
        // La liste boucle : avec deux destinations, buter en bout serait un cul-de-sac
        // qu'il faudrait remonter à la flèche inverse.
        const next = reachable[(at + delta + reachable.length) % reachable.length] ?? null
        if (next === null) return
        setOver(next)
        setMessage(phrase('move', held, next))
      }

      return {
        tabIndex: 0,
        'aria-roledescription': roleDescription,
        ...(held === id ? { 'data-held': true as const } : {}),
        ...(held !== null && over === id ? { 'data-over': true as const } : {}),
        onKeyDown,
      }
    },
    [rows, held, over, canHold, canDrop, onDrop, phrase, roleDescription, cancel],
  )

  return { held, over, rowProps, message, cancel }
}

/**
 * La région vivante du geste.
 *
 * Hors flux et invisible : ce qu'elle dit est déjà à l'écran pour qui le voit, et
 * l'écrire deux fois encombrerait une vue qui doit tenir à 22 rem.
 */
export function DragLive({ message }: { message: string }): ReactNode {
  return (
    <p aria-live="polite" className="sr-only">
      {message}
    </p>
  )
}

/**
 * L'ordre tel qu'il serait si on lâchait maintenant.
 *
 * `held` vient se poser **à la place** de `over`, les autres se décalent — c'est ce
 * qu'on attend d'une ligne qu'on déplace dans une recette. Rien n'est écrit :
 * l'appelant s'en sert pour le rendu pendant le geste **et** pour le résultat au
 * lâcher, ce qui est la seule façon que les deux soient d'accord.
 */
export function moved(order: string[], held: string, over: string): string[] {
  const from = order.indexOf(held)
  const to = order.indexOf(over)
  if (from === -1 || to === -1) return order
  const next = [...order]
  next.splice(from, 1)
  next.splice(to, 0, held)
  return next
}
