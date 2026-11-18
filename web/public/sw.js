// تنظيم — عامل الخدمة: يخزّن واجهات الكشك وتطبيق الجوال لتفتح دون اتصال (البيانات تبقى من الخادم).
const CACHE = 'tanzeem-v1';
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['/m', '/kiosk', '/favicon.svg']).catch(() => {}))); self.skipWaiting(); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))); self.clients.claim(); });
self.addEventListener('fetch', (e) => {
    const u = new URL(e.request.url);
    if (e.request.method !== 'GET' || u.origin !== location.origin || u.pathname.startsWith('/api/') || u.pathname === '/ws') return;
    if (u.pathname.startsWith('/assets/')) {
        e.respondWith(caches.match(e.request).then((r) => r || fetch(e.request).then((res) => { const c = res.clone(); caches.open(CACHE).then((x) => x.put(e.request, c)); return res; })));
        return;
    }
    if (e.request.mode === 'navigate' && (u.pathname.startsWith('/m') || u.pathname.startsWith('/kiosk'))) {
        e.respondWith(fetch(e.request).then((res) => { const c = res.clone(); caches.open(CACHE).then((x) => x.put(u.pathname.startsWith('/kiosk') ? '/kiosk' : '/m', c)); return res; }).catch(() => caches.match(u.pathname.startsWith('/kiosk') ? '/kiosk' : '/m')));
    }
});
