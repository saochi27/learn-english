/* App học tiếng Anh — logic giao diện.
   Âm thanh dùng Web Speech API (giọng en-GB có sẵn trong Windows) nên chạy được ngay,
   không phải chờ tạo hàng nghìn file mp3. Nếu đã chạy tao_audio.py thì app tự
   dùng file mp3 chất lượng cao hơn. */

const S = {
  unit: null, tab: "bai-hoc", muc_luc: [], cauHinh: {}, duLieuUnit: null,
  tienDo: { unit: {}, phut_theo_ngay: {} },
  giong: null, tocDo: 0.9,
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
  ds: [{ id: "mac_dinh", ten: "Người học" }],
  ten: () => (HS.ds.find(h => h.id === HS.id) || {}).ten || "Người học",
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
    a.playbackRate = tocDo ?? 1;
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
};
const DOI_TEN_DOC = {
  Hoa: "Hwah", Linh: "Ling", Minh: "Ming", Chi: "Chee", Thao: "Tao",
  Huong: "Hoong", Ngoc: "Ngock", Phuong: "Foong", Tuan: "Twan", Nga: "Ngah",
  Quang: "Kwang", Trang: "Chang", Yen: "Yenn", Hanh: "Hahn", Duc: "Dook",
  Loan: "Lwan", Nhung: "Nyoong", Oanh: "Wahn", Xuan: "Swan", Vinh: "Ving",
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
  $("#tra-tu-noi-dung").innerHTML = `
    <div class="hang"><span class="tu-anh">${esc(d.tu)}</span> ${nutLoa(d.tu)}</div>
    ${d.ipa ? `<div class="pa">${esc(d.ipa)}</div>` : ""}
    ${d.nghia ? `<div class="nghia">${esc(d.nghia)}</div>` : ""}
    ${d.vi_du ? `<div class="mo" style="margin-top:6px">Ví dụ: ${esc(d.vi_du)}</div>` : ""}
    ${d._ghi_chu ? `<div class="mo" style="margin-top:6px">${esc(d._ghi_chu)}</div>` : ""}
    ${d.nguon_ipa === "cmu" ? `<div class="mo">Phiên âm do máy sinh — có thể sai, đối chiếu lại nếu quan trọng.</div>` : ""}`;
  $("#tra-tu").classList.remove("an");
  doc(d.tu);
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
  const nut = $("#bai-tap .nut-xong");
  if (nut && kq.dat) { nut.classList.add("da-xong"); nut.textContent = "✓ Đã hoàn thành"; }
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
    ${hienPa && c.pa?.tho_noi ? `<div class="tho">${esc(c.pa.tho_noi)}</div>` : ""}
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
  const mot = () => {
    if (!p.dang) return;
    lan++;
    doc(c.en, {
      xoay: p.i,                 // mỗi câu một giọng, xoay vòng cho đỡ nhàm
      xong: () => {
        if (!p.dang) return;
        if (lan < soLap) hen = setTimeout(mot, 700);
        else hen = setTimeout(() => { p.i = (p.i + 1) % p.danhSach.length; chayCau(); }, cho * 1000);
      }
    });
  };
  mot();
}

function nhayCau(d) {
  const p = S.phatMauCau;
  clearTimeout(hen); speechSynthesis.cancel();
  p.i = (p.i + d + p.danhSach.length) % p.danhSach.length;
  hienCauHienTai();
  if (p.dang) chayCau();
}
const docLaiCau = () => doc(S.phatMauCau.danhSach[S.phatMauCau.i]?.en);

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
    h += khoi(`mini/hoi-dap-${di}`, "Nghe và trả lời", `
      <div class="mo" style="margin:10px 0">Trả lời THÀNH TIẾNG ngay khi nghe
        xong câu hỏi, đừng dịch trong đầu. Câu hỏi cố tình dễ — chỗ khó là trả
        lời cho kịp.</div>
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
          </span>
          <button class="loa" onclick="docCapHoiDap(${di},${i})" title="Nghe câu hỏi rồi đáp án">🔊</button>
        </div>`).join("") + `</div>`, `${ms.hoi_dap.length} câu`);
  }

  if (ms.dat_cau_hoi?.length) {
    h += khoi(`mini/dat-hoi-${di}`, "Đặt câu hỏi cho đáp án", `
      <div class="mo" style="margin:10px 0">Cho sẵn câu trả lời, bạn viết câu
        hỏi. Phần này KHÔNG có trong Effortless English — Hoge chỉ cho trả lời.
        Thêm vào vì nghe hiểu tốt mà không tự bật ra câu hỏi được là chuyện rất
        hay gặp.</div>` + ms.dat_cau_hoi.map((d, i) => `
        <div class="mot-dat" id="dat-${di}-${i}">
          <div class="dap-cho-san">${esc(d.dap_an)}</div>
          <div class="hang">
            <input type="text" placeholder="Câu hỏi tiếng Anh…" id="ip-dat-${di}-${i}"
              onkeydown="if(event.key==='Enter')kiemDatHoi(${di},${i})">
            <button class="phu" onclick="kiemDatHoi(${di},${i})">Kiểm tra</button>
          </div>
          <div class="kq-dat" id="kq-dat-${di}-${i}"></div>
        </div>`).join(""), `${ms.dat_cau_hoi.length} câu`);
  }
  return h;
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
  const dung = nhan.includes(cuaToi);
  o.innerHTML = dung
    ? `<span class="dung">✓ Đúng.</span>`
    : `<span class="sai">✗ Chưa khớp.</span> <span class="mo">Đáp án mẫu:</span>
       <b>${esc(d.cau_hoi)}</b>${nutLoa(d.cau_hoi)}`;
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
    <h2>Đề thi — Unit ${soUnit}</h2>
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
    ["tat_ca", "Tất cả 50 unit"],
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
  $$(`#${S.tab} .nut-xong`).forEach(b => {
    b.classList.toggle("da-xong", daXong);
    b.textContent = daXong ? "✓ Đã hoàn thành" : "Đánh dấu hoàn thành";
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
    don("\u25a4", "Tổng quan", "tong-quan", "veMenu()") +
    don("\u0250", "Phát âm", "ipa", "moIPA()") +
    don("\u25f7", "Ôn tập hôm nay", "on-tap", "chuyenTab('on-tap')") +
    don("\u270e", "Sổ lỗi", "so-loi", "chuyenTab('so-loi')"));

  /* --- 2. Bài học: level -> unit -> mục --- */
  const theoLevel = {};
  S.muc_luc.forEach(m => (theoLevel[m.level] ||= { ten: m.ten_level, ds: [] }).ds.push(m));
  let hLevel = "";
  Object.entries(theoLevel).forEach(([so_lv, lv]) => {
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
    don("\u263a", "Người học", "", "moCaiDat();chonTheCaiDat('nguoi-hoc')",
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

  let h = `<div class="the-mo-dau">
      <h2>Học tiếng Anh — IELTS</h2>
      <div class="mo">50 unit · level 0 → 4 · tương đương A0 → B2</div>
      <div class="thanh-tong">
        <div class="so-lieu">
          <span><b>${pt}%</b> hoàn thành</span>
          <span><b>${tt.xong}</b> / ${tt.tong} mục đã xong</span>
          <span><b>${tt.dang}</b> đang học</span>
          <span><b>${tt.unitXong}</b> / ${S.muc_luc.length} unit xong trọn vẹn</span>
        </div>
        <div class="vach">
          <i class="xong" style="width:${pt}%"></i>
          <i class="dang" style="width:${Math.round(tt.dang / tt.tong * 100)}%"></i>
        </div>
      </div>
      ${tiep ? `<button class="chinh to" onclick="moMuc(${tiep.so},'${tiep.tab}')">
          ${tiep.tt === "dang" ? "Học tiếp" : "Bắt đầu"}: Unit ${tiep.so} — ${esc(tiep.ten)}
          <span class="nho-hon">${TEN_MUC[tiep.tab]}</span></button>`
        : `<div class="the" style="margin-top:12px">Xong toàn bộ 50 unit. Giờ là lúc
             quay lại tab Ôn tập và các đề thi.</div>`}
    </div>`;

  const theoLevel = {};
  S.muc_luc.forEach(m => (theoLevel[m.level] ||= { ten: m.ten_level, ds: [] }).ds.push(m));
  h += `<h3>Các cấp độ</h3><div class="luoi-level">`;
  h += Object.values(theoLevel).map(lv => {
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
            <button class="phu an" id="doan-a-${i}" onclick="traLoiCap(${i},'a')">Là “${esc(c.a)}”</button>
            <button class="phu an" id="doan-b-${i}" onclick="traLoiCap(${i},'b')">Là “${esc(c.b)}”</button>
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
    : `<span class="sai">✗ Là “${esc(that === "a" ? c.a : c.b)}”</span>`;
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
    <span class="tieu">Unit ${so} — ${esc(m.ten || "")}</span>
    <span class="nhan">${esc(m.ten_level || "")}</span>
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

const nutXong = (so, muc, daXong) => `<button class="nut-xong ${daXong ? "da-xong" : ""}"
    onclick="batTatXong(${so},'${muc}')">
    ${daXong ? "✓ Đã hoàn thành" : "Đánh dấu hoàn thành"}</button>`;

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
  $("#doc-thoi").checked = CD.docTho;
  $$("input[name=che-do]").forEach(r => r.onchange = e => { CD.cheDo = e.target.value; veLaiTrangDoc(); });
  $("#co-chu").oninput = e => { CD.coChu = +e.target.value; $$(".cau-doc .than").forEach(x => x.style.fontSize = CD.coChu + "px"); };
  $("#hien-dich").onchange = e => { CD.hienDich = e.target.checked; veLaiTrangDoc(); };
  $("#danh-dau-level").onchange = e => { CD.danhDau = e.target.checked; veLaiTrangDoc(); };
  $("#doc-thoi").onchange = e => { CD.docTho = e.target.checked; veLaiTrangDoc(); };

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
  $("#cd-toc-do").oninput = e => { S.tocDo = +e.target.value; $("#cd-toc-do-hien").textContent = e.target.value; };
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
