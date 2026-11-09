// Reads a Taiwan e-invoice (電子發票證明聯) from a photo of it, using the left QR code.
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.Invoice = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  // Left QR: invoice number (10), ROC date yyyMMdd (7), random code (4), untaxed amount hex (8),
  // total hex (8), buyer tax ID (8, all zeros when none), seller tax ID (8), then encrypted data.
  // The right QR starts with "**" and holds item names only.
  const LEFT = /^([A-Z]{2})(\d{8})(\d{3})(\d{2})(\d{2})\d{4}[0-9a-fA-F]{8}([0-9a-fA-F]{8})(\d{8})(\d{8})/;
  function parse(text) {
    const m = LEFT.exec(String(text || '').trim());
    if (!m) return null;
    return {
      no: m[1] + '-' + m[2],
      date: (+m[3] + 1911) + '-' + m[4] + '-' + m[5],
      amount: parseInt(m[6], 16),
      buyer: m[7] === '00000000' ? '' : m[7],
      seller: m[8]
    };
  }
  // "AB12345678" / "ab-12345678" -> "AB-12345678", or '' when it is not an invoice number.
  function normalizeNo(s) {
    const m = /^([A-Za-z]{2})-?(\d{8})$/.exec(String(s || '').replace(/\s+/g, ''));
    return m ? m[1].toUpperCase() + '-' + m[2] : '';
  }

  // ZXing (zxing-cpp built to WebAssembly) copes with the small, thermal-printed codes on receipts.
  let zx = null;
  function loadZXing() {
    if (zx) return zx;
    zx = new Promise((ok, no) => {
      const s = document.createElement('script');
      s.src = './vendor/zxing/reader.js';
      s.onload = () => {
        if (!self.ZXingWASM) return no(new Error('條碼元件載入失敗'));
        ZXingWASM.prepareZXingModule({ overrides: { locateFile: p => './vendor/zxing/' + p } });
        ok(ZXingWASM);
      };
      s.onerror = () => no(new Error('條碼元件載入失敗，請確認網路'));
      document.head.appendChild(s);
    });
    zx.catch(() => { zx = null; });
    return zx;
  }
  async function loadImage(file) {
    if (self.createImageBitmap) {
      try { return await createImageBitmap(file); } catch (e) {}
    }
    const url = URL.createObjectURL(file);
    try {
      return await new Promise((ok, no) => {
        const img = new Image();
        img.onload = () => ok(img);
        img.onerror = () => no(new Error('讀不到這張照片'));
        img.src = url;
      });
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  }
  // Pixels of `src` with its long side at most `max`.
  function pixels(src, max) {
    const W = src.videoWidth || src.width || src.naturalWidth, H = src.videoHeight || src.height || src.naturalHeight;
    if (!W || !H) return null;
    const k = Math.min(1, max / Math.max(W, H));
    const w = Math.round(W * k), h = Math.round(H * k);
    const cv = document.createElement('canvas');
    cv.width = w;
    cv.height = h;
    const g = cv.getContext('2d', { willReadFrequently: true });
    g.drawImage(src, 0, 0, w, h);
    return g.getImageData(0, 0, w, h);
  }
  // The raw bytes are parsed, not the text: most POS machines write the item names in Big5, and the
  // fields that matter are plain ASCII at the start. Only the left code (not "**...") parses.
  async function decode(data) {
    if (!data) return null;
    const Z = await loadZXing();
    const codes = await Z.readBarcodes(data, { formats: ['QRCode'], tryHarder: true, maxNumberOfSymbols: 4 });
    for (const c of codes) {
      const hit = parse(String.fromCharCode.apply(null, Array.from(c.bytes || []).slice(0, 120)));
      if (hit) return hit;
    }
    return null;
  }
  // Resolves to {no, date, amount, buyer, seller}, or null when no e-invoice QR code is found.
  async function read(file) {
    const img = await loadImage(file);
    for (const max of [3000, 1600]) {
      const hit = await decode(pixels(img, max));
      if (hit) return hit;
    }
    return null;
  }
  // One pass over the current camera frame, at up to 2880 px so small codes keep their detail.
  function readFrame(video) {
    return decode(pixels(video, 2880));
  }
  return { parse, normalizeNo, read, readFrame, loadZXing };
});
