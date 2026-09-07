/* Service worker: lần đầu vào cần mạng, sau đó dùng được OFFLINE.
   Chiến lược: mạng trước, thất bại thì lấy bản đã lưu (network-first).
   Chọn cách này chứ không phải cache-first, để mỗi lần bạn cập nhật nội dung
   trên GitHub thì thiết bị nhận bản mới ngay khi có mạng. */
const TEN = "hoc-tieng-anh-d1174008ed";
self.addEventListener("install", e => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(
  caches.keys().then(ks => Promise.all(ks.filter(k => k !== TEN).map(k => caches.delete(k))))
    .then(() => self.clients.claim())));
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  /* File mp3 có thể nằm ở tên miền khác (repo audio riêng). Tên file là mã băm
     của nội dung nên KHÔNG BAO GIỜ đổi ruột — lấy bản đã lưu trước, khỏi hỏi
     lại máy chủ. Đi đường "mạng trước" như phần còn lại thì mỗi câu nghe lại
     là một lượt tải, và mất mạng là mất luôn audio.
     Chỉ lưu bản trả về đầy đủ (200): Safari xin từng khúc (206) thì cache.put
     ném lỗi, để nguyên cho trình duyệt tự lo. */
  if (new URL(e.request.url).origin !== self.location.origin) {
    e.respondWith(caches.match(e.request).then(da => da || fetch(e.request).then(r => {
      if (r.status === 200) {
        const ban = r.clone();
        caches.open(TEN).then(x => x.put(e.request, ban)).catch(() => {});
      }
      return r;
    }).catch(() => caches.match(e.request))));
    return;
  }
  /* HTTP cache của trình duyệt nằm TRƯỚC service worker: fetch() trần vẫn có
     thể lấy bản cũ trên đĩa dù máy đang có mạng, nên thiết bị chạy mãi bản cũ
     mà nhìn bề ngoài không biết. cache:"reload" buộc đi hỏi máy chủ thật. */
  e.respondWith(
    fetch(new Request(e.request, { cache: "reload" }))
      .then(r => { const c = r.clone(); caches.open(TEN).then(x => x.put(e.request, c)); return r; })
      .catch(() => fetch(e.request).catch(() => caches.match(e.request)))
  );
});
