/**
 * Cockpit service worker — offline shell only.
 *
 * The deck is a live view of a running machine, so data is never cached: every
 * `/cockpit/api/*` request goes straight to the network (and fails visibly when
 * the workspace is down). Only the shell (HTML/CSS/JS/icons/manifest) is
 * precached, with stale-while-revalidate so a refresh picks up a new build
 * while still opening instantly offline.
 */

const VERSION = 'cockpit-v2'
const SHELL = [
  './',
  './index.html',
  './app.css',
  './app.js',
  './whale.svg',
  './favicon.svg',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
]

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION)
    // Precache item by item: a single missing file must not abort the install.
    await Promise.all(SHELL.map((path) => cache.add(new Request(path, { cache: 'reload' })).catch(() => undefined)))
    await self.skipWaiting()
  })())
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys()
    await Promise.all(keys.filter((key) => key.startsWith('cockpit-') && key !== VERSION).map((key) => caches.delete(key)))
    await self.clients.claim()
  })())
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  // Live data: never served from cache.
  if (url.pathname.startsWith('/cockpit/api/')) return

  if (url.pathname === '/cockpit' || url.pathname === '/cockpit/') {
    event.respondWith(shellResponse('./index.html', request, event))
    return
  }

  if (url.pathname.startsWith('/cockpit/')) {
    event.respondWith(shellResponse(url.pathname, request, event))
  }
})

async function shellResponse(path, request, event) {
  const cache = await caches.open(VERSION)
  const key = new Request(path)
  const cached = await cache.match(key)
  const network = fetch(request).then(async (response) => {
    if (response.ok) await cache.put(key, response.clone())
    return response
  }).catch(() => null)

  if (cached !== undefined) {
    // Revalidate in the background; serve the cached shell immediately.
    event.waitUntil(network)
    return cached
  }
  const response = await network
  if (response !== null) return response
  if (path.endsWith('.html') || path === './index.html') {
    return (await cache.match('./index.html')) ?? Response.error()
  }
  return Response.error()
}
