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
  // Scans the photo scaled to `max` px. A right-hand QR found first is painted over and the scan repeated.
  function scan(jsQR, img, max) {
    const w0 = img.width || img.naturalWidth, h0 = img.height || img.naturalHeight;
    const k = Math.min(1, max / Math.max(w0, h0));
    const w = Math.round(w0 * k), h = Math.round(h0 * k);
    const cv = document.createElement('canvas');
    cv.width = w;
    cv.height = h;
    const g = cv.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0, w, h);
    for (let i = 0; i < 3; i++) {
      const r = jsQR(g.getImageData(0, 0, w, h).data, w, h);
      if (!r) return null;
      const hit = parse(r.data);
      if (hit) return hit;
      const L = r.location;
      g.fillStyle = '#fff';
      g.beginPath();
      [L.topLeftCorner, L.topRightCorner, L.bottomRightCorner, L.bottomLeftCorner].forEach((p, j) => j ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y));
      g.closePath();
      g.lineWidth = 12;
      g.strokeStyle = '#fff';
      g.fill();
      g.stroke();
    }
    return null;
  }
  // Resolves to {no, date, amount, buyer, seller}, or null when no e-invoice QR code is found.
  async function read(file) {
    const img = await loadImage(file);
    if ('BarcodeDetector' in self) {
      try {
        const codes = await new BarcodeDetector({ formats: ['qr_code'] }).detect(img);
        for (const c of codes) {
          const hit = parse(c.rawValue);
          if (hit) return hit;
        }
      } catch (e) {}
    }
    const jsQR = await loadJsQR();
    for (const max of [1600, 1000, 2400, 700]) {
      const hit = scan(jsQR, img, max);
      if (hit) return hit;
    }
    return null;
  }
  return { parse, normalizeNo, read };
});
