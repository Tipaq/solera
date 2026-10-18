import { Maximize2, Minimize2, Minus, Plus, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import * as Dialog from '@radix-ui/react-dialog'
import { IconButton, cx, useMediaQuery } from '@solera/ui'
import { formatBytes } from '../../lib/attachments'
import { rawFileUrl } from '../../lib/files-io'
import { useTranslate } from '../../lib/i18n'

/**
 * Une vraie visionneuse, pas un `object-contain`.
 *
 * Jusqu'ici l'image était posée à la taille du cadre, sans zoom : une capture de
 * 2880 px dans un panneau de 600 est illisible, et agrandir le panneau ne suffit pas —
 * c'est le rapport de forme qui décide, pas la place. Trois repères fixes (ajuster,
 * 100 %, largeur) parce qu'un zoom libre seul fait perdre l'échelle, et un zoom libre
 * par-dessus parce que les trois ne tombent jamais sur ce qu'on veut lire.
 */

/** Bornes du zoom libre : en deçà l'image n'est plus qu'une vignette, au-delà c'est du bruit. */
const MIN_SCALE = 0.05
const MAX_SCALE = 16

type Mode = 'fit' | 'actual' | 'width'

interface Natural {
  width: number
  height: number
}

export function ImageView({ scope, path }: { scope: string; path: string }) {
  const t = useTranslate()
  const [fullscreen, setFullscreen] = useState(false)
  const body = (
    <Viewer
      key={fullscreen ? 'fullscreen' : 'panel'}
      src={rawFileUrl(scope, path)}
      path={path}
      fullscreen={fullscreen}
      onFullscreen={setFullscreen}
    />
  )

  // Hors de la coque, et donc hors du panneau : celui-ci porte une transition de
  // `translate`, qui fait de lui le repère de tout `fixed` placé dedans. Une image
  // « plein écran » y resterait enfermée dans la largeur du panneau.
  return fullscreen
    ? createPortal(
        <div
          role="dialog"
          aria-modal
          aria-label={t('editor.image.fullscreen', { path })}
          // `flex` : la visionneuse se dimensionne par `flex-1`, et un parent qui n'est
          // pas une boîte flexible la laisse pousser jusqu'à la hauteur de l'image —
          // l'ajustement se calculait alors sur un cadre plus haut que la fenêtre.
          className="fixed inset-0 z-[60] flex bg-sunken"
        >
          {body}
        </div>,
        document.body,
      )
    : body
}

/**
 * La même visionneuse, ouverte en plein écran sur une image qui n'est pas un fichier
 * du projet : la lecture d'un outil, une pièce jointe, une image du web.
 *
 * Elle s'ouvrait jusqu'ici dans un nouvel onglet du navigateur, ou pas du tout : sans
 * zoom ni glissement, une capture d'écran rendue par un outil restait une vignette.
 * Fermer rend la main au fil, à l'endroit exact où on l'avait laissé.
 */
export function ImageLightbox({ src, name, onClose }: {
  src: string
  /** Ce que la réglette affiche : un nom de fichier, ou à défaut le texte alternatif. */
  name: string
  onClose: () => void
}) {
  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) onClose() }}>
      <LightboxContent src={src} name={name} onClose={onClose} />
    </Dialog.Root>
  )
}

/**
 * Le contenu de la visionneuse, à poser dans un `Dialog.Root`.
 *
 * Séparé pour qu'une vignette puisse en être le `Dialog.Trigger` : c'est à lui que
 * Radix rend le focus à la fermeture. Sans déclencheur, il retombait sur la page.
 *
 * Une vraie boîte de dialogue : le focus y entre, le fil derrière devient inerte, et
 * Échap ne ferme qu'elle — sans s'arrêter là, il fermait aussi la recherche du fil,
 * qui écoute la même touche sur la fenêtre.
 */
export function LightboxContent({ src, name, onClose }: {
  src: string
  name: string
  onClose: () => void
}) {
  const t = useTranslate()
  return (
    <Dialog.Portal>
      <Dialog.Content
        aria-describedby={undefined}
        onEscapeKeyDown={(event) => event.stopPropagation()}
        // Le focus va à la boîte elle-même et non au premier bouton : « Réduire » ouvrait
        // son infobulle par-dessus l'image à chaque ouverture.
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          ;(event.currentTarget as HTMLElement | null)?.focus()
        }}
        // Rendue dans l'arbre React de qui l'ouvre, à travers un portail : ses clics
        // remonteraient sinon jusqu'aux gestionnaires du fil — le clic du Markdown,
        // le pli d'une carte d'outil.
        onClick={(event) => event.stopPropagation()}
        className="fixed inset-0 z-[60] flex bg-sunken outline-none"
      >
        <Dialog.Title className="sr-only">{t('editor.image.fullscreen', { path: name })}</Dialog.Title>
        <Viewer src={src} path={name} fullscreen standalone onFullscreen={(value) => { if (!value) onClose() }} />
      </Dialog.Content>
    </Dialog.Portal>
  )
}

function Viewer({ src, path, fullscreen, standalone = false, onFullscreen }: {
  src: string
  /** Ouverte depuis le fil, hors du panneau : pas de « quitter le plein écran ». */
  standalone?: boolean
  /** Le chemin, ou le nom affiché d'une image qui n'en a pas. */
  path: string
  fullscreen: boolean
  onFullscreen: (value: boolean) => void
}) {
  const t = useTranslate()
  const frame = useRef<HTMLDivElement>(null)
  const [natural, setNatural] = useState<Natural | null>(null)
  const [bytes, setBytes] = useState<number | null>(null)
  const [mode, setMode] = useState<Mode>('fit')
  const [scale, setScale] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  /**
   * Au téléphone, le panneau recouvre déjà l'écran : la visionneuse y est en plein
   * écran sans qu'on l'ait demandé, et le bouton qui l'y mettrait ne mènerait nulle
   * part. Même seuil que celui du panneau, pour que les deux basculent ensemble.
   */
  const wide = useMediaQuery('(min-width: 48rem)')
  const coarse = useMediaQuery('(pointer: coarse)')

  /**
   * Les doigts posés sur l'image, pour le pincement.
   *
   * Deux pointeurs ne sont pas deux glissements : tant qu'ils sont deux, c'est
   * l'écart entre eux qui commande l'échelle, et aucun des deux ne déplace l'image.
   */
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const pinch = useRef<number | null>(null)

  const url = src
  const name = path.split('/').pop() ?? path
  const format = (path.split('.').pop() ?? '').toUpperCase()

  /** L'échelle d'un des trois repères, mesurée sur le cadre au moment du calcul. */
  const scaleFor = useCallback((target: Mode, size: Natural | null): number => {
    if (!size) return 1
    if (target === 'actual') return 1
    const box = frame.current?.getBoundingClientRect()
    if (!box || box.width === 0 || box.height === 0) return 1
    const byWidth = box.width / size.width
    return target === 'width' ? byWidth : Math.min(byWidth, box.height / size.height)
  }, [])

  const goTo = useCallback((target: Mode) => {
    setMode(target)
    setScale(scaleFor(target, natural))
    setOffset({ x: 0, y: 0 })
  }, [natural, scaleFor])

  /**
   * Le cadre change de taille quand le panneau se redimensionne ou passe en plein
   * écran : un repère est une règle, pas une valeur figée au premier rendu.
   *
   * Seul un changement **réel** de taille recalcule. `ResizeObserver` appelle son
   * rappel dès qu'on observe, et sans cette garde, le simple fait de repasser en mode
   * libre — un glissement, un cran de molette — réappliquait le repère et annulait le
   * zoom qu'on venait de demander.
   */
  const observed = useRef<{ width: number; height: number } | null>(null)
  useEffect(() => {
    const node = frame.current
    if (!node || mode === 'actual' || !natural) return
    const observer = new ResizeObserver(([entry]) => {
      const box = entry?.contentRect
      if (!box) return
      const before = observed.current
      observed.current = { width: box.width, height: box.height }
      if (before && before.width === box.width && before.height === box.height) return
      setScale(scaleFor(mode, natural))
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [mode, natural, scaleFor])

  /** La taille du fichier n'est pas dans l'arborescence : seule l'en-tête la donne. */
  useEffect(() => {
    let cancelled = false
    setBytes(null)
    // Le poids n'est écrit que dans le pied, absent de la visionneuse ouverte depuis le
    // fil. Le demander y enverrait une requête de plus à l'origine d'une image du web,
    // pour rien. Une image en ligne, elle, n'a pas d'en-tête : ses octets sont dans l'URL.
    if (standalone || url.startsWith('data:')) return
    void fetch(url, { method: 'HEAD', credentials: 'same-origin' })
      .then((response) => {
        const length = response.headers.get('content-length')
        if (!cancelled && length) setBytes(Number(length))
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [url, standalone])

  /**
   * Zoom au pointeur : le point sous le curseur ne bouge pas.
   *
   * Sans ça, zoomer sur un détail du coin le fait sortir du cadre au deuxième cran, et
   * il faut rattraper au glissement ce que la molette vient de perdre.
   */
  const zoomAt = (factor: number, clientX?: number, clientY?: number) => {
    const box = frame.current?.getBoundingClientRect()
    setScale((current) => {
      const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, current * factor))
      if (box && clientX !== undefined && clientY !== undefined) {
        const dx = clientX - (box.left + box.width / 2)
        const dy = clientY - (box.top + box.height / 2)
        const ratio = next / current
        setOffset((position) => ({
          x: position.x - (dx - position.x) * (ratio - 1),
          y: position.y - (dy - position.y) * (ratio - 1),
        }))
      }
      return next
    })
    setMode('fit')
  }

  /**
   * La molette, posée à la main et non par `onWheel`.
   *
   * React attache `wheel` en écouteur passif sur sa racine : un `preventDefault` dans
   * un gestionnaire React n'y fait rien, et la page défilait sous l'image pendant
   * qu'on croyait zoomer. Posé ici, l'écouteur est non passif et peut refuser le
   * défilement.
   */
  const zoomRef = useRef(zoomAt)
  zoomRef.current = zoomAt
  useEffect(() => {
    const node = frame.current
    if (!node) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      zoomRef.current(event.deltaY < 0 ? 1.12 : 1 / 1.12, event.clientX, event.clientY)
    }
    node.addEventListener('wheel', onWheel, { passive: false })
    return () => node.removeEventListener('wheel', onWheel)
  }, [])

  // Les raccourcis n'existent qu'en plein écran : ailleurs, le fil et l'éditeur ont
  // leurs propres touches, et confisquer `F` ou `0` à la frappe serait une surprise.
  useEffect(() => {
    if (!fullscreen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      // Seule, la visionneuse est une boîte de dialogue : c'est elle qui ferme sur Échap.
      if (event.key === 'Escape') { if (!standalone) { event.preventDefault(); onFullscreen(false) } }
      else if (event.key.toLowerCase() === 'f') { event.preventDefault(); goTo('fit') }
      else if (event.key === '0') { event.preventDefault(); goTo('actual') }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [fullscreen, standalone, goTo, onFullscreen])

  const percent = Math.round(scale * 100)

  return (
    <div
      data-editor-file={standalone ? undefined : path}
      data-image-viewer
      tabIndex={-1}
      className="@container relative flex min-h-0 min-w-0 flex-1 flex-col outline-none"
    >
      <div
        ref={frame}
        onDoubleClick={() => goTo(mode === 'actual' ? 'fit' : 'actual')}
        onPointerDown={(event) => {
          if (event.button !== 0) return
          event.currentTarget.setPointerCapture(event.pointerId)
          pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
          setDragging(true)
        }}
        onPointerMove={(event) => {
          const points = pointers.current
          if (points.has(event.pointerId)) points.set(event.pointerId, { x: event.clientX, y: event.clientY })

          if (points.size >= 2) {
            const [first, second] = [...points.values()]
            if (!first || !second) return
            const distance = Math.hypot(second.x - first.x, second.y - first.y)
            const previous = pinch.current
            pinch.current = distance
            // Le premier mouvement à deux doigts ne fait que poser l'écart de départ :
            // sans ça, le pincement sauterait d'un facteur arbitraire au premier
            // événement.
            if (previous && previous > 0 && distance > 0) {
              zoomAt(distance / previous, (first.x + second.x) / 2, (first.y + second.y) / 2)
            }
            return
          }

          // Un clic immobile n'est pas un glissement : sans ce test, viser un bouton
          // de la réglette faisait basculer la visionneuse en zoom libre.
          if (!dragging || (event.movementX === 0 && event.movementY === 0)) return
          setOffset((position) => ({ x: position.x + event.movementX, y: position.y + event.movementY }))
          setMode('fit')
        }}
        onPointerUp={(event) => {
          event.currentTarget.releasePointerCapture(event.pointerId)
          pointers.current.delete(event.pointerId)
          if (pointers.current.size < 2) pinch.current = null
          setDragging(pointers.current.size > 0)
        }}
        onPointerCancel={(event) => {
          pointers.current.delete(event.pointerId)
          if (pointers.current.size < 2) pinch.current = null
          setDragging(pointers.current.size > 0)
        }}
        className={cx(
          'relative flex min-h-0 min-w-0 flex-1 items-center justify-center overflow-hidden',
          // Sans ça le navigateur prend le pincement et le glissement pour les siens :
          // il fait défiler la page et zoome le document entier.
          'touch-none',
          // Le damier dit la transparence : sans lui, un PNG à fond transparent se lit
          // comme un PNG à fond blanc, ou noir selon le thème.
          'bg-sunken',
          dragging ? 'cursor-grabbing' : 'cursor-grab',
        )}
      >
        <img
          src={url}
          alt={path}
          draggable={false}
          onLoad={(event) => {
            const image = event.currentTarget
            const size = { width: image.naturalWidth, height: image.naturalHeight }
            setNatural(size)
            setScale(scaleFor('fit', size))
            setOffset({ x: 0, y: 0 })
            // L'arborescence ne se referme plus toute seule devant une image large.
            // Elle le faisait au-delà de 1200 px de côté, si bien qu'en parcourant des
            // captures la colonne disparaissait ou non selon la résolution de la
            // suivante : un réglage qui change sans qu'on y touche, et dont la cause
            // est invisible. Son ouverture appartient à qui regarde — le `fit` donne
            // déjà à l'image la place qui reste, quelle qu'elle soit.
          }}
          style={{
            width: natural ? natural.width * scale : undefined,
            height: natural ? natural.height * scale : undefined,
            transform: `translate(${offset.x}px, ${offset.y}px)`,
          }}
          className="max-w-none shrink-0 select-none"
        />

        {/* La réglette flotte sur l'image plutôt que sous elle : en plein écran il n'y
            a pas de pied où la poser, et deux dispositions pour un seul contrôle
            demanderaient de le tenir en accord à deux endroits. */}
        {/* La réglette est posée dans le cadre, donc ses clics y remontent : sans les
            arrêter, viser « 100 % » commencerait un glissement de l'image, et la
            molette au-dessus du bouton zoomerait au lieu de le survoler. */}
        <div
          onPointerDown={(event) => event.stopPropagation()}
          onDoubleClick={(event) => event.stopPropagation()}
          className={cx(
            'surface absolute flex items-center gap-0.5 rounded-full border border-line px-1 py-1 shadow-pop',
            fullscreen ? 'top-3 right-3' : 'bottom-3',
          )}
        >
          {fullscreen ? (
            <span className="max-w-56 truncate px-2 text-sm text-ink-soft" title={path}>{name}</span>
          ) : (
            <>
              <Preset active={mode === 'fit'} onClick={() => goTo('fit')}>{t('editor.image.fit')}</Preset>
              <Preset active={mode === 'actual'} onClick={() => goTo('actual')}>{t('editor.image.actual')}</Preset>
              {/* « Largeur » tombe en premier quand la place manque : c'est le repère
                  le moins souvent voulu des trois, et le seul qui ait un synonyme
                  proche — sur une image haute, il revient à « ajuster ». */}
              <span className="@max-[26rem]:hidden">
                <Preset active={mode === 'width'} onClick={() => goTo('width')}>{t('editor.image.width')}</Preset>
              </span>
            </>
          )}

          <span aria-hidden className="mx-1 h-5 w-px bg-line" />

          <IconButton size="sm" label={t('editor.image.zoomOut')} onClick={() => zoomAt(1 / 1.25)}>
            <Minus size={14} />
          </IconButton>
          <span role="status" className="min-w-14 text-center text-sm tabular-nums text-ink">
            {t('editor.image.percent', { percent })}
          </span>
          <IconButton size="sm" label={t('editor.image.zoomIn')} onClick={() => zoomAt(1.25)}>
            <Plus size={14} />
          </IconButton>

          <span aria-hidden className="mx-1 h-5 w-px bg-line" />

          {/* Une image ouverte depuis le fil n'a pas de panneau où revenir : seul le
              bouton de fermeture y a un sens. */}
          {(wide || fullscreen) && !standalone ? (
            <IconButton
              size="sm"
              label={t(fullscreen ? 'editor.image.fullscreen.exit' : 'editor.image.fullscreen.enter')}
              onClick={() => onFullscreen(!fullscreen)}
            >
              {fullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            </IconButton>
          ) : null}
          {fullscreen ? (
            <IconButton size="sm" label={t('common.close')} onClick={() => onFullscreen(false)}>
              <X size={14} />
            </IconButton>
          ) : null}
        </div>

        {fullscreen ? (
          <p className="absolute bottom-4 rounded-full bg-ink/70 px-3 py-1 text-xs text-canvas">
            {t('editor.image.keys')}
          </p>
        ) : null}
      </div>

      {fullscreen ? null : (
        <div className="flex shrink-0 items-center gap-2 border-t border-line px-2.5 py-1.5 text-xs text-ink-faint">
          <span className="min-w-0 flex-1 truncate">
            {natural
              ? t('editor.image.meta', {
                  width: natural.width,
                  height: natural.height,
                  size: bytes === null ? '—' : formatBytes(bytes),
                })
              : path}
            {/* Le format tombe le premier : l'extension est déjà sur l'onglet et dans
                le titre de la bande, alors que les dimensions ne sont écrites qu'ici. */}
            <span className="@max-[26rem]:hidden"> · {format}</span>
          </span>
          {/* Les gestes ne sont pas les mêmes selon ce qu'on a sous la main : écrire
              « molette » à qui touche l'écran, c'est lui décrire un outil absent. */}
          <span className="shrink-0">
            {t(coarse ? 'editor.image.hints.touch' : 'editor.image.hints')}
          </span>
        </div>
      )}
    </div>
  )
}

function Preset({ active, onClick, children }: {
  active: boolean
  onClick: () => void
  children: string
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cx(
        'rounded-full px-2.5 py-1 text-sm transition-colors',
        active ? 'bg-accent-wash text-accent' : 'text-ink-soft hover:text-ink',
      )}
    >
      {children}
    </button>
  )
}
