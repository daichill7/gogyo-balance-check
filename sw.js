/* 最小構成のService Worker: PWAインストール要件を満たすための素通し。
   キャッシュはバージョン付きURL(?v=)とCDN側に任せる */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (e) => {
  e.respondWith(fetch(e.request).catch(() =>
    new Response("オフラインです。通信環境を確認してください。", {
      status: 503,
      headers: { "content-type": "text/plain; charset=utf-8" }
    })
  ));
});
