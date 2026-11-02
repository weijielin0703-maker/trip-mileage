// Taiwan address parsing for Nominatim. Free-text search fails on "100號", but finds the same house
// when the number is passed apart from the road ("100 北新路一段"). variants(q) lists searches to try in order.
(function (root) {
  const CN = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
  function normalize(q) {
    return String(q || '')
      .replace(/[！-～]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xfee0)) // full-width to ASCII
      .replace(/[\s　]+/g, '')
      .replace(/^(台|臺)灣(省)?/, '')
      .replace(/^\d{3,6}/, '') // postal code
      .replace(/^台(北|中|南|東)/, '臺$1');
  }
  // Returns {city, district, road, lane, alley, number} or null when no road is recognised.
  function parse(q) {
    const s = normalize(q);
    const m = s.match(/^(.{2,3}?[縣市])?(.{1,4}?[鄉鎮市區])?(?:.{1,4}?[村里])?(?:\d+鄰)?(.+?(?:路|街|大道))((?:\d+|[一二三四五六七八九十]+)段)?(?:(\d+)巷)?(?:(\d+)弄)?(?:(\d+(?:之\d+)?)號)?/);
    if (!m) return null;
    let [, city = '', district = '', road, sec = '', lane = '', alley = '', number = ''] = m;
    if (/^\d+段$/.test(sec)) sec = (CN[+sec.slice(0, -1)] || sec.slice(0, -1)) + '段';
    return { city, district, road: road + sec, lane, alley, number: number.replace(/之/, '-') };
  }
  // Each variant: {params, exact}. exact=false means the hit is only the lane or road, not the house.
  function variants(q) {
    const raw = String(q || '').trim();
    const out = [{ params: { q: raw }, exact: true }];
    const p = parse(raw);
    if (!p) return out;
    const area = [p.district, p.city].filter(Boolean).join(' ');
    const lane = p.road + (p.lane ? p.lane + '巷' : '') + (p.alley ? p.alley + '弄' : '');
    if (p.number) {
      const st = { street: p.number + ' ' + lane };
      if (p.district) Object.assign(st, { city: p.district }, p.city ? { state: p.city } : {});
      else if (p.city) st.city = p.city;
      out.push({ params: st, exact: true });
      out.push({ params: { q: [p.number, lane, area].filter(Boolean).join(' ') }, exact: true });
    }
    if (p.lane) out.push({ params: { q: [lane, area].filter(Boolean).join(' ') }, exact: false });
    out.push({ params: { q: [p.road, area].filter(Boolean).join(' ') }, exact: false });
    const seen = new Set();
    return out.filter(v => { const k = JSON.stringify(v.params); if (seen.has(k)) return false; seen.add(k); return true; });
  }
  // Nominatim sometimes answers a house-number search with the bare road; that is not an exact hit.
  function isExact(v, hit) {
    if (!v.exact) return false;
    if (!v.params.street && !/\d/.test(v.params.q || '')) return true;
    return !!(hit && hit.address && hit.address.house_number) || !['road', 'primary', 'secondary', 'tertiary', 'residential', 'trunk', 'unclassified'].includes(hit && hit.addresstype);
  }
  // Coordinates typed or pasted ("25.0339, 121.5645") or inside a Google Maps link (@lat,lng / q=lat,lng / !3dlat!4dlng).
  function coords(q) {
    const s = String(q || '').replace(/%2C/gi, ',');
    const m = s.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/) || s.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/) ||
      s.match(/[?&](?:q|query|ll|destination|center)=(-?\d+\.\d+),\s*(-?\d+\.\d+)/) ||
      s.match(/^\s*\(?(-?\d{1,3}\.\d+)\s*[,，\s]\s*(-?\d{1,3}\.\d+)\)?\s*$/);
    if (!m) return null;
    let lat = +m[1], lng = +m[2];
    if (Math.abs(lat) > 90 && Math.abs(lng) <= 90) [lat, lng] = [lng, lat];
    return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
  }
  // Loose name comparison: no spaces, 台 = 臺, case-insensitive.
  function key(s) { return String(s || '').replace(/[\s　]+/g, '').replace(/臺/g, '台').toLowerCase(); }
  function nameMatches(q, text) { const k = key(q); return !!k && key(text).includes(k); }
  const api = { normalize, parse, variants, isExact, coords, nameMatches };
  root.Geocode = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(this);
