import { ArrowLeft, ArrowRight, BookOpen, ExternalLink, Globe, Loader, MonitorPlay, RotateCw, X } from 'lucide-react'
import { useEffect, useState, type FormEvent, type MouseEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Banner, Button, IconButton, SegmentedControl } from '@solera/ui'
import { useTranslate } from '../../lib/i18n'
import {
  closeWeb,
  navigateWeb,
  normalizeAddress,
  setWebMode,
  stepWeb,
  useWebPage,
  useWebPane,
} from '../../lib/web-pane'
import { ImageLightbox } from './ImageView'

/**
 * La vue *Web* : une page ouverte depuis le fil, sans quitter Solera.
 *
 * *Lecture* montre le texte que le serveur a extrait, dans la typographie du fil, et
 * ses liens restent dans la vue. *Direct* montre la vraie page dans un cadre, quand le
 * site l'accepte ; sinon la vue le dit et propose la lecture ou le navigateur, plutôt
 * qu'un cadre vide dont on ne saurait pas pourquoi il l'est.
 */
export function WebPane({ scope }: { scope: string }) {
  const t = useTranslate()
  const client = useQueryClient()
  const pane = useWebPane(scope)
  const url = pane ? (pane.history[pane.index] ?? null) : null
  const page = useWebPage(url)
  const [address, setAddress] = useState(url ?? '')
  const [viewing, setViewing] = useState<{ src: string; name: string } | null>(null)
  const [frameKey, setFrameKey] = useState(0)

  // La barre suit la page ouverte, et l'adresse finale une fois les redirections suivies.
  useEffect(() => {
    setAddress(page.data?.url ?? url ?? '')
  }, [url, page.data?.url])

  if (!pane || !url) return null

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const next = normalizeAddress(address)
    if (next) navigateWeb(scope, next)
  }

  const reload = () => {
    if (pane.mode === 'live') setFrameKey((key) => key + 1)
    else void client.invalidateQueries({ queryKey: ['web-page', url] })
  }

  /** Un lien de la page lue reste dans la vue ; avec une touche, il part au navigateur. */
  const onReaderClick = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement
    const image = target instanceof HTMLImageElement ? target : null
    const link = target.closest('a')
    if (image && !link) {
      setViewing({ src: image.currentSrc || image.src, name: image.alt || image.src.split('/').pop() || '' })
      return
    }
    if (!link?.href || event.metaKey || event.ctrlKey || event.shiftKey) return
    if (!/^https?:/.test(link.href)) return
    event.preventDefault()
    navigateWeb(scope, link.href)
  }

  // Une page servie en https ne peut pas encadrer une adresse en http : le navigateur
  // la bloque sans rien dire. C'est le cas d'un aperçu local vu depuis le téléphone.
  const mixed = window.location.protocol === 'https:' && url.startsWith('http:')
  const refused = page.data?.embeddable === false
  const data = page.data

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="@container flex shrink-0 items-center gap-1 border-b border-line px-2 py-1.5">
        <IconButton size="sm" label={t('web.back')} disabled={pane.index === 0} onClick={() => stepWeb(scope, -1)}>
          <ArrowLeft size={15} />
        </IconButton>
        <IconButton
          size="sm"
          label={t('web.forward')}
          disabled={pane.index >= pane.history.length - 1}
          onClick={() => stepWeb(scope, 1)}
        >
          <ArrowRight size={15} />
        </IconButton>
        <IconButton size="sm" label={t('web.reload')} onClick={reload}>
          {page.isFetching ? <Loader size={14} className="animate-spin" /> : <RotateCw size={14} />}
        </IconButton>
        <form onSubmit={submit} className="min-w-0 flex-1">
          <input
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            onFocus={(event) => event.currentTarget.select()}
            aria-label={t('web.address')}
            spellCheck={false}
            className="h-8 w-full min-w-0 rounded-md border border-line bg-sunken px-2 font-mono text-xs text-ink outline-none focus:border-accent"
          />
        </form>
        <SegmentedControl
          label={t('web.mode')}
          value={pane.mode}
          onChange={(mode) => setWebMode(scope, mode)}
          className="shrink-0 [&_button]:px-2"
          segments={[
            { value: 'reader', label: t('web.mode.reader'), icon: <BookOpen size={13} /> },
            { value: 'live', label: t('web.mode.live'), icon: <MonitorPlay size={13} /> },
          ]}
        />
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          title={t('web.external')}
          aria-label={t('web.external')}
          className="flex size-8 shrink-0 items-center justify-center rounded-md text-ink-faint hover:text-ink"
        >
          <ExternalLink size={14} />
        </a>
        <IconButton size="sm" label={t('web.close')} onClick={() => closeWeb(scope)}>
          <X size={15} />
        </IconButton>
      </div>

      {pane.mode === 'live' ? (
        <div className="flex min-h-0 flex-1 flex-col">
          {mixed || refused ? (
            <div className="flex flex-col gap-2 p-2">
              <Banner tone="caution">{t(mixed ? 'web.live.mixed' : 'web.live.refused')}</Banner>
              <div className="flex items-center gap-3">
                {data?.html ? (
                  <Button size="sm" onClick={() => setWebMode(scope, 'reader')}>{t('web.mode.reader')}</Button>
                ) : null}
                <a href={url} target="_blank" rel="noopener noreferrer" className="text-sm text-accent underline">
                  {t('web.external')}
                </a>
              </div>
            </div>
          ) : null}
          {/* Pas de cadre quand il serait refusé : le navigateur n'y montrerait que sa
              page d'erreur, sous un bandeau qui dit déjà pourquoi. */}
          {mixed || refused ? null : (
          <iframe
            key={`${url}-${frameKey}`}
            src={url}
            title={data?.title ?? url}
            // Le site garde sa propre origine, distincte de celle de Solera : lui
            // laisser ses scripts ne lui donne aucun accès à la session.
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
            referrerPolicy="no-referrer"
            className="min-h-0 w-full flex-1 border-0 bg-white"
          />
          )}
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto pb-safe">
          {page.isPending ? (
            <p className="flex items-center gap-1.5 px-4 py-3 text-xs text-ink-faint">
              <Loader size={11} className="animate-spin" />
              {t('web.loading')}
            </p>
          ) : null}
          {page.error ? (
            <div className="flex flex-col gap-2 p-3">
              <Banner>{page.error instanceof Error ? page.error.message : t('web.error')}</Banner>
              <div className="flex items-center gap-3">
                <Button size="sm" onClick={() => setWebMode(scope, 'live')}>{t('web.mode.live')}</Button>
                <a href={url} target="_blank" rel="noopener noreferrer" className="text-sm text-accent underline">
                  {t('web.external')}
                </a>
              </div>
            </div>
          ) : null}
          {data && data.html === null ? (
            <div className="flex flex-col gap-2 p-3">
              <Banner tone="caution">{t('web.reader.notText', { type: data.contentType || '?' })}</Banner>
              <div>
                <Button size="sm" onClick={() => setWebMode(scope, 'live')}>{t('web.mode.live')}</Button>
              </div>
            </div>
          ) : null}
          {data?.html ? (
            <article className="mx-auto max-w-[44rem] px-5 py-4">
              <header className="mb-4 flex flex-col gap-1 border-b border-line pb-3">
                <p className="flex items-center gap-1.5 text-xs text-ink-faint">
                  <Globe size={11} />
                  {[data.siteName ?? new URL(data.url).hostname, data.byline].filter(Boolean).join(' · ')}
                </p>
                <h1 className="text-lg font-semibold text-ink">{data.title}</h1>
              </header>
              {/* Nettoyé par le serveur, liste blanche à l'appui : voir `web-reader.ts`. */}
              <div
                className="sg-reading sg-markdown sg-web-reader"
                onClick={onReaderClick}
                dangerouslySetInnerHTML={{ __html: data.html }}
              />
            </article>
          ) : null}
        </div>
      )}

      {viewing ? <ImageLightbox src={viewing.src} name={viewing.name} onClose={() => setViewing(null)} /> : null}
    </div>
  )
}
