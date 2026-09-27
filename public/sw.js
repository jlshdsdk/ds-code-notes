/* 数据结构代码笔记 · 应用外壳缓存
 * 策略：页面导航 network-first（部署即生效，断网回退缓存）；
 * 带哈希的 /assets/* cache-first（内容不可变）；跨域请求（Supabase/Wandbox）不拦截。
 * 资源文件名带内容哈希，sw.js 无需随部署改版本。
 */
const CACHE = 'ds-notes-shell-v1';

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll([new URL('index.html', self.registration.scope).href]))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // Supabase / Wandbox 直连
  const base = self.registration.scope;       // 形如 /ds-code-notes/
  const indexPath = new URL('index.html', base).href;

  if (req.mode === 'navigate' || url.href === indexPath) {
    e.respondWith(
      fetch(req)
        .then((resp) => {
          const copy = resp.clone();
          caches.open(CACHE).then((c) => c.put(indexPath, copy));
          return resp;
        })
        .catch(() => caches.match(indexPath).then((hit) => hit || Response.error()))
    );
    return;
  }

  if (url.pathname.startsWith(new URL('assets/', base).pathname)) {
    e.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((resp) => {
            const copy = resp.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
            return resp;
          })
      )
    );
  }
});
