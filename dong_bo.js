/* ================= ĐỒNG BỘ TIẾN ĐỘ GIỮA CÁC THIẾT BỊ =================

   Nơi lưu chung là một Cloudflare Worker (mã nguồn ở nguon/dong_bo/worker.js).
   Người học gõ TÊN + MẬT KHẨU, máy tự băm thành khoá kho ngay tại chỗ; gõ cùng
   cặp đó ở thiết bị khác là hai máy dùng chung dữ liệu. Tên và mật khẩu không
   bao giờ rời khỏi máy, Worker chỉ thấy chuỗi băm. Tên đăng nhập cũng chính là
   tên hồ sơ hiện trên màn hình.

   LUẬT GỘP là phần quan trọng nhất ở đây. Không được "ai ghi sau thì thắng"
   cho cả gói: học unit 5 trên điện thoại, unit 9 trên máy tính, đè nhau là mất
   một bên. Nên gộp theo từng mục nhỏ:

     - trạng thái mỗi mục của unit : lấy mức CAO HƠN (chưa < đang < xong)
     - phút học theo ngày          : lấy số LỚN HƠN, không cộng
     - sổ lỗi                      : hợp nhất, khử trùng theo dấu vết từng lỗi
     - thẻ ôn tập                  : bậc cao hơn thắng; bằng bậc thì ngày ôn xa hơn

   Vì sao phút học lấy max chứ không cộng: cả hai bên đều đã cộng dồn sẵn trong
   số của mình. Cộng lần nữa thì mỗi lần đồng bộ lại nhân đôi thời gian học.
*/

const DB = {
  url: () => (S.cauHinh?.dong_bo?.url || "").replace(/\/+$/, ""),
  ma: () => localStorage.getItem(DB.khoaMa()) || "",
  khoaMa: () => `dong_bo_ma__${HS.id}`,
  khoaLuc: () => `dong_bo_luc__${HS.id}`,
  dangChay: false,
};


/* Chuẩn hoá tên để hai máy gõ hơi khác nhau vẫn ra cùng khoá:
   "Sao Chi", "sao chi", "SAO  CHI" -> "sao chi". Dấu tiếng Việt giữ nguyên,
   chỉ gộp khoảng trắng và bỏ phân biệt hoa thường. */
const chuanTen = t => (t || "").trim().toLowerCase().replace(/\s+/g, " ");

/* Đổi tên + mật khẩu thành mã đồng bộ, TÍNH NGAY TRONG MÁY.

   Vì sao không làm đăng nhập thật: làm vậy phải lưu mật khẩu ở đâu đó và tự
   nhận trách nhiệm giữ nó — quá nặng cho một app học tiếng Anh, mà làm ẩu thì
   nguy hiểm hơn là không làm. Ở đây tên và mật khẩu KHÔNG BAO GIỜ rời khỏi
   máy: chỉ chuỗi băm được gửi đi, và chuỗi đó chính là khoá kho.

   Dùng PBKDF2 600.000 vòng (mức OWASP khuyến nghị cho SHA-256) chứ không băm
   một phát: nếu ai đó lấy được kho dữ liệu, họ vẫn phải dò từng mật khẩu với
   chi phí cao, thay vì thử cả từ điển trong vài giây.

   Mức bảo vệ ở đây cố tình để nhẹ: người dùng là một người tự học, dữ liệu chỉ
   là số unit đã xong, không chia cho ai và không đáng để ai dò. Đổi lại là gõ
   nhanh, nhớ dễ. Nếu sau này dùng cho nhiều người hoặc cho dữ liệu khác thì
   phải siết lại — lúc đó tên người là danh tính quá dễ đoán.

   Đánh đổi phải biết: quên mật khẩu là KHÔNG LẤY LẠI ĐƯỢC dữ liệu trên mạng,
   vì không có ai giữ bản sao để đặt lại — mã chính là mật khẩu đã băm. */
async function maTuTenMatKhau(ten, matKhau) {
  const goc = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(matKhau), "PBKDF2", false, ["deriveBits"]);
  const bit = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: new TextEncoder().encode("hoc-tieng-anh|" + chuanTen(ten)),
      iterations: 600000, hash: "SHA-256" },
    goc, 256);
  return [...new Uint8Array(bit)].map(b => b.toString(16).padStart(2, "0"))
    .join("").slice(0, 32);
}

const MUC_TRANG_THAI = { chua: 0, dang: 1, xong: 2 };

function gopTienDo(a, b) {
  const ra = { unit: {}, phut_theo_ngay: {}, nghe: {} };
  for (const nguon of [a, b]) {
    for (const [so, cac] of Object.entries(nguon?.unit || {})) {
      ra.unit[so] = ra.unit[so] || {};
      for (const [muc, tt] of Object.entries(cac || {})) {
        const cu = ra.unit[so][muc];
        if (!cu || (MUC_TRANG_THAI[tt] ?? 0) > (MUC_TRANG_THAI[cu] ?? 0)) {
          ra.unit[so][muc] = tt;
        }
      }
    }
    for (const [ngay, phut] of Object.entries(nguon?.phut_theo_ngay || {})) {
      ra.phut_theo_ngay[ngay] = Math.max(ra.phut_theo_ngay[ngay] || 0, phut || 0);
    }
    // Số câu đã nghe ở tab Mẫu câu: nghe nhiều hơn thì thắng
    for (const [u, n] of Object.entries(nguon?.nghe || {})) {
      ra.nghe[u] = Math.max(ra.nghe[u] || 0, +n || 0);
    }
  }
  return ra;
}

// Dấu vết một lỗi: cùng unit, cùng đề, cùng câu trả lời sai, cùng thời điểm
const dauVetLoi = l => [l.unit, l.de, l.cua_toi, l.thoi_diem].join("");

function gopSoLoi(a, b) {
  const thay = new Map();
  for (const l of [...(a?.loi || []), ...(b?.loi || [])]) thay.set(dauVetLoi(l), l);
  return { loi: [...thay.values()] };
}

function gopOnTap(a, b) {
  const ra = { the: { ...(a?.the || {}) } };
  for (const [khoa, t] of Object.entries(b?.the || {})) {
    const cu = ra.the[khoa];
    if (!cu) { ra.the[khoa] = t; continue; }
    // Bậc cao hơn nghĩa là đã ôn nhiều lần hơn -> giữ bậc đó, đừng kéo lùi
    if ((t.lan || 0) > (cu.lan || 0) ||
        ((t.lan || 0) === (cu.lan || 0) && (t.ngay_tiep || "") > (cu.ngay_tiep || ""))) {
      ra.the[khoa] = t;
    }
  }
  return ra;
}

const gopGoi = (a, b) => ({
  tien_do: gopTienDo(a?.tien_do, b?.tien_do),
  so_loi: gopSoLoi(a?.so_loi, b?.so_loi),
  on_tap: gopOnTap(a?.on_tap, b?.on_tap),
});

async function dongBoNgay({ im = false } = {}) {
  const url = DB.url(), ma = DB.ma();
  if (!url) { if (!im) alert("Chưa khai báo địa chỉ đồng bộ trong cau_hinh.json."); return; }
  if (!ma) { if (!im) alert("Hồ sơ này chưa bật đồng bộ. Bấm \"Bật đồng bộ\" trước."); return; }
  if (DB.dangChay) return;
  DB.dangChay = true;
  capNhatTrangThaiDongBo("Đang đồng bộ…");

  try {
    const tai_cho = await (await fetch("/api/xuat")).json();

    let tren_mang = null;
    try {
      const r = await fetchGoc(`${url}/tien_do/${encodeURIComponent(ma)}`);
      if (r.ok) tren_mang = await r.json();
    } catch (e) { /* mất mạng — vẫn ghi được lên sau */ }
    if (tren_mang?.trong) tren_mang = null;

    const gop = gopGoi(tai_cho, tren_mang);

    // Ghi về máy trước: kể cả bước đẩy lên mạng hỏng thì máy này cũng đã có
    // đủ dữ liệu của cả hai bên.
    await fetch("/api/nhap", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(gop),
    });

    const r2 = await fetchGoc(`${url}/tien_do/${encodeURIComponent(ma)}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(gop),
    });
    if (!r2.ok) throw new Error(`máy chủ trả ${r2.status}`);

    localStorage.setItem(DB.khoaLuc(), new Date().toISOString());
    capNhatTrangThaiDongBo();
    if (!im) {
      const n = Object.keys(gop.tien_do.unit).length;
      alert(`Đồng bộ xong.\n${n} unit có tiến độ · ${gop.so_loi.loi.length} lỗi · `
        + `${Object.keys(gop.on_tap.the).length} thẻ ôn tập.`);
      location.reload();          // màn hình đang mở vẫn giữ dữ liệu cũ
    }
  } catch (e) {
    capNhatTrangThaiDongBo("Đồng bộ lỗi: " + e.message);
    if (!im) alert("Không đồng bộ được: " + e.message);
  } finally {
    DB.dangChay = false;
  }
}

function capNhatTrangThaiDongBo(chu) {
  const el = $("#db-trang-thai");
  if (!el) return;
  if (chu) { el.textContent = chu; return; }
  const ma = DB.ma();
  if (!ma) { el.textContent = "Chưa bật cho hồ sơ này."; return; }
  const luc = localStorage.getItem(DB.khoaLuc());
  el.textContent = `Đang đồng bộ với tên "${HS.ten()}". `
    + (luc ? "Lần gần nhất: " + new Date(luc).toLocaleString("vi-VN")
           : "Chưa đồng bộ lần nào.");
}

/* Bật đồng bộ bằng TÊN + MẬT KHẨU. Gõ cùng cặp đó ở máy khác là hai máy gặp
   nhau — không cần email, không cần tạo tài khoản ở đâu cả.

   Tên ở đây vừa là danh tính đăng nhập, vừa là tên hồ sơ hiện trên màn hình:
   đăng nhập xong hồ sơ tự đổi tên theo, khỏi phải đặt tên hai lần. */
async function batDongBo() {
  const ten = (prompt("Tên của bạn (dùng để đăng nhập và đặt tên hồ sơ):",
    HS.ten()) || "").trim();
  if (!ten) return;
  if (ten.length < 2) { alert("Tên quá ngắn."); return; }

  /* Bắt xác nhận lại tên trước khi làm gì tiếp. Sai một ký tự là ra khoá hoàn
     toàn khác, mà app lại đồng bộ ngay sau khi đăng nhập — nghĩa là tiến độ bị
     đẩy lên một khoá rác, còn bạn thì ngồi chờ dữ liệu không bao giờ về. */
  if (!confirm(`Tên dùng để đồng bộ:\n\n${ten}\n\nĐúng chưa? Sai một ký tự là ra `
    + "khoá khác, hai thiết bị sẽ không gặp được nhau.\n\n"
    + "(Viết hoa hay thường đều được, app tự bỏ qua.)")) return;

  const mk = prompt("Mật khẩu đồng bộ.\n\nQuên mật khẩu này là KHÔNG lấy lại "
    + "được dữ liệu trên mạng, nên chọn cái bạn chắc chắn nhớ.") || "";
  if (mk.length < 4) { alert("Mật khẩu cần ít nhất 4 ký tự."); return; }

  capNhatTrangThaiDongBo("Đang tạo khoá…");
  const ma = await maTuTenMatKhau(ten, mk);

  if (DB.ma() && DB.ma() !== ma && !confirm(
    "Hồ sơ này đang đồng bộ bằng khoá khác. Đổi sang cặp tên/mật khẩu mới sẽ "
    + "TÁCH khỏi các thiết bị đang dùng khoá cũ. Tiếp tục?")) {
    capNhatTrangThaiDongBo();
    return;
  }

  // Mật khẩu KHÔNG lưu ở đâu hết, chỉ giữ khoá đã băm.
  localStorage.setItem(DB.khoaMa(), ma);
  localStorage.removeItem(DB.khoaLuc());

  // Tên đăng nhập chính là tên hồ sơ — khỏi phải đặt tên hai lần
  if (HS.ten() !== ten) await goiHoSo({ viec: "doi_ten", id: HS.id, ten });

  capNhatTrangThaiDongBo();
  dongBoNgay();
}



/* Xoá sạch dữ liệu của khoá hiện tại trên mạng.

   Dùng khi lỡ gõ nhầm tên: app đã kịp đẩy tiến độ lên một khoá rác, và khoá
   đó thì không ai dọn hộ. Xoá xong tắt luôn đồng bộ, vì giữ lại một khoá rỗng
   chỉ tổ tưởng là còn dùng được. */
async function xoaDuLieuTrenMang() {
  const url = DB.url(), ma = DB.ma();
  if (!url || !ma) { alert("Hồ sơ này chưa bật đồng bộ."); return; }

  if (!confirm(`XOÁ dữ liệu trên mạng của tên "${HS.ten()}"`
    + "\n\nTiến độ trên MÁY NÀY vẫn giữ nguyên, chỉ xoá bản trên mạng.\n\n"
    + "Nhưng nếu thiết bị khác đang dùng chung khoá này, lần đồng bộ tới của "
    + "họ sẽ đẩy dữ liệu lên lại. Tiếp tục?")) return;

  // Hỏi lần hai: đây là thao tác không hoàn tác được
  if (!confirm("Chắc chắn xoá? Không khôi phục lại được.")) return;

  capNhatTrangThaiDongBo("Đang xoá…");
  try {
    const r = await fetchGoc(`${url}/tien_do/${encodeURIComponent(ma)}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    if (!r.ok) throw new Error(`máy chủ trả ${r.status}`);
    localStorage.removeItem(DB.khoaMa());
    localStorage.removeItem(DB.khoaLuc());
    capNhatTrangThaiDongBo();
    veChonHoSo();
    alert("Đã xoá dữ liệu trên mạng và tắt đồng bộ cho hồ sơ này.\n\n"
      + "Tiến độ trên máy này còn nguyên.");
  } catch (e) {
    capNhatTrangThaiDongBo("Xoá lỗi: " + e.message);
    alert("Không xoá được: " + e.message);
  }
}

function tatDongBo() {
  if (!confirm("Tắt đồng bộ cho hồ sơ này? Dữ liệu trên máy giữ nguyên, chỉ "
    + "không gửi lên mạng nữa.")) return;
  localStorage.removeItem(DB.khoaMa());
  localStorage.removeItem(DB.khoaLuc());
  capNhatTrangThaiDongBo();
  veChonHoSo();
}
