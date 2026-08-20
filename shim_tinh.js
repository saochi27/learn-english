/* Bản tĩnh cho GitHub Pages — không có server.
   Chặn fetch() và xử lý ngay trong trình duyệt:
     - dữ liệu đọc từ file JSON tĩnh (phiên âm đã tính trước lúc xuất bản)
     - tiến độ, sổ lỗi, lịch ôn tập lưu trong localStorage của thiết bị
     - chấm bài và lên lịch ôn tập chạy bằng JS (port từ server.py, on_tap.py)

   Tiến độ nằm trên TỪNG THIẾT BỊ, không đồng bộ giữa máy tính và điện thoại. */
(function () {
  /* Mỗi hồ sơ một bộ khoá localStorage riêng. K vẫn là chuỗi như cũ để 14 chỗ
     dùng nó khỏi phải sửa; chỉ tính lại đầu mỗi lời gọi API theo hồ sơ gửi kèm. */
  const HS_MD = "mac_dinh", K_DS = "tinh_ds_ho_so";
  const K = { td: "", loi: "", on: "" };
  function datHoSo(id) {
    const h = id || HS_MD;
    K.td = "tinh_tien_do__" + h;
    K.loi = "tinh_so_loi__" + h;
    K.on = "tinh_on_tap__" + h;
  }
  datHoSo(HS_MD);

  /* Bản trước chưa có hồ sơ, dữ liệu nằm ở khoá không hậu tố. Dời sang hồ sơ
     mặc định, làm một lần, không đè lên dữ liệu đã có. */
  [["tinh_tien_do", "tinh_tien_do__" + HS_MD],
   ["tinh_so_loi", "tinh_so_loi__" + HS_MD],
   ["tinh_on_tap", "tinh_on_tap__" + HS_MD]].forEach(([cu, moi]) => {
    if (localStorage.getItem(cu) !== null && localStorage.getItem(moi) === null) {
      localStorage.setItem(moi, localStorage.getItem(cu));
      localStorage.removeItem(cu);
    }
  });

  const dsHoSo = () => {
    let ds = null;
    try { ds = JSON.parse(localStorage.getItem(K_DS)); } catch (e) {}
    if (!Array.isArray(ds) || !ds.length) {
      ds = [{ id: HS_MD, ten: "Người học" }];
      localStorage.setItem(K_DS, JSON.stringify(ds));
    }
    return ds;
  };

  const slug = t => (t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/đ/g, "d").replace(/\s+/g, "_")
    .replace(/[^a-z0-9_-]/g, "").slice(0, 40) || HS_MD;

  function suaHoSo(b) {
    let ds = dsHoSo();
    if (b.viec === "them") {
      const ten = (b.ten || "").trim();
      if (!ten) return { loi: "Chưa nhập tên" };
      const id = slug(ten);
      if (ds.some(h => h.id === id)) return { loi: "Đã có hồ sơ tên này" };
      ds.push({ id, ten });
    } else if (b.viec === "doi_ten") {
      ds.forEach(h => { if (h.id === b.id && (b.ten || "").trim()) h.ten = b.ten.trim(); });
    } else if (b.viec === "xoa") {
      if (ds.length <= 1) return { loi: "Phải còn ít nhất một hồ sơ" };
      ds = ds.filter(h => h.id !== b.id);
      ["tinh_tien_do__", "tinh_so_loi__", "tinh_on_tap__"]
        .forEach(k => localStorage.removeItem(k + b.id));
    } else {
      return { loi: "Việc không hợp lệ" };
    }
    localStorage.setItem(K_DS, JSON.stringify(ds));
    return { ok: true, ds };
  }
  const doc = (k, md) => { try { return JSON.parse(localStorage.getItem(k)) ?? md; } catch (e) { return md; } };
  const ghi = (k, v) => localStorage.setItem(k, JSON.stringify(v));
  const nay = () => new Date().toISOString().slice(0, 10);
  const LICH = [1, 3, 7, 16, 35, 90], LOAI = ["nghia", "am", "dung"];
  const TEN_LOAI = { nghia: "Nhìn từ → chọn nghĩa", am: "Nghe → gõ lại từ", dung: "Điền từ vào câu" };

  let KHO = null, TU_LEVEL = null, BAN_DO_AUDIO;
  const tai = async p => (await fetch(p)).json();

  /* --- chuẩn hoá + so đáp án: port từ server.py --- */
  const RUT_GON = [["isn't","is not"],["aren't","are not"],["wasn't","was not"],["weren't","were not"],
    ["don't","do not"],["doesn't","does not"],["didn't","did not"],["haven't","have not"],
    ["hasn't","has not"],["hadn't","had not"],["won't","will not"],["wouldn't","would not"],
    ["can't","cannot"],["couldn't","could not"],["shouldn't","should not"],["mustn't","must not"],
    ["i'm","i am"],["you're","you are"],["we're","we are"],["they're","they are"],["he's","he is"],
    ["she's","she is"],["it's","it is"],["that's","that is"],["i've","i have"],["i'll","i will"],["let's","let us"]];
  const chuan = s => (s || "").toLowerCase()
    .replace(/[’‘]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-")
    .replace(/\s+/g, " ").trim().replace(/^[.!?,\s]+|[.!?,\s]+$/g, "");
  const goRutGon = s => RUT_GON.reduce((a, [n, d]) => a.replace(new RegExp("\\b" + n.replace("'", "'") + "\\b", "g"), d), s);
  function dungKhong(cuaToi, dapAn, nhan) {
    const t = chuan(cuaToi); if (!t) return false;
    const uv = (nhan && nhan.length ? nhan : [dapAn]).map(chuan);
    if (uv.includes(t)) return true;
    const td = goRutGon(t), uvd = uv.map(goRutGon);
    if (uvd.includes(td)) return true;
    return uvd.includes(td.replace(/^(a|an|the)\s+/, ""));
  }

  function chamBai(bai) {
    const kq = [], sl = doc(K.loi, { loi: [] });
    let dung = 0, chamDuoc = 0;
    for (const c of bai.cau_tra_loi || []) {
      const co = !!(c.dap_an || (c.nhan && c.nhan.length));
      const d = co ? dungKhong(c.cua_toi, c.dap_an, c.nhan) : null;
      if (co) { chamDuoc++; if (d) dung++; }
      kq.push({ so: c.so, de: c.de, cua_toi: c.cua_toi, dap_an: c.dap_an, dung: d,
                khong_cham_duoc: !co, giai_thich: c.giai_thich || "" });
      if (d === false && chuan(c.cua_toi))
        sl.loi.push({ unit: bai.unit, loai: bai.loai, de: c.de,
                      cua_toi: c.cua_toi, dap_an: c.dap_an, thoi_diem: bai.thoi_diem || "" });
    }
    ghi(K.loi, sl);
    const diem = chamDuoc ? Math.round(dung / chamDuoc * 100) : 0;
    return { diem, so_dung: dung, tong: chamDuoc, khong_cham_duoc: kq.length - chamDuoc,
             dat: diem >= 80, _luat: "Đạt từ 80% mới nên sang unit sau.", chi_tiet: kq };
  }

  function tongHopLoi() {
    const sl = doc(K.loi, { loi: [] });
    const sach = sl.loi.filter(l => chuan(l.cua_toi));
    if (sach.length !== sl.loi.length) ghi(K.loi, { loi: sach });
    const nhom = {}, demUnit = {};
    for (const l of sach) {
      demUnit[l.unit] = (demUnit[l.unit] || 0) + 1;
      const k = l.unit + "|" + chuan(l.de) + "|" + chuan(l.dap_an);
      const g = nhom[k] || (nhom[k] = { unit: l.unit, loai: l.loai, de: l.de,
        dap_an: l.dap_an, so_lan: 0, da_tra_loi: [], lan_cuoi: "" });
      g.so_lan++;
      if (!g.da_tra_loi.includes(l.cua_toi)) g.da_tra_loi.push(l.cua_toi);
      if ((l.thoi_diem || "") > g.lan_cuoi) g.lan_cuoi = l.thoi_diem || "";
    }
    const ds = Object.values(nhom).sort((a, b) => b.so_lan - a.so_lan || a.unit - b.unit);
    const demDA = {};
    ds.forEach(g => { const k = chuan(g.dap_an); if (k) demDA[k] = (demDA[k] || 0) + g.so_lan; });
    return { tong_loi: sach.length, so_nhom: ds.length,
      theo_unit: Object.entries(demUnit).map(([u, n]) => [+u, n]).sort((a, b) => b[1] - a[1]).slice(0, 10),
      hay_sai_nhat: Object.entries(demDA).sort((a, b) => b[1] - a[1]).slice(0, 15),
      nhom: ds.slice(0, 40) };
  }

  /* --- ôn tập lặp ngắt quãng: port từ on_tap.py --- */
  const ttThe = (b, tu, l) => b[tu + "|" + l] || { lan: 0, ngay_tiep: "", sai: 0 };
  function unitDaMo() {
    const td = doc(K.td, { unit: {} });
    return Object.entries(td.unit || {}).filter(([, v]) => ["dang", "xong"].includes(v.bai_hoc)).map(([k]) => +k);
  }
  function soanThe(tu, loai, tt) {
    const i = KHO[tu], the = { khoa: tu + "|" + loai, tu: i.tu, loai, ten_loai: TEN_LOAI[loai],
      ipa: i.ipa, nghia: i.nghia, unit: i.unit, lan: tt.lan, moi: tt.lan === 0 && !tt.ngay_tiep };
    if (loai === "nghia") {
      const cung = Object.entries(KHO).filter(([k, v]) => k !== tu && v.level === i.level && v.nghia).map(([, v]) => v.nghia);
      const nhieu = cung.sort(() => Math.random() - .5).slice(0, 3);
      the.lua_chon = [i.nghia, ...nhieu].sort(() => Math.random() - .5);
      the.dap_an = i.nghia;
    } else if (loai === "am") { the.doc = i.tu; the.dap_an = i.tu; }
    else {
      const re = new RegExp("\\b" + i.tu.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "i");
      the.cau = re.test(i.vi_du) ? i.vi_du.replace(re, "______") : i.vi_du;
      the.cau_day_du = i.vi_du; the.dap_an = i.tu;
      the.goi_y_nghia = i.nghia;
      the.goi_y_chu = i.tu.length > 1 ? i.tu[0] + "·".repeat(i.tu.length - 1) : i.tu;
      the.so_chu = i.tu.length;
    }
    return the;
  }
  /* unit != null -> chỉ ôn unit đó và BỎ QUA giới hạn "unit đã mở", vì người
     học đang chủ động chỉ định. Không truyền thì trộn mọi unit đã mở. */
  function denHan(soLuong = 20, tuMoi = 15, unit = null) {
    const b = doc(K.on, { the: {} }).the, mo = unitDaMo(), hn = nay();
    const qh = [], moi = [];
    for (const [tu, i] of Object.entries(KHO)) {
      if (unit ? i.unit !== unit : (mo.length && !mo.includes(i.unit))) continue;
      for (const l of LOAI) {
        if (l === "dung" && !i.vi_du) continue;
        const tt = ttThe(b, tu, l);
        if (tt.lan >= LICH.length) continue;
        (!tt.ngay_tiep ? moi : (tt.ngay_tiep <= hn ? qh : [])).push?.([tu, l, tt]);
      }
    }
    const tron = a => a.sort(() => Math.random() - .5);
    const chon = tron(qh).slice(0, soLuong);
    chon.push(...tron(moi).slice(0, Math.max(0, soLuong - chon.length)));
    return chon.map(([tu, l, tt]) => soanThe(tu, l, tt));
  }
  function traLoiThe(khoa, dung) {
    const d = doc(K.on, { the: {} });
    const tt = d.the[khoa] || { lan: 0, ngay_tiep: "", sai: 0 };
    let cach;
    if (dung) { tt.lan = Math.min(tt.lan + 1, LICH.length); cach = LICH[tt.lan - 1]; }
    else { tt.lan = 0; tt.sai = (tt.sai || 0) + 1; cach = 1; }
    const n = new Date(); n.setDate(n.getDate() + cach);
    tt.ngay_tiep = n.toISOString().slice(0, 10);
    d.the[khoa] = tt; ghi(K.on, d);
    return { ok: true, lan: tt.lan, ngay_tiep: tt.ngay_tiep, da_thuoc: tt.lan >= LICH.length };
  }
  function thongKeOn() {
    const b = doc(K.on, { the: {} }).the, mo = unitDaMo();
    const trong = Object.entries(KHO).filter(([, v]) => !mo.length || mo.includes(v.unit));
    let thuoc = 0;
    for (const [tu, i] of trong)
      if (LOAI.filter(l => !(l === "dung" && !i.vi_du)).every(l => ttThe(b, tu, l).lan >= LICH.length)) thuoc++;
    return { tu_trong_pham_vi: trong.length, tong_tu: Object.keys(KHO).length,
      da_thuoc_du_3_the: thuoc, the_da_hoc: Object.keys(b).length,
      den_han_hom_nay: denHan(99999).length, unit_da_mo: mo.sort((a, b2) => a - b2), lich: LICH };
  }

  function traTu(tu) {
    const s = (tu || "").replace(/[^A-Za-z']/g, "");
    const i = KHO[s.toLowerCase()];
    return { tu: s, ipa: i?.ipa || "", nguon_ipa: i ? "giao_trinh" : "",
      nghia: i?.nghia || "", vi_du: i?.vi_du || "", trong_cau: "",
      _ghi_chu: i ? "" : "Từ này không có trong danh sách từ vựng của giáo trình." };
  }

  /* --- chặn fetch --- */
  const goc = window.fetch.bind(window);
  const json = d => new Response(JSON.stringify(d), { status: 200, headers: { "Content-Type": "application/json" } });

  window.fetch = async function (url, opts) {
    const u = typeof url === "string" ? url : url.url;
    if (!u.includes("/api/")) return goc(url, opts);
    if (!KHO) { KHO = await tai("du_lieu/kho_tu.json"); TU_LEVEL = await tai("du_lieu/tu_theo_level.json"); }

    const duong = u.split("?")[0].replace(/^.*\/api\//, "/api/");
    const q = new URLSearchParams((u.split("?")[1] || ""));
    const body = opts?.body ? JSON.parse(opts.body) : {};
    datHoSo(q.get("ho_so") || body.ho_so);

    if (duong === "/api/ho_so") {
      return json(opts?.method === "POST" ? suaHoSo(body) : dsHoSo());
    }

    /* Ảnh chụp trọn gói của hồ sơ, dùng cho đồng bộ nhiều thiết bị. Việc GỘP
       do dong_bo.js làm, ở đây chỉ đọc và ghi đè. */
    if (duong === "/api/xuat") {
      return json({
        tien_do: doc(K.td, { unit: {}, phut_theo_ngay: {}, nghe: {} }),
        so_loi: doc(K.loi, { loi: [] }),
        on_tap: doc(K.on, { the: {} }),
      });
    }
    if (duong === "/api/nhap") {
      if (body.tien_do) ghi(K.td, body.tien_do);
      if (body.so_loi) ghi(K.loi, body.so_loi);
      if (body.on_tap) ghi(K.on, body.on_tap);
      return json({ ok: true });
    }
    const hai = duong.match(/^\/api\/(unit|mau_cau|de_thi)\/(\d+)$/);

    if (duong === "/api/cau_hinh") return json(await tai("du_lieu/cau_hinh.json"));
    if (duong === "/api/muc_luc") return json(await tai("du_lieu/muc_luc.json"));
    if (duong === "/api/tu_theo_level") return json(TU_LEVEL);
    if (hai) {
      const n = String(hai[2]).padStart(2, "0");
      const p = { unit: `du_lieu/unit_${n}.json`, mau_cau: `du_lieu/mau_cau_${n}.json`,
                  de_thi: `du_lieu/de_thi/de_${n}.json` }[hai[1]];
      try { return json(await tai(p)); }
      catch (e) { return new Response(JSON.stringify({ loi: "Không có" }), { status: 404 }); }
    }
    if (duong === "/api/tra_tu") return json(traTu(q.get("tu")));
    if (duong === "/api/tien_do") {
      if (opts?.method === "POST") {
        const td = doc(K.td, { unit: {}, phut_theo_ngay: {}, nghe: {} });
        for (const [k, v] of Object.entries(body.unit || {})) td.unit[k] = { ...(td.unit[k] || {}), ...v };
        for (const [d, p] of Object.entries(body.phut_theo_ngay || {}))
          td.phut_theo_ngay[d] = (td.phut_theo_ngay[d] || 0) + p;
        // Số câu đã nghe: lấy MAX, client gửi tổng chứ không gửi phần tăng
        td.nghe = td.nghe || {};
        for (const [u, n] of Object.entries(body.nghe || {}))
          td.nghe[u] = Math.max(td.nghe[u] || 0, +n || 0);
        ghi(K.td, td); return json({ ok: true });
      }
      return json({ tien_do: doc(K.td, { unit: {}, phut_theo_ngay: {}, nghe: {} }), loi: tongHopLoi() });
    }
    if (duong === "/api/on_tap") return json({ the: denHan(+(q.get("so_luong") || 20), 15, +(q.get("unit") || 0) || null), thong_ke: thongKeOn() });
    if (duong === "/api/on_tap/tra_loi") return json(traLoiThe(body.khoa, !!body.dung));
    if (duong === "/api/nop_bai") return json(chamBai(body));
    if (duong === "/api/xoa_loi") {
      const sl = doc(K.loi, { loi: [] });
      if (body.tat_ca) sl.loi = [];
      else if (body.unit != null) sl.loi = sl.loi.filter(l => l.unit !== body.unit);
      else if (body.nhom) sl.loi = sl.loi.filter(l => !(l.unit === body.unit_cua_loi && chuan(l.de) === chuan(body.de)));
      else sl.loi = sl.loi.filter(l => !(l.unit === body.unit_cua_loi && l.de === body.de && l.cua_toi === body.cua_toi));
      ghi(K.loi, sl); return json({ ok: true, con_lai: sl.loi.length });
    }
    if (duong === "/api/cham_giong")
      return json({ loi: "Bản web không chấm được phát âm — phần này cần Praat chạy bằng Python. "
                       + "Ghi âm vẫn hoạt động để bạn tự nghe lại và so với giọng mẫu." });
    /* Bản tĩnh có kèm audio hay không tuỳ lúc xuất bản. Có thì đọc bản đồ
       thật; không có thì trả rỗng để app tự dùng giọng máy. */
    if (duong === "/api/ban_do_audio") {
      if (BAN_DO_AUDIO === undefined) {
        try { BAN_DO_AUDIO = await tai("audio/ban_do.json"); }
        catch (e) { BAN_DO_AUDIO = { cau: {} }; }
      }
      return json(BAN_DO_AUDIO);
    }
    return new Response(JSON.stringify({ loi: "Không có API này" }), { status: 404 });
  };
})();
