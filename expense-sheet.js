// Fills the company BIFF8 template. All written values are Excel text (type "s", format "@").
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.ExpenseSheet = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const FIXED = {
    company: '連展電能科技',
    plant: '1500',
    division: '充電事業處',
    dept: '維運部',
    deptCode: '324603000',
    freewayLabel: '高速公路計程補助'
  };
  const DEFAULT_PROFILE = {
    payee: '',
    empId: '',
    carNo: '',
    fuel: '95'
  };
  const FUELS = ['92', '95', '98'];

  function clean(s) {
    return String(s ?? '').replace(/[\s\u3000\u00a0\u200b\ufeff\u2028\u2029]+/g, '');
  }
  function intText(n) {
    const x = Number(n);
    return String(Number.isFinite(x) ? Math.round(x) : 0);
  }
  function parkingText(v) {
    const s = clean(v);
    if (!s) return '0';
    const n = Number(s);
    return String(Number.isFinite(n) ? Math.round(n) : 0);
  }
  function timeText(v) {
    const s = clean(v);
    if (/^\d{4}$/.test(s)) return s;
    const m = s.match(/^(\d{1,2}):(\d{2})$/);
    if (m) return m[1].padStart(2, '0') + m[2];
    return '0800';
  }
  function dateText(v) {
    const s = clean(v);
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : s;
  }
  function placeText(stops) {
    return (stops || []).map(s => clean(s && s.name)).filter(Boolean).join('->');
  }
  function walkKm(trip) {
    return Math.round((Number(trip.freeway_km) || 0) + (Number(trip.ramp_km) || 0));
  }
  function profileOf(profile) {
    const p = Object.assign({}, DEFAULT_PROFILE, profile || {});
    p.payee = clean(p.payee) || DEFAULT_PROFILE.payee;
    p.empId = clean(p.empId) || DEFAULT_PROFILE.empId;
    p.carNo = clean(p.carNo) || DEFAULT_PROFILE.carNo;
    p.fuel = FUELS.includes(clean(p.fuel)) ? clean(p.fuel) : '95';
    return p;
  }
  function rowFor(trip) {
    const f = Object.assign({ date: '', time: '0800', client: '', reason: '', parking: '' }, trip.form || {});
    return [
      dateText(f.date),
      timeText(f.time),
      clean(f.client),
      clean(f.reason),
      placeText(trip.stops),
      '1',
      intText(trip.total_km),
      parkingText(f.parking),
      intText(walkKm(trip))
    ];
  }
  function put(ws, addr, value) {
    ws[addr] = Object.assign({}, ws[addr] || {}, { t: 's', v: String(value), z: '@' });
  }
  // trips: finished trip objects. profile: {payee, empId, carNo, fuel}.
  // Writes data from row 9 and refreshes the header value cells. Labels in rows 1-8 stay.
  function fillWorkbook(wb, trips, profile, XLSX) {
    const ws = wb.Sheets['匯入頁面'];
    if (!ws) throw new Error('找不到工作表「匯入頁面」');
    const p = profileOf(profile);
    put(ws, 'A2', FIXED.company);
    put(ws, 'B2', FIXED.plant);
    put(ws, 'A5', p.payee);
    put(ws, 'B5', p.empId);
    put(ws, 'C5', FIXED.division);
    put(ws, 'D5', FIXED.dept);
    put(ws, 'E5', FIXED.deptCode);
    put(ws, 'B7', p.carNo);
    put(ws, 'D7', p.fuel);
    put(ws, 'I7', FIXED.freewayLabel);
    const range = XLSX.utils.decode_range(ws['!ref'] || 'A1:I8');
    const last = trips.length ? 8 + trips.length - 1 : 7;
    const clearTo = Math.max(range.e.r, last);
    for (let r = 8; r <= clearTo; r++) {
      for (let c = 0; c <= 8; c++) delete ws[XLSX.utils.encode_cell({ r: r, c: c })];
    }
    trips.forEach((trip, i) => {
      rowFor(trip).forEach((value, c) => {
        ws[XLSX.utils.encode_cell({ r: 8 + i, c: c })] = { t: 's', v: String(value), z: '@' };
      });
    });
    ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(7, last), c: 8 } });
    Object.keys(ws).forEach(addr => {
      if (addr[0] === '!' || !ws[addr] || ws[addr].t === 'z') return;
      ws[addr].t = 's';
      ws[addr].v = String(ws[addr].v ?? '');
      ws[addr].z = '@';
    });
    return wb;
  }
  return { FIXED, DEFAULT_PROFILE, FUELS, clean, intText, parkingText, timeText, placeText, walkKm, profileOf, rowFor, fillWorkbook };
});
