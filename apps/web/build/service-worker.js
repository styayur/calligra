const scope = self.registration.scope
const prefix = 'calligra:' + scope + '|'
const generation = prefix + '@@REVISION@@'
const shell = @@SHELL@@
const fonts = @@FONTS@@
const absolute = (file) => new URL(file, scope).href
const shellUrls = new Set(shell.map(absolute))

async function cacheInGroups(cache, files) {
  for (let index = 0; index < files.length; index += 8) {
    const requests = files.slice(index, index + 8).map((file) =>
      new Request(absolute(file), { cache: 'reload' }))
    await cache.addAll(requests)
  }
}

self.addEventListener('install', (event) => {
  // The active worker keeps serving its own complete shell until all its tabs close.
  event.waitUntil(caches.open(generation).then((cache) => cacheInGroups(cache, shell))
    .catch(async (error) => { await caches.delete(generation); throw error }))
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys()
    await Promise.all(names.filter((name) => name.startsWith(prefix) && name !== generation)
      .map((name) => caches.delete(name)))
    await self.clients.claim()
  })())
})

async function cachedFont(cache, file, url) {
  const cached = await cache.match(url)
  if (cached) return cached
  const response = await fetch(new Request(url, { cache: 'reload', redirect: 'error' }))
  if (!response.ok) throw new Error('Font download failed')
  const digest = await crypto.subtle.digest('SHA-256', await response.clone().arrayBuffer())
  const checksum = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  if (checksum !== fonts[file]) throw new Error('Font checksum differs from the offline build')
  try {
    await cache.put(url, response.clone())
  } catch (error) {
    // A full browser cache must not block ordinary, online composition.
    if (error.name !== 'QuotaExceededError') throw error
  }
  return response
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET' || !request.url.startsWith(scope)) return
  const url = new URL(request.url)
  const file = url.href.slice(scope.length)
  const key = request.mode === 'navigate' && (url.pathname === new URL(scope).pathname ||
    url.pathname === new URL('index.html', scope).pathname) ? absolute('index.html') : url.href
  if (shellUrls.has(key)) {
    event.respondWith(caches.open(generation).then(async (cache) => await cache.match(key) || fetch(request)))
  } else if (Object.hasOwn(fonts, file)) {
    event.respondWith(caches.open(generation).then((cache) => cachedFont(cache, file, url.href)))
  }
})

self.addEventListener('message', (event) => {
  if (!['offline-status', 'offline-prepare'].includes(event.data?.type) || event.ports.length !== 1) return
  const port = event.ports[0]
  event.waitUntil((async () => {
    try {
      const cache = await caches.open(generation)
      const entries = Object.keys(fonts)
      if (event.data.type === 'offline-prepare') {
        for (const file of entries) await cachedFont(cache, file, absolute(file))
      }
      const cached = await Promise.all(entries.map((file) => cache.match(absolute(file))))
      port.postMessage({ ready: cached.every(Boolean) })
    } catch {
      port.postMessage({ ready: false })
    }
  })())
})
