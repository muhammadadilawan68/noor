/* Noor offline service worker */
const V = "noor-v1";            // bump on each release
const FONTS = "noor-fonts";     // kept across releases
const CORE = ["./", "index.html", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png", "icons/maskable-512.png", "icons/apple-touch-icon.png"];
const FONT_CSS = "https://fonts.googleapis.com/css2?family=Amiri:wght@400;700&family=Noto+Nastaliq+Urdu:wght@400;600&family=Plus+Jakarta+Sans:wght@500;600;700;800&display=swap";

async function cacheFonts() {
  const c = await caches.open(FONTS);
  if (await c.match(FONT_CSS, { ignoreVary: true })) return;
  const r = await fetch(FONT_CSS, { mode: "cors" });
  if (!r.ok) return;
  const css = await r.clone().text();
  const urls = [...new Set([...css.matchAll(/url\((https:[^)]+)\)/g)].map(m => m[1]))];
  await Promise.all(urls.map(u => fetch(u, { mode: "cors" }).then(f => f.ok && c.put(u, f)).catch(() => {})));
  await c.put(FONT_CSS, r);
}

self.addEventListener("install", e => {
  e.waitUntil((async () => {
    const c = await caches.open(V);
    await c.addAll(CORE.map(u => new Request(u, { cache: "reload" })));
    try { await cacheFonts(); } catch (_) {}
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== V && k !== FONTS) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", e => {
  const r = e.request;
  if (r.method !== "GET") return;
  const u = new URL(r.url);
  if (u.origin === location.origin) {
    if (r.mode === "navigate") {
      // show the saved copy instantly; refresh it in the background for next time
      const net = fetch(r, { cache: "no-cache" }).then(async res => {
        if (res.ok) { const c = await caches.open(V); await c.put("index.html", res.clone()); }
        return res;
      }).catch(() => null);
      e.waitUntil(net);
      e.respondWith(caches.open(V).then(c => c.match("index.html")).then(h => h || net.then(x => x || Response.error())));
      return;
    }
    e.respondWith(caches.match(r, { ignoreSearch: true }).then(h => h || fetch(r)));
    return;
  }
  if (u.hostname === "fonts.googleapis.com" || u.hostname === "fonts.gstatic.com") {
    e.respondWith((async () => {
      const c = await caches.open(FONTS);
      const h = await c.match(r.url, { ignoreVary: true });
      if (h) return h;
      try {
        const res = await fetch(r);
        if (res.ok || res.type === "opaque") c.put(r.url, res.clone());
        return res;
      } catch (_) { return Response.error(); }
    })());
  }
});
