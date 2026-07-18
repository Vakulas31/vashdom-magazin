// Service worker приложения «ВашДом — Журнал заказов».
// Версия подставляется сборкой (build.mjs) из APP_VERSION — при каждом деплое
// новой версии кэш обновляется автоматически.
var CACHE = 'vashdom-7.0.1';
var SHELL = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);

  // Supabase — только сеть (данные всегда свежие, ошибки видны честно)
  if (url.hostname.indexOf('supabase') >= 0) return;

  // CDN-библиотеки (xlsx) — кэш-первым: быстро и работает без интернета
  if (url.hostname.indexOf('cdnjs.cloudflare.com') >= 0) {
    e.respondWith(
      caches.match(req).then(function (hit) {
        if (hit) return hit;
        return fetch(req).then(function (res) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
          return res;
        });
      })
    );
    return;
  }

  // Своё приложение — сеть-первым (обновления приходят сразу),
  // при отсутствии сети — из кэша (оффлайн-запуск)
  if (url.origin === location.origin) {
    e.respondWith(
      fetch(req).then(function (res) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); });
        return res;
      }).catch(function () {
        return caches.match(req).then(function (hit) {
          return hit || caches.match('./index.html');
        });
      })
    );
  }
});
