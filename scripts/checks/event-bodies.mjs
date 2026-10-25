import assert from 'node:assert/strict'

export async function checkEventBodies(page) {
  const result = await page.evaluate(async () => {
    const React = (await import('/node_modules/.vite/deps/react.js')).default
    const { createRoot } = (await import('/node_modules/.vite/deps/react-dom_client.js')).default
    const source = await (await fetch('/src/lib/tool-output.ts')).text()
    const { QueryClient, QueryClientProvider } = await import(source.match(/from ["']([^"']*tanstack[^"']+)["']/)[1])
    const { ToolCall } = await import('/src/components/chat/ToolCall.tsx')
    const { DiffCard } = await import('/src/components/chat/DiffCard.tsx')
    const client = new QueryClient()
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    const originalFetch = window.fetch
    const requests = []
    const checked = []
    let slow = false, fail = false
    const releases = []
    const pause = () => new Promise((resolve) => setTimeout(resolve, 10))
    const until = async (predicate) => {
      for (let attempt = 0; attempt < 500; attempt++) { if (predicate()) return; await pause() }
      throw new Error('Body UI timed out: ' + host.textContent.slice(0, 400))
    }
    const check = (value, message) => { if (!value) throw new Error(message) }
    window.fetch = async (url, options) => {
      if (!String(url).includes('/body/')) return originalFetch(url, options)
      requests.push({ url, signal: options.signal })
      if (slow) await new Promise((resolve) => { releases.push(resolve) })
      if (fail) return new Response(JSON.stringify({ error: { code: 'test_failure', message: 'Unavailable fixture' } }), { status: 503 })
      return new Response(JSON.stringify({ value: String(url).endsWith('/input') ? { file_path: 'restored.txt', content: 'Full input restored' } : String(url).endsWith('/patch') ? '+Full patch restored' : 'Full output restored' }))
    }
    const tool = { kind: 'tool', id: 'body-tool', ts: 1, name: 'test-tool', input: { file_path: 'restored.txt' }, inputRef: { seq: 2, field: 'input' }, output: null, outputBytes: 20000, outputRef: { seq: 4, field: 'output' }, status: 'done', durationMs: 1, parentToolCallId: null }
    const diff = { kind: 'diff', id: 'diff', files: [{ path: 'restored.txt', added: 1, removed: 0 }], patch: '', patchRef: { seq: 5, field: 'patch' } }
    const before = JSON.stringify([tool, diff])
    const cachedBodies = () => client.getQueryCache().getAll().filter((query) => query.queryKey[0] === 'event-body' && query.state.data !== undefined)
    function render() {
      root.render(React.createElement(QueryClientProvider, { client },
        React.createElement(ToolCall, { tool, conversationId: 'c' }), React.createElement(DiffCard, { item: diff, conversationId: 'c' })))
    }
    const toggle = () => host.querySelector('button[aria-expanded]').click()
    try {
      render()
      await until(() => host.querySelector('button[aria-expanded]'))
      check(requests.length === 0, 'Collapsed tools/diffs fetched bodies')
      slow = true
      toggle()
      await until(() => requests.length === 2)
      toggle()
      await until(() => requests.every((request) => request.signal.aborted))
      releases.splice(0).forEach((release) => release())
      checked.push('fermer annule les requêtes')
      slow = false
      toggle()
      await until(() => host.textContent.includes('Full input restored') && host.textContent.includes('Full output restored'))
      check(cachedBodies().length === 2, 'Open card lost its bodies')
      toggle()
      await until(() => cachedBodies().length === 0)
      checked.push('corps complets à l’ouverture, aucun cache inactif')
      fail = true
      toggle()
      await until(() => host.textContent.includes('Unavailable fixture'))
      toggle()
      await pause()
      fail = false
      toggle()
      await until(() => host.textContent.includes('Full output restored'))
      checked.push('erreur puis nouvel essai en rouvrant')
      host.querySelector('summary').click()
      await until(() => host.textContent.includes('Full patch restored'))
      check(JSON.stringify([tool, diff]) === before, 'Heavy bodies contaminated the fold/snapshots')
      checked.push('patch rendu sans toucher aux références')
      root.render(null)
      await until(() => cachedBodies().length === 0)
      check(requests.every(({ signal }) => signal instanceof AbortSignal), 'Missing abort signal')
      return checked
    } finally {
      root.unmount(); host.remove(); client.clear(); window.fetch = originalFetch
    }
  })
  assert.equal(result.length, 4)
  console.log(`OK : corps à la demande (${page.viewportSize().width}px) : ${result.join(', ')}.`)
}

export async function checkEventImages(page) {
  const src = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 320
    canvas.getContext('2d').fillRect(0, 0, 640, 320)
    return canvas.toDataURL('image/png')
  })
  const png = Buffer.from(src.split(',')[1], 'base64')
  let release
  const gate = new Promise((resolve) => { release = resolve })
  const requests = []
  await page.route('**/api/conversations/c/events/1/images/*', async (route) => {
    requests.push(route.request().url())
    await gate
    if (route.request().url().endsWith('/2')) return route.fulfill({ status: 404 })
    await route.fulfill({ contentType: 'image/png', body: png })
  })
  try {
    await page.evaluate(async () => {
      const React = (await import('/node_modules/.vite/deps/react.js')).default
      const { createRoot } = (await import('/node_modules/.vite/deps/react-dom_client.js')).default
      const { ImageThumbnail } = await import('/src/components/ImageThumbnail.tsx')
      const spacer = document.createElement('div'); spacer.id = 'body-image-check'; spacer.style.height = '5500px'
      const host = document.createElement('div'); host.id = 'body-image-host'; host.style.cssText = 'max-width:720px;margin:auto;padding:16px'
      document.body.append(spacer, host)
      const root = createRoot(host)
      window.imageCheckRoot = root
      root.render(React.createElement(ImageThumbnail, { src: '/api/conversations/c/events/1/images/1', name: 'Image', alt: 'Image différée', width: 640, height: 320, maxHeight: 224, loading: 'lazy', className: 'max-h-56 max-w-full' }))
      window.scrollTo(0, 0)
    })
    await page.waitForTimeout(100)
    assert.equal(requests.length, 0, 'Offscreen image loaded eagerly')
    const img = page.locator('#body-image-host img')
    await img.scrollIntoViewIfNeeded()
    await page.waitForTimeout(50)
    assert.ok(requests.length > 0, 'Visible image never requested its body')
    const before = await img.boundingBox()
    release()
    await page.waitForFunction(() => document.querySelector('#body-image-host img')?.naturalWidth === 640)
    const after = await img.boundingBox()
    assert.equal(Math.round(before.height), Math.round(after.height), 'Image shifted after decoding')
    assert.equal(Math.round(before.width), Math.round(after.width), 'Image width shifted after decoding')
    assert.ok(after.width <= page.viewportSize().width)
    assert.ok(Math.abs(after.width / after.height - 2) < 0.02, `Image box lost its aspect ratio: ${JSON.stringify(after)}`)
    await page.evaluate(async () => {
      const React = (await import('/node_modules/.vite/deps/react.js')).default
      const { ImageThumbnail } = await import('/src/components/ImageThumbnail.tsx')
      window.imageCheckRoot.render(React.createElement(ImageThumbnail, { key: 'missing', src: '/api/conversations/c/events/1/images/2', name: 'Image', alt: 'Image absente', width: 640, height: 320, maxHeight: 224 }))
    })
    await page.locator('#body-image-host [role="alert"]').waitFor()
    console.log(`OK : image différée, place réservée sans saut, et erreur affichée (${page.viewportSize().width}px).`)
  } finally {
    release()
    await page.evaluate(() => { window.imageCheckRoot?.unmount(); document.getElementById('body-image-check')?.remove(); document.getElementById('body-image-host')?.remove() })
    await page.unroute('**/api/conversations/c/events/1/images/*')
  }
}
