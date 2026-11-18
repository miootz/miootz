/**
 * Miootz service worker — precache-free build (Vite hashes assets).
 * Push notifications + offline outbox + stale-while-revalidate for read-only API GETs.
 */

const API_CACHE = 'miootz-api-swr-v1';
const scopePath = new URL(self.registration?.scope || self.location.origin).pathname.replace(/\/$/, '');
const room = /^\/(squad|matchday)$/.test(scopePath) ? scopePath : '';
const API_MAX_AGE_MS = {
  sessionsList: 5 * 60 * 1000,
  sessionDetail: 2 * 60 * 1000,
  me: 10 * 60 * 1000,
};

function apiCacheMaxAge(url) {
  const p = url.pathname.replace(/\/$/, '') || '/';
  if (p === '/api/users/me') return API_MAX_AGE_MS.me;
  if (p === '/api/sessions') return API_MAX_AGE_MS.sessionsList;
  if (/^\/api\/sessions\/\d+$/.test(p)) return API_MAX_AGE_MS.sessionDetail;
  return 0;
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(API_CACHE);
  const cached = await cache.match(request);
  const maxAge = apiCacheMaxAge(new URL(request.url));

  const isFresh = (res) => {
    if (!res) return false;
    const t = res.headers.get('sw-cached-at');
    if (!t) return false;
    return Date.now() - Number(t) < maxAge;
  };

  if (cached && isFresh(cached)) {
    return cached;
  }

  try {
    const network = await fetch(request);
    if (network.ok && network.type === 'basic') {
      const body = await network.clone().blob();
      const headers = new Headers(network.headers);
      headers.set('sw-cached-at', String(Date.now()));
      const toStore = new Response(body, {
        status: network.status,
        statusText: network.statusText,
        headers,
      });
      await cache.put(request, toStore.clone());
      return toStore;
    }
    return network;
  } catch (e) {
    if (cached) return cached;
    throw e;
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  // Demo rooms use their own IndexedDB; never reuse the legacy root API cache.
  if (room) return;
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (!url.pathname.startsWith('/api/')) return;
  if (apiCacheMaxAge(url) <= 0) return;

  event.respondWith(staleWhileRevalidate(request));
});

self.addEventListener('push', (event) => {
  if (room) return;
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    /* ignore */
  }
  const title = data.title || 'Miootz';
  const body = data.body || '';
  const url = data.url || '/';
  const actions = data.actions || [];

  // Map backend action descriptors to Web Notification action format.
  // Each action gets an { action, title } entry; the url is stored in a
  // lookup so the notificationclick handler can resolve it.
  const actionMap = {};
  const notifActions = actions.map((a, i) => {
    const key = `action-${i}`;          // unique action ID for the browser
    actionMap[key] = a.url || url;       // full URL to open on tap
    return { action: key, title: a.title };
  });

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: '/favicon.svg',
      badge: '/favicon.svg',
      actions: notifActions,
      data: { url, actionMap },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  if (room) return;
  event.notification.close();

  let urlPath = '/';
  try {
    const data = event.notification.data || {};
    urlPath = data.url || '/';
    // If the user tapped an action button, resolve its URL
    if (event.action && data.actionMap && data.actionMap[event.action]) {
      // actionMap stores full URLs — extract just the pathname
      const fullUrl = new URL(data.actionMap[event.action], self.location.origin);
      urlPath = fullUrl.pathname + fullUrl.search;
    }
  } catch {
    /* ignore */
  }
  // Fallback: check event.data (some browsers pass it differently)
  if (!urlPath || urlPath === '/') {
    try {
      const payload = event.data ? event.data.json() : {};
      urlPath = (payload && payload.url) || '/';
    } catch { /* ignore */ }
  }

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      if (clientList.length) {
        const client = clientList[0];
        const winUrl = new URL(client.url);
        if (winUrl.origin === self.location.origin) {
          return client.navigate(urlPath).then(() => client.focus());
        }
        return client.focus();
      }
      return self.clients.openWindow(urlPath);
    })
  );
});

const OFFLINE_DB_NAME = 'miootz-offline';
const OFFLINE_DB_VERSION = 1;

function openOfflineDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(OFFLINE_DB_NAME, OFFLINE_DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('cache')) {
        db.createObjectStore('cache');
      }
      if (!db.objectStoreNames.contains('outbox')) {
        db.createObjectStore('outbox', { keyPath: 'id' });
      }
    };
  });
}

function deleteOutboxId(db, id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('outbox', 'readwrite');
    tx.objectStore('outbox').delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function processOutboxFromSw() {
  const db = await openOfflineDb();
  const items = await new Promise((resolve, reject) => {
    const tx = db.transaction('outbox', 'readonly');
    const q = tx.objectStore('outbox').getAll();
    q.onsuccess = () => resolve(q.result);
    q.onerror = () => reject(q.error);
  });

  const origin = self.location.origin;

  for (const item of items) {
    try {
      if (item.type === 'chat') {
        const r = await fetch(`${origin}/api/sessions/${item.sessionId}/chat`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: item.message }),
        });
        if (r.ok) {
          const dbw = await openOfflineDb();
          await deleteOutboxId(dbw, item.id);
        }
      } else if (item.type === 'rating') {
        const r = await fetch(`${origin}/api/ratings/`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            session_id: item.sessionId,
            ratee_id: item.rateeId,
            score: item.score,
          }),
        });
        if (r.ok) {
          const dbw = await openOfflineDb();
          await deleteOutboxId(dbw, item.id);
        }
      }
    } catch (err) {
      console.warn('Miootz outbox sync failed for item', item?.id, err);
    }
  }
}

self.addEventListener('sync', (event) => {
  if (!room && event.tag === 'miootz-outbox') {
    event.waitUntil(processOutboxFromSw());
  }
});
