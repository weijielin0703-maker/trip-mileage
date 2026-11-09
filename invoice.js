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

  function loadJsQR() {
    if (self.jsQR) return Promise.resolve(self.jsQR);
    return new Promise((ok, no) => {
      const s = document.createElement('script');
      s.src = './vendor/jsQR.js';
      s.onload = () => self.jsQR ? ok(self.jsQR) : no(new Error('條碼元件載入失敗'));
      s.onerror = () => no(new Error('條碼元件載入失敗，請確認網路'));
      document.head.appendChild(s);
    });
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
  // jsQR drops a byte segment it cannot read as UTF-8, and most POS machines write the item names
  // in Big5, so the raw bytes are tried too. The fields that matter are plain ASCII at the start.
  function hitOf(r) {
    const raw = String.fromCharCode.apply(null, Array.from(r.binaryData || []).slice(0, 120));
    return parse(r.data) || parse(raw);
  }
  // Parts of the picture to try, as fractions [x, y, w, h]: the two codes sit side by side and
  // jsQR can mix up their corner marks when it sees both, so each half is tried on its own too.
  const REGIONS = [[0, 0, 1, 1], [0, 0, .5, 1], [.5, 0, .5, 1], [0, 0, .6, 1], [.4, 0, .6, 1], [0, 0, 1, .5], [0, .5, 1, .5], [.2, .2, .6, .6], [.25, 0, .5, 1]];
  // Scans one region of `src` scaled so its long side is at most `max` px. A right-hand QR found
  // first is painted over and the scan repeated.
  function scan(jsQR, src, region, max) {
    const W = src.videoWidth || src.width || src.naturalWidth, H = src.videoHeight || src.height || src.naturalHeight;
    if (!W || !H) return null;
    const sx = W * region[0], sy = H * region[1], sw = W * region[2], sh = H * region[3];
    const k = Math.min(1, max / Math.max(sw, sh));
    const w = Math.round(sw * k), h = Math.round(sh * k);
    const cv = document.createElement('canvas');
    cv.width = w;
    cv.height = h;
    const g = cv.getContext('2d', { willReadFrequently: true });
    g.drawImage(src, sx, sy, sw, sh, 0, 0, w, h);
    for (let i = 0; i < 3; i++) {
      const r = jsQR(g.getImageData(0, 0, w, h).data, w, h);
      if (!r) return null;
      const hit = hitOf(r);
      if (hit) return hit;
      const L = r.location;
      g.beginPath();
      [L.topLeftCorner, L.topRightCorner, L.bottomRightCorner, L.bottomLeftCorner].forEach((p, j) => j ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y));
      g.closePath();
      g.lineWidth = 12;
      g.fillStyle = g.strokeStyle = '#fff';
      g.fill();
      g.stroke();
    }
    return null;
  }
  async function detect(src) {
    if (!('BarcodeDetector' in self)) return null;
    try {
      const codes = await new BarcodeDetector({ formats: ['qr_code'] }).detect(src);
      for (const c of codes) {
        const hit = parse(c.rawValue);
        if (hit) return hit;
      }
    } catch (e) {}
    return null;
  }
  // Resolves to {no, date, amount, buyer, seller}, or null when no e-invoice QR code is found.
  async function read(file) {
    const img = await loadImage(file);
    const quick = await detect(img);
    if (quick) return quick;
    const jsQR = await loadJsQR();
    for (const max of [1600, 1000, 2400]) {
      for (const region of REGIONS) {
        const hit = scan(jsQR, img, region, max);
        if (hit) return hit;
        await new Promise(r => setTimeout(r, 0));
      }
    }
    return null;
  }
  // One pass over the current camera frame; `turn` picks the region, so successive calls cycle through them.
  async function readFrame(video, turn) {
    const quick = await detect(video);
    if (quick) return quick;
    const jsQR = await loadJsQR();
    return scan(jsQR, video, REGIONS[turn % REGIONS.length], 900);
  }
  return { parse, normalizeNo, read, readFrame, loadJsQR };
});
