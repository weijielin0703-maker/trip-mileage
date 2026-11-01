// Pure routing module: computeTrip(points, opts) -> {total_km, freeway_km, ramp_km, legs, polyline}
// points: [{name, lat, lng}] in order. Swappable for Google Routes API / backend later.
(function (root) {
  const FREEWAY_REFS = new Set(['1','2','3','3甲','4','5','6','8','10']);
  const EXPRESSWAY = /^(台|臺)?\s*(6[1-8]|7[2-8]|8[2-8])(甲|乙)?$/; // 快速公路 台61~台88
  // Public OSRM omits intersection classes, so isMotorway() usually stays false.
  // These national freeways are named without 國道/高速公路 in OpenStreetMap.
  const FREEWAY_NAMES = /機場支線|高雄支線|台中環線|臺中環線|汐止五股高架/;
  const isMotorway = s => (s.intersections || []).some(i => (i.classes || []).includes('motorway'));
  const refs = s => (s.ref || '').split(/[;,]/).map(x => x.trim()).filter(Boolean);
  function classify(s) {
    const name = s.name || '', rs = refs(s);
    if (/快速(公|道)路/.test(name) || rs.some(r => EXPRESSWAY.test(r))) return 'other';
    if (/國道|高速公路|^國\d/.test(name) || FREEWAY_NAMES.test(name) || rs.some(r => /^國道?\d/.test(r))) return 'freeway';
    if (/交流道|匝道/.test(name)) return 'ramp';
    if (rs.some(r => FREEWAY_REFS.has(r)) && isMotorway(s)) return 'freeway'; // e.g. 景美溪橋 ref 3 on 國3
    return 'other';
  }
  async function computeTrip(points, opts = {}) {
    if (points.length < 2) throw new Error('至少需要兩個地點');
    const base = opts.server || 'https://router.project-osrm.org';
    const coords = points.map(p => `${(+p.lng).toFixed(6)},${(+p.lat).toFixed(6)}`).join(';');
    const f = opts.fetch || fetch;
    const res = await f(`${base}/route/v1/driving/${coords}?steps=true&overview=full&geometries=geojson&annotations=false`);
    if (!res.ok) {
      let detail = 'HTTP ' + res.status;
      try { const err = await res.json(); if (err && (err.message || err.code)) detail = err.message || err.code; } catch (e) {}
      throw new Error('路線計算失敗：' + detail);
    }
    const j = await res.json();
    if (!j || j.code !== 'Ok' || !j.routes || !j.routes[0]) throw new Error('路線計算失敗：' + ((j && (j.message || j.code)) || '沒有路線'));
    const r = j.routes[0], countRamps = !!opts.countRamps, rd = x => Math.round(x / 100) / 10;
    let fw = 0, rp = 0;
    const legs = r.legs.map((l, i) => {
      let lf = 0, lr = 0;
      for (const s of l.steps) { const c = classify(s); if (c === 'freeway') lf += s.distance; else if (c === 'ramp') lr += s.distance; }
      fw += lf; rp += lr;
      return { from: points[i].name, to: points[i + 1].name, km: rd(l.distance), freeway_km: rd(lf + (countRamps ? lr : 0)), ramp_km: rd(lr) };
    });
    return { total_km: rd(r.distance), freeway_km: rd(fw + (countRamps ? rp : 0)), ramp_km: rd(rp), legs, polyline: r.geometry.coordinates.map(([x, y]) => [y, x]) };
  }
  const api = { computeTrip, classify };
  root.Routing = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(this);
