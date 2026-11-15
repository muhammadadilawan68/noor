/* Noor offline service worker */
const V = "noor-v4";            // bump on each release
const FONTS = "noor-fonts";     // kept across releases
const CORE = ["./", "index.html", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png", "icons/maskable-512.png", "icons/apple-touch-icon.png"];
const FONT_CSS = "https://fonts.googleapis.com/css2?family=Amiri:wght@400;700&family=Noto+Nastaliq+Urdu:wght@400;600&family=Plus+Jakarta+Sans:wght@500;600;700;800&display=swap";

// A response that went through a redirect can't be served to a page on iPhone, so store a clean copy.
async function clean(res) {
  return res.redirected ? new Response(await res.clone().blob(), { status: 200, headers: res.headers }) : res.clone();
}
const isHtml = res => (res.headers.get("content-type") || "").includes("text/html");

// Each build of index.html carries <meta name="noor-build" content="YYYYMMDDhhmmss">.
const buildOf = t => (t.match(/<meta name="noor-build" content="(\d+)"/) || [])[1] || "0";
// Download the latest page; keep it only if it is NEWER than the saved one (never go backwards),
// then tell open pages so they can switch to it. Ticks live in localStorage and are never touched.
async function refreshIndex(url) {
  const res = await fetch(url || self.registration.scope, { cache: "no-cache", credentials: "same-origin" });
  if (!res.ok || !isHtml(res)) return;
  const text = await res.text();
  const c = await caches.open(V);
  const old = await c.match("index.html");
  const oldB = old ? buildOf(await old.text()) : "0";
  if (buildOf(text) <= oldB) return;
  await c.put("index.html", new Response(text, { headers: { "content-type": "text/html; charset=utf-8" } }));
  if (old) (await self.clients.matchAll({ type: "window", includeUncontrolled: true })).forEach(w => w.postMessage({ type: "noor-updated" }));
}
self.addEventListener("message", e => { if (e.data === "check") e.waitUntil(refreshIndex().catch(() => {})); });

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
    // cache each file on its own, so one missing file (e.g. an icon) can't stop offline mode
    await Promise.all(CORE.map(async u => {
      try {
        const res = await fetch(new Request(u, { cache: "reload" }));
        if (res.ok) await c.put(u, await clean(res));
      } catch (_) {}
    }));
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
      // show the saved copy instantly; fetch the latest copy in the background
      e.waitUntil(refreshIndex(r.url).catch(() => {}));
      e.respondWith((async () => {
        const hit = await (await caches.open(V)).match("index.html");
        if (hit) return hit;
        try { return await fetch(r); } catch (_) { return Response.error(); }
      })());
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
