/* Service worker: lần đầu vào cần mạng, sau đó dùng được OFFLINE.
   Chiến lược: mạng trước, thất bại thì lấy bản đã lưu (network-first).
   Chọn cách này chứ không phải cache-first, để mỗi lần bạn cập nhật nội dung
   trên GitHub thì thiết bị nhận bản mới ngay khi có mạng. */
const TEN = "hoc-tieng-anh-692fb8a72f";
self.addEventListener("install", e => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(
  caches.keys().then(ks => Promise.all(ks.filter(k => k !== TEN).map(k => caches.delete(k))))
    .then(() => self.clients.claim())));
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  /* HTTP cache của trình duyệt nằm TRƯỚC service worker: fetch() trần vẫn có
     thể lấy bản cũ trên đĩa dù máy đang có mạng, nên thiết bị chạy mãi bản cũ
     mà nhìn bề ngoài không biết. cache:"reload" buộc đi hỏi máy chủ thật. */
  e.respondWith(
    fetch(new Request(e.request, { cache: "reload" }))
      .then(r => { const c = r.clone(); caches.open(TEN).then(x => x.put(e.request, c)); return r; })
      .catch(() => fetch(e.request).catch(() => caches.match(e.request)))
  );
});
