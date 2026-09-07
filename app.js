/* App học tiếng Anh — logic giao diện.
   Âm thanh dùng Web Speech API (giọng en-GB có sẵn trong Windows) nên chạy được ngay,
   không phải chờ tạo hàng nghìn file mp3. Nếu đã chạy tao_audio.py thì app tự
   dùng file mp3 chất lượng cao hơn. */

const S = {
  unit: null, tab: "bai-hoc", muc_luc: [], cauHinh: {}, duLieuUnit: null,
  tienDo: { unit: {}, phut_theo_ngay: {} },
  giong: null, tocDo: +(localStorage.getItem("tocDo") || 1),
  phatMauCau: { dang: false, i: 0, lap: 2, cho: 3, danhSach: [] },
  phutBatDau: Date.now(),
  railMo: new Set(),     // unit đang bung ra trong thanh tiến trình bên trái
  railGap: new Set(),    // nhóm đang thu gọn ở menu trái (khoá chuỗi)
  level: null,           // level đang xem ở màn Level
  railGon: false,        // menu trái đang thu hẹp hẳn
  railDay: "thoang",     // khoảng cách các dòng menu: thoang | gon
  khoiGap: new Set(),    // khối nội dung đang thu gọn trong màn học
  khoiBiet: new Set(),   // khối đã từng hiện ra (để chỉ áp mặc định một lần)
};

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

/* ================= hồ sơ người học =================
   Nhiều người dùng chung một máy thì tiến độ phải tách ra, không thì người này
   đánh dấu "đã học" là người kia mất dấu.

   Thay vì sửa hơn ba chục chỗ gọi fetch, bọc luôn window.fetch để mọi lời gọi
   /api/ tự đính kèm hồ sơ đang chọn. Bản tĩnh cũng chạy được vì shim_tinh.js
   nạp TRƯỚC app.js, nên lớp bọc này nằm ngoài và gọi vào shim. */
const HS = {
  id: localStorage.getItem("ho_so") || "mac_dinh",
  ds: [{ id: "mac_dinh", ten: "User" }],
  ten: () => (HS.ds.find(h => h.id === HS.id) || {}).ten || "User",
  // Khoá localStorage riêng cho từng hồ sơ (số câu đã nghe ở tab Mẫu câu)
  khoa: k => `${k}__${HS.id}`,
};

const fetchGoc = window.fetch.bind(window);
window.fetch = (url, opts) => {
  if (typeof url === "string" && url.startsWith("/api/")) {
    url += (url.includes("?") ? "&" : "?") + "ho_so=" + encodeURIComponent(HS.id);
  }
  return fetchGoc(url, opts);
};
const esc = s => (s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/* Số câu đã nghe ở tab Mẫu câu.

   Trước đây để riêng trong localStorage nên hỏng hai chỗ: đổi thiết bị là mất,
   và không đi cùng tiến độ khi đồng bộ — màn hình danh sách cứ hiện "nghe 0
   câu" dù đã nghe xong. Giờ nằm trong tien_do.nghe như mọi thứ khác.

   Ghi có tiết chế: lúc phát tự động thì vài giây lại sang câu mới, gọi server
   từng câu là thừa. Giữ số trong bộ nhớ để màn hình đúng ngay, còn gửi đi thì
   gộp lại sau 5 giây. */
/* Kéo số đếm của bản cũ về tiến độ, làm một lần.

   Có hai đời khoá cũ: "nghe-3" (trước khi có hồ sơ) và "nghe-3__mac_dinh"
   (sau khi có hồ sơ). Cả hai đều nằm ngoài tiến độ nên không đồng bộ được.
   Gom hết rồi xoá, để lần sau không quét lại. */
async function diTruSoCauDaNghe() {
  const gui = {};
  for (const khoa of Object.keys(localStorage)) {
    const m = khoa.match(/^nghe-(\d+)(?:__(.+))?$/);
    if (!m) continue;
    if (m[2] && m[2] !== HS.id) continue;        // của hồ sơ khác, để yên
    const so = m[1], n = +localStorage.getItem(khoa) || 0;
    if (n > +(S.tienDo.nghe[so] || 0)) { S.tienDo.nghe[so] = n; gui[so] = n; }
    localStorage.removeItem(khoa);
  }
  if (!Object.keys(gui).length) return;
  try {
    await fetch("/api/tien_do", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nghe: gui }),
    });
  } catch (e) { /* mất mạng thì lần sau vẫn còn trong S.tienDo */ }
}

let henGhiNghe = null;
function ghiSoCauDaNghe(soUnit, soCau) {
  S.tienDo.nghe ||= {};
  if (soCau <= +(S.tienDo.nghe[soUnit] || 0)) return;
  S.tienDo.nghe[soUnit] = soCau;

  clearTimeout(henGhiNghe);
  henGhiNghe = setTimeout(() => {
    fetch("/api/tien_do", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nghe: { [soUnit]: S.tienDo.nghe[soUnit] } }),
    }).catch(() => {});
  }, 5000);
}

/* ================= âm thanh ================= */
let dsGiong = [];
function napGiong() {
  dsGiong = speechSynthesis.getVoices().filter(v => /^en(-|_)/i.test(v.lang));
  const sel = $("#cd-giong");
  if (!sel) return;
  const uuTien = dsGiong.filter(v => /en-GB/i.test(v.lang));
  const cuoi = uuTien.length ? uuTien : dsGiong;
  sel.innerHTML = cuoi.map(v => `<option value="${esc(v.name)}">${esc(v.name)} — ${v.lang}</option>`).join("");
  const luu = localStorage.getItem("giong");
  if (luu && cuoi.some(v => v.name === luu)) sel.value = luu;
  S.giong = dsGiong.find(v => v.name === sel.value) || cuoi[0] || null;
}
speechSynthesis.onvoiceschanged = napGiong;

/* ================= giọng theo vai (tab Hội thoại) =================
   Hội thoại mà một giọng đọc hết cả hai vai thì nghe như đọc kịch bản, không
   ra đối thoại: người học không nhận được lượt nào của ai, mất luôn phần quan
   trọng nhất là NGHE RA AI ĐANG NÓI.

   Cách chọn: lấy giọng đang đặt cho vai đầu tiên, các vai sau lần lượt lấy
   giọng khác — ưu tiên đổi giới tính trước, vì khác giới dễ phân biệt hơn
   nhiều so với hai giọng cùng giới khác vùng miền.

   Máy nào chỉ có một giọng tiếng Anh thì mọi vai vẫn dùng giọng đó — thà nghe
   giống nhau còn hơn đọc bằng giọng tiếng Việt. */
const _giongTheoVai = new Map();

/* Xoay vòng giọng theo chỉ số câu — dùng cho tab Mẫu câu.

   Nghe năm chục câu liền một giọng thì tai quen đặc trưng của giọng đó rồi
   đoán ra chữ chứ không còn nghe ra ÂM nữa. Đổi giọng liên tục buộc tai nghe
   thật, và cũng đỡ chán khi ngồi nghe cả loạt. */
function giongXoayVong(i) {
  if (i == null || dsGiong.length < 2) return null;
  return dsGiong[i % dsGiong.length];
}

const _laNu = v => /female|zira|hazel|susan|sonia|libby|aria|jenny|samantha|karen|moira|tessa|fiona/i.test(v.name);

function giongChoVai(vai) {
  if (!vai || !dsGiong.length) return null;
  const khoa = String(vai).trim().toLowerCase();
  if (_giongTheoVai.has(khoa)) return _giongTheoVai.get(khoa);

  /* Vai thứ nhất NỮ, vai thứ hai NAM — cùng luật với bản mp3 (tao_audio.py).

     Trước đây chọn theo kiểu "khác với giọng đang đặt", nên ai để giọng mặc
     định là nữ thì vai A lại bị gán giọng nam: unit 1 nhân vật Hoa hoá đàn
     ông. Giọng mặc định của người dùng không nói lên giới tính nhân vật. */
  const thuTu = _giongTheoVai.size;
  const nu = dsGiong.filter(_laNu);
  const nam = dsGiong.filter(v => !_laNu(v));
  const nhom = thuTu % 2 === 0 ? nu : nam;
  const duPhong = thuTu % 2 === 0 ? nam : nu;
  const buoc = Math.floor(thuTu / 2);

  const chon = nhom.length ? nhom[buoc % nhom.length]
    : duPhong.length ? duPhong[buoc % duPhong.length]
      : dsGiong[thuTu % dsGiong.length];
  _giongTheoVai.set(khoa, chon);
  return chon;
}

/* Đọc một câu. Ưu tiên file mp3 đã tạo sẵn bằng edge-tts (ngữ điệu gần người
   thật hơn nhiều), không có thì dùng giọng máy của Windows. */
let banDoAudio = null, dangPhat = null;

function doc(text, { tocDo, xong, cham, vai, xoay } = {}) {
  if (!text) return;
  speechSynthesis.cancel();
  if (dangPhat) { dangPhat.pause(); dangPhat = null; }

  const khoa = `${text.trim()}|${cham ? "cham" : "binh_thuong"}`;
  const ten = S.dungAudioSan && banDoAudio?.cau?.[khoa];
  if (ten) {
    /* Đường dẫn TƯƠNG ĐỐI: bản tĩnh có thể nằm trong thư mục con
       (github.io/learn-english/ hoặc /hoc-tieng-anh/ trên hosting riêng), dùng
       "/audio/..." là trỏ về gốc tên miền và hỏng.
       goc_audio khác rỗng = audio nằm ở tên miền khác (repo audio riêng), lúc
       đó dùng nguyên địa chỉ đầy đủ. */
    const a = new Audio((S.cauHinh?.goc_audio || "audio/") + ten);
    /* Trước đây mp3 luôn chạy 1.0 nên thanh "Tốc độ đọc" chỉ ăn vào giọng máy
       Windows — bật audio chất lượng cao là cài đặt như không có.
       preservesPitch: chậm lại mà không giữ cao độ thì giọng tụt xuống ồm ồm,
       nghe sai cả nguyên âm, luyện nghe theo đó là hỏng. */
    a.playbackRate = tocDo ?? S.tocDo;
    a.preservesPitch = a.mozPreservesPitch = a.webkitPreservesPitch = true;
    if (xong) a.onended = xong;
    a.onerror = () => docBangMay(text, tocDo, xong, vai, xoay);   // thiếu file thì quay về giọng máy
    dangPhat = a;
    a.play().catch(() => docBangMay(text, tocDo, xong, vai, xoay));
    return;
  }
  docBangMay(text, tocDo, xong, vai, xoay);
}

/* Giọng tiếng Anh gặp tên riêng tiếng Việt thì đánh vần từng chữ cái —
   "Hoa" đọc thành "ết âu ây". Viết lại theo lối chính tả tiếng Anh TRƯỚC KHI
   đưa cho máy đọc; chữ hiện trên màn hình vẫn giữ nguyên tên thật. */
/* ĐỊA DANH — thay CẢ CỤM, và thay TRƯỚC tên người.
   "Da" đứng một mình là chữ cái nên giọng máy đọc "Da Nang" thành
   "Đi-Ây-Nang". Nhưng không được thay mọi chữ "Da": chỉ đổi khi nó nằm trong
   tên địa danh. Bảng này phải GIỐNG HỆT bảng trong tao_audio.py — lệch nhau
   thì mp3 đọc một kiểu, giọng máy đọc một kiểu. */
const DOI_DIA_DANH = {
  "Da Nang": "Dah Nang", "Da Lat": "Dah Lat",
  "Ha Noi": "Ha Noy", "Hanoi": "Ha Noy",
  "Ho Chi Minh": "Ho Chee Ming",
  "Nha Trang": "Nya Chang", "Phu Quoc": "Foo Kwock",
  "Vung Tau": "Voong Tao", "Can Tho": "Kan Ther",
  "Hoi An": "Hoy An", "Hai Phong": "High Fong",
  "Sa Pa": "Sah Pah", "Ninh Binh": "Ning Bing",
  "Hue": "Hway", "Pho": "Fuh", "Tet": "Tet",
  "Banh mi": "Bang mee", "Ao dai": "Ow zai",
  // "My Dinh" phải nằm ở bảng ĐỊA DANH chứ không tách ra: để nguyên thì "My"
  // bị đọc thành từ sở hữu "my".
  "Binh Duong": "Bing Zoong", "My Dinh": "Mee Ding", "Le Loi": "Lay Loy",
};
const DOI_TEN_DOC = {
  Hoa: "Hwah", Linh: "Ling", Minh: "Ming", Chi: "Chee", Thao: "Tao",
  Huong: "Hoong", Ngoc: "Ngock", Phuong: "Foong", Tuan: "Twan", Nga: "Ngah",
  Quang: "Kwang", Trang: "Chang", Yen: "Yenn", Hanh: "Hahn", Duc: "Dook",
  Loan: "Lwan", Nhung: "Nyoong", Oanh: "Wahn", Xuan: "Swan", Vinh: "Ving",
  // Họ và tên đệm. Trước đây bảng chỉ có TÊN GỌI nên "Tran Minh Duc" ra
  // "Tran Minh Dook" — sửa được mỗi chữ cuối, hai chữ đầu vẫn đọc kiểu Anh.
  // Giọng Anh đọc "Le" thành /lə/, "Thi" thành /θiː/, "Tran" thành /træn/.
  // KHÔNG thêm "Do", "Ho", "Anh": "Do" là trợ động từ, xuất hiện 422 lần
  // trong giáo trình; "Ho" nằm trong "Ho Chi Minh" đã được bảng địa danh xử
  // lý trước; "Anh" là chữ "tiếng Anh" trong phần dịch.
  "Nguyen": "Nwen", "Tran": "Chun", "Le": "Lay", "Pham": "Fam",
  "Hoang": "Hwang", "Huynh": "Hwing", "Phan": "Fan", "Vu": "Voo",
  "Vo": "Vaw", "Dang": "Dahng", "Bui": "Booy", "Ngo": "Ngaw",
  "Ly": "Lee", "Van": "Vahn", "Thi": "Tee", "Doan": "Zwan",
  "Truong": "Chwong", "Dinh": "Ding",
};
/* Cụm dài thay trước cụm ngắn: "Ho Chi Minh" phải khớp trước "Ho". */
const RE_DIA_DANH = new RegExp(
  Object.keys(DOI_DIA_DANH).sort((a, b) => b.length - a.length)
    .map(k => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "g");

const chuanGiongDoc = t =>
  String(t)
    // địa danh TRƯỚC: để tên người chạy trước thì "Ho Chi Minh" đã bị đổi
    // "Minh" thành "Ming", cụm không còn khớp nữa
    .replace(RE_DIA_DANH, w => DOI_DIA_DANH[w])
    .replace(/\b[A-Z][a-z]{1,6}\b/g, w => DOI_TEN_DOC[w] || w);

function docBangMay(text, tocDo, xong, vai, xoay) {
  const u = new SpeechSynthesisUtterance(chuanGiongDoc(text));
  const g = giongXoayVong(xoay) || giongChoVai(vai) || S.giong;
  if (g) u.voice = g;
  u.lang = g?.lang || "en-GB";
  u.rate = tocDo ?? S.tocDo;
  if (xong) u.onend = xong;
  speechSynthesis.speak(u);
}
/* ================= TỐC ĐỘ ĐỌC =================
   Một giá trị duy nhất cho cả app (S.tocDo), đổi được từ ba chỗ: thanh phát
   của Truyện/Hội thoại, hàng nút của Mẫu câu, và Cài đặt → Âm thanh. Ba chỗ
   cùng ghi vào một nơi nên không bao giờ lệch nhau. */
const CAC_TOC_DO = [0.6, 0.75, 0.9, 1, 1.15, 1.3];
const nhanTocDo = v => String(v) + "×";

function datTocDo(v) {
  S.tocDo = Math.min(1.5, Math.max(0.5, +v || 1));
  localStorage.setItem("tocDo", S.tocDo);
  /* Đang phát dở thì đổi luôn, không bắt bấm lại từ đầu — chỉnh tốc độ là
     lúc người học đang nghe và thấy nhanh/chậm quá. */
  if (dangPhat) dangPhat.playbackRate = S.tocDo;
  $$(".ct-toc").forEach(b => {
    b.textContent = nhanTocDo(S.tocDo);
    b.title = `Tốc độ đọc ${nhanTocDo(S.tocDo)} — bấm để đổi`;
  });
  const t = $("#cd-toc-do"), h = $("#cd-toc-do-hien");
  if (t) t.value = S.tocDo;
  if (h) h.textContent = nhanTocDo(S.tocDo);
}

/* Bấm xoay vòng qua các mức có sẵn. Vì sao không dùng thanh trượt ngay trên
   thanh phát: thanh trượt cần chỗ và cần nhắm chuột, còn ở đây chỉ cần một
   nút bằng đầu ngón tay. Muốn chỉnh mịn hơn thì vào Cài đặt → Âm thanh. */
function xoayTocDo() {
  const i = CAC_TOC_DO.findIndex(v => v >= S.tocDo - 0.001);
  datTocDo(CAC_TOC_DO[(i < 0 ? 0 : i + 1) % CAC_TOC_DO.length]);
}

const nutTocDo = () => `<button class="nut-tron phu2 ct-toc" onclick="xoayTocDo()"
    title="Tốc độ đọc ${nhanTocDo(S.tocDo)} — bấm để đổi"
    aria-label="Tốc độ đọc">${nhanTocDo(S.tocDo)}</button>`;

const nutLoa = t => `<button class="loa" onclick="doc(${JSON.stringify(t).replace(/"/g, "&quot;")})" title="Nghe">🔊</button>`;

/* ================= hiển thị câu (chạm từng từ) ================= */
/* Bọc từng từ vào <span> để chạm tra nghĩa.

   Hai chỗ dễ vỡ, cùng họ với bẫy escape kép đã gặp ở mdSangHtml():
   - esc() sinh ra thực thể HTML (&quot; &amp;). Regex bắt chữ chạy thẳng sẽ
     bọc luôn chữ "quot" bên trong, thực thể gãy và màn hình hiện ra nguyên
     chuỗi &quot;. Phải nuốt trọn thực thể TRƯỚC rồi mới bắt từ.
   - Từ có dấu nháy (I'm, don't) nhét thẳng vào onclick="traTu('...')" là đứt
     chuỗi JS, bấm vào không tra được. Phải escape dấu nháy. */
function cauCoTuChamDuoc(cau) {
  return esc(cau).replace(/&[a-z]+;|[A-Za-z']+/g, m => {
    if (m[0] === "&") return m;
    return `<span class="w" onclick="traTu('${m.replace(/'/g, "\\'")}', this)">${m}</span>`;
  });
}

/* gon=true: chỉ câu + nghĩa, bỏ ba dòng phiên âm. Dùng cho câu ví dụ nằm
   TRONG mục từ vựng — ở đó ba dòng "Nói tự nhiên / Đọc thô / Đọc rõ từng từ"
   làm mỗi từ cao thêm 70px, nhân 15 từ là hơn một nghìn pixel cuộn thêm mà
   người học đang tra nghĩa chứ chưa luyện đọc. */
function khoiCau(en, pa, nghia, { lon = false, gon = false } = {}) {
  const hienPa = $("#hien-pa")?.checked && !gon;
  const hienNghia = $("#hien-nghia")?.checked;
  let h = `<div class="cau-anh">${cauCoTuChamDuoc(en)} ${nutLoa(en)}</div>`;
  if (pa && hienPa) {
    if (pa.ipa_noi) h += `<div class="pa-noi">Nói tự nhiên: ${esc(pa.ipa_noi)}</div>`;
    if (pa.tho_noi) h += `<div class="tho">Đọc thô: ${esc(pa.tho_noi)}</div>`;
    if (pa.ipa_day_du && !lon) h += `<div class="pa">Đọc rõ từng từ: ${esc(pa.ipa_day_du)}</div>`;
  }
  if (nghia && hienNghia) h += `<div class="nghia">${esc(nghia)}</div>`;
  return h;
}

/* ================= tra từ ================= */
async function traTu(tu, el) {
  const cau = el?.closest(".cau-anh")?.innerText || "";
  const r = await fetch(`/api/tra_tu?tu=${encodeURIComponent(tu)}&cau=${encodeURIComponent(cau)}`);
  const d = await r.json();
  /* Đúng BA DÒNG: từ + loa, phiên âm, nghĩa.
     Trước đây còn hai dòng ghi chú ("từ này không có trong giáo trình",
     "phiên âm do máy sinh"). Người học chạm vào một từ là để biết nó đọc sao
     và nghĩa gì; hai dòng kia đúng nhưng nói về NGUỒN dữ liệu, đọc một lần là
     đủ, để thường trực thì hộp cao gấp đôi mà không thêm thông tin nào. */
  $("#tra-tu-noi-dung").innerHTML = `
    <div class="hang"><span class="tu-anh">${esc(d.tu)}</span> ${nutLoa(d.tu)}</div>
    ${d.ipa ? `<div class="pa">${esc(d.ipa)}</div>` : ""}
    <div class="nghia">${esc(d.nghia || "")}</div>`;
  datChoTraTu(el);
  $("#tra-tu").classList.remove("an");
  doc(d.tu);
}

/* Đặt hộp tra từ NGAY DƯỚI chữ vừa chạm, trên màn hẹp.
   Hộp vốn neo ở góc phải dưới. Trên tablet chỗ đó trùng với thanh tìm kiếm
   nổi của trình duyệt, che mất hộp. Mà kể cả không bị che thì mắt vẫn phải
   nhảy từ giữa câu xuống góc màn rồi quay lại.
   Màn rộng giữ nguyên góc phải dưới: ở đó hộp không đè lên bài đọc. */
function datChoTraTu(el) {
  const h = $("#tra-tu");
  h.style.left = h.style.top = h.style.right = h.style.bottom = "";
  h.classList.remove("neo-tu");
  if (!el || innerWidth > 1024) return;

  const r = el.getBoundingClientRect();
  h.classList.add("neo-tu");
  h.style.visibility = "hidden";
  h.classList.remove("an");
  const rong = h.offsetWidth || 320, cao = h.offsetHeight || 120;
  h.classList.add("an");
  h.style.visibility = "";

  const le = 8;
  let x = Math.min(Math.max(le, r.left), innerWidth - rong - le);
  // Không đủ chỗ bên dưới thì lật lên trên, đừng để hộp tràn khỏi màn.
  let y = r.bottom + 8;
  if (y + cao > innerHeight - le) y = Math.max(le, r.top - cao - 8);
  h.style.left = x + "px";
  h.style.top = y + "px";
}
const dongTraTu = () => $("#tra-tu").classList.add("an");

/* ================= KHỐI THU GỌN =================
   Một kiểu khối dùng cho MỌI màn học. Trước đây mỗi màn đổ hết ra một mạch:
   unit 1 có 15 từ, mỗi từ một thẻ cao hơn 200px — phải cuộn hơn 3000px chỉ để
   xem 15 từ. Giờ phần phụ gấp lại được.

   Nhớ theo Ý NGHĨA của khối chứ không theo unit ("bai-hoc/ngu-phap" chứ không
   phải "unit-5/ngu-phap"): đã gấp bảng ngữ pháp ở unit 5 thì sang unit 6 cũng
   không muốn nó bung ra lại. */
const KHOI_GAP_SAN = [
  "bai-hoc/ngu-phap", "bai-hoc/phat-am", "bai-hoc/luu-y", "bai-hoc/meo",
  "doc/chu-thich",
];

function napKhoi() {
  try {
    const b = JSON.parse(localStorage.getItem("khoiBiet"));
    if (Array.isArray(b)) S.khoiBiet = new Set(b.map(String));
  } catch (e) { /* hỏng thì coi như chưa biết khối nào */ }
  const luu = localStorage.getItem("khoiGap");
  if (luu === null) { S.khoiGap = new Set(KHOI_GAP_SAN); return; }
  try {
    const d = JSON.parse(luu);
    S.khoiGap = new Set(Array.isArray(d) ? d : KHOI_GAP_SAN);
  } catch (e) { S.khoiGap = new Set(KHOI_GAP_SAN); }
}

/* Khối GẶP LẦN ĐẦU thì gấp sẵn hay mở sẵn. Dùng cho truyện/hội thoại: unit 1
   có 4 bài hội thoại, mở hết một lúc là màn dài hơn 6000px. Bài đầu mở, các
   bài sau gấp. Chỉ áp dụng lần đầu — sau đó tôn trọng lựa chọn của người học,
   không mỗi lần vào lại tự gấp cái họ vừa mở. */
function macDinhKhoi(id, gapNeuMoi) {
  if (S.khoiBiet.has(id)) return;
  S.khoiBiet.add(id);
  if (gapNeuMoi) S.khoiGap.add(id);
  localStorage.setItem("khoiBiet", JSON.stringify([...S.khoiBiet]));
  localStorage.setItem("khoiGap", JSON.stringify([...S.khoiGap]));
}

/* daXong = null -> khối không có khái niệm hoàn thành (phần lớn các khối).
   true/false -> hiện ô tick ở đầu khối, dùng cho từng truyện. */
function khoi(id, ten, noi, dem = "", daXong = null) {
  const gap = S.khoiGap.has(id);
  return `<section class="khoi ${gap ? "thu-gon" : ""}">
      <button class="khoi-dau" onclick="batTatKhoi('${id}',this)" aria-expanded="${!gap}">
        <span class="mui">›</span>
        ${daXong === null ? "" : `<span class="tick-truyen ${daXong ? "du" : ""}">✓</span>`}
        <span class="ten">${esc(ten)}</span>
        ${dem ? `<span class="dem">${esc(dem)}</span>` : ""}
      </button>
      <div class="khoi-noi">${noi}</div>
    </section>`;
}

/* Đổi lớp TẠI CHỖ, không vẽ lại cả màn: vẽ lại thì mất chỗ đang cuộn, mất câu
   đang gõ dở ở tab Bài tập và ngắt câu đang phát ở tab Mẫu câu. */
function batTatKhoi(id, nut) {
  const dangGap = S.khoiGap.has(id);
  dangGap ? S.khoiGap.delete(id) : S.khoiGap.add(id);
  localStorage.setItem("khoiGap", JSON.stringify([...S.khoiGap]));
  nut.closest(".khoi")?.classList.toggle("thu-gon", !dangGap);
  nut.setAttribute("aria-expanded", String(dangGap));
}

/* ================= 1 · BÀI HỌC ================= */
function veBaiHoc(u) {
  const el = $("#bai-hoc");
  let h = `<div class="tom-tat">${esc(u.ten_level)} · ${u.tu_vung.length} từ · ${u.mau_cau.length} mẫu câu</div>`;

  /* Từ vựng: MỘT DÒNG một từ (từ · loa · phiên âm · nghĩa), câu ví dụ thụt
     vào ngay dưới. Bản cũ mỗi từ là một thẻ riêng cao hơn 200px. */
  if (u.tu_vung.length) {
    const noi = `<div class="ds-tu">` + u.tu_vung.map(t => `<div class="mot-tu">
        <div class="dinh">
          <span class="tu-anh">${esc(t.tu)}</span>${nutLoa(t.tu)}
          ${$("#hien-pa").checked && t.ipa ? `<span class="pa">${esc(t.ipa)}</span>` : ""}
          ${$("#hien-nghia").checked ? `<span class="nghia">${esc(t.nghia)}</span>` : ""}
          ${t.bien_the?.length ? `<span class="mo">(${t.bien_the.map(esc).join(" / ")})</span>` : ""}
        </div>
        ${t.vi_du ? `<div class="vi-du-tu">${khoiCau(t.vi_du, t.vi_du_pa, "", { gon: true })}</div>` : ""}
      </div>`).join("") + `</div>`;
    h += khoi("bai-hoc/tu-vung", "Từ vựng", noi, `${u.tu_vung.length} từ`);
  }

  if (u.mau_cau.length) {
    const noi = u.mau_cau.map(m => `<div class="the">
        ${khoiCau(m.cau, m.pa, m.nghia)}
        ${m.vi_du?.length ? `<div class="vi-du">
          <div class="nhan-vi-du">Câu mẫu</div>
          ${m.vi_du.map(v => `<div class="mot-vi-du">
            ${khoiCau(v.en, v.pa, v.vi, { gon: true })}
          </div>`).join("")}
        </div>` : ""}
      </div>`).join("");
    h += khoi("bai-hoc/mau-cau", "Mẫu câu", noi, `${u.mau_cau.length} mẫu`);
  }

  // Gộp MỌI bảng ngữ pháp vào một khối, không mỗi bảng một tiêu đề rời
  const bang = (u.bang_ngu_phap || []).filter(b => b.bang?.length);
  if (bang.length) {
    const noi = bang.map(b => {
      const cot = Object.keys(b.bang[0]);
      return `<h4>${esc(b.ten)}</h4><div class="cuon"><table><tr>${
        cot.map(c => `<th>${esc(c)}</th>`).join("")}</tr>${
        b.bang.map(r => `<tr>${cot.map(c => `<td>${esc(r[c])}</td>`).join("")}</tr>`).join("")
      }</table></div>`;
    }).join("");
    h += khoi("bai-hoc/ngu-phap", "Bảng ngữ pháp", noi, `${bang.length} bảng`);
  }

  [["phat_am", "Phát âm"], ["luu_y", "Lưu ý & điểm dễ nhầm"], ["meo", "Mẹo ghi nhớ"]]
    .forEach(([k, ten]) => {
      if (!u[k]) return;
      h += khoi("bai-hoc/" + k.replace("_", "-"), ten, `<div class="the">${mdSangHtml(u[k])}</div>`);
    });

  el.innerHTML = h;
}

/* markdown rất tối giản: đậm, nghiêng, xuống dòng, gạch đầu dòng */
function mdSangHtml(s) {
  return esc(s)
    .replace(/^\s*[-*]\s+(.*)$/gm, "• $1")
    .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
    .replace(/(?<!\*)\*(?!\*)(.+?)\*(?!\*)/g, "<i>$1</i>")
    .replace(/\n{2,}/g, "<br><br>").replace(/\n/g, "<br>");
}

/* ================= BÀI TẬP =================
   Làm hết -> bấm Nộp bài -> máy chấm, chỉ ra câu sai kèm đáp án đúng, và TỰ
   ghi câu sai vào Sổ lỗi. Người học không thể tự biết mình sai chỗ nào, nên
   việc phát hiện lỗi phải do máy làm. */
function veBaiTap(u) {
  const el = $("#bai-tap");
  if (!u.bai_tap?.length) { el.innerHTML = `<div class="trong">Unit này chưa có bài tập trong giáo trình.</div>`; return; }

  const tongCau = u.bai_tap.reduce((s, n) => s + n.cau_hoi.length, 0);
  const coDapAn = u.bai_tap.reduce((s, n) => s + n.cau_hoi.filter(c => c.dap_an).length, 0);

  let h = `<h2>Bài tập — Unit ${u.so}</h2>
    <div class="mo">${tongCau} câu · ${coDapAn} câu chấm tự động được</div>
    ${coDapAn < tongCau ? `<div class="canh-bao">${tongCau - coDapAn} câu là dạng viết/nói tự do —
      sổ đáp án chỉ ghi gợi ý nên máy không chấm, bạn tự đối chiếu.</div>` : ""}`;

  u.bai_tap.forEach(n => {
    h += `<h3>${esc(n.ma)}. ${esc(n.ten)}</h3><div class="the">`;
    h += n.cau_hoi.map(c => `<div class="cau-hoi" id="oc-${u.so}-${c.so}">
        <div>${c.so}. ${cauCoTuChamDuoc(c.de)} ${nutLoa(c.de.replace(/_+/g, " blank "))}</div>
        <div class="hang" style="margin-top:6px">
          <input type="text" placeholder="Câu trả lời của bạn" id="bt-${u.so}-${c.so}"
            onkeydown="if(event.key==='Enter')chuyenO(${u.so},${c.so})">
          <span id="kq-${u.so}-${c.so}"></span>
        </div>
      </div>`).join("");
    h += `</div>`;
  });

  h += `<div class="dieu-khien" style="justify-content:flex-start">
      <button class="chinh" id="nut-nop-bt" onclick="nopBaiTap(${u.so})">Nộp bài</button>
      <button class="phu an" id="nut-lam-lai" onclick="lamLaiBaiTap(${u.so})">Làm lại</button>
    </div>
    <div id="ket-qua-bt"></div>`;
  el.innerHTML = h;
}

/* Enter để nhảy sang ô tiếp theo — làm 15 câu mà phải rê chuột thì rất nản */
function chuyenO(unit, so) {
  const cac = $$(`input[id^="bt-${unit}-"]`);
  const i = cac.findIndex(x => x.id === `bt-${unit}-${so}`);
  if (i >= 0 && i + 1 < cac.length) cac[i + 1].focus();
}

async function nopBaiTap(soUnit) {
  const u = S.duLieuUnit;
  const traLoi = [];
  u.bai_tap.forEach(n => n.cau_hoi.forEach(c => traLoi.push({
    so: c.so, de: c.de, dap_an: c.dap_an || "", nhan: c.nhan || [],
    cua_toi: $(`#bt-${soUnit}-${c.so}`)?.value || "",
  })));

  const kq = await (await fetch("/api/nop_bai", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ unit: soUnit, loai: "bai_tap", cau_tra_loi: traLoi, thoi_diem: new Date().toISOString() }),
  })).json();

  // đánh dấu ngay tại từng ô
  kq.chi_tiet.forEach(r => {
    const o = $(`#kq-${soUnit}-${r.so}`);
    const inp = $(`#bt-${soUnit}-${r.so}`);
    if (!o) return;
    if (r.khong_cham_duoc) { o.innerHTML = `<span class="mo">tự đối chiếu</span>`; return; }
    if (r.dung) { o.innerHTML = `<span class="dung">✓ đúng</span>`; }
    else { o.innerHTML = `<span class="sai">✗ đáp án: ${esc(r.dap_an)}</span>`; }
    if (inp) inp.disabled = true;
  });

  $("#nut-nop-bt").classList.add("an");
  $("#nut-lam-lai").classList.remove("an");
  $("#ket-qua-bt").innerHTML = `<div class="the">
      <h3>Điểm: <span class="${kq.dat ? "dung" : "sai"}">${kq.diem}%</span>
        (${kq.so_dung}/${kq.tong} câu)</h3>
      <div class="mo">${kq._luat}
        ${kq.khong_cham_duoc ? ` · ${kq.khong_cham_duoc} câu tự do không chấm máy.` : ""}</div>
      ${kq.tong - kq.so_dung > 0
      ? `<div class="mo" style="margin-top:6px">${kq.tong - kq.so_dung} câu sai đã được tự động ghi vào Sổ lỗi.</div>` : ""}
    </div>`;

  if (kq.dat) await datTrangThai(soUnit, "bai_tap", "xong");
  if (kq.dat) {
    $$("#bai-tap .nhom-nut-muc .nut-xong").forEach(nut => {
      nut.classList.add("da-xong");
      nut.setAttribute("aria-pressed", "true");
      nut.title = "Đã hoàn thành — bấm để bỏ đánh dấu";
    });
  }
  $("#ket-qua-bt").scrollIntoView({ behavior: "smooth", block: "center" });
}

function lamLaiBaiTap(soUnit) {
  $$(`input[id^="bt-${soUnit}-"]`).forEach(x => { x.value = ""; x.disabled = false; });
  $$(`[id^="kq-${soUnit}-"]`).forEach(x => x.innerHTML = "");
  $("#ket-qua-bt").innerHTML = "";
  $("#nut-nop-bt").classList.remove("an");
  $("#nut-lam-lai").classList.add("an");
  $(`#bt-${soUnit}-1`)?.focus();
}

/* ================= 3 · MẪU CÂU (phát tự động) =================
   Theo kiểu "Nghe bị động" của HelloChinese: chọn phần (level), có sân khấu
   câu đang đọc ở trên, và DANH SÁCH CÂU cuộn được ở dưới — bấm câu nào nhảy
   thẳng câu đó, không phải bấm Sau/Trước nhiều lần. */
async function veMauCau(soUnit) {
  const el = $("#mau-cau");
  el.innerHTML = `<div class="trong">Đang nạp…</div>`;
  const d = await (await fetch(`/api/mau_cau/${soUnit}`)).json();
  S.phatMauCau.danhSach = d.cau || [];
  const daNghe = +(S.tienDo?.nghe?.[soUnit] || 0);

  /* Bỏ dải "Level 0 / Level 1 / …" từng nằm ở đây: menu trái đã có sẵn cả
     năm level, mà nút cũ còn gọi doiUnit() thẳng nên nhảy unit xong menu
     trái và tiến độ không cập nhật theo. */
  el.innerHTML = `
    <div class="tom-tat">${d.so_cau} câu · đã nghe ${daNghe}/${d.so_cau}</div>
    ${d.so_cau < 50 ? `<div class="canh-bao">Giáo trình mới có ${d.so_cau} câu cho unit này.
      Mục tiêu 50–100 câu/unit cần soạn thêm — xem “Việc còn lại” trong Hướng dẫn.</div>` : ""}
    <div class="san-khau" id="san-khau"><div class="mo">Bấm Phát để bắt đầu</div></div>
    <div class="tien-trinh"><div id="thanh-tien-trinh"></div></div>
    <div class="dieu-khien">
      <button class="nut-tron phu2" onclick="nhayCau(-1)" title="Câu trước" aria-label="Câu trước">⏮</button>
      <button class="nut-tron to" id="nut-phat" onclick="batTatPhat()" title="Phát / Dừng" aria-label="Phát">▶</button>
      <button class="nut-tron phu2" onclick="nhayCau(1)" title="Câu sau" aria-label="Câu sau">⏭</button>
      <button class="nut-tron phu2" onclick="docLaiCau()" title="Nghe lại câu này" aria-label="Nghe lại">↻</button>
      ${nutTocDo()}
      <button class="nut-tron phu2" onclick="moCaiDat();chonTheCaiDat('mau-cau')" title="Cài đặt Mẫu câu" aria-label="Cài đặt">⚙</button>
    </div>
    ${khoi("mau-cau/danh-sach", "Danh sách câu",
      `<div class="ds-cau" id="ds-cau">${S.phatMauCau.danhSach.map((c, i) => `
        <div class="dong-cau" id="dc-${i}" onclick="chonCau(${i})">
          <span class="stt">${i + 1}</span>
          <span class="noi">
            <div class="en">${esc(c.en)}</div>
            ${c.vi ? `<div class="vi">${esc(c.vi)}</div>` : ""}
          </span>
        </div>`).join("")}</div>`, `${d.so_cau} câu`)}`;

  /* ! Dang giu phat ma quay lai chinh unit do thi KHONG keo ve cau 1 -
     nguoi dung dang nghe cau 30, vao xem phien am mot cai la mat cho. */
  if (!S.phatMauCau.dang || S.phatMauCau.unitDangPhat !== S.unit) {
    S.phatMauCau.i = 0;
  }
  capNhatNutPhat_();
  hienCauHienTai();
}

function chonCau(i) {
  const p = S.phatMauCau;
  clearTimeout(hen); speechSynthesis.cancel();
  p.i = i;
  hienCauHienTai();
  if (p.dang) chayCau(); else doc(p.danhSach[i].en);
}

function hienCauHienTai() {
  const p = S.phatMauCau, c = p.danhSach[p.i];
  if (!c) return;
  ghiSoCauDaNghe(S.unit, p.i + 1);
  veBarPhat();
  /* ! Giu phat roi chuyen man hinh: #san-khau va cac o cd-* KHONG con trong
     DOM. Cham vao la nem loi, cat luon vong phat -> tieng im bat giua chung. */
  if (!$("#san-khau")) return;
  const hienPa = !!$("#cd-pa")?.checked, hienNghia = !!$("#cd-nghia")?.checked;
  $("#san-khau").innerHTML = `
    <div class="mo">Câu ${p.i + 1}/${p.danhSach.length}</div>
    <div class="cau-anh">${cauCoTuChamDuoc(c.en)}</div>
    ${hienPa && c.pa?.ipa_noi ? `<div class="pa-noi">${esc(c.pa.ipa_noi)}</div>` : ""}
    ${hienPa && CD.docTho && c.pa?.tho_noi ? `<div class="tho">${esc(c.pa.tho_noi)}</div>` : ""}
    ${hienNghia && c.vi ? `<div class="nghia">${esc(c.vi)}</div>` : ""}`;
  $("#thanh-tien-trinh").style.width = ((p.i + 1) / p.danhSach.length * 100) + "%";

  $$(".dong-cau").forEach(x => x.classList.remove("dang-doc"));
  const dong = $(`#dc-${p.i}`);
  if (dong) {
    dong.classList.add("dang-doc");
    dong.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
}

let hen = null;

/* ================= DỪNG HẲN VÒNG PHÁT MẪU CÂU =================
   ! Do thật 03/09/2026: đang ở màn hình Tổng quan mà loa vẫn phát.
     Nguyên nhân: dungPhat() cũ chỉ cancel speechSynthesis, KHÔNG tắt cờ
     S.phatMauCau.dang và KHÔNG clearTimeout(hen). Hai hậu quả:
       - hẹn giờ câu kế đã đặt vẫn nổ sau khi đã chuyển màn hình;
       - watchdog visibilitychange thấy cờ còn bật thì gọi lại chayCau().
     Nên phải có một hàm tắt HẲN, và mọi lối chuyển màn hình đều đi qua nó. */
function dungMauCau_() {
  const p = S.phatMauCau;
  if (!p) return;
  p.dang = false;
  clearTimeout(hen);
  speechSynthesis.cancel();
  capNhatNutPhat_();
}

/* Nút ▶/■ chỉ tồn tại trên màn hình Mẫu câu. Bật "giữ phát" rồi chuyển màn
   hình là nút đó không còn trong DOM -> phải kiểm tra trước khi chạm, nếu
   không thì ném lỗi và cắt luôn phần code phía sau. */
function capNhatNutPhat_() {
  const np = $("#nut-phat");
  if (!np) return;
  const d = !!S.phatMauCau?.dang;
  np.textContent = d ? "■" : "▶";
  np.title = d ? "Dừng" : "Phát";
  np.setAttribute("aria-label", d ? "Dừng" : "Phát");
}

/* ================= CHUYỂN MÀN HÌNH =================
   Mặc định chuyển màn hình là DỪNG — người dùng chốt 03/09/2026: đang xem
   Tổng quan mà loa phát là sai.
   Bật "Giữ phát khi chuyển màn hình" thì giữ vòng mẫu câu và hiện bar điều
   khiển; phần "đọc cả bài" vẫn dừng vì bài đó không còn trên màn hình. */
function dungPhatKhiChuyen() {
  if (CD.giuPhat && S.phatMauCau?.dang) {
    dungPhatBai = true;
    baiDangPhat = null;
    $$(".cau-doc").forEach(x => x.classList.remove("dang-doc"));
    /* ! Ve bar SAU khi ham dieu huong ve xong man hinh moi. Goi ngay o day thi
       DOM va S.tab con la cua man hinh cu. */
    setTimeout(veBarPhat, 0);
    return;
  }
  dungPhat();
}

/* ================= BAR ĐIỀU KHIỂN NHANH =================
   Chỉ hiện khi ĐANG phát mẫu câu mà KHÔNG ở màn hình Mẫu câu — ở đúng màn
   hình đó thì đã có thanh điều khiển đầy đủ, thêm bar nữa là trùng.
   ! Bấm vào tên câu là quay về đúng unit đang phát: đang nghe dở mà muốn xem
     phiên âm thì không phải mò lại trong thanh bên. */
function veBarPhat() {
  const bar = $("#bar-phat");
  if (!bar) return;
  const p = S.phatMauCau;
  /* ! Xet S.tab, va CHI DUNG DUOC vi dungPhatKhiChuyen() ve bar qua
     setTimeout(0). Cac ham dieu huong goi dungPhatKhiChuyen() o DAU ham roi
     moi dat S.tab, nen goi thang o day thi S.tab con la tab CU -> bar khong
     bao gio hien. Do that 03/09/2026.
     ! Da thu xet theo DOM (#nut-phat) va HONG ca hai huong: xet ton tai thi
       sai vi cac man hinh chi bi an bang class chu KHONG bi xoa khoi DOM; xet
       offsetParent thi sai vi luc setTimeout no man hinh moi chua render xong,
       ve lai man Mau cau ma bar van hien. */
  const hien = !!p?.dang && S.tab !== "mau-cau";
  bar.classList.toggle("hien", hien);
  if (!hien) return;

  const c = p.danhSach[p.i];
  bar.innerHTML = `
    <button class="bp-nut" onclick="nhayCau(-1)" title="Câu trước" aria-label="Câu trước">◀</button>
    <button class="bp-nut chinh" onclick="batTatPhat()" title="Dừng" aria-label="Dừng">■</button>
    <button class="bp-nut" onclick="nhayCau(1)" title="Câu sau" aria-label="Câu sau">▶</button>
    <button class="bp-chu" onclick="moMuc(${p.unitDangPhat || S.unit}, 'mau-cau')"
      title="Mở lại màn hình Mẫu câu">
      <span class="bp-ten">${esc(c?.en || "")}</span>
      <span class="bp-mo">Unit ${p.unitDangPhat || S.unit} · câu ${p.i + 1}/${p.danhSach.length}</span>
    </button>
    <button class="bp-nut" onclick="dungPhat()" title="Tắt hẳn" aria-label="Tắt hẳn">✕</button>`;
}

function batTatPhat() {
  const p = S.phatMauCau;
  p.dang = !p.dang;
  capNhatNutPhat_();
  if (p.dang) {
    p.unitDangPhat = S.unit;      // bar can biet dang phat unit nao
    giuManHinhSang();
    chayCau();
  } else {
    clearTimeout(hen);
    speechSynthesis.cancel();
    thoiGiuManHinh();
  }
  veBarPhat();
}

/* ---------- đọc tách từng mảnh ----------
   Cắt câu ở đúng chỗ NỐI ÂM, không cắt theo khoảng trắng:
     My sister works in a bank  ->  My · sister · works in a · bank
   Vì sao: /wɜːks‿ɪn‿ə/ là một khối hơi liền. Tách thành "works" "in" "a" rồi
   đọc rời là luyện thẳng vào lỗi nặng nhất của người Việt — đọc từng chữ một.
   Mảnh ở đây là mảnh NHỎ NHẤT mà vẫn còn đọc đúng.

   Số mảnh đếm từ dấu ‿ trong ipa_noi — cùng một chuỗi mà nguon/phien_am.py
   dùng để cắt lúc tạo mp3, nên tên mảnh hai bên luôn khớp và tra được file. */
function manhCau(c) {
  const tu = (c?.pa?.tu || []).map(t => t.tu);
  if (!tu.length) return [];
  const noi = String(c.pa.ipa_noi || "").replace(/^\/|\/$/g, "").trim().split(/\s+/);
  const dem = noi.reduce((n, t) => n + (t.split("‿").length - 1) + 1, 0);
  if (!noi[0] || dem !== tu.length) return tu;   // lệch thì cắt theo từ, không đoán
  const ra = [];
  let i = 0;
  for (const t of noi) {
    const k = t.split("‿").length;
    ra.push({ chu: tu.slice(i, i + k).join(" "), tu0: i, tu1: i + k });
    i += k;
  }
  return ra;
}

/* Tô mảnh đang đọc ngay trên câu ở sân khấu. Không thêm dòng nào — chỉ sáng
   lên đúng những chữ đang phát, để tai và mắt khớp nhau. */
function sangManh(m) {
  const w = $$("#san-khau .cau-anh .w");
  w.forEach(x => x.classList.remove("dang-manh"));
  if (!m || m.tu0 == null) return;
  for (let i = m.tu0; i < m.tu1 && i < w.length; i++) w[i].classList.add("dang-manh");
}

let phienTach = 0;
let mocTach = null;

/* Dữ liệu chế độ đọc tách: mỗi câu một BẢN THU RIÊNG, các mảnh cách nhau bằng
   dấu phẩy nên khoảng ngắt do chính giọng đọc tạo ra.
     mocTach[câu] = { f: tên file, m: [giây bắt đầu từng mảnh] }
   Mảng m chỉ dùng để tô sáng mảnh đang đọc; thiếu nó thì audio vẫn chạy đúng.

   Vì sao không tua trong file câu gốc như bản trước: mốc thời gian của
   edge-tts đếm trên văn bản ĐÃ VIẾT LẠI cho giọng đọc ("Hanoi" -> "Ha Noy"
   thành hai từ), nên 232/7.893 câu lệch số từ, rơi về giọng máy và nghe như
   file hỏng. Cắt bằng dấu phẩy thì không phải căn mốc gì cả, lại được máy đọc
   tự ngân dài chữ trước dấu phẩy — nhịp tự nhiên hơn hẳn cắt bằng tay. */
async function napMocTu() {
  if (mocTach) return mocTach;
  try {
    mocTach = (await (await fetch("/api/moc_tu")).json()).cau || {};
  } catch (e) { mocTach = {}; }
  return mocTach;
}

/* Một lượt "mổ xẻ": đọc đúng -> đọc tách -> đọc đúng.
   Hai lượt đọc đúng kẹp hai đầu là có chủ ý: nghe trọn câu trước để biết đích
   đến, nghe tách để thấy từng mảnh, rồi nghe lại trọn câu để ráp lại. Chỉ mổ
   không ráp thì học xong vẫn nói rời từng chữ. */
function docTachCau(c, xong) {
  const p = S.phatMauCau;
  const en = (c.en || "").trim();
  const ten = S.dungAudioSan && banDoAudio?.cau?.[`${en}|tach`];
  if (!ten) return doc(c.en, { xong });   // chưa có bản tách thì đọc thường

  const nghiBien = 500;
  const phien = ++phienTach;
  const con = () => phien === phienTach && p.dang;

  const phatTach = () => {
    if (!con()) return;
    const a = new Audio((S.cauHinh?.goc_audio || "audio/") + ten);
    a.preservesPitch = a.mozPreservesPitch = a.webkitPreservesPitch = true;
    a.playbackRate = S.tocDo;
    dangPhat = a;

    const ds = manhCau(c);
    const moc = (mocTach && mocTach[en] && mocTach[en].m) || [];
    const sang = [];
    let hetGio = null, daXong = false;

    const dungHan = () => {
      if (daXong) return;
      daXong = true;
      clearTimeout(hetGio);
      sang.forEach(clearTimeout);
      sangManh(null);
      if (!con()) return;
      hen = setTimeout(() => con() && doc(c.en, { xong }), nghiBien);
    };
    a.onended = dungHan;
    a.onerror = dungHan;
    a.onloadedmetadata = () => {
      /* Tô sáng theo mốc từng mảnh. Không có mốc thì bỏ hẳn phần này — audio
         vẫn đúng, chỉ là chữ không sáng theo. */
      if (moc.length === ds.length) {
        ds.forEach((m, k) => sang.push(setTimeout(
          () => con() && sangManh(m), moc[k] * 1000 / (S.tocDo || 1))));
      }
      a.play().catch(dungHan);
      /* Chốt an toàn: onended có lúc không bắn (khoá máy, chuyển tab). Mất
         một sự kiện là cả câu đứng, không sang câu kế. */
      hetGio = setTimeout(dungHan,
        ((a.duration || 12) * 1000 / (S.tocDo || 1)) + 1500);
    };
    a.load();
  };

  doc(c.en, { xong: () => { if (con()) hen = setTimeout(phatTach, nghiBien); } });
}

function chayCau() {
  const p = S.phatMauCau;
  if (!p.dang) return;
  const c = p.danhSach[p.i];
  if (!c) { batTatPhat(); return; }
  hienCauHienTai();

  /* ! Cac o cai dat nam tren man hinh Mau cau. Giu phat roi chuyen man hinh
     la chung khong con -> phai co gia tri du phong, neu khong thi NaN. */
  const soLap = Math.max(1, +($("#cd-lap")?.value) || 2);
  const cho = Math.max(1, +($("#cd-cho")?.value) || 3);
  let lan = 0;
  /* Chỉ MỔ XẺ Ở LƯỢT CUỐI: câu nào cũng được nghe trọn vẹn, tự nhiên trước
     đã, tách ra là bước sau. Tách ngay từ lượt đầu thì chưa kịp có ấn tượng
     về câu đã bị cắt vụn. */
  const tach = docTachBat();
  const mot = () => {
    if (!p.dang) return;
    lan++;
    const sang = () => {
      if (!p.dang) return;
      if (lan < soLap) hen = setTimeout(mot, 700);
      else hen = setTimeout(() => { p.i = (p.i + 1) % p.danhSach.length; chayCau(); }, cho * 1000);
    };
    if (tach && lan === soLap) return docTachCau(c, sang);
    doc(c.en, {
      xoay: p.i,                 // mỗi câu một giọng, xoay vòng cho đỡ nhàm
      xong: sang,
    });
  };
  mot();
}

function nhayCau(d) {
  const p = S.phatMauCau;
  phienTach++;                 // bỏ chuỗi đọc tách đang dở của câu cũ
  clearTimeout(hen); speechSynthesis.cancel();
  p.i = (p.i + d + p.danhSach.length) % p.danhSach.length;
  hienCauHienTai();
  if (p.dang) chayCau();
}
const docLaiCau = () => doc(S.phatMauCau.danhSach[S.phatMauCau.i]?.en);
const docTachBat = () => localStorage.getItem("docTach") === "1";
if (localStorage.getItem("docTach") === "1") napMocTu();

/* ================= TRÌNH ĐỌC (dùng chung cho Truyện & Hội thoại) =================
   Học theo cách HelloChinese trình bày bài đọc:
     - mỗi câu một dòng, có loa riêng, bản dịch ngay bên dưới
     - đánh dấu từ theo cấp độ đã học
     - 3 chế độ hiển thị + chỉnh cỡ chữ
     - nút phát cả bài, câu đang đọc được tô sáng
*/
const CD = {
  cheDo: localStorage.getItem("cheDo") || "en",
  coChu: +(localStorage.getItem("coChu") || 18),
  hienDich: localStorage.getItem("hienDich") !== "0",
  danhDau: localStorage.getItem("danhDau") !== "0",
  docTho: localStorage.getItem("docTho") !== "0",
  /* hai công tắc ngay trên thanh phát: phát 1 lần hay lặp lại, và hết bài
     có tự sang bài kế không */
  lapBai: localStorage.getItem("lapBai") === "1",
  tuChuyenBai: localStorage.getItem("tuChuyenBai") === "1",
  /* Đọc theo TỪNG CÂU (mỗi câu một dòng, có loa và micro riêng) hay theo
     cả ĐOẠN (văn xuôi liền mạch, dịch nằm dưới). Từng câu để luyện đọc,
     cả đoạn để đọc hiểu — 18 lượt thoại tách dòng thì dài gấp ba. */
  kieuDoc: localStorage.getItem("kieuDoc") === "doan" ? "doan" : "cau",
  /* Chuyen man hinh thi dung phat, hay giu phat tiep? Mac dinh DUNG.
     Nguoi dung chot 03/09/2026: "tru khi toi chon giu phat khi chuyen man
     hinh, va co bar cho phep dieu khien nhanh". */
  giuPhat: localStorage.getItem("giuPhat") === "1",
};
let bangTuLevel = {};

function moCaiDatDoc() { $("#cd-doc").classList.remove("an"); }
/* Aa bấm lần nữa là đóng — bấm mở rồi phải mò xuống nút "Xong" mới tắt được
   thì thừa một thao tác, mà trên điện thoại nút đó còn nằm khuất dưới đáy. */
const batTatCaiDatDoc = () =>
  $("#cd-doc").classList.contains("an") ? moCaiDatDoc() : dongCaiDatDoc();
function dongCaiDatDoc() {
  $("#cd-doc").classList.add("an");
  localStorage.setItem("cheDo", CD.cheDo);
  localStorage.setItem("coChu", CD.coChu);
  localStorage.setItem("hienDich", CD.hienDich ? "1" : "0");
  localStorage.setItem("danhDau", CD.danhDau ? "1" : "0");
  localStorage.setItem("docTho", CD.docTho ? "1" : "0");
  veLaiTrangDoc();
}

function veLaiTrangDoc() {
  if (S.tab === "truyen") veTruyen(S.duLieuUnit);
  if (S.tab === "hoi-thoai") veHoiThoai(S.duLieuUnit);
}

/* tô từ theo cấp độ: nhìn là biết từ nào đã học ở level nào, từ nào còn lạ */
function tuCoMau(cau) {
  return esc(cau).replace(/[A-Za-z']+/g, w => {
    const info = bangTuLevel[w.toLowerCase()];
    const lop = CD.danhDau ? (info ? `lv${info.level}` : "chua-hoc") : "";
    return `<span class="w ${lop}" onclick="traTu('${w}', this)">${w}</span>`;
  });
}

/* ================= GHI ÂM & CHẤM PHÁT ÂM =================
   So nhịp và cao độ giọng bạn với giọng mẫu bằng Praat (chạy offline).
   So bằng semitone tương đối, không so Hz tuyệt đối — hai giọng cao thấp khác
   nhau thì so Hz là vô nghĩa. */
let mayGhi = null, dangGhiId = null, cacKhuc = [];

async function ghiAm(id, cau) {
  if (dangGhiId === id) return dungGhiAm();
  if (dangGhiId) dungGhiAm();

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (e) {
    return alert("Không truy cập được micro. Cho phép quyền micro rồi thử lại.");
  }

  cacKhuc = [];
  mayGhi = new MediaRecorder(stream);
  mayGhi.ondataavailable = e => cacKhuc.push(e.data);
  mayGhi.onstop = async () => {
    stream.getTracks().forEach(t => t.stop());
    const blob = new Blob(cacKhuc, { type: "audio/webm" });
    const b64 = await new Promise(r => {
      const fr = new FileReader(); fr.onloadend = () => r(fr.result); fr.readAsDataURL(blob);
    });
    veKetQuaGiong(id, "<span class='mo'>Đang phân tích…</span>");
    const kq = await (await fetch("/api/cham_giong", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ audio: b64, cau, unit: S.unit }),
    })).json();
    veKetQuaGiong(id, kq.loi ? `<span class="sai">${esc(kq.loi)}</span>` : veBangGiong(kq));
  };
  mayGhi.start();
  dangGhiId = id;
  const nut = document.querySelector(`#${id} .mic`);
  if (nut) { nut.textContent = "⏹"; nut.classList.add("dang-ghi"); }
  veKetQuaGiong(id, `<span class="sai">● Đang ghi… bấm ⏹ để dừng</span>`);
}

function dungGhiAm() {
  if (!mayGhi) return;
  try { mayGhi.stop(); } catch (e) { }
  const nut = document.querySelector(`#${dangGhiId} .mic`);
  if (nut) { nut.textContent = "🎤"; nut.classList.remove("dang-ghi"); }
  mayGhi = null; dangGhiId = null;
}

function veKetQuaGiong(id, html) {
  const el = document.getElementById(id);
  if (!el) return;
  let o = el.querySelector(".kq-giong");
  if (!o) { o = document.createElement("div"); o.className = "kq-giong"; el.querySelector(".than").appendChild(o); }
  o.innerHTML = html;
}

const TEN_DO = {
  do_rong_cao_do_st: "Độ rộng cao độ (lên xuống giọng)",
  do_lech_cao_do_st: "Mức dao động cao độ",
  bien_thien_do_dai: "Nhịp — có âm dài có âm ngắn",
  do_lech_cuong_do_db: "Nhấn mạnh — to nhỏ",
};

function veBangGiong(kq) {
  const hang = Object.entries(kq.diem || {}).map(([k, v]) => `<tr>
      <td>${esc(TEN_DO[k] || k)}</td>
      <td>${v.cua_ban}</td><td>${v.cua_mau}</td>
      <td class="${v.dat ? "dung" : "sai"}">${v.dat ? "đạt" : "chưa"}</td></tr>`).join("");
  const tl = Math.round((kq.ty_le_dat || 0) * 100);
  return `<div class="the" style="margin-top:8px; border-color:${tl >= 75 ? "var(--dung)" : "var(--vang)"}">
      <b class="${tl >= 75 ? "dung" : ""}">Khớp mẫu ${tl}%</b>
      <div class="cuon"><table><tr><th>Tiêu chí</th><th>Bạn</th><th>Mẫu</th><th></th></tr>${hang}</table></div>
      ${(kq.nhan_xet || []).map(x => `<div class="mo">• ${esc(x)}</div>`).join("")}
      <div class="mo" style="margin-top:6px">Đo bằng Praat, so theo semitone tương đối
        nên không phụ thuộc giọng bạn cao hay thấp.</div>
    </div>`;
}

/* một câu trong bài đọc */
function dongDoc(id, en, pa, dich, vai) {
  const hienEn = CD.cheDo !== "pa";
  const hienPa = CD.cheDo !== "en";
  return `<div class="cau-doc" id="${id}">
      <button class="loa" onclick="docCau('${id}')" title="Nghe câu này">🔊</button>
      <button class="loa mic" onclick="ghiAm('${id}',${JSON.stringify(en).replace(/"/g, "&quot;")})"
        title="Ghi âm rồi so với giọng mẫu">🎤</button>
      <div class="than" style="font-size:${CD.coChu}px" data-en="${esc(en)}" data-vai="${esc(vai || '')}">
        ${vai ? `<span class="vai">${esc(vai)}:</span> ` : ""}
        ${hienEn ? `<span class="cau-anh" style="font-size:inherit">${tuCoMau(en)}</span>` : ""}
        ${hienPa && pa?.ipa_noi ? `<div class="pa-noi">${esc(pa.ipa_noi)}</div>` : ""}
        ${hienPa && CD.docTho && pa?.tho_noi ? `<div class="tho">${esc(pa.tho_noi)}</div>` : ""}
        ${CD.hienDich && dich ? `<div class="dich">${esc(dich)}</div>` : ""}
      </div>
      <button class="danh-dau-cau" onclick="danhDauCau('${id}',this)" title="Đánh dấu">🔖</button>
    </div>`;
}

/* Cả đoạn: văn xuôi liền mạch, một nút loa cho cả bài, bản dịch gộp bên
   dưới. Vẫn giữ id từng câu để phát cả bài tô sáng đúng câu đang đọc. */
function khoiDoan(tienTo, cac) {
  const hienEn = CD.cheDo !== "pa";
  const cauEn = cac.map((c, i) => {
    const en = c.en ?? c;
    return `<span class="cau-trong-doan" id="${tienTo}${i}"
      data-en="${esc(en)}" data-vai="${esc(c.vai || "")}"
      onclick="docCau('${tienTo}${i}')">${hienEn ? tuCoMau(en) : esc(c.pa?.ipa_noi || "")}</span>`;
  }).join(" ");
  const dich = cac.map(c => c.vi || c.dich || "").filter(Boolean).join(" ");
  return `<div class="doan-van" style="font-size:${CD.coChu}px">${cauEn}</div>
    ${CD.hienDich && dich ? `<div class="doan-dich">${esc(dich)}</div>` : ""}`;
}

function docCau(id) {
  const el = document.getElementById(id);
  if (!el) return;
  $$(".cau-doc").forEach(x => x.classList.remove("dang-doc"));
  el.classList.add("dang-doc");
  const than = el.querySelector(".than");
  doc(than.dataset.en, { vai: than.dataset.vai });
}

function danhDauCau(id, nut) {
  nut.classList.toggle("bat");
  const kho = JSON.parse(localStorage.getItem("danhDauCau") || "[]");
  const en = document.getElementById(id)?.querySelector(".than")?.dataset.en;
  if (nut.classList.contains("bat")) kho.push({ unit: S.unit, en });
  localStorage.setItem("danhDauCau", JSON.stringify(kho));
}

/* ================= giữ màn hình sáng khi đang phát =================
   Trên iPhone, màn hình tự tắt là Safari treo cả trang: speechSynthesis chết
   giữa chừng, đang nghe dở thì im bặt. Không có cách nào cho giọng máy đọc
   tiếp khi màn hình đã tắt — Web Speech API dừng hẳn khi trang bị ẩn. Nên
   cách chữa là GIỮ MÀN HÌNH ĐỪNG TẮT trong lúc phát, bằng Wake Lock API
   (Safari iOS 16.4 trở lên có).

   Khoá này bị hệ điều hành thu hồi mỗi khi người dùng chuyển app hay khoá máy
   tay, nên phải xin lại lúc trang hiện lại — không thì lần phát sau mất tác
   dụng mà chẳng báo gì. */
let khoaManHinh = null;

async function giuManHinhSang() {
  if (!("wakeLock" in navigator) || khoaManHinh) return;
  try {
    khoaManHinh = await navigator.wakeLock.request("screen");
    khoaManHinh.addEventListener("release", () => { khoaManHinh = null; });
  } catch (e) {
    khoaManHinh = null;      // pin yếu hoặc trình duyệt từ chối — cứ phát tiếp
  }
}

function thoiGiuManHinh() {
  khoaManHinh?.release?.().catch(() => {});
  khoaManHinh = null;
}

const dangPhatGiDo = () =>
  S.phatMauCau?.dang || !dungPhatBai || speechSynthesis.speaking;

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  if (!dangPhatGiDo()) return;
  giuManHinhSang();                          // xin lại khoá đã bị thu hồi

  /* Khoá máy tay hoặc có cuộc gọi xen vào thì iOS treo trang, giọng máy mắc
     kẹt ở trạng thái tạm dừng. Không gọi resume thì mở lại app chỉ thấy im
     lặng mà nút vẫn hiện "Dừng" — nhìn như app hỏng. */
  try { speechSynthesis.resume(); } catch (e) { /* trình duyệt cũ */ }

  if (S.phatMauCau?.dang && !speechSynthesis.speaking && !dangPhat) {
    clearTimeout(hen);                       // tránh chồng hai vòng phát
    chayCau();
  }
});

/* phát cả bài, câu nào đang đọc thì tô sáng và tự cuộn tới.
   Hết bài thì xử theo cài đặt: lặp lại bài, sang bài kế trong unit, hoặc
   sang luôn unit sau — để nghe liên tục mà không phải chạm màn hình. */
let dungPhatBai = true;
let baiDangPhat = null;

const xoaSangCau = () => $$(".cau-doc").forEach(x => x.classList.remove("dang-doc"));

/* danh sách tiền tố các bài đang hiển thị ở tab hiện tại, theo đúng thứ tự */
function danhSachBai() {
  const trang = $(`#${S.tab}`);
  if (!trang) return [];
  return [...trang.querySelectorAll(".thanh-doc[data-tien-to]")].map(x => x.dataset.tienTo);
}

/* MỘT nút cho cả phát và dừng, đổi biểu tượng theo trạng thái. Hai nút riêng
   vừa tốn chỗ trên thanh, vừa bắt người dùng tự nhớ đang phát hay đang dừng —
   mà chính cái nút đã biết rồi. Bấm vào bài đang phát = dừng; bấm vào bài khác
   = chuyển sang bài đó. */
function batTatPhatBai(tienTo) {
  if (baiDangPhat === tienTo) { dungPhat(); return; }
  phatCaBai(tienTo);
  dongBoNutPhatBai();
}

function dongBoNutPhatBai() {
  $$(".nut-phat-bai").forEach(b => {
    const dang = b.dataset.bai === baiDangPhat;
    b.textContent = dang ? "■" : "▶";
    b.title = dang ? "Dừng" : "Phát cả bài";
    b.classList.toggle("dang-phat", dang);
  });
}

function phatCaBai(tienTo) {
  const cac = $$(`[id^="${tienTo}"]`);
  if (!cac.length) return;
  dungPhatBai = false;
  baiDangPhat = tienTo;
  dongBoNutPhatBai();
  giuManHinhSang();
  let i = 0;
  const tiep = () => {
    if (dungPhatBai) { xoaSangCau(); thoiGiuManHinh(); return; }
    if (i >= cac.length) return hetBai(tienTo);
    const el = cac[i];
    xoaSangCau();
    el.classList.add("dang-doc");
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    const than = el.querySelector(".than");
    doc(than.dataset.en, {
      vai: than.dataset.vai,
      xong: () => { i++; setTimeout(tiep, 450); },
    });
  };
  tiep();
}

function hetBai(tienTo) {
  if (dungPhatBai) return;
  const nghi = 1200;                       // khoảng lặng cho tai kịp nghỉ

  if (CD.lapBai) return setTimeout(() => { if (!dungPhatBai) phatCaBai(tienTo); }, nghi);

  if (CD.tuChuyenBai) {
    const ds = danhSachBai();
    const k = ds.indexOf(tienTo);
    if (k >= 0 && k + 1 < ds.length)
      return setTimeout(() => { if (!dungPhatBai) phatCaBai(ds[k + 1]); }, nghi);
    /* hết bài cuối của unit thì đi luôn sang unit sau — vẫn là "bài kế tiếp",
       chỉ khác là nằm ở unit khác */
    return setTimeout(() => { if (!dungPhatBai) sangUnitKe(); }, nghi);
  }

  dungPhatBai = true;
  baiDangPhat = null;
  xoaSangCau();
  thoiGiuManHinh();
}

/* sang unit kế và phát tiếp bài đầu tiên. Unit nào không có nội dung ở tab
   này thì bỏ qua, nhưng có giới hạn để không lặp vô tận khi cả dãy đều rỗng. */
async function sangUnitKe(conLai = 50) {
  if (dungPhatBai) return;
  const ds = (S.muc_luc || []).map(m => m.so);
  const k = ds.indexOf(S.unit);
  const so = ds[k + 1];
  if (so == null || conLai <= 0) {        // hết unit cuối thì dừng hẳn
    dungPhatBai = true; xoaSangCau(); thoiGiuManHinh(); return;
  }
  await moChiTiet(so);
  if (dungPhatBai) return;                 // người học bấm dừng lúc đang nạp
  const bai = danhSachBai();
  if (!bai.length) return sangUnitKe(conLai - 1);
  phatCaBai(bai[0]);
}

function dungPhat() {
  dungPhatBai = true;
  baiDangPhat = null;
  dongBoNutPhatBai();
  speechSynthesis.cancel();
  if (dangPhat) { dangPhat.pause(); dangPhat = null; }
  $$(".cau-doc").forEach(x => x.classList.remove("dang-doc"));
  dungMauCau_();          // ! thieu dong nay la loa van phat sau khi doi man hinh
  veBarPhat();
  thoiGiuManHinh();
}

const chuThichMau = () => `<div class="chu-thich-mau">
  <span><i class="o-mau" style="background:#7fc8d8"></i>Trẻ em</span>
  ${[0, 1, 2, 3, 4].map(l => `<span><i class="o-mau" style="background:${["#4ec99a", "#5aa9f0", "#b39ae8", "#e0b64a", "#f07a6d"][l]}"></i>Level ${l}</span>`).join("")}
  <span><i class="o-mau" style="background:var(--chu-nhat)"></i>chưa có trong giáo trình</span></div>`;

const thanhCongCu = (ten, tienTo) => `<div class="thanh-doc" data-tien-to="${tienTo}">
    ${ten ? `<span class="ten">${esc(ten)}</span>` : `<span class="ten"></span>`}
    <button class="nut-tron phu2 ct-kieu" onclick="doiKieuDoc()"
      title="Đổi giữa đọc từng câu và đọc cả đoạn">${CD.kieuDoc === "doan" ? "\u00b6" : "\u2261"}</button>
    <button class="nut-tron nut-phat-bai" data-bai="${tienTo}"
      onclick="batTatPhatBai('${tienTo}')" title="Phát cả bài">▶</button>
    <button class="nut-tron phu2 ct-lap ${CD.lapBai ? "bat" : ""}" onclick="doiLap()"
      title="Phát 1 lần / lặp lại bài">🔁</button>
    <button class="nut-tron phu2 ct-tiep ${CD.tuChuyenBai ? "bat" : ""}" onclick="doiTuChuyen()"
      title="Hết bài tự sang bài kế">⏭</button>
    ${nutTocDo()}
    <button class="nut-tron phu2" onclick="batTatCaiDatDoc()" title="Hiển thị">Aa</button>
  </div>`;

/* Hai công tắc dùng chung cho cả trang: bài nào cũng có thanh riêng, bật ở
   thanh này mà thanh kia vẫn tắt thì nhìn như app quên mất lựa chọn. */
function doiCongTac(khoa, lop) {
  CD[khoa] = !CD[khoa];
  localStorage.setItem(khoa, CD[khoa] ? "1" : "0");
  $$(`.${lop}`).forEach(n => n.classList.toggle("bat", CD[khoa]));
}
/* Đổi giữa "từng câu" và "cả đoạn". Phải vẽ lại trang vì hai kiểu dựng
   HTML khác hẳn nhau, không phải chỉ bật/tắt một lớp CSS. */
function doiKieuDoc() {
  CD.kieuDoc = CD.kieuDoc === "doan" ? "cau" : "doan";
  localStorage.setItem("kieuDoc", CD.kieuDoc);
  dungPhat();
  veLaiTrangDoc();
}

const doiLap = () => doiCongTac("lapBai", "ct-lap");
const doiTuChuyen = () => doiCongTac("tuChuyenBai", "ct-tiep");

/* ================= 4 · TRUYỆN (đoạn văn) ================= */
function veTruyen(u) {
  const el = $("#truyen");
  const ds = (u.doan_van || []).filter(d => (d.cau || []).length);
  if (!ds.length) {
    el.innerHTML = `<div class="trong">Unit ${u.so} không có đoạn văn.<br>
      <span class="mo">Đoạn văn mẫu chủ yếu nằm ở Level 3–4 (unit 31–50).</span></div>`;
    return;
  }
  napDaDocTruyen();
  let h = `<div class="tom-tat" id="dem-truyen"></div>`;
  ds.forEach((d, di) => {
    const tienTo = `tr-${di}-`;
    const xong = daDocTruyen.has(khoaTruyen(u.so, d.ten));
    const noi = thanhCongCu("", tienTo) +
      (CD.kieuDoc === "doan"
        ? `<div class="the">${khoiDoan(tienTo, d.cau)}</div>`
        : `<div class="the">${d.cau.map((c, ci) =>
            dongDoc(`${tienTo}${ci}`, c.en, c.pa, c.vi || "")).join("")}</div>`);
    /* Bài tập mini-story gắn vào ĐÚNG truyện của nó. Ghép theo TÊN chứ không
       theo thứ tự: doan_van còn có truyện cũ và ba bản góc nhìn xen giữa. */
    const iMs = (u.mini_story || []).findIndex(m => m.ten === d.ten);
    /* Nút đánh dấu nằm CUỐI bài, sau phần bài tập: đọc xong, làm xong rồi mới
       tới nó — chứ để trên đầu thì bấm trước khi học cũng được. */
    const nutXongBai = `<div class="cuoi-truyen">
        <button class="nut-xong ${xong ? "da-xong" : ""}"
          onclick="batTatTruyenXong(${u.so},${JSON.stringify(d.ten).replace(/"/g, "&quot;")},this)">
          ${xong ? "✓ Đã học xong" : "Đánh dấu đã học xong"}</button>
      </div>`;
    macDinhKhoi(`truyen/bai-${di}`, di > 0);
    h += khoi(`truyen/bai-${di}`, d.ten,
      noi
      + (iMs >= 0 ? `<div class="khu-mini">${khoiMiniStory(u.mini_story[iMs], iMs)}</div>` : "")
      + nutXongBai,
      `${NHAN_THE_LOAI[d.the_loai] ? NHAN_THE_LOAI[d.the_loai] + " · " : ""}`
      + `${d.cau.length} câu${iMs >= 0 ? " · có bài tập" : ""}`,
      xong);
  });
  el.innerHTML = h;
  capNhatDemTruyen();
  setTimeout(capNhatNutXongTruyen, 0);   // chờ hàng nút được gắn vào đầu mục
}

/* --- Đã học xong TỪNG truyện ---
   Tick riêng cho mỗi truyện, không dùng chung trạng thái "Truyện" của unit:
   một unit có 5-13 đoạn, đánh dấu chung thì đọc một bài cũng thành xong hết.
   Khoá theo unit + tên truyện, nhớ trong localStorage của hồ sơ đang dùng. */
function khoaTruyen(soUnit, ten) {
  return `${soUnit}|${ten}`;
}

let daDocTruyen = new Set();

function napDaDocTruyen() {
  try {
    const d = JSON.parse(localStorage.getItem("truyenXong__" + (HS?.id || "mac_dinh")));
    daDocTruyen = new Set(Array.isArray(d) ? d : []);
  } catch (e) { daDocTruyen = new Set(); }
}

function luuDaDocTruyen() {
  localStorage.setItem("truyenXong__" + (HS?.id || "mac_dinh"),
    JSON.stringify([...daDocTruyen]));
}

function batTatTruyenXong(soUnit, ten, nut) {
  const k = khoaTruyen(soUnit, ten);
  const xong = daDocTruyen.has(k);
  xong ? daDocTruyen.delete(k) : daDocTruyen.add(k);
  luuDaDocTruyen();
  nut.classList.toggle("da-xong", !xong);
  nut.innerHTML = !xong ? "\u2713 Đã học xong" : "Đánh dấu đã học xong";
  // cập nhật tick trên đầu khối cho khớp
  const dau = nut.closest(".khoi")?.querySelector(".khoi-dau .tick-truyen");
  if (dau) dau.classList.toggle("du", !xong);
  capNhatDemTruyen();
  dongBoTrangThaiTruyen(soUnit);
}

/* Trạng thái mục "Truyện" của unit SUY RA từ số truyện đã đọc, không phải do
   bấm một nút.
   Một unit có 5-13 truyện. Trước đây nút ✓ ở đầu mục đánh dấu xong cả mục,
   nên đọc một truyện rồi bấm là unit hiện "Truyện ✓" trong khi còn 12 truyện
   chưa đụng tới — tiến độ nói dối. Năm mục kia mỗi mục là một việc trọn vẹn,
   riêng Truyện là một tập. */
function dsTruyenCuaUnit(soUnit) {
  const u = soUnit === S.unit ? S.duLieuUnit : null;
  return ((u?.doan_van) || []).filter(d => (d.cau || []).length);
}

async function dongBoTrangThaiTruyen(soUnit) {
  const ds = dsTruyenCuaUnit(soUnit);
  if (!ds.length) return;
  const xong = ds.filter(d => daDocTruyen.has(khoaTruyen(soUnit, d.ten))).length;
  const moi = xong === 0 ? "chua" : xong === ds.length ? "xong" : "dang";
  if (trangThai(soUnit, "truyen") !== moi) await datTrangThai(soUnit, "truyen", moi);
  veRail();
  capNhatNutXongTruyen();
}

/* Nút ✓ ở hàng điều hướng của mục Truyện: hiện đúng "đã đọc mấy / tổng mấy",
   và bấm là đánh dấu HẾT (hoặc bỏ hết) chứ không phải lật một cờ riêng. */
function capNhatNutXongTruyen() {
  if (S.tab !== "truyen") return;
  const ds = dsTruyenCuaUnit(S.unit);
  const xong = ds.filter(d => daDocTruyen.has(khoaTruyen(S.unit, d.ten))).length;
  const du = ds.length > 0 && xong === ds.length;
  $$("#truyen .nhom-nut-muc .nut-xong").forEach(b => {
    b.classList.toggle("da-xong", du);
    b.setAttribute("aria-pressed", String(du));
    b.title = ds.length
      ? `Đã đọc ${xong}/${ds.length} truyện — bấm để đánh dấu ${du ? "chưa đọc" : "đã đọc"} hết`
      : "Đánh dấu hoàn thành";
  });
}

async function batTatMoiTruyen(soUnit) {
  const ds = dsTruyenCuaUnit(soUnit);
  if (!ds.length) return;
  const du = ds.every(d => daDocTruyen.has(khoaTruyen(soUnit, d.ten)));
  ds.forEach(d => {
    const k = khoaTruyen(soUnit, d.ten);
    du ? daDocTruyen.delete(k) : daDocTruyen.add(k);
  });
  luuDaDocTruyen();
  await dongBoTrangThaiTruyen(soUnit);
  veTruyen(S.duLieuUnit);
}

/* Đếm hiện ở thanh đầu tab Truyện: nhìn là biết còn nợ mấy bài. */
function capNhatDemTruyen() {
  const el = $("#dem-truyen");
  if (!el || !S.duLieuUnit) return;
  const ds = (S.duLieuUnit.doan_van || []).filter(d => (d.cau || []).length);
  const xong = ds.filter(d => daDocTruyen.has(khoaTruyen(S.unit, d.ten))).length;
  el.textContent = `${xong}/${ds.length} bài đã học xong`;
}

/* ================= MINI-STORY (Effortless English) =================
   Ba phần bài tập gắn liền một truyện, đặt NGAY DƯỚI truyện đó chứ không
   tách thành mục riêng — đúng trình tự của Hoge: nghe truyện xong là vào
   ngay chuỗi câu hỏi, không nghỉ giữa chừng. */
/* Nhãn thể loại: nhìn danh sách là thấy ngay có ngụ ngôn, truyện cười, bí ẩn
   — chứ không phải toàn "chuyện thường ngày" như bản đầu. */
const NHAN_THE_LOAI = {
  doi_thuong: "Đời thường", ngu_ngon: "Ngụ ngôn", truyen_cuoi: "Truyện cười",
  bi_an: "Bí ẩn", cam_dong: "Cảm động", phieu_luu: "Phiêu lưu",
};

const NHAN_LOAI = {
  co_khong: "có/không", hoac: "hoặc", wh: "wh-", sai_de_sua: "sai → sửa",
};

function khoiMiniStory(ms, di) {
  if (!ms) return "";
  let h = "";
  /* Ba khối bài tập GẤP SẴN lần đầu: mở hết ra thì một truyện 8 câu kéo theo
     48 câu hỏi + 7 cụm + 6 câu đặt hỏi, màn dài 5000px và truyện — thứ phải
     đọc trước — bị đẩy mất hút. Người học tự mở khối nào muốn làm. */
  ["cum-tu", "hoi-dap", "dat-hoi"].forEach(k => macDinhKhoi(`mini/${k}-${di}`, true));

  if (ms.cum_tu?.length) {
    h += khoi(`mini/cum-tu-${di}`, "Cụm từ đáng nhớ",
      `<div class="ds-cum">` + ms.cum_tu.map(c => `<div class="mot-cum">
          <span class="cum">${esc(c.cum)}</span>${nutLoa(c.cum)}
          <span class="nghia">${esc(c.nghia)}</span>
        </div>`).join("") + `</div>
      <div class="mo" style="margin-top:8px">Học nguyên CỤM, đừng tách ra học
        từng từ — người bản ngữ nói bằng những khối dựng sẵn, ghép từng từ theo
        luật là ra câu đúng ngữ pháp mà nghe không giống ai.</div>`,
      `${ms.cum_tu.length} cụm`);
  }

  if (ms.hoi_dap?.length) {
    const kt = kieuTraLoi();
    h += khoi(`mini/hoi-dap-${di}`, "Nghe và trả lời", `
      <div class="mo" style="margin:10px 0">Trả lời THÀNH TIẾNG ngay khi nghe
        xong câu hỏi, đừng dịch trong đầu. Câu hỏi cố tình dễ — chỗ khó là trả
        lời cho kịp.</div>
      ${thanhKieuTraLoi()}
      <div class="dieu-khien" style="justify-content:flex-start; margin:0 0 10px">
        <button class="chinh" onclick="chayChuoiHoi(${di})" id="nut-chuoi-${di}">Chạy cả chuỗi</button>
        <button class="phu" onclick="dungChuoiHoi()">Dừng</button>
        <button class="phu" onclick="batTatHienDap(${di},this)">Hiện hết đáp án</button>
      </div>
      <div class="ds-hoi" id="ds-hoi-${di}">` + ms.hoi_dap.map((q, i) => `
        <div class="mot-hoi" id="hoi-${di}-${i}">
          <span class="nhan-loai ${esc(q.loai)}">${NHAN_LOAI[q.loai] || q.loai}</span>
          <span class="noi">
            <span class="hoi">${esc(q.hoi)}</span>
            <span class="dap an-dap">${esc(q.dap)}</span>
            ${kt === "nghe" ? "" : oLamBai(ms, di, i, kt)}
          </span>
          <button class="loa" onclick="docCapHoiDap(${di},${i})" title="Nghe câu hỏi rồi đáp án">🔊</button>
        </div>`).join("") + `</div>`, `${ms.hoi_dap.length} câu`);
  }

  if (ms.dat_cau_hoi?.length) {
    const kd = kieuDatHoi();
    h += khoi(`mini/dat-hoi-${di}`, "Đặt câu hỏi cho đáp án", `
      <div class="mo" style="margin:10px 0">Cho sẵn câu trả lời, bạn tìm câu
        hỏi. Phần này KHÔNG có trong Effortless English — Hoge chỉ cho trả lời.
        Thêm vào vì nghe hiểu tốt mà không tự bật ra câu hỏi được là chuyện rất
        hay gặp.</div>
      ${thanhKieuDatHoi()}
      ${kd === "chon" ? `<div class="mo" style="margin:0 0 10px">Chọn câu hỏi
        đúng theo ĐÚNG THÌ của truyện. Ba câu còn lại đều là lỗi có thật:
        sai từ để hỏi, sai trợ động từ, hoặc quên đảo ngữ.</div>` : ""}
      ` + ms.dat_cau_hoi.map((d, i) => `
        <div class="mot-dat" id="dat-${di}-${i}">
          <div class="dap-cho-san">${esc(d.dap_an)}</div>
          ${kd === "chon" && (d.nhieu || []).length >= 2
            ? oChonCauHoi(d, di, i)
            : `<div class="hang">
                <input type="text" placeholder="Câu hỏi tiếng Anh…" id="ip-dat-${di}-${i}"
                  onkeydown="if(event.key==='Enter')kiemDatHoi(${di},${i})">
                <button class="phu" onclick="kiemDatHoi(${di},${i})">Kiểm tra</button>
              </div>`}
          <div class="kq-dat" id="kq-dat-${di}-${i}"></div>
        </div>`).join(""), `${ms.dat_cau_hoi.length} câu`);
  }
  return h;
}

/* ================= LÀM BÀI: GÕ HAY CHỌN =================
   Trước đây hai phần bài tập chỉ có một cách: phần "Nghe và trả lời" không
   nhận câu trả lời nào cả (chỉ nghe rồi tự đối chiếu), còn phần "Đặt câu hỏi"
   bắt gõ đúng từng chữ so với một đáp án mẫu duy nhất.
   Cả hai đều không đo được thứ chúng muốn đo: một câu trả lời có nhiều cách
   nói đúng, một đáp án có nhiều câu hỏi đúng. */
const kieuTraLoi = () => localStorage.getItem("kieuTraLoi") || "chon";
const kieuDatHoi = () => localStorage.getItem("kieuDatHoi") || "chon";

function doiKieuTraLoi(v) {
  localStorage.setItem("kieuTraLoi", v);
  if (S.duLieuUnit) veTruyen(S.duLieuUnit);
}

function doiKieuDatHoi(v) {
  localStorage.setItem("kieuDatHoi", v);
  if (S.duLieuUnit) veTruyen(S.duLieuUnit);
}

const thanhKieuTraLoi = () => `
  <div class="hop-tab hop-tab-vien" style="margin-bottom:10px">
    ${[["chon", "Chọn đáp án"], ["go", "Gõ đáp án"], ["nghe", "Chỉ nghe"]]
      .map(([v, t]) => `<button class="${kieuTraLoi() === v ? "chon" : ""}"
        onclick="doiKieuTraLoi('${v}')">${t}</button>`).join("")}
  </div>`;

const thanhKieuDatHoi = () => `
  <div class="hop-tab hop-tab-vien" style="margin-bottom:10px">
    ${[["chon", "Chọn câu hỏi"], ["go", "Tự gõ câu hỏi"]]
      .map(([v, t]) => `<button class="${kieuDatHoi() === v ? "chon" : ""}"
        onclick="doiKieuDatHoi('${v}')">${t}</button>`).join("")}
  </div>`;

/* --- chuẩn hoá để so --- */
const chuanDap = s => (s || "").toLowerCase()
  .replace(/[’‘]/g, "'").replace(/[“”]/g, "").replace(/[–—]/g, "-")
  .replace(/[?.!,;:]/g, " ").replace(/\s+/g, " ").trim();

/* Từ không mang thông tin. Bỏ chúng đi thì "She is at home" và "At home" có
   cùng phần lõi, và đó mới là thứ cần so. */
const TU_RONG = new Set(["a", "an", "the", "is", "are", "am", "was", "were",
  "do", "does", "did", "to", "at", "in", "on", "of", "it", "he", "she", "they",
  "his", "her", "their", "there", "that", "this", "and", "yes", "no"]);

const loiDap = s => chuanDap(s).split(" ").filter(w => w && !TU_RONG.has(w));

/* Ba mức, không phải hai. Vì sao không chỉ đúng/sai: máy chỉ đối chiếu được
   TỪ KHOÁ, không hiểu câu. Câu chứa đủ từ khoá nhưng phủ định ngược lại thì
   máy không thấy — nói thẳng là "gần đúng, tự đối chiếu" trung thực hơn là
   chấm "đúng" rồi để người học tin nhầm. */
function chamDap(cuaToi, mau) {
  const a = chuanDap(cuaToi), b = chuanDap(mau);
  if (!a) return { muc: "trong" };
  if (a === b) return { muc: "dung" };

  const coYes = /\byes\b/.test(a), coNo = /\bno\b|n't|\bnot\b/.test(a);
  const mauYes = /^yes\b/.test(b), mauNo = /^no\b|\bnot\b/.test(b);
  if ((mauYes && coNo && !coYes) || (mauNo && coYes && !coNo)) {
    return { muc: "sai", vi: "Câu trả lời ngược với đáp án." };
  }

  const loi = loiDap(mau), cua = loiDap(cuaToi);
  if (!loi.length) return { muc: (mauYes && coYes) || (mauNo && coNo) ? "dung" : "gan" };
  const thieu = loi.filter(w => !cua.includes(w));
  if (!thieu.length) return { muc: "dung" };
  if (thieu.length < loi.length) return { muc: "gan", vi: `Còn thiếu: ${thieu.join(", ")}` };
  return { muc: "sai" };
}

/* --- ô làm bài của phần Nghe và trả lời --- */
/* Nhiễu lấy từ ĐÁP ÁN THẬT của các câu khác trong cùng truyện: đều là câu
   trả lời hợp lý cho một câu hỏi nào đó của truyện này, nên chọn nhầm nghĩa là
   nghe chưa ra câu hỏi — đúng thứ bài này muốn đo. Bịa đáp án vu vơ thì loại
   trừ được bằng cảm giác, không cần nghe. */
function dapNhieu(ms, i) {
  const q = ms.hoi_dap[i];
  const dap = q.dap;
  const co = [dap];
  const them = x => {
    if (x && !co.some(y => chuanDap(y) === chuanDap(x))) co.push(x);
  };

  if (q.loai === "co_khong" || q.loai === "sai_de_sua") {
    them(/^yes/i.test(dap) ? "No." : "Yes.");
  }
  if (q.loai === "hoac") {
    // câu hỏi "A or B" — mảnh còn lại chính là nhiễu tốt nhất
    const m = String(q.hoi).match(/\b(.+?)\s+or\s+(.+?)\s*\?/i);
    if (m) { them(m[1].split(/\s+/).slice(-3).join(" ")); them(m[2]); }
  }
  ms.hoi_dap.forEach((k, j) => { if (j !== i && co.length < 4) them(k.dap); });
  return co.slice(0, 4);
}

function oLamBai(ms, di, i, kt) {
  if (kt === "go") {
    return `<div class="o-lam">
        <input type="text" placeholder="Trả lời tiếng Anh…" id="ip-dap-${di}-${i}"
          onkeydown="if(event.key==='Enter')kiemDap(${di},${i})">
        <button class="phu" onclick="kiemDap(${di},${i})">Kiểm tra</button>
        <div class="kq-dap" id="kq-dap-${di}-${i}"></div>
      </div>`;
  }
  const cac = xaoTheoKhoa(dapNhieu(ms, i), `${di}|${i}|${ms.ten}`);
  return `<div class="o-lam o-chon" id="chon-dap-${di}-${i}">
      ${cac.map(x => `<button class="nut-chon"
        data-dap="${esc(x)}" onclick="chonDap(${di},${i},this)">${esc(x)}</button>`).join("")}
      <div class="kq-dap" id="kq-dap-${di}-${i}"></div>
    </div>`;
}

/* Xáo theo khoá cố định: cùng một câu thì thứ tự luôn như nhau. Xáo ngẫu
   nhiên mỗi lần vẽ lại thì bấm nhầm liên tục, mà vẽ lại xảy ra mỗi lần đổi
   một cài đặt bất kỳ. */
function xaoTheoKhoa(ds, khoa) {
  let h = 0;
  for (let i = 0; i < khoa.length; i++) h = (h * 31 + khoa.charCodeAt(i)) >>> 0;
  const ra = ds.slice();
  for (let i = ra.length - 1; i > 0; i--) {
    h = (h * 1103515245 + 12345) >>> 0;
    const j = h % (i + 1);
    [ra[i], ra[j]] = [ra[j], ra[i]];
  }
  return ra;
}

function chonDap(di, i, nut) {
  const q = (S.duLieuUnit?.mini_story || [])[di]?.hoi_dap?.[i];
  if (!q) return;
  const hop = $(`#chon-dap-${di}-${i}`);
  if (hop.classList.contains("da-lam")) return;
  hop.classList.add("da-lam");
  const dung = chuanDap(nut.dataset.dap) === chuanDap(q.dap);
  hop.querySelectorAll(".nut-chon").forEach(b => {
    b.disabled = true;
    if (chuanDap(b.dataset.dap) === chuanDap(q.dap)) b.classList.add("dung");
    else if (b === nut) b.classList.add("sai");
  });
  $(`#kq-dap-${di}-${i}`).innerHTML = dung
    ? `<span class="dung">✓ Đúng.</span>`
    : `<span class="sai">✗ Đáp án: <b>${esc(q.dap)}</b></span>`;
  $(`#hoi-${di}-${i}`)?.classList.add("hien-dap");
  doc(q.dap);
}

function kiemDap(di, i) {
  const q = (S.duLieuUnit?.mini_story || [])[di]?.hoi_dap?.[i];
  if (!q) return;
  const kq = chamDap($(`#ip-dap-${di}-${i}`).value, q.dap);
  const o = $(`#kq-dap-${di}-${i}`);
  if (kq.muc === "trong") { o.innerHTML = `<span class="mo">Chưa nhập gì.</span>`; return; }
  o.innerHTML = kq.muc === "dung"
    ? `<span class="dung">✓ Được.</span> <span class="mo">Mẫu: ${esc(q.dap)}</span>`
    : kq.muc === "gan"
      ? `<span class="gan">≈ Gần đúng.</span> <span class="mo">${esc(kq.vi || "")}
         — mẫu: ${esc(q.dap)}</span>`
      : `<span class="sai">✗ Chưa đúng.</span> <span class="mo">${esc(kq.vi || "")}
         Mẫu: <b>${esc(q.dap)}</b></span>`;
  $(`#hoi-${di}-${i}`)?.classList.add("hien-dap");
}

/* --- ô chọn của phần Đặt câu hỏi --- */
function oChonCauHoi(d, di, i) {
  const cac = xaoTheoKhoa([d.cau_hoi, ...(d.nhieu || []).slice(0, 3)],
    `${di}|${i}|${d.dap_an}`);
  return `<div class="o-lam o-chon" id="chon-hoi-${di}-${i}">
      ${cac.map(x => `<button class="nut-chon"
        data-hoi="${esc(x)}" onclick="chonCauHoi(${di},${i},this)">${esc(x)}</button>`).join("")}
    </div>`;
}

function chonCauHoi(di, i, nut) {
  const d = (S.duLieuUnit?.mini_story || [])[di]?.dat_cau_hoi?.[i];
  if (!d) return;
  const hop = $(`#chon-hoi-${di}-${i}`);
  if (hop.classList.contains("da-lam")) return;
  hop.classList.add("da-lam");
  const dung = chuanCauHoi(nut.dataset.hoi) === chuanCauHoi(d.cau_hoi);
  hop.querySelectorAll(".nut-chon").forEach(b => {
    b.disabled = true;
    if (chuanCauHoi(b.dataset.hoi) === chuanCauHoi(d.cau_hoi)) b.classList.add("dung");
    else if (b === nut) b.classList.add("sai");
  });
  $(`#kq-dat-${di}-${i}`).innerHTML = dung
    ? `<span class="dung">✓ Đúng.</span>${nutLoa(d.cau_hoi)}`
    : `<span class="sai">✗ Câu đúng là: <b>${esc(d.cau_hoi)}</b></span>${nutLoa(d.cau_hoi)}`;
}

/* --- chuỗi hỏi-đáp: hỏi → chờ bạn nói → đáp --- */
let chuoiHoi = { dang: false, di: 0, i: 0 };

function dungChuoiHoi() {
  chuoiHoi.dang = false;
  dungPhat();
  $$(".mot-hoi").forEach(x => x.classList.remove("dang-doc"));
}

function chayChuoiHoi(di) {
  if (chuoiHoi.dang) return dungChuoiHoi();
  chuoiHoi = { dang: true, di, i: 0 };
  buocChuoi();
}

function buocChuoi() {
  if (!chuoiHoi.dang) return;
  const ms = (S.duLieuUnit?.mini_story || [])[chuoiHoi.di];
  const q = ms?.hoi_dap?.[chuoiHoi.i];
  if (!q) return dungChuoiHoi();
  $$(".mot-hoi").forEach(x => x.classList.remove("dang-doc"));
  const dong = $(`#hoi-${chuoiHoi.di}-${chuoiHoi.i}`);
  if (dong) {
    dong.classList.add("dang-doc");
    dong.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
  doc(q.hoi, { xong: () => {
    if (!chuoiHoi.dang) return;
    /* Khoảng lặng để bạn TỰ nói ra đáp án trước khi nghe. Bỏ khoảng này thì
       thành nghe đọc chính tả, mất hẳn phần "answer" của listen-and-answer. */
    setTimeout(() => {
      if (!chuoiHoi.dang) return;
      dong?.classList.add("hien-dap");
      doc(q.dap, { xong: () => {
        if (!chuoiHoi.dang) return;
        chuoiHoi.i++;
        setTimeout(buocChuoi, 500);
      }});
    }, (+localStorage.getItem("giayNoi") || 2) * 1000);
  }});
}

function docCapHoiDap(di, i) {
  const ms = (S.duLieuUnit?.mini_story || [])[di];
  const q = ms?.hoi_dap?.[i];
  if (!q) return;
  const dong = $(`#hoi-${di}-${i}`);
  doc(q.hoi, { xong: () => setTimeout(() => {
    dong?.classList.add("hien-dap");
    doc(q.dap);
  }, (+localStorage.getItem("giayNoi") || 2) * 1000) });
}

function batTatHienDap(di, nut) {
  const ds = $(`#ds-hoi-${di}`);
  const hien = !ds.classList.contains("hien-het");
  ds.classList.toggle("hien-het", hien);
  nut.textContent = hien ? "Ẩn đáp án" : "Hiện hết đáp án";
}

/* --- đặt câu hỏi ngược --- */
const chuanCauHoi = s => (s || "").toLowerCase()
  .replace(/[’‘]/g, "'").replace(/[“”]/g, "").replace(/[–—]/g, "-")
  .replace(/[?.!,]/g, " ").replace(/\s+/g, " ").trim();

function kiemDatHoi(di, i) {
  const d = (S.duLieuUnit?.mini_story || [])[di]?.dat_cau_hoi?.[i];
  if (!d) return;
  const cuaToi = chuanCauHoi($(`#ip-dat-${di}-${i}`).value);
  const nhan = [d.cau_hoi, ...(d.chap_nhan || [])].map(chuanCauHoi);
  const o = $(`#kq-dat-${di}-${i}`);
  if (!cuaToi) { o.innerHTML = `<span class="mo">Chưa nhập câu hỏi.</span>`; return; }
  /* Khớp nguyên văn một trong các bản chấp nhận thì chắc chắn đúng. Không
     khớp thì CHƯA chắc sai: "Where's Lan?" và "Where is Lan?" là một câu.
     So thêm phần lõi (bỏ dạng rút gọn và từ rỗng) để bắt các trường hợp đó,
     nhưng chỉ dám gọi là "gần đúng" — máy không hiểu câu, nói chắc là nói ẩu. */
  const dung = nhan.includes(cuaToi);
  const loi = x => chuanCauHoi(x).replace(/'s\b/g, " is").replace(/'re\b/g, " are")
    .replace(/n't\b/g, " not").split(" ").filter(w => w && !TU_RONG.has(w)).sort().join(" ");
  const gan = !dung && [d.cau_hoi, ...(d.chap_nhan || [])].some(x => loi(x) === loi(cuaToi));
  o.innerHTML = dung
    ? `<span class="dung">✓ Đúng.</span>`
    : gan
      ? `<span class="gan">≈ Sát rồi — cùng ý, khác cách nói.</span>
         <span class="mo">Mẫu:</span> <b>${esc(d.cau_hoi)}</b>${nutLoa(d.cau_hoi)}`
      : `<span class="sai">✗ Chưa khớp.</span> <span class="mo">Đáp án mẫu:</span>
         <b>${esc(d.cau_hoi)}</b>${nutLoa(d.cau_hoi)}`;
}

/* ================= THÌ TRONG TIẾNG ANH =================
   Chất liệu ở đây từng nằm trong tab Truyện: mỗi mini-story kèm ba bản kể lại
   ở thì khác. Đọc bốn bản liền nhau thì mạch truyện gãy, câu nghe như máy —
   nên chuyển hẳn sang đây, nơi bốn bản nằm CẠNH NHAU theo từng câu.
   Cùng một dữ liệu, đổi chỗ đặt là đổi hẳn công dụng: ở kia nó phá truyện,
   ở đây nó là bảng đối chiếu tốt nhất có thể có. */
let duLieuThi = null;
let theThi = localStorage.getItem("theThi") || "bang";
let thiDaHoc = new Set();
let truyenThi = +(localStorage.getItem("truyenThi") || 0);

function napThiDaHoc() {
  try {
    const d = JSON.parse(localStorage.getItem("thiXong__" + (HS?.id || "mac_dinh")));
    thiDaHoc = new Set(Array.isArray(d) ? d : []);
  } catch (e) { thiDaHoc = new Set(); }
}

const luuThiDaHoc = () =>
  localStorage.setItem("thiXong__" + (HS?.id || "mac_dinh"), JSON.stringify([...thiDaHoc]));

function batTatThiXong(ma) {
  thiDaHoc.has(ma) ? thiDaHoc.delete(ma) : thiDaHoc.add(ma);
  luuThiDaHoc();
  veThi();
}

async function moThi() {
  dungPhat();
  S.tab = "thi";
  $$(".trang").forEach(x => x.classList.toggle("hien", x.id === "thi"));
  if (!duLieuThi) {
    $("#thi").innerHTML = `<div class="trong">Đang nạp…</div>`;
    duLieuThi = await (await fetch("/api/thi")).json();
  }
  napThiDaHoc();
  veThi();
  veRail();
  dongRail();
  window.scrollTo({ top: 0 });
}

function doiTheThi(v) {
  theThi = v;
  localStorage.setItem("theThi", v);
  veThi();
}

const thanhTheThi = () => `
  <div class="hop-tab hop-tab-vien">
    ${[["bang", "Bảng thì"], ["de-nham", "Dễ nhầm"],
       ["so-cau", "So câu"], ["luyen", "Luyện đổi thì"]]
      .map(([v, t]) => `<button class="${theThi === v ? "chon" : ""}"
        onclick="doiTheThi('${v}')">${t}</button>`).join("")}
  </div>`;

/* ---------- thẻ 1: bảng 8 thì ---------- */
const NHOM_THI = {
  hien_tai: "Hiện tại", qua_khu: "Quá khứ",
  hoan_thanh: "Hoàn thành", tuong_lai: "Tương lai",
};

function veBangThi() {
  let h = `<div class="the">
      <h3 style="margin-top:0">Vì sao thì là chỗ vướng riêng của người Việt</h3>
      <div>Tiếng Việt không chia động từ. "Đi" là "đi" ở mọi thời điểm; thời gian
        nằm ở trạng từ (hôm qua, ngày mai) hoặc ở ba hư từ <b>đã / đang / sẽ</b> —
        mà ba hư từ này còn lược được khi câu đã rõ lúc nào.</div>
      <div style="margin-top:8px">Mang nguyên phản xạ đó sang tiếng Anh thì ra
        <i>He go to school</i>, <i>Yesterday I go</i>, <i>I have gone last year</i>.
        Không phải quên quy tắc — là tai chưa thấy thiếu gì cả. Cách chữa nhanh
        nhất không phải học thuộc bảng, mà là NGHE cùng một câu ở nhiều thì cho
        đến khi đuôi <i>-ed</i> và <i>have</i> tự bật ra.</div>
    </div>`;

  const theoNhom = {};
  duLieuThi.thi.forEach(t => (theoNhom[t.nhom] ||= []).push(t));

  Object.entries(theoNhom).forEach(([nh, ds]) => {
    const xong = ds.filter(t => thiDaHoc.has(t.ma)).length;
    h += `<div class="ten-nhom-thi">${NHOM_THI[nh] || nh}
        <span class="mo">${xong}/${ds.length}</span></div>`;
    ds.forEach(t => {
      const daXong = thiDaHoc.has(t.ma);
      macDinhKhoi(`thi/${t.ma}`, true);
      h += khoi(`thi/${t.ma}`, t.ten, `
        ${veTruc(t.truc)}
        <div class="cong-thuc">
          <div><span class="nhan-ct">Khẳng định</span><b>${esc(t.cong_thuc)}</b></div>
          <div><span class="nhan-ct">Phủ định</span><b>${esc(t.phu_dinh)}</b></div>
          <div><span class="nhan-ct">Nghi vấn</span><b>${esc(t.hoi)}</b></div>
        </div>
        <h4>Dùng khi nào</h4>
        <ul class="ds-cham">${t.dung_khi.map(x => `<li>${esc(x)}</li>`).join("")}</ul>
        <h4>Dấu hiệu nhận biết</h4>
        <div class="ds-dau-hieu">${t.dau_hieu.map(x =>
          `<span class="tu-dau-hieu">${esc(x)}</span>`).join("")}</div>
        <h4>Bẫy của người Việt</h4>
        <div class="canh-bao">${esc(t.bay).replace(/\n/g, "<br>")}</div>
        <h4>Tự kiểm — không cần thầy</h4>
        <div class="tu-kiem">${esc(t.tu_kiem)}</div>
        <h4>Ví dụ</h4>
        <div class="ds-vd-thi">${t.vi_du.map(v => `
          <div class="vd-thi">
            <div class="hang"><span class="en">${esc(v.en)}</span>${nutLoa(v.en)}</div>
            <div class="vi">${esc(v.vi)}</div>
          </div>`).join("")}</div>
        <button class="nut-xong ${daXong ? "da-xong" : ""}" style="margin-top:12px"
          onclick="batTatThiXong('${t.ma}')">
          ${daXong ? "✓ Đã nắm" : "Đánh dấu đã nắm"}</button>`,
        t.ten_en, daXong);
    });
  });
  return h;
}

/* ---------- trục thời gian ----------
   "Thì" trong tiếng Việt chính là "thời gian", mà thời gian thì vẽ ra được.
   Mỗi thẻ có một trục từ quá khứ xa qua BÂY GIỜ tới tương lai xa, đánh dấu
   đúng vùng của thì đó. Nhìn hình một giây là biết thì này nằm ở đâu — nhanh
   hơn đọc ba dòng định nghĩa, và đúng với cách người ta thật sự nghĩ về thời
   gian: một đường thẳng có mốc "bây giờ" ở giữa. */
const X_TRUC = v => 160 + v * 13.6;

function veTruc(ds) {
  if (!ds || !ds.length) return "";
  const nhan = [];
  let h = `<svg class="truc-tg" viewBox="0 0 320 78" role="img"
      aria-label="Trục thời gian: vị trí của thì này so với hiện tại">
    <line x1="12" y1="52" x2="308" y2="52" class="tr-truc"/>
    <polygon points="308,52 300,49 300,55" class="tr-mui"/>
    <line x1="${X_TRUC(0)}" y1="20" x2="${X_TRUC(0)}" y2="66" class="tr-nay"/>
    <text x="${X_TRUC(0)}" y="76" class="tr-chu-nay">BÂY GIỜ</text>
    <text x="14" y="76" class="tr-chu-phu">quá khứ</text>
    <text x="306" y="76" class="tr-chu-phu tr-phai">tương lai</text>`;

  ds.forEach(m => {
    const mo = m.phu ? " tr-phu" : "";
    if (m.loai === "diem") {
      h += `<circle cx="${X_TRUC(m.tai)}" cy="52" r="6" class="tr-diem${mo}"/>`;
      if (m.nhan) nhan.push([m.tai, m.nhan, m.phu]);
    } else if (m.loai === "khoang") {
      const x = X_TRUC(m.tu), w = X_TRUC(m.den) - x;
      h += `<rect x="${x}" y="46" width="${w}" height="12" rx="6"
              class="tr-khoang${mo}"/>`;
      if (m.nhan) nhan.push([(m.tu + m.den) / 2, m.nhan, m.phu]);
    } else if (m.loai === "lap") {
      for (let v = m.tu; v <= m.den; v += 3)
        h += `<circle cx="${X_TRUC(v)}" cy="52" r="4" class="tr-diem${mo}"/>`;
      if (m.nhan) nhan.push([0, m.nhan, m.phu]);
    } else if (m.loai === "noi") {
      h += `<path d="M ${X_TRUC(m.tu)} 40 Q ${X_TRUC((m.tu + m.den) / 2)} 24
              ${X_TRUC(m.den)} 40" class="tr-noi"/>`;
    }
  });
  h += `</svg>`;

  /* Chú thích để DƯỚI hình, không nhét vào trong SVG: chữ trong SVG không tự
     xuống dòng, nhãn dài một chút là tràn ra ngoài khung. */
  h += `<div class="chu-truc">${nhan.map(([v, t, phu]) =>
    `<span class="${phu ? "phu" : ""}">${v < -0.5 ? "◀" : v > 0.5 ? "▶" : "●"}
       ${esc(t)}</span>`).join("")}</div>`;
  return `<div class="hop-truc">${h}</div>`;
}

/* ---------- thẻ: các cặp thì dễ nhầm ----------
   Học riêng từng thì thì thì nào cũng có vẻ rõ ràng; chỉ khi hai thì đứng
   cạnh nhau mới lộ ra chỗ thật sự khó. Mỗi cặp mở đầu bằng MỘT câu hỏi tự
   phân biệt — lúc đang viết thì cần một câu hỏi trả lời được trong hai giây,
   không phải một đoạn định nghĩa. */
function veDeNham() {
  const ds = duLieuThi.so_sanh || [];
  if (!ds.length) return `<div class="trong">Chưa có dữ liệu.</div>`;
  let h = `<div class="the">
      <h3 style="margin-top:0">Hai thì đứng cạnh nhau mới thấy chỗ khó</h3>
      <div>Mỗi cặp dưới đây bắt đầu bằng một câu hỏi. Trả lời được câu hỏi đó
        là chọn đúng thì — không cần nhớ định nghĩa.</div>
    </div>`;

  ds.forEach((c, i) => {
    macDinhKhoi(`nham/${c.ma}`, i > 0);
    h += khoi(`nham/${c.ma}`, c.ten, `
      <div class="cau-phan-biet">
        <span class="nhan-hoi">Tự hỏi</span>${esc(c.cau_hoi)}
      </div>
      <div class="mo" style="margin:10px 0">${esc(c.vi_sao)}</div>
      <div class="luoi-so-thi">
        ${c.cot.map(x => `<div class="o-so-thi">
            <div class="ten-thi">${esc(x.thi)}</div>
            <div class="khi">${esc(x.khi)}</div>
            <div class="hang"><span class="en">${esc(x.cau)}</span>${nutLoa(x.cau)}</div>
            <div class="vi">${esc(x.vi)}</div>
            <div class="giai">${esc(x.giai)}</div>
          </div>`).join("")}
      </div>
      <h4>Bẫy</h4>
      <div class="canh-bao">${mdSangHtml(c.bay)}</div>
      <h4>Mẹo phân biệt</h4>
      <div class="tu-kiem">${mdSangHtml(c.meo)}</div>
      <h4>Thử ngay</h4>
      <div class="ds-thu-nham">${c.bai_tap.map((b, k) => `
        <div class="mot-thu" id="nham-${c.ma}-${k}">
          <div class="de">${esc(b.de)}</div>
          <div class="hang" style="gap:6px; flex-wrap:wrap">
            ${b.chon.map(x => `<button class="nut-chon" data-dap="${esc(x)}"
                onclick="chonNham('${c.ma}',${k},this)">${esc(x)}</button>`).join("")}
          </div>
          <div class="kq" id="kq-nham-${c.ma}-${k}"></div>
        </div>`).join("")}</div>`,
      `${c.bai_tap.length} câu`, c.muc === "nang" ? null : undefined);
  });
  return h;
}

function chonNham(ma, k, nut) {
  const c = (duLieuThi.so_sanh || []).find(x => x.ma === ma);
  const b = c?.bai_tap?.[k];
  if (!b) return;
  const hop = nut.closest(".mot-thu");
  if (hop.classList.contains("da-lam")) return;
  hop.classList.add("da-lam");
  const dung = nut.dataset.dap === b.dap_an;
  hop.querySelectorAll(".nut-chon").forEach(x => {
    x.disabled = true;
    if (x.dataset.dap === b.dap_an) x.classList.add("dung");
    else if (x === nut) x.classList.add("sai");
  });
  $(`#kq-nham-${ma}-${k}`).innerHTML = dung
    ? `<span class="dung">✓ Đúng.</span>`
    : `<span class="sai">✗ Đáp án: <b>${esc(b.dap_an)}</b></span>`;
}

/* ---------- thẻ 2: so cùng một câu ở bốn thì ----------
   Tô đậm đúng chữ đã đổi. Đây là toàn bộ giá trị của màn này: bốn câu xếp
   chồng mà không đánh dấu thì mắt vẫn trượt qua, đọc xong không nhớ đã đổi gì. */
function chuKhac(goc, moi) {
  const a = String(goc).split(/(\s+)/), b = String(moi).split(/(\s+)/);
  const sach = w => w.toLowerCase().replace(/[.,!?;:]/g, "");
  /* LCS trên mảng từ. Truyện dài nhất ~30 từ nên bảng 30×30 là không đáng kể,
     đổi lại đánh dấu đúng cả khi câu dài thêm chữ (will, have) chứ không lệch
     nhịp như khi so từng vị trí một. */
  const n = a.length, m = b.length;
  const d = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      d[i][j] = sach(a[i]) === sach(b[j])
        ? d[i + 1][j + 1] + 1 : Math.max(d[i + 1][j], d[i][j + 1]);
  let i = 0, j = 0, ra = "";
  while (j < m) {
    if (i < n && sach(a[i]) === sach(b[j])) { ra += esc(b[j]); i++; j++; }
    else if (i < n && d[i + 1][j] >= d[i][j + 1]) i++;
    else { ra += `<mark>${esc(b[j])}</mark>`; j++; }
  }
  return ra;
}

function doiTruyenThi(v) {
  truyenThi = +v;
  localStorage.setItem("truyenThi", truyenThi);
  veThi();
}

function veSoCau() {
  const ds = duLieuThi.truyen;
  if (!ds.length) return `<div class="trong">Chưa có dữ liệu truyện.</div>`;
  const t = ds[Math.min(truyenThi, ds.length - 1)];
  const cot = duLieuThi.cot.filter(c => c.ma === "ht" || t.co.includes(c.ma));

  return `<div class="the">
      <h3 style="margin-top:0">Cùng một câu, đổi thì thì đổi những gì</h3>
      <div>Mỗi hàng là MỘT câu của truyện, viết lại ở từng thì. Chữ được tô là
        chữ đã đổi so với hiện tại đơn — nhìn cột dọc là thấy quy luật, không
        phải học thuộc bảng chia động từ.</div>
      <label style="margin-top:10px">Chọn truyện
        <select onchange="doiTruyenThi(this.value)">
          ${ds.map((x, i) => `<option value="${i}" ${i === truyenThi ? "selected" : ""}
            >Unit ${x.unit} — ${esc(x.ten)}</option>`).join("")}
        </select>
      </label>
    </div>
    <div class="cuon-ngang">
      <table class="bang-thi">
        <thead><tr>${cot.map(c => `<th>${esc(c.ten)}</th>`).join("")}</tr></thead>
        <tbody>${t.cau.map(h => `<tr>
          ${cot.map(c => {
            const cau = h[c.ma];
            if (!cau) return `<td class="trong-o">—</td>`;
            return `<td>
              <div class="hang-o">
                <span class="en">${c.ma === "ht" ? esc(cau) : chuKhac(h.ht, cau)}</span>
                ${nutLoa(cau)}
              </div>
              ${c.ma === "ht" && h.vi ? `<div class="vi">${esc(h.vi)}</div>` : ""}
            </td>`;
          }).join("")}
        </tr>`).join("")}</tbody>
      </table>
    </div>`;
}

/* ---------- thẻ 3: luyện đổi thì ----------
   Chọn đáp án chứ không gõ. Gõ lại cả câu dài 12 chữ thì cái sai chủ yếu là
   lỗi đánh máy, không phải lỗi thì — chấm kiểu đó vừa oan vừa không dạy được
   gì. Bốn lựa chọn là bốn bản THẬT của chính câu đó, nên nhiễu không phải câu
   bịa: chọn nhầm nghĩa là thật sự chưa phân biệt được hai thì. */
let cauLuyen = null;

function bocCauLuyen() {
  const ds = duLieuThi.truyen.filter(t => t.co.length >= 2);
  if (!ds.length) return null;
  for (let thu = 0; thu < 40; thu++) {
    const t = ds[Math.floor(Math.random() * ds.length)];
    const h = t.cau[Math.floor(Math.random() * t.cau.length)];
    const co = duLieuThi.cot.filter(c => c.ma !== "ht" && h[c.ma]);
    if (!co.length) continue;
    const dich = co[Math.floor(Math.random() * co.length)];
    const cac = [h.ht, ...duLieuThi.cot.filter(c => c.ma !== "ht" && h[c.ma]).map(c => h[c.ma])];
    const chon = [...new Set(cac)].sort(() => Math.random() - 0.5);
    if (chon.length < 2) continue;
    return { goc: h.ht, vi: h.vi || "", dichTen: dich.ten, dap: h[dich.ma], chon,
             unit: t.unit, ten: t.ten };
  }
  return null;
}

function cauLuyenMoi() {
  cauLuyen = bocCauLuyen();
  veThi();
}

function chonLuyen(k) {
  if (!cauLuyen || cauLuyen.daChon != null) return;
  cauLuyen.daChon = k;
  veThi();
  doc(cauLuyen.chon[k]);
}

function veLuyen() {
  if (!cauLuyen) cauLuyen = bocCauLuyen();
  if (!cauLuyen) return `<div class="trong">Chưa có dữ liệu để luyện.</div>`;
  const c = cauLuyen;
  const xong = c.daChon != null;
  return `<div class="the">
      <h3 style="margin-top:0">Đổi câu này sang <b>${esc(c.dichTen)}</b></h3>
      <div class="hang" style="margin:10px 0">
        <span class="cau-anh" style="font-size:19px">${esc(c.goc)}</span>${nutLoa(c.goc)}
      </div>
      ${c.vi ? `<div class="vi">${esc(c.vi)}</div>` : ""}
      <div class="ds-chon-thi">${c.chon.map((x, k) => {
        const dung = x === c.dap;
        const lop = !xong ? "" : dung ? "dung" : (k === c.daChon ? "sai" : "mo-di");
        return `<button class="o-chon-thi ${lop}" onclick="chonLuyen(${k})"
            ${xong ? "disabled" : ""}>${xong && x !== c.goc ? chuKhac(c.goc, x) : esc(x)}</button>`;
      }).join("")}</div>
      ${xong ? `<div class="${c.chon[c.daChon] === c.dap ? "dung" : "sai"}" style="margin-top:10px">
          ${c.chon[c.daChon] === c.dap ? "✓ Đúng." : "✗ Chưa đúng — câu được tô là đáp án."}
          <span class="mo">Unit ${c.unit} — ${esc(c.ten)}</span>
        </div>` : ""}
      <button class="chinh" style="margin-top:12px" onclick="cauLuyenMoi()">Câu khác →</button>
    </div>`;
}

function veThi() {
  if (!duLieuThi) return;
  $("#thi").innerHTML = `<div class="the-mo-dau">
      <h2>Thì trong tiếng Anh</h2>
      <div class="mo">8 thì cần cho IELTS 6.0–6.5, kèm 150 truyện được kể lại ở
        nhiều thì để nghe ra khác biệt chứ không phải học thuộc.</div>
    </div>` + thanhTheThi()
    + (theThi === "bang" ? veBangThi()
      : theThi === "de-nham" ? veDeNham()
      : theThi === "so-cau" ? veSoCau() : veLuyen());
}

/* ================= THƯ VIỆN TRUYỆN =================
   Bố cục học theo thư viện truyện của HelloChinese, giữ lại đúng phần hợp
   với app này:
     - "Đọc tiếp" ghim trên cùng: mở app ra là đi tiếp được ngay, không phải
       nhớ hôm qua dừng ở truyện nào
     - ô THỂ LOẠI có đếm số: nhìn là biết kho có gì và còn bao nhiêu chưa đọc
     - chip CẤP ĐỘ để chọn nhanh phần vừa sức
   Bỏ phần ảnh bìa: app không có kho ảnh, mà bìa bịa ra thì vừa nặng vừa
   không nói lên nội dung. Thay bằng ô màu theo thể loại — cùng tác dụng
   nhận diện, không tốn một byte ảnh nào. */
let locTheLoai = localStorage.getItem("locTheLoai") || "tat_ca";
let locCapDo = localStorage.getItem("locCapDo") || "tat_ca";
let khoTruyen = null;

const TL = {
  giao_trinh: { ten: "Bài đọc giáo trình", ic: "\u25a4", mau: "#5aa9f0" },
  doi_thuong: { ten: "Đời thường", ic: "\u2615", mau: "#4ec99a" },
  ngu_ngon: { ten: "Ngụ ngôn", ic: "\u273f", mau: "#e0b64a" },
  truyen_cuoi: { ten: "Truyện cười", ic: "\u263a", mau: "#f07a6d" },
  bi_an: { ten: "Bí ẩn", ic: "\u25d1", mau: "#b39ae8" },
  cam_dong: { ten: "Cảm động", ic: "\u2665", mau: "#f2a2c0" },
  phieu_luu: { ten: "Phiêu lưu", ic: "\u2691", mau: "#68c5c0" },
  mini: { ten: "Mini-story", ic: "\u25c8", mau: "#8fb3d9" },
};
const tlCua = t => TL[t] || TL.mini;

function doiLocTruyen(khoa, v) {
  if (khoa === "the_loai") { locTheLoai = v; localStorage.setItem("locTheLoai", v); }
  else { locCapDo = v; localStorage.setItem("locCapDo", v); }
  veThuVien();
}

/* Truyện đọc gần đây nhất — ghi lại mỗi lần mở một truyện từ thư viện. */
function ghiTruyenGanDay(t) {
  try {
    localStorage.setItem("truyenGanDay__" + (HS?.id || "mac_dinh"), JSON.stringify(t));
  } catch (e) { /* hết chỗ lưu thì thôi, không phải dữ liệu quan trọng */ }
}
function docTruyenGanDay() {
  try {
    return JSON.parse(localStorage.getItem("truyenGanDay__" + (HS?.id || "mac_dinh")));
  } catch (e) { return null; }
}

async function moThuVien() {
  dungPhat();
  S.tab = "thu-vien";
  $$(".trang").forEach(x => x.classList.toggle("hien", x.id === "thu-vien"));
  if (!khoTruyen) {
    $("#thu-vien").innerHTML = `<div class="trong">Đang nạp…</div>`;
    try {
      khoTruyen = (await (await fetch("/api/danh_sach_doc")).json()).truyen || [];
    } catch (e) { khoTruyen = []; }
  }
  napDaDocTruyen();
  veThuVien();
  veRail();
  dongRail();
  window.scrollTo({ top: 0 });
}

/* Mở đúng truyện đang chọn: vào mục Truyện của unit rồi bung khối đó ra.
   Không bung thì người học rơi vào một trang 13 khối đóng và phải tự dò lại
   đúng truyện vừa bấm. */
async function moTruyenTu(soUnit, idx, ten) {
  ghiTruyenGanDay({ unit: soUnit, idx, ten });
  S.khoiGap.delete(`truyen/bai-${idx}`);
  luuRail();
  await moMuc(soUnit, "truyen");
  setTimeout(() => {
    const k = $$("#truyen .khoi")[idx];
    if (k) {
      k.classList.remove("thu-gon");
      k.scrollIntoView({ block: "start", behavior: "smooth" });
    }
  }, 350);
}

const daDoc = t => daDocTruyen.has(khoaTruyen(t.unit, t.ten));

/* Một thẻ truyện: dải màu theo thể loại thay cho ảnh bìa. */
function theTruyen(t, ml) {
  const tl = tlCua(t.the_loai);
  const m = ml[t.unit] || {};
  return `<button class="the-truyen ${daDoc(t) ? "da-doc" : ""}"
      style="--mau-tl:${tl.mau}"
      onclick="moTruyenTu(${t.unit},${t.idx},${JSON.stringify(t.ten).replace(/"/g, "&quot;")})">
      <span class="bia">${tl.ic}</span>
      <span class="noi">
        <span class="ten">${esc(t.ten.replace(/^(Truyện|Mini-story)\s*[—-]\s*/, ""))}</span>
        <span class="mo">
          <i class="cham" style="background:${tl.mau}"></i>${esc(tl.ten)}
          · ${t.so_cau || 0} câu · Unit ${t.unit}
        </span>
      </span>
      ${daDoc(t) ? `<span class="xong">✓</span>` : ""}
    </button>`;
}

function veThuVien() {
  const el = $("#thu-vien");
  const ml = {};
  S.muc_luc.forEach(m => (ml[m.so] = m));

  const tat = khoTruyen;
  const xongTat = tat.filter(daDoc).length;
  const capDo = [...new Set(tat.map(t => t.level ?? 0))].sort((a, b) => a - b);
  const demTL = {};
  tat.forEach(t => {
    const k = t.the_loai || "mini";
    (demTL[k] ||= { tong: 0, xong: 0 }).tong++;
    if (daDoc(t)) demTL[k].xong++;
  });

  let h = `<div class="the-mo-dau gon">
      <div class="thanh-tong">
        <div class="vach"><i class="xong" style="width:${
          Math.round(xongTat / Math.max(1, tat.length) * 100)}%"></i></div>
        <div class="so-lieu">
          <span><b>${xongTat}</b>/${tat.length} truyện đã đọc</span>
          <span>${capDo.length} cấp độ · ${Object.keys(demTL).length} thể loại</span>
        </div>
      </div>
    </div>`;

  /* --- Đọc tiếp --- */
  const gan = docTruyenGanDay();
  const tGan = gan && tat.find(x => x.unit === gan.unit && x.idx === gan.idx);
  const tiep = (tGan && !daDoc(tGan)) ? tGan : tat.find(t => !daDoc(t));
  if (tiep) {
    const tl = tlCua(tiep.the_loai);
    h += `<h3 class="tv-tieu">${tGan && !daDoc(tGan) ? "Đọc tiếp" : "Bắt đầu từ đây"}</h3>
      <button class="the-tiep" style="--mau-tl:${tl.mau}"
        onclick="moTruyenTu(${tiep.unit},${tiep.idx},${
          JSON.stringify(tiep.ten).replace(/"/g, "&quot;")})">
        <span class="bia">${tl.ic}</span>
        <span class="noi">
          <span class="ten">${esc(tiep.ten.replace(/^(Truyện|Mini-story)\s*[—-]\s*/, ""))}</span>
          <span class="mo">${esc(tlCua(tiep.the_loai).ten)} · ${tiep.so_cau || 0} câu
            · Unit ${tiep.unit} — ${esc((ml[tiep.unit] || {}).ten || "")}</span>
        </span>
        <span class="mui">›</span>
      </button>`;
  }

  /* --- Đọc theo thể loại --- */
  h += `<h3 class="tv-tieu">Đọc theo thể loại</h3>
    <div class="luoi-tl">
      ${Object.entries(demTL).sort((a, b) => b[1].tong - a[1].tong).map(([k, d]) => {
        const tl = tlCua(k);
        return `<button class="o-tl ${locTheLoai === k ? "chon" : ""}"
            style="--mau-tl:${tl.mau}" onclick="doiLocTruyen('the_loai','${
              locTheLoai === k ? "tat_ca" : k}')">
            <span class="ic">${tl.ic}</span>
            <span class="dem">${d.xong}/${d.tong}</span>
            <span class="ten">${esc(tl.ten)}</span>
          </button>`;
      }).join("")}
    </div>`;

  /* --- Đọc theo cấp độ --- */
  const chip = (v, nhan) => `<button class="chip ${locCapDo === v ? "chon" : ""}"
      onclick="doiLocTruyen('cap_do','${v}')">${nhan}</button>`;
  h += `<h3 class="tv-tieu">Đọc theo cấp độ</h3>
    <div class="hang chip-hang">
      ${chip("tat_ca", "Tất cả")}
      ${capDo.map(l => chip(String(l), l < 0 ? "Trẻ em" : "Level " + l)).join("")}
      ${chip("chua", "Chưa đọc")}
    </div>`;

  /* --- Danh sách theo bộ lọc --- */
  const ds = tat.filter(t =>
    (locTheLoai === "tat_ca" || (t.the_loai || "mini") === locTheLoai)
    && (locCapDo === "tat_ca"
        || (locCapDo === "chua" ? !daDoc(t) : (t.level ?? 0) === +locCapDo)));

  h += `<h3 class="tv-tieu">${ds.length} truyện${
    locTheLoai === "tat_ca" && locCapDo === "tat_ca" ? "" : " khớp bộ lọc"}</h3>`;
  if (!ds.length) {
    el.innerHTML = h + `<div class="trong">Không có truyện nào khớp.</div>`;
    return;
  }

  const theoUnit = {};
  ds.forEach(t => (theoUnit[t.unit] ||= []).push(t));
  h += `<div class="ds-thu-vien">`;
  Object.keys(theoUnit).map(Number).sort((a, b) => {
    const la = ml[a]?.level ?? 0, lb = ml[b]?.level ?? 0;
    return la - lb || a - b;
  }).forEach(so => {
    const m = ml[so] || {};
    const cac = theoUnit[so];
    const xong = cac.filter(daDoc).length;
    h += `<div class="nhom-tv">
        <button class="dau-tv" onclick="moUnit(${so})">
          <span class="ten">Unit ${so} — ${esc(m.ten || "")}</span>
          <span class="mo">${esc(m.ten_level || "")} · ${xong}/${cac.length} đã đọc</span>
        </button>
        ${cac.map(t => theTruyen(t, ml)).join("")}
      </div>`;
  });
  h += `</div>`;
  el.innerHTML = h;
}

/* ================= HỘI THOẠI ================= */
function veHoiThoai(u) {
  const el = $("#hoi-thoai");
  const ds = u.hoi_thoai || [];
  if (!ds.length) {
    el.innerHTML = `<div class="trong">Unit ${u.so} không có hội thoại.</div>`;
    return;
  }
  let h = "";
  ds.forEach((hd, di) => {
    const tienTo = `ht-${di}-`;
    const noi = thanhCongCu("", tienTo) +
      (CD.kieuDoc === "doan"
        ? `<div class="the">${khoiDoan(tienTo, hd.luot)}</div>`
        : `<div class="the">${hd.luot.map((l, li) =>
            dongDoc(`${tienTo}${li}`, l.en, l.pa, l.vi, l.vai)).join("")}</div>`);
    macDinhKhoi(`hoi-thoai/bai-${di}`, di > 0);
    h += khoi(`hoi-thoai/bai-${di}`, hd.ten, noi, `${hd.luot.length} lượt`);
  });
  el.innerHTML = h;
}

/* ================= 5 · ĐỀ THI ================= */
let dongHo = null;
async function veDeThi(soUnit) {
  const el = $("#de-thi");
  const r = await fetch(`/api/de_thi/${soUnit}`);
  if (!r.ok) {
    el.innerHTML = `<div class="trong">Chưa có đề cho unit ${soUnit}.<br><br>
      Bộ đề gốc nằm ở <code>1. Tiếng Anh\\Bộ đề thi</code> — cần chạy bước tách đề
      (xem Hướng dẫn) để dùng được chức năng bấm giờ và chấm điểm.</div>`;
    return;
  }
  const de = await r.json();
  let h = `<div class="dong-ho" id="dong-ho">--:--</div>
    <h2>${esc(de.ten || `Đề thi — Unit ${soUnit}`)}</h2>
    <div class="mo">${de.cau_hoi?.length || 0} câu · ${de.phut || 20} phút</div>
    <button class="chinh" id="nut-bat-dau" onclick="batDauThi()">Bắt đầu</button>
    <div id="khu-de" style="margin-top:14px; display:none"></div>`;
  el.innerHTML = h;
  el._de = de;
}

/* Câu True/False/Not Given cho chọn thay vì gõ — gõ tay thì sai chính tả
   "NOT GIVEN" là mất điểm oan, mà đó không phải thứ đề muốn kiểm tra. */
const LA_TFNG = c => /^(true|false|not given)$/i.test((c.dap_an || "").trim());

function oTraLoi(c) {
  if (LA_TFNG(c)) {
    return `<select id="dt-${c.so}">
        <option value="">— chọn —</option>
        <option>TRUE</option><option>FALSE</option><option>NOT GIVEN</option>
      </select>`;
  }
  return `<input type="text" id="dt-${c.so}" placeholder="Trả lời"
    onkeydown="if(event.key==='Enter'){const a=[...document.querySelectorAll('[id^=dt-]')];
      const i=a.findIndex(x=>x.id==='dt-${c.so}'); if(i+1<a.length)a[i+1].focus();}">`;
}

/* Dựng lại một Part đúng như trong đề: giữ nguyên đoạn văn / phiếu / hướng dẫn,
   rồi chèn ô trả lời ngay dưới đúng câu hỏi tương ứng.
   Trước đây app chỉ hiện mỗi câu hỏi, bỏ mất đoạn đọc và phiếu nghe — nên
   nhìn vào không thể biết phải trả lời gì. */
/* Gỡ markdown về CHỮ THUẦN, không sinh thẻ HTML.
   Phải tách riêng khỏi mdSangHtml(): hàm kia trả về HTML, đưa tiếp vào
   cauCoTuChamDuoc() (vốn tự escape) sẽ thành escape hai lần, hiện ra
   "&lt;b&gt;1&lt;/b&gt;" trên màn hình. */
function goMarkdown(d) {
  return d
    .replace(/^[-*]\s+/, "")            // bullet đầu dòng
    .replace(/^\*{0,2}\d+\*{0,2}[\.\)]\s*/, "")  // số thứ tự: "6." hoặc "**6**."
    .replace(/\*\*\d+\*\*\s*/g, "")     // số đánh dấu giữa dòng: "Surname: **1** ___"
    .replace(/\*\*(.+?)\*\*/g, "$1")    // đậm
    .replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, "$1")  // nghiêng
    .trim();
}

function vePart(part, cauHoiCuaPart) {
  const daDung = new Set();
  let h = `<h3>${esc(part.ten)}</h3><div class="the">`;

  part.noi_dung.split("\n").forEach(dongGoc => {
    const d = dongGoc.trim();
    if (!d) { h += `<div style="height:6px"></div>`; return; }

    // dòng nào là câu hỏi thì chèn ô trả lời ngay sau
    const c = cauHoiCuaPart.find(x => !daDung.has(x.so) && (
      new RegExp(`^${x.so}[\\.\\)]`).test(d) ||
      new RegExp(`\\*\\*${x.so}\\*\\*`).test(d)));

    if (c) {
      daDung.add(c.so);
      h += `<div class="cau-hoi">
          <div><b>${c.so}.</b> ${cauCoTuChamDuoc(goMarkdown(d))}</div>
          <div class="hang" style="margin-top:6px">${oTraLoi(c)}<span id="kqd-${c.so}"></span></div>
        </div>`;
    } else if (d.startsWith(">")) {
      h += `<blockquote class="doan-doc">${mdSangHtml(d.replace(/^>\s*/, ""))}</blockquote>`;
    } else {
      h += `<div class="dong-de">${mdSangHtml(d)}</div>`;
    }
  });

  // câu hỏi nào không khớp dòng nào thì gom xuống cuối, không để sót
  cauHoiCuaPart.filter(c => !daDung.has(c.so)).forEach(c => {
    h += `<div class="cau-hoi">
        <div><b>${c.so}.</b> ${cauCoTuChamDuoc(c.de)}</div>
        <div class="hang" style="margin-top:6px">${oTraLoi(c)}<span id="kqd-${c.so}"></span></div>
      </div>`;
  });

  return h + `</div>`;
}

/* Đếm từ khi tự viết — đề luôn yêu cầu số từ cụ thể, và "thiếu chữ bị trừ
   điểm nặng" theo đúng ghi chú chấm của giáo trình. */
function demTu(ta) {
  const n = (ta.value.trim().match(/\S+/g) || []).length;
  const el = $("#dem-tu");
  if (el) el.textContent = `${n} từ`;
}

function moBaiMau(khoa) {
  const de = $("#de-thi")._de, m = de.bai_mau?.[khoa];
  if (!m) return;
  const o = $(`#mau-${khoa}`);
  if (o.innerHTML) { o.innerHTML = ""; return; }   // bấm lần nữa để đóng

  const bang = (m.cham_diem || []).map(c => `<tr>
      <td>${esc(c.tieu_chi)}</td><td class="dung" style="white-space:nowrap">${esc(c.dat)}</td>
      <td>${c.vi_sao}</td></tr>`).join("");

  let than = "";
  if (khoa === "writing") {
    than = `<div class="doan-doc" style="font-size:16px">${cauCoTuChamDuoc(m.bai_mau)}</div>
      <div class="mo">${m.so_tu} từ · ${nutLoa(m.bai_mau)}</div>`;
  } else {
    than = (m.cau_tra_loi || []).map(c => `<div class="cau-hoi">
        <div><b>${esc(c.hoi)}</b></div>
        <div class="doan-doc" style="font-size:16px; white-space:pre-line">${cauCoTuChamDuoc(c.mau)}</div>
        <div class="hang">${nutLoa(c.mau)}<span class="mo">${c.ghi_chu}</span></div>
      </div>`).join("");
  }

  o.innerHTML = `<div class="the" style="border-color:var(--dung)">
      <h3 class="dung">Bài mẫu — đạt ${esc(m.diem)}</h3>
      ${than}
      <h3>Chấm theo từng tiêu chí</h3>
      <div class="cuon"><table><tr><th>Tiêu chí</th><th>Đạt</th><th>Vì sao đạt</th></tr>${bang}</table></div>
      ${m.dang_hoc?.length ? `<h3>Điểm đáng học</h3><ul>${m.dang_hoc.map(x => `<li>${x}</li>`).join("")}</ul>` : ""}
      ${m.loi_thuong_gap?.length ? `<h3>Lỗi người Việt thường mắc ở đề này</h3>
        <ul>${m.loi_thuong_gap.map(x => `<li>${x}</li>`).join("")}</ul>` : ""}
      ${m.meo_noi?.length ? `<h3>Mẹo khi nói</h3><ul>${m.meo_noi.map(x => `<li>${x}</li>`).join("")}</ul>` : ""}
    </div>`;
  o.scrollIntoView({ behavior: "smooth", block: "start" });
}

let soLanNgheDe = 0;
function ngheDe() {
  const de = $("#de-thi")._de;
  if (!de.script_nghe) return;
  if (soLanNgheDe >= 2) { alert("Đề chỉ cho nghe tối đa 2 lần — giống thi thật."); return; }
  soLanNgheDe++;
  $("#nut-nghe").textContent = `🔊 Nghe (đã nghe ${soLanNgheDe}/2)`;
  doc(de.script_nghe, { tocDo: 0.85 });
}

function batDauThi() {
  const el = $("#de-thi"), de = el._de;
  $("#nut-bat-dau").disabled = true;
  soLanNgheDe = 0;
  const khu = $("#khu-de");
  khu.style.display = "block";

  let h = "";
  (de.phan || []).forEach(p => {
    const cua = de.cau_hoi.filter(c => c.phan === p.ten);
    if (/Listening/i.test(p.ten) && de.script_nghe) {
      h += `<div class="the" style="border-color:var(--chinh)">
          <button class="chinh" id="nut-nghe" onclick="ngheDe()">🔊 Nghe (tối đa 2 lần)</button>
          <div class="mo" style="margin-top:6px">Nghe rồi điền vào phiếu bên dưới.
            Không xem script — đó là phần thi nghe.</div>
        </div>`;
    }
    if (cua.length) { h += vePart(p, cua); return; }

    // Writing / Speaking: máy không chấm được -> cho ô tự viết, và bài mẫu
    // CHỈ mở sau khi bấm. Xem mẫu trước khi tự làm thì chỉ còn là chép lại.
    const laWriting = /Writing/i.test(p.ten);
    const khoa = laWriting ? "writing" : "speaking";
    const mau = de.bai_mau?.[khoa];
    h += `<h3>${esc(p.ten)}</h3><div class="the">
        ${mdSangHtml(p.noi_dung)}
        ${laWriting ? `<textarea id="tuviet-${khoa}" rows="6" placeholder="Viết bài của bạn ở đây rồi mới mở bài mẫu…"
            oninput="demTu(this)"></textarea>
          <div class="mo" id="dem-tu">0 từ</div>` : ""}
        <div class="dieu-khien" style="justify-content:flex-start; margin-top:10px">
          ${mau ? `<button class="chinh" onclick="moBaiMau('${khoa}')">Xem bài mẫu đạt điểm tối đa</button>`
        : `<div class="canh-bao" style="margin:0">Unit này chưa có bài mẫu — hiện mới soạn cho Level 0 (unit 1–8).</div>`}
        </div>
        <div id="mau-${khoa}"></div>
      </div>`;
  });

  khu.innerHTML = h + `<div class="dieu-khien" style="justify-content:flex-start">
      <button class="chinh" onclick="nopBai()">Nộp bài</button></div>
    <div id="ket-qua-de"></div>`;

  let conLai = (de.phut || 20) * 60;
  const ve = () => {
    const m = String(Math.floor(conLai / 60)).padStart(2, "0"), s = String(conLai % 60).padStart(2, "0");
    const dh = $("#dong-ho");
    dh.textContent = `${m}:${s}`;
    dh.classList.toggle("gap", conLai <= 120);
    if (conLai-- <= 0) { clearInterval(dongHo); nopBai(true); }
  };
  ve(); dongHo = setInterval(ve, 1000);
}

async function nopBai(hetGio = false) {
  clearInterval(dongHo);
  const el = $("#de-thi"), de = el._de;
  const traLoi = de.cau_hoi.map(c => ({
    so: c.so, de: c.de, dap_an: c.dap_an || "", nhan: c.nhan || [],
    cua_toi: $(`#dt-${c.so}`)?.value || "", giai_thich: c.giai_thich || "",
  }));
  const kq = await (await fetch("/api/nop_bai", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ unit: S.unit, loai: "de_thi", cau_tra_loi: traLoi, thoi_diem: new Date().toISOString() }),
  })).json();

  // đánh dấu ngay tại từng ô, giữ nguyên đề để đối chiếu
  kq.chi_tiet.forEach(r => {
    const o = $(`#kqd-${r.so}`), inp = $(`#dt-${r.so}`);
    if (o) o.innerHTML = r.dung ? `<span class="dung">✓ đúng</span>`
      : `<span class="sai">✗ đáp án: ${esc(r.dap_an)}</span>`;
    if (inp) inp.disabled = true;
  });

  const soSai = kq.tong - kq.so_dung;
  $("#ket-qua-de").innerHTML = `<div class="the">
      <h3>${hetGio ? "Hết giờ — " : ""}Điểm: <span class="${kq.dat ? "dung" : "sai"}">${kq.diem}%</span>
        (${kq.so_dung}/${kq.tong} câu)</h3>
      <div class="mo">${kq._luat}
        ${soSai ? ` · ${soSai} câu sai đã tự ghi vào Sổ lỗi.` : ""}</div>
      ${de.script_nghe ? `<details style="margin-top:10px">
        <summary class="mo" style="cursor:pointer">Xem script bài nghe</summary>
        <div style="margin-top:8px">${esc(de.script_nghe)}</div></details>` : ""}
      <div class="dieu-khien" style="justify-content:flex-start; margin-top:12px">
        <button class="phu" onclick="veDeThi(S.unit)">Làm lại đề này</button>
      </div>
    </div>`;
  $("#ket-qua-de").scrollIntoView({ behavior: "smooth", block: "center" });
  if (kq.dat) await datTrangThai(S.unit, "de_thi", "xong");
}

/* ================= SỔ LỖI ================= */
/* ================= ÔN TẬP LẶP NGẮT QUÃNG =================
   Lịch 1-3-7-16-35-90 ngày. Mỗi từ có 3 loại thẻ (nghĩa / âm / dùng trong câu),
   chỉ tính "đã thuộc" khi qua đủ cả 3 — đúng như giáo trình yêu cầu. */
const OT = { the: [], i: 0, dung: 0, sai: 0, dangCho: false, hen: null, henDuPhong: null };

/* Giây đứng lại xem đáp án, tính TỪ LÚC đọc xong chứ không tính từ lúc bấm
   Kiểm tra — chuyển thẻ ngay khi máy còn đang đọc thì vừa không nghe hết từ,
   vừa không kịp nhìn mặt chữ. */
const giayDapAn = () => Math.max(0, +(localStorage.getItem("giayDapAn") ?? 2));

/* Enter là phím rẻ nhất khi đang gõ: tay đã ở bàn phím, không phải với chuột.
   Bắt ở cấp document chứ không chỉ gắn vào ô nhập, vì ba lý do:
   - Bộ gõ tiếng Việt (Unikey…) đang bật thì phím Enter kết thúc chuỗi ghép và
     trình duyệt báo isComposing / keyCode 229 — handler gắn trên ô nhập bị nuốt.
   - Thẻ trắc nghiệm không có ô nhập nào để gắn.
   - Gõ xong lỡ chạm ra ngoài làm mất focus thì Enter vẫn phải ăn.
   Lần Enter thứ hai bỏ qua quãng chờ xem đáp án, sang thẳng thẻ kế tiếp. */
document.addEventListener("keydown", e => {
  if (S.tab !== "on-tap") return;
  if (e.key !== "Enter" && e.code !== "NumpadEnter") return;
  if (e.isComposing || e.keyCode === 229) return;
  if (!OT.the.length || OT.i >= OT.the.length) return;
  e.preventDefault();
  if (OT.dangCho) { sangTheKeTiep(); return; }
  if (OT.the[OT.i].loai !== "nghia") kiemThe();
});

function sangTheKeTiep() {
  clearTimeout(OT.hen);
  clearTimeout(OT.henDuPhong);
  OT.hen = OT.henDuPhong = null;
  OT.i++;
  veThe();
}

/* Unit đang lọc ở tab Ôn tập. 0 = trộn mọi unit trong phạm vi (mặc định, đúng tinh
   thần lặp ngắt quãng). Chọn một unit khi vừa học xong và muốn ôn ngay unit đó. */
let onTapUnit = +(localStorage.getItem("on_tap_unit") || 0);
/* Phạm vi lấy từ ra ôn. Mặc định "xong": chỉ ôn unit đã học trọn vẹn — đúng
   tinh thần lặp ngắt quãng, ôn từ của unit mới đọc lướt thì thành học vẹt.
   Vẫn cho đổi vì lúc mới bắt đầu chưa unit nào xong, siết cứng là màn Ôn tập
   trống trơn và người học không hiểu vì sao. */
let onTapPhamVi = ["xong", "mo", "tat_ca"].includes(localStorage.getItem("on_tap_pham_vi"))
  ? localStorage.getItem("on_tap_pham_vi") : "xong";

function doiPhamViOnTap(v) {
  onTapPhamVi = v;
  localStorage.setItem("on_tap_pham_vi", v);
  onTapUnit = 0;                       // đổi phạm vi thì bỏ lọc theo unit
  localStorage.setItem("on_tap_unit", 0);
  veOnTap();
}

function doiUnitOnTap(v) {
  onTapUnit = +v || 0;
  localStorage.setItem("on_tap_unit", onTapUnit);
  veOnTap();
}

/* unitRieng != null -> ôn riêng MỘT unit, bỏ qua giới hạn phạm vi. Dùng khi
   vừa học xong unit đó và muốn ôn ngay, chứ chưa cần đợi nó "hoàn thành". */
async function veOnTap(unitRieng = null) {
  const el = $(unitRieng ? "#on-tap-unit" : "#on-tap");
  el.innerHTML = `<div class="trong">Đang nạp…</div>`;
  const u = unitRieng || onTapUnit;
  const d = await (await fetch(
    `/api/on_tap?so_luong=20&unit=${u}&pham_vi=${unitRieng ? "tat_ca" : onTapPhamVi}`)).json();
  OT.the = d.the || []; OT.i = 0; OT.dung = 0; OT.sai = 0;
  OT.oUnit = unitRieng || null;
  const tk = d.thong_ke;

  const dau = unitRieng
    ? `<div class="tom-tat">Ôn riêng unit ${unitRieng} · ${OT.the.length} thẻ</div>`
    : `<h2>Ôn tập</h2>${veThongKeOnTap(tk)}${chonPhamViOnTap(tk)}${chonUnitOnTap(tk)}`;

  if (!OT.the.length) {
    el.innerHTML = dau + `<div class="trong">${
      unitRieng ? `Unit ${unitRieng} chưa có thẻ nào đến hạn hôm nay.`
        : onTapUnit ? `Unit ${onTapUnit} không còn thẻ nào đến hạn.`
        : "Hôm nay không còn thẻ nào đến hạn."}<br>
      <span class="mo">${loiKhuyenOnTap(tk, unitRieng)}</span></div>`;
    return;
  }

  el.innerHTML = dau + `
    <div class="tien-trinh"><div id="tt-on"></div></div>
    <div id="khu-the"></div>`;
  veThe();
}

/* Nói rõ VÌ SAO đang trống. Để trống trơn thì người học tưởng app hỏng, chứ
   không đoán được là do phạm vi mặc định chỉ lấy unit đã hoàn thành. */
function loiKhuyenOnTap(tk, unitRieng) {
  if (unitRieng) return "Học phần Bài học của unit này trước, thẻ sẽ xuất hiện.";
  if (onTapPhamVi === "xong" && !tk.so_unit_xong) {
    return `Chưa unit nào hoàn thành trọn 6 mục nên chưa có từ nào vào lịch ôn.
      Bạn đang học dở ${tk.so_unit_mo || 0} unit — đổi phạm vi sang
      “Unit đang học” ở trên để ôn ngay, hoặc ôn riêng từng unit ở màn Unit.`;
  }
  if (!tk.unit_da_mo.length) return "Chưa mở unit nào. Vào Bài học, mở một unit rồi quay lại.";
  return "Quay lại mai, hoặc mở thêm unit mới ở tab Bài học.";
}

function chonPhamViOnTap(tk) {
  const ds = [
    ["xong", `Unit đã hoàn thành (${tk.so_unit_xong ?? 0})`],
    ["mo", `Unit đang học (${tk.so_unit_mo ?? 0})`],
    ["tat_ca", `Tất cả ${S.muc_luc.length} unit`],
  ];
  return `<label class="hang" style="gap:8px; margin-bottom:8px">
      <span class="mo">Phạm vi</span>
      <select onchange="doiPhamViOnTap(this.value)" style="flex:1; min-width:0">
        ${ds.map(([v, t]) => `<option value="${v}" ${onTapPhamVi === v ? "selected" : ""}>${t}</option>`).join("")}
      </select>
    </label>`;
}

function chonUnitOnTap(tk) {
  /* Chỉ liệt kê unit ĐÃ MỞ — cho chọn unit chưa học thì ôn từ chưa gặp bao
     giờ, thành học vẹt không ngữ cảnh. */
  const mo = tk.unit_da_mo || [];
  const ten = so => (S.muc_luc.find(m => m.so === so) || {}).ten || "";
  return `<label class="hang" style="gap:8px; margin-bottom:10px">
      <span class="mo">Ôn unit</span>
      <select onchange="doiUnitOnTap(this.value)" style="flex:1; min-width:0">
        <option value="0" ${!onTapUnit ? "selected" : ""}>Trộn mọi unit trong phạm vi (${mo.length})</option>
        ${mo.map(so => `<option value="${so}" ${onTapUnit === so ? "selected" : ""}>Unit ${so} — ${esc(ten(so))}</option>`).join("")}
      </select>
    </label>`;
}

function veThongKeOnTap(tk) {
  return `<div class="thanh-tong">
      <div class="so-lieu">
        <span><b>${tk.den_han_hom_nay}</b> thẻ đến hạn hôm nay</span>
        <span><b>${tk.da_thuoc_du_3_the}</b> từ đã thuộc (qua đủ 3 loại thẻ)</span>
        <span><b>${tk.tu_trong_pham_vi}</b> từ trong phạm vi đang chọn / ${tk.tong_tu} tổng</span>
      </div>
      <div class="mo">Lịch ôn: ${tk.lich.join(" → ")} ngày.
        Mỗi từ phải qua 3 loại thẻ: nhìn từ chọn nghĩa · nghe gõ lại · điền vào câu.</div>
    </div>`;
}

function veThe() {
  const t = OT.the[OT.i];
  if (!t) return ketThucOnTap();
  OT.dangCho = false;
  $("#tt-on").style.width = (OT.i / OT.the.length * 100) + "%";

  let than = "";
  if (t.loai === "nghia") {
    than = `<div class="cau-anh" style="font-size:30px">${esc(t.tu)}</div>
      ${t.ipa ? `<div class="pa">${esc(t.ipa)}</div>` : ""}
      <div class="dai-pill" style="justify-content:center; margin-top:16px">
        ${t.lua_chon.map(x => `<button class="pill" onclick="chonNghia(this,${JSON.stringify(x).replace(/"/g, "&quot;")})">${esc(x)}</button>`).join("")}
      </div>`;
  } else if (t.loai === "am") {
    than = `<button class="nut-tron" style="width:56px;height:56px;font-size:22px;margin:0 auto"
        onclick="doc(${JSON.stringify(t.doc).replace(/"/g, "&quot;")})">🔊</button>
      <div class="mo">Nghe rồi gõ lại từ vừa nghe (không hiện chữ)</div>
      <input type="text" id="o-on" placeholder="Gõ từ bạn nghe được" autocomplete="off"
        enterkeyhint="done" style="max-width:320px;margin:10px auto">`;
  } else {
    than = `<div class="cau-anh">${esc(t.cau)}</div>
      <div class="nghia" style="font-size:17px">Từ cần điền nghĩa là:
        <b>${esc(t.goi_y_nghia || "")}</b></div>
      <div class="mo">${t.so_chu} chữ cái · bắt đầu bằng
        <b>${esc((t.goi_y_chu || "").replace(/·/g, " _"))}</b></div>
      <input type="text" id="o-on" placeholder="Điền từ tiếng Anh" autocomplete="off"
        enterkeyhint="done" style="max-width:280px;margin:10px auto">`;
  }

  $("#khu-the").innerHTML = `
    <div class="san-khau">
      <div class="mo">Thẻ ${OT.i + 1}/${OT.the.length} · Unit ${t.unit} ·
        ${esc(t.ten_loai)} ${t.moi ? "· <b>thẻ mới</b>" : `· bậc ${t.lan}/6`}</div>
      ${than}
      <div id="phan-hoi"></div>
    </div>
    <div class="dieu-khien">
      ${t.loai !== "nghia" ? `<button class="chinh" onclick="kiemThe()">Kiểm tra</button>` : ""}
      <button class="phu" onclick="boQuaThe()">Chưa biết — xem đáp án</button>
    </div>`;
  if (t.loai === "am") doc(t.doc);
  $("#o-on")?.focus();
}

function chonNghia(nut, chon) {
  if (OT.dangCho) return;
  const t = OT.the[OT.i];
  const dung = chon === t.dap_an;
  $$("#khu-the .pill").forEach(b => {
    if (b.textContent === t.dap_an) b.style.borderColor = "var(--dung)";
    if (b === nut && !dung) b.style.borderColor = "var(--sai)";
  });
  ghiNhanThe(dung);
}

function kiemThe() {
  if (OT.dangCho) return;
  const t = OT.the[OT.i];
  const v = ($("#o-on")?.value || "").trim().toLowerCase();
  ghiNhanThe(v === t.dap_an.toLowerCase());
}

const boQuaThe = () => { if (!OT.dangCho) ghiNhanThe(false); };

async function ghiNhanThe(dung) {
  OT.dangCho = true;
  const t = OT.the[OT.i];
  dung ? OT.dung++ : OT.sai++;

  const r = await (await fetch("/api/on_tap/tra_loi", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ khoa: t.khoa, dung }),
  })).json();

  $("#phan-hoi").innerHTML = `<div style="margin-top:14px">
      <div class="${dung ? "dung" : "sai"}" style="font-size:17px">
        ${dung ? "✓ Đúng" : "✗ Chưa đúng"}</div>
      <div class="cau-anh" style="font-size:20px">${esc(t.tu)} ${nutLoa(t.tu)}</div>
      ${t.ipa ? `<div class="pa">${esc(t.ipa)}</div>` : ""}
      <div class="nghia">${esc(t.nghia)}</div>
      ${t.cau_day_du ? `<div class="mo" style="margin-top:6px">${esc(t.cau_day_du)}</div>` : ""}
      <div class="mo" style="margin-top:6px">
        ${r.da_thuoc ? "<b class='dung'>Từ này đã thuộc — qua hết 6 bậc.</b>"
      : `Bậc ${r.lan}/6 · ôn lại ngày ${r.ngay_tiep}`}</div>
    </div>`;
  /* Đọc đáp án ở CẢ hai trường hợp. Trước đây chỉ đọc khi sai, nhưng lúc trả
     lời đúng mới là lúc nên nghe lại để gắn mặt chữ với âm — đúng mà không
     nghe thì vẫn có thể đang đọc sai trong đầu mà không biết. */
  /* Chờ đọc xong rồi mới đếm giờ. Có hai đường về đích để không bao giờ kẹt:
     callback "đọc xong" của giọng đọc, và một hẹn dự phòng cho trường hợp
     trình duyệt nuốt sự kiện đó (Safari thỉnh thoảng không bắn onend). */
  const nghi = (giayDapAn() + (dung ? 0 : 1.5)) * 1000;
  let daHen = false;
  const hen = () => {
    if (daHen || !OT.dangCho) return;
    daHen = true;
    clearTimeout(OT.henDuPhong);
    OT.hen = setTimeout(sangTheKeTiep, nghi);
  };
  doc(t.tu, { xong: hen });
  OT.henDuPhong = setTimeout(hen, 5000);

  /* Trả lời xong thì hai nút cũ hết việc — thay bằng đúng một nút "Tiếp",
     ngay chỗ vừa bấm, để ai không muốn chờ hết giờ thì đi luôn. */
  const hang = $("#khu-the .dieu-khien");
  if (hang) hang.innerHTML = `<button class="chinh" onclick="sangTheKeTiep()">Tiếp → (Enter)</button>`;
}

function ketThucOnTap() {
  const tong = OT.dung + OT.sai || 1;
  $("#tt-on").style.width = "100%";
  $("#khu-the").innerHTML = `<div class="the" style="text-align:center">
      <h3>Xong buổi ôn</h3>
      <div style="font-size:26px" class="${OT.dung / tong >= 0.8 ? "dung" : "sai"}">
        ${OT.dung}/${tong} đúng</div>
      <div class="mo" style="margin-top:8px">Thẻ sai sẽ quay lại ngày mai.
        Thẻ đúng lên bậc tiếp theo.</div>
      <div class="dieu-khien">
        <button class="chinh" onclick="veOnTap(OT.oUnit)">Ôn tiếp</button>
        <button class="phu" onclick="OT.oUnit ? moUnit(OT.oUnit) : veMenu()">← Quay lại</button>
      </div>
    </div>`;
}

async function veSoLoi() {
  const d = await (await fetch("/api/tien_do")).json();
  const l = d.loi;
  $("#so-loi").innerHTML = `<h2>Sổ lỗi</h2>
    <div class="the hang" style="align-items:center">
      <b style="margin-right:auto">Tổng số lỗi đã ghi: ${l.tong_loi}</b>
      ${l.tong_loi ? `<button class="phu" onclick="xoaLoi({tat_ca:true})">Xoá tất cả</button>` : ""}
    </div>
    <h3>Unit sai nhiều nhất</h3>
    <div class="the">${l.theo_unit.length
      ? l.theo_unit.map(([u, n]) => `<div class="hang" style="align-items:center; padding:4px 0">
          <span style="margin-right:auto">Unit ${u}: <b>${n}</b> lỗi</span>
          <button class="phu" onclick="xoaLoi({unit:${u}})">Xoá lỗi unit này</button>
        </div>`).join("")
      : '<span class="mo">Chưa có dữ liệu.</span>'}</div>
    <h3>Đáp án hay sai nhất — tập trung học lại phần này</h3>
    <div class="the">${l.hay_sai_nhat.length
      ? l.hay_sai_nhat.map(([k, n]) => `<code>${esc(k)}</code> — sai ${n} lần`).join("<br>")
      : '<span class="mo">Chưa có dữ liệu.</span>'}</div>
    <h3>Các lỗi đã gom nhóm ${l.so_nhom ? `(${l.so_nhom} lỗi khác nhau)` : ""}</h3>
    <div class="the">${l.nhom?.length
      ? l.nhom.map(g => `<div class="cau-hoi hang" style="align-items:flex-start">
          <div style="flex:1; min-width:0">
            <div class="mo">Unit ${g.unit} · ${esc(g.loai)}
              ${g.so_lan > 1 ? `· <b class="sai">sai ${g.so_lan} lần</b>` : ""}</div>
            <div>${esc(g.de)}</div>
            <div>Bạn từng trả lời: <span class="sai">${g.da_tra_loi.map(esc).join(" · ")}</span></div>
            ${g.dap_an ? `<div>Đúng: <span class="dung">${esc(g.dap_an)}</span></div>` : ""}
          </div>
          <button class="phu" title="Xoá lỗi này" onclick='xoaLoi({nhom:true,
            unit_cua_loi:${JSON.stringify(g.unit)}, de:${JSON.stringify(g.de)}})'>Xoá</button>
        </div>`).join("")
      : '<span class="mo">Chưa có dữ liệu.</span>'}</div>`;
}

async function xoaLoi(dieu_kien) {
  if (dieu_kien.tat_ca && !confirm("Xoá toàn bộ sổ lỗi? Không khôi phục lại được.")) return;
  await fetch("/api/xoa_loi", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(dieu_kien),
  });
  veSoLoi();
}

/* ================= TIẾN ĐỘ & TRẠNG THÁI UNIT =================
   Mỗi unit có trạng thái riêng cho từng mục (bài học / bài tập / mẫu câu /
   truyện / hội thoại / đề thi). Ba mức: chưa · đang · xong.

   Tách theo mục chứ không gộp thành một trạng thái chung, vì thực tế bạn có
   thể học xong lý thuyết unit 5 nhưng chưa làm bài tập unit 3 — gộp lại thì
   mất thông tin đó và không biết còn nợ gì. */
const MUC = {
  "bai-hoc": "bai_hoc", "bai-tap": "bai_tap", "mau-cau": "mau_cau",
  "truyen": "truyen", "hoi-thoai": "hoi_thoai", "de-thi": "de_thi",
};

function trangThai(soUnit, muc) {
  return S.tienDo?.unit?.[soUnit]?.[muc] || "chua";
}

async function datTrangThai(soUnit, muc, tt) {
  S.tienDo.unit[soUnit] = { ...(S.tienDo.unit[soUnit] || {}), [muc]: tt };
  await fetch("/api/tien_do", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ unit: { [soUnit]: { [muc]: tt } } }),
  });
}

/* Mở một mục lần đầu thì tự chuyển sang "đang học" — khỏi phải bấm gì.
   Chỉ "xong" mới cần bạn tự xác nhận, vì máy không biết bạn đã hiểu hay chưa. */
async function chamDang(soUnit, muc) {
  if (trangThai(soUnit, muc) === "chua") await datTrangThai(soUnit, muc, "dang");
}

async function batTatXong(soUnit, muc) {
  const moi = trangThai(soUnit, muc) === "xong" ? "dang" : "xong";
  await datTrangThai(soUnit, muc, moi);
  /* Xong một mục thì quay về màn Unit — danh mục cha — để thấy ngay còn nợ
     mục nào và đi tiếp. Bỏ đánh dấu thì ở lại, vì lúc đó người học đang muốn
     học lại chính mục này chứ không phải đi đâu. */
  if (moi === "xong") { moUnit(soUnit); return; }
  veRail();
  const daXong = moi === "xong";
  $$(`#${S.tab} .nhom-nut-muc .nut-xong`).forEach(b => {
    b.classList.toggle("da-xong", daXong);
    b.setAttribute("aria-pressed", String(daXong));
    b.title = daXong ? "Đã hoàn thành — bấm để bỏ đánh dấu" : "Đánh dấu hoàn thành";
  });
}

function capNhatTienDoTong() {
  const tong = S.muc_luc.length * Object.keys(MUC).length;
  let xong = 0, dang = 0;
  S.muc_luc.forEach(m => Object.values(MUC).forEach(k => {
    const t = trangThai(m.so, k);
    if (t === "xong") xong++; else if (t === "dang") dang++;
  }));
  const unitXong = S.muc_luc.filter(m => Object.values(MUC).every(k => trangThai(m.so, k) === "xong")).length;
  $("#tien-do-tong").textContent = `${unitXong}/${S.muc_luc.length} unit xong`;
  return { tong, xong, dang, unitXong };
}

/* ================= THANH TIẾN TRÌNH BÊN TRÁI =================
   Bố cục kiểu khoá học Google/Coursera: cả khoá nằm trong một cột bên trái
   luôn hiện, mỗi unit bung ra 6 mục, mỗi mục một ô tick riêng.

   Vì sao bỏ màn danh sách cũ: trước đây MỖI TAB có một danh sách 50 unit
   riêng. Học xong Bài học unit 5 mà muốn làm Bài tập unit 5 thì phải quay ra
   danh sách, đổi tab, cuộn tìm lại unit 5 — ba thao tác cho một việc lẽ ra
   không cần thao tác nào. Giờ 6 mục nằm ngay dưới tên unit. */
const TEN_MUC = {
  "bai-hoc": "Bài học", "bai-tap": "Bài tập", "mau-cau": "Mẫu câu",
  "truyen": "Truyện", "hoi-thoai": "Hội thoại", "de-thi": "Đề thi",
};
const SO_MUC = Object.keys(MUC).length;
const soMucXong = so => Object.values(MUC).filter(k => trangThai(so, k) === "xong").length;

/* keo=true: kéo mục đang mở vào giữa tầm nhìn. Chỉ làm khi vừa ĐỔI mục —
   vẽ lại vì đánh dấu hoàn thành mà cũng kéo thì cột trái nhảy dưới tay. */
function veRail(keo = false) {
  const tt = capNhatTienDoTong();
  const pt = Math.round(tt.xong / tt.tong * 100);
  $("#vach-xong").style.width = pt + "%";
  $("#vach-dang").style.width = Math.round(tt.dang / tt.tong * 100) + "%";
  $("#rail-phan-tram").textContent = pt + "%";
  $("#rail").classList.toggle("day-gon", S.railDay === "gon");
  $(".khung").classList.toggle("gon-rail", S.railGon);
  $("#nut-rail").classList.toggle("hien-luon", S.railGon);

  const don = (ic, ten, tab, goi, phu = "") =>
    `<button class="rail-don ${S.tab === tab ? "chon" : ""}" onclick="${goi}">
       <span class="ic">${ic}</span><span class="ten">${ten}</span>
       ${phu ? `<span class="phu-de">${esc(phu)}</span>` : ""}</button>`;

  /* --- 1. Tổng quan --- */
  let h = nhomRail("nhom/tong-quan", "Tổng quan",
    don("\u2302", "Tổng quan", "tong-quan", "veMenu()") +
    don("\u0250", "Phát âm", "ipa", "moIPA()") +
    don("\u23f1", "Thì trong tiếng Anh", "thi", "moThi()") +
    don("\u25e7", "Truyện", "thu-vien", "moThuVien()") +
    don("\u25f7", "Ôn tập hôm nay", "on-tap", "chuyenTab('on-tap')") +
    don("\u270e", "Sổ lỗi", "so-loi", "chuyenTab('so-loi')"));

  /* --- 2. Bài học: level -> unit -> mục --- */
  const theoLevel = {};
  S.muc_luc.forEach(m => (theoLevel[m.level] ||= { ten: m.ten_level, ds: [] }).ds.push(m));
  let hLevel = "";
  Object.entries(theoLevel)
    .sort((a, b) => (+a[0]) - (+b[0]))
    .forEach(([so_lv, lv]) => {
    const id = "lv/" + so_lv, gap = S.railGap.has(id);
    const xong = lv.ds.filter(m => soMucXong(m.so) === SO_MUC).length;
    hLevel += `<div class="rail-nhom ${gap ? "thu-gon" : ""}">
      <button class="rail-level ${S.tab === "level" && S.level === +so_lv ? "chon" : ""}"
        onclick="bamLevel(${so_lv},this)" aria-expanded="${!gap}">
        <span class="mui">\u203a</span>
        <span class="ten">${esc(lv.ten)}</span>
        <span class="dem">${xong}/${lv.ds.length}</span>
      </button>
      <div class="rail-nhom-noi">` + lv.ds.map(m => {
        const k = soMucXong(m.so), het = k === SO_MUC, mo = S.railMo.has(m.so);
        const dangXemUnit = S.tab === "unit" && S.unit === m.so;
        return `<div class="rail-unit ${mo ? "mo" : ""} ${S.unit === m.so ? "dang" : ""}">
          <button class="rail-dau ${dangXemUnit ? "chon" : ""}" onclick="batTatUnit(${m.so})" aria-expanded="${mo}">
            <span class="tick ${het ? "du" : k ? "phan" : ""}">${het ? "\u2713" : ""}</span>
            <span class="ten">${m.so}. ${esc(m.ten)}</span>
            <span class="dem">${k}/${SO_MUC}</span>
            <span class="mui">\u203a</span>
          </button>
          <div class="rail-muc">${Object.keys(MUC).map(tab => {
            const t = trangThai(m.so, MUC[tab]);
            const dangMo = S.unit === m.so && S.tab === tab;
            return `<button class="rail-item ${t} ${dangMo ? "chon" : ""}"
                onclick="moMuc(${m.so},'${tab}')">
                <span class="tick ${t === "xong" ? "du" : t === "dang" ? "phan" : ""}">${t === "xong" ? "\u2713" : ""}</span>
                <span class="ten">${TEN_MUC[tab]}</span>
                <span class="phu-de">${phuDeTheoTab(tab, m)}</span></button>`;
          }).join("")}</div>
        </div>`;
      }).join("") + `</div></div>`;
  });
  h += nhomRail("nhom/bai-hoc", "Bài học", hLevel,
    `${tt.unitXong}/${S.muc_luc.length} unit`);

  /* --- 3. Cài đặt: mỗi dòng mở thẳng đúng thẻ trong hộp Cài đặt, khỏi phải
         mở hộp rồi tự đi tìm --- */
  h += nhomRail("nhom/cai-dat", "Cài đặt",
    don("\u263a", "User", "", "moCaiDat();chonTheCaiDat('nguoi-hoc')",
        typeof HS !== "undefined" ? HS.ten() : "") +
    don("\u266a", "Âm thanh", "", "moCaiDat();chonTheCaiDat('am-thanh')") +
    don("\u25b6", "Chế độ Mẫu câu", "", "moCaiDat();chonTheCaiDat('mau-cau')") +
    don("\u21bb", "Chế độ Ôn tập", "", "moCaiDat();chonTheCaiDat('on-tap')"));

  $("#rail-noi").innerHTML = h;

  if (!keo) return;
  /* Không dùng scrollIntoView: cột trái là khối cuộn riêng, còn scrollIntoView
     hay lôi cả trang chính đi theo. Tính tay thì chỉ đúng cột này chạy. */
  const el = $("#rail-noi .rail-item.chon");
  const rail = $("#rail");
  if (el && rail) rail.scrollTop = Math.max(0, el.offsetTop - rail.clientHeight / 2);
}

/* Ba mục chính của menu — cũng gấp lại được như level */
function nhomRail(id, ten, noi, dem = "") {
  const gap = S.railGap.has(id);
  return `<div class="rail-goc ${gap ? "thu-gon" : ""}">
      <button class="rail-goc-dau" onclick="batTatRailNhom('${id}',this)" aria-expanded="${!gap}">
        <span class="mui">\u203a</span>
        <span class="ten">${esc(ten)}</span>
        ${dem ? `<span class="dem">${esc(dem)}</span>` : ""}
      </button>
      <div class="rail-goc-noi">${noi}</div>
    </div>`;
}

/* Cùng luật với dòng unit: đang gấp thì bung ra VÀ mở màn Level; đang mở thì
   chỉ gấp lại, không điều hướng. */
function bamLevel(lv, nut) {
  if (S.railGap.has("lv/" + lv)) { moLevel(lv); return; }
  batTatRailNhom("lv/" + lv, nut);
}

/* Gấp/mở tại chỗ, không vẽ lại cả menu: vẽ lại thì cột trái nhảy về đầu */
function batTatRailNhom(id, nut) {
  const gap = S.railGap.has(id);
  gap ? S.railGap.delete(id) : S.railGap.add(id);
  luuRail();
  nut.closest(".rail-goc, .rail-nhom")?.classList.toggle("thu-gon", !gap);
  nut.setAttribute("aria-expanded", String(gap));
}

/* Khoảng cách các dòng: thoáng cho dễ bấm bằng ngón tay, gọn cho thấy được
   nhiều unit hơn trong một màn. */
function doiDayRail() {
  S.railDay = S.railDay === "gon" ? "thoang" : "gon";
  luuRail();
  $("#rail").classList.toggle("day-gon", S.railDay === "gon");
}

/* Thu hẹp hẳn menu để nhường bề ngang cho nội dung. Thu rồi thì nút ☰ hiện
   ra kể cả trên màn rộng, bấm vào là menu trượt đè lên như trên điện thoại. */
function batTatGonRail() {
  S.railGon = !S.railGon;
  luuRail();
  $(".khung").classList.toggle("gon-rail", S.railGon);
  $("#nut-rail").classList.toggle("hien-luon", S.railGon);
  if (!S.railGon) dongRail();
}

/* Đang đóng -> bung ra VÀ mở màn Unit. Đang mở -> chỉ gấp lại, không điều
   hướng đi đâu: bấm để gấp cho gọn mà bị nhảy sang trang khác thì khó chịu. */
function batTatUnit(so) {
  if (S.railMo.has(so)) {
    S.railMo.delete(so);
    luuRail();
    veRail();
    return;
  }
  moUnit(so);
}

/* Nhớ chỗ đang mở qua các lần mở app. Mở lại mà 5 level bung hết, unit đang
   học nằm đâu đó giữa 50 dòng thì lần nào cũng phải cuộn đi tìm. */
function luuRail() {
  localStorage.setItem("railGap", JSON.stringify([...S.railGap]));
  localStorage.setItem("railUnitMo", JSON.stringify([...S.railMo]));
  localStorage.setItem("railGon", S.railGon ? "1" : "0");
  localStorage.setItem("railDay", S.railDay);
}

function napRail(unitDangHoc) {
  try {
    const d = JSON.parse(localStorage.getItem("railGap"));
    if (Array.isArray(d)) S.railGap = new Set(d.map(String));
  } catch (e) { /* dữ liệu hỏng thì dùng mặc định bên dưới */ }
  S.railGon = localStorage.getItem("railGon") === "1";
  S.railDay = localStorage.getItem("railDay") === "gon" ? "gon" : "thoang";

  // Lần đầu chưa có gì đã lưu: gấp hết level lại, chỉ chừa level đang học
  if (!localStorage.getItem("railGap")) {
    const lvDangHoc = S.muc_luc.find(m => m.so === unitDangHoc)?.level;
    S.railGap = new Set([...new Set(S.muc_luc.map(m => m.level))]
      .filter(l => l !== lvDangHoc).map(l => "lv/" + l));
  }
  S.railMo = new Set([unitDangHoc]);
  moLevelChua(unitDangHoc);
}

// Mở mục nằm trong level đang gấp thì phải bung level đó ra, không thì bấm xong
// nhìn cột trái không thấy gì đổi
function moLevelChua(so) {
  const lv = S.muc_luc.find(m => m.so === so)?.level;
  if (lv !== undefined) S.railGap.delete("lv/" + lv);
  S.railGap.delete("nhom/bai-hoc");
}

function moRail() {
  $("#rail").classList.add("mo");
  $("#rail-nen").classList.remove("an");
  $("#nut-rail").setAttribute("aria-expanded", "true");
}
function dongRail() {
  $("#rail").classList.remove("mo");
  $("#rail-nen").classList.add("an");
  $("#nut-rail").setAttribute("aria-expanded", "false");
}
function batTatRail() {
  $("#rail").classList.contains("mo") ? dongRail() : moRail();
}

/* Cột trái dính ngay dưới header, nhưng header cao bao nhiêu thì tuỳ bề rộng
   màn hình (hàng công tắc xuống dòng khi hẹp). Đặt cứng top:56px thì lúc hở
   một dải trắng, lúc cụt mất mấy dòng cuối. Đo thật rồi ghi vào biến CSS. */
function doCaoHeader() {
  const h = $("header")?.offsetHeight || 56;
  document.documentElement.style.setProperty("--cao-header", h + "px");
}

function phuDeTheoTab(tab, m) {
  if (tab === "bai-hoc") return `${m.so_tu} từ · ${m.so_mau_cau} mẫu câu`;
  if (tab === "bai-tap") return `${m.so_cau_hoi} câu hỏi`;
  if (tab === "mau-cau") return `đã nghe ${S.tienDo?.nghe?.[m.so] || 0} câu`;
  if (tab === "hoi-thoai") return `${m.so_hoi_thoai} lượt thoại`;
  if (tab === "truyen") return `đoạn văn mẫu`;
  if (tab === "de-thi") return `đề mini`;
  return "";
}

/* ================= MÀN TỔNG QUAN =================
   Màn mở đầu kiểu trang chủ khoá học: đang đứng ở đâu, còn bao nhiêu, và một
   nút đi thẳng vào mục dở dang gần nhất. */
function mucDangDo() {
  for (const m of S.muc_luc)
    for (const tab of Object.keys(MUC))
      if (trangThai(m.so, MUC[tab]) !== "xong")
        return { so: m.so, tab, ten: m.ten, tt: trangThai(m.so, MUC[tab]) };
  return null;
}

function veMenu() {
  dungPhatKhiChuyen();
  S.tab = "tong-quan";
  const tt = capNhatTienDoTong();
  const tiep = mucDangDo();
  const pt = Math.round(tt.xong / tt.tong * 100);

  let h = `<div class="the-mo-dau gon">
      <div class="thanh-tong">
        <div class="vach">
          <i class="xong" style="width:${pt}%"></i>
          <i class="dang" style="width:${Math.round(tt.dang / tt.tong * 100)}%"></i>
        </div>
        <div class="so-lieu">
          <span><b>${pt}%</b> hoàn thành</span>
          <span><b>${tt.xong}</b>/${tt.tong} mục</span>
          <span><b>${tt.dang}</b> đang học</span>
          <span><b>${tt.unitXong}</b>/${S.muc_luc.length} unit xong</span>
        </div>
      </div>
      ${tiep ? `<button class="chinh to" onclick="moMuc(${tiep.so},'${tiep.tab}')">
          ${tiep.tt === "dang" ? "Học tiếp" : "Bắt đầu"}: Unit ${tiep.so} — ${esc(tiep.ten)}
          <span class="nho-hon">${TEN_MUC[tiep.tab]}</span></button>`
        : `<div class="the" style="margin-top:12px">Xong toàn bộ ${S.muc_luc.length} unit.
             Giờ là lúc quay lại tab Ôn tập và các đề thi.</div>`}
    </div>`;

  const theoLevel = {};
  S.muc_luc.forEach(m => (theoLevel[m.level] ||= { ten: m.ten_level, ds: [] }).ds.push(m));
  h += `<h3>Các cấp độ</h3><div class="luoi-level">`;
  h += Object.entries(theoLevel)
    .sort((a, b) => (+a[0]) - (+b[0]))
    .map(([, lv]) => {
    const tongLv = lv.ds.length * SO_MUC;
    const xongLv = lv.ds.reduce((a, m) => a + soMucXong(m.so), 0);
    const p = Math.round(xongLv / tongLv * 100);
    return `<button class="the-level" onclick="moLevel(${lv.ds[0].level})">
        <span class="ten">${esc(lv.ten)}</span>
        <span class="mo">Unit ${lv.ds[0].so}–${lv.ds[lv.ds.length - 1].so} · ${lv.ds.length} unit</span>
        <span class="vach"><i class="xong" style="width:${p}%"></i></span>
        <span class="mo">${p}% · ${xongLv}/${tongLv} mục</span>
      </button>`;
  }).join("");
  h += `</div>`;

  $("#man-menu").innerHTML = h;
  $$(".trang").forEach(s => s.classList.toggle("hien", s.id === "man-menu"));
  veRail();
  dongRail();
}

/* ================= HỌC PHIÊN ÂM IPA =================
   IPA hiện khắp app nhưng chưa có chỗ nào dạy chính ký hiệu đó.

   Ba quyết định:
   - MẢNG RIÊNG, không phải mục thứ 7 của unit: 44 âm là tập cố định, không
     gắn với chủ đề unit nào; chia rải ra 50 unit là tùy tiện. Người học còn
     cần tra ngay giữa chừng ("/ʊə/ đọc sao?").
   - DẠY QUA TỪ, không qua ký hiệu đứng một mình: nhiều phụ âm tắc không thể
     phát âm rời, mà TTS đọc "/θ/" trơ trọi cũng nghe không ra gì.
   - LUYỆN NGHE PHÂN BIỆT TRƯỚC: nghe không ra khác nhau thì tập nói kiểu gì
     cũng không sửa được. Nên bài tập chính là chọn A hay B trong cặp tối
     thiểu, không phải đọc theo. */
let duLieuIPA = null;
let amDaHoc = new Set();

function napAmDaHoc() {
  try {
    const d = JSON.parse(localStorage.getItem("ipaXong__" + (HS?.id || "mac_dinh")));
    amDaHoc = new Set(Array.isArray(d) ? d : []);
  } catch (e) { amDaHoc = new Set(); }
}

function luuAmDaHoc() {
  localStorage.setItem("ipaXong__" + (HS?.id || "mac_dinh"),
    JSON.stringify([...amDaHoc]));
}

async function moIPA() {
  dungPhat();
  S.tab = "ipa";
  $$(".trang").forEach(x => x.classList.toggle("hien", x.id === "ipa"));
  if (!duLieuIPA) {
    $("#ipa").innerHTML = `<div class="trong">Đang nạp…</div>`;
    duLieuIPA = await (await fetch("/api/ipa")).json();
  }
  napAmDaHoc();
  veIPA();
  veRail();
  dongRail();
  window.scrollTo({ top: 0 });
}

/* Lọc: xem hết 44 âm, hay chỉ 18 âm người Việt sai nhiều nhất.
   Mặc định TẤT CẢ — bảng âm là chỗ tra cứu trước khi là chỗ luyện: cần biết
   /ʊə/ đọc sao thì phải thấy nó ngay, mà nó không nằm trong nhóm hay sai.
   Lọc 18 âm để riêng phía sau, dùng khi đã muốn luyện có trọng tâm. */
let locIPA = localStorage.getItem("locIPA") || "tat_ca";

function doiLocIPA(v) {
  locIPA = v;
  localStorage.setItem("locIPA", v);
  veIPA();
}

/* Ba thẻ: Âm · Trọng âm · Nối âm.
   Vì sao gộp một mảng chứ không tách ba mục ở menu: ba thứ này là một chuỗi
   phải học liền nhau. Đọc đúng từng âm mà sai trọng âm thì người nghe vẫn
   không hiểu; đúng cả hai mà đọc rời từng từ thì câu vẫn nghe "từng chữ một". */
let theIPA = localStorage.getItem("thePhatAm") || "am";

function doiThePhatAm(v) {
  theIPA = v;
  localStorage.setItem("thePhatAm", v);
  veIPA();
}

const thanhThePhatAm = () => `
  <div class="hop-tab" style="border:1px solid var(--vien); border-radius:9px;
       margin-bottom:14px; background:var(--the)">
    ${[["am", "Âm (IPA)"], ["trong_am", "Trọng âm"], ["noi_am", "Nối âm"]]
      .map(([v, t]) => `<button class="${theIPA === v ? "chon" : ""}"
        onclick="doiThePhatAm('${v}')">${t}</button>`).join("")}
  </div>`;

function veTrongAm() {
  const d = duLieuIPA.trong_am;
  if (!d) return `<div class="trong">Chưa có dữ liệu trọng âm.</div>`;
  const oTu = v => `<button class="tu-nhan" onclick="doc(${JSON.stringify(v.tu).replace(/"/g, "&quot;")})">
      <b>${esc(v.tu)}</b><span class="pa">/${esc(v.ipa)}/</span>
      <span class="cho-nhan">âm ${v.trong_am}/${v.so_am_tiet}</span></button>`;

  let h = `<div class="the">
      <h3 style="margin-top:0">Vì sao trọng âm quan trọng hơn bạn nghĩ</h3>
      <div>Tiếng Việt mỗi tiếng một thanh điệu, đọc đều nhau. Tiếng Anh thì
        MỘT âm tiết được nhấn mạnh hẳn, các âm tiết còn lại bị nuốt ngắn lại.
        Nhấn sai chỗ thì dù phát âm từng âm đúng hết, người nghe vẫn không
        nhận ra từ — đây là lý do phổ biến nhất khiến người bản ngữ hỏi lại.</div>
    </div>`;

  d.quy_tac.forEach((q, i) => {
    h += khoi(`ta/${q.ma}`, q.ten,
      `<div class="mo" style="margin:10px 0">${esc(q.mo_ta)}</div>
       <div class="luoi-tu-nhan">${q.vi_du.map(oTu).join("")}</div>`,
      `${q.vi_du.length} ví dụ`);
  });

  h += khoi("ta/bang-luyen", "Bảng luyện theo dạng",
    `<div class="mo" style="margin:10px 0">Xếp theo số âm tiết và vị trí nhấn.
       Đọc to cả nhóm một lượt — cùng một dạng nhấn thì miệng quen nhanh hơn
       học lẻ từng từ.</div>` +
    d.bang_luyen.map(b => `
      <div class="nhom-nhan">
        <div class="ten-nhom">${b.so_am_tiet} âm tiết · nhấn âm ${b.trong_am}</div>
        <div class="luoi-tu-nhan">${b.tu.map(oTu).join("")}</div>
      </div>`).join(""), `${d.bang_luyen.length} dạng`);
  return h;
}

function veNoiAm() {
  const d = duLieuIPA.noi_am;
  if (!d) return `<div class="trong">Chưa có dữ liệu nối âm.</div>`;
  let h = `<div class="the">
      <h3 style="margin-top:0">Vì sao câu nghe "từng chữ một"</h3>
      <div>Tiếng Việt là ngôn ngữ đơn âm — mỗi tiếng một khối tách bạch. Đem
        thói quen đó sang tiếng Anh thì câu thành một chuỗi từ rời. Người bản
        ngữ NỐI các từ lại thành dòng liền, và đó là khác biệt lớn nhất giữa
        "đọc được" và "nói được".</div>
      <div class="mo" style="margin-top:8px">Dấu <b>‿</b> trong phiên âm bên
        dưới đánh dấu đúng chỗ hai từ dính vào nhau.</div>
    </div>`;

  d.quy_tac.forEach(q => {
    h += khoi(`na/${q.ma}`, q.ten, `
      <div class="mo" style="margin:10px 0">${esc(q.mo_ta)}</div>
      <div class="canh-bao">${esc(q.bay)}</div>
      <div class="ds-cau-noi">${q.vi_du.map(v => `
        <div class="cau-noi">
          <div class="hang">
            <span class="en">${esc(v.cau)}</span>${nutLoa(v.cau)}
          </div>
          <div class="pa-noi">${esc(v.ipa_noi)}</div>
          ${v.tho_noi ? `<div class="tho">${esc(v.tho_noi)}</div>` : ""}
        </div>`).join("")}</div>`, `${q.vi_du.length} câu`);
  });
  return h;
}

function veIPA() {
  const d = duLieuIPA;
  if (!d) return;
  if (theIPA !== "am") {
    $("#ipa").innerHTML = `<div class="the-mo-dau">
        <h2>Phát âm</h2>
        <div class="mo">Ba phần học liền nhau: từng âm → nhấn đúng chỗ → nối
          các từ thành dòng.</div>
      </div>` + thanhThePhatAm()
      + (theIPA === "trong_am" ? veTrongAm() : veNoiAm());
    return;
  }
  const ds = d.am.filter(a => locIPA === "tat_ca" || a.uu_tien === 1);
  const xong = d.am.filter(a => amDaHoc.has(a.ipa)).length;

  let h = `<div class="the-mo-dau">
      <h2>Phát âm</h2>
      <div class="mo">44 ký hiệu tiếng Anh-Anh — đúng bộ đang hiện ở Từ vựng,
        Mẫu câu và Truyện. Mỗi âm có khẩu hình, đường đi của luồng hơi, và một
        phép TỰ KIỂM làm được không cần thầy.</div>
      <div class="thanh-tong">
        <div class="so-lieu">
          <span><b>${xong}</b> / ${d.am.length} âm đã học</span>
          <span><b>18</b> âm người Việt hay sai nhất</span>
        </div>
        <div class="vach"><i class="xong" style="width:${Math.round(xong / d.am.length * 100)}%"></i></div>
      </div>
      <div class="hang" style="gap:8px; margin-top:12px; flex-wrap:wrap">
        <button class="${locIPA === "tat_ca" ? "chinh" : "phu"}" onclick="doiLocIPA('tat_ca')">
          Tất cả 44 âm</button>
        <button class="${locIPA === "uu_tien" ? "chinh" : "phu"}" onclick="doiLocIPA('uu_tien')">
          Âm hay sai (18)</button>
      </div>
    </div>` + thanhThePhatAm();

  d.nhom.forEach(nh => {
    const trong = ds.filter(a => a.nhom === nh.ma);
    if (!trong.length) return;
    h += `<h3>${esc(nh.ten)} <span class="mo">· ${trong.length} âm</span></h3>
      <div class="luoi-am">` + trong.map(a => `
        <button class="o-am ${amDaHoc.has(a.ipa) ? "xong" : ""} ${a.uu_tien === 1 ? "hay-sai" : ""}"
          onclick="moChiTietAm(${JSON.stringify(a.ipa).replace(/"/g, "&quot;")})">
          <span class="ky-hieu">/${esc(a.ipa)}/</span>
          <span class="tho">${esc(a.tho)}</span>
          ${amDaHoc.has(a.ipa) ? `<span class="dau-xong">✓</span>` : ""}
        </button>`).join("") + `</div>`;
  });

  $("#ipa").innerHTML = h;
}

function moChiTietAm(ipa) {
  const a = duLieuIPA.am.find(x => x.ipa === ipa);
  if (!a) return;
  const xong = amDaHoc.has(a.ipa);
  const nhamVoi = a.nham_voi ? duLieuIPA.am.find(x => x.ipa === a.nham_voi) : null;

  $("#ipa").innerHTML = `
    <div class="dau-chi-tiet">
      <span class="tieu">/${esc(a.ipa)}/ — đọc thô: ${esc(a.tho)}</span>
      ${a.uu_tien === 1 ? `<span class="nhan canh">Người Việt hay sai</span>` : ""}
      <button class="nut-xong" onclick="veIPA()">← Về bảng âm</button>
    </div>

    <div class="the">
      <h3 style="margin-top:0">Khẩu hình — môi, hàm, lưỡi</h3>
      <div>${esc(a.khau_hinh || a.mo_ta)}</div>
      <h3>Luồng hơi</h3>
      <div>${esc(a.luong_hoi || "")}</div>
      ${a.tu_kiem ? `<h3>Tự kiểm — không cần thầy</h3>
        <div class="tu-kiem">${esc(a.tu_kiem)}</div>` : ""}
      <h3>Bẫy của người Việt</h3>
      <div class="canh-bao">${esc(a.bay)}</div>
      ${nhamVoi ? `<div class="mo" style="margin-top:8px">Hay lẫn với
        <b>/${esc(nhamVoi.ipa)}/</b> (${esc(nhamVoi.tho)}) —
        <button class="phu" style="padding:2px 8px"
          onclick="moChiTietAm(${JSON.stringify(nhamVoi.ipa).replace(/"/g, "&quot;")})">xem âm đó</button></div>` : ""}
    </div>

    ${khoi(`ipa/vi-du-${a.ipa}`, "Từ có âm này", `<div class="ds-tu">` +
      a.vi_du.map(v => `<div class="mot-tu">
          <div class="dinh">
            <span class="tu-anh">${esc(v.tu)}</span>${nutLoa(v.tu)}
            <span class="pa">${esc(v.ipa)}</span>
            ${v.nghia ? `<span class="nghia">${esc(v.nghia)}</span>` : ""}
            ${v.unit ? `<span class="mo">unit ${v.unit}</span>` : ""}
          </div>
        </div>`).join("") + `</div>`, `${a.vi_du.length} từ`)}

    ${a.cap_toi_thieu.length ? khoi(`ipa/cap-${a.ipa}`, "Cặp tối thiểu — nghe phân biệt", `
      <div class="mo" style="margin:10px 0">Hai từ chỉ khác đúng một âm. Bấm
        <b>Nghe ngẫu nhiên</b>, đoán máy vừa đọc từ nào. Nghe ra được khác nhau
        thì mới sửa được cách nói — làm ngược lại không ăn thua.</div>
      ${a.cap_toi_thieu.map((c, i) => `
        <div class="mot-cap" id="cap-${i}">
          <div class="hai-tu">
            <button class="tu-cap" onclick="docTuCap(${i},'a')">
              <b>${esc(c.a)}</b><span class="pa">/${esc(c.ipa_a)}/</span></button>
            <span class="vs">–</span>
            <button class="tu-cap" onclick="docTuCap(${i},'b')">
              <b>${esc(c.b)}</b><span class="pa">/${esc(c.ipa_b)}/</span></button>
          </div>
          <div class="hang" style="gap:8px; margin-top:6px">
            <button class="phu" onclick="doCap(${i})">🔊 Nghe ngẫu nhiên</button>
            <button class="phu an" id="doan-a-${i}" onclick="traLoiCap(${i},'a')">“${esc(c.a)}”</button>
            <button class="phu an" id="doan-b-${i}" onclick="traLoiCap(${i},'b')">“${esc(c.b)}”</button>
            <span id="kq-cap-${i}"></span>
          </div>
        </div>`).join("")}`, `${a.cap_toi_thieu.length} cặp`) : ""}

    <div class="cuoi-chi-tiet">
      <button class="nut-xong ${xong ? "da-xong" : ""}"
        onclick="batTatAmXong(${JSON.stringify(a.ipa).replace(/"/g, "&quot;")},this)">
        ${xong ? "✓ Đã học xong" : "Đánh dấu đã học xong"}</button>
    </div>`;

  amDangXem = a;
  dapAnCap = {};
  window.scrollTo({ top: 0 });
}

let amDangXem = null, dapAnCap = {};

function docTuCap(i, ben) {
  const c = amDangXem?.cap_toi_thieu?.[i];
  if (c) doc(ben === "a" ? c.a : c.b);
}

/* Nghe ngẫu nhiên một trong hai từ rồi để người học đoán. Không hiện đáp án
   trước — thấy chữ rồi thì tai không phải làm gì nữa. */
function doCap(i) {
  const c = amDangXem?.cap_toi_thieu?.[i];
  if (!c) return;
  const ben = Math.random() < 0.5 ? "a" : "b";
  dapAnCap[i] = ben;
  $(`#kq-cap-${i}`).innerHTML = `<span class="mo">Nghe rồi chọn…</span>`;
  $(`#doan-a-${i}`).classList.remove("an");
  $(`#doan-b-${i}`).classList.remove("an");
  doc(ben === "a" ? c.a : c.b);
}

function traLoiCap(i, chon) {
  const that = dapAnCap[i];
  if (!that) return;
  const c = amDangXem.cap_toi_thieu[i];
  const dung = chon === that;
  $(`#kq-cap-${i}`).innerHTML = dung
    ? `<span class="dung">✓ Đúng — “${esc(that === "a" ? c.a : c.b)}”</span>`
    : `<span class="sai">✗ “${esc(that === "a" ? c.a : c.b)}”</span>`;
  if (!dung) doc(that === "a" ? c.a : c.b);
}

function batTatAmXong(ipa, nut) {
  const xong = amDaHoc.has(ipa);
  xong ? amDaHoc.delete(ipa) : amDaHoc.add(ipa);
  luuAmDaHoc();
  nut.classList.toggle("da-xong", !xong);
  nut.textContent = !xong ? "✓ Đã học xong" : "Đánh dấu đã học xong";
}

/* ================= MÀN LEVEL =================
   Tầng giữa của cây Tổng quan → Level → Unit → Mục. Thiếu tầng này thì bấm
   một cấp độ là rơi thẳng vào Bài học của unit đầu tiên, bỏ qua mất bước
   "cấp này có những unit nào, tôi đang dở unit nào". */
function moLevel(lv) {
  dungPhat();
  S.tab = "level";
  S.level = lv;
  S.railGap.delete("lv/" + lv);
  S.railGap.delete("nhom/bai-hoc");
  luuRail();
  veManLevel(lv);
  $$(".trang").forEach(x => x.classList.toggle("hien", x.id === "man-level"));
  veRail();
  dongRail();
  window.scrollTo({ top: 0 });
}

/* Ôn tập riêng của MỘT unit. Không tính vào 6 mục: ôn tập là việc lặp lại
   không có điểm "xong", đưa vào thì unit không bao giờ hoàn thành được. */
async function moOnTapUnit(so) {
  dungPhat();
  S.tab = "on-tap-unit";
  S.unit = so;
  $$(".trang").forEach(x => x.classList.toggle("hien", x.id === "on-tap-unit"));
  const el = $("#on-tap-unit");
  el.innerHTML = `<div class="trong">Đang nạp…</div>`;
  const m = S.muc_luc.find(x => x.so === so) || {};
  await veOnTap(so);
  el.prepend(Object.assign(document.createElement("div"), {
    className: "dau-chi-tiet",
    innerHTML: `<span class="tieu">Unit ${so} — ${esc(m.ten || "")}</span>
      <span class="nhan">Ôn tập</span>
      <button class="nut-xong" onclick="moUnit(${so})">← Về unit</button>`,
  }));
  veRail();
  dongRail();
  window.scrollTo({ top: 0 });
}

function veManLevel(lv) {
  const ds = S.muc_luc.filter(m => m.level === lv);
  if (!ds.length) return veMenu();
  const tenLv = ds[0].ten_level || `Level ${lv}`;
  const tongMuc = ds.length * SO_MUC;
  const xongMuc = ds.reduce((a, m) => a + soMucXong(m.so), 0);
  const pt = Math.round(xongMuc / tongMuc * 100);
  const unitXong = ds.filter(m => soMucXong(m.so) === SO_MUC).length;
  const tiep = ds.find(m => soMucXong(m.so) < SO_MUC);

  let h = `<div class="the-mo-dau">
      <div class="mo">Cấp độ ${lv}</div>
      <h2>${esc(tenLv)}</h2>
      <div class="thanh-tong">
        <div class="so-lieu">
          <span><b>${pt}%</b> hoàn thành</span>
          <span><b>${xongMuc}</b> / ${tongMuc} mục đã xong</span>
          <span><b>${unitXong}</b> / ${ds.length} unit xong trọn vẹn</span>
        </div>
        <div class="vach"><i class="xong" style="width:${pt}%"></i></div>
      </div>
      ${tiep ? `<button class="chinh to" onclick="moUnit(${tiep.so})">
          Học tiếp <span class="nho-hon">Unit ${tiep.so} — ${esc(tiep.ten)}</span></button>`
        : `<div class="the" style="margin-top:12px">Xong trọn vẹn cấp độ này.</div>`}
    </div>

    <div class="ds-muc-unit">` + ds.map(m => {
      const k = soMucXong(m.so), het = k === SO_MUC;
      const tt = het ? "xong" : k ? "dang" : "chua";
      return `<button class="o-muc ${tt}" onclick="moUnit(${m.so})">
          <span class="tick ${het ? "du" : k ? "phan" : ""}">${het ? "\u2713" : ""}</span>
          <span class="noi">
            <span class="ten">Unit ${m.so} — ${esc(m.ten)}</span>
            <span class="phu-de">${k}/${SO_MUC} mục · ${m.so_tu} từ · ${m.so_cau_hoi} câu hỏi</span>
          </span>
          <span class="dau">\u203a</span>
        </button>`;
    }).join("") + `</div>

    <div class="dieu-huong-unit">
      <button class="phu" onclick="veMenu()">\u2039 Tổng quan</button>
      ${S.muc_luc.some(m => m.level === lv + 1)
        ? `<button class="phu" onclick="moLevel(${lv + 1})">Cấp độ ${lv + 1} \u203a</button>` : "<span></span>"}
    </div>`;

  $("#man-level").innerHTML = h;
}

/* ================= MÀN UNIT (danh mục cha) =================
   Tương đương trang "module" của một khoá Coursera/Google: liệt kê các mục
   con kèm tick, cho biết còn nợ gì và đi tiếp từ đâu. Đây là chỗ quay về sau
   khi đánh dấu hoàn thành một mục. */
async function moUnit(so) {
  dungPhatKhiChuyen();
  S.tab = "unit";
  S.unit = so;
  S.railMo = new Set([so]);
  moLevelChua(so);
  luuRail();
  await doiUnit(so);            // nạp dữ liệu để phụ đề từng mục đúng số liệu
  veManUnit(so);
  $$(".trang").forEach(x => x.classList.toggle("hien", x.id === "man-unit"));
  veRail(true);
  dongRail();
  window.scrollTo({ top: 0 });
}

function veManUnit(so) {
  const m = S.muc_luc.find(x => x.so === so) || {};
  const xong = soMucXong(so), pt = Math.round(xong / SO_MUC * 100);
  const tiep = Object.keys(MUC).find(t => trangThai(so, MUC[t]) !== "xong");
  const truoc = S.muc_luc.filter(x => x.so < so).pop();
  const sau = S.muc_luc.find(x => x.so > so);

  let h = `<div class="the-mo-dau">
      <div class="mo">${esc(m.ten_level || "")}</div>
      <h2>Unit ${so} — ${esc(m.ten || "")}</h2>
      <div class="thanh-tong">
        <div class="so-lieu">
          <span><b>${xong}</b> / ${SO_MUC} mục đã xong</span>
          <span><b>${pt}%</b> hoàn thành</span>
        </div>
        <div class="vach"><i class="xong" style="width:${pt}%"></i></div>
      </div>
      ${tiep
        ? `<button class="chinh to" onclick="moMuc(${so},'${tiep}')">
             ${trangThai(so, MUC[tiep]) === "dang" ? "Học tiếp" : "Bắt đầu"}
             <span class="nho-hon">${TEN_MUC[tiep]}</span></button>`
        : `<div class="the" style="margin-top:12px">Xong trọn vẹn unit này.
             ${sau ? `Sang <b>Unit ${sau.so} — ${esc(sau.ten)}</b> được rồi.` : ""}</div>`}
    </div>

    <div class="ds-muc-unit">` + Object.keys(MUC).map(tab => {
      const t = trangThai(so, MUC[tab]);
      return `<button class="o-muc ${t}" onclick="moMuc(${so},'${tab}')">
          <span class="tick ${t === "xong" ? "du" : t === "dang" ? "phan" : ""}">${t === "xong" ? "\u2713" : ""}</span>
          <span class="noi">
            <span class="ten">${TEN_MUC[tab]}</span>
            <span class="phu-de">${phuDeTheoTab(tab, m)}</span>
          </span>
          <span class="dau">\u203a</span>
        </button>`;
    }).join("") + `</div>

    <button class="o-muc o-on-tap" onclick="moOnTapUnit(${so})">
      <span class="ic-on">\u21bb</span>
      <span class="noi">
        <span class="ten">Ôn tập unit này</span>
        <span class="phu-de">Lặp ngắt quãng các từ của unit ${so}, không đợi unit hoàn thành</span>
      </span>
      <span class="dau">\u203a</span>
    </button>

    <div class="dieu-huong-unit">
      ${truoc ? `<button class="phu" onclick="moUnit(${truoc.so})">\u2039 Unit ${truoc.so}</button>` : "<span></span>"}
      <button class="phu" onclick="moLevel(${m.level})">${esc(m.ten_level || "Cấp độ")}</button>
      ${sau ? `<button class="phu" onclick="moUnit(${sau.so})">Unit ${sau.so} \u203a</button>` : "<span></span>"}
    </div>`;

  $("#man-unit").innerHTML = h;
}

/* ================= MÀN CHI TIẾT ================= */
/* Mở đúng một mục của đúng một unit. Đây là lối vào duy nhất của phần nội dung
   — cả thanh bên trái lẫn nút "Học tiếp" đều gọi vào đây. */
async function moMuc(so, tab) {
  dungPhatKhiChuyen();
  S.tab = tab;
  S.railMo = new Set([so]);
  moLevelChua(so);
  luuRail();
  await doiUnit(so);                 // doiUnit tự lo mau-cau / de-thi theo S.tab
  await chamDang(so, MUC[tab]);
  $$(".trang").forEach(s => s.classList.toggle("hien", s.id === tab));
  gan_dau_chi_tiet(tab, so, MUC[tab]);
  veRail(true);
  dongRail();
  window.scrollTo({ top: 0 });
}

// giữ tên cũ: vài chỗ trong app còn gọi moChiTiet(so) với tab hiện hành
const moChiTiet = so => moMuc(so, MUC[S.tab] ? S.tab : "bai-hoc");

/* thanh đầu màn chi tiết: tên unit + nút đánh dấu hoàn thành */
function gan_dau_chi_tiet(tab, so, muc) {
  const el = $(`#${tab}`);
  if (!el || el.querySelector(".dau-chi-tiet")) {
    const cu = el?.querySelector(".dau-chi-tiet");
    if (cu) cu.remove();
  }
  const daXong = trangThai(so, muc) === "xong";
  const m = S.muc_luc.find(x => x.so === so) || {};
  const div = document.createElement("div");
  div.className = "dau-chi-tiet";
  div.innerHTML = `
    <button class="tieu duong-dan" onclick="moUnit(${so})"
      title="Về danh sách mục của Unit ${so}">Unit ${so} — ${esc(m.ten || "")}</button>
    <button class="nhan duong-dan" onclick="moLevel(${m.level ?? 0})"
      title="Về ${esc(m.ten_level || "level")}">${esc(m.ten_level || "")}</button>
    ${nutXong(so, muc, daXong)}`;
  el.prepend(div);

  /* Nút thứ hai ở CUỐI trang: học xong thì con trỏ đang ở đáy, bắt cuộn
     ngược lên đầu chỉ để bấm một nút là thừa một thao tác mỗi bài. */
  el.querySelector(".cuoi-chi-tiet")?.remove();
  const duoi = document.createElement("div");
  duoi.className = "cuoi-chi-tiet";
  duoi.innerHTML = nutXong(so, muc, daXong);
  el.append(duoi);
}

/* Chuỗi phẳng toàn khoá: unit 1 mục 1 → … → unit 1 mục 6 → unit 2 mục 1 → …
   Nhờ vậy nút trước/sau đi liền mạch qua ranh giới unit, không cụt ở mục cuối
   rồi bắt người học tự quay ra tìm unit kế. */
function chuoiMuc() {
  const cac = Object.keys(MUC);
  const ra = [];
  S.muc_luc.forEach(m => cac.forEach(t => ra.push({ so: m.so, tab: t })));
  return ra;
}

function mucKe(so, tab, buoc) {
  const ds = chuoiMuc();
  const i = ds.findIndex(x => x.so === so && x.tab === tab);
  if (i < 0) return null;
  return ds[i + buoc] || null;
}

/* Ba nút biểu tượng, KHÔNG chữ — đặt ở cả đầu lẫn cuối mục.
   Vì sao cả hai đầu: đọc xong thì con trỏ đang ở đáy trang, bắt cuộn ngược
   lên để bấm một nút là thừa một thao tác mỗi bài; còn muốn bỏ qua mục thì
   lại cần nút ngay trên đầu, chưa đọc gì đã đi.
   Mỗi nút có title và aria-label để rê chuột biết là gì, và trình đọc màn
   hình vẫn đọc được — biểu tượng trần thì không ai đoán ra. */
function nhomNutMuc(so, muc, daXong) {
  const tab = Object.keys(MUC).find(t => MUC[t] === muc) || S.tab;
  const truoc = mucKe(so, tab, -1);
  const sau = mucKe(so, tab, +1);
  const nut = (m, ic, nhan) => m
    ? `<button class="nut-dh" title="${esc(nhan)}" aria-label="${esc(nhan)}"
         onclick="moMuc(${m.so},'${m.tab}')">${ic}</button>`
    : `<button class="nut-dh" disabled aria-hidden="true">${ic}</button>`;
  /* Nút lên lớp cha. Ba nút kia đi NGANG trong chuỗi mục; không có nút này thì
     muốn quay ra danh sách mục của unit phải mò sang menu trái, mà trên điện
     thoại menu trái đang thu gọn. */
  return `<div class="nhom-nut-muc">
      <button class="nut-dh" title="Về Unit ${so}" aria-label="Về Unit ${so}"
        onclick="moUnit(${so})">\u2191</button>
      ${nut(truoc, "\u2190", truoc
        ? `Mục trước: unit ${truoc.so} — ${TEN_MUC[truoc.tab]}` : "")}
      <button class="nut-xong ${daXong ? "da-xong" : ""}"
        title="${daXong ? "Đã hoàn thành — bấm để bỏ đánh dấu" : "Đánh dấu hoàn thành"}"
        aria-label="${daXong ? "Đã hoàn thành" : "Đánh dấu hoàn thành"}"
        aria-pressed="${daXong}"
        onclick="${muc === "truyen" ? `batTatMoiTruyen(${so})` : `batTatXong(${so},'${muc}')`}">\u2713</button>
      ${nut(sau, "\u2192", sau
        ? `Mục sau: unit ${sau.so} — ${TEN_MUC[sau.tab]}` : "")}
    </div>`;
}

const nutXong = (so, muc, daXong) => nhomNutMuc(so, muc, daXong);

/* ================= khung ================= */
async function doiUnit(so) {
  S.unit = so;
  localStorage.setItem("unit", so);
  S.duLieuUnit = await (await fetch(`/api/unit/${so}`)).json();
  veBaiHoc(S.duLieuUnit);
  veBaiTap(S.duLieuUnit);
  veTruyen(S.duLieuUnit);
  veHoiThoai(S.duLieuUnit);
  if (S.tab === "mau-cau") await veMauCau(so);
  if (S.tab === "de-thi") await veDeThi(so);
  if (MUC[S.tab]) gan_dau_chi_tiet(S.tab, so, MUC[S.tab]);
}

/* Ôn tập và Sổ lỗi không thuộc unit nào nên nằm riêng ở đầu thanh bên trái.
   Truyền vào tên một mục thuộc unit thì mở mục đó ở unit đang xem. */
function chuyenTab(ten) {
  dungPhatKhiChuyen();
  if (ten === "on-tap" || ten === "so-loi") {
    S.tab = ten;
    $$(".trang").forEach(s => s.classList.toggle("hien", s.id === ten));
    ten === "so-loi" ? veSoLoi() : veOnTap();
    veRail();
    dongRail();
    window.scrollTo({ top: 0 });
    return;
  }
  moMuc(S.unit || 1, ten);
}

function moCaiDat() {
  $("#cai-dat").classList.remove("an");
  // Bảng màu dựng bằng JS để chỉ có MỘT nơi định nghĩa màu từng level
  const o = $("#o-chu-thich-mau");
  if (o) o.innerHTML = chuThichMau();
  // dong_bo.js nạp sau app.js nên phải kiểm tra trước khi gọi
  if (typeof capNhatTrangThaiDongBo === "function") capNhatTrangThaiDongBo();
}

/* Mở lại đúng thẻ vừa xem: chỉnh tốc độ đọc rồi đóng, lát sau mở ra chỉnh
   tiếp mà rơi về thẻ Người học thì lần nào cũng mất một cú bấm. */
function chonTheCaiDat(ten) {
  $$("#cai-dat .hop-tab button").forEach(b =>
    b.classList.toggle("chon", b.dataset.cd === ten));
  $$("#cai-dat .cd-trang").forEach(s =>
    s.classList.toggle("hien", s.dataset.cd === ten));
  const ruot = $("#cai-dat .hop-ruot");
  if (ruot) ruot.scrollTop = 0;
  localStorage.setItem("theCaiDat", ten);
}

function dongCaiDat() {
  $("#cai-dat").classList.add("an");
  localStorage.setItem("giong", $("#cd-giong").value);
  localStorage.setItem("lap", $("#cd-lap").value);
  localStorage.setItem("cho", $("#cd-cho").value);
  localStorage.setItem("giayDapAn", $("#cd-giay-dap-an").value);
}

/* đếm phút học, gửi về server mỗi 60 giây */
setInterval(async () => {
  const phut = Math.round((Date.now() - S.phutBatDau) / 60000);
  if (phut < 1) return;
  S.phutBatDau = Date.now();
  const ngay = new Date().toISOString().slice(0, 10);
  await fetch("/api/tien_do", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phut_theo_ngay: { [ngay]: phut } }),
  });
  const el = $("#cd-phut"); if (el) el.textContent = (+el.textContent || 0) + phut;
}, 60000);

/* ================= quản lý hồ sơ ================= */
async function napHoSo() {
  try {
    const ds = await (await fetch("/api/ho_so")).json();
    if (Array.isArray(ds) && ds.length) HS.ds = ds;
  } catch (e) { /* bản cũ chưa có API này — cứ dùng hồ sơ mặc định */ }
  // Hồ sơ đang chọn có thể đã bị xoá ở lần dùng trước
  if (!HS.ds.some(h => h.id === HS.id)) HS.id = HS.ds[0].id;
  localStorage.setItem("ho_so", HS.id);
  veChonHoSo();
}

function veChonHoSo() {
  const sel = $("#cd-ho-so");
  if (!sel) return;
  /* Tên hồ sơ CHÍNH LÀ tên đăng nhập đồng bộ, nên không cần hiện thêm gì —
     hồ sơ nào đã bật đồng bộ thì đánh dấu bằng biểu tượng cho dễ phân biệt. */
  sel.innerHTML = HS.ds.map(h => {
    const daDongBo = !!localStorage.getItem(`dong_bo_ma__${h.id}`);
    const nhan = daDongBo ? `${h.ten} ⟳` : h.ten;
    return `<option value="${esc(h.id)}" ${h.id === HS.id ? "selected" : ""}>${esc(nhan)}</option>`;
  }).join("");
  const nut = $("#nut-cai-dat");
  if (nut) nut.title = "Cài đặt · hồ sơ: " + HS.ten();
}

/* Đổi hồ sơ là đổi toàn bộ tiến độ, sổ lỗi và lịch ôn tập. Nạp lại cả trang cho
   chắc — mọi màn hình đang mở đều đang giữ dữ liệu của hồ sơ cũ. */
function doiHoSo(id) {
  if (!id || id === HS.id) return;
  localStorage.setItem("ho_so", id);
  location.reload();
}

async function goiHoSo(body) {
  const r = await (await fetch("/api/ho_so", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })).json();
  if (r.loi) { alert(r.loi); return null; }
  if (r.ds) HS.ds = r.ds;
  veChonHoSo();
  return r;
}

async function themHoSo() {
  const ten = (prompt("Tên người học mới:") || "").trim();
  if (!ten) return;
  if (!await goiHoSo({ viec: "them", ten })) return;
  doiHoSo(HS.ds[HS.ds.length - 1].id);    // vào luôn hồ sơ vừa tạo
}

async function doiTenHoSo() {
  const ten = (prompt("Tên mới:", HS.ten()) || "").trim();
  if (!ten) return;
  await goiHoSo({ viec: "doi_ten", id: HS.id, ten });
}

async function xoaHoSo() {
  if (HS.ds.length <= 1) { alert("Phải còn ít nhất một hồ sơ."); return; }
  if (!confirm(`Xoá hồ sơ "${HS.ten()}"?\n\nToàn bộ tiến độ, sổ lỗi và lịch ôn `
    + "tập của hồ sơ này sẽ mất, không khôi phục được.")) return;
  if (await goiHoSo({ viec: "xoa", id: HS.id })) doiHoSo(HS.ds[0].id);
}

(async function khoiDong() {
  await napHoSo();
  S.cauHinh = await (await fetch("/api/cau_hinh")).json();
  S.muc_luc = await (await fetch("/api/muc_luc")).json();
  bangTuLevel = await (await fetch("/api/tu_theo_level")).json();

  // nạp lại cài đặt trình đọc đã lưu
  document.querySelector(`input[name=che-do][value="${CD.cheDo}"]`).checked = true;
  $("#co-chu").value = CD.coChu;
  $("#hien-dich").checked = CD.hienDich;
  $("#danh-dau-level").checked = CD.danhDau;
  $("#doc-thoi").checked = $("#cd-doc-tho").checked = CD.docTho;
  $$("input[name=che-do]").forEach(r => r.onchange = e => { CD.cheDo = e.target.value; veLaiTrangDoc(); });
  $("#co-chu").oninput = e => { CD.coChu = +e.target.value; $$(".cau-doc .than").forEach(x => x.style.fontSize = CD.coChu + "px"); };
  $("#hien-dich").onchange = e => { CD.hienDich = e.target.checked; veLaiTrangDoc(); };
  $("#danh-dau-level").onchange = e => { CD.danhDau = e.target.checked; veLaiTrangDoc(); };
  /* Công tắc "đọc thô" có mặt ở HAI nơi: nút Aa trên thanh phát (chỉnh nhanh
     khi đang đọc) và Cài đặt → Hiển thị (chỗ người ta đi tìm khi không thấy
     nó đâu). Cùng ghi vào CD.docTho và soi gương nhau, không thì bật ở đây
     mà ô kia vẫn tắt, nhìn như app quên mất lựa chọn. */
  const datDocTho = v => {
    CD.docTho = v;
    localStorage.setItem("docTho", v ? "1" : "0");
    $("#doc-thoi").checked = $("#cd-doc-tho").checked = v;
    veLaiTrangDoc();
    if (S.tab === "mau-cau") hienCauHienTai();
  };
  $("#doc-thoi").onchange = e => datDocTho(e.target.checked);
  $("#cd-doc-tho").onchange = e => datDocTho(e.target.checked);

  /* chạm ra ngoài hộp là đóng — trên điện thoại nút "Xong" nằm dưới đáy,
     phải cuộn cả bảng mới bấm được */
  $("#cd-doc").onclick = e => { if (e.target.id === "cd-doc") dongCaiDatDoc(); };
  $("#cai-dat").onclick = e => { if (e.target.id === "cai-dat") dongCaiDat(); };
  document.addEventListener("keydown", e => {
    if (e.key !== "Escape") return;
    if (!$("#cd-doc").classList.contains("an")) return dongCaiDatDoc();
    if (!$("#cai-dat").classList.contains("an")) return dongCaiDat();
    if (!$("#tra-tu").classList.contains("an")) return dongTraTu();
    if ($("#rail").classList.contains("mo")) dongRail();
  });
  document.addEventListener("click", e => {
    const the = $("#tra-tu");
    if (the.classList.contains("an")) return;
    if (!the.contains(e.target) && !e.target.classList.contains("w")) dongTraTu();
  });

  const mc = S.cauHinh.mau_cau || {};
  $("#cd-lap").value = localStorage.getItem("lap") || mc.so_lan_lap_mac_dinh || 2;
  $("#cd-cho").value = localStorage.getItem("cho") || mc.giay_cho_giua_cac_cau || 3;
  $("#cd-giay-dap-an").value = giayDapAn();

  // audio tạo sẵn bằng edge-tts, nếu đã chạy tao_audio.py
  if (S.cauHinh.co_audio_san) {
    banDoAudio = await (await fetch("/api/ban_do_audio")).json();
    S.dungAudioSan = localStorage.getItem("audioSan") !== "0";
    $("#hang-audio-san").style.display = "";
    $("#cd-audio-san").checked = S.dungAudioSan;
    $("#mo-audio").textContent = `${S.cauHinh.so_file_audio} câu đã tạo · giọng ${banDoAudio.giong}`;
    $("#cd-audio-san").onchange = e => {
      S.dungAudioSan = e.target.checked;
      localStorage.setItem("audioSan", e.target.checked ? "1" : "0");
      doc("Hello, this is the voice you will hear from now on.");
    };
  }

  napGiong();
  $("#cd-giong").onchange = e => { S.giong = dsGiong.find(v => v.name === e.target.value); doc("Hello, this is your new voice."); };
  const oTach = $("#cd-doc-tach");
  if (oTach) {
    oTach.checked = docTachBat();
    oTach.onchange = e => {
      localStorage.setItem("docTach", e.target.checked ? "1" : "0");
      if (e.target.checked) napMocTu();
    };
  }
  $("#cd-toc-do").oninput = e => datTocDo(e.target.value);
  datTocDo(S.tocDo);   // đồng bộ nhãn + nút ngay khi mở app
  $$("#cai-dat .hop-tab button").forEach(b =>
    b.onclick = () => chonTheCaiDat(b.dataset.cd));
  chonTheCaiDat(localStorage.getItem("theCaiDat") || "nguoi-hoc");
  doCaoHeader();
  addEventListener("resize", doCaoHeader);
  $("#hien-pa").onchange = $("#hien-nghia").onchange = () => doiUnit(S.unit);
  $("#tu-doc").onchange = e => { if (e.target.checked) alert("Đang bật: chạm vào câu bất kỳ sẽ tự đọc."); };

  /* Giữ phát khi chuyển màn hình. Tắt đi thì ẩn bar ngay, không để bar treo
     lại trên màn hình sau khi đã tắt tính năng. */
  const oGiu = $("#cd-giu-phat");
  if (oGiu) {
    oGiu.checked = CD.giuPhat;
    oGiu.onchange = e => {
      CD.giuPhat = e.target.checked;
      localStorage.setItem("giuPhat", CD.giuPhat ? "1" : "0");
      if (!CD.giuPhat) dungMauCau_();
      veBarPhat();
    };
  }

  const td = await (await fetch("/api/tien_do")).json();
  S.tienDo = td.tien_do || { unit: {}, phut_theo_ngay: {} };
  S.tienDo.unit ||= {};
  S.tienDo.nghe ||= {};
  await diTruSoCauDaNghe();

  const luu = +localStorage.getItem("unit") || 1;
  S.unit = luu;
  S.tab = "bai-hoc";
  napKhoi();                   // khoi nao dang gap trong man hoc
  napRail(luu);                // khôi phục chỗ đang mở ở cột trái
  await doiUnit(luu);
  veMenu();                    // mở ở màn tổng quan khoá học

  /* Hồ sơ nào đã bật đồng bộ thì kéo dữ liệu về ngay lúc mở app — không thì
     học một lúc rồi mới bấm đồng bộ, phần vừa học trên máy kia hiện muộn. */
  if (typeof dongBoNgay === "function" && DB?.ma()) dongBoNgay({ im: true });
})();
