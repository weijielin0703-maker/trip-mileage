// Pure routing module: computeTrip(points, opts) -> {total_km, freeway_km, ramp_km, legs, roads, polyline, server}
// points: [{name, lat, lng}] in order. Swappable for Google Routes API / backend later.
(function (root) {
  // Public OSRM servers with the same API and the same OpenStreetMap data. Tried in order.
  const SERVERS = ['https://router.project-osrm.org', 'https://routing.openstreetmap.de/routed-car'];
  const TIMEOUT_MS = 15000;
  const FREEWAY_REFS = new Set(['1','2','3','3甲','4','5','6','8','10']);
  const EXPRESSWAY = /^(台|臺)?\s*(6[1-8]|7[2-8]|8[2-8])(甲|乙)?$/; // 快速公路 台61~台88
  // Public OSRM omits intersection classes, so isMotorway() usually stays false.
  // These national freeways are named without 國道/高速公路 in OpenStreetMap.
  const FREEWAY_NAMES = /機場支線|高雄支線|台中環線|臺中環線|汐止五股高架|五股楊梅高架/;
  // Maneuvers that keep you on the same carriageway. A turn means you left it.
  const THROUGH = new Set(['new name', 'continue', 'merge', 'fork', 'notification']);
  const isMotorway = s => (s.intersections || []).some(i => (i.classes || []).includes('motorway'));
  const refs = s => (s.ref || '').split(/[;,]/).map(x => x.trim()).filter(Boolean);
  const freewayRef = s => refs(s).some(r => FREEWAY_REFS.has(r));
  function classify(s) {
    const name = s.name || '', rs = refs(s);
    if (/快速(公|道)路/.test(name) || rs.some(r => EXPRESSWAY.test(r))) return 'other';
    if (/國道|高速公路|^國\d/.test(name) || FREEWAY_NAMES.test(name) || rs.some(r => /^國道?\d/.test(r))) return 'freeway';
    if (/交流道|匝道/.test(name)) return 'ramp';
    if (!name && s.maneuver && /^(on|off) ramp$/.test(s.maneuver.type)) return 'ramp';
    if (freewayRef(s) && isMotorway(s)) return 'freeway'; // e.g. 景美溪橋 ref 3 on 國3
    return 'other';
  }
  // Bare refs like "1" or "9" are shared by 國道 and 台線, so a numbered step only counts as freeway
  // when it continues a freeway without a turn (bridges, viaducts), or sits between two ramps/freeway steps.
  function classifySteps(steps) {
    const c = steps.map(classify);
    const through = s => s && s.maneuver && THROUGH.has(s.maneuver.type);
    for (let changed = true; changed;) {
      changed = false;
      for (let i = 0; i < steps.length; i++) {
        if (c[i] !== 'other' || !freewayRef(steps[i]) || /快速(公|道)路/.test(steps[i].name || '')) continue;
        const prevFw = i > 0 && c[i - 1] === 'freeway' && through(steps[i]);
        const nextFw = i + 1 < steps.length && c[i + 1] === 'freeway' && through(steps[i + 1]);
        const prevOn = i > 0 && c[i - 1] !== 'other' && through(steps[i]);
        // OSRM reports "off ramp" only when leaving a highway, so it also proves step i was one.
        const nextOn = i + 1 < steps.length && c[i + 1] !== 'other' && (through(steps[i + 1]) || steps[i + 1].maneuver.type === 'off ramp');
        if (prevFw || nextFw || (prevOn && nextOn)) { c[i] = 'freeway'; changed = true; }
      }
    }
    // A run of ramps only counts when it touches the freeway (drops e.g. 中正橋入口匝道 onto a city bridge).
    for (let i = 0; i < c.length;) {
      if (c[i] !== 'ramp') { i++; continue; }
      let j = i; while (j < c.length && c[j] === 'ramp') j++;
      if (c[i - 1] !== 'freeway' && c[j] !== 'freeway') for (let k = i; k < j; k++) c[k] = 'other';
      i = j;
    }
    return c;
  }
  // Ramer-Douglas-Peucker on [lat, lng] pairs; tol in degrees (~1e-4 is about 10 m).
  function simplify(pts, tol) {
    if (pts.length < 3) return pts.slice();
    const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
    const stack = [[0, pts.length - 1]];
    while (stack.length) {
      const [a, b] = stack.pop(); const [ay, ax] = pts[a], [by, bx] = pts[b];
      const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy);
      let far = -1, max = tol;
      for (let i = a + 1; i < b; i++) {
        // Round trips end where they start: then measure from that point instead of a line.
        const d = len < 1e-9 ? Math.hypot(pts[i][1] - ax, pts[i][0] - ay) : Math.abs(dy * (pts[i][1] - ax) - dx * (pts[i][0] - ay)) / len;
        if (d > max) { max = d; far = i; }
      }
      if (far > 0) { keep[far] = 1; stack.push([a, far], [far, b]); }
    }
    return pts.filter((_, i) => keep[i]).map(([y, x]) => [Math.round(y * 1e5) / 1e5, Math.round(x * 1e5) / 1e5]);
  }
  function friendly(e, offline) {
    if (offline) return '沒有網路連線。行程已保留，連上網路後再按「只計算」。';
    if (e && e.name === 'AbortError') return '路線伺服器沒有回應。行程已保留，稍後再按「只計算」。';
    return '路線伺服器暫時無法使用（' + ((e && e.message) || e) + '）。行程已保留，稍後再按「只計算」。';
  }
  async function fetchRoute(path, opts) {
    const f = opts.fetch || fetch;
    const servers = opts.server ? [opts.server] : SERVERS;
    const wait = opts.wait || (ms => new Promise(r => setTimeout(r, ms)));
    let last;
    for (let round = 0; round < 2; round++) {
      for (const base of servers) {
        const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
        const timer = ctl && setTimeout(() => ctl.abort(), opts.timeout || TIMEOUT_MS);
        try {
          const res = await f(base + path, ctl ? { signal: ctl.signal } : undefined);
          let j = null;
          try { j = await res.json(); } catch (e) {}
          // NoRoute / InvalidQuery are answers about the points, not server trouble: stop here.
          if (j && j.code && j.code !== 'Ok' && res.status < 500 && res.status !== 429) {
            const err = new Error(j.code === 'NoRoute' ? '找不到可以開車到達的路線，請檢查停靠點位置' : '路線計算失敗：' + (j.message || j.code));
            err.fatal = true; throw err;
          }
          if (!res.ok || !j || !j.routes || !j.routes[0]) { last = new Error(res.status === 429 ? '伺服器忙碌' : 'HTTP ' + res.status); continue; }
          return { j, base };
        } catch (e) {
          if (e.fatal) throw e;
          last = e;
        } finally { if (timer) clearTimeout(timer); }
      }
      if (round === 0) await wait(1500);
    }
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    throw new Error(friendly(last, offline));
  }
  async function computeTrip(points, opts = {}) {
    if (points.length < 2) throw new Error('至少需要兩個地點');
    const coords = points.map(p => `${(+p.lng).toFixed(6)},${(+p.lat).toFixed(6)}`).join(';');
    const { j, base } = await fetchRoute(`/route/v1/driving/${coords}?steps=true&overview=full&geometries=geojson&annotations=false`, opts);
    const r = j.routes[0], countRamps = !!opts.countRamps, rd = x => Math.round(x / 100) / 10;
    let fw = 0, rp = 0;
    const roads = new Map();
    const legs = r.legs.map((l, i) => {
      let lf = 0, lr = 0;
      const cls = classifySteps(l.steps);
      l.steps.forEach((s, k) => {
        const c = cls[k];
        if (c === 'freeway') lf += s.distance; else if (c === 'ramp') lr += s.distance; else return;
        const label = s.name || (s.ref ? '道路 ' + s.ref : '未命名匝道');
        const key = c + '|' + label;
        const row = roads.get(key) || { name: label, ref: s.ref || '', kind: c, m: 0 };
        row.m += s.distance; roads.set(key, row);
      });
      fw += lf; rp += lr;
      return { from: points[i].name, to: points[i + 1].name, km: rd(l.distance), freeway_km: rd(lf + (countRamps ? lr : 0)), ramp_km: rd(lr) };
    });
    const roadList = [...roads.values()].sort((a, b) => (a.kind > b.kind ? 1 : a.kind < b.kind ? -1 : b.m - a.m))
      .map(x => ({ name: x.name, ref: x.ref, kind: x.kind, km: rd(x.m) }));
    const line = r.geometry.coordinates.map(([x, y]) => [y, x]);
    return { total_km: rd(r.distance), freeway_km: rd(fw + (countRamps ? rp : 0)), ramp_km: rd(rp), legs, roads: roadList, polyline: simplify(line, 1e-4), server: base };
  }
  const api = { computeTrip, classify, classifySteps, simplify, SERVERS };
  root.Routing = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(this);
