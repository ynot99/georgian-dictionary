"use strict";

// Версію піднімати при зміні списку SHELL чи логіки кешування
const CACHE = "dict-shell-v1";
const SHELL = [
  "/",
  "/static/manifest.json",
  "/static/icon-192.png",
  "/static/icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// Без Wi-Fi (не просто "інтернет лежить") ОС намагається реально достукатись
// до локальної IP і fetch() провалюється не одразу, а аж через ~20-30с
// (TCP-таймаут) — за цей час сторінка "висить". Тому мережу обмежуємо коротким
// таймаутом і при його вичерпанні одразу падаємо в кеш.
const NETWORK_TIMEOUT_MS = 4000;

function fetchWithTimeout(request, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("network timeout")), timeoutMs);
    fetch(request).then(
      (res) => { clearTimeout(timer); resolve(res); },
      (err) => { clearTimeout(timer); reject(err); }
    );
  });
}

// Стратегія: network-first (з таймаутом) із падінням у кеш. Онлайн завжди
// свіжа версія (жодних проблем зі "застряглим" кешем), офлайн — остання
// збережена, і без довгого очікування.
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.pathname.startsWith("/api/")) return;

  e.respondWith(
    fetchWithTimeout(e.request, NETWORK_TIMEOUT_MS)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(async () => {
        const cached = await caches.match(e.request);
        if (cached) return cached;
        // офлайн-навігація на будь-яку адресу → головна сторінка
        if (e.request.mode === "navigate") {
          const shell = await caches.match("/");
          if (shell) return shell;
        }
        return Response.error();
      })
  );
});
