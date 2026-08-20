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
       "/audio/..." là trỏ về gốc tên miền và hỏng. */
    const a = new Audio(`audio/${ten}`);
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
const DOI_TEN_DOC = {
  Hoa: "Hwah", Linh: "Ling", Minh: "Ming", Chi: "Chee", Thao: "Tao",
  Huong: "Hoong", Ngoc: "Ngock", Phuong: "Foong", Tuan: "Twan", Nga: "Ngah",
  Quang: "Kwang", Trang: "Chang", Yen: "Yenn", Hanh: "Hahn", Duc: "Dook",
  Loan: "Lwan", Nhung: "Nyoong", Oanh: "Wahn", Xuan: "Swan", Vinh: "Ving",
};
const chuanGiongDoc = t =>
  String(t).replace(/\b[A-Z][a-z]{1,6}\b/g, w => DOI_TEN_DOC[w] || w);

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

function khoiCau(en, pa, nghia, { lon = false } = {}) {
  const hienPa = $("#hien-pa")?.checked;
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

/* ================= 1 · BÀI HỌC ================= */
function veBaiHoc(u) {
  const el = $("#bai-hoc");
  let h = `<h2>Unit ${u.so} — ${esc(u.ten)}</h2>
    <div class="mo">${esc(u.ten_level)} · ${u.tu_vung.length} từ · ${u.mau_cau.length} mẫu câu</div>`;

  if (u.tu_vung.length) {
    h += `<h3>Từ vựng (${u.tu_vung.length})</h3>`;
    h += u.tu_vung.map(t => `<div class="the">
        <div class="hang">
          <span class="tu-anh">${esc(t.tu)}</span>${nutLoa(t.tu)}
          ${t.bien_the?.length ? `<span class="mo">(${t.bien_the.map(esc).join(" / ")})</span>` : ""}
        </div>
        ${$("#hien-pa").checked && t.ipa ? `<div class="pa">${esc(t.ipa)}${t.ipa_tu_may ? " · máy sinh" : ""}</div>` : ""}
        ${$("#hien-nghia").checked ? `<div class="nghia">${esc(t.nghia)}</div>` : ""}
        ${t.vi_du ? `<div style="margin-top:8px">${khoiCau(t.vi_du, t.vi_du_pa, "")}</div>` : ""}
      </div>`).join("");
  }

  if (u.mau_cau.length) {
    h += `<h3>Mẫu câu</h3>`;
    h += u.mau_cau.map(m => `<div class="the">
        ${khoiCau(m.cau, m.pa, m.nghia)}
        ${m.vi_du?.length ? `<div class="vi-du">
          <div class="nhan-vi-du">Câu mẫu</div>
          ${m.vi_du.map(v => `<div class="mot-vi-du">
            ${khoiCau(v.en, v.pa, v.vi)}
          </div>`).join("")}
        </div>` : ""}
      </div>`).join("");
  }

  u.bang_ngu_phap?.forEach(b => {
    if (!b.bang?.length) return;
    const cot = Object.keys(b.bang[0]);
    h += `<h3>${esc(b.ten)}</h3><div class="cuon"><table><tr>${cot.map(c => `<th>${esc(c)}</th>`).join("")}</tr>`;
    h += b.bang.map(r => `<tr>${cot.map(c => `<td>${esc(r[c])}</td>`).join("")}</tr>`).join("") + `</table></div>`;
  });

  ["phat_am", "luu_y", "meo"].forEach(k => {
    if (!u[k]) return;
    const ten = { phat_am: "Phát âm", luu_y: "Lưu ý & điểm dễ nhầm", meo: "Mẹo ghi nhớ" }[k];
    h += `<h3>${ten}</h3><div class="the">${mdSangHtml(u[k])}</div>`;
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

  el.innerHTML = `
    <div class="dai-pill" id="chon-phan"></div>
    <h2>Mẫu câu — Unit ${soUnit}</h2>
    <div class="mo">${d.so_cau} câu · đã nghe ${daNghe}/${d.so_cau}</div>
    ${d.so_cau < 50 ? `<div class="canh-bao">Giáo trình mới có ${d.so_cau} câu cho unit này.
      Mục tiêu 50–100 câu/unit cần soạn thêm — xem “Việc còn lại” trong Hướng dẫn.</div>` : ""}
    <div class="san-khau" id="san-khau"><div class="mo">Bấm Phát để bắt đầu</div></div>
    <div class="tien-trinh"><div id="thanh-tien-trinh"></div></div>
    <div class="dieu-khien">
      <button class="phu" onclick="nhayCau(-1)">← Trước</button>
      <button class="chinh" id="nut-phat" onclick="batTatPhat()">Phát</button>
      <button class="phu" onclick="nhayCau(1)">Sau →</button>
      <button class="phu" onclick="docLaiCau()">Nghe lại</button>
      <button class="phu" onclick="moCaiDat()">Cài đặt</button>
    </div>
    <h3>Danh sách câu</h3>
    <div class="ds-cau" id="ds-cau">${S.phatMauCau.danhSach.map((c, i) => `
      <div class="dong-cau" id="dc-${i}" onclick="chonCau(${i})">
        <span class="stt">${i + 1}</span>
        <span class="noi">
          <div class="en">${esc(c.en)}</div>
          ${c.vi ? `<div class="vi">${esc(c.vi)}</div>` : ""}
        </span>
      </div>`).join("")}</div>`;

  // dải chọn phần theo level, giống thanh "Sơ cấp 1 / Sơ cấp 2..."
  const level = {};
  S.muc_luc.forEach(m => (level[m.level] ||= { ten: m.ten_level, units: [] }).units.push(m.so));
  $("#chon-phan").innerHTML = Object.entries(level).map(([lv, v]) =>
    `<button class="pill ${v.units.includes(soUnit) ? "chon" : ""}"
       onclick="doiUnit(${v.units[0]})">${esc(v.ten)}</button>`).join("");

  S.phatMauCau.i = 0;
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
  const hienPa = $("#cd-pa").checked, hienNghia = $("#cd-nghia").checked;
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
  ghiSoCauDaNghe(S.unit, p.i + 1);
}

let hen = null;
function batTatPhat() {
  const p = S.phatMauCau;
  p.dang = !p.dang;
  $("#nut-phat").textContent = p.dang ? "Dừng" : "Phát";
  if (p.dang) {
    giuManHinhSang();
    chayCau();
  } else {
    clearTimeout(hen);
    speechSynthesis.cancel();
    thoiGiuManHinh();
  }
}

function chayCau() {
  const p = S.phatMauCau;
  if (!p.dang) return;
  const c = p.danhSach[p.i];
  if (!c) { batTatPhat(); return; }
  hienCauHienTai();

  const soLap = Math.max(1, +$("#cd-lap").value || 2);
  const cho = Math.max(1, +$("#cd-cho").value || 3);
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
};
let bangTuLevel = {};

function moCaiDatDoc() { $("#cd-doc").classList.remove("an"); }
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
  const tab = $("nav button.chon")?.dataset.tab;
  if (tab === "truyen") veTruyen(S.duLieuUnit);
  if (tab === "hoi-thoai") veHoiThoai(S.duLieuUnit);
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

/* phát cả bài, câu nào đang đọc thì tô sáng và tự cuộn tới */
let dungPhatBai = true;
function phatCaBai(tienTo) {
  const cac = $$(`[id^="${tienTo}"]`);
  if (!cac.length) return;
  dungPhatBai = false;
  giuManHinhSang();
  let i = 0;
  const tiep = () => {
    if (dungPhatBai || i >= cac.length) {
      $$(".cau-doc").forEach(x => x.classList.remove("dang-doc"));
      thoiGiuManHinh();
      return;
    }
    const el = cac[i++];
    $$(".cau-doc").forEach(x => x.classList.remove("dang-doc"));
    el.classList.add("dang-doc");
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    const than = el.querySelector(".than");
    doc(than.dataset.en, { vai: than.dataset.vai, xong: () => setTimeout(tiep, 450) });
  };
  tiep();
}
function dungPhat() {
  dungPhatBai = true;
  speechSynthesis.cancel();
  if (dangPhat) { dangPhat.pause(); dangPhat = null; }
  $$(".cau-doc").forEach(x => x.classList.remove("dang-doc"));
  thoiGiuManHinh();
}

const chuThichMau = () => !CD.danhDau ? "" : `<div class="chu-thich-mau">
  ${[0, 1, 2, 3, 4].map(l => `<span><i class="o-mau" style="background:${["#4ec99a", "#5aa9f0", "#b39ae8", "#e0b64a", "#f07a6d"][l]}"></i>Level ${l}</span>`).join("")}
  <span><i class="o-mau" style="background:var(--chu-nhat)"></i>chưa có trong giáo trình</span></div>`;

const thanhCongCu = (ten, tienTo) => `<div class="thanh-doc">
    <span class="ten">${esc(ten)}</span>
    <button class="nut-tron" onclick="phatCaBai('${tienTo}')" title="Phát cả bài">▶</button>
    <button class="nut-tron phu2" onclick="dungPhat()" title="Dừng">■</button>
    <button class="nut-tron phu2" onclick="moCaiDatDoc()" title="Hiển thị">Aa</button>
  </div>`;

/* ================= 4 · TRUYỆN (đoạn văn) ================= */
function veTruyen(u) {
  const el = $("#truyen");
  const ds = (u.doan_van || []).filter(d => (d.cau || []).length);
  if (!ds.length) {
    el.innerHTML = `<div class="trong">Unit ${u.so} không có đoạn văn.<br>
      <span class="mo">Đoạn văn mẫu chủ yếu nằm ở Level 3–4 (unit 31–50).</span></div>`;
    return;
  }
  let h = `<h2>Truyện — Unit ${u.so}</h2>${chuThichMau()}`;
  ds.forEach((d, di) => {
    h += thanhCongCu(d.ten, `tr-${di}-`);
    h += `<div class="the">` +
      d.cau.map((c, ci) => dongDoc(`tr-${di}-${ci}`, c.en, c.pa, c.vi || "")).join("") +
      `</div>`;
  });
  el.innerHTML = h;
}

/* ================= HỘI THOẠI ================= */
function veHoiThoai(u) {
  const el = $("#hoi-thoai");
  const ds = u.hoi_thoai || [];
  let h = `<h2>Hội thoại — Unit ${u.so}</h2>`;

  if (!ds.length) {
    h += `<div class="trong">Unit ${u.so} không có hội thoại.</div>`;
  } else {
    h += chuThichMau();
    ds.forEach((hd, di) => {
      h += thanhCongCu(hd.ten, `ht-${di}-`);
      h += `<div class="the">` +
        hd.luot.map((l, li) => dongDoc(`ht-${di}-${li}`, l.en, l.pa, l.vi, l.vai)).join("") +
        `</div>`;
    });
  }
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
const OT = { the: [], i: 0, dung: 0, sai: 0, dangCho: false, hen: null };

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
  OT.hen = null;
  OT.i++;
  veThe();
}

/* Unit đang lọc ở tab Ôn tập. 0 = trộn mọi unit đã mở (mặc định, đúng tinh
   thần lặp ngắt quãng). Chọn một unit khi vừa học xong và muốn ôn ngay unit đó. */
let onTapUnit = +(localStorage.getItem("on_tap_unit") || 0);

function doiUnitOnTap(v) {
  onTapUnit = +v || 0;
  localStorage.setItem("on_tap_unit", onTapUnit);
  veOnTap();
}

async function veOnTap() {
  const el = $("#on-tap");
  el.innerHTML = `<div class="trong">Đang nạp…</div>`;
  const d = await (await fetch(`/api/on_tap?so_luong=20&unit=${onTapUnit}`)).json();
  OT.the = d.the || []; OT.i = 0; OT.dung = 0; OT.sai = 0;
  const tk = d.thong_ke;

  if (!OT.the.length) {
    el.innerHTML = `<h2>Ôn tập</h2>
      ${veThongKeOnTap(tk)}${chonUnitOnTap(tk)}
      <div class="trong">${onTapUnit ? `Unit ${onTapUnit} không còn thẻ nào đến hạn.`
        : "Hôm nay không còn thẻ nào đến hạn."}<br>
        <span class="mo">${tk.unit_da_mo.length
        ? "Quay lại mai, hoặc mở thêm unit mới ở tab Bài học."
        : "Chưa mở unit nào. Vào tab Bài học, mở một unit rồi quay lại đây."}</span></div>`;
    return;
  }

  el.innerHTML = `<h2>Ôn tập</h2>${veThongKeOnTap(tk)}${chonUnitOnTap(tk)}
    <div class="tien-trinh"><div id="tt-on"></div></div>
    <div id="khu-the"></div>`;
  veThe();
}

function chonUnitOnTap(tk) {
  /* Chỉ liệt kê unit ĐÃ MỞ — cho chọn unit chưa học thì ôn từ chưa gặp bao
     giờ, thành học vẹt không ngữ cảnh. */
  const mo = tk.unit_da_mo || [];
  const ten = so => (S.muc_luc.find(m => m.so === so) || {}).ten || "";
  return `<label class="hang" style="gap:8px; margin-bottom:10px">
      <span class="mo">Ôn unit</span>
      <select onchange="doiUnitOnTap(this.value)" style="flex:1; min-width:0">
        <option value="0" ${!onTapUnit ? "selected" : ""}>Tất cả unit đã mở (${mo.length})</option>
        ${mo.map(so => `<option value="${so}" ${onTapUnit === so ? "selected" : ""}>Unit ${so} — ${esc(ten(so))}</option>`).join("")}
      </select>
    </label>`;
}

function veThongKeOnTap(tk) {
  return `<div class="thanh-tong">
      <div class="so-lieu">
        <span><b>${tk.den_han_hom_nay}</b> thẻ đến hạn hôm nay</span>
        <span><b>${tk.da_thuoc_du_3_the}</b> từ đã thuộc (qua đủ 3 loại thẻ)</span>
        <span><b>${tk.tu_trong_pham_vi}</b> từ trong phạm vi đã mở / ${tk.tong_tu} tổng</span>
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
  doc(t.tu);

  OT.hen = setTimeout(sangTheKeTiep, dung ? 900 : 2600);
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
      <div class="dieu-khien"><button class="chinh" onclick="veOnTap()">Ôn tiếp</button></div>
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
const DAU_TRANG_THAI = { xong: "✓", dang: "◐", chua: "" };

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
  capNhatTienDoTong();
  // xong một mục thì việc kế tiếp gần như luôn là chọn mục khác -> về danh sách
  if (moi === "xong") { veMenu(); return; }
  $$(`#${S.tab} .nut-xong`).forEach(b => {
    b.classList.remove("da-xong");
    b.textContent = "Đánh dấu hoàn thành";
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

/* ================= MÀN DANH SÁCH UNIT ================= */
function veMenu() {
  dungPhat();
  const tab = S.tab, muc = MUC[tab];
  $("#nut-quay-lai").classList.add("an");
  $("#chon-unit").classList.add("an");
  $$(".trang").forEach(s => s.classList.toggle("hien", s.id === "man-menu"));

  if (!muc) { chuyenTab("so-loi"); return; }

  const tt = capNhatTienDoTong();
  const tenTab = $(`nav button[data-tab="${tab}"]`).textContent;

  let h = `<h2>${esc(tenTab)}</h2>
    <div class="thanh-tong">
      <div class="so-lieu">
        <span><b>${S.muc_luc.filter(m => trangThai(m.so, muc) === "xong").length}</b> / ${S.muc_luc.length} unit đã xong</span>
        <span><b>${S.muc_luc.filter(m => trangThai(m.so, muc) === "dang").length}</b> đang học</span>
        <span><b>${tt.unitXong}</b> unit xong toàn bộ 6 mục</span>
      </div>
      <div class="vach">
        <i class="xong" style="width:${S.muc_luc.filter(m => trangThai(m.so, muc) === "xong").length / S.muc_luc.length * 100}%"></i>
        <i class="dang" style="width:${S.muc_luc.filter(m => trangThai(m.so, muc) === "dang").length / S.muc_luc.length * 100}%"></i>
      </div>
    </div>`;

  const theoLevel = {};
  S.muc_luc.forEach(m => (theoLevel[m.level] ||= { ten: m.ten_level, ds: [] }).ds.push(m));

  Object.values(theoLevel).forEach(lv => {
    const xong = lv.ds.filter(m => trangThai(m.so, muc) === "xong").length;
    h += `<div class="nhom-level"><h3>${esc(lv.ten)}</h3>
        <span class="dem">${xong}/${lv.ds.length}</span></div>
      <div class="luoi-unit">`;
    h += lv.ds.map(m => {
      const t = trangThai(m.so, muc);
      return `<button class="o-unit ${t}" onclick="moChiTiet(${m.so})">
          <span class="huy-hieu">${DAU_TRANG_THAI[t] || m.so}</span>
          <span class="noi">
            <span class="ten">${m.so}. ${esc(m.ten)}</span>
            <span class="phu-de">${phuDeTheoTab(tab, m)}</span>
          </span>
          <span class="dau">›</span>
        </button>`;
    }).join("");
    h += `</div>`;
  });

  $("#man-menu").innerHTML = h;
}

function phuDeTheoTab(tab, m) {
  if (tab === "bai-hoc") return `${m.so_tu} từ · ${m.so_mau_cau} mẫu câu`;
  if (tab === "bai-tap") return `${m.so_cau_hoi} câu hỏi`;
  if (tab === "mau-cau") return `nghe ${S.tienDo?.nghe?.[m.so] || 0} câu`;
  if (tab === "hoi-thoai") return `${m.so_hoi_thoai} lượt thoại`;
  if (tab === "truyen") return `đoạn văn mẫu`;
  if (tab === "de-thi") return `đề mini`;
  return "";
}

/* ================= MÀN CHI TIẾT ================= */
async function moChiTiet(so) {
  await doiUnit(so);
  const tab = S.tab, muc = MUC[tab];
  await chamDang(so, muc);
  $("#nut-quay-lai").classList.remove("an");
  $("#chon-unit").classList.remove("an");
  $$(".trang").forEach(s => s.classList.toggle("hien", s.id === tab));
  gan_dau_chi_tiet(tab, so, muc);
}

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
  const sel = $("#chon-unit"); if (sel) sel.value = so;
  if (S.tab === "mau-cau") await veMauCau(so);
  if (S.tab === "de-thi") await veDeThi(so);
  if (MUC[S.tab]) gan_dau_chi_tiet(S.tab, so, MUC[S.tab]);
}

function chuyenTab(ten) {
  dungPhat();
  S.tab = ten;
  $$("nav button").forEach(b => b.classList.toggle("chon", b.dataset.tab === ten));
  /* nav rộng hơn màn hình điện thoại nên tab vừa chọn có thể nằm ngoài tầm
     nhìn — không kéo nó vào thì nhìn như bấm tab này ra nội dung tab khác */
  keoTabVaoTamNhin(ten);
  if (ten === "so-loi" || ten === "on-tap") {
    $("#nut-quay-lai").classList.add("an");
    $("#chon-unit").classList.add("an");
    $$(".trang").forEach(s => s.classList.toggle("hien", s.id === ten));
    ten === "so-loi" ? veSoLoi() : veOnTap();
    return;
  }
  veMenu();          // mọi tab đều mở ở màn danh sách trước
}

/* Cuộn thanh tab sao cho tab đang chọn nằm giữa khung. scrollIntoView không
   dùng được ở đây: thanh tab nằm trong khối sticky nên trình duyệt cuộn cả
   trang theo chiều dọc thay vì cuộn ngang đúng thanh tab. */
function keoTabVaoTamNhin(ten) {
  const nav = $("nav"), nut = $(`nav button[data-tab="${ten}"]`);
  if (!nav || !nut) return;
  const giua = nut.offsetLeft + nut.offsetWidth / 2 - nav.clientWidth / 2;
  nav.scrollTo({ left: Math.max(0, giua), behavior: "smooth" });
}

function moCaiDat() {
  $("#cai-dat").classList.remove("an");
  // dong_bo.js nạp sau app.js nên phải kiểm tra trước khi gọi
  if (typeof capNhatTrangThaiDongBo === "function") capNhatTrangThaiDongBo();
}
function dongCaiDat() {
  $("#cai-dat").classList.add("an");
  localStorage.setItem("giong", $("#cd-giong").value);
  localStorage.setItem("lap", $("#cd-lap").value);
  localStorage.setItem("cho", $("#cd-cho").value);
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
  $("#cd-doc").onclick = e => { if (e.target.id === "cd-doc") dongCaiDatDoc(); };

  const sel = $("#chon-unit");
  let levelHienTai = -1;
  sel.innerHTML = S.muc_luc.map(m => {
    let h = "";
    if (m.level !== levelHienTai) { levelHienTai = m.level; h += `<optgroup label="${esc(m.ten_level)}">`; }
    return h + `<option value="${m.so}">Unit ${m.so} — ${esc(m.ten)}</option>`;
  }).join("");

  const mc = S.cauHinh.mau_cau || {};
  $("#cd-lap").value = localStorage.getItem("lap") || mc.so_lan_lap_mac_dinh || 2;
  $("#cd-cho").value = localStorage.getItem("cho") || mc.giay_cho_giua_cac_cau || 3;

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
  $("#nut-cai-dat").onclick = moCaiDat;
  $$("nav button").forEach(b => b.onclick = () => chuyenTab(b.dataset.tab));
  sel.onchange = e => moChiTiet(+e.target.value);
  $("#hien-pa").onchange = $("#hien-nghia").onchange = () => doiUnit(S.unit);
  $("#tu-doc").onchange = e => { if (e.target.checked) alert("Đang bật: chạm vào câu bất kỳ sẽ tự đọc."); };

  const td = await (await fetch("/api/tien_do")).json();
  S.tienDo = td.tien_do || { unit: {}, phut_theo_ngay: {} };
  S.tienDo.unit ||= {};
  S.tienDo.nghe ||= {};
  await diTruSoCauDaNghe();

  const luu = +localStorage.getItem("unit") || 1;
  sel.value = luu;
  S.unit = luu;
  S.tab = "bai-hoc";
  await doiUnit(luu);
  veMenu();                 // mở ở màn danh sách unit

  /* Hồ sơ nào đã bật đồng bộ thì kéo dữ liệu về ngay lúc mở app — không thì
     học một lúc rồi mới bấm đồng bộ, phần vừa học trên máy kia hiện muộn. */
  if (typeof dongBoNgay === "function" && DB?.ma()) dongBoNgay({ im: true });
})();
